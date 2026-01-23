// Package geo provides Google Maps-based route estimation.
package geo

import (
	"context"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/eta"
)

// GoogleMapsRoutingClient implements the eta.RoutingClient interface using Google Maps Directions API
type GoogleMapsRoutingClient struct {
	mapsClient *MapsClient
}

// NewGoogleMapsRoutingClient creates a new routing client
func NewGoogleMapsRoutingClient(mapsClient *MapsClient) *GoogleMapsRoutingClient {
	return &GoogleMapsRoutingClient{
		mapsClient: mapsClient,
	}
}

// GetRoute implements the RoutingClient interface
func (c *GoogleMapsRoutingClient) GetRoute(ctx context.Context, req *eta.ETARequest) (*eta.RouteResponse, error) {
	// Call Google Maps Directions API
	directions, err := c.mapsClient.GetDirections(ctx, DirectionsRequest{
		OriginLat:     req.OriginLat,
		OriginLng:     req.OriginLng,
		DestLat:       req.DestLat,
		DestLng:       req.DestLng,
		DepartureTime: req.DepartureTime,
		Mode:          "driving",
	})
	if err != nil {
		return nil, err
	}

	if len(directions.Routes) == 0 || len(directions.Routes[0].Legs) == 0 {
		// Fall back to simple estimate if no route found
		return c.fallbackEstimate(req), nil
	}

	leg := directions.Routes[0].Legs[0]
	
	// Prefer duration in traffic if available
	durationSeconds := leg.Duration.Value
	if leg.DurationInTraffic.Value > 0 {
		durationSeconds = leg.DurationInTraffic.Value
	}

	// Extract polyline points
	polyline := decodePolyline(directions.Routes[0].OverviewPolyline.Points)

	return &eta.RouteResponse{
		Duration: time.Duration(durationSeconds) * time.Second,
		Distance: float64(leg.Distance.Value),
		Polyline: polyline,
	}, nil
}

// fallbackEstimate provides a basic distance/time estimate when the API fails
func (c *GoogleMapsRoutingClient) fallbackEstimate(req *eta.ETARequest) *eta.RouteResponse {
	// Calculate haversine distance
	distance := HaversineDistance(req.OriginLat, req.OriginLng, req.DestLat, req.DestLng)
	
	// Estimate duration using average urban speed (25 km/h = ~7 m/s)
	// Add 20% buffer for traffic, turns, etc.
	durationSeconds := (distance / 7.0) * 1.2
	
	return &eta.RouteResponse{
		Duration: time.Duration(durationSeconds) * time.Second,
		Distance: distance,
		Polyline: []eta.LatLng{
			{Lat: req.OriginLat, Lng: req.OriginLng},
			{Lat: req.DestLat, Lng: req.DestLng},
		},
	}
}

// decodePolyline decodes a Google polyline encoded string into coordinates
func decodePolyline(encoded string) []eta.LatLng {
	if encoded == "" {
		return nil
	}

	var coords []eta.LatLng
	index := 0
	lat := 0
	lng := 0

	for index < len(encoded) {
		// Decode latitude
		shift := 0
		result := 0
		for {
			b := int(encoded[index]) - 63
			index++
			result |= (b & 0x1f) << shift
			shift += 5
			if b < 0x20 {
				break
			}
		}
		if result&1 != 0 {
			lat += ^(result >> 1)
		} else {
			lat += result >> 1
		}

		// Decode longitude
		shift = 0
		result = 0
		for {
			b := int(encoded[index]) - 63
			index++
			result |= (b & 0x1f) << shift
			shift += 5
			if b < 0x20 {
				break
			}
		}
		if result&1 != 0 {
			lng += ^(result >> 1)
		} else {
			lng += result >> 1
		}

		coords = append(coords, eta.LatLng{
			Lat: float64(lat) / 1e5,
			Lng: float64(lng) / 1e5,
		})
	}

	return coords
}

// IsConfigured returns true if the routing client can make API calls
func (c *GoogleMapsRoutingClient) IsConfigured() bool {
	return c.mapsClient != nil && c.mapsClient.IsConfigured()
}
