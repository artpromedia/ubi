package marketplace

import "testing"

// TestCommissionWorkedExample is the spec's own example: a ₦5,000.00 fare
// (500,000 minor units at 2 fraction digits) carries a ₦500.00 commission.
func TestCommissionWorkedExample(t *testing.T) {
	if got := CommissionMinor(500_000); got != 50_000 {
		t.Fatalf("commission on 500000 minor: got %d, want 50000", got)
	}
	// The task's phrasing of the same example: 5000_00 -> 500_00.
	if got := CommissionMinor(5_000_00); got != 500_00 {
		t.Fatalf("commission on 5000_00: got %d, want 500_00", got)
	}
}

// TestCommissionHalfUpBoundaries mirrors packages/contracts/tests/marketplace.test.ts:
// half-up rounding at the minor unit, in integer arithmetic.
func TestCommissionHalfUpBoundaries(t *testing.T) {
	cases := []struct {
		fare int64
		want int64
	}{
		{5, 1},  // 0.5 → 1
		{4, 0},  // 0.4 → 0
		{15, 2}, // 1.5 → 2
		{14, 1}, // 1.4 → 1
		{0, 0},
	}
	for _, c := range cases {
		if got := CommissionMinor(c.fare); got != c.want {
			t.Errorf("commission on %d: got %d, want %d", c.fare, got, c.want)
		}
	}
}

// TestCommissionNeverNegative: a negative fare is an upstream bug, and the
// commission function answers 0 rather than a negative fee.
func TestCommissionNeverNegative(t *testing.T) {
	if got := CommissionMinor(-100); got != 0 {
		t.Fatalf("commission on -100: got %d, want 0", got)
	}
}

// TestProfileDistanceFare is the profile formula's arithmetic: fare = perKm ×
// metres / 1000 with half-up rounding at the end — the kilometres are never
// rounded before they touch the rate.
func TestProfileDistanceFare(t *testing.T) {
	// The spec's fractional-km example: 10,500 m at 300.00/km → 3,150.00.
	if got := profileDistanceFare(300_00, 10_500); got != 3_150_00 {
		t.Fatalf("10500m at 300.00/km: got %d, want 315000", got)
	}
	// Half-up at the final minor unit.
	if got := profileDistanceFare(1, 1_500); got != 2 { // 1.5 → 2
		t.Fatalf("1 minor/km over 1500m: got %d, want 2", got)
	}
	if got := profileDistanceFare(1, 1_499); got != 1 { // 1.499 → 1
		t.Fatalf("1 minor/km over 1499m: got %d, want 1", got)
	}
	// The wrong implementation (round km first) would answer 300_00 here.
	if got := profileDistanceFare(300_00, 1_400); got != 420_00 {
		t.Fatalf("1400m at 300.00/km: got %d, want 42000", got)
	}
}

// TestProfileFareMinimumBinds: the minimum trip fare wins short trips.
func TestProfileFareMinimum(t *testing.T) {
	profile := &RateProfile{PerKmMinor: 300_00, MinTripMinor: 1_500_00}
	if got := profileFare(profile, 1_000); got != 1_500_00 { // 300.00 < min
		t.Fatalf("minimum should bind: got %d, want 150000", got)
	}
	if got := profileFare(profile, 10_500); got != 3_150_00 {
		t.Fatalf("distance should win: got %d, want 315000", got)
	}
}
