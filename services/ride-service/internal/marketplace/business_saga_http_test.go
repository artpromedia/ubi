package marketplace_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/pricing"
	ridisc "github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/redis"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// Business budget ops across crashes, lost answers and outages, and the
// payer / passenger cancel rights (BUSINESS_CANCEL_RIGHTS).

const businessStatusPath = "/v1/finance/business/reservations"

// restartedBusinessService is a fresh process over the same database: the
// durable rows (award attempts, business bookings) are its only memory.
func restartedBusinessService(t *testing.T, h *testutil.Harness, double *businessDouble) *marketplace.Service {
	t.Helper()
	router := move.NewStraightLineRouter()
	router.Now = h.Clock.Now
	service, err := marketplace.NewService(marketplace.Deps{
		Store:      h.Marketplace.Store(),
		Config:     cityconfig.NewStore(h.Pool, nil, time.Second),
		Flags:      cityconfig.NewFlags(h.Pool),
		Pricing:    pricing.NewEngine(),
		Router:     router,
		Wallet:     h.Wallet,
		Funding:    h.Funding,
		Settlement: h.Settlement,
		Redis:      ridisc.New(h.Redis),
		Logger:     zerolog.Nop(),
		Now:        h.Clock.Now,
		Business:   marketplace.NewHTTPBusiness(double.url(), businessServiceKey, nil),
	})
	if err != nil {
		t.Fatal(err)
	}
	return service
}

// resumeWith advances past any backoff and sweeps with a restarted process.
func resumeWith(t *testing.T, h *testutil.Harness, service *marketplace.Service) {
	t.Helper()
	h.Clock.Advance(11 * time.Minute)
	if err := service.Sweep(context.Background()); err != nil {
		t.Fatalf("sweep: %v", err)
	}
}

// TestBusinessReserveIsExactlyOnceAcrossALostAnswer: payment-service records
// the reservation but the answer is lost, and its status read is down for a
// while. The award stays PENDING (no transport promised, nothing captured);
// a restarted process reconciles through GET /reservations/:bookingRef
// before re-sending anything, adopts the reservation that landed, captures
// the commission once and confirms. One reservation, one reserve call.
func TestBusinessReserveIsExactlyOnceAcrossALostAnswer(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	// Two drops: net/http transparently re-sends a request carrying an
	// Idempotency-Key once when a reused connection dies before the answer
	// (same key — payment-service replays it), so the answer is lost for
	// good only if that re-send loses its answer too.
	double.dropAfterRecording(businessReservePath, 2)
	double.failBeforeHandling(businessStatusPath, 1)

	f := awardBusinessTrip(t, h, rider, map[string]any{"organizationId": org.orgID}, nil)
	if f.award.State != machine.MpAwardPending || h.Wallet.CaptureCalls != 0 {
		t.Fatalf("an unknown reserve parks the award, nothing captured: %s / %d", f.award.State, h.Wallet.CaptureCalls)
	}
	if attempt := attemptRow(t, h, f.award.ID); attempt.Step != marketplace.AttemptStepFunding || attempt.State != marketplace.AttemptStateUnknown {
		t.Fatalf("the funding step is parked unknown: %+v", attempt)
	}
	if bookingRow(t, h, f.award.ID).State != machine.MpBusinessReserving {
		t.Fatal("the booking is still reserving")
	}

	restarted := restartedBusinessService(t, h, double)
	resumeWith(t, h, restarted) // the status read is down: parked again
	if awardRow(t, h, f.requestID).State != machine.MpAwardPending {
		t.Fatal("an unreadable status never guesses")
	}
	resumeWith(t, h, restarted)
	award := awardRow(t, h, f.requestID)
	if award.State != machine.MpAwardConfirmed {
		t.Fatalf("the reconciled reservation lets the award confirm: %s", award.State)
	}
	sends := double.callCount(businessReservePath)
	if double.reservationCount() != 1 || sends > 2 {
		t.Fatalf("one reservation, never re-sent after the reconciliation: %d sends, %d reservations",
			sends, double.reservationCount())
	}
	for _, key := range double.keysOf(businessReservePath) {
		if key != "business:"+f.award.ID.String()+":reserve" {
			t.Fatalf("every send carries the award's one key: %s", key)
		}
	}
	if h.Wallet.CapturesByReservation[f.reservation] != 1 || h.Funding.Calls != 0 {
		t.Fatalf("one commission capture, no rider funding: %d / %d", h.Wallet.CapturesByReservation[f.reservation], h.Funding.Calls)
	}
	if booking := bookingRow(t, h, award.ID); booking.State != machine.MpBusinessReserved || booking.ReservationID == "" {
		t.Fatalf("the booking records the reservation that landed: %+v", booking)
	}
	resumeWith(t, h, restarted)
	if double.callCount(businessReservePath) != sends || h.Wallet.CaptureCalls != 1 {
		t.Fatal("further sweeps move nothing")
	}
}

// TestBusinessReserveResendsTheSameKeyWhenNothingLanded: an outage answers
// the reserve with a 500 before recording anything. The award parks; the
// resumed saga's status read finds no reservation (404) and re-sends the
// SAME key and terms — one reservation.
func TestBusinessReserveResendsTheSameKeyWhenNothingLanded(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	double.failBeforeHandling(businessReservePath, 1)

	f := awardBusinessTrip(t, h, rider, map[string]any{"organizationId": org.orgID}, nil)
	if f.award.State != machine.MpAwardPending {
		t.Fatalf("an outage parks the award: %s", f.award.State)
	}
	resumeWith(t, h, restartedBusinessService(t, h, double))
	if award := awardRow(t, h, f.requestID); award.State != machine.MpAwardConfirmed {
		t.Fatalf("the re-sent reserve confirms the award: %s", award.State)
	}
	keys := double.keysOf(businessReservePath)
	if len(keys) != 2 || keys[0] != keys[1] || keys[0] != "business:"+f.award.ID.String()+":reserve" {
		t.Fatalf("the re-send carries the same key: %v", keys)
	}
	bodies := double.bodiesOf(businessReservePath)
	if mustJSON(t, bodies[0]) != mustJSON(t, bodies[1]) {
		t.Fatalf("the re-send carries byte-identical terms: %v", bodies)
	}
	if double.reservationCount() != 1 {
		t.Fatal("one reservation")
	}
}

// TestBusinessCommitIsExactlyOnceAcrossALostAnswer: the commit lands but its
// answer is lost and the status read is down; the owed commit survives on
// the booking row, a restarted process re-sends the SAME key and adopts
// payment-service's 200 replay — the budget pays once.
func TestBusinessCommitIsExactlyOnceAcrossALostAnswer(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	f := awardBusinessTrip(t, h, rider, map[string]any{"organizationId": org.orgID}, nil)

	double.dropAfterRecording(businessCommitPath, 2) // see the reserve test: the transport's one re-send
	double.failBeforeHandling(businessStatusPath, 1)
	completeTrip(t, h, rider, f.driver, f.requestID, f.rideID, 20)
	booking := bookingRow(t, h, f.award.ID)
	if booking.State != machine.MpBusinessReserved || booking.OwedOp != "commit" {
		t.Fatalf("the commit is owed durably: %s / %q", booking.State, booking.OwedOp)
	}
	if reservation, _ := double.reservation(f.award.ID.String()); reservation.state != "committed" {
		t.Fatalf("the commit did land in payment-service: %s", reservation.state)
	}

	restarted := restartedBusinessService(t, h, double)
	resumeWith(t, h, restarted)
	booking = bookingRow(t, h, f.award.ID)
	if booking.State != machine.MpBusinessCommitted || booking.OwedOp != "" || *booking.CommittedMinor != f.award.FareMinor {
		t.Fatalf("the replayed commit is recorded: %+v", booking)
	}
	keys := double.keysOf(businessCommitPath)
	if len(keys) < 2 {
		t.Fatalf("the owed commit was re-sent: %v", keys)
	}
	for _, key := range keys {
		if key != "business:"+f.award.ID.String()+":commit" {
			t.Fatalf("every send carries the award's one commit key: %v", keys)
		}
	}
	commitSends := len(keys)
	if double.balance(org.centreID) != 2_000_000-f.award.FareMinor {
		t.Fatalf("the budget paid once: %d", double.balance(org.centreID))
	}
	if outboxCount(t, h, "business_booking.committed", f.award.ID.String()) != 1 {
		t.Fatal("one committed event")
	}
	resumeWith(t, h, restarted)
	if double.callCount(businessCommitPath) != commitSends || h.Settlement.Calls != 0 {
		t.Fatal("nothing more is sent, and the personal settlement is never called")
	}
}

// guestBusinessTrip books a colleague (the traveller) as the guest passenger
// on the organization and awards it.
func guestBusinessTrip(t *testing.T, h *testutil.Harness, double *businessDouble) (*businessTrip, *orgFixture, string) {
	t.Helper()
	booker, traveller := h.Rider(), uuid.New()
	org := double.seedOrg(booker.UserID, traveller, 5_000_000, 2_000_000)
	f := awardBusinessTrip(t, h, booker,
		map[string]any{"organizationId": org.orgID, "travellerId": traveller.String()},
		passengerBody(yes(), yes()))
	if f.award.State != machine.MpAwardConfirmed {
		t.Fatalf("the colleague's trip is awarded: %s", f.award.State)
	}
	_, token := latestToken(t, h, f.requestID)
	return f, org, token
}

// TestBusinessCancelRights: who may cancel, per BUSINESS_CANCEL_RIGHTS. The
// traveller (the passenger, through their trip link) declines their own trip
// before pickup — released as the traveller; the booker cancels a booking
// they made before pickup — released as the booker; a driver cancellation
// releases as the system. No rider funding is touched on any of them.
func TestBusinessCancelRights(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double, testutil.WithFlag(cityconfig.FlagMarketplaceGuestBookings, true))

	// The traveller declines through their trip link.
	declined, org, token := guestBusinessTrip(t, h, double)
	snapshot := decode(t, h.Do(http.MethodGet, "/mp/requests/"+declined.requestID, declined.rider, nil))["request"].(map[string]any)
	if snapshot["passenger"].(map[string]any)["payerRole"] != "organization" ||
		snapshot["business"].(map[string]any)["travellerId"] != org.traveller.String() {
		t.Fatalf("the organization pays for the colleague travelling: %v", snapshot)
	}
	requireStatus(t, tripAccess(t, h, http.MethodPost, "/mp/trip-access/decline", token, clientAddr(), move.IdempotencyHeader, idemKey()), http.StatusOK)
	if by := double.releasedBy(declined.award.ID.String()); by != marketplace.BusinessPartyTraveller {
		t.Fatalf("the traveller's decline releases as the traveller: %q", by)
	}
	release := double.bodiesOf(businessReleasePath)[0]
	cancelledBy := release["cancelledBy"].(map[string]any)
	if cancelledBy["userId"] != org.traveller.String() || release["reason"] != "passenger_declined" {
		t.Fatalf("the release names the traveller and the reason: %v", release)
	}
	if booking := bookingRow(t, h, declined.award.ID); booking.State != machine.MpBusinessReleased || booking.ReleaseParty != marketplace.BusinessPartyTraveller {
		t.Fatalf("the booking records the traveller's release: %+v", booking)
	}

	// The booker cancels before pickup (the rider machine allows no later one).
	cancelled, _, _ := guestBusinessTrip(t, h, double)
	// Every view of the passenger names the organization as payer — a fresh
	// trip link's answer too, not only the snapshot.
	reissued := h.Do(http.MethodPost, "/mp/requests/"+cancelled.requestID+"/passenger/access/reissue", cancelled.rider, nil,
		move.IdempotencyHeader, idemKey())
	requireStatus(t, reissued, http.StatusOK)
	if role := decode(t, reissued)["payerRole"]; role != "organization" {
		t.Fatalf("a reissued link's passenger view names the organization as payer: %v", role)
	}
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+cancelled.rideID.String()+"/cancel", cancelled.rider,
		map[string]any{"reasonCode": "changed_mind"}), http.StatusOK)
	if by := double.releasedBy(cancelled.award.ID.String()); by != marketplace.BusinessPartyBooker {
		t.Fatalf("the booker's cancel releases as the booker: %q", by)
	}

	// A driver cancellation: the system releases.
	driverCancelled, _, _ := guestBusinessTrip(t, h, double)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+driverCancelled.rideID.String()+"/cancel", driverCancelled.driver,
		map[string]any{"reasonCode": "vehicle_issue"}), http.StatusOK)
	if by := double.releasedBy(driverCancelled.award.ID.String()); by != marketplace.BusinessPartySystem {
		t.Fatalf("a driver cancellation releases as the system: %q", by)
	}
	if award := awardRow(t, h, driverCancelled.requestID); award.State != machine.MpAwardCancelled {
		t.Fatalf("the driver-cancelled award unwinds: %s", award.State)
	}
	if h.Wallet.ReversalsByReservation[driverCancelled.reservation] != 1 {
		t.Fatal("the driver's commission is reversed with a linked entry, never by the organization")
	}

	if h.Funding.Calls != 0 || h.Funding.ReleaseCalls != 0 {
		t.Fatalf("no rider funding is authorized or released on a business trip: %d / %d", h.Funding.Calls, h.Funding.ReleaseCalls)
	}
	sweepOnce(t, h)
	if double.callCount(businessReleasePath) != 3 {
		t.Fatalf("one release per booking: %d", double.callCount(businessReleasePath))
	}
}

// TestBusinessReleaseFallsBackToTheSystemWhenTheBookerLeft: payment-service
// refuses the booker's release once they are no longer a booking member
// (cancel_not_permitted). The trip still ended without service, so the
// budget is released as the system under its own key — never stranded.
func TestBusinessReleaseFallsBackToTheSystemWhenTheBookerLeft(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double, testutil.WithFlag(cityconfig.FlagMarketplaceGuestBookings, true))
	f, org, _ := guestBusinessTrip(t, h, double)
	double.removeMember(org.orgID, org.booker)

	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideID.String()+"/cancel", f.rider,
		map[string]any{"reasonCode": "changed_mind"}), http.StatusOK)
	if by := double.releasedBy(f.award.ID.String()); by != marketplace.BusinessPartySystem {
		t.Fatalf("the budget is released as the system: %q", by)
	}
	keys := double.keysOf(businessReleasePath)
	base := "business:" + f.award.ID.String() + ":release"
	if len(keys) != 2 || keys[0] != base || keys[1] != base+":system" {
		t.Fatalf("the booker's release, then the system's under its own key: %v", keys)
	}
	if booking := bookingRow(t, h, f.award.ID); booking.State != machine.MpBusinessReleased || booking.OwedOp != "" {
		t.Fatalf("released, nothing owed: %+v", booking)
	}
}

// TestBusinessReleaseIsOwedAcrossAnOutage: payment-service is down when the
// requester cancels; the cancel still answers, the release stays owed on the
// booking row, and the sweep releases it once when payment-service is back.
func TestBusinessReleaseIsOwedAcrossAnOutage(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	f := awardBusinessTrip(t, h, rider, map[string]any{"organizationId": org.orgID}, nil)

	double.failBeforeHandling(businessReleasePath, 1)
	double.failBeforeHandling(businessStatusPath, 1)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideID.String()+"/cancel", rider,
		map[string]any{"reasonCode": "changed_mind"}), http.StatusOK)
	booking := bookingRow(t, h, f.award.ID)
	if booking.OwedOp != "release" || booking.ReleaseParty != marketplace.BusinessPartyTraveller {
		t.Fatalf("the release (as the traveller who booked for themselves) is owed: %+v", booking)
	}
	stageOf := func() *marketplace.ResolutionStage {
		t.Helper()
		recorder := h.Do(http.MethodGet, "/admin/mp/requests/"+f.requestID+"/resolution", adminActor(h), nil)
		requireStatus(t, recorder, http.StatusOK)
		var view marketplace.ResolutionView
		h.DecodeBody(recorder, &view)
		for _, stage := range view.Stages {
			if stage.Name == "business_funding" {
				return stage
			}
		}
		t.Fatalf("the resolution board shows the business funding stage: %+v", view.Stages)
		return nil
	}
	if stage := stageOf(); stage.Status != marketplace.StageProposed {
		t.Fatalf("support sees the owed release: %+v", stage)
	}
	resumeWith(t, h, restartedBusinessService(t, h, double))
	if by := double.releasedBy(f.award.ID.String()); by != marketplace.BusinessPartyTraveller {
		t.Fatalf("released once payment-service is back: %q", by)
	}
	if stage := stageOf(); stage.Status != marketplace.StageCommitted {
		t.Fatalf("support sees the release settled: %+v", stage)
	}
	if booking := bookingRow(t, h, f.award.ID); booking.State != machine.MpBusinessReleased {
		t.Fatalf("the booking is released: %s", booking.State)
	}
	if outboxCount(t, h, "business_booking.released", f.award.ID.String()) != 1 {
		t.Fatal("one released event")
	}
}

// businessTripFixture turns a business award into the amendment helpers'
// trip fixture.
func businessTripFixture(t *testing.T, h *testutil.Harness, f *businessTrip) *tripFixture {
	t.Helper()
	pin := h.Do(http.MethodGet, "/mp/requests/"+f.requestID+"/pin", f.rider, nil)
	requireStatus(t, pin, http.StatusOK)
	return &tripFixture{
		h: h, rider: f.rider, driver: f.driver, requestID: f.requestID, award: f.award, rideID: f.rideID,
		pin: decode(t, pin)["pin"].(string), reservation: f.reservation, amount: f.amount, seq: 4,
		position: testutil.PickupFixture(),
	}
}

// TestBusinessTripFareChangesStayWithinTheReservation: the organization's
// budget reserved the agreed fare and the contract has no reserve top-up, so
// a fare INCREASE on a business trip is refused before any money moves (no
// commission delta reserved, no rider funding touched); a committed DECREASE
// moves only the driver's commission by a linked refund, and completion
// commits the lower ACTUAL — agreed fare plus committed adjustments.
func TestBusinessTripFareChangesStayWithinTheReservation(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double,
		testutil.WithFlag(cityconfig.FlagMarketplaceMultiStop, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceTripAmendments, true))
	h.Clock.Set(fixedOffPeakHour)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	// Agreed at the top of the bounds, so a shorter route can lower it.
	quote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
	published := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "maximumFareMinor")),
		"paymentMethodId":    marketplace.PaymentMethodBusiness,
		"business":           map[string]any{"organizationId": org.orgID},
	}, move.IdempotencyHeader, idemKey())
	f := businessTripFixture(t, h, awardPublishedBusinessTrip(t, h, rider, published, "maximumFareMinor"))

	further := testutil.PlaceAt(testutil.DropoffFixture(), 1_500)
	raised := f.propose(f.rider, map[string]any{
		"stops":                 []map[string]any{},
		"dropoff":               map[string]any{"lat": further.Lat, "lng": further.Lng, "label": "Further"},
		"expectedRouteRevision": 1,
		"expectedFareRevision":  1,
	}, "")
	requireRefusalReason(t, raised, http.StatusConflict, domain.CodeConflict, marketplace.ReasonBusinessTopUpUnavailable)
	if h.Wallet.OpenDeltas(f.reservation) != 0 || h.Funding.TopUpCalls != 0 {
		t.Fatalf("nothing is reserved for a refused increase: deltas %d, top-ups %d", h.Wallet.OpenDeltas(f.reservation), h.Funding.TopUpCalls)
	}
	if fare, _, _, _ := f.rideTerms(t); fare != f.amount {
		t.Fatalf("the agreed fare stands: %d", fare)
	}

	pickup, dropoff := testutil.PickupFixture(), testutil.DropoffFixture()
	nearer := testutil.PickupFixture()
	nearer.Lat, nearer.Lng = pickup.Lat+(dropoff.Lat-pickup.Lat)*0.5, pickup.Lng+(dropoff.Lng-pickup.Lng)*0.5
	lowered := f.propose(f.rider, map[string]any{
		"stops":                 []map[string]any{},
		"dropoff":               map[string]any{"lat": nearer.Lat, "lng": nearer.Lng, "label": "Nearer"},
		"expectedRouteRevision": 1,
		"expectedFareRevision":  1,
	}, "")
	requireStatus(t, lowered, http.StatusCreated)
	amendment := decode(t, lowered)
	revised := moneyMinor(t, amendment, "revisedFareMinor")
	if revised >= f.amount {
		t.Fatalf("fixture: a nearer dropoff lowers the fare: %d >= %d", revised, f.amount)
	}
	if amendment["riderFunding"] != "not_required" {
		t.Fatalf("a business trip's change needs no rider funding: %v", amendment["riderFunding"])
	}
	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	committed := f.decide(f.driver, amendment, "approve", "")
	requireStatus(t, committed, http.StatusOK)
	if decode(t, committed)["state"] != machine.MpAmendmentCommitted {
		t.Fatalf("the decrease commits: %s", committed.Body.String())
	}
	if h.Funding.PartialReleaseCalls != 0 || h.Funding.Calls != 0 {
		t.Fatal("no rider funding leg exists on a business trip")
	}

	completeTrip(t, h, rider, f.driver, f.requestID, f.rideID, 40)
	reservation, _ := double.reservation(f.award.ID.String())
	if reservation.state != "committed" || reservation.committed == nil || *reservation.committed != revised || reservation.reserved != f.amount {
		t.Fatalf("the budget commits the ACTUAL (agreed fare + committed adjustments): %+v", reservation)
	}
	if double.balance(org.centreID) != 2_000_000-revised {
		t.Fatalf("the budget paid the actual only: %d", double.balance(org.centreID))
	}
	receipt := h.Do(http.MethodGet, "/mp/requests/"+f.requestID+"/receipt", rider, nil)
	requireStatus(t, receipt, http.StatusOK)
	if total := moneyMinor(t, decode(t, receipt), "totalMinor"); total != revised {
		t.Fatalf("the receipt reconciles with the commit: %d", total)
	}
}
