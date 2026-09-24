package marketplace_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// offerIDs lists offers' bid ids in order.
func offerIDs(offers []map[string]any) []string {
	ids := make([]string, 0, len(offers))
	for _, offer := range offers {
		ids = append(ids, offer["bidId"].(string))
	}
	return ids
}

func sameOrder(t *testing.T, label string, got []string, want ...string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s: got %v, want %v", label, got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%s: got %v, want %v", label, got, want)
		}
	}
}

func badgeCodes(offer map[string]any) []string {
	raw, _ := offer["badges"].([]any)
	codes := make([]string, 0, len(raw))
	for _, entry := range raw {
		codes = append(codes, entry.(map[string]any)["code"].(string))
	}
	return codes
}

func hasCode(codes []string, code string) bool {
	for _, candidate := range codes {
		if candidate == code {
			return true
		}
	}
	return false
}

// TestOfferComparisonAndSortOrders: every offer carries what the rider pays
// (the offered fare, no fee added — stated explicitly), a pickup ESTIMATE
// from the bid's eligibility evaluation (labelled, with basis and age), the
// vehicle, the driver card and a service fit whose points each name their
// fact. The default order is the order drivers offered (no default winner);
// the server sorts by price, pickup estimate and service fit with stated
// tie-breaks; badges carry their reasons; nothing is "recommended".
func TestOfferComparisonAndSortOrders(t *testing.T) {
	fake := newFakeUserService(t)
	h := confidenceHarness(t, testutil.WithDriverProfiles(fake.port(marketplace.DriverProfilesOptions{})))
	rider := h.Rider()
	near, middle, far := h.Driver(), h.Driver(), h.Driver()
	fake.setCard(driverCard(near.UserID, marketplace.DriverVerificationVerified, map[string]any{"average": 4.2, "count": 30}, 40, "sedan"))
	fake.setCard(driverCard(far.UserID, marketplace.DriverVerificationVerified, map[string]any{"average": 4.9, "count": 8}, 9, "suv"))
	// middle: user-service does not disclose a card.

	recorder := publishWith(t, h, rider, map[string]any{
		"serviceNeeds": map[string]any{"preferences": []string{"larger_vehicle"}},
	})
	requireStatus(t, recorder, http.StatusCreated)
	view := decode(t, recorder)
	requestID := view["requestId"].(string)
	minimum := moneyMinor(t, view, "minimumFareMinor")
	if needs := view["serviceNeeds"].(map[string]any); len(needs["preferences"].([]any)) != 1 || len(needs["requirements"].([]any)) != 0 {
		t.Fatalf("the stated preference is recorded, and only it: %v", needs)
	}

	pickup := testutil.PickupFixture()
	parkDriver(t, h, near, testutil.PlaceAt(pickup, 200))
	parkDriver(t, h, middle, testutil.PlaceAt(pickup, 1_500))
	parkDriver(t, h, far, testutil.PlaceAt(pickup, 2_700))
	nearBid := bidNow(t, h, near, requestID, minimum+2_000)["bidId"].(string)
	middleBid := bidNow(t, h, middle, requestID, minimum)["bidId"].(string)
	farBid := bidNow(t, h, far, requestID, minimum+1_000)["bidId"].(string)

	snapshot := snapshotOf(t, h, rider, requestID, "")
	offers := offersOf(t, snapshot)
	sameOrder(t, "default: the order drivers offered", offerIDs(offers), nearBid, middleBid, farBid)
	order := snapshot["offerOrder"].(map[string]any)
	if order["sort"] != "offered" || !strings.Contains(order["note"].(string), "No offer is sponsored") || len(order["options"].([]any)) != 4 {
		t.Fatalf("the snapshot states its order and the alternatives: %v", order)
	}

	byID := map[string]map[string]any{}
	for _, offer := range offers {
		byID[offer["bidId"].(string)] = offer
		if offer["whyRecommended"] != nil {
			t.Fatalf("the server never recommends an offer: %v", offer)
		}
		total := moneyMinor(t, offer, "totalMinor")
		if total != moneyMinor(t, offer, "amountMinor") || moneyMinor(t, offer, "bookingFeeMinor") != 0 {
			t.Fatalf("the rider pays exactly the offered fare, fee stated as zero: %v", offer)
		}
		if !strings.HasPrefix(offer["totalLabel"].(string), "You pay") || !strings.Contains(offer["totalNote"].(string), "No booking or service fee") {
			t.Fatalf("the total is phrased and explained by the server: %v", offer)
		}
		estimate := offer["pickupEstimate"].(map[string]any)
		if estimate["basis"] != marketplace.PickupBasisRoutedLeg || estimate["estimate"] != true || estimate["estimatedAt"] == nil ||
			!strings.HasPrefix(estimate["label"].(string), "Estimated pickup") {
			t.Fatalf("the pickup is the bid's routed ESTIMATE, labelled, with its age: %v", estimate)
		}
		if !strings.Contains(offer["pickupLabel"].(string), "(estimate)") {
			t.Fatalf("the pickup label says it is an estimate: %v", offer["pickupLabel"])
		}
		if offer["vehicle"].(map[string]any)["class"] != "go" || offer["reliability"] == nil {
			t.Fatalf("every offer carries its vehicle class and reliability: %v", offer)
		}
	}
	seconds := func(bidID string) float64 {
		return byID[bidID]["pickupEstimate"].(map[string]any)["seconds"].(float64)
	}
	if !(seconds(nearBid) < seconds(middleBid) && seconds(middleBid) < seconds(farBid)) {
		t.Fatalf("estimates grow with distance: %v %v %v", seconds(nearBid), seconds(middleBid), seconds(farBid))
	}
	fit := func(bidID string) float64 { return byID[bidID]["serviceFit"].(map[string]any)["score"].(float64) }
	if fit(farBid) != 2 || fit(nearBid) != 1 || fit(middleBid) != 0 {
		t.Fatalf("service fit: verified + verified larger vehicle, verified only, nothing: far %v near %v middle %v",
			fit(farBid), fit(nearBid), fit(middleBid))
	}
	matched := byID[farBid]["serviceFit"].(map[string]any)["matched"].([]any)
	if len(matched) != 2 || matched[1].(map[string]any)["code"] != "preference:larger_vehicle" {
		t.Fatalf("every service-fit point names its fact: %v", matched)
	}
	if !hasCode(badgeCodes(byID[middleBid]), "lowest_total") || !hasCode(badgeCodes(byID[nearBid]), "earliest_pickup") ||
		hasCode(badgeCodes(byID[farBid]), "lowest_total") {
		t.Fatalf("badges mark the lowest total and earliest pickup, with reasons: near %v middle %v far %v",
			byID[nearBid]["badges"], byID[middleBid]["badges"], byID[farBid]["badges"])
	}
	lowest := byID[middleBid]["badges"].([]any)[0].(map[string]any)
	if lowest["label"] != "Lowest total of 3 offers" {
		t.Fatalf("a badge says why: %v", lowest)
	}

	sameOrder(t, "price", offerIDs(offersOf(t, snapshotOf(t, h, rider, requestID, "price"))), middleBid, farBid, nearBid)
	sameOrder(t, "pickup", offerIDs(offersOf(t, snapshotOf(t, h, rider, requestID, "pickup"))), nearBid, middleBid, farBid)
	sameOrder(t, "service_fit", offerIDs(offersOf(t, snapshotOf(t, h, rider, requestID, "service_fit"))), farBid, nearBid, middleBid)
	if sorted := snapshotOf(t, h, rider, requestID, "price")["offerOrder"].(map[string]any); sorted["sort"] != "price" ||
		!strings.Contains(sorted["tieBreak"].(string), "earliest estimated pickup") {
		t.Fatalf("a sort states its tie-breaks: %v", sorted)
	}
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+requestID+"?sort=sponsored", rider, nil),
		http.StatusUnprocessableEntity, domain.CodeValidationFailed)
}

// TestReliabilityIsDefinedAndNeedsAMinimumSample: reliability comes from this
// service's own marketplace rides — completed vs cancelled by the driver
// over 90 days — with its sample size, window and freshness. Nine completed
// rides are not enough history (no rate is shown); a tenth outcome, a
// driver cancellation, makes the figure available at exactly 90% / 10%.
func TestReliabilityIsDefinedAndNeedsAMinimumSample(t *testing.T) {
	h := confidenceHarness(t)
	driver := h.Driver()
	goOnline(t, h, driver)
	seq := int64(1)
	for i := 0; i < 9; i++ {
		f := completedTripWith(t, h, h.Rider(), driver, seq)
		seq = f.seq + 1
	}

	reliabilityOn := func() map[string]any {
		t.Helper()
		rider := h.Rider()
		view, _ := publishAt(t, h, rider, 0)
		requestID := view["requestId"].(string)
		f := &tripFixture{h: h, driver: driver, seq: seq}
		f.park(t, testutil.PickupFixture(), 2*time.Minute)
		seq = f.seq + 1
		bidNow(t, h, driver, requestID, moneyMinor(t, view, "minimumFareMinor"))
		offers := offersOf(t, snapshotOf(t, h, rider, requestID, ""))
		// Withdraw so the next trip starts clean.
		requireStatus(t, h.Do(http.MethodPost, "/mp/requests/"+requestID+"/cancel", rider, nil, move.IdempotencyHeader, idemKey()), http.StatusOK)
		return offers[0]["reliability"].(map[string]any)
	}

	early := reliabilityOn()
	if early["status"] != marketplace.ReliabilityInsufficientHistory || early["sampleSize"] != float64(9) ||
		early["completedJobs"] != float64(9) || early["completionRateBps"] != nil || early["driverCancellationRateBps"] != nil ||
		early["label"] != "Not enough history yet" || early["minimumSample"] != float64(10) || early["windowDays"] != float64(90) ||
		early["computedAt"] == nil || !strings.Contains(early["definition"].(string), "cancelled themselves") {
		t.Fatalf("below the minimum sample no rate is shown, and the definition is stated: %v", early)
	}

	// A tenth outcome the driver controls: they cancel an awarded ride.
	f := tripWith(t, h, h.Rider(), driver, seq)
	seq = f.seq + 1
	requireStatus(t, h.Do(http.MethodPost, "/rides/"+f.rideID.String()+"/cancel", driver,
		map[string]any{"reasonCode": "vehicle_issue"}), http.StatusOK)

	ready := reliabilityOn()
	if ready["status"] != marketplace.ReliabilityAvailable || ready["sampleSize"] != float64(10) ||
		ready["completedJobs"] != float64(9) || ready["driverCancellations"] != float64(1) ||
		ready["completionRateBps"] != float64(9_000) || ready["driverCancellationRateBps"] != float64(1_000) ||
		ready["label"] != "Completed 9 of 10 marketplace rides in 90 days · 10.0% cancelled by the driver" {
		t.Fatalf("ten counted outcomes make a defined figure: %v", ready)
	}
}
