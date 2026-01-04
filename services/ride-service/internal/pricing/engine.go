// Package pricing implements the dynamic pricing engine for rides.
package pricing

import (
	"math"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// PricingConfig holds configuration for pricing calculations
type PricingConfig struct {
	// Base fares by ride type (in smallest currency unit, e.g., kobo, cents)
	BaseFares map[domain.RideType]int64

	// Per kilometer rate by ride type
	PerKmRates map[domain.RideType]int64

	// Per minute rate by ride type
	PerMinuteRates map[domain.RideType]int64

	// Minimum fare by ride type
	MinFares map[domain.RideType]int64

	// Booking fee (platform fee)
	BookingFee int64

	// Commission percentage (platform takes)
	CommissionPercent float64

	// Currency for this pricing config
	Currency domain.Currency
}

// SurgeConfig holds surge pricing configuration
type SurgeConfig struct {
	// Minimum drivers in cell before surge kicks in
	MinDriversThreshold int

	// Demand/supply ratio threshold for surge
	DemandSupplyThreshold float64

	// Maximum surge multiplier
	MaxSurgeMultiplier float64

	// Surge increment step
	SurgeStep float64

	// Surge decay rate per minute
	DecayRatePerMinute float64
}

// Engine is the main pricing engine
type Engine struct {
	configs      map[domain.Currency]*PricingConfig
	surgeConfig  *SurgeConfig
	surgeCache   map[string]*SurgeData // H3 cell -> surge data
}

// SurgeData holds surge pricing data for a cell
type SurgeData struct {
	Cell            string
	Multiplier      float64
	ActiveDrivers   int
	PendingRequests int
	LastUpdated     time.Time
}

// NewEngine creates a new pricing engine with default configurations
func NewEngine() *Engine {
	return &Engine{
		configs:     getDefaultConfigs(),
		surgeConfig: getDefaultSurgeConfig(),
		surgeCache:  make(map[string]*SurgeData),
	}
}

// getDefaultConfigs returns default pricing configs for supported currencies
func getDefaultConfigs() map[domain.Currency]*PricingConfig {
	return map[domain.Currency]*PricingConfig{
		domain.CurrencyNGN: {
			BaseFares: map[domain.RideType]int64{
				domain.RideTypeStandard: 30000,   // ₦300
				domain.RideTypePremium:  50000,   // ₦500
				domain.RideTypeXL:       60000,   // ₦600
				domain.RideTypeBoda:     15000,   // ₦150
				domain.RideTypeTricycle: 20000,   // ₦200
			},
			PerKmRates: map[domain.RideType]int64{
				domain.RideTypeStandard: 15000,   // ₦150/km
				domain.RideTypePremium:  25000,   // ₦250/km
				domain.RideTypeXL:       30000,   // ₦300/km
				domain.RideTypeBoda:     8000,    // ₦80/km
				domain.RideTypeTricycle: 10000,   // ₦100/km
			},
			PerMinuteRates: map[domain.RideType]int64{
				domain.RideTypeStandard: 2000,    // ₦20/min
				domain.RideTypePremium:  3500,    // ₦35/min
				domain.RideTypeXL:       4000,    // ₦40/min
				domain.RideTypeBoda:     1000,    // ₦10/min
				domain.RideTypeTricycle: 1500,    // ₦15/min
			},
			MinFares: map[domain.RideType]int64{
				domain.RideTypeStandard: 50000,   // ₦500 minimum
				domain.RideTypePremium:  80000,   // ₦800 minimum
				domain.RideTypeXL:       100000,  // ₦1000 minimum
				domain.RideTypeBoda:     30000,   // ₦300 minimum
				domain.RideTypeTricycle: 35000,   // ₦350 minimum
			},
			BookingFee:        10000, // ₦100
			CommissionPercent: 0.20,  // 20%
			Currency:          domain.CurrencyNGN,
		},
		domain.CurrencyKES: {
			BaseFares: map[domain.RideType]int64{
				domain.RideTypeStandard: 15000,   // KES 150
				domain.RideTypePremium:  25000,   // KES 250
				domain.RideTypeXL:       30000,   // KES 300
				domain.RideTypeBoda:     8000,    // KES 80
				domain.RideTypeTricycle: 10000,   // KES 100
			},
			PerKmRates: map[domain.RideType]int64{
				domain.RideTypeStandard: 4000,    // KES 40/km
				domain.RideTypePremium:  7000,    // KES 70/km
				domain.RideTypeXL:       8500,    // KES 85/km
				domain.RideTypeBoda:     2500,    // KES 25/km
				domain.RideTypeTricycle: 3000,    // KES 30/km
			},
			PerMinuteRates: map[domain.RideType]int64{
				domain.RideTypeStandard: 400,     // KES 4/min
				domain.RideTypePremium:  700,     // KES 7/min
				domain.RideTypeXL:       850,     // KES 8.5/min
				domain.RideTypeBoda:     200,     // KES 2/min
				domain.RideTypeTricycle: 300,     // KES 3/min
			},
			MinFares: map[domain.RideType]int64{
				domain.RideTypeStandard: 20000,   // KES 200 minimum
				domain.RideTypePremium:  35000,   // KES 350 minimum
				domain.RideTypeXL:       45000,   // KES 450 minimum
				domain.RideTypeBoda:     10000,   // KES 100 minimum
				domain.RideTypeTricycle: 15000,   // KES 150 minimum
			},
			BookingFee:        5000,  // KES 50
			CommissionPercent: 0.20,
			Currency:          domain.CurrencyKES,
		},
		domain.CurrencyGHS: {
			BaseFares: map[domain.RideType]int64{
				domain.RideTypeStandard: 500,     // GHS 5
				domain.RideTypePremium:  1000,    // GHS 10
				domain.RideTypeXL:       1200,    // GHS 12
				domain.RideTypeBoda:     250,     // GHS 2.50
				domain.RideTypeTricycle: 350,     // GHS 3.50
			},
			PerKmRates: map[domain.RideType]int64{
				domain.RideTypeStandard: 250,     // GHS 2.50/km
				domain.RideTypePremium:  450,     // GHS 4.50/km
				domain.RideTypeXL:       550,     // GHS 5.50/km
				domain.RideTypeBoda:     150,     // GHS 1.50/km
				domain.RideTypeTricycle: 180,     // GHS 1.80/km
			},
			PerMinuteRates: map[domain.RideType]int64{
				domain.RideTypeStandard: 30,      // GHS 0.30/min
				domain.RideTypePremium:  50,      // GHS 0.50/min
				domain.RideTypeXL:       60,      // GHS 0.60/min
				domain.RideTypeBoda:     15,      // GHS 0.15/min
				domain.RideTypeTricycle: 20,      // GHS 0.20/min
			},
			MinFares: map[domain.RideType]int64{
				domain.RideTypeStandard: 800,     // GHS 8 minimum
				domain.RideTypePremium:  1500,    // GHS 15 minimum
				domain.RideTypeXL:       2000,    // GHS 20 minimum
				domain.RideTypeBoda:     400,     // GHS 4 minimum
				domain.RideTypeTricycle: 500,     // GHS 5 minimum
			},
			BookingFee:        100,   // GHS 1
			CommissionPercent: 0.20,
			Currency:          domain.CurrencyGHS,
		},
	}
}

func getDefaultSurgeConfig() *SurgeConfig {
	return &SurgeConfig{
		MinDriversThreshold:   3,
		DemandSupplyThreshold: 1.5,
		MaxSurgeMultiplier:    3.0,
		SurgeStep:             0.1,
		DecayRatePerMinute:    0.05,
	}
}

// CalculatePrice calculates the price for a ride
func (e *Engine) CalculatePrice(
	rideType domain.RideType,
	distanceM float64,
	durationS int64,
	currency domain.Currency,
	h3Cell string,
	promoDiscount int64,
) (*domain.PriceBreakdown, error) {
	
	config, exists := e.configs[currency]
	if !exists {
		// Default to NGN
		config = e.configs[domain.CurrencyNGN]
		currency = domain.CurrencyNGN
	}
	
	// Get base rates for ride type
	baseFare := config.BaseFares[rideType]
	perKmRate := config.PerKmRates[rideType]
	perMinRate := config.PerMinuteRates[rideType]
	minFare := config.MinFares[rideType]
	
	// Calculate distance and time fares
	distanceKm := distanceM / 1000.0
	durationMin := float64(durationS) / 60.0
	
	distanceFare := int64(distanceKm * float64(perKmRate))
	timeFare := int64(durationMin * float64(perMinRate))
	
	// Get surge multiplier
	surgeMultiplier := e.GetSurgeMultiplier(h3Cell)
	
	// Calculate subtotal before surge
	subtotal := baseFare + distanceFare + timeFare
	
	// Apply surge
	surgeAmount := int64(float64(subtotal) * (surgeMultiplier - 1))
	subtotalWithSurge := subtotal + surgeAmount
	
	// Add booking fee
	totalBeforeDiscount := subtotalWithSurge + config.BookingFee
	
	// Apply promo discount
	total := totalBeforeDiscount - promoDiscount
	if total < 0 {
		total = 0
	}
	
	// Ensure minimum fare
	if total < minFare {
		total = minFare
	}
	
	// Calculate driver earnings and platform fee
	platformFee := int64(float64(total) * config.CommissionPercent)
	driverEarnings := total - platformFee
	
	return &domain.PriceBreakdown{
		BaseFare:        baseFare,
		DistanceFare:    distanceFare,
		TimeFare:        timeFare,
		SurgeMultiplier: surgeMultiplier,
		SurgeAmount:     surgeAmount,
		BookingFee:      config.BookingFee,
		TollFees:        0, // NOTE: Toll fees calculated via routing service integration
		PromoDiscount:   promoDiscount,
		Total:           total,
		Currency:        currency,
		DriverEarnings:  driverEarnings,
		PlatformFee:     platformFee,
	}, nil
}

// GetSurgeMultiplier returns the current surge multiplier for an H3 cell
func (e *Engine) GetSurgeMultiplier(h3Cell string) float64 {
	data, exists := e.surgeCache[h3Cell]
	if !exists {
		return 1.0
	}
	
	// Check if data is stale (> 5 minutes)
	if time.Since(data.LastUpdated) > 5*time.Minute {
		return 1.0
	}
	
	return data.Multiplier
}

// UpdateSurge updates surge pricing data for an H3 cell
func (e *Engine) UpdateSurge(h3Cell string, activeDrivers, pendingRequests int) float64 {
	now := time.Now()
	
	// Calculate demand/supply ratio
	var ratio float64
	if activeDrivers == 0 {
		ratio = float64(pendingRequests) * 2 // High surge when no drivers
	} else {
		ratio = float64(pendingRequests) / float64(activeDrivers)
	}
	
	// Calculate new multiplier
	var multiplier float64 = 1.0
	
	if activeDrivers < e.surgeConfig.MinDriversThreshold {
		// Few drivers - increase surge
		multiplier = 1.0 + float64(e.surgeConfig.MinDriversThreshold-activeDrivers)*e.surgeConfig.SurgeStep
	}
	
	if ratio > e.surgeConfig.DemandSupplyThreshold {
		// High demand - calculate surge
		excessDemand := ratio - e.surgeConfig.DemandSupplyThreshold
		multiplier = math.Max(multiplier, 1.0+excessDemand*0.5)
	}
	
	// Cap at max surge
	if multiplier > e.surgeConfig.MaxSurgeMultiplier {
		multiplier = e.surgeConfig.MaxSurgeMultiplier
	}
	
	// Smooth transition - don't jump too much
	if existing, exists := e.surgeCache[h3Cell]; exists {
		diff := multiplier - existing.Multiplier
		if math.Abs(diff) > 0.3 {
			if diff > 0 {
				multiplier = existing.Multiplier + 0.3
			} else {
				multiplier = existing.Multiplier - 0.3
			}
		}
	}
	
	// Update cache
	e.surgeCache[h3Cell] = &SurgeData{
		Cell:            h3Cell,
		Multiplier:      multiplier,
		ActiveDrivers:   activeDrivers,
		PendingRequests: pendingRequests,
		LastUpdated:     now,
	}
	
	return multiplier
}

// GetPriceEstimate returns price estimates for all ride types
func (e *Engine) GetPriceEstimate(
	distanceM float64,
	durationS int64,
	currency domain.Currency,
	h3Cell string,
) (map[domain.RideType]*domain.PriceBreakdown, error) {
	
	estimates := make(map[domain.RideType]*domain.PriceBreakdown)
	
	rideTypes := []domain.RideType{
		domain.RideTypeStandard,
		domain.RideTypePremium,
		domain.RideTypeXL,
		domain.RideTypeBoda,
		domain.RideTypeTricycle,
	}
	
	for _, rideType := range rideTypes {
		price, err := e.CalculatePrice(rideType, distanceM, durationS, currency, h3Cell, 0)
		if err != nil {
			continue
		}
		estimates[rideType] = price
	}
	
	return estimates, nil
}

// FormatPrice formats a price for display
func FormatPrice(amount int64, currency domain.Currency) string {
	symbols := map[domain.Currency]string{
		domain.CurrencyNGN: "₦",
		domain.CurrencyKES: "KES ",
		domain.CurrencyGHS: "GH₵",
		domain.CurrencyUGX: "UGX ",
		domain.CurrencyTZS: "TZS ",
		domain.CurrencyRWF: "RWF ",
		domain.CurrencyZAR: "R",
		domain.CurrencyUSD: "$",
	}
	
	symbol, exists := symbols[currency]
	if !exists {
		symbol = string(currency) + " "
	}
	
	// Convert from smallest unit (cents/kobo) to main unit
	mainUnit := float64(amount) / 100.0
	
	return symbol + formatNumber(mainUnit)
}

func formatNumber(n float64) string {
	if n >= 1000 {
		return formatWithCommas(int64(n))
	}
	return formatDecimal(n)
}

func formatWithCommas(n int64) string {
	str := ""
	negative := n < 0
	if negative {
		n = -n
	}
	
	for n > 0 {
		if str != "" {
			str = "," + str
		}
		if n >= 1000 {
			str = padLeft(n%1000, 3) + str
		} else {
			str = itoa(n%1000) + str
		}
		n /= 1000
	}
	
	if negative {
		str = "-" + str
	}
	if str == "" {
		str = "0"
	}
	
	return str
}

func formatDecimal(n float64) string {
	return itoa(int64(n*100)/100) + "." + padLeft(int64(n*100)%100, 2)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	
	str := ""
	for n > 0 {
		str = string(rune('0'+n%10)) + str
		n /= 10
	}
	return str
}

func padLeft(n int64, width int) string {
	str := itoa(n)
	for len(str) < width {
		str = "0" + str
	}
	return str
}
