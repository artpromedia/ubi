/*
 * Marketplace Assignment Adapter (M03 delivery parity)
 *
 * The negotiated-fare marketplace engine (ride-service) owns the award: it
 * runs the award saga, captures the single 10% commission hold under the
 * award id, and only then tells this service to materialize the delivery.
 * This adapter is the receiving end of that hand-off. It carries the award
 * id, the fencing token and the agreed fare — it never prices anything and
 * never touches money beyond recording the agreed amount.
 *
 * See docs/adr/0002-marketplace-award-authority.md and
 * contracts/openapi/marketplace.yaml.
 */

package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/models"
)

// Keys stored inside the deliveries.package jsonb column. The deliveries DDL
// is unmanaged (no migration owns it), so the marketplace linkage rides in
// the existing jsonb column instead of new columns — NO DDL changes here.
const (
	packageKeyMarketplaceAwardID = "marketplaceAwardId"
	packageKeyAgreedFareMinor    = "agreedFareMinor"
	packageKeyFencingToken       = "marketplaceFencingToken"
	packageKeyRequestID          = "marketplaceRequestId"
)

// MarketplaceAssignRequest is the body of the internal
// POST /api/v1/webhooks/marketplace-assign call from the marketplace engine.
type MarketplaceAssignRequest struct {
	AwardID        string          `json:"awardId"`
	RequestID      string          `json:"requestId"`
	DriverID       string          `json:"driverId"`
	CustomerID     string          `json:"customerId"`
	FareMinor      int64           `json:"fareMinor"`
	Currency       string          `json:"currency"`
	Pickup         models.Location `json:"pickup"`
	Dropoff        models.Location `json:"dropoff"`
	PackageDetails models.Package  `json:"packageDetails"`
	FencingToken   int64           `json:"fencingToken"`
}

// committedDefaultServiceKey is the INTERNAL_SERVICE_KEY fallback baked into
// internal/config/config.go. It is public knowledge (it lives in the
// repository), so it can never authenticate the marketplace award hand-off.
const committedDefaultServiceKey = "internal-key"

// marketplaceAssignKeyUsable reports whether the configured internal service
// key is strong enough to guard the marketplace-assign hand-off. The endpoint
// mints deliveries already DRIVER_ASSIGNED with payment_status AUTHORIZED, so
// it must fail closed when the key is absent or still the committed default —
// a real deployment has to set a strong INTERNAL_SERVICE_KEY for the
// marketplace hand-off to function. Deliberately scoped to this handler: the
// legacy payment/order webhooks keep their existing behavior. Pure —
// unit-tested without a database.
func marketplaceAssignKeyUsable(key string) bool {
	return key != "" && key != committedDefaultServiceKey
}

// validateMarketplaceAssign returns the list of field problems in an
// assignment payload. Pure — unit-tested without a database.
func validateMarketplaceAssign(req *MarketplaceAssignRequest) []string {
	var problems []string
	if req.AwardID == "" {
		problems = append(problems, "awardId is required")
	}
	if req.RequestID == "" {
		problems = append(problems, "requestId is required")
	}
	if req.DriverID == "" {
		problems = append(problems, "driverId is required")
	}
	if req.CustomerID == "" {
		problems = append(problems, "customerId is required")
	}
	if req.FareMinor <= 0 {
		problems = append(problems, "fareMinor must be a positive integer minor amount")
	}
	if len(req.Currency) != 3 {
		problems = append(problems, "currency must be a 3-letter ISO-4217 code")
	}
	if req.Pickup.Latitude == 0 && req.Pickup.Longitude == 0 {
		problems = append(problems, "pickup location is required")
	}
	if req.Dropoff.Latitude == 0 && req.Dropoff.Longitude == 0 {
		problems = append(problems, "dropoff location is required")
	}
	if req.FencingToken < 0 {
		problems = append(problems, "fencingToken must be a non-negative integer")
	}
	return problems
}

// currencyMinorUnitDigits maps the currencies this service accepts to their
// ISO-4217 minor-unit exponent. Used ONLY to render the legacy float column;
// never for money math.
var currencyMinorUnitDigits = map[string]int64{
	"NGN": 2,
	"KES": 2,
	"GHS": 2,
	"TZS": 2,
	"ZAR": 2,
	"UGX": 0,
	"XOF": 0,
}

// storageFareFromMinor converts an integer minor-unit fare to the float64
// shape of the legacy deliveries.total_fare column, at the storage boundary
// only. The AUTHORITATIVE amount lives in the marketplace/ledger in integer
// minor units (deliveries.package->>'agreedFareMinor' mirrors it); this
// float exists solely so legacy list/track queries keep rendering. Pure.
func storageFareFromMinor(fareMinor int64, currency string) float64 {
	digits, ok := currencyMinorUnitDigits[currency]
	if !ok {
		digits = 2
	}
	divisor := int64(1)
	for i := int64(0); i < digits; i++ {
		divisor *= 10
	}
	// Integer division first keeps the whole-unit part exact; only the
	// sub-unit remainder passes through floating point.
	return float64(fareMinor/divisor) + float64(fareMinor%divisor)/float64(divisor)
}

// marketplacePackageJSON embeds the marketplace linkage (award id, agreed
// fare in minor units, fencing token, request id) into the package jsonb
// payload. Pure — unit-tested without a database.
func marketplacePackageJSON(pkg models.Package, awardID, requestID string, fareMinor, fencingToken int64) ([]byte, error) {
	raw, err := json.Marshal(pkg)
	if err != nil {
		return nil, err
	}
	var doc map[string]interface{}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, err
	}
	doc[packageKeyMarketplaceAwardID] = awardID
	doc[packageKeyRequestID] = requestID
	doc[packageKeyAgreedFareMinor] = fareMinor
	doc[packageKeyFencingToken] = fencingToken
	return json.Marshal(doc)
}

// isMarketplaceManaged reports whether a delivery's package jsonb carries a
// marketplace award reference, meaning its assignment lifecycle belongs to
// the marketplace award saga and the open-market accept path must refuse it.
// Pure — unit-tested without a database.
func isMarketplaceManaged(packageJSON []byte) bool {
	if len(packageJSON) == 0 {
		return false
	}
	var doc map[string]interface{}
	if err := json.Unmarshal(packageJSON, &doc); err != nil {
		return false
	}
	awardID, ok := doc[packageKeyMarketplaceAwardID].(string)
	return ok && awardID != ""
}

// marketplaceDeliverySummary is the response shape for both the fresh insert
// and the idempotent replay, so callers cannot tell the two apart.
type marketplaceDeliverySummary struct {
	ID                 string    `json:"id"`
	TrackingNumber     string    `json:"trackingNumber"`
	Status             string    `json:"status"`
	DriverID           string    `json:"driverId"`
	CustomerID         string    `json:"customerId"`
	MarketplaceAwardID string    `json:"marketplaceAwardId"`
	AgreedFareMinor    int64     `json:"agreedFareMinor"`
	Currency           string    `json:"currency"`
	CreatedAt          time.Time `json:"createdAt"`
}

// findDeliveryByAwardID returns the delivery already created for an award,
// or nil when none exists. This is the idempotency lookup: the award id is
// the natural key of the hand-off.
func (h *Handler) findDeliveryByAwardID(ctx context.Context, awardID string) (*marketplaceDeliverySummary, error) {
	query := `
		SELECT id, tracking_number, status, COALESCE(driver_id, ''), customer_id,
			package->>'` + packageKeyMarketplaceAwardID + `',
			COALESCE((package->>'` + packageKeyAgreedFareMinor + `')::bigint, 0),
			currency, created_at
		FROM deliveries
		WHERE package->>'` + packageKeyMarketplaceAwardID + `' = $1
		LIMIT 1
	`
	var d marketplaceDeliverySummary
	err := h.db.Pool.QueryRow(ctx, query, awardID).Scan(
		&d.ID, &d.TrackingNumber, &d.Status, &d.DriverID, &d.CustomerID,
		&d.MarketplaceAwardID, &d.AgreedFareMinor, &d.Currency, &d.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// MarketplaceAssign handles POST /api/v1/webhooks/marketplace-assign
// (ServiceAuth). Idempotent on awardId: a replay answers 200 with the
// delivery the first call created; a fresh award creates the delivery
// already DRIVER_ASSIGNED — the award saga has decided the winner, so this
// row never passes through the open-market CONFIRMED pool.
func (h *Handler) MarketplaceAssign(w http.ResponseWriter, r *http.Request) {
	// Fail closed under a missing or committed-default service key: ServiceAuth
	// already matched the caller's X-Service-Key against the configured value,
	// but when that value is the publicly known repo default (or empty) the
	// match proves nothing, and this endpoint mints assigned, payment-authorized
	// deliveries. 503, honestly: the deployment is misconfigured, not the caller.
	if !marketplaceAssignKeyUsable(h.cfg.InternalServiceKey) {
		respondError(w, http.StatusServiceUnavailable, "SERVICE_KEY_NOT_CONFIGURED",
			"Marketplace assignment is disabled: INTERNAL_SERVICE_KEY must be set to a non-default value")
		return
	}

	var req MarketplaceAssignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "INVALID_JSON", "Invalid request body")
		return
	}

	if problems := validateMarketplaceAssign(&req); len(problems) > 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(response{
			Success: false,
			Error: &errorInfo{
				Code:    "VALIDATION_ERROR",
				Message: "Invalid marketplace assignment payload",
				Details: problems,
			},
		})
		return
	}

	// Idempotent replay before taking any lock: the common retry case.
	if existing, err := h.findDeliveryByAwardID(r.Context(), req.AwardID); err == nil && existing != nil {
		respond(w, http.StatusOK, existing)
		return
	}

	// The unmanaged deliveries DDL offers no unique index over the package
	// jsonb, so a short Redis SETNX lock keyed by the award id guards the
	// check-then-insert against concurrent replays (same idiom as
	// AcceptDelivery's delivery lock).
	lockKey := "delivery:mp-assign:" + req.AwardID
	acquired, err := h.rdb.SetNX(r.Context(), lockKey, req.DriverID, 30*time.Second)
	if err != nil || !acquired {
		// A concurrent call holds the lock. It either finished (return its
		// row) or is still inserting (tell the caller to retry).
		if existing, lookupErr := h.findDeliveryByAwardID(r.Context(), req.AwardID); lookupErr == nil && existing != nil {
			respond(w, http.StatusOK, existing)
			return
		}
		respondError(w, http.StatusConflict, "ASSIGN_IN_PROGRESS", "This award is already being processed; retry shortly")
		return
	}

	// Re-check under the lock: the earlier holder may have committed between
	// our first lookup and the SETNX.
	if existing, lookupErr := h.findDeliveryByAwardID(r.Context(), req.AwardID); lookupErr == nil && existing != nil {
		h.rdb.Delete(r.Context(), lockKey)
		respond(w, http.StatusOK, existing)
		return
	}

	packageJSON, err := marketplacePackageJSON(req.PackageDetails, req.AwardID, req.RequestID, req.FareMinor, req.FencingToken)
	if err != nil {
		h.rdb.Delete(r.Context(), lockKey)
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to encode package details")
		return
	}

	distance := haversineDistance(
		req.Pickup.Latitude, req.Pickup.Longitude,
		req.Dropoff.Latitude, req.Dropoff.Longitude,
	)
	estimatedMinutes := int((distance / 20.0) * 60)
	if estimatedMinutes < 15 {
		estimatedMinutes = 15
	}

	deliveryID := "del_" + uuid.New().String()[:12]
	trackingNumber := generateTrackingNumber()

	pickupLoc, _ := json.Marshal(req.Pickup)
	dropoffLoc, _ := json.Marshal(req.Dropoff)
	emptyContact, _ := json.Marshal(models.ContactInfo{})

	// Legacy float column at the storage boundary ONLY: the authoritative
	// agreed amount is integer minor units, kept in the marketplace/ledger
	// and mirrored in package->>'agreedFareMinor'.
	storageFare := storageFareFromMinor(req.FareMinor, req.Currency)

	query := `
		INSERT INTO deliveries (
			id, tracking_number, customer_id, driver_id, type, status,
			pickup_location, dropoff_location, pickup_contact, dropoff_contact,
			package, distance_km, estimated_minutes,
			base_fare, distance_fare, time_fare, surge_fare, service_fee, insurance_fee, total_fare,
			currency, payment_status,
			confirmed_at, driver_assigned_at,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			$7, $8, $9, $10,
			$11, $12, $13,
			0, 0, 0, 0, 0, 0, $14,
			$15, $16,
			NOW(), NOW(),
			NOW(), NOW()
		)
		RETURNING created_at
	`

	var createdAt time.Time
	err = h.db.Pool.QueryRow(r.Context(), query,
		deliveryID, trackingNumber, req.CustomerID, req.DriverID, models.DeliveryTypeStandard, models.DeliveryStatusDriverAssigned,
		pickupLoc, dropoffLoc, emptyContact, emptyContact,
		packageJSON, distance, estimatedMinutes,
		storageFare,
		// AUTHORIZED, not PAID: the award saga authorized rider funding;
		// capture/settlement stays with the marketplace and payment-service.
		req.Currency, "AUTHORIZED",
	).Scan(&createdAt)

	if err != nil {
		h.rdb.Delete(r.Context(), lockKey)
		log.Error().Err(err).Str("awardId", req.AwardID).Msg("Failed to create marketplace delivery")
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to create delivery")
		return
	}

	// Audit trail + the existing realtime channel, matching AcceptDelivery.
	h.createDeliveryEvent(r.Context(), deliveryID, "driver_assigned", string(models.DeliveryStatusDriverAssigned), nil, nil)
	h.rdb.Publish(r.Context(), "delivery:driver_assigned", map[string]interface{}{
		"deliveryId":         deliveryID,
		"driverId":           req.DriverID,
		"customerId":         req.CustomerID,
		"marketplaceAwardId": req.AwardID,
	})

	respond(w, http.StatusCreated, marketplaceDeliverySummary{
		ID:                 deliveryID,
		TrackingNumber:     trackingNumber,
		Status:             string(models.DeliveryStatusDriverAssigned),
		DriverID:           req.DriverID,
		CustomerID:         req.CustomerID,
		MarketplaceAwardID: req.AwardID,
		AgreedFareMinor:    req.FareMinor,
		Currency:           req.Currency,
		CreatedAt:          createdAt,
	})
}
