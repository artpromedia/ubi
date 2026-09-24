package marketplace_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/marketplace"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/testutil"
)

// receiptOf reads a request's receipt as an actor.
func receiptOf(t *testing.T, h *testutil.Harness, actor testutil.Actor, requestID string) map[string]any {
	t.Helper()
	recorder := h.Do(http.MethodGet, "/mp/requests/"+requestID+"/receipt", actor, nil)
	requireStatus(t, recorder, http.StatusOK)
	return decode(t, recorder)
}

func receiptLines(t *testing.T, receipt map[string]any, key string) []map[string]any {
	t.Helper()
	raw := receipt[key].([]any)
	lines := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		lines = append(lines, entry.(map[string]any))
	}
	return lines
}

// vatShare is a VAT-inclusive total's VAT share at 7.5% (750 bps), rounded
// half-up: total × 750 / 10,750.
func vatShare(total int64) int64 {
	return (total*750*2 + 10_750) / (2 * 10_750)
}

// TestReceiptReconcilesAcrossAmendmentsAndPaidWaiting: a trip that took a
// committed route increase and paid stop waiting completes. The rider's
// receipt itemises the agreed fare and each committed adjustment, carries the
// market's VAT as an included share, states the payment method and trip
// facts, never shows the commission, and its total is exactly the settled
// fare. The driver's receipt shows the same gross, the 10% captured once plus
// its linked adjustment, and the net — all equal to what the wallet captured.
// Before completion there is no receipt; strangers get 404.
func TestReceiptReconcilesAcrossAmendmentsAndPaidWaiting(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	first := f.stops[0]["stopId"].(string)
	_, _, firstPlace, _ := stopFixtures()
	f.start(t)
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+f.requestID+"/receipt", f.rider, nil),
		http.StatusConflict, domain.CodeConflict)

	// A committed increase: add a second stop.
	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	increase := decode(t, recorder)
	requireStatus(t, f.decide(f.rider, increase, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	requireStatus(t, f.decide(f.driver, increase, "approve", ""), http.StatusOK)
	// Paid waiting at the first stop: 270 s past arrival.
	f.moveTo(t, firstPlace, 5*time.Minute)
	requireStatus(t, f.stopPost(f.driver, first, "arrive", map[string]any{}, ""), http.StatusOK)
	h.Clock.Advance(270 * time.Second)
	requireStatus(t, f.stopPost(f.driver, first, "depart", nil, ""), http.StatusOK)
	f.complete(t)

	settled, ok := h.Settlement.Requests[f.award.ID]
	if !ok {
		t.Fatal("fixture: the completion settles")
	}
	rider := receiptOf(t, h, f.rider, f.requestID)
	lines := receiptLines(t, rider, "lines")
	codes := []string{}
	sum := int64(0)
	for _, line := range lines {
		codes = append(codes, line["code"].(string))
		sum += moneyMinor(t, line, "amountMinor")
	}
	if len(lines) != 3 || codes[0] != marketplace.ReceiptLineAgreedFare || moneyMinor(t, lines[0], "amountMinor") != f.amount ||
		!hasCode(codes, marketplace.ReceiptLineRouteChange) || !hasCode(codes, marketplace.ReceiptLineStopWaiting) {
		t.Fatalf("the agreed fare and every committed adjustment, itemised: %v", lines)
	}
	total := moneyMinor(t, rider, "totalMinor")
	if sum != total || total != settled.FareMinor.AmountMinor || total <= f.amount {
		t.Fatalf("lines %d = total %d = settled %d (an increase was committed)", sum, total, settled.FareMinor.AmountMinor)
	}
	reconciliation := rider["reconciliation"].(map[string]any)
	if moneyMinor(t, reconciliation, "originalFareMinor") != f.amount ||
		moneyMinor(t, reconciliation, "originalFareMinor")+moneyMinor(t, reconciliation, "adjustmentsMinor") != total ||
		moneyMinor(t, reconciliation, "settledFareMinor") != total {
		t.Fatalf("settled = original + committed adjustments: %v", reconciliation)
	}
	for _, line := range lines {
		if strings.HasPrefix(line["code"].(string), "commission") {
			t.Fatalf("the rider never sees the commission: %v", line)
		}
	}
	if rider["driver"] != nil || rider["viewer"] != "rider" {
		t.Fatalf("the rider's receipt has no driver earnings block: %v", rider)
	}
	taxes := rider["taxes"].(map[string]any)
	taxLines := receiptLines(t, taxes, "lines")
	if taxes["basis"] != marketplace.ReceiptTaxesIncluded || len(taxLines) != 1 || taxLines[0]["code"] != "vat" ||
		taxLines[0]["rateBps"] != float64(750) || moneyMinor(t, taxLines[0], "amountMinor") != vatShare(total) {
		t.Fatalf("the market's VAT is itemised as an included share of the total: %v", taxes)
	}
	if payment := rider["payment"].(map[string]any); payment["method"] != "wallet" {
		t.Fatalf("the payment method is stated: %v", payment)
	}
	trip := rider["trip"].(map[string]any)
	if trip["stopsVisited"] != float64(1) || trip["stopCount"] != float64(2) || trip["completedAt"] == nil ||
		trip["driver"].(map[string]any)["vehicle"] != "go" {
		t.Fatalf("the trip facts: %v", trip)
	}

	driver := receiptOf(t, h, f.driver, f.requestID)
	if moneyMinor(t, driver, "totalMinor") != total || driver["viewer"] != "driver" || driver["taxes"] != nil {
		t.Fatalf("the driver's receipt has the same total: %v", driver)
	}
	earnings := driver["driver"].(map[string]any)
	commission := int64(0)
	commissionLines := receiptLines(t, earnings, "commissionLines")
	for _, line := range commissionLines {
		commission += moneyMinor(t, line, "amountMinor")
	}
	if commissionLines[0]["code"] != marketplace.ReceiptLineCommission ||
		moneyMinor(t, commissionLines[0], "amountMinor") != f.award.CommissionMinor || len(commissionLines) < 2 {
		t.Fatalf("the 10%% captured once at selection, then its linked adjustments: %v", commissionLines)
	}
	if commission != moneyMinor(t, earnings, "commissionMinor") || commission != h.Wallet.CapturedTotal(f.reservation) ||
		commission != marketplace.CommissionMinor(total) {
		t.Fatalf("the driver's commission equals what the wallet captured, commission(total): lines %d, wallet %d, 10%% %d",
			commission, h.Wallet.CapturedTotal(f.reservation), marketplace.CommissionMinor(total))
	}
	if moneyMinor(t, earnings, "grossMinor") != total || moneyMinor(t, earnings, "netMinor") != total-commission {
		t.Fatalf("gross − commission = net: %v", earnings)
	}

	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+f.requestID+"/receipt", h.Rider(), nil), http.StatusNotFound, domain.CodeNotFound)
	requireCode(t, h.Do(http.MethodGet, "/mp/requests/"+f.requestID+"/receipt", h.Driver(), nil), http.StatusNotFound, domain.CodeNotFound)
}

// TestReceiptForAPlainTrip: a trip with no stops and no amendment reads as
// its agreed fare, equal to the settled fare, with the settlement posted —
// and the same receipt id for both parties.
func TestReceiptForAPlainTrip(t *testing.T) {
	h := newHarness(t)
	h.Clock.Set(fixedOffPeakHour)
	f := awardedTrip(t, h, nil)
	f.start(t)
	f.complete(t)

	rider := receiptOf(t, h, f.rider, f.requestID)
	lines := receiptLines(t, rider, "lines")
	if len(lines) != 1 || lines[0]["code"] != marketplace.ReceiptLineAgreedFare ||
		moneyMinor(t, rider, "totalMinor") != f.amount || h.Settlement.Requests[f.award.ID].FareMinor.AmountMinor != f.amount {
		t.Fatalf("a plain trip's receipt is its agreed (and settled) fare: %v", rider)
	}
	if settlement := rider["settlement"].(map[string]any); settlement["status"] != marketplace.ReceiptSettlementPosted || settlement["settledAt"] == nil {
		t.Fatalf("the confirmed settlement is stated as posted: %v", settlement)
	}
	driver := receiptOf(t, h, f.driver, f.requestID)
	earnings := driver["driver"].(map[string]any)
	if driver["receiptId"] != rider["receiptId"] || len(receiptLines(t, earnings, "commissionLines")) != 1 ||
		moneyMinor(t, earnings, "commissionMinor") != marketplace.CommissionMinor(f.amount) ||
		moneyMinor(t, earnings, "netMinor") != f.amount-marketplace.CommissionMinor(f.amount) {
		t.Fatalf("one receipt; the driver's view is gross, 10%%, net: %v", driver)
	}
}

// TestReceiptWaitsWhileMoneySettles: a trip completes while an approved
// change's commission capture is still unresolved (its answer was lost). The
// settlement defers, and so does the receipt — 409 "settling", never an
// approximate total. Once the sweep resolves the change and the settlement,
// the receipt carries the committed fare, equal to what was settled.
func TestReceiptWaitsWhileMoneySettles(t *testing.T) {
	h := amendHarness(t)
	f := awardedTrip(t, h, []map[string]any{firstStopInput()})
	f.start(t)
	recorder := f.propose(f.rider, proposal([]map[string]any{firstStopInput(), secondStopInput()}, 1, 1), "")
	requireStatus(t, recorder, http.StatusCreated)
	amendment := decode(t, recorder)
	revised := moneyMinor(t, amendment, "revisedFareMinor")
	requireStatus(t, f.decide(f.rider, amendment, "approve", ""), http.StatusOK)
	f.park(t, f.position, 30*time.Second)
	h.Wallet.UnknownDeltaCapture = true
	requireStatus(t, f.decide(f.driver, amendment, "approve", ""), http.StatusOK)
	f.complete(t)

	if _, settled := h.Settlement.Requests[f.award.ID]; settled {
		t.Fatal("fixture: the settlement must defer while the change's money is open")
	}
	waiting := h.Do(http.MethodGet, "/mp/requests/"+f.requestID+"/receipt", f.rider, nil)
	requireCode(t, waiting, http.StatusConflict, domain.CodeConflict)
	if decode(t, waiting)["details"].(map[string]any)["reason"] != "settling" {
		t.Fatalf("the receipt says it is settling: %s", waiting.Body.String())
	}

	// The durable settlement row's retry is scheduled on the database clock,
	// so the sweep is driven from the wall clock forward.
	h.Wallet.UnknownDeltaCapture = false
	for i := 1; i <= 5; i++ {
		if _, settled := h.Settlement.Requests[f.award.ID]; settled {
			break
		}
		h.Clock.Set(time.Now().UTC().Add(time.Duration(i) * 2 * time.Minute))
		_ = h.Marketplace.Sweep(context.Background())
	}
	settled, ok := h.Settlement.Requests[f.award.ID]
	if !ok || settled.FareMinor.AmountMinor != revised {
		t.Fatalf("the sweep settles the committed fare %d: %+v", revised, settled)
	}
	receipt := receiptOf(t, h, f.rider, f.requestID)
	if moneyMinor(t, receipt, "totalMinor") != revised ||
		moneyMinor(t, receipt["reconciliation"].(map[string]any), "settledFareMinor") != settled.FareMinor.AmountMinor {
		t.Fatalf("the receipt is the settled, committed fare: %v", receipt)
	}
}
