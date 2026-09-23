package marketplace

import (
	"testing"
	"time"
)

// TestReliabilityDefinition: below ten counted outcomes there is no rate;
// from ten, the rates are half-up basis points that always sum to 10,000.
func TestReliabilityDefinition(t *testing.T) {
	at := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	early := reliabilityOf(rideOutcomes{completed: 9}, at)
	if early.Status != ReliabilityInsufficientHistory || early.CompletionRateBps != nil || early.DriverCancellationRateBps != nil ||
		early.SampleSize != 9 || early.Label != "Not enough history yet" {
		t.Fatalf("nine outcomes are not enough history: %+v", early)
	}
	cases := []struct {
		completed, cancelled int
		cancelBps            int
		label                string
	}{
		{10, 0, 0, "0.0%"},
		{9, 1, 1_000, "10.0%"},
		{2, 1, 3_333, "33.3%"},
		{1, 2, 6_667, "66.7%"},
		{47, 1, 208, "2.1%"},
		{0, 12, 10_000, "100.0%"},
	}
	for _, tc := range cases {
		view := reliabilityOf(rideOutcomes{completed: tc.completed, driverCancelled: tc.cancelled}, at)
		sample := tc.completed + tc.cancelled
		if sample < reliabilityMinimumSample {
			if view.Status != ReliabilityInsufficientHistory {
				t.Fatalf("%+v: below the minimum sample", tc)
			}
			continue
		}
		if view.Status != ReliabilityAvailable || *view.DriverCancellationRateBps != tc.cancelBps ||
			*view.CompletionRateBps+*view.DriverCancellationRateBps != 10_000 {
			t.Fatalf("%+v: got %+v", tc, view)
		}
		if formatBpsPercent(tc.cancelBps) != tc.label {
			t.Fatalf("%+v: %s", tc, formatBpsPercent(tc.cancelBps))
		}
	}
	if halfUpBps(1, 3) != 3_333 || halfUpBps(2, 3) != 6_667 || halfUpBps(1, 8) != 1_250 || halfUpBps(1, 0) != 0 {
		t.Fatal("half-up basis points")
	}
}

// TestReceiptTaxesAreIncludedShares: taxes are the included share of the
// total at the configured rates, rounded half-up — never added; no (or no
// usable) rate itemises none.
func TestReceiptTaxesAreIncludedShares(t *testing.T) {
	vat := receiptTaxesOf(map[string]float64{"vat": 7.5}, 107_500, "NGN")
	if vat.Basis != ReceiptTaxesIncluded || len(vat.Lines) != 1 || vat.Lines[0].AmountMinor.AmountMinor != 7_500 ||
		vat.Lines[0].RateBps != 750 || vat.Lines[0].Label != "VAT 7.5% (included)" {
		t.Fatalf("7.5%% VAT included in 1,075.00 is 75.00: %+v", vat)
	}
	// 1,000 × 750 / 10,750 = 69.767… → 70 (half-up).
	if got := receiptTaxesOf(map[string]float64{"vat": 7.5}, 1_000, "NGN").Lines[0].AmountMinor.AmountMinor; got != 70 {
		t.Fatalf("half-up rounding: %d", got)
	}
	for _, taxes := range []map[string]float64{nil, {}, {"vat": 0}, {"vat": -5}, {"vat": 100}, {"vat": 7.555}} {
		if view := receiptTaxesOf(taxes, 10_000, "NGN"); view.Basis != ReceiptTaxesNotConfigured || len(view.Lines) != 0 {
			t.Fatalf("%v itemises no tax: %+v", taxes, view)
		}
	}
	two := receiptTaxesOf(map[string]float64{"vat": 5, "levy": 5}, 11_000, "NGN")
	if len(two.Lines) != 2 || two.Lines[0].Code != "levy" || two.Lines[0].AmountMinor.AmountMinor != 500 ||
		two.Lines[1].AmountMinor.AmountMinor != 500 {
		t.Fatalf("each rate's share of the same total: %+v", two)
	}
}

// TestOfferSortingAndBadges: every sort falls back to the offered order;
// offers without a pickup estimate sort last by pickup; a badge appears only
// when there is a real difference to point at.
func TestOfferSortingAndBadges(t *testing.T) {
	seconds := func(s int) *OfferPickupEstimateView { return &OfferPickupEstimateView{Seconds: &s} }
	offer := func(id string, total int64, pickup *OfferPickupEstimateView, fit int) *OfferView {
		money := Money{AmountMinor: total, Currency: "NGN"}
		return &OfferView{BidID: id, AmountMinor: money, TotalMinor: &money, PickupEstimate: pickup, ServiceFit: &ServiceFitView{Score: fit}}
	}
	ids := func(offers []*OfferView) string {
		out := ""
		for _, o := range offers {
			out += o.BidID
		}
		return out
	}
	list := func() []*OfferView {
		return []*OfferView{
			offer("a", 500, seconds(300), 1),
			offer("b", 400, nil, 1),
			offer("c", 400, seconds(120), 2),
			offer("d", 600, seconds(120), 0),
		}
	}
	for key, want := range map[string]string{
		OfferSortOffered:    "abcd",
		OfferSortPrice:      "cbad", // c/b tie on total: c has an estimate, b none
		OfferSortPickup:     "cdab", // c/d tie on pickup: c cheaper; b has no estimate
		OfferSortServiceFit: "cbad", // c=2; a/b tie at 1: b cheaper; d=0
	} {
		offers := list()
		sortOffers(offers, key)
		if ids(offers) != want {
			t.Fatalf("sort %s: got %s, want %s", key, ids(offers), want)
		}
	}
	offers := list()
	applyBadges(offers)
	if len(offers[1].Badges) != 1 || offers[1].Badges[0].Code != "lowest_total" || len(offers[2].Badges) != 2 ||
		len(offers[3].Badges) != 1 || offers[3].Badges[0].Code != "earliest_pickup" || len(offers[0].Badges) != 0 {
		t.Fatalf("badges: %+v %+v %+v %+v", offers[0].Badges, offers[1].Badges, offers[2].Badges, offers[3].Badges)
	}
	same := []*OfferView{offer("a", 400, seconds(60), 0), offer("b", 400, seconds(60), 0)}
	applyBadges(same)
	if len(same[0].Badges) != 0 || len(same[1].Badges) != 0 {
		t.Fatal("identical offers earn no badge")
	}
	withdrawn := []*OfferView{offer("a", 300, seconds(60), 0), offer("b", 400, seconds(90), 0)}
	withdrawn[0].Withdrawn = true
	applyBadges(withdrawn)
	if len(withdrawn[1].Badges) != 0 {
		t.Fatal("a withdrawn offer is not compared")
	}
}

// TestServiceNeedsAreClosedAndCanonical: only catalogued codes, no
// duplicates, stored in catalog order; nothing stated is no needs at all.
func TestServiceNeedsAreClosedAndCanonical(t *testing.T) {
	needs, err := canonicalServiceNeeds(&ServiceNeedsInput{
		Requirements: []string{RequirementExtraLuggage, RequirementWheelchairAccessible},
		Preferences:  []string{PreferenceElectricVehicle, PreferenceLargerVehicle},
	})
	if err != nil || needs.Requirements[0] != RequirementWheelchairAccessible || needs.Preferences[0] != PreferenceLargerVehicle {
		t.Fatalf("canonical order: %+v %v", needs, err)
	}
	for _, input := range []*ServiceNeedsInput{
		{Requirements: []string{"child_seat"}},
		{Preferences: []string{RequirementWheelchairAccessible}},
		{Requirements: []string{RequirementAssistanceAnimal, RequirementAssistanceAnimal}},
	} {
		if _, err := canonicalServiceNeeds(input); err == nil {
			t.Fatalf("%+v must be refused", input)
		}
	}
	if needs, err := canonicalServiceNeeds(&ServiceNeedsInput{}); needs != nil || err != nil {
		t.Fatal("no needs stated is no needs")
	}
}

// TestTotalLabelNeverMisstatesMoney: the phrased total uses the currency's
// fraction digits; a zero-digit currency is phrased in whole units, and an
// unknown digit count (config unreadable) phrases nothing rather than print
// minor units as if they were major ones.
func TestTotalLabelNeverMisstatesMoney(t *testing.T) {
	if got := totalLabelFor(250_000, "NGN", 2); got != "You pay NGN 2500.00" {
		t.Fatalf("two-digit currency: %q", got)
	}
	if got := totalLabelFor(2_500, "XOF", 0); got != "You pay XOF 2500" {
		t.Fatalf("zero-digit currency: %q", got)
	}
	if got := totalLabelFor(250_000, "NGN", -1); got != "" {
		t.Fatalf("unknown fraction digits must phrase no total: %q", got)
	}
}
