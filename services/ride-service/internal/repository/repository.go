// Package repository reads the shared tables this service does not own.
//
// The ledger belongs to payment-service: it posts a ride's completion entry
// into public.journal_entries / public.journal_lines. The ride-service never
// writes there. It reads, because slice 02 says the final fare on a completed
// ride comes from the ledger — not from the client, and not from a number this
// service happens to remember.
package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// FareSource says where a reported final fare came from, so a client and an
// operator can tell a settled amount from one still awaiting the ledger.
type FareSource string

const (
	// FareFromLedger means payment-service has posted the entry and this is
	// what the journal says the rider was charged.
	FareFromLedger FareSource = "ledger"
	// FareFromServer means the ledger has not posted yet (or, for a cash ride,
	// never will — the rider handed the driver the money), so the amount is the
	// server-computed figure that was published for posting.
	FareFromServer FareSource = "server"
)

// FinalFare is the amount a completed ride settled at.
type FinalFare struct {
	Amount domain.Money
	Source FareSource
}

// LedgerRepository reads the double-entry journal.
type LedgerRepository struct {
	pool *pgxpool.Pool
}

// NewLedgerRepository builds the reader.
func NewLedgerRepository(pool *pgxpool.Pool) *LedgerRepository {
	return &LedgerRepository{pool: pool}
}

// rideReference is the reference payment-service posts a ride entry under
// (services/payment-service/src/ledger/ride-posting.ts).
func rideReference(rideID uuid.UUID) string { return "ride:" + rideID.String() }

// RideFare returns what the ledger says a ride was charged.
//
// It reads the fare line by its counterpart reference rather than by summing
// the entry, because an entry also carries the service fee, the driver's share
// and any tip, and a tip is explicitly not part of the fare. A cash ride posts
// no fare line at all — the rider paid the driver directly — so this reports
// "not found" and the caller falls back to the server-computed amount, saying
// so rather than implying the ledger confirmed it.
func (r *LedgerRepository) RideFare(ctx context.Context, rideID uuid.UUID) (*FinalFare, error) {
	if r == nil || r.pool == nil {
		return nil, domain.ErrNotFound
	}

	reference := rideReference(rideID)
	var amountMinor int64
	var currency string
	err := r.pool.QueryRow(ctx, `
		SELECT -l.amount_minor, l.currency
		FROM public.journal_lines l
		JOIN public.journal_entries e ON e.id = l.entry_id
		WHERE e.reference = $1
			AND l.counterpart_ref = $2
		ORDER BY l.created_at DESC
		LIMIT 1`, reference, reference+":fare").Scan(&amountMinor, &currency)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the ledger fare for ride %s: %w", rideID, err)
	}

	return &FinalFare{
		Amount: domain.Money{AmountMinor: amountMinor, Currency: currency},
		Source: FareFromLedger,
	}, nil
}

// RidePosted reports whether the ledger holds a completion entry for a ride,
// including a cash ride whose entry records only the commission owed.
func (r *LedgerRepository) RidePosted(ctx context.Context, rideID uuid.UUID) (bool, error) {
	if r == nil || r.pool == nil {
		return false, nil
	}
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.journal_entries
			WHERE reference = $1 AND kind IN ('ride_completion', 'ride_completion_cash')
		)`, rideReference(rideID)).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check the ledger for ride %s: %w", rideID, err)
	}
	return exists, nil
}
