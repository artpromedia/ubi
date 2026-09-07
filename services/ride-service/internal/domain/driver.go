package domain

import (
	"time"

	"github.com/google/uuid"
)

// DriverSession is a driver in a state of the driver machine from
// contracts/state-machines.json, plus the last location the server accepted
// from them. The server decides what a driver's state is; the app reports.
type DriverSession struct {
	DriverID       uuid.UUID      `json:"driverId"`
	CityID         string         `json:"cityId"`
	State          string         `json:"state"`
	Version        int            `json:"version"`
	VehicleClasses []string       `json:"vehicleClasses"`
	Filters        map[string]any `json:"filters"`
	CurrentRideID  *uuid.UUID     `json:"currentRideId,omitempty"`
	LastSeq        int64          `json:"lastSeq"`
	LastLat        *float64       `json:"lastLat,omitempty"`
	LastLng        *float64       `json:"lastLng,omitempty"`
	LastAccuracyM  *float64       `json:"lastAccuracyMeters,omitempty"`
	LastLocationAt *time.Time     `json:"lastLocationAt,omitempty"`
	OnlineSince    *time.Time     `json:"onlineSince,omitempty"`
}

// HasLocation reports whether the session carries a usable point.
func (s *DriverSession) HasLocation() bool {
	return s.LastLat != nil && s.LastLng != nil && s.LastLocationAt != nil
}

// Offers reports whether the driver offers a vehicle class. An empty filter
// list means the driver takes every class the city sells.
func (s *DriverSession) Offers(vehicleClass string) bool {
	if len(s.VehicleClasses) == 0 {
		return true
	}
	for _, class := range s.VehicleClasses {
		if class == vehicleClass {
			return true
		}
	}
	return false
}

// LocationPoint is one point in a batch reported by a driver app. `Seq` is the
// app's monotonic counter for the session: it is what lets the server drop a
// replayed or out-of-order batch without guessing from timestamps alone.
type LocationPoint struct {
	Seq        int64     `json:"seq"`
	Lat        float64   `json:"lat"`
	Lng        float64   `json:"lng"`
	AccuracyM  float64   `json:"accuracyMeters"`
	Heading    float64   `json:"heading,omitempty"`
	SpeedMps   float64   `json:"speedMetersPerSecond,omitempty"`
	RecordedAt time.Time `json:"recordedAt"`
}

// Location rejection reasons. A rejected point is reported back to the app with
// the reason, rather than dropped in silence (CLAUDE.md #8).
const (
	LocationRejectedStaleSeq    = "stale_seq"
	LocationRejectedStaleTime   = "stale_timestamp"
	LocationRejectedFutureTime  = "future_timestamp"
	LocationRejectedAccuracy    = "accuracy_too_low"
	LocationRejectedCoordinates = "invalid_coordinates"
	LocationRejectedSpeed       = "implausible_speed"
)

// LocationOutcome is the server's verdict on one reported point.
type LocationOutcome struct {
	Seq      int64  `json:"seq"`
	Accepted bool   `json:"accepted"`
	Reason   string `json:"reason,omitempty"`
}
