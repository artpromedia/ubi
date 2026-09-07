// Package move implements slice 02 — the Move core lockstep: signed quotes,
// ride creation, ring dispatch, offer acceptance, arrival, PIN verification,
// start, completion and cancellation.
//
// The package owns the `ride` schema (see schema.sql) and every transition in
// it. A transition is only ever written together with its outbox event and its
// audit row, in one transaction, after the contract machine has allowed it.
package move

import (
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// asDomainError turns any error this package produces into the canonical error
// a client sees. Anything unrecognised becomes internal_error with the cause
// kept for the logs, so a database message never reaches a rider's screen.
func asDomainError(err error) *domain.Error {
	if err == nil {
		return nil
	}
	if mapped, ok := domain.AsError(err); ok {
		return mapped
	}
	switch {
	case errors.Is(err, domain.ErrNotFound), errors.Is(err, pgx.ErrNoRows):
		return domain.Errorf(domain.CodeNotFound, "not found").Wrap(err)
	case errors.Is(err, cityconfig.ErrUnknownCity):
		return domain.Errorf(domain.CodeCityUnsupported, "this city is not open for rides").Wrap(err)
	case errors.Is(err, cityconfig.ErrUnavailable):
		// Fail closed: an unreadable configuration refuses the request rather
		// than falling back to numbers nobody approved (CLAUDE.md #1, #5).
		return domain.Errorf(domain.CodeConfigUnavailable, "city configuration is unavailable").Wrap(err)
	default:
		return domain.Errorf(domain.CodeInternalError, "the request could not be completed").Wrap(err)
	}
}
