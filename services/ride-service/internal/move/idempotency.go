package move

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// IdempotencyHeader is the header every POST that creates or moves money or
// state takes. The name matches IDEMPOTENCY_HEADER in packages/contracts.
const IdempotencyHeader = "Idempotency-Key"

const idempotencyKeyMaxLength = 64

var idempotencyKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]+$`)

// ValidateIdempotencyKey mirrors IdempotencyKeySchema in packages/contracts.
func ValidateIdempotencyKey(key string) error {
	switch {
	case key == "":
		return domain.Errorf(domain.CodeValidationFailed, "%s is required", IdempotencyHeader)
	case len(key) < 8:
		return domain.Errorf(domain.CodeValidationFailed, "idempotency key must be at least 8 characters")
	case len(key) > idempotencyKeyMaxLength:
		return domain.Errorf(domain.CodeValidationFailed, "idempotency key must be at most %d characters", idempotencyKeyMaxLength)
	case !idempotencyKeyPattern.MatchString(key):
		return domain.Errorf(domain.CodeValidationFailed, "idempotency key must be url-safe")
	}
	return nil
}

// fingerprint is the hash of the request body a key was first used with, so a
// replay with a different body is a conflict rather than a different answer.
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
		FROM ride.idempotency_keys
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

// SaveIdempotent stores the response a key produced. It is written in the same
// transaction as the work it describes, so a replay can never find a recorded
// answer for work that did not commit.
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
		INSERT INTO ride.idempotency_keys (scope, actor_id, key, request_hash, status_code, response)
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
