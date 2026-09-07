// Package pricing computes fares from the activated city configuration.
//
// There is deliberately no fare table, no currency and no fee in this file.
// Every number comes from the city config version the caller pins onto the
// quote, because a fare that lives in Go source is a fare nobody approved
// (CLAUDE.md #1, #6).
package pricing

import (
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// Engine prices rides against a city configuration.
type Engine struct{}

// NewEngine builds the pricing engine. It holds no state: the configuration is
// passed in per call, so two cities can never be priced from one cached table.
func NewEngine() *Engine { return &Engine{} }

// Fare prices a route for a vehicle class.
//
// Kilometres and minutes are rounded to whole units with integer arithmetic
// before they touch a rate, so the same route always prices to the same minor
// unit — a quote replayed a second later cannot drift by a kobo.
func (e *Engine) Fare(
	config *cityconfig.CityConfig,
	vehicleClass string,
	distanceMeters, durationSeconds int64,
) (domain.Money, domain.FareBreakdown, error) {
	table, err := config.FareTableFor(vehicleClass)
	if err != nil {
		return domain.Money{}, domain.FareBreakdown{},
			domain.Errorf(domain.CodeValidationFailed, "%s", err.Error())
	}
	if distanceMeters < 0 || durationSeconds < 0 {
		return domain.Money{}, domain.FareBreakdown{},
			domain.Errorf(domain.CodeValidationFailed, "a route cannot have negative distance or duration")
	}

	km := (distanceMeters + 500) / 1000
	minutes := (durationSeconds + 30) / 60

	breakdown := domain.FareBreakdown{
		BaseMinor:       table.BaseMinor,
		DistanceMinor:   km * table.PerKmMinor,
		TimeMinor:       minutes * table.PerMinMinor,
		BookingFeeMinor: table.BookingFeeMinor,
	}
	total := breakdown.BaseMinor + breakdown.DistanceMinor + breakdown.TimeMinor + breakdown.BookingFeeMinor
	if total < table.MinFareMinor {
		breakdown.MinFareTopUpMinor = table.MinFareMinor - total
		total = table.MinFareMinor
	}
	breakdown.TotalMinor = total

	return domain.Money{AmountMinor: total, Currency: config.Currency}, breakdown, nil
}

// WaitFee is what a driver's waiting time at pickup costs the rider under the
// city's wait policy: free for the configured window, then charged per started
// minute, which is how the board words it.
func (e *Engine) WaitFee(config *cityconfig.CityConfig, waited time.Duration) domain.Money {
	free := time.Duration(config.WaitPolicy.FreeSec) * time.Second
	if waited <= free {
		return domain.Money{AmountMinor: 0, Currency: config.Currency}
	}
	billable := waited - free
	minutes := int64(billable / time.Minute)
	if billable%time.Minute > 0 {
		minutes++
	}
	return domain.Money{AmountMinor: minutes * config.WaitPolicy.PerMinMinor, Currency: config.Currency}
}

// CancellationFee is what a cancellation costs, by the role that cancelled.
// A driver cancellation never charges the rider; the amount comes from config
// so that fact is configured rather than asserted in a comment.
func (e *Engine) CancellationFee(config *cityconfig.CityConfig, cancelledByRole string, assigned bool, sinceRequest time.Duration) domain.Money {
	zero := domain.Money{AmountMinor: 0, Currency: config.Currency}
	if cancelledByRole != "rider" {
		return domain.Money{AmountMinor: config.CancelPolicy.DriverFeeMinor, Currency: config.Currency}
	}
	if !assigned {
		return zero
	}
	if sinceRequest <= time.Duration(config.CancelPolicy.FreeWindowSec)*time.Second {
		return zero
	}
	return domain.Money{AmountMinor: config.CancelPolicy.RiderFeeAfterAssignMinor, Currency: config.Currency}
}
