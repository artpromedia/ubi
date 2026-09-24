package marketplace

import (
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// resolveAt is resolveLocalTime over strings, for readable cases.
func resolveAt(t *testing.T, zone, date string, hour, minute int, disambiguation string) (time.Time, string, error) {
	t.Helper()
	location, err := time.LoadLocation(zone)
	if err != nil {
		t.Fatalf("load %s: %v", zone, err)
	}
	day, err := parseLocalDate(date)
	if err != nil {
		t.Fatalf("parse %s: %v", date, err)
	}
	return resolveLocalTime(day, hour, minute, location, disambiguation)
}

// TestResolveLocalTimeSpringForwardGap: 02:30 does not exist in New York on
// 2026-03-08 (clocks jump 02:00 → 03:00). compatible/later move it forward
// by the gap (03:30 EDT = 07:30Z); earlier moves it back (01:30 EST =
// 06:30Z); reject refuses. The resolution applied is always reported.
func TestResolveLocalTimeSpringForwardGap(t *testing.T) {
	cases := []struct {
		disambiguation string
		want           string
		resolution     string
	}{
		{DSTCompatible, "2026-03-08T07:30:00Z", DSTResolutionGapForward},
		{"", "2026-03-08T07:30:00Z", DSTResolutionGapForward},
		{DSTLater, "2026-03-08T07:30:00Z", DSTResolutionGapForward},
		{DSTEarlier, "2026-03-08T06:30:00Z", DSTResolutionGapBackward},
	}
	for _, c := range cases {
		disambiguation := c.disambiguation
		if disambiguation == "" {
			disambiguation = DSTCompatible
		}
		at, resolution, err := resolveAt(t, "America/New_York", "2026-03-08", 2, 30, disambiguation)
		if err != nil {
			t.Fatalf("%s: %v", c.disambiguation, err)
		}
		if at.UTC().Format(time.RFC3339) != c.want || resolution != c.resolution {
			t.Fatalf("%s: got %s (%s), want %s (%s)", c.disambiguation, at.UTC().Format(time.RFC3339), resolution, c.want, c.resolution)
		}
	}
	if _, _, err := resolveAt(t, "America/New_York", "2026-03-08", 2, 30, DSTReject); err == nil {
		t.Fatal("reject must refuse a time inside the spring-forward gap")
	} else if mapped, ok := domain.AsError(err); !ok || mapped.Code != domain.CodeValidationFailed {
		t.Fatalf("a rejected gap time is a validation failure: %v", err)
	}
	// The same wall time on the day before is exact (EST, -05:00).
	at, resolution, err := resolveAt(t, "America/New_York", "2026-03-07", 2, 30, DSTReject)
	if err != nil || resolution != DSTResolutionExact || at.UTC().Format(time.RFC3339) != "2026-03-07T07:30:00Z" {
		t.Fatalf("an ordinary day resolves exactly: %s %s %v", at.UTC(), resolution, err)
	}
}

// TestResolveLocalTimeFallBackOverlap: 01:30 happens twice in New York on
// 2026-11-01 (EDT then EST). compatible/earlier take the first instant
// (05:30Z), later the second (06:30Z), reject refuses. London behaves the
// same on its own dates (a DST zone east of UTC).
func TestResolveLocalTimeFallBackOverlap(t *testing.T) {
	cases := []struct {
		zone, date     string
		hour, minute   int
		disambiguation string
		want           string
		resolution     string
	}{
		{"America/New_York", "2026-11-01", 1, 30, DSTCompatible, "2026-11-01T05:30:00Z", DSTResolutionOverlapEarlier},
		{"America/New_York", "2026-11-01", 1, 30, DSTEarlier, "2026-11-01T05:30:00Z", DSTResolutionOverlapEarlier},
		{"America/New_York", "2026-11-01", 1, 30, DSTLater, "2026-11-01T06:30:00Z", DSTResolutionOverlapLater},
		{"Europe/London", "2026-10-25", 1, 30, DSTCompatible, "2026-10-25T00:30:00Z", DSTResolutionOverlapEarlier},
		{"Europe/London", "2026-10-25", 1, 30, DSTLater, "2026-10-25T01:30:00Z", DSTResolutionOverlapLater},
		{"Europe/London", "2026-03-29", 1, 30, DSTCompatible, "2026-03-29T01:30:00Z", DSTResolutionGapForward},
	}
	for _, c := range cases {
		at, resolution, err := resolveAt(t, c.zone, c.date, c.hour, c.minute, c.disambiguation)
		if err != nil {
			t.Fatalf("%s %s %s: %v", c.zone, c.date, c.disambiguation, err)
		}
		if at.UTC().Format(time.RFC3339) != c.want || resolution != c.resolution {
			t.Fatalf("%s %s %s: got %s (%s), want %s (%s)", c.zone, c.date, c.disambiguation,
				at.UTC().Format(time.RFC3339), resolution, c.want, c.resolution)
		}
	}
	if _, _, err := resolveAt(t, "America/New_York", "2026-11-01", 1, 30, DSTReject); err == nil {
		t.Fatal("reject must refuse a time that happens twice")
	}
}

// TestResolveLocalTimeNoDSTZone: Africa/Lagos (WAT, +01:00 all year) never
// has a gap or an overlap — every wall time is exact, including the dates
// that are ambiguous in DST zones.
func TestResolveLocalTimeNoDSTZone(t *testing.T) {
	for _, date := range []string{"2026-03-08", "2026-03-29", "2026-10-25", "2026-11-01", "2026-12-31"} {
		for _, hm := range [][2]int{{0, 0}, {1, 30}, {2, 30}, {8, 0}, {23, 59}} {
			at, resolution, err := resolveAt(t, "Africa/Lagos", date, hm[0], hm[1], DSTReject)
			if err != nil || resolution != DSTResolutionExact {
				t.Fatalf("Lagos %s %02d:%02d: %s %v", date, hm[0], hm[1], resolution, err)
			}
			local := at.In(time.FixedZone("WAT", 3600))
			if local.Hour() != hm[0] || local.Minute() != hm[1] || local.Format("2006-01-02") != date {
				t.Fatalf("Lagos %s %02d:%02d resolved to %s", date, hm[0], hm[1], at.UTC())
			}
		}
	}
}

// TestResolveScheduleValidation: the schedule input is validated strictly —
// a real calendar date, a 24-hour HH:MM, an IANA zone (never "Local"), a
// known disambiguation and a window inside the market's bounds — and the
// city's zone is the default.
func TestResolveScheduleValidation(t *testing.T) {
	bounds := windowBounds{minSec: 300, defaultSec: 600, maxSec: 1800}
	ok, _, err := resolveSchedule(ScheduleInput{LocalDate: "2026-10-01", LocalTime: "08:15"}, "Africa/Lagos", bounds)
	if err != nil {
		t.Fatal(err)
	}
	if ok.TimeZone != "Africa/Lagos" || ok.WindowSec != 600 || ok.UTCOffsetSec != 3600 ||
		ok.PickupAt.Format(time.RFC3339) != "2026-10-01T07:15:00Z" || ok.WindowEnd.Sub(ok.PickupAt) != 10*time.Minute {
		t.Fatalf("defaults: %+v", ok)
	}
	if view := scheduleViewOf(ok); view.UTCOffset != "+01:00" || view.WindowMinutes != 10 || view.LocalTime != "08:15" {
		t.Fatalf("view: %+v", view)
	}
	fifteen := 15
	for name, input := range map[string]ScheduleInput{
		"impossible date":      {LocalDate: "2026-02-30", LocalTime: "08:00"},
		"not a date":           {LocalDate: "tomorrow", LocalTime: "08:00"},
		"24-hour clock":        {LocalDate: "2026-10-01", LocalTime: "24:00"},
		"minutes":              {LocalDate: "2026-10-01", LocalTime: "08:60"},
		"12-hour clock":        {LocalDate: "2026-10-01", LocalTime: "8:00 AM"},
		"unknown zone":         {LocalDate: "2026-10-01", LocalTime: "08:00", TimeZone: "Mars/Olympus"},
		"process-local zone":   {LocalDate: "2026-10-01", LocalTime: "08:00", TimeZone: "Local"},
		"unknown DST choice":   {LocalDate: "2026-10-01", LocalTime: "08:00", DSTDisambiguation: "whatever"},
		"window above maximum": {LocalDate: "2026-10-01", LocalTime: "08:00", WindowMinutes: intPointer(45)},
	} {
		if _, _, err := resolveSchedule(input, "Africa/Lagos", bounds); err == nil {
			t.Fatalf("%s must be refused", name)
		}
	}
	custom, _, err := resolveSchedule(ScheduleInput{LocalDate: "2026-10-01", LocalTime: "08:00", WindowMinutes: &fifteen,
		TimeZone: "America/New_York"}, "Africa/Lagos", bounds)
	if err != nil || custom.WindowSec != 900 || custom.TimeZone != "America/New_York" || custom.UTCOffsetSec != -4*3600 {
		t.Fatalf("explicit zone and window: %+v %v", custom, err)
	}
}

// TestDueReminderOffsets: an offset is due once its moment has come, only if
// that moment came after the aggregate was created, and never twice.
func TestDueReminderOffsets(t *testing.T) {
	pickup := time.Date(2026, 10, 1, 20, 0, 0, 0, time.UTC)
	created := pickup.Add(-24 * time.Hour)
	offsets := []int{43_200, 3_600}
	if due := dueReminderOffsets(offsets, nil, pickup, created, pickup.Add(-13*time.Hour)); len(due) != 0 {
		t.Fatalf("nothing is due 13 h out: %v", due)
	}
	if due := dueReminderOffsets(offsets, nil, pickup, created, pickup.Add(-11*time.Hour)); len(due) != 1 || due[0] != 43_200 {
		t.Fatalf("the 12 h reminder is due: %v", due)
	}
	if due := dueReminderOffsets(offsets, []int32{43_200}, pickup, created, pickup.Add(-30*time.Minute)); len(due) != 1 || due[0] != 3_600 {
		t.Fatalf("only the 1 h reminder is still due: %v", due)
	}
	late := pickup.Add(-90 * time.Minute)
	if due := dueReminderOffsets(offsets, nil, pickup, late, pickup.Add(-30*time.Minute)); len(due) != 1 || due[0] != 3_600 {
		t.Fatalf("a 12 h reminder is never sent for a booking made 90 min out: %v", due)
	}
}

func intPointer(v int) *int { return &v }
