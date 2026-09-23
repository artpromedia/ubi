package funding_test

import (
	"context"
	"errors"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/funding"
	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/testutil"
)

// The HTTP client against payment-service's return-fee contract (played by
// testutil.PaymentStub): answers decoded, refusals typed, unknown outcomes
// reported as such, and the deterministic idempotency key making a retry a
// replay.

const stubKey = "funding-client-test-key"

func terms() funding.Terms {
	return funding.Terms{
		ReturnID: "ret-1", DeliveryID: "dlv-1", AwardID: "awd-1",
		SenderID: "sender-1", DriverID: "driver-1", FeeMinor: 40000, Currency: "NGN", CityID: "LOS",
	}
}

func TestIdempotencyKeyIsDeterministicPerReturnAndOp(t *testing.T) {
	if funding.IdempotencyKey("r1", "reserve") != "delivery-return:r1:reserve" {
		t.Fatal("unexpected key shape")
	}
	if funding.IdempotencyKey("r1", "reserve") == funding.IdempotencyKey("r1", "capture") {
		t.Fatal("each op needs its own key")
	}
}

func TestClientReserveCaptureReleaseAndReplay(t *testing.T) {
	stub := testutil.NewPaymentStub(t, stubKey)
	stub.Fund("sender-1", 100000)
	client := funding.NewHTTPClient(stub.Server.URL, stubKey)
	ctx := context.Background()

	reserved, err := client.Reserve(ctx, terms())
	if err != nil || reserved.State != "reserved" || reserved.ChargeID == "" || reserved.Replayed {
		t.Fatalf("reserve = %+v, %v", reserved, err)
	}
	replayed, err := client.Reserve(ctx, terms())
	if err != nil || !replayed.Replayed || replayed.ChargeID != reserved.ChargeID {
		t.Fatalf("a retried reserve must replay: %+v, %v", replayed, err)
	}
	if stub.Charge("ret-1").Reserves != 1 {
		t.Fatal("a replay must not reserve twice")
	}

	captured, err := client.Capture(ctx, terms())
	if err != nil || captured.State != "captured" || captured.EntryID == "" {
		t.Fatalf("capture = %+v, %v", captured, err)
	}
	_, err = client.Release(ctx, terms())
	var refusal *funding.Refusal
	if !errors.As(err, &refusal) || refusal.Code != "illegal_transition" || refusal.ChargeState != "captured" {
		t.Fatalf("releasing a captured fee must be a typed refusal carrying the charge state, got %v", err)
	}
}

func TestClientRefusalsAndUnknownOutcomes(t *testing.T) {
	stub := testutil.NewPaymentStub(t, stubKey)
	client := funding.NewHTTPClient(stub.Server.URL, stubKey)
	ctx := context.Background()

	_, err := client.Reserve(ctx, terms())
	var refusal *funding.Refusal
	if !errors.As(err, &refusal) || !refusal.InsufficientFunds() {
		t.Fatalf("an unfunded reserve must be an insufficient-funds refusal, got %v", err)
	}

	stub.Fund("sender-1", 100000)
	stub.DisableCity("LOS")
	if _, err := client.Reserve(ctx, terms()); !errors.As(err, &refusal) || !refusal.FeatureDisabled() {
		t.Fatalf("a city with the switch off must be a feature-disabled refusal, got %v", err)
	}

	other := terms()
	other.CityID = "ABV"
	stub.FailNext("reserve", 1)
	if _, err := client.Reserve(ctx, other); !errors.Is(err, funding.ErrUnavailable) {
		t.Fatalf("a 503 is an unknown outcome, got %v", err)
	}

	wrongKey := funding.NewHTTPClient(stub.Server.URL, "not-the-key")
	if _, err := wrongKey.Reserve(ctx, other); !errors.As(err, &refusal) || refusal.Status != 403 {
		t.Fatalf("a wrong service key is a definite refusal, got %v", err)
	}

	unreachable := funding.NewHTTPClient("http://127.0.0.1:1", stubKey)
	if _, err := unreachable.Reserve(ctx, other); !errors.Is(err, funding.ErrUnavailable) {
		t.Fatalf("an unreachable payment-service is an unknown outcome, got %v", err)
	}
	if _, err := (funding.Disabled{}).Reserve(ctx, other); !errors.Is(err, funding.ErrUnavailable) {
		t.Fatalf("the disabled port must refuse as unavailable, got %v", err)
	}
}
