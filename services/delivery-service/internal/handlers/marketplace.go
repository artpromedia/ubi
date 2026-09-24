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
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/models"
)

// Keys stored inside the deliveries.marketplace_metadata jsonb column
// (packages/database/prisma migration 20260921033947_delivery_custody). This
// is the hand-off's own metadata, never authoritative money — the agreed fare
// stays authoritative in the marketplace/ledger in integer minor units.
//
// History note: an earlier version of this adapter documented the linkage as
// riding in a `deliveries.package` jsonb column and said the deliveries DDL
// was wholly unmanaged. Both were wrong — `deliveries` is Prisma-owned
// (packages/database/prisma baseline) and has never had a `package` column;
// this adapter could not actually insert a row against the real schema
// (invalid UUID id, nonexistent customer_id/driver_id/pickup_location/package
// columns — see the C07 report for the full account). `marketplace_metadata`
// and `driver_id` are the two columns that migration adds so this hand-off
// can genuinely run.
const (
	packageKeyMarketplaceAwardID = "marketplaceAwardId"
	packageKeyAgreedFareMinor    = "agreedFareMinor"
	packageKeyFencingToken       = "marketplaceFencingToken"
	packageKeyRequestID          = "marketplaceRequestId"
)

// deliveryCurrencies are the ISO-4217 codes the deliveries.currency column
// (a Postgres enum generated from Prisma's `Currency`) actually accepts.
// UGX/TZS/XOF, which storageFareFromMinor and validateMarketplaceAssign's
// generic "3 letters" check would otherwise wave through, are NOT members —
// inserting one would fail with an opaque enum error, so this is checked
// explicitly and refused with a clear message instead.
var deliveryCurrencies = map[string]struct{}{
	"NGN": {}, "KES": {}, "ZAR": {}, "GHS": {}, "RWF": {}, "ETB": {}, "USD": {},
}

// placeholderPaymentMethod is stored on every marketplace-assigned delivery.
// The marketplace-assign payload carries no payment method — funding is
// decided upstream by the marketplace engine/payment-service — and
// deliveries.payment_method is a required, non-nullable enum column with no
// "marketplace_managed" member. WALLET is the least misleading choice given
// the marketplace's own funding is wallet-first (G02/C02); this is a known
// placeholder, not a real payment-method record, until the marketplace-assign
// payload is extended to carry the funding method it actually used.
const placeholderPaymentMethod = "WALLET"

// MarketplaceAssignRequest is the body of the internal
// POST /api/v1/webhooks/marketplace-assign call from the marketplace engine.
//
// Identities (P17): CustomerID is the requester's USER id (users.id — the
// same identity the gateway signs as x-auth-user-id and ride-service's award
// carries) and DriverID the winning driver's user id; both are UUIDs.
// deliveries.sender_id, however, is a foreign key to riders.id — a rider
// PROFILE — so this adapter resolves the requester's profile itself
// (resolveSenderProfile) and refuses the hand-off when there is none. The
// custody row keeps the USER id (delivery_custody.sender_id), because the
// custody access matrix compares it against the gateway-verified actor.
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
	} else if _, err := uuid.Parse(req.DriverID); err != nil {
		problems = append(problems, "driverId must be the driver's user id (a UUID)")
	}
	if req.CustomerID == "" {
		problems = append(problems, "customerId is required")
	} else if _, err := uuid.Parse(req.CustomerID); err != nil {
		problems = append(problems, "customerId must be the requester's user id (a UUID)")
	}
	if req.DriverID != "" && req.DriverID == req.CustomerID {
		problems = append(problems, "the requester cannot be the delivery's own driver")
	}
	if req.FareMinor <= 0 {
		problems = append(problems, "fareMinor must be a positive integer minor amount")
	}
	if len(req.Currency) != 3 {
		problems = append(problems, "currency must be a 3-letter ISO-4217 code")
	} else if _, ok := deliveryCurrencies[req.Currency]; !ok {
		problems = append(problems, "currency "+req.Currency+" is not one deliveries.currency accepts")
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

// marketplaceMetadataJSON builds the deliveries.marketplace_metadata payload:
// the hand-off's own linkage (award id, agreed fare in minor units, fencing
// token, request id) — never authoritative money. Pure — unit-tested without
// a database. (Package attributes — size/weight/description/fragile/POD — are
// stored on their own real columns now; they no longer pass through this
// jsonb blob, unlike the "package" shape an earlier version of this file
// assumed.)
func marketplaceMetadataJSON(awardID, requestID string, fareMinor, fencingToken int64) ([]byte, error) {
	doc := map[string]interface{}{
		packageKeyMarketplaceAwardID: awardID,
		packageKeyRequestID:          requestID,
		packageKeyAgreedFareMinor:    fareMinor,
		packageKeyFencingToken:       fencingToken,
	}
	return json.Marshal(doc)
}

// isMarketplaceManaged reports whether a delivery's marketplace_metadata
// jsonb carries a marketplace award reference, meaning its assignment
// lifecycle belongs to the marketplace award saga and the open-market accept
// path must refuse it. Pure — unit-tested without a database.
func isMarketplaceManaged(metadataJSON []byte) bool {
	if len(metadataJSON) == 0 {
		return false
	}
	var doc map[string]interface{}
	if err := json.Unmarshal(metadataJSON, &doc); err != nil {
		return false
	}
	awardID, ok := doc[packageKeyMarketplaceAwardID].(string)
	return ok && awardID != ""
}

// marketplaceDeliverySummary is the response shape for both the fresh insert
// and the idempotent replay, so callers cannot tell the two apart.
type marketplaceDeliverySummary struct {
	ID             string `json:"id"`
	TrackingNumber string `json:"trackingNumber"`
	Status         string `json:"status"`
	DriverID       string `json:"driverId"`
	// CustomerID is the requester's user id, as the award sent it.
	CustomerID string `json:"customerId"`
	// SenderProfileID is the rider profile deliveries.sender_id references.
	SenderProfileID    string    `json:"senderProfileId"`
	MarketplaceAwardID string    `json:"marketplaceAwardId"`
	AgreedFareMinor    int64     `json:"agreedFareMinor"`
	Currency           string    `json:"currency"`
	CreatedAt          time.Time `json:"createdAt"`
}

// findDeliveryByAwardID returns the delivery already created for an award,
// or nil when none exists. This is the idempotency lookup: the award id is
// the natural key of the hand-off.
func (h *Handler) findDeliveryByAwardID(ctx context.Context, awardID string) (*marketplaceDeliverySummary, error) {
	// sender_id is the rider PROFILE; the summary answers the requester's user
	// id (riders.user_id) as customerId, exactly as the first call did.
	query := `
		SELECT d.id, d.tracking_number, d.status, COALESCE(d.driver_id::text, ''),
			r.user_id::text, d.sender_id::text,
			d.marketplace_metadata->>'` + packageKeyMarketplaceAwardID + `',
			COALESCE((d.marketplace_metadata->>'` + packageKeyAgreedFareMinor + `')::bigint, 0),
			d.currency, d.created_at
		FROM deliveries d
		JOIN riders r ON r.id = d.sender_id
		WHERE d.marketplace_metadata->>'` + packageKeyMarketplaceAwardID + `' = $1
		LIMIT 1
	`
	var d marketplaceDeliverySummary
	err := h.db.Pool.QueryRow(ctx, query, awardID).Scan(
		&d.ID, &d.TrackingNumber, &d.Status, &d.DriverID, &d.CustomerID, &d.SenderProfileID,
		&d.MarketplaceAwardID, &d.AgreedFareMinor, &d.Currency, &d.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

// errNoSenderProfile: the requester has no rider profile, so there is no
// identity deliveries.sender_id may reference.
var errNoSenderProfile = errors.New("the requester has no rider profile")

// resolveSenderProfile maps the award's requester (a user id) to the rider
// profile deliveries.sender_id references. Read-only against the canonical
// riders table (user_id is unique there); it never creates a profile — a
// delivery is not the place to invent one.
func resolveSenderProfile(ctx context.Context, q interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}, customerID string) (string, error) {
	var riderID string
	err := q.QueryRow(ctx, `SELECT id::text FROM riders WHERE user_id = $1`, customerID).Scan(&riderID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errNoSenderProfile
	}
	if err != nil {
		return "", err
	}
	return riderID, nil
}

// replayMatches reports whether a replayed hand-off names the same parties as
// the delivery its award already created. The award id is the idempotency
// key; a replay that disagrees about who is sending or driving is a caller
// bug, answered with a conflict rather than with someone else's delivery.
func replayMatches(existing *marketplaceDeliverySummary, req *MarketplaceAssignRequest) bool {
	return existing.CustomerID == req.CustomerID && existing.DriverID == req.DriverID
}

func respondAssignReplay(w http.ResponseWriter, existing *marketplaceDeliverySummary, req *MarketplaceAssignRequest) {
	if !replayMatches(existing, req) {
		respondError(w, http.StatusConflict, "AWARD_REPLAY_MISMATCH",
			"This award already created a delivery for a different requester or driver")
		return
	}
	respond(w, http.StatusOK, existing)
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
		_ = json.NewEncoder(w).Encode(response{
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
		respondAssignReplay(w, existing, &req)
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
			respondAssignReplay(w, existing, &req)
			return
		}
		respondError(w, http.StatusConflict, "ASSIGN_IN_PROGRESS", "This award is already being processed; retry shortly")
		return
	}

	// Re-check under the lock: the earlier holder may have committed between
	// our first lookup and the SETNX.
	if existing, lookupErr := h.findDeliveryByAwardID(r.Context(), req.AwardID); lookupErr == nil && existing != nil {
		_ = h.rdb.Delete(r.Context(), lockKey)
		respondAssignReplay(w, existing, &req)
		return
	}

	// The requester's rider profile — the identity deliveries.sender_id's
	// foreign key demands. No profile, no delivery: refused before anything
	// is written, with a code the award saga can treat as permanent (it must
	// compensate the award rather than retry).
	senderProfileID, err := resolveSenderProfile(r.Context(), h.db.Pool, req.CustomerID)
	if errors.Is(err, errNoSenderProfile) {
		_ = h.rdb.Delete(r.Context(), lockKey)
		respondError(w, http.StatusUnprocessableEntity, "SENDER_PROFILE_NOT_FOUND",
			"The requester has no rider profile; a marketplace delivery's sender must be a rider")
		return
	}
	if err != nil {
		_ = h.rdb.Delete(r.Context(), lockKey)
		log.Error().Err(err).Str("awardId", req.AwardID).Msg("Failed to resolve the requester's rider profile")
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to resolve the requester's rider profile")
		return
	}

	metadataJSON, err := marketplaceMetadataJSON(req.AwardID, req.RequestID, req.FareMinor, req.FencingToken)
	if err != nil {
		_ = h.rdb.Delete(r.Context(), lockKey)
		respondError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "Failed to encode marketplace metadata")
		return
	}

	// deliveries.id is UUID (packages/database/prisma baseline), not a
	// prefixed string: a previous "del_" + uuid[:12] shape here produced
	// something like "del_3fa85f64-571", which Postgres rejects outright
	// ("invalid input syntax for type uuid") — this handler could not
	// actually insert a row against the real schema. Found and fixed while
	// wiring delivery_custody's FK to this same column (C07/G08); the
	// analogous "del_"/"evt_" shapes in handlers.go/driver.go are a
	// pre-existing, separate defect on the legacy open-market path this
	// prompt does not touch (its events insert into a table — delivery_events
	// — that has no migration at all, so those calls already no-op there;
	// see the C07 report).
	deliveryID := uuid.New().String()
	trackingNumber := generateTrackingNumber()

	// Legacy `price` column at the storage boundary ONLY: the authoritative
	// agreed amount is integer minor units, kept in the marketplace/ledger and
	// mirrored in marketplace_metadata->>'agreedFareMinor'. Passed as text so
	// pgx's simple parameter binding doesn't have to guess a NUMERIC(12,2)
	// representation for a bare float64.
	storagePrice := fmt.Sprintf("%.2f", storageFareFromMinor(req.FareMinor, req.Currency))

	query := `
		INSERT INTO deliveries (
			id, tracking_number, sender_id, driver_id, status,
			pickup_address, pickup_latitude, pickup_longitude, pickup_contact, pickup_phone,
			dropoff_address, dropoff_latitude, dropoff_longitude, dropoff_contact, dropoff_phone,
			package_size, package_weight, package_description, is_fragile, requires_signature,
			price, currency, payment_method, payment_status,
			marketplace_metadata,
			created_at, updated_at
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, $10,
			$11, $12, $13, $14, $15,
			$16, $17, $18, $19, $20,
			$21::numeric, $22, $23, $24,
			$25,
			NOW(), NOW()
		)
		RETURNING created_at
	`

	// The delivery, its custody row and the custody's first event commit
	// together or not at all (P17): a marketplace delivery without custody
	// tracking has no proof, return or timeline endpoints, so the earlier
	// best-effort seeding after the insert could strand one. A failure rolls
	// everything back and answers 500; the award saga's retry is then a fresh,
	// idempotent attempt, never a duplicate.
	tx, err := h.db.Pool.Begin(r.Context())
	if err != nil {
		_ = h.rdb.Delete(r.Context(), lockKey)
		log.Error().Err(err).Str("awardId", req.AwardID).Msg("Failed to begin the marketplace delivery transaction")
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to create delivery")
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	var createdAt time.Time
	err = tx.QueryRow(r.Context(), query,
		// sender_id is the requester's rider PROFILE (riders.id), never the
		// raw user id the award carries — see resolveSenderProfile.
		deliveryID, trackingNumber, senderProfileID, req.DriverID,
		// DeliveryStatus (Prisma enum: PENDING, PICKED_UP, IN_TRANSIT,
		// OUT_FOR_DELIVERY, DELIVERED, FAILED, RETURNED) has no
		// "driver_assigned"/"confirmed" member, so PENDING is the closest
		// honest pre-pickup value; the delivery_custody row this handler also
		// seeds (courier_assigned) is the actual source of truth for "a
		// driver is already assigned" from here on.
		"PENDING",
		req.Pickup.Address, req.Pickup.Latitude, req.Pickup.Longitude, "", "",
		req.Dropoff.Address, req.Dropoff.Latitude, req.Dropoff.Longitude, "", "",
		string(req.PackageDetails.Size), req.PackageDetails.Weight, req.PackageDetails.Description,
		req.PackageDetails.Fragile, req.PackageDetails.RequiresPOD,
		storagePrice, req.Currency, placeholderPaymentMethod,
		// PENDING, not a settlement claim: PaymentStatus (Prisma enum) has no
		// "authorized" member. The award saga already authorized rider
		// funding; capture/settlement stays with the marketplace and
		// payment-service and this column does not attempt to mirror it.
		"PENDING",
		metadataJSON,
	).Scan(&createdAt)
	if err == nil {
		// Custody tracking (C07, G08): seeded at CourierAssigned since the
		// award saga already picked the driver. The custody sender is the
		// requester's USER id: the access matrix compares it with the
		// gateway-verified actor.
		err = seedMarketplaceCustody(r.Context(), tx, deliveryID, req.CustomerID, req.DriverID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		_ = h.rdb.Delete(r.Context(), lockKey)
		log.Error().Err(err).Str("awardId", req.AwardID).Msg("Failed to create marketplace delivery")
		respondError(w, http.StatusInternalServerError, "DATABASE_ERROR", "Failed to create delivery")
		return
	}

	// Audit trail + the existing realtime channel, matching AcceptDelivery.
	h.createDeliveryEvent(r.Context(), deliveryID, "driver_assigned", string(models.DeliveryStatusDriverAssigned), nil, nil)
	_ = h.rdb.Publish(r.Context(), "delivery:driver_assigned", map[string]interface{}{
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
		SenderProfileID:    senderProfileID,
		MarketplaceAwardID: req.AwardID,
		AgreedFareMinor:    req.FareMinor,
		Currency:           req.Currency,
		CreatedAt:          createdAt,
	})
}
