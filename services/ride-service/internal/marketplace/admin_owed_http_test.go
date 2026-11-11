package marketplace_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// Round-9 admin surfaces for the round-8 admin screens: the widened,
// redacted request timeline, the owed-work boards with their explicit
// retries, currency on recovery rows and a funding marker on pending sagas.

// TestRound9AdminSurfacesRefuseNonAdmin: every new admin surface, and the
// timeline it widened, refuses a rider and a driver; read-only specialist
// operator roles may read GETs but are refused on POST commands.
func TestRound9AdminSurfacesRefuseNonAdmin(t *testing.T) {
	h := newHarness(t)
	someID := uuid.New().String()
	for _, actor := range []testutil.Actor{h.Rider(), h.Driver()} {
		for _, c := range []struct {
			method, path string
			body         any
		}{
			{http.MethodGet, "/admin/mp/business-bookings?owed=true", nil},
			{http.MethodPost, "/admin/mp/business-bookings/" + someID + "/retry", map[string]any{"dryRun": true}},
			{http.MethodGet, "/admin/mp/delivery-cancellations?state=pending", nil},
			{http.MethodPost, "/admin/mp/delivery-cancellations/" + someID + "/retry", map[string]any{"dryRun": true}},
			{http.MethodGet, "/admin/mp/offroad-flags", nil},
			{http.MethodPost, "/admin/mp/offroad-flags/" + someID + "/decide", map[string]any{"decision": "dismiss", "reason": "checked"}},
			{http.MethodGet, "/admin/mp/requests/" + someID + "/timeline", nil},
		} {
			requireCode(t, h.Do(c.method, c.path, actor, c.body, move.IdempotencyHeader, idemKey()),
				http.StatusForbidden, domain.CodeForbidden)
		}
	}
	readOnlyOp := testutil.Actor{UserID: uuid.New(), Role: "support_agent", CityID: h.CityID}
	requireStatus(t, h.Do(http.MethodGet, "/admin/mp/offroad-flags", readOnlyOp, nil), http.StatusOK)
	requireCode(t, h.Do(http.MethodPost, "/admin/mp/offroad-flags/"+someID+"/decide", readOnlyOp,
		map[string]any{"decision": "dismiss", "reason": "checked"}, move.IdempotencyHeader, idemKey()),
		http.StatusForbidden, domain.CodeForbidden)
	requireCode(t, h.Do(http.MethodPost, "/admin/mp/business-bookings/"+someID+"/retry", readOnlyOp,
		map[string]any{"dryRun": true}),
		http.StatusForbidden, domain.CodeForbidden)

	admin := adminActor(h)
	requireCode(t, h.Do(http.MethodGet, "/admin/mp/business-bookings?owed=maybe", admin, nil),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	requireCode(t, h.Do(http.MethodGet, "/admin/mp/delivery-cancellations?state=lost", admin, nil),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	requireCode(t, h.Do(http.MethodGet, "/admin/mp/offroad-flags?trigger=parked", admin, nil),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	requireCode(t, h.Do(http.MethodGet, "/admin/mp/offroad-flags?since=yesterday", admin, nil),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	requireCode(t, h.Do(http.MethodPost, "/admin/mp/business-bookings/"+someID+"/retry", admin, map[string]any{"dryRun": true}),
		http.StatusNotFound, domain.CodeNotFound)
}

// TestAdminTimelineLinksTheRequestAndRedacts: the request timeline now
// carries the trip_access.*, business_booking.* and ride.* rows linked to
// the request, and never shows an operator the sealed trip-link envelope,
// its SMS copy, a coordinate, the raw link token or a phone — whatever the
// payloads hold (the test first proves the outbox DOES hold them). The
// resolution view's events are redacted the same way.
func TestAdminTimelineLinksTheRequestAndRedacts(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double, testutil.WithFlag(cityconfig.FlagMarketplaceGuestBookings, true))
	f, _, token := guestBusinessTrip(t, h, double)
	admin := adminActor(h)

	var tokenID string
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT id::text FROM mp.trip_access_tokens WHERE request_id = $1`, uuid.MustParse(f.requestID)).Scan(&tokenID); err != nil {
		t.Fatal(err)
	}
	issued := outboxPayload(t, h, "trip_access.issued", tokenID)
	envelope, _ := issued["sealed"].(map[string]any)
	sealed, _ := envelope["ct"].(string)
	sealedIV, _ := envelope["iv"].(string)
	sealedTag, _ := envelope["tag"].(string)
	smsCopy, _ := issued["smsCopy"].(string)
	if sealed == "" || sealedIV == "" || sealedTag == "" || smsCopy == "" || token == "" {
		t.Fatalf("fixture: the outbox holds the sealed envelope, its SMS copy and a link token: %v", issued)
	}
	requested := outboxPayload(t, h, "ride.requested", f.rideID.String())
	pickup := testutil.PickupFixture()
	lat := formatCoord(pickup.Lat)
	raw, _ := json.Marshal(requested)
	if !strings.Contains(string(raw), lat) {
		t.Fatalf("fixture: ride.requested carries coordinates: %s", raw)
	}

	recorder := h.Do(http.MethodGet, "/admin/mp/requests/"+f.requestID+"/timeline", admin, nil)
	requireStatus(t, recorder, http.StatusOK)
	var timeline marketplace.AdminTimeline
	h.DecodeBody(recorder, &timeline)
	types := map[string]bool{}
	for _, event := range timeline.Events {
		types[event.Type] = true
	}
	for _, want := range []string{"mp.request.published", "mp.award.confirmed", "trip_access.issued",
		"business_booking.reserved", "ride.requested", "ride.assigned"} {
		if !types[want] {
			t.Fatalf("the timeline links %s to the request: %v", want, types)
		}
	}
	resolution := h.Do(http.MethodGet, "/admin/mp/requests/"+f.requestID+"/resolution", admin, nil)
	requireStatus(t, resolution, http.StatusOK)
	for label, body := range map[string]string{"timeline": recorder.Body.String(), "resolution": resolution.Body.String()} {
		for what, secret := range map[string]string{
			"the sealed ciphertext": sealed, "the sealed IV": sealedIV, "the sealed tag": sealedTag,
			"the SMS copy": smsCopy, "the raw link token": token,
			"the passenger's phone": guestPhone, "a phone's national digits": strings.TrimPrefix(guestPhone, "+234"),
			"a coordinate": lat, "the other coordinate": formatCoord(pickup.Lng),
		} {
			if strings.Contains(body, secret) {
				t.Fatalf("the %s never shows %s", label, what)
			}
		}
	}
	for _, event := range timeline.Events {
		var detail map[string]any
		if err := json.Unmarshal([]byte(event.Detail), &detail); err != nil {
			t.Fatalf("%s: the redacted detail is JSON: %q", event.Type, event.Detail)
		}
		requireRedactedValues(t, event.Type, detail)
		if event.Type == "trip_access.issued" && (detail["sealed"] != "[redacted]" || detail["smsCopy"] != "[redacted]" ||
			detail["tokenId"] != tokenID) {
			t.Fatalf("the sealed payload and SMS copy are redacted, the token's id stays: %v", detail)
		}
	}
}

// TestAdminBusinessBookingsOwedWithRetry: a booking whose release is owed
// across a payment-service outage is listed with ?owed=true; a dry run
// previews the retry and sends nothing; the apply needs an Idempotency-Key
// and the attempts the operator saw, drives the SAME release under the
// award's one key, resolves once, is audited and replays; afterwards
// nothing is owed.
func TestAdminBusinessBookingsOwedWithRetry(t *testing.T) {
	double := newBusinessDouble(t, businessServiceKey)
	h := businessHarness(t, double)
	rider := h.Rider()
	org := double.seedOrg(rider.UserID, uuid.New(), 5_000_000, 2_000_000)
	f := awardBusinessTrip(t, h, rider, map[string]any{"organizationId": org.orgID}, nil)
	other := h.Rider()
	otherOrg := double.seedOrg(other.UserID, uuid.New(), 5_000_000, 2_000_000)
	settled := awardBusinessTrip(t, h, other, map[string]any{"organizationId": otherOrg.orgID}, nil)
	double.failBeforeHandling(businessReleasePath, 1)
	double.failBeforeHandling(businessStatusPath, 1)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideID.String()+"/cancel", rider,
		map[string]any{"reasonCode": "changed_mind"}), http.StatusOK)
	admin := adminActor(h)

	list := h.Do(http.MethodGet, "/admin/mp/business-bookings?owed=true&cityId="+h.CityID, admin, nil)
	requireStatus(t, list, http.StatusOK)
	var page marketplace.BusinessBookingsPage
	h.DecodeBody(list, &page)
	if len(page.Rows) != 1 || page.Rows[0].AwardID != f.award.ID.String() || page.Rows[0].OwedOp != "release" ||
		page.Rows[0].ReservedMinor.AmountMinor != f.award.FareMinor || page.Rows[0].ReservedMinor.Currency != testCurrency {
		t.Fatalf("only the owing booking is listed, with its owed op and money: %+v", page.Rows)
	}
	all := h.Do(http.MethodGet, "/admin/mp/business-bookings?cityId="+h.CityID, admin, nil)
	requireStatus(t, all, http.StatusOK)
	if raw := all.Body.String(); !strings.Contains(raw, settled.award.ID.String()) || strings.Contains(raw, rider.UserID.String()) {
		t.Fatalf("without owed every booking is listed, naming no person: %s", raw)
	}
	row := page.Rows[0]
	path := "/admin/mp/business-bookings/" + f.award.ID.String() + "/retry"
	sends := double.callCount(businessReleasePath)

	preview := h.Do(http.MethodPost, path, admin, map[string]any{"dryRun": true})
	requireStatus(t, preview, http.StatusOK)
	var previewed marketplace.BusinessRetryResult
	h.DecodeBody(preview, &previewed)
	if previewed.Outcome != marketplace.OwedRetryPreview || !strings.Contains(previewed.Detail, "business:"+f.award.ID.String()+":release") ||
		double.callCount(businessReleasePath) != sends {
		t.Fatalf("a dry run previews and sends nothing: %+v", previewed)
	}
	// Missing Idempotency-Key or missing/blank reason is refused before mutating anything.
	requireCode(t, h.Do(http.MethodPost, path, admin, map[string]any{"expectedAttempts": row.Attempts, "reason": "payment-service back"}),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	requireCode(t, h.Do(http.MethodPost, path, admin, map[string]any{"expectedAttempts": row.Attempts, "reason": "   "}, move.IdempotencyHeader, idemKey()),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	requireCode(t, h.Do(http.MethodPost, path, admin, map[string]any{"expectedAttempts": row.Attempts + 7, "reason": "payment-service back"}, move.IdempotencyHeader, idemKey()),
		http.StatusConflict, domain.CodeVersionConflict)
	key := idemKey()
	retryReason := "payment-service budget release recovered after outage"
	applied := h.Do(http.MethodPost, path, admin, map[string]any{"expectedAttempts": row.Attempts, "reason": retryReason}, move.IdempotencyHeader, key)
	requireStatus(t, applied, http.StatusOK)
	var result marketplace.BusinessRetryResult
	h.DecodeBody(applied, &result)
	if result.Outcome != marketplace.OwedRetryResolved || result.Row.OwedOp != "" || result.Row.State != machine.MpBusinessReleased {
		t.Fatalf("the retry resolves the owed release: %+v", result)
	}
	if keys := double.keysOf(businessReleasePath); keys[len(keys)-1] != "business:"+f.award.ID.String()+":release" {
		t.Fatalf("the retry uses the award's one release key: %v", keys)
	}
	if auditCount(t, h, "mp.admin.business_op_retry", f.award.ID.String()) != 1 {
		t.Fatal("the retry is audited once")
	}
	var auditedReason string
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COALESCE(reason, '') FROM public.audit_log WHERE action = 'mp.admin.business_op_retry' AND subject_id = $1`,
		f.award.ID.String()).Scan(&auditedReason); err != nil || auditedReason != retryReason {
		t.Fatalf("audit_log records the operator's reason %q, got %q (err=%v)", retryReason, auditedReason, err)
	}
	replay := h.Do(http.MethodPost, path, admin, map[string]any{"expectedAttempts": row.Attempts, "reason": retryReason}, move.IdempotencyHeader, key)
	requireStatus(t, replay, http.StatusOK)
	if replay.Body.String() != applied.Body.String() || auditCount(t, h, "mp.admin.business_op_retry", f.award.ID.String()) != 1 {
		t.Fatal("a replayed retry answers the recorded result and moves nothing")
	}
	again := h.Do(http.MethodPost, path, admin, map[string]any{"expectedAttempts": row.Attempts, "reason": retryReason}, move.IdempotencyHeader, idemKey())
	requireStatus(t, again, http.StatusOK)
	var nothing marketplace.BusinessRetryResult
	h.DecodeBody(again, &nothing)
	if nothing.Outcome != marketplace.OwedRetryNothingOwed || double.releasedBy(f.award.ID.String()) != marketplace.BusinessPartyTraveller {
		t.Fatalf("once settled nothing is owed and nothing is sent: %+v", nothing)
	}
	if list := h.Do(http.MethodGet, "/admin/mp/business-bookings?owed=true&cityId="+h.CityID, admin, nil); strings.Contains(list.Body.String(), f.award.ID.String()) {
		t.Fatal("a settled booking leaves the owed board")
	}
}

// TestAdminDeliveryCancellationsPendingWithRetry: a queued delivery's
// cancellation owed while delivery-service does not serve the route is on
// the pending board; a dry run previews; once the route exists the retry
// drives the SAME runner and resolves it (cancelled), audited with reason.
func TestAdminDeliveryCancellationsPendingWithRetry(t *testing.T) {
	double := newDeliveryDouble(t, deliveryTestKey)
	h := newHarness(t,
		testutil.WithFlag(cityconfig.FlagMarketplaceQueuedJobs, true),
		testutil.WithDeliveryAssign(marketplace.NewHTTPDeliveryAssign(double.url(), deliveryTestKey, nil)))
	h.Clock.Set(fixedOffPeakHour)
	award, driver, _ := queuedDeliveryAward(t, h, double)
	driverDropsOffline(t, h, driver)
	sweepOnce(t, h)
	admin := adminActor(h)

	list := h.Do(http.MethodGet, "/admin/mp/delivery-cancellations?state=pending&cityId="+h.CityID, admin, nil)
	requireStatus(t, list, http.StatusOK)
	var page marketplace.DeliveryCancellationsPage
	h.DecodeBody(list, &page)
	if len(page.Rows) != 1 || page.Rows[0].AwardID != award.ID.String() || page.Rows[0].State != marketplace.DeliveryCancelPending ||
		page.Rows[0].DeliveryID != award.ExecutionID.String() || page.Rows[0].Attempts < 1 {
		t.Fatalf("the owed cancellation is on the pending board: %+v", page.Rows)
	}
	row := page.Rows[0]
	path := "/admin/mp/delivery-cancellations/" + award.ID.String() + "/retry"
	calls, _, _ := double.cancelSnapshot()
	preview := h.Do(http.MethodPost, path, admin, map[string]any{"dryRun": true})
	requireStatus(t, preview, http.StatusOK)
	var previewed marketplace.DeliveryCancelRetryResult
	h.DecodeBody(preview, &previewed)
	if after, _, _ := double.cancelSnapshot(); previewed.Outcome != marketplace.OwedRetryPreview || after != calls {
		t.Fatalf("a dry run sends nothing: %+v (%d → %d calls)", previewed, calls, after)
	}

	double.deployCancel()
	requireCode(t, h.Do(http.MethodPost, path, admin, map[string]any{"expectedAttempts": row.Attempts}, move.IdempotencyHeader, idemKey()),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
	cancelRetryReason := "delivery-service cancel route deployed"
	applied := h.Do(http.MethodPost, path, admin, map[string]any{"expectedAttempts": row.Attempts, "reason": cancelRetryReason}, move.IdempotencyHeader, idemKey())
	requireStatus(t, applied, http.StatusOK)
	var result marketplace.DeliveryCancelRetryResult
	h.DecodeBody(applied, &result)
	if result.Outcome != marketplace.OwedRetryResolved || result.Row.State != marketplace.DeliveryCancelCancelled {
		t.Fatalf("the retry cancels the delivery: %+v", result)
	}
	if _, cancelled, _ := double.cancelSnapshot(); cancelled != 1 {
		t.Fatalf("one effective cancellation: %d", cancelled)
	}
	if auditCount(t, h, "mp.admin.delivery_cancel_retry", award.ID.String()) != 1 {
		t.Fatal("the retry is audited")
	}
	var auditedCancelReason string
	if err := h.Pool.QueryRow(context.Background(),
		`SELECT COALESCE(reason, '') FROM public.audit_log WHERE action = 'mp.admin.delivery_cancel_retry' AND subject_id = $1`,
		award.ID.String()).Scan(&auditedCancelReason); err != nil || auditedCancelReason != cancelRetryReason {
		t.Fatalf("audit_log records the operator's delivery retry reason %q, got %q (err=%v)", cancelRetryReason, auditedCancelReason, err)
	}
	pending := h.Do(http.MethodGet, "/admin/mp/delivery-cancellations?state=pending&cityId="+h.CityID, admin, nil)
	if strings.Contains(pending.Body.String(), award.ID.String()) {
		t.Fatal("a resolved cancellation leaves the pending board")
	}
}

// TestAdminRecoveryCarriesCurrencyAndSagasTheirFunding: a recovery row names
// its money's currency; a pending saga names who funds its award — business
// when an organization's budget does.
func TestAdminRecoveryCarriesCurrencyAndSagasTheirFunding(t *testing.T) {
	h := newHarness(t)
	rider, driver := h.Rider(), h.Driver()
	admin := adminActor(h)
	view, _ := publishAt(t, h, rider, 0)
	requestID := view["requestId"].(string)
	parkDriver(t, h, driver, testutil.PickupFixture())
	h.Wallet.SetSpendable(driver.UserID, 1_000_000)
	created := submitBid(t, h, driver, requestID, moneyMinor(t, view, "minimumFareMinor"), "")
	requireStatus(t, created, http.StatusCreated)
	bid := decode(t, created)
	h.Wallet.FailRelease = errors.New("wallet down")
	requireStatus(t, h.Do(http.MethodPost, "/mp/bids/"+bid["bidId"].(string)+"/withdraw", driver, nil,
		move.IdempotencyHeader, idemKey()), http.StatusOK)
	h.Wallet.FailRelease = nil
	list := h.Do(http.MethodGet, "/admin/mp/recoveries", admin, nil)
	requireStatus(t, list, http.StatusOK)
	var recoveries marketplace.RecoveriesPage
	h.DecodeBody(list, &recoveries)
	found := false
	for _, row := range recoveries.Rows {
		if row.ReservationID == bid["reservationId"] {
			found = true
			if row.Currency != testCurrency {
				t.Fatalf("the recovery names its currency: %+v", row)
			}
		}
	}
	if !found {
		t.Fatalf("the recovery is listed: %+v", recoveries.Rows)
	}

	_, _, stalled := stallCaptureAward(t, h)
	sagas := h.Do(http.MethodGet, "/admin/mp/pending-sagas?cityId="+h.CityID, admin, nil)
	requireStatus(t, sagas, http.StatusOK)
	var page marketplace.PendingSagasPage
	h.DecodeBody(sagas, &page)
	award := awardRow(t, h, stalled)
	for _, row := range page.Rows {
		if row.AwardID == award.ID.String() && row.FundingSource != marketplace.FundingSourceRider {
			t.Fatalf("a personal wallet award is rider-funded: %+v", row)
		}
	}

	double := newBusinessDouble(t, businessServiceKey)
	b := businessHarness(t, double)
	booker := b.Rider()
	org := double.seedOrg(booker.UserID, uuid.New(), 5_000_000, 2_000_000)
	double.dropAfterRecording(businessReservePath, 2)
	double.failBeforeHandling(businessStatusPath, 1)
	parked := awardBusinessTrip(t, b, booker, map[string]any{"organizationId": org.orgID}, nil)
	if parked.award.State != machine.MpAwardPending {
		t.Fatalf("fixture: the business award is parked at funding: %s", parked.award.State)
	}
	businessSagas := b.Do(http.MethodGet, "/admin/mp/pending-sagas?cityId="+b.CityID, adminActor(b), nil)
	requireStatus(t, businessSagas, http.StatusOK)
	var businessPage marketplace.PendingSagasPage
	b.DecodeBody(businessSagas, &businessPage)
	if len(businessPage.Rows) != 1 || businessPage.Rows[0].AwardID != parked.award.ID.String() ||
		businessPage.Rows[0].FundingSource != marketplace.FundingSourceBusiness || businessPage.Rows[0].Step != marketplace.AttemptStepFunding {
		t.Fatalf("the stuck business saga carries the business funding marker: %+v", businessPage.Rows)
	}
}

// TestAdminOffroadFlagsReadDecideAndTimeline (CC-A04 / P2-02 backend):
//   - GET /v1/admin/mp/offroad-flags lists flags with city/vehicle/trigger/since filters;
//   - POST /v1/admin/mp/offroad-flags/{flagId}/decide records dismiss, warn_fleet,
//     or escalate_to_standing with required reason, Idempotency-Key replay,
//     audit row, and maker-checker standing escalation;
//   - GET /v1/admin/mp/requests/{requestId}/timeline includes vehicle_occupancy.*
//     rows when linked to the request.
func TestAdminOffroadFlagsReadDecideAndTimeline(t *testing.T) {
	double := newFleetDouble(t)
	h := fleetHarness(t, double)
	vehicleA := fleetVehicle(h, double, "a")
	vehicleB := fleetVehicle(h, double, "b")

	// 1. Live trip on vehicleA reported off-road after award → trip_started flag + request timeline link.
	rider := h.Rider()
	trip := awardedTripFor(t, h, rider, nil)
	double.assign(trip.driver.UserID, vehicleA, h.Clock.Now().Add(-24*time.Hour), nil)
	t0 := h.Clock.Now()
	reportOffRoad(t, h, "off-trip-a", vehicleA)
	h.Clock.Set(t0.Add(30 * time.Second))
	trip.start(t)

	// 2. Driver on vehicleB reported off-road trying to go online → driver_online flag.
	driverB := h.Driver()
	double.assign(driverB.UserID, vehicleB, h.Clock.Now().Add(-24*time.Hour), nil)
	h.Clock.Set(t0.Add(5 * time.Minute))
	reportOffRoad(t, h, "off-online-b", vehicleB)
	requireCode(t, h.Do(http.MethodPost, "/drivers/me/status", driverB, map[string]any{
		"online":  true,
		"filters": map[string]any{"vehicleClasses": []string{"go"}},
	}), http.StatusConflict, domain.CodeFleetVehicleUnavailable)

	opsActor := testutil.Actor{UserID: uuid.New(), Role: "ops_admin", CityID: h.CityID}

	// Read all flags in city (newest first: driver_online on vehicleB, then trip_started on vehicleA).
	allRec := h.Do(http.MethodGet, "/admin/mp/offroad-flags?city="+h.CityID, opsActor, nil)
	requireStatus(t, allRec, http.StatusOK)
	var allPage marketplace.OffroadUseFlagsPage
	h.DecodeBody(allRec, &allPage)
	if len(allPage.Rows) != 2 || allPage.Rows[0].VehicleID != vehicleB || allPage.Rows[0].Trigger != "driver_online" ||
		allPage.Rows[1].VehicleID != vehicleA || allPage.Rows[1].Trigger != "trip_started" {
		t.Fatalf("expected 2 flags newest-first (vehicleB driver_online, vehicleA trip_started), got: %+v", allPage.Rows)
	}

	// Filter by vehicle + trigger + since.
	since := t0.Add(4 * time.Minute).UTC().Format(time.RFC3339)
	filteredRec := h.Do(http.MethodGet, "/admin/mp/offroad-flags?vehicle="+vehicleB+"&trigger=driver_online&since="+since, opsActor, nil)
	requireStatus(t, filteredRec, http.StatusOK)
	var filtered marketplace.OffroadUseFlagsPage
	h.DecodeBody(filteredRec, &filtered)
	if len(filtered.Rows) != 1 || filtered.Rows[0].FlagID != allPage.Rows[0].FlagID || filtered.Rows[0].BlockID != "off-online-b" {
		t.Fatalf("filtered read returned unexpected rows: %+v", filtered.Rows)
	}

	// Decide flag 0 as warn_fleet (missing reason → 422, valid → 200, replay → 200, second decision → 409).
	flagOnlineID := allPage.Rows[0].FlagID
	requireCode(t, h.Do(http.MethodPost, "/admin/mp/offroad-flags/"+flagOnlineID+"/decide", opsActor,
		map[string]any{"decision": "warn_fleet", "reason": "  "}, move.IdempotencyHeader, idemKey()),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)

	warnKey := idemKey()
	warnReason := "confirmed breakdown timing mismatch with fleet manager"
	warnRec := h.Do(http.MethodPost, "/admin/mp/offroad-flags/"+flagOnlineID+"/decide", opsActor,
		map[string]any{"decision": "warn_fleet", "reason": warnReason}, move.IdempotencyHeader, warnKey)
	requireStatus(t, warnRec, http.StatusOK)
	var warnResult marketplace.DecideOffroadFlagResult
	h.DecodeBody(warnRec, &warnResult)
	if warnResult.Row.Decision != "warn_fleet" || warnResult.Row.DecisionReason != warnReason || warnResult.StandingAction != nil {
		t.Fatalf("warn_fleet decision did not record cleanly: %+v", warnResult)
	}
	replayWarn := h.Do(http.MethodPost, "/admin/mp/offroad-flags/"+flagOnlineID+"/decide", opsActor,
		map[string]any{"decision": "warn_fleet", "reason": warnReason}, move.IdempotencyHeader, warnKey)
	requireStatus(t, replayWarn, http.StatusOK)
	if replayWarn.Body.String() != warnRec.Body.String() {
		t.Fatal("replaying decide with the same Idempotency-Key must return the stored decision")
	}
	requireCode(t, h.Do(http.MethodPost, "/admin/mp/offroad-flags/"+flagOnlineID+"/decide", opsActor,
		map[string]any{"decision": "dismiss", "reason": "changed mind"}, move.IdempotencyHeader, idemKey()),
		http.StatusConflict, domain.CodeVersionConflict)

	// Escalate flag 1 (trip_started on vehicleA) to driver standing → creates pending_approval suspension + links standingActionId.
	flagTripID := allPage.Rows[1].FlagID
	escReason := "vehicle started passenger trip while declared off-road"
	escRec := h.Do(http.MethodPost, "/admin/mp/offroad-flags/"+flagTripID+"/decide", opsActor,
		map[string]any{"decision": "escalate_to_standing", "reason": escReason}, move.IdempotencyHeader, idemKey())
	requireStatus(t, escRec, http.StatusOK)
	var escResult marketplace.DecideOffroadFlagResult
	h.DecodeBody(escRec, &escResult)
	if escResult.Row.Decision != "escalate_to_standing" || escResult.StandingAction == nil ||
		escResult.StandingAction.Status != marketplace.StandingStatusPendingApproval ||
		escResult.StandingAction.ActionType != marketplace.StandingActionSuspension ||
		escResult.Row.StandingActionID == nil || *escResult.Row.StandingActionID != escResult.StandingAction.ID {
		t.Fatalf("escalate_to_standing must create a pending_approval standing action linked to the flag: %+v", escResult)
	}
	if auditCount(t, h, "mp.admin.offroad_flag_decided", flagTripID) != 1 {
		t.Fatal("off-road flag decision must write one audit row")
	}

	// Request timeline for the trip's request now includes vehicle_occupancy.recorded and vehicle_occupancy.offroad_use_flagged!
	tlRec := h.Do(http.MethodGet, "/admin/mp/requests/"+trip.requestID+"/timeline", opsActor, nil)
	requireStatus(t, tlRec, http.StatusOK)
	var tl marketplace.AdminTimeline
	h.DecodeBody(tlRec, &tl)
	seen := map[string]bool{}
	for _, ev := range tl.Events {
		seen[ev.Type] = true
	}
	for _, want := range []string{"vehicle_occupancy.recorded", "vehicle_occupancy.offroad_use_flagged"} {
		if !seen[want] {
			t.Fatalf("request timeline must include %s when linked to the request's trip; got: %v", want, seen)
		}
	}
}

// requireRedactedValues fails when a sensitive key anywhere in a redacted
// timeline detail carries anything but the redaction marker.
func requireRedactedValues(t *testing.T, eventType string, value any) {
	t.Helper()
	switch typed := value.(type) {
	case map[string]any:
		for key, inner := range typed {
			switch strings.ToLower(key) {
			case "lat", "lng", "phone", "token", "sealed", "smscopy", "pickup", "dropoff", "recipient":
				if inner != "[redacted]" {
					t.Fatalf("%s: %q must read [redacted], got %v", eventType, key, inner)
				}
				continue
			}
			requireRedactedValues(t, eventType, inner)
		}
	case []any:
		for _, inner := range typed {
			requireRedactedValues(t, eventType, inner)
		}
	}
}
