package move

import (
	"context"
	"time"

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

// DriverActivityObserver is notified AFTER a driver's go-online, and a live
// trip's start, have committed. The marketplace implements it for the fleet
// calendar's off-road abuse control (A05, decisions correction 4): a vehicle
// a fleet reported off the road that goes online or starts a trip during
// the claimed breakdown is flagged to UBI ops. Like ExecutionObserver it is a
// post-commit courtesy — the marketplace sweep is the durable backstop for
// the drivers it knows ride a vehicle — and nil is nobody listening.
type DriverActivityObserver interface {
	DriverWentOnline(ctx context.Context, driverID uuid.UUID, cityID string, onlineSince time.Time)
	TripStarted(ctx context.Context, rideID, driverID uuid.UUID, cityID string)
}

// SetDriverActivityObserver wires the observer. It is called once from the
// composition root, after both services exist.
func (s *Service) SetDriverActivityObserver(observer DriverActivityObserver) {
	s.activity = observer
}

// notifyWentOnline invokes the activity observer, if any, after commit.
func (s *Service) notifyWentOnline(ctx context.Context, driverID uuid.UUID, cityID string, onlineSince time.Time) {
	if s.activity != nil {
		s.activity.DriverWentOnline(ctx, driverID, cityID, onlineSince)
	}
}

// notifyTripStarted invokes the activity observer, if any, after commit.
func (s *Service) notifyTripStarted(ctx context.Context, rideID, driverID uuid.UUID, cityID string) {
	if s.activity != nil {
		s.activity.TripStarted(ctx, rideID, driverID, cityID)
	}
}

// RiderCancelGuard is asked BEFORE a rider cancels a marketplace-managed ride
// (one carrying a marketplace award), outside any transaction, and may refuse
// it with a definite error. The marketplace implements it for business trips
// (A06 part C): a booker who has left the organization may no longer cancel a
// colleague's trip. nil is nobody asking.
type RiderCancelGuard interface {
	AuthorizeRiderCancel(ctx context.Context, awardID, riderID uuid.UUID) error
}

// SetRiderCancelGuard wires the guard. It is called once from the
// composition root, after both services exist.
func (s *Service) SetRiderCancelGuard(guard RiderCancelGuard) {
	s.cancelGuard = guard
}
