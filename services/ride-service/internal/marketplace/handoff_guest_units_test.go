package marketplace

import (
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// TestClassifyDeliveryAnswerFollowsTheDocumentedContract pins every answer
// services/delivery-service/docs/MARKETPLACE-DELIVERY-ENABLEMENT.md §4a names
// to its handling, and refuses to guess anything undocumented as permanent.
func TestClassifyDeliveryAnswerFollowsTheDocumentedContract(t *testing.T) {
	cases := []struct {
		status int
		code   string
		want   string
	}{
		{http.StatusConflict, "ASSIGN_IN_PROGRESS", HandoffOutcomeRetry},
		{http.StatusInternalServerError, "DATABASE_ERROR", HandoffOutcomeRetry},
		{http.StatusBadGateway, "", HandoffOutcomeRetry},
		{http.StatusConflict, "AWARD_REPLAY_MISMATCH", HandoffOutcomePermanent},
		{http.StatusBadRequest, "VALIDATION_ERROR", HandoffOutcomePermanent},
		{http.StatusBadRequest, "INVALID_JSON", HandoffOutcomePermanent},
		{http.StatusUnprocessableEntity, "SENDER_PROFILE_NOT_FOUND", HandoffOutcomePermanent},
		{http.StatusServiceUnavailable, "SERVICE_KEY_NOT_CONFIGURED", HandoffOutcomeMisconfigured},
		{http.StatusForbidden, "FORBIDDEN", HandoffOutcomeMisconfigured},
		{http.StatusUnauthorized, "", HandoffOutcomeMisconfigured},
		// Undocumented: never permanent.
		{http.StatusConflict, "", HandoffOutcomeRetry},
		{http.StatusNotFound, "NOT_FOUND", HandoffOutcomeRetry},
		{http.StatusUnprocessableEntity, "SOMETHING_NEW", HandoffOutcomeRetry},
		{http.StatusServiceUnavailable, "", HandoffOutcomeRetry},
	}
	for _, c := range cases {
		if got := classifyDeliveryAnswer(c.status, c.code); got != c.want {
			t.Errorf("%d %s: got %s, want %s", c.status, c.code, got, c.want)
		}
	}
}

// TestDeliveryPayloadDerivesThePackageHonestly: sizes follow delivery-service's
// weight bands, a stated size wins, text is bounded, proof of delivery is on
// unless the sender said otherwise, and the parties/fare/token come from the
// award — never from the client.
func TestDeliveryPayloadDerivesThePackageHonestly(t *testing.T) {
	award := &Award{ID: uuid.New(), RequesterID: uuid.New(), DriverID: uuid.New(), FareMinor: 123_400}
	claim := &Claim{FencingToken: 42}
	request := &Request{ID: uuid.New(), Currency: "NGN",
		Pickup: Area{Label: "A", Lat: 6.4, Lng: 3.4}, Dropoff: Area{Label: "B", Lat: 6.5, Lng: 3.5}}
	for weight, size := range map[float64]string{0.5: "SMALL", 5: "SMALL", 5.1: "MEDIUM", 15: "MEDIUM", 29: "LARGE", 31: "XLARGE"} {
		request.Delivery = map[string]any{"weightKg": weight}
		if got := deliveryAssignPayload(award, request, claim).PackageDetails.Size; got != size {
			t.Errorf("%.1f kg: got %s, want %s", weight, got, size)
		}
	}
	request.Delivery = map[string]any{"weightKg": 31.0, "size": "small", "description": strings.Repeat("x", 300), "requiresPod": false}
	payload := deliveryAssignPayload(award, request, claim)
	if payload.PackageDetails.Size != "SMALL" || len([]rune(payload.PackageDetails.Description)) != 200 || payload.PackageDetails.RequiresPod {
		t.Fatalf("a stated size wins, text is bounded, POD follows the sender: %+v", payload.PackageDetails)
	}
	request.Delivery = nil
	payload = deliveryAssignPayload(award, request, claim)
	if payload.PackageDetails.Size != "SMALL" || !payload.PackageDetails.RequiresPod || payload.PackageDetails.Description == "" {
		t.Fatalf("a bare delivery still names a size and asks for proof: %+v", payload.PackageDetails)
	}
	if payload.AwardID != award.ID.String() || payload.CustomerID != award.RequesterID.String() ||
		payload.DriverID != award.DriverID.String() || payload.FareMinor != 123_400 || payload.FencingToken != 42 ||
		payload.Currency != "NGN" || payload.Pickup.Address != "A" || payload.Dropoff.Latitude != 6.5 {
		t.Fatalf("the parties, fare and token come from the award: %+v", payload)
	}
}

// TestAssignmentMatchesRefusesAnotherAwardsDelivery: an answer naming another
// award, other parties or another fare is never adopted.
func TestAssignmentMatchesRefusesAnotherAwardsDelivery(t *testing.T) {
	req := DeliveryAssignRequest{AwardID: uuid.NewString(), CustomerID: uuid.NewString(), DriverID: uuid.NewString(), FareMinor: 500, Currency: "NGN"}
	good := &DeliveryAssignment{ID: uuid.NewString(), MarketplaceAwardID: req.AwardID, CustomerID: req.CustomerID,
		DriverID: req.DriverID, AgreedFareMinor: 500, Currency: "NGN"}
	if !assignmentMatches(good, req) {
		t.Fatal("the matching answer is adopted")
	}
	for name, mutate := range map[string]func(a *DeliveryAssignment){
		"not a uuid":    func(a *DeliveryAssignment) { a.ID = "del_123" },
		"another award": func(a *DeliveryAssignment) { a.MarketplaceAwardID = uuid.NewString() },
		"another rider": func(a *DeliveryAssignment) { a.CustomerID = uuid.NewString() },
		"another fare":  func(a *DeliveryAssignment) { a.AgreedFareMinor = 499 },
		"another money": func(a *DeliveryAssignment) { a.Currency = "KES" },
	} {
		answer := *good
		mutate(&answer)
		if assignmentMatches(&answer, req) {
			t.Errorf("%s: adopted", name)
		}
	}
}

// TestTripAccessTokenShape: minted tokens are well formed, unique and hashed;
// anything else is refused before a database read.
func TestTripAccessTokenShape(t *testing.T) {
	raw, hash, err := newTripAccessToken()
	if err != nil {
		t.Fatal(err)
	}
	other, _, _ := newTripAccessToken()
	if !wellFormedTripAccessToken(raw) || raw == other || hash != hashTripAccessToken(raw) || strings.Contains(hash, raw) || len(hash) != 64 {
		t.Fatalf("a minted token: %q / %q", raw, hash)
	}
	for _, bad := range []string{"", "uta_", "uta_short", strings.TrimPrefix(raw, "uta_"), "xyz_" + raw[4:], raw + "A", raw[:len(raw)-1] + "*"} {
		if wellFormedTripAccessToken(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}

// TestBookingFailureMessagesAreTheReadersOwn: for every failure reason the
// driver's sentence never speaks of "your driver" and states the commission
// return only when it happened; the rider reads the stored sentence.
func TestBookingFailureMessagesAreTheReadersOwn(t *testing.T) {
	for _, reason := range []string{
		BookingFailDriverWithdrew, BookingFailDriverIneligible, BookingFailReconfirmMissed, BookingFailFundingNotSecured,
		BookingFailDriverUnavailable, BookingFailDriverOnTrip, BookingFailExecutionBlocked, BookingFailAwardCancelled,
		BookingFailTripCancelled, BookingCancelledByRider,
	} {
		failure := &BookingFailure{Reason: reason, Message: "Your driver could not make it.", CommissionReversed: reason != BookingFailTripCancelled}
		driver := bookingFailureMessage(failure, viewerDriver)
		if strings.Contains(strings.ToLower(driver), "your driver") || driver == failure.Message {
			t.Errorf("%s: the driver reads the rider's sentence: %q", reason, driver)
		}
		if strings.Contains(driver, "commission was returned") != failure.CommissionReversed {
			t.Errorf("%s: the commission line must match the outcome: %q", reason, driver)
		}
		if rider := bookingFailureMessage(failure, viewerRider); rider != failure.Message {
			t.Errorf("%s: the rider reads the stored sentence: %q", reason, rider)
		}
	}
}
