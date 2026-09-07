package cityconfig

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Flag keys this service gates on. A key that is not registered has no default
// and therefore evaluates to false.
const (
	FlagMove         = "move"
	FlagRideRequest  = "ride_request"
	FlagDriverOnline = "driver_online"
)

// Flags evaluates feature flags for a city and user, deny by default.
//
// Resolution order, first match wins: a rule for this city, then a global
// rule, then the flag's registered default. This is the same order as
// services/config-service/src/services/flags.service.ts; the two must agree
// because the apps render from one and the server enforces the other.
type Flags struct {
	pool *pgxpool.Pool
}

// NewFlags builds a flag evaluator.
func NewFlags(pool *pgxpool.Pool) *Flags {
	return &Flags{pool: pool}
}

type flagRule struct {
	cityScoped bool
	enabled    bool
	segment    []byte
}

// Enabled reports whether a flag is on for this city and user.
//
// Every failure path returns false: an unreachable database, an unregistered
// key, or a segment this service cannot parse. A feature never opens because
// something broke.
func (f *Flags) Enabled(ctx context.Context, key, cityID, userID string) (bool, error) {
	if f == nil || f.pool == nil {
		return false, fmt.Errorf("%w: no flag source is wired", ErrUnavailable)
	}

	var defaultOn bool
	err := f.pool.QueryRow(ctx,
		`SELECT default_on FROM public.feature_flags WHERE key = $1`, key).Scan(&defaultOn)
	if err != nil {
		// Includes pgx.ErrNoRows: an unregistered flag is off.
		return false, nil
	}

	rows, err := f.pool.Query(ctx, `
		SELECT city_id IS NOT NULL AS city_scoped, enabled, segment
		FROM public.flag_rules
		WHERE flag_key = $1 AND (city_id = $2 OR city_id IS NULL)`, key, cityID)
	if err != nil {
		return false, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer rows.Close()

	var cityRules, globalRules []flagRule
	for rows.Next() {
		var rule flagRule
		if err := rows.Scan(&rule.cityScoped, &rule.enabled, &rule.segment); err != nil {
			return false, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		if rule.cityScoped {
			cityRules = append(cityRules, rule)
		} else {
			globalRules = append(globalRules, rule)
		}
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}

	for _, rule := range cityRules {
		if segmentMatches(rule.segment, userID) {
			return rule.enabled, nil
		}
	}
	for _, rule := range globalRules {
		if segmentMatches(rule.segment, userID) {
			return rule.enabled, nil
		}
	}
	return defaultOn, nil
}

// segmentMatches implements the one segment shape the platform defines:
// {"userIds": [...]}. Anything else is treated as "does not match" — an
// unreadable segment must not open a feature.
func segmentMatches(segment []byte, userID string) bool {
	if len(segment) == 0 || string(segment) == "null" {
		return true
	}
	var parsed struct {
		UserIDs []string `json:"userIds"`
	}
	if err := json.Unmarshal(segment, &parsed); err != nil || len(parsed.UserIDs) == 0 {
		return false
	}
	if userID == "" {
		return false
	}
	for _, candidate := range parsed.UserIDs {
		if candidate == userID {
			return true
		}
	}
	return false
}
