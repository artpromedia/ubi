package marketplace

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
)

// Stop purposes (contract MP_STOP_PURPOSES). A purpose tells the awarded
// driver what the stop is for; it never changes the price — dwell does.
const (
	StopPurposePickupPassenger = "pickup_passenger"
	StopPurposeDropPassenger   = "drop_passenger"
	StopPurposeErrand          = "errand"
	StopPurposeOther           = "other"
)

// maxStopLabelRunes bounds a requester-written stop label. Plumbing, not
// policy: it only keeps a label a label.
const maxStopLabelRunes = 80

func validStopPurpose(purpose string) bool {
	switch purpose {
	case StopPurposePickupPassenger, StopPurposeDropPassenger, StopPurposeErrand, StopPurposeOther:
		return true
	}
	return false
}

// StopInput is one intermediate stop as a requester asks for it
// (MpStopInputSchema). What is absent is the point: no stop id, no order and
// no price — the server assigns the id, the list position is the order, and
// the whole ordered route is priced server-side.
type StopInput struct {
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	Label    string  `json:"label,omitempty"`
	Purpose  string  `json:"purpose,omitempty"`
	DwellSec *int    `json:"dwellSec,omitempty"`
}

// RouteStop is one ordered intermediate stop as a quote and a request store
// it (MpRouteStopSchema). StopID is server-assigned and stable from the quote
// through the request (and any route revision that keeps the stop) to the
// execution ride; Order is its 1-based position between pickup and dropoff.
type RouteStop struct {
	StopID   uuid.UUID `json:"stopId"`
	Order    int       `json:"order"`
	Label    string    `json:"label"`
	Lat      float64   `json:"lat"`
	Lng      float64   `json:"lng"`
	Purpose  string    `json:"purpose"`
	DwellSec int       `json:"dwellSec"`
}

// stopsFieldError phrases one stop validation failure as the structured field
// error every surface renders.
func stopsFieldError(field, format string, args ...any) *domain.Error {
	return domain.Errorf(domain.CodeValidationFailed, format, args...).
		WithDetails(map[string]any{"field": field})
}

// samePoint reports whether two coordinates name the same place within the
// route tolerance the replacement-quote check already uses.
func samePoint(aLat, aLng, bLat, bLng float64) bool {
	return geo.HaversineDistance(aLat, aLng, bLat, bLng) <= freshQuoteRouteToleranceMeters
}

// cleanStopLabel trims a requester label and refuses anything that is not a
// short, printable line. An empty label becomes the coarse area label.
func cleanStopLabel(raw string, index int, lat, lng float64) (string, error) {
	label := strings.TrimSpace(raw)
	if label == "" {
		return areaLabelOf(lat, lng), nil
	}
	if !utf8.ValidString(label) || utf8.RuneCountInString(label) > maxStopLabelRunes {
		return "", stopsFieldError(fmt.Sprintf("stops[%d].label", index),
			"stop %d's label must be at most %d characters", index+1, maxStopLabelRunes)
	}
	for _, r := range label {
		if unicode.IsControl(r) {
			return "", stopsFieldError(fmt.Sprintf("stops[%d].label", index),
				"stop %d's label may not contain control characters", index+1)
		}
	}
	return label, nil
}

// buildRouteStops validates a requester's intermediate stops against the
// market's limits and returns the ordered route with server-assigned ids.
// It refuses: more stops than the market allows; a coordinate that is not on
// Earth; a dwell outside [0, maxDwellSec]; an unknown purpose; a stop that
// repeats another stop; and a first/last stop identical to the pickup/dropoff
// it sits next to (a zero-length leg is not a stop).
func buildRouteStops(pickup, dropoff domain.Place, inputs []StopInput, policy cityconfig.MarketplaceStopsPolicy) ([]RouteStop, error) {
	if len(inputs) == 0 {
		return nil, nil
	}
	if len(inputs) > policy.MaxIntermediateStops {
		return nil, domain.Errorf(domain.CodeValidationFailed,
			"this market allows at most %d intermediate stops; you asked for %d",
			policy.MaxIntermediateStops, len(inputs)).
			WithDetails(map[string]any{
				"field":   "stops",
				"maximum": policy.MaxIntermediateStops,
				"count":   len(inputs),
			})
	}
	stops := make([]RouteStop, 0, len(inputs))
	for i, input := range inputs {
		place := domain.Place{Lat: input.Lat, Lng: input.Lng}
		if !place.Valid() {
			return nil, stopsFieldError(fmt.Sprintf("stops[%d]", i), "stop %d is not a valid coordinate", i+1)
		}
		purpose := input.Purpose
		if purpose == "" {
			purpose = StopPurposeOther
		}
		if !validStopPurpose(purpose) {
			return nil, stopsFieldError(fmt.Sprintf("stops[%d].purpose", i),
				"%q is not a stop purpose", input.Purpose)
		}
		dwell := policy.DefaultDwellSec
		if input.DwellSec != nil {
			dwell = *input.DwellSec
		}
		if dwell < 0 || dwell > policy.MaxDwellSec {
			return nil, domain.Errorf(domain.CodeValidationFailed,
				"stop %d's expected wait must be between 0 and %d seconds", i+1, policy.MaxDwellSec).
				WithDetails(map[string]any{
					"field":        fmt.Sprintf("stops[%d].dwellSec", i),
					"maximumSec":   policy.MaxDwellSec,
					"requestedSec": dwell,
				})
		}
		label, err := cleanStopLabel(input.Label, i, input.Lat, input.Lng)
		if err != nil {
			return nil, err
		}
		for j, earlier := range stops {
			if samePoint(earlier.Lat, earlier.Lng, input.Lat, input.Lng) {
				return nil, stopsFieldError(fmt.Sprintf("stops[%d]", i),
					"stop %d repeats stop %d; each stop must be a distinct place", i+1, j+1)
			}
		}
		if i == 0 && samePoint(pickup.Lat, pickup.Lng, input.Lat, input.Lng) {
			return nil, stopsFieldError("stops[0]", "the first stop is the pickup itself")
		}
		if i == len(inputs)-1 && samePoint(dropoff.Lat, dropoff.Lng, input.Lat, input.Lng) {
			return nil, stopsFieldError(fmt.Sprintf("stops[%d]", i), "the last stop is the dropoff itself")
		}
		stops = append(stops, RouteStop{
			StopID:   uuid.New(),
			Order:    i + 1,
			Label:    label,
			Lat:      input.Lat,
			Lng:      input.Lng,
			Purpose:  purpose,
			DwellSec: dwell,
		})
	}
	return stops, nil
}

// stopPlaces is the ordered waypoint list the shared Router measures.
func stopPlaces(stops []RouteStop) []domain.Place {
	if len(stops) == 0 {
		return nil
	}
	places := make([]domain.Place, 0, len(stops))
	for _, stop := range stops {
		places = append(places, domain.Place{Lat: stop.Lat, Lng: stop.Lng})
	}
	return places
}

// totalDwellSec is the expected dwell a route prices as time.
func totalDwellSec(stops []RouteStop) int64 {
	var total int64
	for _, stop := range stops {
		total += int64(stop.DwellSec)
	}
	return total
}

// routeFingerprint names an exact priced route: both endpoints and the
// ordered stop set (coordinate, purpose, dwell). Labels are words, not route,
// and are excluded. A request carries the fingerprint of the route its bounds
// were priced for, so no bid, selection or execution can be of another.
func routeFingerprint(pickup Area, stops []RouteStop, dropoff Area) string {
	var builder strings.Builder
	builder.WriteString("mp.route.v1|")
	fmt.Fprintf(&builder, "%.6f,%.6f", pickup.Lat, pickup.Lng)
	for _, stop := range stops {
		fmt.Fprintf(&builder, "|%.6f,%.6f,%s,%d", stop.Lat, stop.Lng, stop.Purpose, stop.DwellSec)
	}
	fmt.Fprintf(&builder, "|%.6f,%.6f", dropoff.Lat, dropoff.Lng)
	return "rt_" + digest(builder.String())
}

// sameStopSet reports whether two ordered stop lists describe the same work:
// same count, and pairwise the same place (within tolerance), purpose and
// dwell. Anything else is a MATERIAL route change.
func sameStopSet(a, b []RouteStop) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !samePoint(a[i].Lat, a[i].Lng, b[i].Lat, b[i].Lng) ||
			a[i].Purpose != b[i].Purpose || a[i].DwellSec != b[i].DwellSec {
			return false
		}
	}
	return true
}

// carryStopIDs adopts a route revision's stops while keeping the stable id of
// every stop that survives it (same place and purpose, matched once each), so
// a stop keeps its identity across pre-award edits and a new stop gets a new
// one. Order always comes from the new list.
func carryStopIDs(current, next []RouteStop) []RouteStop {
	if len(next) == 0 {
		return nil
	}
	used := make([]bool, len(current))
	adopted := make([]RouteStop, 0, len(next))
	for i, stop := range next {
		stop.Order = i + 1
		for j, existing := range current {
			if used[j] || existing.Purpose != stop.Purpose ||
				!samePoint(existing.Lat, existing.Lng, stop.Lat, stop.Lng) {
				continue
			}
			used[j] = true
			stop.StopID = existing.StopID
			break
		}
		adopted = append(adopted, stop)
	}
	return adopted
}

// executionStops is the ordered stop list the execution ride's quote carries:
// the same ids, order, purpose and dwell the award was made against, with the
// requester's label as the address the awarded driver may now see.
func executionStops(stops []RouteStop) []domain.Stop {
	if len(stops) == 0 {
		return nil
	}
	out := make([]domain.Stop, 0, len(stops))
	for _, stop := range stops {
		out = append(out, domain.Stop{
			Lat:      stop.Lat,
			Lng:      stop.Lng,
			Address:  stop.Label,
			StopID:   stop.StopID.String(),
			Order:    stop.Order,
			Purpose:  stop.Purpose,
			DwellSec: stop.DwellSec,
		})
	}
	return out
}

// encodeStops serialises a stop list for a jsonb column; nil is '[]'.
func encodeStops(stops []RouteStop) ([]byte, error) {
	if len(stops) == 0 {
		return []byte("[]"), nil
	}
	encoded, err := json.Marshal(stops)
	if err != nil {
		return nil, fmt.Errorf("unserialisable stops: %w", err)
	}
	return encoded, nil
}

// decodeStops reads a jsonb stop list; '[]' (or nothing) is no stops.
func decodeStops(raw []byte) ([]RouteStop, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var stops []RouteStop
	if err := json.Unmarshal(raw, &stops); err != nil {
		return nil, err
	}
	if len(stops) == 0 {
		return nil, nil
	}
	return stops, nil
}

// hasRoute reports whether a request carries (or carried, before a revision
// removed them) intermediate stops — the only requests whose views expose the
// route fields. A plain pickup → dropoff request renders exactly as before.
func (r *Request) hasRoute() bool {
	return len(r.Stops) > 0 || r.RouteRevision > 1
}

// routeSnapshot is the route half of a revision snapshot, or nil for a plain
// route: the timeline can then show exactly which stops each revision (and so
// each bid pinned to it) was priced against.
func routeSnapshot(request *Request) map[string]any {
	if !request.hasRoute() {
		return nil
	}
	stops := request.Stops
	if stops == nil {
		stops = []RouteStop{}
	}
	return map[string]any{
		"routeRevision":        request.RouteRevision,
		"routeFingerprint":     request.RouteFingerprint,
		"stops":                stops,
		"routedDistanceMeters": request.RoutedDistanceM,
		"routedDurationSec":    request.RoutedDurationSec,
		"stopsDwellSec":        request.StopsDwellSec,
	}
}

// FeedStopView is one stop as a driver may see it BEFORE an award
// (MpFeedStopSchema): coarsened exactly like the pickup/dropoff area labels —
// never a coordinate, never the requester's own words.
type FeedStopView struct {
	Order     int    `json:"order"`
	AreaLabel string `json:"areaLabel"`
	Purpose   string `json:"purpose"`
	DwellSec  int    `json:"dwellSec"`
}

// FeedRouteView is the multi-stop summary a driver card carries
// (MpFeedRouteSchema): the stop count, the coarse stops, and the complete
// ordered route's server-measured distance, duration and expected dwell.
type FeedRouteView struct {
	StopCount            int            `json:"stopCount"`
	Stops                []FeedStopView `json:"stops"`
	RoutedDistanceMeters int64          `json:"routedDistanceMeters"`
	RoutedDurationSec    int64          `json:"routedDurationSec"`
	StopsDwellSec        int64          `json:"stopsDwellSec"`
}

// feedRouteOf renders the driver-safe route summary, or nil for a request
// without stops (whose card is unchanged).
func feedRouteOf(request *Request) *FeedRouteView {
	if len(request.Stops) == 0 {
		return nil
	}
	stops := make([]FeedStopView, 0, len(request.Stops))
	for _, stop := range request.Stops {
		stops = append(stops, FeedStopView{
			Order:     stop.Order,
			AreaLabel: areaLabelOf(stop.Lat, stop.Lng),
			Purpose:   stop.Purpose,
			DwellSec:  stop.DwellSec,
		})
	}
	return &FeedRouteView{
		StopCount:            len(request.Stops),
		Stops:                stops,
		RoutedDistanceMeters: request.RoutedDistanceM,
		RoutedDurationSec:    request.RoutedDurationSec,
		StopsDwellSec:        request.StopsDwellSec,
	}
}

// stopCountLabel phrases the stop count for a card's meta line.
func stopCountLabel(count int) string {
	if count == 1 {
		return "1 stop"
	}
	return itoa(count) + " stops"
}

// requireStopsAllowed is the single gate every entry point that creates or
// changes a stop route passes: deliveries are single-drop (multi-drop needs
// per-package custody and recipient proof, which ride stops do not give), and
// the capability is behind the deny-by-default marketplace_multi_stop flag.
func (s *Service) requireStopsAllowed(ctx context.Context, service string, actor Actor, cityID string) error {
	if service == ServiceDelivery {
		return domain.Errorf(domain.CodeValidationFailed,
			"a delivery has exactly one drop-off; intermediate stops are only available for rides").
			WithDetails(map[string]any{"field": "stops", "service": service})
	}
	if err := s.requireFlag(ctx, cityconfig.FlagMarketplaceMultiStop, actor, cityID); err != nil {
		return domain.Errorf(domain.CodeFeatureDisabled, "multiple stops are not available here").
			WithDetails(map[string]any{"field": "stops", "feature": cityconfig.FlagMarketplaceMultiStop})
	}
	return nil
}
