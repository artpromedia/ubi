package move

import (
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/machine"
)

// assertDriverTransition refuses any driver move the contract does not allow
// and reports it with the canonical illegal_transition code.
func assertDriverTransition(from, to string) error {
	if err := machine.Assert(machine.Driver, from, to); err != nil {
		allowed, _ := machine.Allowed(machine.Driver, from)
		return domain.Errorf(domain.CodeIllegalTransition, "a driver cannot move from %s to %s", from, to).
			WithDetails(map[string]any{"from": from, "to": to, "allowed": allowed}).
			Wrap(err)
	}
	return nil
}

// WireStatus maps a rider-machine state to the uppercase status label the
// mobile clients render. The machine state stays canonical and is also sent;
// this is only the wire word the board uses — a ride in `matching` shows as
// SEARCHING on both apps.
func WireStatus(state string) string {
	switch state {
	case machine.RiderRequesting, machine.RiderMatching, machine.RiderRematching:
		return "SEARCHING"
	case machine.RiderNoDriver:
		return "NO_DRIVER"
	case machine.RiderDriverAssigned:
		return "DRIVER_ASSIGNED"
	case machine.RiderDriverArrived:
		return "DRIVER_ARRIVED"
	case machine.RiderPinVerification:
		return "PIN_VERIFICATION"
	case machine.RiderInProgress:
		return "IN_PROGRESS"
	case machine.RiderSafetyHold:
		return "SAFETY_HOLD"
	case machine.RiderCompleted, machine.RiderPaymentPending, machine.RiderPaymentFailed:
		return "COMPLETED"
	case machine.RiderRated:
		return "RATED"
	case machine.RiderNoShow:
		return "NO_SHOW"
	case machine.RiderCancelledByRider, machine.RiderCancelledByOps:
		return "CANCELLED"
	default:
		return "UNKNOWN"
	}
}
