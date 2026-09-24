package marketplace_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// Business marketplace rides (A06 part C): the organization's budget pays
// INSTEAD OF the rider (never both), reserved at award, committed at
// settlement, released on cancel — exactly once across crashes and lost
// answers — and the driver's 10% commission is untouched and never charged
// to the organization. payment-service is the faithful double in
// business_double_test.go, reached through the real HTTP client.

const businessServiceKey = "svc-key-business-test"

const (
	businessReservePath = "/v1/finance/business/reserve"
	businessCommitPath  = "/v1/finance/business/commit"
	businessReleasePath = "/v1/finance/business/release"
	businessPolicyPath  = "/v1/finance/business/policy-check"
)

func businessHarness(t *testing.T, double *businessDouble, opts ...testutil.HarnessOption) *testutil.Harness {
	t.Helper()
	all := append([]testutil.HarnessOption{
		testutil.WithFlag(cityconfig.FlagBusinessTravel, true),
		testutil.WithBusiness(marketplace.NewHTTPBusiness(double.url(), businessServiceKey, nil)),
	}, opts...)
	return newHarness(t, all...)
}

// quoteBusiness asks for a fixture-route quote naming an organization.
func quoteBusiness(t *testing.T, h *testutil.Harness, rider testutil.Actor, orgID string, extra url.Values) *httptest.ResponseRecorder {
	t.Helper()
	pickup, dropoff := testutil.PickupFixture(), testutil.DropoffFixture()
	query := url.Values{
		"service": {"ride"}, "vehicleClass": {"go"},
		"pickupLat": {formatCoord(pickup.Lat)}, "pickupLng": {formatCoord(pickup.Lng)},
		"dropoffLat": {formatCoord(dropoff.Lat)}, "dropoffLng": {formatCoord(dropoff.Lng)},
		"organizationId": {orgID},
	}
	for key, values := range extra {
		query[key] = values
	}
	return h.Do(http.MethodGet, "/mp/quote?"+query.Encode(), rider, nil)
}

// publishBusiness publishes the fixture route booked on an organization.
func publishBusiness(t *testing.T, h *testutil.Harness, rider testutil.Actor, business map[string]any, passenger map[string]any) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	quote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
	body := map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    marketplace.PaymentMethodBusiness,
		"business":           business,
	}
	if passenger != nil {
		body["passenger"] = passenger
	}
	return h.Do(http.MethodPost, "/mp/requests", rider, body, move.IdempotencyHeader, idemKey()), quote
}

// businessTrip is one business request selected into a confirmed award.
type businessTrip struct {
	rider, driver testutil.Actor
	requestID     string
	amount        int64
	reservation   string
	award         *marketplace.Award
	rideID        uuid.UUID
}

// awardBusinessTrip publishes a business request, bids and selects, at the
// quote's minimum fare.
func awardBusinessTrip(t *testing.T, h *testutil.Harness, rider testutil.Actor, business, passenger map[string]any) *businessTrip {
	t.Helper()
	published, _ := publishBusiness(t, h, rider, business, passenger)
	return awardPublishedBusinessTrip(t, h, rider, published, "minimumFareMinor")
}

// awardPublishedBusinessTrip bids a published business request at one of its
// bounds (minimumFareMinor / maximumFareMinor) and selects the offer.
func awardPublishedBusinessTrip(t *testing.T, h *testutil.Harness, rider testutil.Actor, published *httptest.ResponseRecorder, bound string) *businessTrip {
	t.Helper()
	requireStatus(t, published, http.StatusCreated)
	view := decode(t, published)
	f := &businessTrip{rider: rider, driver: h.Driver(), requestID: view["requestId"].(string)}
	f.amount = moneyMinor(t, view, bound)
	parkDriver(t, h, f.driver, testutil.PickupFixture())
	bid := fundedCurrentBid(t, h, f.driver, f.requestID, f.amount)
	f.reservation = bid["reservationId"].(string)
	selected := doSelect(t, h, rider, f.requestID, map[string]any{"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1}, "")
	requireStatus(t, selected, http.StatusAccepted)
	f.award = awardRow(t, h, f.requestID)
	if f.award.ExecutionID != nil {
		f.rideID = *f.award.ExecutionID
	}
	return f
}

func bookingRow(t *testing.T, h *testutil.Harness, awardID uuid.UUID) *marketplace.BusinessBooking {
	t.Helper()
	booking, err := h.Marketplace.Store().BusinessBookingByAward(context.Background(), h.Pool, awardID)
	if err != nil {
		t.Fatalf("read the business booking of %s: %v", awardID, err)
	}
	return booking
}

// TestBusinessRideIsFundedByTheOrganizationNeverTheRider: the quote shows
// the organization's verdict; the publish records the organization as payer;
// the award reserves the AGREED FARE on the budget (no rider funding is ever
// authorized, the 10% is captured once from the driver's own hold and never
// reaches the organization); completion commits the actual exactly once
// (the rider's personal settlement is never called); the business receipt
// names the cost centre, the organization's tax id and VAT; the driver's
// receipt and job card learn nothing about the organization.
func TestBusinessRideIsFundedByTheOrganizationNeverTheRider(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)

	quote := quoteBusiness(t, h, rider, org.orgID, nil)
	requireStatus(t, quote, http.StatusOK)
	check := decode(t, quote)["business"].(map[string]any)
	if check["status"] != marketplace.BusinessQuoteAllowed || check["organizationId"] != org.orgID || check["costCentreId"] != org.centreID {
		t.Fatalf("the quote shows the organization's advisory verdict: %v", check)
	}

	f := awardBusinessTrip(t, h, rider, map[string]any{"organizationId": org.orgID, "expenseCategory": "client visit"}, nil)
	if f.award.State != machine.MpAwardConfirmed || f.award.ExecutionID == nil {
		t.Fatalf("the business award confirms into its execution: %s", f.award.State)
	}
	reservation, ok := double.reservation(f.award.ID.String())
	if !ok || reservation.state != "reserved" || reservation.reserved != f.award.FareMinor {
		t.Fatalf("the budget reserved the agreed fare under the award's booking ref: %+v", reservation)
	}
	if reservation.reserved == f.award.FareMinor+f.award.CommissionMinor || f.award.CommissionMinor == 0 {
		t.Fatal("the organization is never charged the driver's commission")
	}
	if keys := double.keysOf(businessReservePath); len(keys) != 1 || keys[0] != "business:"+f.award.ID.String()+":reserve" {
		t.Fatalf("one reserve under the contract's key: %v", keys)
	}
	if h.Funding.Calls != 0 || h.Funding.FundedAmount(f.award.ID) != 0 {
		t.Fatalf("no rider funding is ever authorized for a business trip: %d calls", h.Funding.Calls)
	}
	if h.Wallet.CapturesByReservation[f.reservation] != 1 {
		t.Fatalf("the driver's 10%% is captured exactly once: %d", h.Wallet.CapturesByReservation[f.reservation])
	}
	booking := bookingRow(t, h, f.award.ID)
	if booking.State != machine.MpBusinessReserved || booking.CostCentreID != org.centreID || booking.ReservedMinor != f.award.FareMinor {
		t.Fatalf("the booking is reserved on the resolved cost centre: %+v", booking)
	}
	if outboxCount(t, h, "business_booking.reserved", f.award.ID.String()) != 1 {
		t.Fatal("the reservation is an outbox event")
	}

	snapshot := h.Do(http.MethodGet, "/mp/requests/"+f.requestID, rider, nil)
	requireStatus(t, snapshot, http.StatusOK)
	business := decode(t, snapshot)["request"].(map[string]any)["business"].(map[string]any)
	if business["payerRole"] != "organization" || business["organizationId"] != org.orgID ||
		business["funding"].(map[string]any)["state"] != machine.MpBusinessReserved {
		t.Fatalf("the requester sees the organization paying: %v", business)
	}
	jobs := h.Do(http.MethodGet, "/mp/driver/jobs", f.driver, nil)
	requireStatus(t, jobs, http.StatusOK)
	if strings.Contains(jobs.Body.String(), org.orgID) || strings.Contains(jobs.Body.String(), "business") {
		t.Fatalf("the driver learns nothing about the organization: %s", jobs.Body.String())
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.outbox_events WHERE name LIKE 'mp.%' AND payload::text LIKE '%' || $1 || '%'`, org.orgID); n != 0 {
		t.Fatalf("no mp.* event (fanned out to drivers) names the organization: %d", n)
	}

	completeTrip(t, h, rider, f.driver, f.requestID, f.rideID, 10)
	reservation, _ = double.reservation(f.award.ID.String())
	if reservation.state != "committed" || reservation.committed == nil || *reservation.committed != f.award.FareMinor {
		t.Fatalf("completion commits the actual total once: %+v", reservation)
	}
	if double.balance(org.centreID) != 2_000_000-f.award.FareMinor {
		t.Fatalf("the budget paid exactly the fare: %d", double.balance(org.centreID))
	}
	if _, settled := h.Settlement.Requests[f.award.ID]; settled || h.Settlement.Calls != 0 {
		t.Fatal("the rider's personal settlement is never called for a business award")
	}
	booking = bookingRow(t, h, f.award.ID)
	if booking.State != machine.MpBusinessCommitted || booking.CommittedMinor == nil || *booking.CommittedMinor != f.award.FareMinor || booking.OwedOp != "" {
		t.Fatalf("the booking records the commit: %+v", booking)
	}
	sweepOnce(t, h)
	sweepOnce(t, h)
	if double.callCount(businessCommitPath) != 1 || h.Wallet.CapturesByReservation[f.reservation] != 1 {
		t.Fatal("no sweep commits or captures again")
	}

	receipt := h.Do(http.MethodGet, "/mp/requests/"+f.requestID+"/receipt", rider, nil)
	requireStatus(t, receipt, http.StatusOK)
	body := decode(t, receipt)
	biz := body["business"].(map[string]any)
	centre := biz["costCentre"].(map[string]any)
	if biz["taxId"] != "TIN-"+org.orgID || biz["legalName"] != "Acme Logistics Nigeria Ltd" || centre["code"] != org.centreCode ||
		centre["id"] != org.centreID || biz["expenseCategory"] != "client visit" || biz["fundingState"] != machine.MpBusinessCommitted {
		t.Fatalf("the business receipt names the cost centre and the organization's tax id: %v", biz)
	}
	if body["payment"].(map[string]any)["method"] != marketplace.PaymentMethodBusiness ||
		body["settlement"].(map[string]any)["status"] != marketplace.ReceiptSettlementPosted {
		t.Fatalf("paid from the organization's budget, posted: %v / %v", body["payment"], body["settlement"])
	}
	taxes := body["taxes"].(map[string]any)
	if taxes["basis"] != marketplace.ReceiptTaxesIncluded || len(taxes["lines"].([]any)) != 1 {
		t.Fatalf("VAT at the city's configured rate is itemised: %v", taxes)
	}
	driverReceipt := h.Do(http.MethodGet, "/mp/requests/"+f.requestID+"/receipt", f.driver, nil)
	requireStatus(t, driverReceipt, http.StatusOK)
	if raw := driverReceipt.Body.String(); strings.Contains(raw, org.orgID) || strings.Contains(raw, "TIN-") || strings.Contains(raw, `"business":`) {
		t.Fatalf("the driver's receipt never names the organization: %s", raw)
	}
}

// TestBusinessPublishRefusesOutOfPolicyAndUnfunded: policy (class, per-trip
// cap), membership and money (no budget) are checked at publish through the
// documented policy check; each refusal answers its canonical code and
// details.reason and writes nothing. No unsecured credit.
func TestBusinessPublishRefusesOutOfPolicyAndUnfunded(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	business := map[string]any{"organizationId": org.orgID}

	double.setClasses(org.orgID, "comfort")
	quote := quoteBusiness(t, h, rider, org.orgID, nil)
	requireStatus(t, quote, http.StatusOK)
	if check := decode(t, quote)["business"].(map[string]any); check["status"] != marketplace.BusinessQuoteRefused ||
		check["reasons"].([]any)[0] != "class_not_allowed" {
		t.Fatalf("an out-of-policy option is shown unavailable with its reasons: %v", check)
	}
	refused, _ := publishBusiness(t, h, rider, business, nil)
	requireRefusalReason(t, refused, http.StatusForbidden, domain.CodeForbidden, "class_not_allowed")
	double.setClasses(org.orgID, "go")

	capped := double.seedOrg(rider.UserID, uuid.New(), 100, 2_000_000)
	overCap, _ := publishBusiness(t, h, rider, map[string]any{"organizationId": capped.orgID}, nil)
	requireRefusalReason(t, overCap, http.StatusUnprocessableEntity, domain.CodeLimitExceeded, "trip_cap_exceeded")

	double.dropBudget(org.centreID)
	unfunded, _ := publishBusiness(t, h, rider, business, nil)
	requireRefusalReason(t, unfunded, http.StatusUnprocessableEntity, domain.CodeInsufficientSpendable, "no_budget_for_period")

	outsider := h.Rider()
	notMember, _ := publishBusiness(t, h, outsider, map[string]any{"organizationId": capped.orgID}, nil)
	requireRefusalReason(t, notMember, http.StatusForbidden, domain.CodeForbidden, "booker_not_authorized")
	// A non-member cannot tell a real organization from none at all.
	noSuch, _ := publishBusiness(t, h, outsider, map[string]any{"organizationId": "org_does_not_exist"}, nil)
	requireRefusalReason(t, noSuch, http.StatusForbidden, domain.CodeForbidden, "booker_not_authorized")
	if member, none := decode(t, notMember)["details"], decode(t, noSuch)["details"]; !reflect.DeepEqual(member, none) {
		t.Fatalf("a real organization's refusal to an outsider is the no-such-organization refusal, whole: %v vs %v", member, none)
	}
	// The same at quote — even naming a real member as the traveller and the
	// organization's real cost centre, an outsider learns nothing of its
	// status, policy or budget.
	outsiderQuote := quoteBusiness(t, h, outsider, capped.orgID, url.Values{
		"travellerId": {rider.UserID.String()}, "costCentreId": {capped.centreID},
	})
	noSuchQuote := quoteBusiness(t, h, outsider, "org_does_not_exist", nil)
	requireRefusalReason(t, outsiderQuote, http.StatusForbidden, domain.CodeForbidden, "booker_not_authorized")
	requireRefusalReason(t, noSuchQuote, http.StatusForbidden, domain.CodeForbidden, "booker_not_authorized")
	if member, none := decode(t, outsiderQuote)["details"], decode(t, noSuchQuote)["details"]; !reflect.DeepEqual(member, none) ||
		strings.Contains(outsiderQuote.Body.String(), "available") || strings.Contains(outsiderQuote.Body.String(), capped.centreID) {
		t.Fatalf("an outsider's quote learns nothing about a real organization: %s vs %s", outsiderQuote.Body.String(), noSuchQuote.Body.String())
	}

	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.requests WHERE requester_id IN ($1, $2)`, rider.UserID, outsider.UserID); n != 0 {
		t.Fatalf("a refused business publish writes nothing: %d", n)
	}
	if double.callCount(businessReservePath) != 0 {
		t.Fatal("nothing is reserved before an offer is selected")
	}

	// Never both: a business trip cannot name the rider's own funding.
	quoteBody := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
	both := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId": quoteBody["quoteId"], "requestedFareMinor": moneyBody(moneyMinor(t, quoteBody, "minimumFareMinor")),
		"paymentMethodId": "wallet", "business": map[string]any{"organizationId": capped.orgID},
	}, move.IdempotencyHeader, idemKey())
	requireRefusalReason(t, both, http.StatusUnprocessableEntity, domain.CodeValidationFailed, marketplace.ReasonBusinessPaymentMethod)
}

// TestBusinessTravelIsDenyByDefault: without business_travel for the city a
// business quote or publish is feature_disabled (404) and payment-service is
// never asked.
func TestBusinessTravelIsDenyByDefault(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := newHarness(t, testutil.WithBusiness(marketplace.NewHTTPBusiness(double.url(), businessServiceKey, nil)))
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	requireCode(t, quoteBusiness(t, h, rider, org.orgID, nil), http.StatusNotFound, domain.CodeFeatureDisabled)
	published, _ := publishBusiness(t, h, rider, map[string]any{"organizationId": org.orgID}, nil)
	requireCode(t, published, http.StatusNotFound, domain.CodeFeatureDisabled)
	if double.callCount(businessPolicyPath) != 0 {
		t.Fatal("payment-service is never asked while the flag is off")
	}
}

// TestBusinessSelectionIsRefusedBeforeAnyAward: a budget drained after the
// publish is refused synchronously at selection, with its reason — no award
// starts, nothing is promised, nothing is put on credit.
func TestBusinessSelectionIsRefusedBeforeAnyAward(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	published, _ := publishBusiness(t, h, rider, map[string]any{"organizationId": org.orgID}, nil)
	requireStatus(t, published, http.StatusCreated)
	view := decode(t, published)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	bid := fundedCurrentBid(t, h, driver, requestID, amount)

	double.setBudget(org.centreID, amount-1)
	refused := doSelect(t, h, rider, requestID, map[string]any{"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1}, "")
	requireRefusalReason(t, refused, http.StatusUnprocessableEntity, domain.CodeInsufficientSpendable, "budget_insufficient")
	if n := countRows(t, h, `SELECT COUNT(*) FROM mp.awards WHERE request_id = $1`, uuid.MustParse(requestID)); n != 0 {
		t.Fatalf("no award is started on a budget that cannot pay: %d", n)
	}
	if double.callCount(businessReservePath) != 0 || h.Wallet.CaptureCalls != 0 {
		t.Fatal("nothing is reserved or captured")
	}
}

// TestBusinessReserveRefusalCompensatesTheAward: the selection's check
// passes, then a rival booking spends the budget before the saga's reserve:
// the reservation itself refuses, and the award is compensated with the
// reason before any capture — the request reopens and nothing is put on
// credit, no rider funding is used.
func TestBusinessReserveRefusalCompensatesTheAward(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	raced := &racingBusiness{BusinessPort: marketplace.NewHTTPBusiness(double.url(), businessServiceKey, nil)}
	h := businessHarness(t, double, testutil.WithBusiness(raced))
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	published, _ := publishBusiness(t, h, rider, map[string]any{"organizationId": org.orgID}, nil)
	requireStatus(t, published, http.StatusCreated)
	view := decode(t, published)
	requestID := view["requestId"].(string)
	amount := moneyMinor(t, view, "minimumFareMinor")
	driver := h.Driver()
	parkDriver(t, h, driver, testutil.PickupFixture())
	bid := fundedCurrentBid(t, h, driver, requestID, amount)
	raced.beforeReserve = func() {
		double.mu.Lock()
		defer double.mu.Unlock()
		rival := "rival-" + uuid.NewString()
		double.resByRef[rival] = &doubleReservation{id: "obr_rival", ref: rival, centre: org.centreID, org: org.orgID,
			currency: testCurrency, reserved: 2_000_000 - amount + 1, state: "reserved"}
	}
	selected := doSelect(t, h, rider, requestID, map[string]any{"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1}, "")
	requireStatus(t, selected, http.StatusAccepted)
	award := awardRow(t, h, requestID)
	if award.State != machine.MpAwardCompensated || award.FailReason != "business_refused:budget_insufficient" {
		t.Fatalf("a refused reservation compensates the award with its reason: %s / %s", award.State, award.FailReason)
	}
	if h.Wallet.CaptureCalls != 0 || h.Funding.Calls != 0 {
		t.Fatalf("nothing was captured and no rider funding was used: captures %d, funding %d", h.Wallet.CaptureCalls, h.Funding.Calls)
	}
	if booking := bookingRow(t, h, award.ID); booking.State != machine.MpBusinessRefused || booking.RefusalReason != "budget_insufficient" {
		t.Fatalf("the booking records the refusal: %+v", booking)
	}
	if outboxCount(t, h, "business_booking.refused", award.ID.String()) != 1 {
		t.Fatal("the refusal is an outbox event")
	}
	requestView := decode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID, rider, nil))["request"].(map[string]any)
	if requestView["state"] != machine.MpRequestOpen {
		t.Fatalf("the request reopens for another choice: %v", requestView["state"])
	}
	if double.reservationCount() != 1 {
		t.Fatal("only the rival's reservation exists")
	}
}

// racingBusiness runs a hook just before the reserve reaches payment-service
// (a rival booking landing between the selection's check and the saga).
type racingBusiness struct {
	marketplace.BusinessPort
	beforeReserve func()
}

func (r *racingBusiness) Reserve(ctx context.Context, cityID string, terms marketplace.BusinessBookingTerms, key string) (*marketplace.BusinessOpResult, error) {
	if r.beforeReserve != nil {
		r.beforeReserve()
		r.beforeReserve = nil
	}
	return r.BusinessPort.Reserve(ctx, cityID, terms, key)
}
