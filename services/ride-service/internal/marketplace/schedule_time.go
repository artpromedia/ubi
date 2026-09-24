package marketplace

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	// The IANA database is embedded so a pickup's timezone resolves the same
	// on every host, whatever tzdata the container image happens to carry.
	_ "time/tzdata"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// DST disambiguation choices (contract MP_DST_DISAMBIGUATIONS): how a local
// time that a daylight-saving change makes ambiguous resolves.
const (
	// DSTCompatible moves a time inside a spring-forward GAP forward by the
	// gap and takes the EARLIER instant of a fall-back OVERLAP — the same
	// rule as RFC 5545 and ECMAScript Temporal's "compatible". The default.
	DSTCompatible = "compatible"
	DSTEarlier    = "earlier"
	DSTLater      = "later"
	// DSTReject refuses a gap or an overlap so the rider picks explicitly.
	DSTReject = "reject"
)

// DST resolutions actually applied (contract MP_DST_RESOLUTIONS). Always
// reported back, so a shifted time is never a silent surprise.
const (
	DSTResolutionExact          = "exact"
	DSTResolutionGapForward     = "gap_shifted_forward"
	DSTResolutionGapBackward    = "gap_shifted_backward"
	DSTResolutionOverlapEarlier = "overlap_earlier"
	DSTResolutionOverlapLater   = "overlap_later"
)

// ScheduleInput is a requested pickup time (MpPickupScheduleInputSchema):
// a local date, a local wall-clock time and an IANA timezone, plus the
// pickup window length. The client never sends a UTC instant — the server
// resolves it.
type ScheduleInput struct {
	LocalDate         string `json:"localDate"`
	LocalTime         string `json:"localTime"`
	TimeZone          string `json:"timeZone,omitempty"`
	WindowMinutes     *int   `json:"windowMinutes,omitempty"`
	DSTDisambiguation string `json:"dstDisambiguation,omitempty"`
}

// PickupSchedule is a resolved, stored pickup time: what the rider asked for
// (local date/time/zone), the UTC instant it resolved to, the offset in force
// then, the DST resolution applied and the pickup window [PickupAt,
// WindowEnd). Stored as jsonb on a request and as columns on a scheduled
// request.
type PickupSchedule struct {
	LocalDate     string    `json:"localDate"`
	LocalTime     string    `json:"localTime"`
	TimeZone      string    `json:"timeZone"`
	UTCOffsetSec  int       `json:"utcOffsetSec"`
	DSTResolution string    `json:"dstResolution"`
	WindowSec     int       `json:"windowSec"`
	PickupAt      time.Time `json:"pickupAt"`
	WindowEnd     time.Time `json:"windowEnd"`
}

// windowBounds is a market's pickup-window rule: min ≤ default ≤ max seconds.
type windowBounds struct {
	minSec, defaultSec, maxSec int
}

func scheduleFieldError(field, format string, args ...any) *domain.Error {
	return domain.Errorf(domain.CodeValidationFailed, format, args...).
		WithDetails(map[string]any{"field": field})
}

// parseLocalDate reads YYYY-MM-DD strictly (a real calendar date).
func parseLocalDate(raw string) (time.Time, error) {
	date, err := time.Parse("2006-01-02", raw)
	if err != nil || date.Format("2006-01-02") != raw {
		return time.Time{}, scheduleFieldError("schedule.localDate", "%q is not a calendar date (YYYY-MM-DD)", raw)
	}
	return date, nil
}

// parseLocalClock reads HH:MM (24-hour) strictly.
func parseLocalClock(raw string) (int, int, error) {
	parts := strings.Split(raw, ":")
	if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 2 {
		return 0, 0, scheduleFieldError("schedule.localTime", "%q is not a local time (HH:MM, 24-hour)", raw)
	}
	hour, hourErr := strconv.Atoi(parts[0])
	minute, minuteErr := strconv.Atoi(parts[1])
	if hourErr != nil || minuteErr != nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 0, 0, scheduleFieldError("schedule.localTime", "%q is not a local time (HH:MM, 24-hour)", raw)
	}
	return hour, minute, nil
}

// loadZone resolves an IANA timezone name, refusing the process-dependent
// "Local" and anything the embedded database does not know.
func loadZone(name string) (*time.Location, error) {
	if name == "" || name == "Local" {
		return nil, scheduleFieldError("schedule.timeZone", "a pickup needs an IANA timezone such as \"Africa/Lagos\"")
	}
	location, err := time.LoadLocation(name)
	if err != nil {
		return nil, scheduleFieldError("schedule.timeZone", "%q is not an IANA timezone", name)
	}
	return location, nil
}

// resolveLocalTime turns a wall-clock time in a zone into the UTC instant,
// resolving daylight-saving ambiguity explicitly instead of trusting
// time.Date (which "does not guarantee which" of two zones it picks):
//
//   - exactly one instant shows that wall time → exact;
//   - two instants show it (a fall-back OVERLAP) → the earlier unless
//     `later` is asked for; `reject` refuses;
//   - none does (a spring-forward GAP) → shifted forward by the gap (the
//     pre-transition offset applied) unless `earlier` asks for the shift
//     backwards; `reject` refuses.
func resolveLocalTime(date time.Time, hour, minute int, location *time.Location, disambiguation string) (time.Time, string, error) {
	naive := time.Date(date.Year(), date.Month(), date.Day(), hour, minute, 0, 0, time.UTC)
	// Every offset in force within a day and a half either side of the naive
	// instant: a wall time's instant is naive − offset for one of them.
	offsets := map[int]bool{}
	for _, delta := range []time.Duration{-36 * time.Hour, -12 * time.Hour, 0, 12 * time.Hour, 36 * time.Hour} {
		_, offset := naive.Add(delta).In(location).Zone()
		offsets[offset] = true
	}
	matches := []time.Time{}
	type shifted struct {
		at    time.Time
		shift time.Duration
	}
	var candidates []shifted
	for offset := range offsets {
		candidate := naive.Add(-time.Duration(offset) * time.Second)
		local := candidate.In(location)
		wall := time.Date(local.Year(), local.Month(), local.Day(), local.Hour(), local.Minute(), 0, 0, time.UTC)
		if wall.Equal(naive) {
			matches = append(matches, candidate)
			continue
		}
		candidates = append(candidates, shifted{at: candidate, shift: wall.Sub(naive)})
	}
	sort.Slice(matches, func(i, j int) bool { return matches[i].Before(matches[j]) })

	switch len(matches) {
	case 1:
		return matches[0], DSTResolutionExact, nil
	case 0:
		if disambiguation == DSTReject {
			return time.Time{}, "", scheduleFieldError("schedule.localTime",
				"%02d:%02d does not exist on %s in %s (the clocks go forward); choose another time",
				hour, minute, date.Format("2006-01-02"), location.String())
		}
		wantForward := disambiguation != DSTEarlier
		var best *shifted
		for i := range candidates {
			c := candidates[i]
			if wantForward != (c.shift > 0) {
				continue
			}
			if best == nil || absDuration(c.shift) < absDuration(best.shift) {
				best = &c
			}
		}
		if best == nil {
			return time.Time{}, "", scheduleFieldError("schedule.localTime",
				"%02d:%02d on %s cannot be placed in %s", hour, minute, date.Format("2006-01-02"), location.String())
		}
		if wantForward {
			return best.at, DSTResolutionGapForward, nil
		}
		return best.at, DSTResolutionGapBackward, nil
	default:
		switch disambiguation {
		case DSTReject:
			return time.Time{}, "", scheduleFieldError("schedule.localTime",
				"%02d:%02d happens twice on %s in %s (the clocks go back); choose earlier or later",
				hour, minute, date.Format("2006-01-02"), location.String())
		case DSTLater:
			return matches[len(matches)-1], DSTResolutionOverlapLater, nil
		default:
			return matches[0], DSTResolutionOverlapEarlier, nil
		}
	}
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// validDisambiguation reports whether a requested disambiguation is known.
func validDisambiguation(value string) bool {
	switch value {
	case "", DSTCompatible, DSTEarlier, DSTLater, DSTReject:
		return true
	}
	return false
}

// resolveSchedule validates a requested pickup time and resolves it into a
// stored PickupSchedule. The zone defaults to the city's; the window to the
// market's default, bounded by its min/max.
func resolveSchedule(input ScheduleInput, cityZone string, bounds windowBounds) (*PickupSchedule, *time.Location, error) {
	zoneName := input.TimeZone
	if zoneName == "" {
		zoneName = cityZone
	}
	location, err := loadZone(zoneName)
	if err != nil {
		return nil, nil, err
	}
	date, err := parseLocalDate(input.LocalDate)
	if err != nil {
		return nil, nil, err
	}
	hour, minute, err := parseLocalClock(input.LocalTime)
	if err != nil {
		return nil, nil, err
	}
	if !validDisambiguation(input.DSTDisambiguation) {
		return nil, nil, scheduleFieldError("schedule.dstDisambiguation",
			"%q is not a DST disambiguation (compatible, earlier, later, reject)", input.DSTDisambiguation)
	}
	disambiguation := input.DSTDisambiguation
	if disambiguation == "" {
		disambiguation = DSTCompatible
	}
	windowSec := bounds.defaultSec
	if input.WindowMinutes != nil {
		windowSec = *input.WindowMinutes * 60
	}
	if windowSec < bounds.minSec || windowSec > bounds.maxSec {
		return nil, nil, domain.Errorf(domain.CodeValidationFailed,
			"the pickup window must be between %d and %d minutes", bounds.minSec/60, bounds.maxSec/60).
			WithDetails(map[string]any{
				"field":            "schedule.windowMinutes",
				"minimumMinutes":   bounds.minSec / 60,
				"maximumMinutes":   bounds.maxSec / 60,
				"requestedMinutes": windowSec / 60,
			})
	}
	pickupAt, resolution, err := resolveLocalTime(date, hour, minute, location, disambiguation)
	if err != nil {
		return nil, nil, err
	}
	_, offset := pickupAt.In(location).Zone()
	return &PickupSchedule{
		LocalDate:     input.LocalDate,
		LocalTime:     input.LocalTime,
		TimeZone:      location.String(),
		UTCOffsetSec:  offset,
		DSTResolution: resolution,
		WindowSec:     windowSec,
		PickupAt:      pickupAt.UTC(),
		WindowEnd:     pickupAt.UTC().Add(time.Duration(windowSec) * time.Second),
	}, location, nil
}

// formatUTCOffset renders an offset as ±HH:MM.
func formatUTCOffset(offsetSec int) string {
	sign := "+"
	if offsetSec < 0 {
		sign = "-"
		offsetSec = -offsetSec
	}
	return fmt.Sprintf("%s%02d:%02d", sign, offsetSec/3600, (offsetSec%3600)/60)
}

// PickupScheduleView is MpPickupScheduleSchema.
type PickupScheduleView struct {
	LocalDate     string    `json:"localDate"`
	LocalTime     string    `json:"localTime"`
	TimeZone      string    `json:"timeZone"`
	UTCOffset     string    `json:"utcOffset"`
	DSTResolution string    `json:"dstResolution"`
	PickupAt      time.Time `json:"pickupAt"`
	WindowStart   time.Time `json:"windowStart"`
	WindowEnd     time.Time `json:"windowEnd"`
	WindowMinutes int       `json:"windowMinutes"`
	Label         string    `json:"label"`
}

// scheduleViewOf renders a stored schedule, phrasing the pickup in the
// rider's own local time — the resolved local wall clock, which differs from
// the requested one only when a DST gap shifted it (and says so).
func scheduleViewOf(schedule *PickupSchedule) PickupScheduleView {
	location, err := time.LoadLocation(schedule.TimeZone)
	if err != nil {
		location = time.FixedZone("", schedule.UTCOffsetSec)
	}
	local := schedule.PickupAt.In(location)
	label := local.Format("Mon 2 Jan 2006, 15:04") + " (UTC" + formatUTCOffset(schedule.UTCOffsetSec) + ")"
	switch schedule.DSTResolution {
	case DSTResolutionGapForward, DSTResolutionGapBackward:
		label += " — " + schedule.LocalTime + " does not exist that day (daylight saving)"
	case DSTResolutionOverlapEarlier:
		label += " — the first " + schedule.LocalTime + " (clocks go back that night)"
	case DSTResolutionOverlapLater:
		label += " — the second " + schedule.LocalTime + " (clocks go back that night)"
	}
	return PickupScheduleView{
		LocalDate:     schedule.LocalDate,
		LocalTime:     schedule.LocalTime,
		TimeZone:      schedule.TimeZone,
		UTCOffset:     formatUTCOffset(schedule.UTCOffsetSec),
		DSTResolution: schedule.DSTResolution,
		PickupAt:      schedule.PickupAt,
		WindowStart:   schedule.PickupAt,
		WindowEnd:     schedule.WindowEnd,
		WindowMinutes: schedule.WindowSec / 60,
		Label:         label,
	}
}
