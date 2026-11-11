package handlers

import (
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/custody"
)

func TestMaskContactPhone(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"empty", "", ""},
		{"whitespace", "   ", ""},
		{"short 4 digits", "1234", "••••"},
		{"7 digits", "1234567", "••••4567"},
		{"nigerian e164", "+2348012345678", "+234••••5678"},
		{"kenyan e164", "+254712345678", "+254••••5678"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := maskContactPhone(tc.input); got != tc.want {
				t.Fatalf("maskContactPhone(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestProjectDeliveryDetailContactGating(t *testing.T) {
	row := deliveryDetailRow{
		TrackingNumber:     "UBI-TRK-001",
		PickupAddress:      "14 Adeola Odeku, Victoria Island",
		PickupLat:          6.4281,
		PickupLng:          3.4219,
		PickupContact:      "Adaeze Okafor",
		PickupPhone:        "+2348011112222",
		DropoffAddress:     "22 Admiralty Way, Lekki Phase 1",
		DropoffLat:         6.4478,
		DropoffLng:         3.4723,
		DropoffContact:     "Chinedu Eze",
		DropoffPhone:       "+2348033334444",
		PackageSize:        "MEDIUM",
		PackageWeight:      3.5,
		PackageDescription: "Laptop charger and notebooks",
		IsFragile:          true,
		RequiresSignature:  true,
		AgreedFareMinor:    350000,
		RequestID:          "mpr_deliv_1",
		Currency:           "NGN",
	}

	t.Run("sender always receives pickup and dropoff contacts with masked phones", func(t *testing.T) {
		for _, state := range []string{
			custody.CourierAssigned,
			custody.InTransit,
			custody.RecipientUnreachable,
			custody.ReturnProposed,
			custody.Returning,
			custody.Delivered,
			custody.HeldAtPoint,
		} {
			out := projectDeliveryDetail(row, true, false, state)
			if out["agreedFareMinor"] != int64(350000) || out["currency"] != "NGN" || out["requestId"] != "mpr_deliv_1" {
				t.Fatalf("state %s: unexpected money/request fields: %+v", state, out)
			}
			pc, ok := out["pickupContact"].(map[string]interface{})
			if !ok || pc == nil || pc["name"] != "Adaeze Okafor" || pc["phone"] != "+234••••2222" {
				t.Fatalf("state %s: sender pickupContact = %+v", state, out["pickupContact"])
			}
			dc, ok := out["dropoffContact"].(map[string]interface{})
			if !ok || dc == nil || dc["name"] != "Chinedu Eze" || dc["phone"] != "+234••••4444" {
				t.Fatalf("state %s: sender dropoffContact = %+v", state, out["dropoffContact"])
			}
		}
	})

	t.Run("driver receives pickupContact only at courier_assigned and returning, and dropoffContact only while in_transit", func(t *testing.T) {
		// At courier_assigned: pickupContact present (masked), dropoffContact nil.
		assigned := projectDeliveryDetail(row, false, true, custody.CourierAssigned)
		if assigned["pickupContact"] == nil {
			t.Fatal("driver at courier_assigned must receive pickupContact")
		}
		if assigned["dropoffContact"] != nil {
			t.Fatalf("driver at courier_assigned must NOT receive dropoffContact, got %+v", assigned["dropoffContact"])
		}

		// At in_transit: dropoffContact present (masked), pickupContact nil.
		inTransit := projectDeliveryDetail(row, false, true, custody.InTransit)
		if inTransit["pickupContact"] != nil {
			t.Fatalf("driver at in_transit must NOT receive pickupContact, got %+v", inTransit["pickupContact"])
		}
		dc, ok := inTransit["dropoffContact"].(map[string]interface{})
		if !ok || dc == nil || dc["name"] != "Chinedu Eze" || dc["phone"] != "+234••••4444" {
			t.Fatalf("driver at in_transit dropoffContact = %+v", inTransit["dropoffContact"])
		}

		// At returning: pickupContact present (masked) so courier can return to sender; dropoffContact nil.
		returning := projectDeliveryDetail(row, false, true, custody.Returning)
		if returning["pickupContact"] == nil {
			t.Fatal("driver at returning must receive pickupContact")
		}
		if returning["dropoffContact"] != nil {
			t.Fatalf("driver at returning must NOT receive dropoffContact, got %+v", returning["dropoffContact"])
		}

		// At recipient_unreachable, return_proposed, held_at_point, delivered, return_to_sender, collected: neither contact exposed.
		for _, state := range []string{
			custody.RecipientUnreachable,
			custody.ReturnProposed,
			custody.HeldAtPoint,
			custody.Delivered,
			custody.ReturnToSender,
			custody.Collected,
			custody.Cancelled,
		} {
			out := projectDeliveryDetail(row, false, true, state)
			if out["pickupContact"] != nil || out["dropoffContact"] != nil {
				t.Fatalf("driver at %s must not receive contacts, got pickup=%v dropoff=%v",
					state, out["pickupContact"], out["dropoffContact"])
			}
		}
	})
}
