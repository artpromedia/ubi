package marketplace_test

import (
	"context"
	"net/http"
	"strings"
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

// TestBusinessDepartedBookerCannotCancelAColleaguesTrip (round-7 low): a
// booker who has left the organization cannot cancel the colleague's trip
// they booked. Their authority is re-checked at cancel time through the
// documented membership contract (payment-service's policy check,
// booker_not_authorized); the refusal moves nothing — the ride, the award
// and the budget reservation stand, the passenger can still decline from
// their trip link — and a booker who is still a member cancels as before.
// When membership cannot be read, nothing is cancelled either.
func TestBusinessDepartedBookerCannotCancelAColleaguesTrip(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double, testutil.WithFlag(cityconfig.FlagMarketplaceGuestBookings, true))
	f, org, token := guestBusinessTrip(t, h, double)
	double.removeMember(org.orgID, org.booker)
	checksBefore := double.callCount(businessPolicyPath)

	refused := h.Do(http.MethodPost, "/rides/"+f.rideID.String()+"/cancel", f.rider, map[string]any{"reasonCode": "changed_mind"})
	requireRefusalReason(t, refused, http.StatusForbidden, domain.CodeForbidden, marketplace.BusinessReasonCancelNotPermitted)
	if double.callCount(businessPolicyPath) != checksBefore+1 {
		t.Fatal("membership is checked at cancel time through the policy check")
	}
	checked := double.bodiesOf(businessPolicyPath)[checksBefore]
	if checked["bookerId"] != org.booker.String() || checked["travellerId"] != org.traveller.String() {
		t.Fatalf("the check names the cancelling booker and the colleague: %v", checked)
	}
	state, _, _, _, active := rideRow(t, h, f.rideID)
	if !active || state != machine.RiderDriverAssigned {
		t.Fatalf("the refused cancel leaves the trip running: %s active=%v", state, active)
	}
	if award := awardRow(t, h, f.requestID); award.State != machine.MpAwardConfirmed {
		t.Fatalf("the award stands: %s", award.State)
	}
	if booking := bookingRow(t, h, f.award.ID); booking.State != machine.MpBusinessReserved || booking.OwedOp != "" ||
		double.callCount(businessReleasePath) != 0 {
		t.Fatalf("nothing is released: %+v, %d releases", booking, double.callCount(businessReleasePath))
	}
	if h.Wallet.ReversalsByReservation[f.reservation] != 0 {
		t.Fatal("the driver's commission is untouched")
	}

	// The passenger's own right is unchanged: they decline from the link.
	requireStatus(t, tripAccess(t, h, http.MethodPost, "/mp/trip-access/decline", token, clientAddr(), move.IdempotencyHeader, idemKey()),
		http.StatusOK)
	if by := double.releasedBy(f.award.ID.String()); by != marketplace.BusinessPartyTraveller {
		t.Fatalf("the traveller's decline releases as the traveller: %q", by)
	}

	// A booker who is still a member cancels as before.
	member, _, _ := guestBusinessTrip(t, h, double)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+member.rideID.String()+"/cancel", member.rider,
		map[string]any{"reasonCode": "changed_mind"}), http.StatusOK)
	if by := double.releasedBy(member.award.ID.String()); by != marketplace.BusinessPartyBooker {
		t.Fatalf("a member booker's cancel releases as the booker: %q", by)
	}

	// Unreadable membership: fail closed, nothing cancelled.
	unreadable, _, _ := guestBusinessTrip(t, h, double)
	double.failBeforeHandling(businessPolicyPath, 1)
	blind := h.Do(http.MethodPost, "/rides/"+unreadable.rideID.String()+"/cancel", unreadable.rider, map[string]any{"reasonCode": "changed_mind"})
	requireRefusalReason(t, blind, http.StatusServiceUnavailable, domain.CodeServiceUnavailable, marketplace.ReasonBusinessCheckUnavailable)
	if _, _, _, _, active := rideRow(t, h, unreadable.rideID); !active {
		t.Fatal("an unverifiable cancel moves nothing")
	}
}

// TestBusinessReleaseFallsBackToTheSystemWhenTheBookerLeft: the booker was
// a member when they cancelled (the cancel-time check passed) but left
// before the owed release reached payment-service, which refuses the
// booker's release (cancel_not_permitted). The trip still ended without
// service, so the budget is released as the system under its own key —
// never stranded.
func TestBusinessReleaseFallsBackToTheSystemWhenTheBookerLeft(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double, testutil.WithFlag(cityconfig.FlagMarketplaceGuestBookings, true))
	f, org, _ := guestBusinessTrip(t, h, double)
	double.leaveWhenReleased(org.orgID, org.booker)

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

const businessTopUpPath = "/v1/finance/business/reserve-top-up"

// businessAmendTrip awards a business trip at the TOP of its bounds (so a
// shorter route can lower it) on a harness with multi-stop and trip
// amendments on.
func businessAmendTrip(t *testing.T, double *businessDouble, budget int64) (*testutil.Harness, *tripFixture, *orgFixture) {
	t.Helper()
	h := businessHarness(t, double,
		testutil.WithFlag(cityconfig.FlagMarketplaceMultiStop, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceTripAmendments, true))
	h.Clock.Set(fixedOffPeakHour)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, budget)
	quote := quoteEnvelope(t, h, rider, testutil.PickupFixture(), testutil.DropoffFixture())
	published := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "maximumFareMinor")),
		"paymentMethodId":    marketplace.PaymentMethodBusiness,
		"business":           map[string]any{"organizationId": org.orgID},
	}, move.IdempotencyHeader, idemKey())
	return h, businessTripFixture(t, h, awardPublishedBusinessTrip(t, h, rider, published, "maximumFareMinor")), org
}

// furtherDropoff proposes a longer route: the fare rises.
func (f *tripFixture) furtherDropoff(t *testing.T) map[string]any {
	t.Helper()
	further := testutil.PlaceAt(testutil.DropoffFixture(), 1_500)
	proposed := f.propose(f.rider, map[string]any{
		"stops":                 []map[string]any{},
		"dropoff":               map[string]any{"lat": further.Lat, "lng": further.Lng, "label": "Further"},
		"expectedRouteRevision": 1,
		"expectedFareRevision":  1,
	}, "")
	requireStatus(t, proposed, http.StatusCreated)
	return decode(t, proposed)
}

// TestBusinessFareIncreaseRaisesTheReservationFirst: an approved fare
// increase on a business trip raises the organization's reservation through
// payment-service's reserve top-up BEFORE the raised total commits — under
// business:<award>:topup:<amendment>, the increase only, reason
// fare_increase — exactly once across a lost answer (the sweep re-sends the
// SAME key and terms, payment-service replays). The driver's commission
// increment is captured once, no rider funding is touched, and completion
// commits the higher actual within the raised reservation.
func TestBusinessFareIncreaseRaisesTheReservationFirst(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h, f, org := businessAmendTrip(t, double, 2_000_000)
	amendment := f.furtherDropoff(t)
	id := amendment["amendmentId"].(string)
	revised := moneyMinor(t, amendment, "revisedFareMinor")
	if revised <= f.amount || amendment["riderFunding"] != "not_required" || amendment["state"] != machine.MpAmendmentAwaiting {
		t.Fatalf("fixture: a business increase awaits approvals with no rider funding: %v", amendment)
	}
	if double.callCount(businessTopUpPath) != 0 {
		t.Fatal("nothing is raised before both parties approve")
	}
	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	// The first answer is lost for good (net/http re-sends once itself).
	double.dropAfterRecording(businessTopUpPath, 2)
	f.park(t, f.position, 30*time.Second)
	paused := f.decide(f.driver, amendment, "approve", "")
	requireStatus(t, paused, http.StatusOK)
	if row := f.amendmentRow(t, id); row.State != machine.MpAmendmentAwaiting || row.FundingDone {
		t.Fatalf("an unknown top-up parks the commit; nothing committed: %s funding=%v", row.State, row.FundingDone)
	}
	if fare, _, _, _ := f.rideTerms(t); fare != f.amount {
		t.Fatal("the original agreement stands while the raise is unconfirmed")
	}

	h.Clock.Advance(10 * time.Minute)
	sweepOnce(t, h)
	row := f.amendmentRow(t, id)
	if row.State != machine.MpAmendmentCommitted {
		t.Fatalf("the sweep re-sends the same raise and commits: %s (%s)", row.State, row.LastError)
	}
	key := "business:" + f.award.ID.String() + ":topup:" + id
	for _, sent := range double.keysOf(businessTopUpPath) {
		if sent != key {
			t.Fatalf("every send carries the amendment's one key: %s", sent)
		}
	}
	bodies := double.bodiesOf(businessTopUpPath)
	for _, body := range bodies {
		if body["bookingRef"] != f.award.ID.String() || int64(body["amountMinor"].(float64)) != revised-f.amount ||
			body["reason"] != marketplace.BusinessIncreaseFareIncrease || body["reasonRef"] != id || body["currency"] != testCurrency {
			t.Fatalf("the INCREASE, named by the amendment, with identical terms on every send: %v", body)
		}
	}
	if len(bodies) < 2 || double.topUpCount(f.award.ID.String()) != 1 {
		t.Fatalf("re-sent, raised once: %d sends, %d raises", len(bodies), double.topUpCount(f.award.ID.String()))
	}
	reservation, _ := double.reservation(f.award.ID.String())
	if booking := bookingRow(t, h, f.award.ID); booking.ReservedMinor != revised || reservation.reserved != revised {
		t.Fatalf("the raised reservation covers the new total: booking %d, payment-service %d, want %d",
			booking.ReservedMinor, reservation.reserved, revised)
	}
	if outboxCount(t, h, "business_booking.reserve_increased", f.award.ID.String()) != 1 ||
		auditCount(t, h, "business_booking.reserve_increased", f.award.ID.String()) != 1 {
		t.Fatal("the raise is evented and audited once")
	}
	if h.Wallet.DeltaCapturesByAmendment[id] != 1 || h.Funding.TopUpCalls != 0 || h.Funding.Calls != 0 {
		t.Fatalf("the commission increment is captured once; no rider funding: %d / %d / %d",
			h.Wallet.DeltaCapturesByAmendment[id], h.Funding.TopUpCalls, h.Funding.Calls)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.outbox_events WHERE name LIKE 'mp.%' AND payload::text LIKE '%' || $1 || '%'`, org.orgID); n != 0 {
		t.Fatalf("no mp.* event (fanned out to drivers) names the organization: %d", n)
	}
	sends := double.callCount(businessTopUpPath)
	sweepOnce(t, h)
	if double.callCount(businessTopUpPath) != sends {
		t.Fatal("a committed raise is never sent again")
	}

	completeTrip(t, h, f.rider, f.driver, f.requestID, f.rideID, 40)
	reservation, _ = double.reservation(f.award.ID.String())
	if reservation.state != "committed" || reservation.committed == nil || *reservation.committed != revised {
		t.Fatalf("completion commits the higher actual within the raised reservation: %+v", reservation)
	}
	if double.balance(org.centreID) != 2_000_000-revised {
		t.Fatalf("the budget paid the raised actual: %d", double.balance(org.centreID))
	}
}

// TestBusinessTripFareChangesStayWithinTheReservation: without budget for
// it, an approved increase is REFUSED by payment-service's top-up (never on
// credit): the amendment fails into compensation — the driver's commission
// increment released, nothing charged, the original agreement kept — and
// the approving party is told why. A committed DECREASE moves only the
// driver's commission by a linked refund and raises nothing; completion
// commits the lower ACTUAL — agreed fare plus committed adjustments.
func TestBusinessTripFareChangesStayWithinTheReservation(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h, f, org := businessAmendTrip(t, double, 2_000_000)
	// The cost centre's budget now holds exactly the reservation.
	double.setBudget(org.centreID, f.amount)

	raised := f.furtherDropoff(t)
	requireStatus(t, f.decide(f.rider, raised, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	// The DRIVER's approval runs the commit: they are told the change was not
	// funded and the trip continues — never the organization's code, reason
	// or budget (BUSINESS_VISIBILITY).
	refused := f.decide(f.driver, raised, "approve", "")
	requireRefusalReason(t, refused, http.StatusConflict, domain.CodeConflict, "funding_refused")
	body := decode(t, refused)
	if details := body["details"].(map[string]any); details["amendmentState"] != machine.MpAmendmentCompensated ||
		details["stage"] != nil || details["topUp"] != nil ||
		!strings.Contains(body["message"].(string), "continues on the agreed terms") {
		t.Fatalf("the driver's refusal keeps the agreement and explains it neutrally: %v", body)
	}
	for _, leak := range []string{"business", "budget", "organization", org.orgID} {
		if strings.Contains(refused.Body.String(), leak) {
			t.Fatalf("the driver's refusal never mentions %q: %s", leak, refused.Body.String())
		}
	}
	row := f.amendmentRow(t, raised["amendmentId"].(string))
	if row.State != machine.MpAmendmentCompensated || row.Reason != "funding_business_budget_insufficient" {
		t.Fatalf("the amendment names the organization's refusal: %s / %s", row.State, row.Reason)
	}
	amendmentPath := f.path("/amendments/" + row.ID.String())
	if seen := decode(t, h.Do(http.MethodGet, amendmentPath, f.driver, nil))["reason"]; seen != "funding_refused" {
		t.Fatalf("the driver's view reads funding_refused: %v", seen)
	}
	if seen := decode(t, h.Do(http.MethodGet, amendmentPath, f.rider, nil))["reason"]; seen != "funding_business_budget_insufficient" {
		t.Fatalf("the booker's own view names the organization's refusal: %v", seen)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.outbox_events WHERE name = 'mp.amendment.failed'
		AND payload->>'amendmentId' = $1 AND payload->>'reason' = 'funding_refused'`, row.ID.String()); n != 1 {
		t.Fatalf("the shared mp.amendment.failed event reads funding_refused: %d", n)
	}
	if n := countRows(t, h, `SELECT COUNT(*) FROM public.outbox_events WHERE name LIKE 'mp.%'
		AND payload->>'awardId' = $1 AND (payload::text LIKE '%budget%' OR payload::text LIKE '%business%')`, f.award.ID.String()); n != 0 {
		t.Fatalf("no mp.* event (fanned out to the driver) mentions the organization's budget: %d", n)
	}

	// The BOOKER's approval runs the commit of a second attempt: they are
	// told the organization's reason and that the agreement stands.
	again := f.furtherDropoff(t)
	f.park(t, f.position, 30*time.Second)
	requireStatus(t, f.decide(f.driver, again, "approve", ""), http.StatusOK)
	riderRefused := f.decide(f.rider, again, "approve", "")
	requireRefusalReason(t, riderRefused, http.StatusUnprocessableEntity, domain.CodeInsufficientSpendable, marketplace.BusinessReasonBudgetInsufficient)
	riderBody := decode(t, riderRefused)
	if details := riderBody["details"].(map[string]any); details["amendmentState"] != machine.MpAmendmentCompensated ||
		details["stage"] != marketplace.BusinessIncreaseFareIncrease ||
		!strings.Contains(riderBody["message"].(string), "continues on the agreed terms") {
		t.Fatalf("the booker's refusal keeps the agreement and explains it: %v", riderBody)
	}
	if fare, _, _, _ := f.rideTerms(t); fare != f.amount {
		t.Fatalf("the agreed fare stands: %d", fare)
	}
	if h.Wallet.OpenDeltas(f.reservation) != 0 || h.Wallet.DeltaCapturesByAmendment[row.ID.String()] != 0 || h.Funding.TopUpCalls != 0 {
		t.Fatalf("the commission increment is released, never captured; no rider funding: deltas %d", h.Wallet.OpenDeltas(f.reservation))
	}
	reservation, _ := double.reservation(f.award.ID.String())
	if booking := bookingRow(t, h, f.award.ID); booking.ReservedMinor != f.amount || reservation.reserved != f.amount ||
		double.topUpCount(f.award.ID.String()) != 0 {
		t.Fatalf("a refused raise changes no reservation: %d / %d", booking.ReservedMinor, reservation.reserved)
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
	if h.Funding.PartialReleaseCalls != 0 || h.Funding.Calls != 0 || double.callCount(businessTopUpPath) != 2 {
		t.Fatal("no rider funding leg exists on a business trip, and a decrease raises nothing")
	}

	completeTrip(t, h, f.rider, f.driver, f.requestID, f.rideID, 40)
	reservation, _ = double.reservation(f.award.ID.String())
	if reservation.state != "committed" || reservation.committed == nil || *reservation.committed != revised || reservation.reserved != f.amount {
		t.Fatalf("the budget commits the ACTUAL (agreed fare + committed adjustments): %+v", reservation)
	}
	if double.balance(org.centreID) != f.amount-revised {
		t.Fatalf("the budget paid the actual only: %d", double.balance(org.centreID))
	}
	receipt := h.Do(http.MethodGet, "/mp/requests/"+f.requestID+"/receipt", f.rider, nil)
	requireStatus(t, receipt, http.StatusOK)
	if total := moneyMinor(t, decode(t, receipt), "totalMinor"); total != revised {
		t.Fatalf("the receipt reconciles with the commit: %d", total)
	}
}

// TestBusinessPaidWaitingRaisesTheReservation: paid waiting at a stop of a
// business trip settles through its pre-authorized adjustment, whose
// funding leg raises the organization's reservation by the waiting fee
// (reason paid_waiting, named by the waiting adjustment) before it commits;
// completion commits the fare plus the waiting.
func TestBusinessPaidWaitingRaisesTheReservation(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double,
		testutil.WithFlag(cityconfig.FlagMarketplaceMultiStop, true),
		testutil.WithFlag(cityconfig.FlagMarketplaceTripAmendments, true))
	h.Clock.Set(fixedOffPeakHour)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	pickup, dropoff, firstPlace, _ := stopFixtures()
	recorder := quoteStops(t, h, rider, pickup, dropoff, []map[string]any{firstStopInput()})
	requireStatus(t, recorder, http.StatusOK)
	quote := decode(t, recorder)
	published := h.Do(http.MethodPost, "/mp/requests", rider, map[string]any{
		"quoteId":            quote["quoteId"],
		"requestedFareMinor": moneyBody(moneyMinor(t, quote, "minimumFareMinor")),
		"paymentMethodId":    marketplace.PaymentMethodBusiness,
		"business":           map[string]any{"organizationId": org.orgID},
	}, move.IdempotencyHeader, idemKey())
	requireStatus(t, published, http.StatusCreated)
	stops := routeStops(t, decode(t, published))
	f := businessTripFixture(t, h, awardPublishedBusinessTrip(t, h, rider, published, "minimumFareMinor"))
	stopID := stops[0]["stopId"].(string)

	f.start(t)
	f.moveTo(t, firstPlace, 5*time.Minute)
	requireStatus(t, f.stopPost(f.driver, stopID, "arrive", map[string]any{}, ""), http.StatusOK)
	h.Clock.Advance(270 * time.Second)
	sweepOnce(t, h)
	requireStatus(t, f.stopPost(f.driver, stopID, "depart", nil, ""), http.StatusOK)
	h.Clock.Advance(time.Minute)
	sweepOnce(t, h)

	waiting := waitingAmendments(t, f)
	if len(waiting) != 1 || waiting[0].State != machine.MpAmendmentCommitted {
		t.Fatalf("the waiting adjustment commits: %+v", waiting)
	}
	fee := waiting[0].RevisedFareMinor - waiting[0].PriorFareMinor
	bodies := double.bodiesOf(businessTopUpPath)
	if fee <= 0 || len(bodies) != 1 || int64(bodies[0]["amountMinor"].(float64)) != fee ||
		bodies[0]["reason"] != marketplace.BusinessIncreasePaidWaiting || bodies[0]["reasonRef"] != waiting[0].ID.String() {
		t.Fatalf("paid waiting raises the reservation by the fee, named by its adjustment: fee %d, %v", fee, bodies)
	}
	if booking := bookingRow(t, h, f.award.ID); booking.ReservedMinor != f.amount+fee {
		t.Fatalf("the reservation covers the fare and the waiting: %d", booking.ReservedMinor)
	}
	f.complete(t)
	reservation, _ := double.reservation(f.award.ID.String())
	if reservation.state != "committed" || reservation.committed == nil || *reservation.committed != f.amount+fee {
		t.Fatalf("completion commits the fare plus the waiting: %+v", reservation)
	}
}
