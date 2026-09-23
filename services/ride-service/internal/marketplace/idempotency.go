package marketplace

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/move"
)

// Idempotency scopes for the marketplace's state-creating POSTs. Each scope
// namespaces its keys in mp.idempotency_keys.
const (
	scopeRequestCreate   = "mp.request.create"
	scopeRequestRevise   = "mp.request.revise"
	scopeRequestCancel   = "mp.request.cancel"
	scopeBidCreate       = "mp.bid.create"
	scopeSelect          = "mp.select"
	scopeBidRevise       = "mp.bid.revise"
	scopeBidWithdraw     = "mp.bid.withdraw"
	scopeRateProfileSave = "mp.rate_profile.save"
	scopeAdminRepair     = "mp.admin.repair"

	// A04.2: PATCH /v1/mp/driver/preferences.
	scopePreferencesPatch = "mp.driver_preferences.patch"

	// C08 admin resolution/standing scopes.
	scopeAdminRecoveryRetry   = "mp.admin.recovery_retry"
	scopeAdminAwardReconcile  = "mp.admin.award_reconcile"
	scopeStandingPropose      = "mp.admin.standing.propose"
	scopeStandingApprove      = "mp.admin.standing.approve"
	scopeStandingAppeal       = "mp.admin.standing.appeal"
	scopeStandingAppealDecide = "mp.admin.standing.appeal_decide"

	// A03 Book for Later.
	scopeScheduledCreate  = "mp.scheduled.create"
	scopeScheduledCancel  = "mp.scheduled.cancel"
	scopeScheduledApprove = "mp.scheduled.approve"
	scopeAdvanceCreate    = "mp.advance.create"
	scopeBookingCancel    = "mp.booking.cancel"
	scopeBookingReconfirm = "mp.booking.reconfirm"
	scopeBookingWithdraw  = "mp.booking.withdraw"
	scopeBookingRematch   = "mp.booking.rematch"
	scopeTemplateCreate   = "mp.template.create"
	scopeTemplateCommand  = "mp.template.command"
	scopeOccurrenceSkip   = "mp.template.skip"

	// A05 fleet calendar: the rider's "cancel and release" on a failed
	// booking, the driver's decision on a vehicle swap and the rider's on a
	// vehicle change. (Contract A's scopes live in fleet_internal.go.)
	scopeBookingRelease   = "mp.booking.release"
	scopeSwapDriverDecide = "mp.booking.swap.driver"
	scopeSwapRiderDecide  = "mp.booking.swap.rider"
)

// ValidateIdempotencyKey mirrors IdempotencyKeySchema, via the move package so
// both surfaces stay one definition.
func ValidateIdempotencyKey(key string) error {
	return move.ValidateIdempotencyKey(key)
}

// fingerprint is the hash of the request body a key was first used with.
func fingerprint(body any) (string, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("unserialisable request: %w", err)
	}
	sum := sha256.Sum256(encoded)
	return base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

// IdempotentResult is a stored response, replayed byte-for-byte.
type IdempotentResult struct {
	StatusCode int
	Response   json.RawMessage
}

// LookupIdempotent returns the stored response for a key, or nil when the key
// is new. A key reused with a different body is refused.
func (s *Store) LookupIdempotent(ctx context.Context, db DB, scope string, actorID uuid.UUID, key string, request any) (*IdempotentResult, error) {
	hash, err := fingerprint(request)
	if err != nil {
		return nil, err
	}

	var storedHash string
	var status int
	var response []byte
	err = db.QueryRow(ctx, `
		SELECT request_hash, status_code, response
		FROM mp.idempotency_keys
		WHERE scope = $1 AND actor_id = $2 AND key = $3`,
		scope, actorID, key).Scan(&storedHash, &status, &response)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to read idempotency record: %w", err)
	}
	if storedHash != hash {
		return nil, domain.Errorf(domain.CodeIdempotencyKeyReuse,
			"idempotency key %s was already used with a different request body", key)
	}
	return &IdempotentResult{StatusCode: status, Response: response}, nil
}

// SaveIdempotent stores the response a key produced, in the same transaction
// as the work it describes.
func (s *Store) SaveIdempotent(ctx context.Context, db DB, scope string, actorID uuid.UUID, key string, request any, status int, response any) error {
	hash, err := fingerprint(request)
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		return fmt.Errorf("unserialisable response: %w", err)
	}
	_, err = db.Exec(ctx, `
		INSERT INTO mp.idempotency_keys (scope, actor_id, key, request_hash, status_code, response)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (scope, actor_id, key) DO NOTHING`,
		scope, actorID, key, hash, status, encoded)
	if err != nil {
		return fmt.Errorf("failed to store idempotency record: %w", err)
	}
	return nil
}

// decodeJSON reads a stored idempotent response back into its view type.
func decodeJSON(raw json.RawMessage, target any) error {
	if err := json.Unmarshal(raw, target); err != nil {
		return fmt.Errorf("stored idempotent response is unreadable: %w", err)
	}
	return nil
}
