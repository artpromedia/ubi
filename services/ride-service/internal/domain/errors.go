package domain

import "errors"

// Domain errors
var (
	// Ride errors
	ErrRideNotFound           = errors.New("ride not found")
	ErrRideAlreadyEnded       = errors.New("ride has already ended")
	ErrInvalidStatusTransition = errors.New("invalid status transition")
	ErrRideAlreadyAssigned    = errors.New("ride already assigned to a driver")
	ErrRideNotActive          = errors.New("ride is not active")
	ErrCannotCancelRide       = errors.New("ride cannot be cancelled in current state")
	
	// Driver errors
	ErrDriverNotFound         = errors.New("driver not found")
	ErrDriverNotAvailable     = errors.New("driver is not available")
	ErrDriverBusy             = errors.New("driver is busy with another ride")
	ErrDriverNotOnline        = errors.New("driver is not online")
	ErrDriverAlreadyAssigned  = errors.New("driver already assigned to this ride")
	ErrNoDriversAvailable     = errors.New("no drivers available in the area")
	
	// Location errors
	ErrInvalidLocation        = errors.New("invalid location coordinates")
	ErrLocationOutOfService   = errors.New("location is outside service area")
	ErrRouteNotFound          = errors.New("could not find route between locations")
	
	// Pricing errors
	ErrPricingFailed          = errors.New("failed to calculate price")
	ErrInvalidPromoCode       = errors.New("invalid or expired promo code")
	ErrPromoCodeAlreadyUsed   = errors.New("promo code already used")
	
	// Payment errors
	ErrInsufficientBalance    = errors.New("insufficient wallet balance")
	ErrPaymentFailed          = errors.New("payment processing failed")
	
	// Matching errors
	ErrMatchingFailed         = errors.New("failed to match driver")
	ErrMatchingTimeout        = errors.New("matching timeout - no driver accepted")
	
	// General errors
	ErrInvalidRequest         = errors.New("invalid request")
	ErrUnauthorized           = errors.New("unauthorized")
	ErrForbidden              = errors.New("forbidden")
	ErrInternal               = errors.New("internal server error")
)

// Error codes for API responses
const (
	ErrCodeRideNotFound           = "RIDE_NOT_FOUND"
	ErrCodeRideAlreadyEnded       = "RIDE_ALREADY_ENDED"
	ErrCodeInvalidStatusTransition = "INVALID_STATUS_TRANSITION"
	ErrCodeRideAlreadyAssigned    = "RIDE_ALREADY_ASSIGNED"
	ErrCodeRideNotActive          = "RIDE_NOT_ACTIVE"
	ErrCodeCannotCancelRide       = "CANNOT_CANCEL_RIDE"
	
	ErrCodeDriverNotFound         = "DRIVER_NOT_FOUND"
	ErrCodeDriverNotAvailable     = "DRIVER_NOT_AVAILABLE"
	ErrCodeDriverBusy             = "DRIVER_BUSY"
	ErrCodeNoDriversAvailable     = "NO_DRIVERS_AVAILABLE"
	
	ErrCodeInvalidLocation        = "INVALID_LOCATION"
	ErrCodeOutOfService           = "OUT_OF_SERVICE_AREA"
	ErrCodeRouteNotFound          = "ROUTE_NOT_FOUND"
	
	ErrCodePricingFailed          = "PRICING_FAILED"
	ErrCodeInvalidPromoCode       = "INVALID_PROMO_CODE"
	
	ErrCodeInsufficientBalance    = "INSUFFICIENT_BALANCE"
	ErrCodePaymentFailed          = "PAYMENT_FAILED"
	
	ErrCodeMatchingFailed         = "MATCHING_FAILED"
	ErrCodeMatchingTimeout        = "MATCHING_TIMEOUT"
	
	ErrCodeInvalidRequest         = "INVALID_REQUEST"
	ErrCodeUnauthorized           = "UNAUTHORIZED"
	ErrCodeForbidden              = "FORBIDDEN"
	ErrCodeInternal               = "INTERNAL_ERROR"
)
