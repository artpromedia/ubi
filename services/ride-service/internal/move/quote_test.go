package move_test

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
)

const secret = "a-secret-that-is-at-least-32-bytes-long"

func newSigner(t *testing.T) *move.QuoteSigner {
	t.Helper()
	signer, err := move.NewQuoteSigner(secret)
	if err != nil {
		t.Fatalf("failed to build the signer: %v", err)
	}
	return signer
}

func TestSignerRefusesAWeakSecret(t *testing.T) {
	if _, err := move.NewQuoteSigner("short"); err == nil {
		t.Fatal("a short signing secret must be refused: an unsigned quote is a fare a client can edit")
	}
}

func TestSignatureRoundTrips(t *testing.T) {
	signer := newSigner(t)
	id := uuid.New()
	expiry := time.Now().Add(5 * time.Minute).Truncate(time.Second)

	signature := signer.Sign(id, 250_000, "NGN", expiry, 7)
	if !signer.Verify(signature, id, 250_000, "NGN", expiry, 7) {
		t.Fatal("a signature the server produced must verify")
	}
}

// TestTamperingIsRejected is the point of signing a quote: every field a client
// might want to move is covered, so moving any of them invalidates the whole.
func TestTamperingIsRejected(t *testing.T) {
	signer := newSigner(t)
	id := uuid.New()
	expiry := time.Now().Add(5 * time.Minute).Truncate(time.Second)
	signature := signer.Sign(id, 250_000, "NGN", expiry, 7)

	cases := []struct {
		name    string
		id      uuid.UUID
		fare    int64
		curr    string
		expiry  time.Time
		version int
	}{
		{"a cheaper fare", id, 100, "NGN", expiry, 7},
		{"a dearer fare", id, 900_000, "NGN", expiry, 7},
		{"a different currency", id, 250_000, "KES", expiry, 7},
		{"a later expiry", id, 250_000, "NGN", expiry.Add(time.Hour), 7},
		{"an earlier expiry", id, 250_000, "NGN", expiry.Add(-time.Hour), 7},
		{"another quote's id", uuid.New(), 250_000, "NGN", expiry, 7},
		{"a different config version", id, 250_000, "NGN", expiry, 8},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if signer.Verify(signature, testCase.id, testCase.fare, testCase.curr, testCase.expiry, testCase.version) {
				t.Fatalf("%s must invalidate the signature", testCase.name)
			}
		})
	}
}

func TestSignatureFromAnotherSecretIsRejected(t *testing.T) {
	mine := newSigner(t)
	theirs, err := move.NewQuoteSigner("a-completely-different-secret-32-bytes+")
	if err != nil {
		t.Fatalf("failed to build the second signer: %v", err)
	}

	id := uuid.New()
	expiry := time.Now().Add(time.Minute).Truncate(time.Second)
	forged := theirs.Sign(id, 250_000, "NGN", expiry, 1)

	if mine.Verify(forged, id, 250_000, "NGN", expiry, 1) {
		t.Fatal("a quote signed with another key must not verify")
	}
	if mine.Verify("", id, 250_000, "NGN", expiry, 1) {
		t.Fatal("an empty signature must not verify")
	}
}

func fareConfig() *cityconfig.CityConfig {
	return &cityconfig.CityConfig{
		CityID:   "TST",
		Version:  1,
		Currency: "NGN",
		Fares: map[string]cityconfig.FareTable{
			"go": {
				BaseMinor:       10_000,
				PerKmMinor:      5_000,
				PerMinMinor:     1_000,
				BookingFeeMinor: 2_000,
				MinFareMinor:    50_000,
			},
		},
		WaitPolicy: cityconfig.WaitPolicy{FreeSec: 300, PerMinMinor: 5_000},
		CancelPolicy: cityconfig.CancelPolicy{
			RiderFeeAfterAssignMinor: 30_000,
			DriverFeeMinor:           0,
			FreeWindowSec:            120,
		},
	}
}

func TestFareIsBuiltFromTheCityTable(t *testing.T) {
	engine := pricing.NewEngine()
	config := fareConfig()

	// 10 km, 20 minutes: 10 000 base + 10 × 5 000 + 20 × 1 000 + 2 000 booking.
	money, breakdown, err := engine.Fare(config, "go", 10_000, 1_200)
	if err != nil {
		t.Fatalf("pricing failed: %v", err)
	}
	const want = 10_000 + 50_000 + 20_000 + 2_000
	if money.AmountMinor != want {
		t.Fatalf("fare: got %d, want %d", money.AmountMinor, want)
	}
	if money.Currency != "NGN" {
		t.Fatalf("currency: got %q, want the city's", money.Currency)
	}
	if breakdown.TotalMinor != want {
		t.Fatalf("the breakdown must add up to the fare: %d vs %d", breakdown.TotalMinor, want)
	}
	if breakdown.MinFareTopUpMinor != 0 {
		t.Fatal("a fare above the minimum needs no top-up")
	}
}

func TestShortTripIsLiftedToTheMinimumFare(t *testing.T) {
	engine := pricing.NewEngine()
	config := fareConfig()

	money, breakdown, err := engine.Fare(config, "go", 200, 60)
	if err != nil {
		t.Fatalf("pricing failed: %v", err)
	}
	if money.AmountMinor != 50_000 {
		t.Fatalf("fare: got %d, want the city's 50 000 minimum", money.AmountMinor)
	}
	if breakdown.MinFareTopUpMinor <= 0 {
		t.Fatal("the top-up to the minimum must be an explicit line, not a silent adjustment")
	}
	if breakdown.BaseMinor+breakdown.DistanceMinor+breakdown.TimeMinor+
		breakdown.BookingFeeMinor+breakdown.MinFareTopUpMinor != breakdown.TotalMinor {
		t.Fatal("the breakdown must account for every minor unit of the fare")
	}
}

func TestFareIsDeterministic(t *testing.T) {
	engine := pricing.NewEngine()
	config := fareConfig()
	first, _, err := engine.Fare(config, "go", 7_432, 913)
	if err != nil {
		t.Fatalf("pricing failed: %v", err)
	}
	for i := 0; i < 100; i++ {
		again, _, err := engine.Fare(config, "go", 7_432, 913)
		if err != nil {
			t.Fatalf("pricing failed: %v", err)
		}
		if again != first {
			t.Fatalf("the same route priced twice must be the same fare: %v vs %v", again, first)
		}
	}
}

func TestAnUnpricedClassCannotBeSold(t *testing.T) {
	engine := pricing.NewEngine()
	if _, _, err := engine.Fare(fareConfig(), "helicopter", 1_000, 60); err == nil {
		t.Fatal("a vehicle class the city never priced must be refused, not defaulted")
	}
}

func TestWaitFeeFollowsTheCityPolicy(t *testing.T) {
	engine := pricing.NewEngine()
	config := fareConfig()

	if fee := engine.WaitFee(config, 4*time.Minute); fee.AmountMinor != 0 {
		t.Fatalf("inside the free window the wait is free: got %d", fee.AmountMinor)
	}
	if fee := engine.WaitFee(config, 5*time.Minute); fee.AmountMinor != 0 {
		t.Fatalf("the free window is inclusive: got %d", fee.AmountMinor)
	}
	// Six minutes: one started minute beyond the free five.
	if fee := engine.WaitFee(config, 6*time.Minute); fee.AmountMinor != 5_000 {
		t.Fatalf("one minute over: got %d, want 5 000", fee.AmountMinor)
	}
	// Any part of a minute is a started minute.
	if fee := engine.WaitFee(config, 5*time.Minute+1*time.Second); fee.AmountMinor != 5_000 {
		t.Fatalf("a started minute is charged: got %d, want 5 000", fee.AmountMinor)
	}
	if fee := engine.WaitFee(config, 8*time.Minute); fee.AmountMinor != 15_000 {
		t.Fatalf("three minutes over: got %d, want 15 000", fee.AmountMinor)
	}
}

func TestDriverCancellationNeverChargesTheRider(t *testing.T) {
	engine := pricing.NewEngine()
	config := fareConfig()

	if fee := engine.CancellationFee(config, "driver", true, time.Hour); fee.AmountMinor != 0 {
		t.Fatalf("a driver cancellation costs the rider nothing: got %d", fee.AmountMinor)
	}
	if fee := engine.CancellationFee(config, "rider", false, time.Hour); fee.AmountMinor != 0 {
		t.Fatalf("cancelling before assignment is free: got %d", fee.AmountMinor)
	}
	if fee := engine.CancellationFee(config, "rider", true, time.Minute); fee.AmountMinor != 0 {
		t.Fatalf("cancelling inside the free window is free: got %d", fee.AmountMinor)
	}
	if fee := engine.CancellationFee(config, "rider", true, 10*time.Minute); fee.AmountMinor != 30_000 {
		t.Fatalf("cancelling after assignment costs the city's fee: got %d", fee.AmountMinor)
	}
}

func TestIdempotencyKeysAreValidated(t *testing.T) {
	cases := []struct {
		name  string
		key   string
		valid bool
	}{
		{"a good key", "ride-create-0001", true},
		{"an empty key", "", false},
		{"too short", "abc", false},
		{"too long", string(make([]byte, 0, 65)) + "0123456789012345678901234567890123456789012345678901234567890123456789", false},
		{"not url safe", "has a space", false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			err := move.ValidateIdempotencyKey(testCase.key)
			if testCase.valid && err != nil {
				t.Fatalf("expected %q to be accepted: %v", testCase.key, err)
			}
			if !testCase.valid && err == nil {
				t.Fatalf("expected %q to be refused", testCase.key)
			}
		})
	}
}
