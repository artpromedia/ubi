// Package cityconfig reads the versioned city configuration and the feature
// flags that slice 01 owns.
//
// Two rules shape everything here:
//
//   - Nothing in this service may carry a fare, a currency, a TTL, a geofence
//     or an emergency number as a Go constant (CLAUDE.md #1, #6). Every such
//     number is read from the activated city config version and pinned onto the
//     ride that used it.
//   - When the configuration cannot be read, the caller is refused
//     (`config_unavailable`) and every flag evaluates to false. There is no
//     path through this package that produces a permissive default from a
//     failure (CLAUDE.md #5, #12).
package cityconfig

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	goredis "github.com/go-redis/redis/v8"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrUnavailable means the activated configuration could not be read. Callers
// must fail closed on it.
var ErrUnavailable = errors.New("city configuration unavailable")

// ErrUnknownCity means the city has no activated configuration version.
var ErrUnknownCity = errors.New("city has no activated configuration")

// FareTable is the per-vehicle-class fare table from the city config.
type FareTable struct {
	BaseMinor       int64 `json:"baseMinor"`
	PerKmMinor      int64 `json:"perKmMinor"`
	PerMinMinor     int64 `json:"perMinMinor"`
	BookingFeeMinor int64 `json:"bookingFeeMinor"`
	MinFareMinor    int64 `json:"minFareMinor"`
}

// WaitPolicy is the waiting-time policy: free for FreeSec, then PerMinMinor.
type WaitPolicy struct {
	FreeSec     int64 `json:"freeSec"`
	PerMinMinor int64 `json:"perMinMinor"`
}

// CancelPolicy is the cancellation policy. A driver cancellation never charges
// the rider; DriverFeeMinor exists so that is a configured fact, not a comment.
type CancelPolicy struct {
	RiderFeeAfterAssignMinor int64 `json:"riderFeeAfterAssignMinor"`
	DriverFeeMinor           int64 `json:"driverFeeMinor"`
	FreeWindowSec            int64 `json:"freeWindowSec"`
}

// PaymentMethod is one payment method and whether this city can use it.
// An unavailable method carries the reason so the client can say why
// (CLAUDE.md #8) instead of hiding it.
type PaymentMethod struct {
	ID        string `json:"id"`
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// MatchingRing is one dispatch ring: how far to look and how many drivers to
// offer in that ring.
type MatchingRing struct {
	RadiusMeters  int `json:"radiusMeters"`
	MaxCandidates int `json:"maxCandidates"`
}

// CityConfig mirrors CityConfigSchema in packages/contracts/src/city-config.ts.
// Only the fields this service is entitled to act on are decoded.
type CityConfig struct {
	CityID                 string               `json:"cityId"`
	Version                int                  `json:"version"`
	Currency               string               `json:"currency"`
	CurrencyFractionDigits int                  `json:"currencyFractionDigits"`
	Locale                 string               `json:"locale"`
	Timezone               string               `json:"timezone"`
	EmergencyNumber        string               `json:"emergencyNumber"`
	VehicleClasses         []string             `json:"vehicleClasses"`
	Fares                  map[string]FareTable `json:"fares"`
	WaitPolicy             WaitPolicy           `json:"waitPolicy"`
	CancelPolicy           CancelPolicy         `json:"cancelPolicy"`
	PinRequired            bool                 `json:"pinRequired"`
	QuoteTTLSec            int                  `json:"quoteTtlSec"`
	OfferTTLSec            int                  `json:"offerTtlSec"`
	MatchingRings          []MatchingRing       `json:"matchingRings"`
	ArrivedGeofenceMeters  int                  `json:"arrivedGeofenceMeters"`
	MaxPinAttempts         int                  `json:"maxPinAttempts"`
	PaymentMethods         []PaymentMethod      `json:"paymentMethods"`
	ServiceFeePct          float64              `json:"serviceFeePct"`
}

// Validate refuses a configuration that would make this service invent a
// number. Everything checked here is something slice 02 reads.
func (c *CityConfig) Validate() error {
	switch {
	case c.CityID == "":
		return fmt.Errorf("%w: config has no cityId", ErrUnavailable)
	case c.Version <= 0:
		return fmt.Errorf("%w: config has no version", ErrUnavailable)
	case c.Currency == "":
		return fmt.Errorf("%w: city %s has no currency", ErrUnavailable, c.CityID)
	case c.CurrencyFractionDigits < 0 || c.CurrencyFractionDigits > 4:
		return fmt.Errorf("%w: city %s has an impossible currency exponent", ErrUnavailable, c.CityID)
	case len(c.Fares) == 0:
		return fmt.Errorf("%w: city %s has no fare tables", ErrUnavailable, c.CityID)
	case c.QuoteTTLSec <= 0:
		return fmt.Errorf("%w: city %s has no quote TTL", ErrUnavailable, c.CityID)
	case c.OfferTTLSec <= 0:
		return fmt.Errorf("%w: city %s has no offer TTL", ErrUnavailable, c.CityID)
	case len(c.MatchingRings) == 0:
		return fmt.Errorf("%w: city %s has no matching rings", ErrUnavailable, c.CityID)
	case c.ArrivedGeofenceMeters <= 0:
		return fmt.Errorf("%w: city %s has no arrival geofence", ErrUnavailable, c.CityID)
	case c.MaxPinAttempts <= 0:
		return fmt.Errorf("%w: city %s has no PIN attempt limit", ErrUnavailable, c.CityID)
	case len(c.PaymentMethods) == 0:
		return fmt.Errorf("%w: city %s has no payment methods", ErrUnavailable, c.CityID)
	}
	return nil
}

// FareTableFor returns the fare table for a vehicle class, or an error. There
// is no default class: a class the city did not price cannot be sold.
func (c *CityConfig) FareTableFor(vehicleClass string) (FareTable, error) {
	table, ok := c.Fares[vehicleClass]
	if !ok {
		return FareTable{}, fmt.Errorf("city %s v%d has no fare table for vehicle class %q",
			c.CityID, c.Version, vehicleClass)
	}
	return table, nil
}

// SupportsVehicleClass reports whether the city offers this class.
func (c *CityConfig) SupportsVehicleClass(vehicleClass string) bool {
	for _, class := range c.VehicleClasses {
		if class == vehicleClass {
			return true
		}
	}
	return false
}

// PaymentMethodAvailable reports whether a payment method may be used here.
func (c *CityConfig) PaymentMethodAvailable(id string) (bool, string) {
	for _, method := range c.PaymentMethods {
		if method.ID == id {
			return method.Available, method.Reason
		}
	}
	return false, "not offered in this city"
}

// QuoteTTL is the signed quote lifetime.
func (c *CityConfig) QuoteTTL() time.Duration {
	return time.Duration(c.QuoteTTLSec) * time.Second
}

// OfferTTL is how long a driver has to answer an offer.
func (c *CityConfig) OfferTTL() time.Duration {
	return time.Duration(c.OfferTTLSec) * time.Second
}

// Provider reads the activated configuration for a city.
type Provider interface {
	Config(ctx context.Context, cityID string) (*CityConfig, error)
}

// Store loads the activated configuration from Postgres and caches it in
// Redis. Postgres is the source of truth; Redis only shortens the path.
type Store struct {
	pool  *pgxpool.Pool
	redis *goredis.Client
	ttl   time.Duration
}

// NewStore builds a provider. `redis` may be nil, in which case every read
// goes to Postgres.
func NewStore(pool *pgxpool.Pool, redis *goredis.Client, ttl time.Duration) *Store {
	if ttl <= 0 {
		ttl = 60 * time.Second
	}
	return &Store{pool: pool, redis: redis, ttl: ttl}
}

func cacheKey(cityID string) string { return "ride:cityconfig:" + cityID }

// Config returns the activated configuration for a city. On any failure it
// returns an error wrapping ErrUnavailable; it never returns a fallback.
func (s *Store) Config(ctx context.Context, cityID string) (*CityConfig, error) {
	if cityID == "" {
		return nil, fmt.Errorf("%w: no city supplied", ErrUnavailable)
	}
	if s.redis != nil {
		raw, err := s.redis.Get(ctx, cacheKey(cityID)).Bytes()
		if err == nil {
			var cached CityConfig
			if json.Unmarshal(raw, &cached) == nil && cached.Validate() == nil {
				return &cached, nil
			}
		}
	}
	if s.pool == nil {
		return nil, fmt.Errorf("%w: no configuration source is wired", ErrUnavailable)
	}

	const query = `
		SELECT config
		FROM public.city_config_versions
		WHERE city_id = $1 AND activated_at IS NOT NULL
		ORDER BY version DESC
		LIMIT 1`

	var raw []byte
	if err := s.pool.QueryRow(ctx, query, cityID).Scan(&raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: %s", ErrUnknownCity, cityID)
		}
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}

	var config CityConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		return nil, fmt.Errorf("%w: city %s stores an unreadable config: %v", ErrUnavailable, cityID, err)
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	if s.redis != nil {
		if encoded, err := json.Marshal(config); err == nil {
			// A cache write failure is not a reason to refuse a good read.
			_ = s.redis.Set(ctx, cacheKey(cityID), encoded, s.ttl).Err()
		}
	}
	return &config, nil
}

// Invalidate drops the cached configuration for a city, for use when a
// config.version_activated event arrives.
func (s *Store) Invalidate(ctx context.Context, cityID string) error {
	if s.redis == nil {
		return nil
	}
	return s.redis.Del(ctx, cacheKey(cityID)).Err()
}
