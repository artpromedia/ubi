package marketplace

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// pinVaultTTL is the backstop lifetime of a stored PIN. Lifecycle gating (the
// ride must still be in a PIN-relevant state) is the real control; this is only
// so an abandoned row cannot be retrieved days later.
const pinVaultTTL = 24 * time.Hour

// PIN retrieval rate limit: a rider fetching their own PIN is a rare, deliberate
// act. A short window with a small cap makes automated enumeration pointless
// without getting in a real rider's way.
const (
	pinRetrievalWindow   = time.Minute
	pinRetrievalMaxCount = 5
)

// pinRelevantStates are the execution-ride states in which the pickup PIN is
// still meaningful: the driver is assigned/arriving and the PIN has not yet been
// verified. Once the ride starts (or reaches any terminal state) the PIN is
// spent and retrieval is refused.
func pinRelevant(state string) bool {
	switch state {
	case machine.RiderDriverAssigned, machine.RiderDriverArrived, machine.RiderPinVerification:
		return true
	default:
		return false
	}
}

// ---------------------------------------------------------------------------
// At-rest encryption
//
// The vault stores AES-256-GCM ciphertext, never the plaintext PIN. The key is
// derived from the service secret (RIDE_PIN_VAULT_SECRET, falling back to the
// existing RIDE_INTERNAL_CONTEXT_SECRET) so a database reader without the app
// secret cannot read a usable PIN — the same protection bcrypt gives the ride's
// stored hash. In dev/test, where no secret is configured, a fixed key keeps
// the vault working; production sets the secret.
// ---------------------------------------------------------------------------

var (
	pinKeyOnce sync.Once
	pinKey     [32]byte
)

func pinVaultKey() [32]byte {
	pinKeyOnce.Do(func() {
		secret := os.Getenv("RIDE_PIN_VAULT_SECRET")
		if secret == "" {
			secret = os.Getenv("RIDE_INTERNAL_CONTEXT_SECRET")
		}
		if secret == "" {
			// Dev/test fallback: deterministic so the vault round-trips without
			// any configuration. Never a production posture — production sets a
			// secret and this branch is not taken.
			secret = "ride-mp-pin-vault-development-key-do-not-use-in-production"
		}
		pinKey = sha256.Sum256([]byte("mp.pin.vault.v1:" + secret))
	})
	return pinKey
}

func encryptPin(pin string) (ciphertext, nonce []byte, err error) {
	key := pinVaultKey()
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build the PIN cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to build the PIN GCM: %w", err)
	}
	nonce = make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, nil, fmt.Errorf("failed to generate a PIN nonce: %w", err)
	}
	ciphertext = gcm.Seal(nil, nonce, []byte(pin), nil)
	return ciphertext, nonce, nil
}

func decryptPin(ciphertext, nonce []byte) (string, error) {
	key := pinVaultKey()
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", fmt.Errorf("failed to build the PIN cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("failed to build the PIN GCM: %w", err)
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", fmt.Errorf("failed to open the PIN ciphertext: %w", err)
	}
	return string(plaintext), nil
}

// ---------------------------------------------------------------------------
// Store access
// ---------------------------------------------------------------------------

// pinVaultRow is one stored, encrypted PIN with its retrieval-rate state.
type pinVaultRow struct {
	ExecutionID    uuid.UUID
	RequestID      uuid.UUID
	RequesterID    uuid.UUID
	Ciphertext     []byte
	Nonce          []byte
	ExpiresAt      time.Time
	RetrievalCount int
	WindowStart    time.Time
}

// InsertExecutionPin captures a ride's encrypted PIN in the caller's
// transaction. It is idempotent per execution ride: a replayed creation keeps
// the first ciphertext (ON CONFLICT DO NOTHING) so a retried saga step never
// rewrites the vault.
func (s *Store) InsertExecutionPin(ctx context.Context, tx pgx.Tx, row pinVaultRow) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO mp.execution_pins (
			execution_id, request_id, requester_id, ciphertext, nonce, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (execution_id) DO NOTHING`,
		row.ExecutionID, row.RequestID, row.RequesterID, row.Ciphertext, row.Nonce, row.ExpiresAt,
	)
	if err != nil {
		return fmt.Errorf("failed to store the execution PIN: %w", err)
	}
	return nil
}

// ExecutionPinForRequest reads the vault row for a request, locking it FOR
// UPDATE so the rate-limit counter can be advanced atomically.
func (s *Store) ExecutionPinForRequest(ctx context.Context, tx pgx.Tx, requestID uuid.UUID) (*pinVaultRow, error) {
	var row pinVaultRow
	err := tx.QueryRow(ctx, `
		SELECT execution_id, request_id, requester_id, ciphertext, nonce,
		       expires_at, retrieval_count, window_start
		FROM mp.execution_pins
		WHERE request_id = $1
		FOR UPDATE`, requestID).Scan(
		&row.ExecutionID, &row.RequestID, &row.RequesterID, &row.Ciphertext, &row.Nonce,
		&row.ExpiresAt, &row.RetrievalCount, &row.WindowStart,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the execution PIN: %w", err)
	}
	return &row, nil
}

// SetExecutionPinWindow persists the advanced rate-limit window/counter.
func (s *Store) SetExecutionPinWindow(ctx context.Context, tx pgx.Tx, executionID uuid.UUID, count int, windowStart time.Time) error {
	_, err := tx.Exec(ctx, `
		UPDATE mp.execution_pins
		SET retrieval_count = $2, window_start = $3
		WHERE execution_id = $1`, executionID, count, windowStart)
	if err != nil {
		return fmt.Errorf("failed to advance the PIN retrieval window: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Service surface
// ---------------------------------------------------------------------------

// storeExecutionPin encrypts and vaults the PIN for a just-created execution
// ride, in the caller's transaction (both the current-slot award and the
// promotion path go through createExecutionRide, so both are covered). The
// plaintext never leaves this call except into the ciphertext.
func (s *Service) storeExecutionPin(ctx context.Context, tx pgx.Tx, request *Request, executionID uuid.UUID, pin string, now time.Time) error {
	ciphertext, nonce, err := encryptPin(pin)
	if err != nil {
		return err
	}
	return s.deps.Store.InsertExecutionPin(ctx, tx, pinVaultRow{
		ExecutionID: executionID,
		RequestID:   request.ID,
		RequesterID: request.RequesterID,
		Ciphertext:  ciphertext,
		Nonce:       nonce,
		ExpiresAt:   now.Add(pinVaultTTL),
	})
}

// PinView answers GET /v1/mp/requests/{id}/pin (contract PickupPin).
type PinView struct {
	RideID    string    `json:"rideId"`
	Pin       string    `json:"pin"`
	State     string    `json:"state"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// RetrievePin returns the pickup PIN for a marketplace execution ride over the
// authenticated REST channel. Owner-only (a foreign rider gets 404, exactly as
// the request snapshot does), lifecycle-restricted (refused once the PIN is
// spent), rate-limited, and it NEVER logs the PIN or puts it in any event.
func (s *Service) RetrievePin(ctx context.Context, actor Actor, requestID uuid.UUID) (*PinView, error) {
	if !actor.IsRider() {
		// Only the requester retrieves a rider PIN; do not leak existence.
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}

	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), requestID)
	if errors.Is(err, domain.ErrNotFound) {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	if err != nil {
		return nil, asDomainError(err)
	}
	// Ownership: mirror the request snapshot — a non-owner learns nothing.
	if request.RequesterID != actor.UserID {
		return nil, domain.Errorf(domain.CodeNotFound, "that request does not exist")
	}
	return s.retrieveVaultPin(ctx, requestID)
}

// retrieveVaultPin decrypts a request's execution PIN for a caller already
// entitled to it (the requester, or the guest passenger's trip link), under
// the vault's lifecycle gate and its one per-execution retrieval rate limit.
func (s *Service) retrieveVaultPin(ctx context.Context, requestID uuid.UUID) (*PinView, error) {
	var view *PinView
	err := s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		row, err := s.deps.Store.ExecutionPinForRequest(ctx, tx, requestID)
		if errors.Is(err, domain.ErrNotFound) {
			// The owner exists but there is no PIN to hand back (no execution
			// ride yet, or it was never a PIN ride): a plain not-found.
			return domain.Errorf(domain.CodeNotFound, "there is no pickup PIN to retrieve for this request")
		}
		if err != nil {
			return err
		}

		now := s.now()
		if now.After(row.ExpiresAt) {
			return domain.Errorf(domain.CodeConflict, "the pickup PIN is no longer available")
		}

		// Lifecycle gate: the execution ride must still be in a PIN-relevant
		// state, read LIVE (not from the vault row), so a spent PIN cannot be
		// re-fetched even though the vault entry lingers.
		ride, err := s.deps.Store.ExecutionRideRow(ctx, tx, row.ExecutionID)
		if errors.Is(err, domain.ErrNotFound) {
			return domain.Errorf(domain.CodeConflict, "the pickup PIN is no longer available")
		}
		if err != nil {
			return err
		}
		if !pinRelevant(ride.State) {
			return domain.Errorf(domain.CodeConflict, "the pickup PIN cannot be retrieved in this state").
				WithDetails(map[string]any{"state": ride.State})
		}

		// Rate limit: a sliding fixed window on the vault row.
		count := row.RetrievalCount
		windowStart := row.WindowStart
		if now.Sub(windowStart) >= pinRetrievalWindow {
			count = 0
			windowStart = now
		}
		if count >= pinRetrievalMaxCount {
			return domain.Errorf(domain.CodeRateLimited, "too many PIN retrievals; try again shortly")
		}
		if err := s.deps.Store.SetExecutionPinWindow(ctx, tx, row.ExecutionID, count+1, windowStart); err != nil {
			return err
		}

		pin, err := decryptPin(row.Ciphertext, row.Nonce)
		if err != nil {
			return err
		}
		view = &PinView{
			RideID:    row.ExecutionID.String(),
			Pin:       pin,
			State:     ride.State,
			ExpiresAt: row.ExpiresAt,
		}
		return nil
	})
	if err != nil {
		return nil, asDomainError(err)
	}
	return view, nil
}
