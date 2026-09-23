package marketplace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// ---------------------------------------------------------------------------
// Driver preferences (A04.2)
// ---------------------------------------------------------------------------

// HomewardPreference is the driver's own return area: a point, a radius and a
// label of their choosing. It is the DRIVER's data; it never reaches a
// requester, an event payload or an audit row.
type HomewardPreference struct {
	Lat          float64 `json:"lat"`
	Lng          float64 `json:"lng"`
	RadiusMeters int     `json:"radiusMeters"`
	Label        string  `json:"label"`
}

// AvailabilityWindow is one weekly window in the city's local time: day is
// mon..sun, minutes are from local midnight, end exclusive.
type AvailabilityWindow struct {
	Day         string `json:"day"`
	StartMinute int    `json:"startMinute"`
	EndMinute   int    `json:"endMinute"`
}

// DriverPreferences is one versioned, append-only preferences row. Version 0
// is the unsaved default (every filter off) and is never stored.
type DriverPreferences struct {
	ID                 uuid.UUID
	DriverID           uuid.UUID
	CityID             string
	Version            int
	Currency           string
	MinTripAmountMinor *int64
	MaxPickupDistanceM *int
	AcceptsDeliveries  bool
	AcceptsStops       bool
	MaxStops           *int
	Homeward           *HomewardPreference
	HomewardOnly       bool
	Availability       []AvailabilityWindow
	// AcceptsPreferredRequests is the driver's opt-in to being named on a
	// rider's preferred-driver request (A04 item 3). Off by default: nobody
	// can ask for a driver who did not agree to be asked.
	AcceptsPreferredRequests bool
	CreatedAt                time.Time
}

// defaultDriverPreferences is what a driver who never saved anything has:
// nothing filtered, deliveries and stops welcome, no homeward, no windows.
func defaultDriverPreferences(driverID uuid.UUID, cityID, currency string) *DriverPreferences {
	return &DriverPreferences{
		DriverID:          driverID,
		CityID:            cityID,
		Currency:          currency,
		AcceptsDeliveries: true,
		AcceptsStops:      true,
		Availability:      []AvailabilityWindow{},
	}
}

const driverPreferencesColumns = `
	id, driver_id, city_id, version, currency,
	min_trip_amount_minor, max_pickup_distance_m,
	accepts_deliveries, accepts_stops, max_stops,
	homeward, homeward_only, availability, created_at,
	accepts_preferred_requests`

func scanDriverPreferences(row pgx.Row) (*DriverPreferences, error) {
	var prefs DriverPreferences
	var homeward, availability []byte
	err := row.Scan(
		&prefs.ID, &prefs.DriverID, &prefs.CityID, &prefs.Version, &prefs.Currency,
		&prefs.MinTripAmountMinor, &prefs.MaxPickupDistanceM,
		&prefs.AcceptsDeliveries, &prefs.AcceptsStops, &prefs.MaxStops,
		&homeward, &prefs.HomewardOnly, &availability, &prefs.CreatedAt,
		&prefs.AcceptsPreferredRequests,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read driver preferences: %w", err)
	}
	if len(homeward) > 0 && string(homeward) != "null" {
		var area HomewardPreference
		if err := json.Unmarshal(homeward, &area); err != nil {
			return nil, fmt.Errorf("driver preferences %s store an unreadable homeward area: %w", prefs.ID, err)
		}
		prefs.Homeward = &area
	}
	prefs.Availability = []AvailabilityWindow{}
	if len(availability) > 0 {
		if err := json.Unmarshal(availability, &prefs.Availability); err != nil {
			return nil, fmt.Errorf("driver preferences %s store unreadable availability: %w", prefs.ID, err)
		}
	}
	return &prefs, nil
}

// InsertDriverPreferences appends a preferences version. There is no UPDATE
// path; the (driver, city, version) key refuses a second writer of the same
// version, which the caller reports as a version conflict. created_at is the
// caller's CreatedAt (the time its answer states), never the database clock.
func (s *Store) InsertDriverPreferences(ctx context.Context, db DB, prefs *DriverPreferences) error {
	if prefs.CreatedAt.IsZero() {
		return fmt.Errorf("driver preferences %s carry no created time", prefs.ID)
	}
	var homeward []byte
	if prefs.Homeward != nil {
		encoded, err := json.Marshal(prefs.Homeward)
		if err != nil {
			return fmt.Errorf("unserialisable homeward area: %w", err)
		}
		homeward = encoded
	}
	windows := prefs.Availability
	if windows == nil {
		windows = []AvailabilityWindow{}
	}
	availability, err := json.Marshal(windows)
	if err != nil {
		return fmt.Errorf("unserialisable availability: %w", err)
	}
	_, err = db.Exec(ctx, `
		INSERT INTO mp.driver_preferences (
			id, driver_id, city_id, version, currency,
			min_trip_amount_minor, max_pickup_distance_m,
			accepts_deliveries, accepts_stops, max_stops,
			homeward, homeward_only, availability, created_at,
			accepts_preferred_requests
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		prefs.ID, prefs.DriverID, prefs.CityID, prefs.Version, prefs.Currency,
		prefs.MinTripAmountMinor, prefs.MaxPickupDistanceM,
		prefs.AcceptsDeliveries, prefs.AcceptsStops, prefs.MaxStops,
		homeward, prefs.HomewardOnly, availability, prefs.CreatedAt,
		prefs.AcceptsPreferredRequests,
	)
	if err != nil {
		return fmt.Errorf("failed to insert driver preferences: %w", err)
	}
	return nil
}

// LatestDriverPreferences returns the driver's newest preferences in a city,
// or domain.ErrNotFound when they never saved any.
func (s *Store) LatestDriverPreferences(ctx context.Context, db DB, driverID uuid.UUID, cityID string) (*DriverPreferences, error) {
	return scanDriverPreferences(db.QueryRow(ctx, `
		SELECT `+driverPreferencesColumns+` FROM mp.driver_preferences
		WHERE driver_id = $1 AND city_id = $2
		ORDER BY version DESC
		LIMIT 1`, driverID, cityID))
}
