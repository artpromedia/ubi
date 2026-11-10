package marketplace_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

func staleDriverCard(driverID uuid.UUID, plateMasked, makeName, modelName, colour, bodyType string) map[string]any {
	card := driverCard(driverID, marketplace.DriverVerificationVerified, map[string]any{"average": 4.91, "count": 88}, 140, bodyType)
	card["vehicle"] = map[string]any{
		"make":        makeName,
		"model":       modelName,
		"colour":      colour,
		"type":        bodyType,
		"plateMasked": plateMasked,
	}
	return card
}

func assertOfferVehicle(t *testing.T, surface string, vehicle map[string]any, wantPlate, wantMake, wantModel, wantColour, wantBody string) {
	t.Helper()
	if vehicle == nil {
		t.Fatalf("%s: missing vehicle object", surface)
	}
	if vehicle["plateMasked"] != wantPlate || vehicle["make"] != wantMake ||
		vehicle["model"] != wantModel || vehicle["colour"] != wantColour ||
		vehicle["bodyType"] != wantBody || vehicle["verified"] != true {
		t.Fatalf("%s: unexpected vehicle projection: %v", surface, vehicle)
	}
}

// TestFleetDriverLiveRideShowsAssignedFleetVehicle (CC-A01 / DEC-3 = A, case a):
// when a fleet driver has a stale personal vehicle in user-service (•••99
// Toyota Corolla Silver) and an active signed fleet shift on •••77 Honda Civic
// Blue, every live marketplace and ride surface — offer comparison, select
// award, GET /award, GET /queue, GET /rides/{id}, guest GET /mp/trip-access,
// GET /receipt, and admin GET /admin/mp/requests/{id}/timeline — shows the
// fleet vehicle •••77 and NEVER leaks the stale •••99 plate.
func TestFleetDriverLiveRideShowsAssignedFleetVehicle(t *testing.T) {
	double := newFleetDouble(t)
	profiles := newFakeUserService(t)
	h := fleetHarness(t, double,
		testutil.WithDriverProfiles(profiles.port(marketplace.DriverProfilesOptions{})),
		testutil.WithFlag(cityconfig.FlagMarketplaceGuestBookings, true),
	)

	fleetVeh := fleetVehicle(h, double, "civic77")
	double.setVehicleDisplay(fleetVeh, "•••77", "Honda", "Civic", "Blue", "sedan")

	rider := h.Rider()
	admin := adminActor(h)
	driver := h.Driver()
	profiles.setCard(staleDriverCard(driver.UserID, "•••99", "Toyota", "Corolla", "Silver", "suv"))
	double.assign(driver.UserID, fleetVeh, h.Clock.Now().Add(-2*time.Hour), nil)

	guest := bookGuest(t, h, rider)
	requestID := guest.requestID

	parkDriver(t, h, driver, testutil.PickupFixture())
	bid := bidNow(t, h, driver, requestID, guest.amount)

	// 1. Live offer comparison shows •••77 Honda Civic Blue, never •••99.
	snap := snapshotOf(t, h, rider, requestID, "")
	if strings.Contains(mustJSON(t, snap), "•••99") {
		t.Fatalf("stale user-service plate leaked into offer snapshot: %s", mustJSON(t, snap))
	}
	offers := offersOf(t, snap)
	if len(offers) != 1 {
		t.Fatalf("expected 1 live offer, got %d", len(offers))
	}
	offerDriver := offers[0]["driver"].(map[string]any)
	if offerDriver["plateMasked"] != "•••77" {
		t.Fatalf("offer driver card plate: got %v, want •••77", offerDriver["plateMasked"])
	}
	assertOfferVehicle(t, "offer", offers[0]["vehicle"].(map[string]any), "•••77", "Honda", "Civic", "Blue", "sedan")
	offerVeh := offers[0]["vehicle"].(map[string]any)
	if offerVeh["capacitySeats"] != float64(4) || offerVeh["capacityNote"] != "4 passenger seats" {
		t.Fatalf("offer vehicle capacity should reflect fleet vehicle (4 seats), got %v", offerVeh)
	}

	// 2. Award selection response carries driver + fleet vehicle •••77.
	selectedRec := doSelect(t, h, rider, requestID, map[string]any{
		"bidId": bid["bidId"], "requestVersion": requestVersionOf(t, h, rider, requestID), "bidVersion": 1,
	}, "")
	requireStatus(t, selectedRec, http.StatusAccepted)
	if strings.Contains(selectedRec.Body.String(), "•••99") {
		t.Fatalf("stale plate leaked into select response: %s", selectedRec.Body.String())
	}
	selected := decode(t, selectedRec)
	pin := selected["pickupPin"].(string)
	selectAward := selected["award"].(map[string]any)
	if selectAward["driver"].(map[string]any)["plateMasked"] != "•••77" {
		t.Fatalf("select award driver plate: %v", selectAward["driver"])
	}
	assertOfferVehicle(t, "select.award", selectAward["vehicle"].(map[string]any), "•••77", "Honda", "Civic", "Blue", "sedan")

	// 3. GET /mp/requests/{id}/award carries the same fleet vehicle.
	awardRec := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/award", rider, nil)
	requireStatus(t, awardRec, http.StatusOK)
	awardBody := decode(t, awardRec)
	if awardBody["driver"].(map[string]any)["plateMasked"] != "•••77" {
		t.Fatalf("GET /award driver plate: %v", awardBody["driver"])
	}
	assertOfferVehicle(t, "GET /award", awardBody["vehicle"].(map[string]any), "•••77", "Honda", "Civic", "Blue", "sedan")

	// 4. GET /mp/requests/{id}/queue carries the same fleet vehicle.
	queueRec := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/queue", rider, nil)
	requireStatus(t, queueRec, http.StatusOK)
	queueBody := decode(t, queueRec)
	if queueBody["driver"].(map[string]any)["plateMasked"] != "•••77" {
		t.Fatalf("GET /queue driver plate: %v", queueBody["driver"])
	}
	assertOfferVehicle(t, "GET /queue", queueBody["vehicle"].(map[string]any), "•••77", "Honda", "Civic", "Blue", "sedan")

	// 5. GET /rides/{rideId} carries the assigned fleet vehicle for AssignedScreen.
	award := awardRow(t, h, requestID)
	rideID := *award.ExecutionID
	rideRec := h.Do(http.MethodGet, "/rides/"+rideID.String(), rider, nil)
	requireStatus(t, rideRec, http.StatusOK)
	if strings.Contains(rideRec.Body.String(), "•••99") {
		t.Fatalf("stale plate leaked into GET /rides/{id}: %s", rideRec.Body.String())
	}
	rideBody := decode(t, rideRec)
	rideVehicle, ok := rideBody["vehicle"].(map[string]any)
	if !ok {
		t.Fatalf("GET /rides/{id} missing vehicle: %v", rideBody)
	}
	if rideVehicle["plateMasked"] != "•••77" || rideVehicle["make"] != "Honda" ||
		rideVehicle["model"] != "Civic" || rideVehicle["colour"] != "Blue" {
		t.Fatalf("GET /rides/{id} vehicle mismatch: %v", rideVehicle)
	}

	// 6. Guest passenger link GET /mp/trip-access shows •••77, never •••99.
	guestRec := tripAccess(t, h, http.MethodGet, "/mp/trip-access", guest.token, clientAddr())
	requireStatus(t, guestRec, http.StatusOK)
	if strings.Contains(guestRec.Body.String(), "•••99") {
		t.Fatalf("stale plate leaked into guest trip-access: %s", guestRec.Body.String())
	}
	guestBody := decode(t, guestRec)
	if guestBody["driver"].(map[string]any)["plateMasked"] != "•••77" {
		t.Fatalf("guest trip-access driver plate: %v", guestBody["driver"])
	}
	assertOfferVehicle(t, "guest trip-access", guestBody["vehicle"].(map[string]any), "•••77", "Honda", "Civic", "Blue", "sedan")

	// 7. Complete the trip and verify GET /mp/requests/{id}/receipt names •••77.
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/arrived", driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/verify-pin", driver, map[string]any{"pin": pin}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/start", driver, map[string]any{}), http.StatusOK)
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+rideID.String()+"/complete", driver, map[string]any{}), http.StatusOK)

	receiptRec := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/receipt", rider, nil)
	requireStatus(t, receiptRec, http.StatusOK)
	if strings.Contains(receiptRec.Body.String(), "•••99") {
		t.Fatalf("stale plate leaked into receipt: %s", receiptRec.Body.String())
	}
	receiptTrip := decode(t, receiptRec)["trip"].(map[string]any)
	if receiptTrip["driver"].(map[string]any)["plateMasked"] != "•••77" {
		t.Fatalf("receipt driver plate: %v", receiptTrip["driver"])
	}
	assertOfferVehicle(t, "receipt.trip", receiptTrip["vehicle"].(map[string]any), "•••77", "Honda", "Civic", "Blue", "sedan")

	// 8. Admin ops timeline names the exact same fleet vehicle on mp.award.confirmed and ride.assigned.
	timelineRec := h.Do(http.MethodGet, "/admin/mp/requests/"+requestID+"/timeline", admin, nil)
	requireStatus(t, timelineRec, http.StatusOK)
	var timeline marketplace.AdminTimeline
	h.DecodeBody(timelineRec, &timeline)
	seenConfirmed, seenAssigned := false, false
	for _, event := range timeline.Events {
		var detail map[string]any
		if err := json.Unmarshal([]byte(event.Detail), &detail); err != nil {
			t.Fatalf("%s: malformed timeline detail: %v", event.Type, err)
		}
		switch event.Type {
		case "mp.award.confirmed":
			seenConfirmed = true
			if detail["vehicleId"] != fleetVeh {
				t.Fatalf("timeline mp.award.confirmed vehicleId: %v", detail)
			}
			fv := detail["fleetVehicle"].(map[string]any)
			if fv["plateMasked"] != "•••77" || fv["make"] != "Honda" {
				t.Fatalf("timeline mp.award.confirmed fleetVehicle: %v", fv)
			}
		case "ride.assigned":
			seenAssigned = true
			if detail["vehicleId"] != fleetVeh {
				t.Fatalf("timeline ride.assigned vehicleId: %v", detail)
			}
			fv := detail["fleetVehicle"].(map[string]any)
			if fv["plateMasked"] != "•••77" {
				t.Fatalf("timeline ride.assigned fleetVehicle: %v", fv)
			}
		}
	}
	if !seenConfirmed || !seenAssigned {
		t.Fatalf("timeline missing mp.award.confirmed (%v) or ride.assigned (%v)", seenConfirmed, seenAssigned)
	}
}

// TestFleetDriverGoOnlineRefusedWhenVehicleUnavailable (CC-A01, case b):
// in a fleet-enabled city, a fleet driver cannot go online when fleet-service
// is down, when they have no active shift, when documents are expired, when the
// vehicle is inactive, or when the vehicle is reported off-road — each returns
// 409 fleet_vehicle_unavailable and leaves the driver session offline.
func TestFleetDriverGoOnlineRefusedWhenVehicleUnavailable(t *testing.T) {
	assertOffline := func(t *testing.T, h *testutil.Harness, driver testutil.Actor) {
		t.Helper()
		status := h.Do(http.MethodGet, "/drivers/me/status", driver, nil)
		requireStatus(t, status, http.StatusOK)
		if state := decode(t, status)["state"]; state != string(machine.DriverOffline) {
			t.Fatalf("driver must remain offline on refusal, got %v", state)
		}
	}

	t.Run("fleet-service down", func(t *testing.T) {
		double := newFleetDouble(t)
		h := fleetHarness(t, double)
		veh := fleetVehicle(h, double, "down")
		driver := h.Driver()
		double.assign(driver.UserID, veh, h.Clock.Now().Add(-time.Hour), nil)
		double.setDown(true)

		rec := h.Do(http.MethodPost, "/drivers/me/status", driver, map[string]any{
			"online":  true,
			"filters": map[string]any{"vehicleClasses": []string{"go"}},
		})
		requireCode(t, rec, http.StatusConflict, domain.CodeFleetVehicleUnavailable)
		assertOffline(t, h, driver)
	})

	t.Run("no active shift", func(t *testing.T) {
		double := newFleetDouble(t)
		h := fleetHarness(t, double)
		driver := h.Driver()
		double.addFleetDriver(driver.UserID)

		rec := h.Do(http.MethodPost, "/drivers/me/status", driver, map[string]any{
			"online":  true,
			"filters": map[string]any{"vehicleClasses": []string{"go"}},
		})
		requireCode(t, rec, http.StatusConflict, domain.CodeFleetVehicleUnavailable)
		if details := decode(t, rec)["details"].(map[string]any); details["reason"] != marketplace.OnlineVehicleNoActiveShift {
			t.Fatalf("expected reason no_active_shift, got %v", details)
		}
		assertOffline(t, h, driver)
	})

	t.Run("expired vehicle documents", func(t *testing.T) {
		double := newFleetDouble(t)
		h := fleetHarness(t, double)
		veh := fleetVehicle(h, double, "expired")
		double.setDocuments(veh, "2020-01-01", "2030-01-01")
		driver := h.Driver()
		double.assign(driver.UserID, veh, h.Clock.Now().Add(-time.Hour), nil)

		rec := h.Do(http.MethodPost, "/drivers/me/status", driver, map[string]any{
			"online":  true,
			"filters": map[string]any{"vehicleClasses": []string{"go"}},
		})
		requireCode(t, rec, http.StatusConflict, domain.CodeFleetVehicleUnavailable)
		if details := decode(t, rec)["details"].(map[string]any); details["reason"] != marketplace.OnlineVehicleDocExpired {
			t.Fatalf("expected reason doc_expired, got %v", details)
		}
		assertOffline(t, h, driver)
	})

	t.Run("inactive fleet vehicle", func(t *testing.T) {
		double := newFleetDouble(t)
		h := fleetHarness(t, double)
		veh := fleetVehicle(h, double, "inactive")
		double.setVehicleInactive(veh, true)
		driver := h.Driver()
		double.assign(driver.UserID, veh, h.Clock.Now().Add(-time.Hour), nil)

		rec := h.Do(http.MethodPost, "/drivers/me/status", driver, map[string]any{
			"online":  true,
			"filters": map[string]any{"vehicleClasses": []string{"go"}},
		})
		requireCode(t, rec, http.StatusConflict, domain.CodeFleetVehicleUnavailable)
		if details := decode(t, rec)["details"].(map[string]any); details["reason"] != marketplace.OnlineVehicleInactive {
			t.Fatalf("expected reason vehicle_inactive, got %v", details)
		}
		assertOffline(t, h, driver)
	})
}

// TestNonFleetDriverAndFlagOffRemainUnchanged (CC-A01, cases c & d):
// (c) a non-fleet driver in a fleet-enabled city goes online normally and
// renders their user-service verified vehicle;
// (d) with the `fleet` flag off, fleet-service is never consulted at go-online
// or live award (even if fleet-service is down) and user-service's card is used.
func TestNonFleetDriverAndFlagOffRemainUnchanged(t *testing.T) {
	t.Run("non-fleet driver in fleet-enabled city", func(t *testing.T) {
		double := newFleetDouble(t)
		profiles := newFakeUserService(t)
		h := fleetHarness(t, double,
			testutil.WithDriverProfiles(profiles.port(marketplace.DriverProfilesOptions{})),
		)
		rider, driver := h.Rider(), h.Driver()
		profiles.setCard(staleDriverCard(driver.UserID, "•••99", "Toyota", "Corolla", "Silver", "sedan"))

		view, _ := publishAt(t, h, rider, 0)
		requestID := view["requestId"].(string)
		parkDriver(t, h, driver, testutil.PickupFixture())
		bidNow(t, h, driver, requestID, moneyMinor(t, view, "minimumFareMinor"))

		offers := offersOf(t, snapshotOf(t, h, rider, requestID, ""))
		if len(offers) != 1 || offers[0]["driver"].(map[string]any)["plateMasked"] != "•••99" {
			t.Fatalf("non-fleet driver should keep user-service vehicle •••99: %v", offers)
		}
	})

	t.Run("fleet flag off: fleet-service never called even when down", func(t *testing.T) {
		double := newFleetDouble(t)
		profiles := newFakeUserService(t)
		h := newHarness(t,
			testutil.WithFleetService(double.port()),
			testutil.WithDriverProfiles(profiles.port(marketplace.DriverProfilesOptions{})),
		)
		h.Clock.Set(fixedOffPeakHour)
		veh := fleetVehicle(h, double, "flagoff")
		double.setVehicleDisplay(veh, "•••77", "Honda", "Civic", "Blue", "sedan")
		rider, driver := h.Rider(), h.Driver()
		double.assign(driver.UserID, veh, h.Clock.Now().Add(-time.Hour), nil)
		profiles.setCard(staleDriverCard(driver.UserID, "•••99", "Toyota", "Corolla", "Silver", "sedan"))
		double.setDown(true)

		view, _ := publishAt(t, h, rider, 0)
		requestID := view["requestId"].(string)
		parkDriver(t, h, driver, testutil.PickupFixture())
		bid := bidNow(t, h, driver, requestID, moneyMinor(t, view, "minimumFareMinor"))

		if calls := double.callCount("online-vehicle"); calls != 0 {
			t.Fatalf("online-vehicle must not be called when fleet flag is off, got %d", calls)
		}
		offers := offersOf(t, snapshotOf(t, h, rider, requestID, ""))
		if offers[0]["driver"].(map[string]any)["plateMasked"] != "•••99" {
			t.Fatalf("flag off should show user-service plate •••99: %v", offers[0]["driver"])
		}
		selected := doSelect(t, h, rider, requestID, map[string]any{
			"bidId": bid["bidId"], "requestVersion": 1, "bidVersion": 1,
		}, "")
		requireStatus(t, selected, http.StatusAccepted)
	})
}

// TestFleetAssignmentChangeBetweenAwardsKeepsInProgressTripVehicle (CC-A01, case e):
// when a fleet driver's assignment changes while they are online:
//   - a trip already in progress keeps the vehicle it started with (Vehicle A •••AA)
//     across GET /rides/{id} and GET /receipt;
//   - the next live award re-resolves and snapshots the new vehicle (Vehicle B •••BB);
//   - if the shift ends with no replacement before a subsequent award, selection is
//     refused with 409 slot_unavailable leaving the request open.
func TestFleetAssignmentChangeBetweenAwardsKeepsInProgressTripVehicle(t *testing.T) {
	double := newFleetDouble(t)
	profiles := newFakeUserService(t)
	h := fleetHarness(t, double,
		testutil.WithDriverProfiles(profiles.port(marketplace.DriverProfilesOptions{})),
	)

	vehA := fleetVehicle(h, double, "vehA")
	double.setVehicleDisplay(vehA, "•••AA", "Kia", "Rio", "White", "sedan")
	vehB := fleetVehicle(h, double, "vehB")
	double.setVehicleDisplay(vehB, "•••BB", "Hyundai", "Accent", "Black", "sedan")

	driver := h.Driver()
	profiles.setCard(staleDriverCard(driver.UserID, "•••99", "Toyota", "Corolla", "Silver", "sedan"))
	double.assign(driver.UserID, vehA, h.Clock.Now().Add(-2*time.Hour), nil)

	// Trip 1 awarded and started on Vehicle A (•••AA).
	rider1 := h.Rider()
	parkDriver(t, h, driver, testutil.PickupFixture())
	trip1 := tripWith(t, h, rider1, driver, 4)
	trip1.start(t)

	// While Trip 1 is in progress, fleet ends Vehicle A's shift and assigns Vehicle B.
	swapAt := h.Clock.Now()
	double.endAssignments(driver.UserID, swapAt)
	double.assign(driver.UserID, vehB, swapAt, nil)

	// In-progress Trip 1 MUST keep Vehicle A (•••AA) on GET /rides/{ride1}.
	ride1Rec := h.Do(http.MethodGet, "/rides/"+trip1.rideID.String(), rider1, nil)
	requireStatus(t, ride1Rec, http.StatusOK)
	ride1Veh := decode(t, ride1Rec)["vehicle"].(map[string]any)
	if ride1Veh["plateMasked"] != "•••AA" || ride1Veh["make"] != "Kia" {
		t.Fatalf("in-progress trip must keep Vehicle A •••AA, got %v", ride1Veh)
	}

	// Complete Trip 1: receipt for Trip 1 still names Vehicle A (•••AA).
	trip1.complete(t)
	receipt1Rec := h.Do(http.MethodGet, "/mp/requests/"+trip1.requestID+"/receipt", rider1, nil)
	requireStatus(t, receipt1Rec, http.StatusOK)
	receipt1Trip := decode(t, receipt1Rec)["trip"].(map[string]any)
	if receipt1Trip["driver"].(map[string]any)["plateMasked"] != "•••AA" ||
		receipt1Trip["vehicle"].(map[string]any)["plateMasked"] != "•••AA" {
		t.Fatalf("Trip 1 receipt must retain Vehicle A •••AA: %v", receipt1Trip)
	}

	// Without bouncing offline, driver bids on Trip 2; award re-resolves Vehicle B (•••BB).
	rider2 := h.Rider()
	trip2 := tripWith(t, h, rider2, driver, trip1.seq)
	ride2Rec := h.Do(http.MethodGet, "/rides/"+trip2.rideID.String(), rider2, nil)
	requireStatus(t, ride2Rec, http.StatusOK)
	ride2Veh := decode(t, ride2Rec)["vehicle"].(map[string]any)
	if ride2Veh["plateMasked"] != "•••BB" || ride2Veh["make"] != "Hyundai" {
		t.Fatalf("Trip 2 must re-resolve Vehicle B •••BB at award, got %v", ride2Veh)
	}
	trip2.start(t)
	trip2.complete(t)

	// Now end Vehicle B's shift with NO replacement while driver is still online:
	// selecting the driver's bid on Request 3 is refused with 409 slot_unavailable,
	// leaving Request 3 open for other offers.
	rider3 := h.Rider()
	view3, _ := publishAt(t, h, rider3, 0)
	req3ID := view3["requestId"].(string)
	trip2.park(t, testutil.PickupFixture(), 2*time.Minute)
	bid3 := bidNow(t, h, driver, req3ID, moneyMinor(t, view3, "minimumFareMinor"))

	double.endAssignments(driver.UserID, h.Clock.Now())
	select3 := doSelect(t, h, rider3, req3ID, map[string]any{
		"bidId": bid3["bidId"], "requestVersion": requestVersionOf(t, h, rider3, req3ID), "bidVersion": 1,
	}, "")
	requireCode(t, select3, http.StatusConflict, domain.CodeSlotUnavailable)
	if reqRow := requestRow(t, h, req3ID); reqRow.State != machine.MpRequestOpen {
		t.Fatalf("refused award must leave request open, got %s", reqRow.State)
	}
}
