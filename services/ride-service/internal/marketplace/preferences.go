package marketplace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
)

// Driver preferences (A04.2).
//
// Preferences are the driver's own filters and suggestions: a minimum trip
// amount, a maximum pickup distance, delivery and multi-stop willingness, a
// homeward area and weekly availability windows (stored only). The per-km
// rate and the minimum trip FARE the "Your rate" preset is calculated from
// stay in the versioned rate profiles (profiles.go).
//
// What preferences are NOT, by construction:
//   - eligibility — EvaluateEligibility never reads them, so a preference can
//     neither widen a request's envelope nor lift a server refusal;
//   - bidding — nothing reads them to place, revise or withdraw an offer. They
//     filter/rank the feed and pre-fill a suggested amount; the driver still
//     bids manually while stationary.

// Structural preference bounds. Plumbing and privacy, not market policy:
// every market-dependent ceiling (the widest envelope, the stop limit, the
// largest minimum trip fare) comes from the city's marketplace policy.
const (
	// minPickupPreferenceMeters: a pickup cap below this would hide nearly
	// every request; it is refused rather than silently emptying the feed.
	minPickupPreferenceMeters = 500
	// Homeward areas are areas, not pins: at least twice the ~1 km cell the
	// match uses, so the homeward tag can never locate a dropoff more finely
	// than the card's own area label.
	minHomewardRadiusMeters = 2_000
	maxHomewardRadiusMeters = 50_000
	maxHomewardLabelRunes   = 40
	// maxAvailabilityWindows is four windows a day, every day.
	maxAvailabilityWindows = 28
	minutesPerDay          = 24 * 60
)

// availabilityDays is the canonical weekday order windows are stored in.
var availabilityDays = []string{"mon", "tue", "wed", "thu", "fri", "sat", "sun"}

func dayIndex(day string) int {
	for index, candidate := range availabilityDays {
		if candidate == day {
			return index
		}
	}
	return -1
}

// Preference tags a feed card may carry (MpFeedItem.preferenceTags).
const PreferenceTagHomeward = "homeward"

// Why a request was hidden from the feed by the driver's preferences. The
// reasons are counted, not listed per request: the driver learns how many
// were hidden, never anything about a hidden request.
const (
	hiddenDeliveriesOff = "deliveries_off"
	hiddenBelowMinimum  = "below_minimum_trip"
	hiddenPickupTooFar  = "pickup_too_far"
	hiddenStopsOff      = "stops_off"
	hiddenTooManyStops  = "too_many_stops"
	hiddenNotHomeward   = "not_homeward"
)

// preferencesDisclosure is stated on every preferences view.
const preferencesDisclosure = "Preferences filter and sort the requests you see and suggest offers. They never bid for you and never change what you are eligible for."

// Optional is one PATCH field: absent (leave it as it is), null (clear it) or
// a value. Absent and null are different requests, so they hash differently
// for idempotency and replay differently.
type Optional[T any] struct {
	Set   bool
	Null  bool
	Value T
}

// UnmarshalJSON records that the field was sent; unknown keys inside an
// object value are refused, like the top-level body.
func (o *Optional[T]) UnmarshalJSON(raw []byte) error {
	o.Set = true
	if string(bytes.TrimSpace(raw)) == "null" {
		o.Null = true
		return nil
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(&o.Value)
}

// MarshalJSON renders a sent field; an absent one is dropped by `omitzero`.
func (o Optional[T]) MarshalJSON() ([]byte, error) {
	if !o.Set || o.Null {
		return []byte("null"), nil
	}
	return json.Marshal(o.Value)
}

// IsZero makes an absent field disappear under `omitzero`.
func (o Optional[T]) IsZero() bool { return !o.Set }

// HomewardInput is the homeward area as a driver sends it. The coordinates
// are pointers so a missing lat/lng is refused instead of reading as 0,0.
type HomewardInput struct {
	Lat          *float64 `json:"lat"`
	Lng          *float64 `json:"lng"`
	RadiusMeters int      `json:"radiusMeters"`
	Label        string   `json:"label,omitempty"`
}

// PatchDriverPreferencesRequest is the body of PATCH
// /v1/mp/driver/preferences. expectedVersion is the version the driver last
// read (0 when they never saved); every other field is optional, and null
// clears a nullable field.
type PatchDriverPreferencesRequest struct {
	ExpectedVersion         *int                           `json:"expectedVersion"`
	MinimumTripAmountMinor  Optional[Money]                `json:"minimumTripAmountMinor,omitzero"`
	MaxPickupDistanceMeters Optional[int]                  `json:"maxPickupDistanceMeters,omitzero"`
	AcceptsDeliveries       Optional[bool]                 `json:"acceptsDeliveries,omitzero"`
	AcceptsStops            Optional[bool]                 `json:"acceptsStops,omitzero"`
	MaxStops                Optional[int]                  `json:"maxStops,omitzero"`
	Homeward                Optional[HomewardInput]        `json:"homeward,omitzero"`
	HomewardOnly            Optional[bool]                 `json:"homewardOnly,omitzero"`
	AvailabilityWindows     Optional[[]AvailabilityWindow] `json:"availabilityWindows,omitzero"`
}

// IntRangeView is an inclusive server-side bound.
type IntRangeView struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

// PreferenceBoundsView is what the server will accept, so the app can say it
// before the driver types a refused number.
type PreferenceBoundsView struct {
	MinimumTripAmountMaxMinor *Money       `json:"minimumTripAmountMaxMinor"`
	MaxPickupDistanceMeters   IntRangeView `json:"maxPickupDistanceMeters"`
	MaxStopsCeiling           int          `json:"maxStopsCeiling"`
	HomewardRadiusMeters      IntRangeView `json:"homewardRadiusMeters"`
	MaxAvailabilityWindows    int          `json:"maxAvailabilityWindows"`
}

// AvailabilityWindowView is one stored window with its server-phrased label.
type AvailabilityWindowView struct {
	Day         string `json:"day"`
	StartMinute int    `json:"startMinute"`
	EndMinute   int    `json:"endMinute"`
	Label       string `json:"label"`
}

// DriverPreferencesView answers GET/PATCH /v1/mp/driver/preferences
// (MpDriverPreferencesSchema).
type DriverPreferencesView struct {
	DriverID                string                   `json:"driverId"`
	CityID                  string                   `json:"cityId"`
	Version                 int                      `json:"version"`
	Currency                string                   `json:"currency"`
	Timezone                string                   `json:"timezone"`
	MinimumTripAmountMinor  *Money                   `json:"minimumTripAmountMinor"`
	MaxPickupDistanceMeters *int                     `json:"maxPickupDistanceMeters"`
	AcceptsDeliveries       bool                     `json:"acceptsDeliveries"`
	AcceptsStops            bool                     `json:"acceptsStops"`
	MaxStops                *int                     `json:"maxStops"`
	Homeward                *HomewardPreference      `json:"homeward"`
	HomewardOnly            bool                     `json:"homewardOnly"`
	AvailabilityWindows     []AvailabilityWindowView `json:"availabilityWindows"`
	AvailabilityNote        string                   `json:"availabilityNote"`
	Bounds                  PreferenceBoundsView     `json:"bounds"`
	Disclosure              string                   `json:"disclosure"`
	UpdatedAt               *time.Time               `json:"updatedAt"`
}

// FeedPreferencesView tells the driver whether their preferences shaped this
// feed page and how many requests they hid (never which).
type FeedPreferencesView struct {
	Version     int    `json:"version"`
	Applied     bool   `json:"applied"`
	HiddenCount int    `json:"hiddenCount"`
	Note        string `json:"note"`
}

// preferenceBoundsFor derives every bound from the city's policy.
func preferenceBoundsFor(config *cityconfig.CityConfig, policy *cityconfig.MarketplacePolicy) PreferenceBoundsView {
	bounds := PreferenceBoundsView{
		MaxPickupDistanceMeters: IntRangeView{
			Min: minPickupPreferenceMeters,
			Max: policy.SearchEnvelope.MaxRadiusMeters,
		},
		MaxStopsCeiling:        policy.StopsPolicy().MaxIntermediateStops,
		HomewardRadiusMeters:   IntRangeView{Min: minHomewardRadiusMeters, Max: maxHomewardRadiusMeters},
		MaxAvailabilityWindows: maxAvailabilityWindows,
	}
	if bounds.MaxPickupDistanceMeters.Max < bounds.MaxPickupDistanceMeters.Min {
		bounds.MaxPickupDistanceMeters.Min = bounds.MaxPickupDistanceMeters.Max
	}
	// The largest minimum trip fare any of the city's rate-profile bounds
	// allows: a minimum trip AMOUNT above every profile's ceiling could never
	// be met by any profile the city would accept.
	var ceiling int64
	for _, rate := range policy.RateProfileBounds {
		if rate.MaxMinimumTripFareMinor > ceiling {
			ceiling = rate.MaxMinimumTripFareMinor
		}
	}
	if ceiling > 0 {
		ceilingMoney := money(ceiling, config.Currency)
		bounds.MinimumTripAmountMaxMinor = &ceilingMoney
	}
	return bounds
}

// formatClock phrases minutes-from-midnight as HH:MM (24:00 ends a day).
func formatClock(minute int) string {
	return fmt.Sprintf("%02d:%02d", minute/60, minute%60)
}

func availabilityLabel(window AvailabilityWindow) string {
	day := strings.ToUpper(window.Day[:1]) + window.Day[1:]
	return day + " " + formatClock(window.StartMinute) + "–" + formatClock(window.EndMinute)
}

func driverPreferencesViewOf(prefs *DriverPreferences, config *cityconfig.CityConfig, policy *cityconfig.MarketplacePolicy) *DriverPreferencesView {
	view := &DriverPreferencesView{
		DriverID:                prefs.DriverID.String(),
		CityID:                  prefs.CityID,
		Version:                 prefs.Version,
		Currency:                prefs.Currency,
		Timezone:                config.Timezone,
		MaxPickupDistanceMeters: prefs.MaxPickupDistanceM,
		AcceptsDeliveries:       prefs.AcceptsDeliveries,
		AcceptsStops:            prefs.AcceptsStops,
		MaxStops:                prefs.MaxStops,
		Homeward:                prefs.Homeward,
		HomewardOnly:            prefs.HomewardOnly,
		AvailabilityWindows:     make([]AvailabilityWindowView, 0, len(prefs.Availability)),
		AvailabilityNote:        "Used only to filter advance-booking requests in your feed — never your eligibility, never an automatic bid. Windows are in " + config.Timezone + " local time.",
		Bounds:                  preferenceBoundsFor(config, policy),
		Disclosure:              preferencesDisclosure,
	}
	if prefs.MinTripAmountMinor != nil {
		amount := money(*prefs.MinTripAmountMinor, prefs.Currency)
		view.MinimumTripAmountMinor = &amount
	}
	for _, window := range prefs.Availability {
		view.AvailabilityWindows = append(view.AvailabilityWindows, AvailabilityWindowView{
			Day:         window.Day,
			StartMinute: window.StartMinute,
			EndMinute:   window.EndMinute,
			Label:       availabilityLabel(window),
		})
	}
	if prefs.Version > 0 {
		updated := prefs.CreatedAt
		view.UpdatedAt = &updated
	}
	return view
}

// preferencesFieldError phrases one refusal with the field it is about.
func preferencesFieldError(field, format string, args ...any) *domain.Error {
	return domain.Errorf(domain.CodeValidationFailed, format, args...).
		WithDetails(map[string]any{"field": field})
}

// cleanHomewardLabel trims a driver's label; empty becomes a neutral default.
func cleanHomewardLabel(raw string) (string, error) {
	label := strings.TrimSpace(raw)
	if label == "" {
		return "Homeward area", nil
	}
	if !utf8.ValidString(label) || utf8.RuneCountInString(label) > maxHomewardLabelRunes {
		return "", preferencesFieldError("homeward.label",
			"the homeward label must be at most %d characters", maxHomewardLabelRunes)
	}
	for _, r := range label {
		if unicode.IsControl(r) {
			return "", preferencesFieldError("homeward.label", "the homeward label may not contain control characters")
		}
	}
	return label, nil
}

// canonicalWindows validates weekly windows and returns them in canonical
// order (weekday, then start). Overlapping windows on one day are refused
// rather than merged, so the driver sees exactly what they saved.
func canonicalWindows(windows []AvailabilityWindow) ([]AvailabilityWindow, error) {
	if len(windows) > maxAvailabilityWindows {
		return nil, preferencesFieldError("availabilityWindows",
			"at most %d availability windows may be saved", maxAvailabilityWindows)
	}
	out := make([]AvailabilityWindow, 0, len(windows))
	for index, window := range windows {
		field := fmt.Sprintf("availabilityWindows[%d]", index)
		if dayIndex(window.Day) < 0 {
			return nil, preferencesFieldError(field+".day", "%q is not a weekday (mon…sun)", window.Day)
		}
		if window.StartMinute < 0 || window.EndMinute > minutesPerDay || window.StartMinute >= window.EndMinute {
			return nil, preferencesFieldError(field,
				"a window must start before it ends, within one day (0–%d minutes); split an overnight window in two", minutesPerDay)
		}
		out = append(out, window)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Day != out[j].Day {
			return dayIndex(out[i].Day) < dayIndex(out[j].Day)
		}
		return out[i].StartMinute < out[j].StartMinute
	})
	for i := 1; i < len(out); i++ {
		if out[i].Day == out[i-1].Day && out[i].StartMinute < out[i-1].EndMinute {
			return nil, preferencesFieldError("availabilityWindows",
				"the %s windows %s and %s overlap", out[i].Day,
				availabilityLabel(out[i-1]), availabilityLabel(out[i]))
		}
	}
	return out, nil
}

// mergePreferences applies a PATCH to the current preferences and validates
// the RESULT against the city's bounds. A non-nullable field sent as null is
// refused; a field that loses its meaning (maxStops when stops are declined,
// homewardOnly when the homeward area is cleared) is cleared with it.
func mergePreferences(current *DriverPreferences, req PatchDriverPreferencesRequest, config *cityconfig.CityConfig, policy *cityconfig.MarketplacePolicy) (*DriverPreferences, error) {
	bounds := preferenceBoundsFor(config, policy)
	next := *current
	next.Availability = append([]AvailabilityWindow(nil), current.Availability...)
	if current.Homeward != nil {
		homeward := *current.Homeward
		next.Homeward = &homeward
	}
	next.Currency = config.Currency

	notNull := func(field string, sent bool, null bool) error {
		if sent && null {
			return preferencesFieldError(field, "%s cannot be null", field)
		}
		return nil
	}
	for _, check := range []struct {
		field      string
		sent, null bool
	}{
		{"acceptsDeliveries", req.AcceptsDeliveries.Set, req.AcceptsDeliveries.Null},
		{"acceptsStops", req.AcceptsStops.Set, req.AcceptsStops.Null},
		{"homewardOnly", req.HomewardOnly.Set, req.HomewardOnly.Null},
		{"availabilityWindows", req.AvailabilityWindows.Set, req.AvailabilityWindows.Null},
	} {
		if err := notNull(check.field, check.sent, check.null); err != nil {
			return nil, err
		}
	}

	if field := req.MinimumTripAmountMinor; field.Set {
		if field.Null {
			next.MinTripAmountMinor = nil
		} else {
			amount := field.Value
			if amount.Currency != config.Currency {
				return nil, preferencesFieldError("minimumTripAmountMinor",
					"the minimum trip amount must be in %s", config.Currency)
			}
			if bounds.MinimumTripAmountMaxMinor == nil {
				return nil, preferencesFieldError("minimumTripAmountMinor",
					"this market has no rate limits configured, so a minimum trip amount cannot be set")
			}
			if amount.AmountMinor <= 0 || amount.AmountMinor > bounds.MinimumTripAmountMaxMinor.AmountMinor {
				return nil, domain.Errorf(domain.CodeValidationFailed,
					"the minimum trip amount must be between 1 and %d minor units", bounds.MinimumTripAmountMaxMinor.AmountMinor).
					WithDetails(map[string]any{
						"field":          "minimumTripAmountMinor",
						"maximumMinor":   bounds.MinimumTripAmountMaxMinor.AmountMinor,
						"submittedMinor": amount.AmountMinor,
					})
			}
			value := amount.AmountMinor
			next.MinTripAmountMinor = &value
		}
	}

	if field := req.MaxPickupDistanceMeters; field.Set {
		if field.Null {
			next.MaxPickupDistanceM = nil
		} else {
			limits := bounds.MaxPickupDistanceMeters
			if field.Value < limits.Min || field.Value > limits.Max {
				return nil, domain.Errorf(domain.CodeValidationFailed,
					"the maximum pickup distance must be between %d and %d metres (this market's widest search area)", limits.Min, limits.Max).
					WithDetails(map[string]any{
						"field":     "maxPickupDistanceMeters",
						"minimum":   limits.Min,
						"maximum":   limits.Max,
						"submitted": field.Value,
					})
			}
			value := field.Value
			next.MaxPickupDistanceM = &value
		}
	}

	if req.AcceptsDeliveries.Set {
		next.AcceptsDeliveries = req.AcceptsDeliveries.Value
	}
	if req.AcceptsStops.Set {
		next.AcceptsStops = req.AcceptsStops.Value
	}
	if field := req.MaxStops; field.Set {
		if field.Null {
			next.MaxStops = nil
		} else {
			if field.Value < 0 || field.Value > bounds.MaxStopsCeiling {
				return nil, domain.Errorf(domain.CodeValidationFailed,
					"the maximum number of stops must be between 0 and %d (this market's limit)", bounds.MaxStopsCeiling).
					WithDetails(map[string]any{
						"field":     "maxStops",
						"maximum":   bounds.MaxStopsCeiling,
						"submitted": field.Value,
					})
			}
			if req.AcceptsStops.Set && !req.AcceptsStops.Value && field.Value > 0 {
				return nil, preferencesFieldError("maxStops", "a stop limit only applies when you accept stops")
			}
			value := field.Value
			next.MaxStops = &value
		}
	}
	if !next.AcceptsStops {
		next.MaxStops = nil
	}

	if field := req.Homeward; field.Set {
		if field.Null {
			next.Homeward = nil
		} else {
			input := field.Value
			if input.Lat == nil || input.Lng == nil {
				return nil, preferencesFieldError("homeward", "the homeward area needs both lat and lng")
			}
			place := domain.Place{Lat: *input.Lat, Lng: *input.Lng}
			if !place.Valid() {
				return nil, preferencesFieldError("homeward", "the homeward area is not a valid coordinate")
			}
			limits := bounds.HomewardRadiusMeters
			if input.RadiusMeters < limits.Min || input.RadiusMeters > limits.Max {
				return nil, domain.Errorf(domain.CodeValidationFailed,
					"the homeward radius must be between %d and %d metres", limits.Min, limits.Max).
					WithDetails(map[string]any{
						"field":     "homeward.radiusMeters",
						"minimum":   limits.Min,
						"maximum":   limits.Max,
						"submitted": input.RadiusMeters,
					})
			}
			label, err := cleanHomewardLabel(input.Label)
			if err != nil {
				return nil, err
			}
			next.Homeward = &HomewardPreference{
				Lat:          *input.Lat,
				Lng:          *input.Lng,
				RadiusMeters: input.RadiusMeters,
				Label:        label,
			}
		}
	}
	if req.HomewardOnly.Set {
		next.HomewardOnly = req.HomewardOnly.Value
	}
	if next.HomewardOnly && next.Homeward == nil {
		if req.HomewardOnly.Set && req.HomewardOnly.Value {
			return nil, preferencesFieldError("homewardOnly", "homeward-only needs a homeward area")
		}
		next.HomewardOnly = false
	}

	if req.AvailabilityWindows.Set {
		windows, err := canonicalWindows(req.AvailabilityWindows.Value)
		if err != nil {
			return nil, err
		}
		next.Availability = windows
	}
	return &next, nil
}

// preferenceSettings is the comparable content of a preferences row: two rows
// with equal settings are the same preferences, whatever their version.
func preferenceSettings(prefs *DriverPreferences) map[string]any {
	windows := prefs.Availability
	if windows == nil {
		windows = []AvailabilityWindow{}
	}
	return map[string]any{
		"currency":           prefs.Currency,
		"minTripAmountMinor": prefs.MinTripAmountMinor,
		"maxPickupDistanceM": prefs.MaxPickupDistanceM,
		"acceptsDeliveries":  prefs.AcceptsDeliveries,
		"acceptsStops":       prefs.AcceptsStops,
		"maxStops":           prefs.MaxStops,
		"homeward":           prefs.Homeward,
		"homewardOnly":       prefs.HomewardOnly,
		"availability":       windows,
	}
}

func samePreferences(a, b *DriverPreferences) bool {
	left, errLeft := json.Marshal(preferenceSettings(a))
	right, errRight := json.Marshal(preferenceSettings(b))
	return errLeft == nil && errRight == nil && bytes.Equal(left, right)
}

// changedPreferenceFields names what a new version changed — the event says
// WHAT changed, never the homeward coordinates.
func changedPreferenceFields(before, after *DriverPreferences) []string {
	left, right := preferenceSettings(before), preferenceSettings(after)
	changed := []string{}
	for _, key := range []string{
		"minTripAmountMinor", "maxPickupDistanceM", "acceptsDeliveries", "acceptsStops",
		"maxStops", "homeward", "homewardOnly", "availability",
	} {
		l, _ := json.Marshal(left[key])
		r, _ := json.Marshal(right[key])
		if !bytes.Equal(l, r) {
			changed = append(changed, key)
		}
	}
	return changed
}

// auditSettings is the audit row's copy: every setting, with the homeward
// area reduced to whether it is set and its radius. The driver's own return
// location is not an operator's business.
func auditSettings(prefs *DriverPreferences) map[string]any {
	settings := preferenceSettings(prefs)
	if prefs.Homeward != nil {
		settings["homeward"] = map[string]any{"set": true, "radiusMeters": prefs.Homeward.RadiusMeters}
	} else {
		settings["homeward"] = map[string]any{"set": false}
	}
	settings["version"] = prefs.Version
	return settings
}

// requirePreferencesAccess gates both preferences endpoints: a driver, in a
// city, where at least one marketplace vertical is open (the same rule the
// feed applies).
func (s *Service) requirePreferencesAccess(ctx context.Context, actor Actor) error {
	if !actor.IsDriver() {
		return domain.Errorf(domain.CodeForbidden, "only a driver has marketplace preferences")
	}
	if actor.CityID == "" {
		return domain.Errorf(domain.CodeValidationFailed, "the gateway did not say which city this driver is in")
	}
	ridesOn := s.requireFlag(ctx, flagFor(ServiceRide), actor, actor.CityID) == nil
	deliveryOn := s.requireFlag(ctx, flagFor(ServiceDelivery), actor, actor.CityID) == nil
	if !ridesOn && !deliveryOn {
		return domain.Errorf(domain.CodeFeatureDisabled, "this feature is not available here")
	}
	return nil
}

// currentPreferences is the driver's newest saved preferences in the city,
// or the unsaved defaults (version 0).
func (s *Service) currentPreferences(ctx context.Context, db DB, driverID uuid.UUID, cityID, currency string) (*DriverPreferences, error) {
	prefs, err := s.deps.Store.LatestDriverPreferences(ctx, db, driverID, cityID)
	if errors.Is(err, domain.ErrNotFound) {
		return defaultDriverPreferences(driverID, cityID, currency), nil
	}
	if err != nil {
		return nil, err
	}
	return prefs, nil
}

// DriverPreferences answers GET /v1/mp/driver/preferences.
func (s *Service) DriverPreferences(ctx context.Context, actor Actor) (*DriverPreferencesView, error) {
	if err := s.requirePreferencesAccess(ctx, actor); err != nil {
		return nil, err
	}
	config, policy, err := s.policy(ctx, actor.CityID)
	if err != nil {
		return nil, err
	}
	prefs, err := s.currentPreferences(ctx, s.deps.Store.Pool(), actor.UserID, actor.CityID, config.Currency)
	if err != nil {
		return nil, asDomainError(err)
	}
	return driverPreferencesViewOf(prefs, config, policy), nil
}

// PatchDriverPreferences answers PATCH /v1/mp/driver/preferences: idempotent
// (Idempotency-Key, replayed byte-for-byte) and versioned (expectedVersion
// must be the current version; the next version is appended, never updated
// in place). A PATCH that changes nothing writes nothing and answers the
// current version. Saving touches no bid, hold, award or eligibility.
func (s *Service) PatchDriverPreferences(ctx context.Context, actor Actor, req PatchDriverPreferencesRequest, idempotencyKey string) (*DriverPreferencesView, int, error) {
	if err := s.requirePreferencesAccess(ctx, actor); err != nil {
		return nil, 0, err
	}
	if err := ValidateIdempotencyKey(idempotencyKey); err != nil {
		return nil, 0, err
	}
	if req.ExpectedVersion == nil || *req.ExpectedVersion < 0 {
		return nil, 0, preferencesFieldError("expectedVersion",
			"expectedVersion is required: the preferences version you last read (0 if you never saved)")
	}

	if view, status, err := s.storedPreferencesAnswer(ctx, actor, req, idempotencyKey); err != nil || view != nil {
		return view, status, err
	}

	config, policy, err := s.policy(ctx, actor.CityID)
	if err != nil {
		return nil, 0, err
	}
	current, err := s.currentPreferences(ctx, s.deps.Store.Pool(), actor.UserID, actor.CityID, config.Currency)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if *req.ExpectedVersion != current.Version {
		// A retry that raced its own in-flight twin (same key, same body)
		// sees the version the twin just committed; the twin's stored answer
		// is this key's answer, not a conflict.
		if view, status, err := s.storedPreferencesAnswer(ctx, actor, req, idempotencyKey); err != nil || view != nil {
			return view, status, err
		}
		return nil, 0, preferencesVersionConflict(current.Version, *req.ExpectedVersion)
	}
	next, err := mergePreferences(current, req, config, policy)
	if err != nil {
		return nil, 0, err
	}

	if samePreferences(current, next) {
		// Nothing changed (including "saving" the unsaved defaults): no new
		// version, no event. The answer is still stored so the key replays
		// exactly this.
		view := driverPreferencesViewOf(current, config, policy)
		if err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
			return s.deps.Store.SaveIdempotent(ctx, tx, scopePreferencesPatch, actor.UserID, idempotencyKey, req, 200, view)
		}); err != nil {
			return nil, 0, asDomainError(err)
		}
		return view, 200, nil
	}

	now := s.now()
	next.ID = uuid.New()
	next.DriverID = actor.UserID
	next.CityID = actor.CityID
	next.Version = current.Version + 1
	// Stored as the row's created_at at the column's microsecond precision, so
	// the PATCH answer's updatedAt is exactly what a later GET reads back.
	next.CreatedAt = now.UTC().Truncate(time.Microsecond)
	changed := changedPreferenceFields(current, next)

	var view *DriverPreferencesView
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.InsertDriverPreferences(ctx, tx, next); err != nil {
			return err
		}
		fromVersion := current.Version
		if err := writeEvent(ctx, tx, Event{
			Name:           "mp.driver_preferences.saved",
			AggregateType:  subjectDriver,
			AggregateID:    actor.UserID.String(),
			FromVersion:    &fromVersion,
			ToVersion:      next.Version,
			CityID:         next.CityID,
			ActorType:      "driver",
			ActorID:        actor.UserID.String(),
			IdempotencyKey: "mp.driver_preferences.saved:" + next.ID.String(),
			OccurredAt:     now,
			Payload: map[string]any{
				"driverId":    actor.UserID.String(),
				"cityId":      next.CityID,
				"version":     next.Version,
				"changed":     changed,
				"hasHomeward": next.Homeward != nil,
			},
		}); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     actor.UserID.String(),
			ActorRole:   actor.Role,
			Action:      "mp.driver_preferences.saved",
			SubjectType: subjectDriver,
			SubjectID:   actor.UserID.String(),
			Before:      auditSettings(current),
			After:       auditSettings(next),
			Reason:      "driver saved a preferences version",
		}); err != nil {
			return err
		}
		view = driverPreferencesViewOf(next, config, policy)
		return s.deps.Store.SaveIdempotent(ctx, tx, scopePreferencesPatch, actor.UserID, idempotencyKey, req, 200, view)
	})
	if isUniqueViolation(err, "driver_preferences_version_key") {
		// A concurrent PATCH landed this version first. When it was this
		// key's own twin, its committed answer replays; otherwise it is a
		// conflict.
		if view, status, err := s.storedPreferencesAnswer(ctx, actor, req, idempotencyKey); err != nil || view != nil {
			return view, status, err
		}
		latest, latestErr := s.currentPreferences(ctx, s.deps.Store.Pool(), actor.UserID, actor.CityID, config.Currency)
		if latestErr != nil {
			return nil, 0, asDomainError(latestErr)
		}
		return nil, 0, preferencesVersionConflict(latest.Version, *req.ExpectedVersion)
	}
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	return view, 200, nil
}

// storedPreferencesAnswer returns the answer already stored for this key and
// body (nil view when the key is new); the same key with a different body is
// refused as idempotency_key_reuse.
func (s *Service) storedPreferencesAnswer(ctx context.Context, actor Actor, req PatchDriverPreferencesRequest, idempotencyKey string) (*DriverPreferencesView, int, error) {
	replay, err := s.deps.Store.LookupIdempotent(ctx, s.deps.Store.Pool(), scopePreferencesPatch, actor.UserID, idempotencyKey, req)
	if err != nil {
		return nil, 0, asDomainError(err)
	}
	if replay == nil {
		return nil, 0, nil
	}
	var view DriverPreferencesView
	if err := decodeJSON(replay.Response, &view); err != nil {
		return nil, 0, asDomainError(err)
	}
	return &view, replay.StatusCode, nil
}

func preferencesVersionConflict(current, expected int) *domain.Error {
	return domain.Errorf(domain.CodeVersionConflict,
		"your preferences changed since you last read them (now version %d); reload and try again", current).
		WithDetails(map[string]any{"currentVersion": current, "expectedVersion": expected})
}

// coarseCell is the dropoff's ~1 km area cell — the same truncation its area
// label names — so a homeward match never says more than the label does.
func coarseCell(lat, lng float64) (float64, float64) {
	return float64(int(lat*100)) / 100, float64(int(lng*100)) / 100
}

// homewardMatch reports whether a request ends in the driver's homeward area.
func (p *DriverPreferences) homewardMatch(request *Request) bool {
	if p == nil || p.Homeward == nil {
		return false
	}
	lat, lng := coarseCell(request.Dropoff.Lat, request.Dropoff.Lng)
	return geo.HaversineDistance(lat, lng, p.Homeward.Lat, p.Homeward.Lng) <= float64(p.Homeward.RadiusMeters)
}

// hiddenReason says why the driver's preferences hide a request from their
// feed, or "" when it is shown. pickupMeters is the card's coarsened pickup
// distance, so the filter reveals nothing the card would not.
func (p *DriverPreferences) hiddenReason(request *Request, pickupMeters int64) string {
	if p == nil {
		return ""
	}
	switch {
	case request.Service == ServiceDelivery && !p.AcceptsDeliveries:
		return hiddenDeliveriesOff
	case p.MinTripAmountMinor != nil && p.Currency == request.Currency && request.MaxMinor < *p.MinTripAmountMinor:
		return hiddenBelowMinimum
	case p.MaxPickupDistanceM != nil && pickupMeters > int64(*p.MaxPickupDistanceM):
		return hiddenPickupTooFar
	case len(request.Stops) > 0 && !p.AcceptsStops:
		return hiddenStopsOff
	case p.MaxStops != nil && len(request.Stops) > *p.MaxStops:
		return hiddenTooManyStops
	case p.HomewardOnly && !p.homewardMatch(request):
		return hiddenNotHomeward
	}
	return ""
}

// hiddenWords phrases, for the driver view of a request the driver opened
// directly, why their feed would hide it — or "" when it meets them all.
func (p *DriverPreferences) hiddenWords(request *Request, pickupMeters int64, digits int) string {
	switch p.hiddenReason(request, pickupMeters) {
	case hiddenDeliveriesOff:
		return "You chose not to see deliveries."
	case hiddenBelowMinimum:
		return "Your minimum trip amount of " + formatMinor(*p.MinTripAmountMinor, p.Currency, digits) +
			" is above this request's maximum of " + formatMinor(request.MaxMinor, request.Currency, digits) + "."
	case hiddenPickupTooFar:
		return "This pickup is farther than your maximum pickup distance of " + formatKm(float64(*p.MaxPickupDistanceM)) + "."
	case hiddenStopsOff:
		return "This trip has " + stopCountLabel(len(request.Stops)) + "; you chose trips without stops."
	case hiddenTooManyStops:
		return "This trip has " + stopCountLabel(len(request.Stops)) + "; your limit is " + itoa(*p.MaxStops) + "."
	case hiddenNotHomeward:
		return "This trip does not end in your homeward area."
	}
	return ""
}

// availableAt reports whether an instant falls inside the driver's stored
// weekly availability windows (city local time). No windows saved means
// always available: windows only ever narrow what a driver sees (A03 uses
// them for advance-booking cards; they are never eligibility).
func (p *DriverPreferences) availableAt(at time.Time, zone *time.Location) bool {
	if p == nil || len(p.Availability) == 0 {
		return true
	}
	local := at.In(zone)
	day := availabilityDays[(int(local.Weekday())+6)%7]
	minute := local.Hour()*60 + local.Minute()
	for _, window := range p.Availability {
		if window.Day == day && window.StartMinute <= minute && minute < window.EndMinute {
			return true
		}
	}
	return false
}

// preferenceTags are the positive matches a card is labelled (and ranked) by.
func (p *DriverPreferences) preferenceTags(request *Request) []string {
	if p.homewardMatch(request) {
		return []string{PreferenceTagHomeward}
	}
	return nil
}
