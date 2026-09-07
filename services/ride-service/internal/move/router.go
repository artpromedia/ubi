package move

import (
	"context"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/geo"
)

// Route is the measured shape of a trip. Both fields are server-measured; a
// client never supplies either, because the fare is computed from them.
type Route struct {
	DistanceMeters  int64
	DurationSeconds int64
}

// Router measures a route through pickup, stops and dropoff.
type Router interface {
	Route(ctx context.Context, pickup domain.Place, stops []domain.Place, dropoff domain.Place) (Route, error)
}

// StraightLineRouter is the fallback used when no routing provider is
// configured. It is honest about what it is: great-circle distance between the
// waypoints and the service's urban-speed estimate, which is why a deployment
// with a maps key should wire MapsRouter instead.
type StraightLineRouter struct {
	// Now is injectable so a test can price at a fixed hour of day.
	Now func() time.Time
}

// NewStraightLineRouter builds the fallback router.
func NewStraightLineRouter() *StraightLineRouter {
	return &StraightLineRouter{Now: time.Now}
}

// Route implements Router.
func (r *StraightLineRouter) Route(_ context.Context, pickup domain.Place, stops []domain.Place, dropoff domain.Place) (Route, error) {
	now := time.Now
	if r.Now != nil {
		now = r.Now
	}

	var meters float64
	prev := pickup
	for _, stop := range stops {
		meters += geo.HaversineDistance(prev.Lat, prev.Lng, stop.Lat, stop.Lng)
		prev = stop
	}
	meters += geo.HaversineDistance(prev.Lat, prev.Lng, dropoff.Lat, dropoff.Lng)

	seconds := geo.EstimateETA(meters, "car")
	seconds = geo.EstimateETAWithTraffic(seconds, now().UTC().Hour())
	return Route{DistanceMeters: int64(meters), DurationSeconds: seconds}, nil
}

// DirectionsClient is the slice of geo.MapsClient that routing needs.
type DirectionsClient interface {
	IsConfigured() bool
	GetDirections(ctx context.Context, req geo.DirectionsRequest) (*geo.DirectionsResponse, error)
}

// MapsRouter measures routes with the configured directions provider and falls
// back to straight-line only when the provider cannot answer. The fallback is
// logged by the caller, never silently substituted for a real answer without
// the caller knowing which one it got.
type MapsRouter struct {
	client   DirectionsClient
	fallback Router
}

// NewMapsRouter wires a directions provider with a fallback.
func NewMapsRouter(client DirectionsClient, fallback Router) *MapsRouter {
	return &MapsRouter{client: client, fallback: fallback}
}

// Route implements Router.
func (r *MapsRouter) Route(ctx context.Context, pickup domain.Place, stops []domain.Place, dropoff domain.Place) (Route, error) {
	if r.client == nil || !r.client.IsConfigured() {
		return r.fallback.Route(ctx, pickup, stops, dropoff)
	}

	legs := make([][2]domain.Place, 0, len(stops)+1)
	prev := pickup
	for _, stop := range stops {
		legs = append(legs, [2]domain.Place{prev, stop})
		prev = stop
	}
	legs = append(legs, [2]domain.Place{prev, dropoff})

	var total Route
	for _, leg := range legs {
		response, err := r.client.GetDirections(ctx, geo.DirectionsRequest{
			OriginLat:     leg[0].Lat,
			OriginLng:     leg[0].Lng,
			DestLat:       leg[1].Lat,
			DestLng:       leg[1].Lng,
			DepartureTime: time.Now(),
			Mode:          "driving",
		})
		if err != nil || response == nil || len(response.Routes) == 0 || len(response.Routes[0].Legs) == 0 {
			return r.fallback.Route(ctx, pickup, stops, dropoff)
		}
		measured := response.Routes[0].Legs[0]
		seconds := measured.Duration.Value
		if measured.DurationInTraffic.Value > 0 {
			seconds = measured.DurationInTraffic.Value
		}
		total.DistanceMeters += int64(measured.Distance.Value)
		total.DurationSeconds += int64(seconds)
	}
	return total, nil
}
