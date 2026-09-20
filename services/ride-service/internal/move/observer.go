package move

import (
	"context"

	"github.com/google/uuid"
)

// ExecutionObserver is notified AFTER a ride's terminal transition has
// committed. The marketplace implements it to release the driver's capacity
// claim and promote a queued next job; the interface lives here so the move
// package never imports the marketplace (no import cycle), and a nil observer
// is simply nobody listening.
//
// The callback is a post-commit courtesy, not the mechanism of record: the
// marketplace's durable sweep scans for finished executions on its own, so a
// crash between commit and callback loses nothing.
type ExecutionObserver interface {
	ExecutionTerminal(ctx context.Context, rideID uuid.UUID)
}

// SetExecutionObserver wires the observer. It is called once from the
// composition root, after both services exist.
func (s *Service) SetExecutionObserver(observer ExecutionObserver) {
	s.observer = observer
}

// notifyExecutionTerminal invokes the observer, if any. Call it only after
// the terminal transition's transaction has committed.
func (s *Service) notifyExecutionTerminal(ctx context.Context, rideID uuid.UUID) {
	if s.observer != nil {
		s.observer.ExecutionTerminal(ctx, rideID)
	}
}
