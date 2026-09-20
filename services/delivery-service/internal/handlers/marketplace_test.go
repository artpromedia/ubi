/*
 * Unit tests for the marketplace assignment adapter's pure decision helpers.
 *
 * The handler itself needs a live pgx pool against the (unmanaged)
 * deliveries DDL and this environment has no docker/testcontainers, so the
 * decisions — payload validation, package jsonb shaping, the legacy-float
 * conversion and the MARKETPLACE_MANAGED guard — are extracted as pure
 * functions and tested here without a database.
 */

package handlers

import (
	"encoding/json"
	"testing"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/models"
)

func validAssignRequest() MarketplaceAssignRequest {
	return MarketplaceAssignRequest{
		AwardID:    "awd_123",
		RequestID:  "mpr_456",
		DriverID:   "drv_789",
		CustomerID: "usr_abc",
		FareMinor:  125_000,
		Currency:   "NGN",
		Pickup:     models.Location{Latitude: 6.4281, Longitude: 3.4219, Address: "VI", City: "Lagos", Country: "NG"},
		Dropoff:    models.Location{Latitude: 6.4433, Longitude: 3.4917, Address: "Lekki", City: "Lagos", Country: "NG"},
		PackageDetails: models.Package{
			Description: "Documents",
			Size:        models.PackageSizeSmall,
			Weight:      1.2,
			RequiresPOD: true,
		},
		FencingToken: 7,
	}
}

func TestValidateMarketplaceAssign(t *testing.T) {
	t.Run("accepts a complete payload", func(t *testing.T) {
		req := validAssignRequest()
		if problems := validateMarketplaceAssign(&req); len(problems) != 0 {
			t.Fatalf("expected no problems, got %v", problems)
		}
	})

	t.Run("rejects missing identifiers and bad money", func(t *testing.T) {
		cases := []struct {
			name   string
			mutate func(*MarketplaceAssignRequest)
		}{
			{"missing awardId", func(r *MarketplaceAssignRequest) { r.AwardID = "" }},
			{"missing requestId", func(r *MarketplaceAssignRequest) { r.RequestID = "" }},
			{"missing driverId", func(r *MarketplaceAssignRequest) { r.DriverID = "" }},
			{"missing customerId", func(r *MarketplaceAssignRequest) { r.CustomerID = "" }},
			{"zero fare", func(r *MarketplaceAssignRequest) { r.FareMinor = 0 }},
			{"negative fare", func(r *MarketplaceAssignRequest) { r.FareMinor = -100 }},
			{"bad currency", func(r *MarketplaceAssignRequest) { r.Currency = "NAIRA" }},
			{"missing pickup", func(r *MarketplaceAssignRequest) { r.Pickup = models.Location{} }},
			{"missing dropoff", func(r *MarketplaceAssignRequest) { r.Dropoff = models.Location{} }},
			{"negative fencing token", func(r *MarketplaceAssignRequest) { r.FencingToken = -1 }},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				req := validAssignRequest()
				tc.mutate(&req)
				if problems := validateMarketplaceAssign(&req); len(problems) == 0 {
					t.Fatalf("expected a validation problem for %s", tc.name)
				}
			})
		}
	})
}

func TestStorageFareFromMinor(t *testing.T) {
	cases := []struct {
		name      string
		fareMinor int64
		currency  string
		want      float64
	}{
		{"NGN two minor digits", 125_050, "NGN", 1250.50},
		{"NGN whole amount", 125_000, "NGN", 1250.0},
		{"UGX zero minor digits", 5_000, "UGX", 5000.0},
		{"XOF zero minor digits", 750, "XOF", 750.0},
		{"unknown currency defaults to two digits", 999, "EUR", 9.99},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := storageFareFromMinor(tc.fareMinor, tc.currency)
			if got != tc.want {
				t.Fatalf("storageFareFromMinor(%d, %q) = %v, want %v", tc.fareMinor, tc.currency, got, tc.want)
			}
		})
	}
}

func TestMarketplacePackageJSON(t *testing.T) {
	req := validAssignRequest()
	raw, err := marketplacePackageJSON(req.PackageDetails, req.AwardID, req.RequestID, req.FareMinor, req.FencingToken)
	if err != nil {
		t.Fatalf("marketplacePackageJSON returned error: %v", err)
	}

	var doc map[string]interface{}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("result is not valid JSON: %v", err)
	}

	// Marketplace linkage present.
	if got := doc[packageKeyMarketplaceAwardID]; got != "awd_123" {
		t.Fatalf("marketplaceAwardId = %v, want awd_123", got)
	}
	if got := doc[packageKeyRequestID]; got != "mpr_456" {
		t.Fatalf("marketplaceRequestId = %v, want mpr_456", got)
	}
	if got := doc[packageKeyAgreedFareMinor]; got != float64(125_000) {
		t.Fatalf("agreedFareMinor = %v, want 125000", got)
	}
	if got := doc[packageKeyFencingToken]; got != float64(7) {
		t.Fatalf("fencingToken = %v, want 7", got)
	}

	// Original package fields survive (the POD gate reads requiresPod).
	if got := doc["description"]; got != "Documents" {
		t.Fatalf("description = %v, want Documents", got)
	}
	if got := doc["requiresPod"]; got != true {
		t.Fatalf("requiresPod = %v, want true", got)
	}

	// The guard recognizes what the adapter wrote: the same payload the
	// insert stores is the payload AcceptDelivery later refuses.
	if !isMarketplaceManaged(raw) {
		t.Fatal("isMarketplaceManaged should be true for adapter-written package JSON")
	}
}

func TestIsMarketplaceManaged(t *testing.T) {
	cases := []struct {
		name string
		json string
		want bool
	}{
		{"empty payload", "", false},
		{"null payload", "null", false},
		{"invalid json", "{not-json", false},
		{"ordinary package", `{"description":"Shoes","size":"SMALL","requiresPod":false}`, false},
		{"award id present", `{"description":"Shoes","marketplaceAwardId":"awd_1"}`, true},
		{"award id empty string", `{"marketplaceAwardId":""}`, false},
		{"award id wrong type", `{"marketplaceAwardId":42}`, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var payload []byte
			if tc.json != "" {
				payload = []byte(tc.json)
			}
			if got := isMarketplaceManaged(payload); got != tc.want {
				t.Fatalf("isMarketplaceManaged(%q) = %v, want %v", tc.json, got, tc.want)
			}
		})
	}
}
