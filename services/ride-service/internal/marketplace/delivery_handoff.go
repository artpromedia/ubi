package marketplace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/cityconfig"
	"github.com/ubi-africa/ubi-monorepo/services/ride-service/internal/domain"
)

// The delivery hand-off (the award-saga producer for delivery-service's
// marketplace-assign endpoint; services/delivery-service/docs/
// MARKETPLACE-DELIVERY-ENABLEMENT.md §4a).
//
// A service=delivery award runs the same saga as a ride — funding, then the
// ONE 10% commission capture under the award id — and then, instead of
// writing an execution ride, hands the award to delivery-service, which
// materialises the delivery (already assigned to the winning driver) and its
// custody record. The hand-off is its own durable step in the saga ledger
// (mp.award_attempts step `delivery_handoff`), written in the same row the
// capture step advances, so:
//
//   - it runs only after the capture committed, and never re-captures: the
//     step touches no money at all;
//   - a crash anywhere — before the call, after delivery-service committed
//     but before the answer was recorded, mid-retry — resumes from the ledger
//     through the stalled-award sweep, and delivery-service's idempotency on
//     the award id turns every re-send into a 200 replay of the ONE delivery;
//   - an ambiguous answer (network failure, timeout, 5xx, 409
//     ASSIGN_IN_PROGRESS, an unreadable body) is never guessed at: the award
//     stays pending and the sweep asks again with backoff until delivery-
//     service gives a definite answer;
//   - a PERMANENT refusal (400 VALIDATION_ERROR, 409 AWARD_REPLAY_MISMATCH,
//     422 SENDER_PROFILE_NOT_FOUND) compensates the award through the one
//     compensation funnel — the captured fee reversed with a linked entry,
//     the rider's funding released — and alarms;
//   - a deployment misconfiguration (no URL or key here, 403 from the service
//     key check, 503 SERVICE_KEY_NOT_CONFIGURED) alarms and keeps the award
//     pending: the fix is configuration, and nothing was promised.
//
// The award is confirmed (and mp.award.confirmed published) only after the
// 201/200 — transport is never promised before the delivery exists — and the
// execution it records is {service: delivery, id: <the delivery's id>}.
// Everything is behind marketplace_delivery for the request's city: while it
// is off and nothing has been put on the wire, nothing is sent and the award
// is compensated. Once a send MAY have reached delivery-service (the durable
// unresolved_sends write-ahead, taken under the hand-off row's lock before
// every call), the flag no longer decides: the delivery may already exist, so
// switching new sales off must not strand it — the step keeps reconciling
// through the idempotent re-send until delivery-service answers definitely.

// AttemptStepHandoff is the saga step between capture and finalize for a
// delivery award.
const AttemptStepHandoff = "delivery_handoff"

// Delivery hand-off record states (mp.delivery_handoffs.state).
const (
	HandoffSending   = "sending"
	HandoffDelivered = "delivered"
	HandoffUnknown   = "unknown"
	HandoffRefused   = "refused"
	HandoffBlocked   = "blocked"
	HandoffDisabled  = "disabled"
)

// deliveryAssignPath is delivery-service's marketplace-assign route.
const deliveryAssignPath = "/api/v1/webhooks/marketplace-assign"

// committedDefaultDeliveryKey is delivery-service's committed INTERNAL_SERVICE_KEY
// fallback. It is public, so it can never authenticate the hand-off: a
// client configured with it is treated as not configured at all.
const committedDefaultDeliveryKey = "internal-key"

// DeliveryLocation is the marketplace-assign pickup/dropoff shape.
type DeliveryLocation struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Address   string  `json:"address"`
}

// DeliveryPackage is the marketplace-assign packageDetails shape.
type DeliveryPackage struct {
	Description string  `json:"description"`
	Size        string  `json:"size"`
	Weight      float64 `json:"weight"`
	Fragile     bool    `json:"fragile"`
	RequiresPod bool    `json:"requiresPod"`
}

// DeliveryAssignRequest is the documented body of
// POST {DELIVERY_SERVICE_URL}/api/v1/webhooks/marketplace-assign.
// CustomerID is the requester's USER id (never a rider profile id) and
// DriverID the winning driver's user id; FareMinor is the awarded fare in
// integer minor units and FencingToken the award claim's fencing token.
type DeliveryAssignRequest struct {
	AwardID        string           `json:"awardId"`
	RequestID      string           `json:"requestId"`
	CustomerID     string           `json:"customerId"`
	DriverID       string           `json:"driverId"`
	FareMinor      int64            `json:"fareMinor"`
	Currency       string           `json:"currency"`
	FencingToken   int64            `json:"fencingToken"`
	Pickup         DeliveryLocation `json:"pickup"`
	Dropoff        DeliveryLocation `json:"dropoff"`
	PackageDetails DeliveryPackage  `json:"packageDetails"`
}

// DeliveryAssignment is delivery-service's answer to a 201 (created) or 200
// (replay of the same award, same parties).
type DeliveryAssignment struct {
	ID                 string `json:"id"`
	TrackingNumber     string `json:"trackingNumber"`
	Status             string `json:"status"`
	DriverID           string `json:"driverId"`
	CustomerID         string `json:"customerId"`
	SenderProfileID    string `json:"senderProfileId"`
	MarketplaceAwardID string `json:"marketplaceAwardId"`
	AgreedFareMinor    int64  `json:"agreedFareMinor"`
	Currency           string `json:"currency"`
	// HTTPStatus is 201 for the first creation, 200 for a replay.
	HTTPStatus int `json:"-"`
}

// Hand-off outcome classes.
const (
	// HandoffOutcomeRetry: the outcome is unknown or delivery-service asked
	// for a retry; the award stays pending and the sweep asks again.
	HandoffOutcomeRetry = "retry"
	// HandoffOutcomePermanent: a definite refusal the award is compensated
	// for.
	HandoffOutcomePermanent = "permanent"
	// HandoffOutcomeMisconfigured: the deployment cannot authenticate the
	// hand-off; alarm and keep the award pending.
	HandoffOutcomeMisconfigured = "misconfigured"
)

// DeliveryAssignError is every non-success answer of the hand-off, classified.
type DeliveryAssignError struct {
	Outcome string
	Status  int
	Code    string
	Message string
}

func (e *DeliveryAssignError) Error() string {
	if e.Status == 0 {
		return fmt.Sprintf("delivery hand-off %s: %s", e.Outcome, e.Message)
	}
	return fmt.Sprintf("delivery hand-off %s: %d %s: %s", e.Outcome, e.Status, e.Code, e.Message)
}

// DeliveryAssignPort hands an awarded delivery to delivery-service. It must
// be idempotent on the award id: the saga re-sends the same body after any
// ambiguous answer.
type DeliveryAssignPort interface {
	Assign(ctx context.Context, req DeliveryAssignRequest) (*DeliveryAssignment, error)
}

// HTTPDeliveryAssign talks to delivery-service's marketplace-assign endpoint
// with the internal service key. With no base URL, no key, or the committed
// default key it sends nothing and answers misconfigured: a hand-off nobody
// wired must fail closed.
type HTTPDeliveryAssign struct {
	baseURL    string
	serviceKey string
	client     *http.Client
}

// NewHTTPDeliveryAssign builds the client. `baseURL` is DELIVERY_SERVICE_URL
// and `serviceKey` the INTERNAL_SERVICE_KEY delivery-service is configured
// with.
func NewHTTPDeliveryAssign(baseURL, serviceKey string, client *http.Client) *HTTPDeliveryAssign {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &HTTPDeliveryAssign{baseURL: strings.TrimRight(baseURL, "/"), serviceKey: serviceKey, client: client}
}

// Configured reports whether the client can authenticate a hand-off at all.
func (c *HTTPDeliveryAssign) Configured() bool {
	return c != nil && c.baseURL != "" && c.serviceKey != "" && c.serviceKey != committedDefaultDeliveryKey
}

// deliveryEnvelope is delivery-service's response envelope.
type deliveryEnvelope struct {
	Success bool                `json:"success"`
	Data    *DeliveryAssignment `json:"data"`
	Error   *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// Assign implements DeliveryAssignPort exactly per the documented contract.
func (c *HTTPDeliveryAssign) Assign(ctx context.Context, req DeliveryAssignRequest) (*DeliveryAssignment, error) {
	if !c.Configured() {
		return nil, &DeliveryAssignError{Outcome: HandoffOutcomeMisconfigured,
			Message: "DELIVERY_SERVICE_URL and a non-default service key are required for the delivery hand-off"}
	}
	encoded, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("unserialisable delivery hand-off: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+deliveryAssignPath, bytes.NewReader(encoded))
	if err != nil {
		return nil, fmt.Errorf("failed to build the delivery hand-off: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Service-Key", c.serviceKey)

	response, err := c.client.Do(request)
	if err != nil {
		// The wire failed: delivery-service may or may not have committed.
		return nil, &DeliveryAssignError{Outcome: HandoffOutcomeRetry, Message: err.Error()}
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return nil, &DeliveryAssignError{Outcome: HandoffOutcomeRetry, Status: response.StatusCode, Message: err.Error()}
	}
	var envelope deliveryEnvelope
	decodeErr := json.Unmarshal(raw, &envelope)

	if response.StatusCode == http.StatusCreated || response.StatusCode == http.StatusOK {
		if decodeErr != nil || !envelope.Success || envelope.Data == nil || envelope.Data.ID == "" {
			// A success status with a body we cannot read proves nothing
			// about WHICH delivery exists: ask again (a replay answers it).
			return nil, &DeliveryAssignError{Outcome: HandoffOutcomeRetry, Status: response.StatusCode,
				Message: "unreadable success body"}
		}
		envelope.Data.HTTPStatus = response.StatusCode
		return envelope.Data, nil
	}

	code, message := "", ""
	if decodeErr == nil && envelope.Error != nil {
		code, message = envelope.Error.Code, envelope.Error.Message
	}
	if message == "" {
		message = http.StatusText(response.StatusCode)
	}
	return nil, &DeliveryAssignError{
		Outcome: classifyDeliveryAnswer(response.StatusCode, code),
		Status:  response.StatusCode,
		Code:    code,
		Message: message,
	}
}

// classifyDeliveryAnswer maps a non-success answer onto the documented
// semantics. Pure — unit-tested without a server.
func classifyDeliveryAnswer(status int, code string) string {
	switch {
	case status == http.StatusConflict && code == "ASSIGN_IN_PROGRESS":
		return HandoffOutcomeRetry
	case status == http.StatusConflict && code == "AWARD_REPLAY_MISMATCH":
		return HandoffOutcomePermanent
	case status == http.StatusBadRequest && (code == "VALIDATION_ERROR" || code == "INVALID_JSON"):
		return HandoffOutcomePermanent
	case status == http.StatusUnprocessableEntity && code == "SENDER_PROFILE_NOT_FOUND":
		return HandoffOutcomePermanent
	case status == http.StatusServiceUnavailable && code == "SERVICE_KEY_NOT_CONFIGURED":
		return HandoffOutcomeMisconfigured
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return HandoffOutcomeMisconfigured
	default:
		// 5xx, a 409 without a known code, a 404 from a mis-routed URL and
		// anything else undocumented: never guessed as permanent.
		return HandoffOutcomeRetry
	}
}

// unconfiguredDelivery is the port used when none was wired: every hand-off
// answers misconfigured and nothing is sent.
type unconfiguredDelivery struct{}

func (unconfiguredDelivery) Assign(context.Context, DeliveryAssignRequest) (*DeliveryAssignment, error) {
	return nil, &DeliveryAssignError{Outcome: HandoffOutcomeMisconfigured,
		Message: "no delivery-service hand-off is configured"}
}

// Configured reports that nothing can ever be sent through this port.
func (unconfiguredDelivery) Configured() bool { return false }

// deliveryPortWired reports whether a call through the port can reach
// delivery-service at all. A port that says it is unconfigured sends
// nothing, so calling it is never counted as a send.
func deliveryPortWired(port DeliveryAssignPort) bool {
	if configured, ok := port.(interface{ Configured() bool }); ok {
		return configured.Configured()
	}
	return true
}

// delivery is the configured hand-off port, or the fail-closed default.
func (s *Service) delivery() DeliveryAssignPort {
	if s.deps.Delivery != nil {
		return s.deps.Delivery
	}
	return unconfiguredDelivery{}
}

// deliveryAssignPayload builds the documented body from the award, its
// request and the award's claim. Package details come from the request's
// delivery block; the size is derived from the stated weight when the block
// names none, because deliveries.package_size is always written.
func deliveryAssignPayload(award *Award, request *Request, claim *Claim) DeliveryAssignRequest {
	pkg := DeliveryPackage{Description: "Marketplace delivery", Size: "SMALL", RequiresPod: true}
	if details := request.Delivery; details != nil {
		if weight, ok := details["weightKg"].(float64); ok && weight > 0 && !math.IsInf(weight, 0) {
			pkg.Weight = weight
			pkg.Size = packageSizeFor(weight)
		}
		if size, ok := details["size"].(string); ok {
			switch strings.ToUpper(size) {
			case "SMALL", "MEDIUM", "LARGE", "XLARGE":
				pkg.Size = strings.ToUpper(size)
			}
		}
		if description, ok := details["description"].(string); ok && strings.TrimSpace(description) != "" {
			pkg.Description = truncateRunes(strings.TrimSpace(description), 200)
		}
		if fragile, ok := details["fragile"].(bool); ok {
			pkg.Fragile = fragile
		}
		if pod, ok := details["requiresPod"].(bool); ok {
			pkg.RequiresPod = pod
		}
	}
	return DeliveryAssignRequest{
		AwardID:        award.ID.String(),
		RequestID:      request.ID.String(),
		CustomerID:     award.RequesterID.String(),
		DriverID:       award.DriverID.String(),
		FareMinor:      award.FareMinor,
		Currency:       request.Currency,
		FencingToken:   claim.FencingToken,
		Pickup:         DeliveryLocation{Latitude: request.Pickup.Lat, Longitude: request.Pickup.Lng, Address: request.Pickup.Label},
		Dropoff:        DeliveryLocation{Latitude: request.Dropoff.Lat, Longitude: request.Dropoff.Lng, Address: request.Dropoff.Label},
		PackageDetails: pkg,
	}
}

// packageSizeFor maps a weight onto delivery-service's size bands.
func packageSizeFor(weightKg float64) string {
	switch {
	case weightKg <= 5:
		return "SMALL"
	case weightKg <= 15:
		return "MEDIUM"
	case weightKg <= 30:
		return "LARGE"
	default:
		return "XLARGE"
	}
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

// assignmentMatches reports whether delivery-service's answer names THIS
// award, these parties and this fare. Anything else is never adopted as the
// award's execution.
func assignmentMatches(answer *DeliveryAssignment, req DeliveryAssignRequest) bool {
	if _, err := uuid.Parse(answer.ID); err != nil {
		return false
	}
	if answer.MarketplaceAwardID != "" && answer.MarketplaceAwardID != req.AwardID {
		return false
	}
	if answer.DriverID != req.DriverID || answer.CustomerID != req.CustomerID {
		return false
	}
	if answer.AgreedFareMinor != 0 && answer.AgreedFareMinor != req.FareMinor {
		return false
	}
	return answer.Currency == "" || answer.Currency == req.Currency
}

// runHandoffStep is the saga's delivery step. It returns done=true once the
// delivery exists and the ledger moved on to finalize; done=false with a nil
// error when the award was compensated.
func (s *Service) runHandoffStep(ctx context.Context, award *Award, attempt *AwardAttempt) (bool, error) {
	request, err := s.deps.Store.RequestByID(ctx, s.deps.Store.Pool(), award.RequestID)
	if err != nil {
		return false, asDomainError(err)
	}
	now := s.now()
	// park records a non-final answer and schedules the next attempt.
	// `resolved` says the answer DEFINITELY created nothing (delivery-service
	// refused before writing), so this send no longer counts as one that may
	// have reached a delivery.
	park := func(state string, cause error, status int, code string, resolved bool) (bool, error) {
		retryAt := now.Add(stepBackoff(attempt.Attempts))
		if recErr := s.deps.Store.RecordHandoffAnswer(ctx, s.deps.Store.Pool(), award.ID, state, status, code, cause.Error(), resolved); recErr != nil {
			s.deps.Logger.Error().Err(recErr).Str("award_id", award.ID.String()).Msg("could not record the delivery hand-off answer")
		}
		if saveErr := s.deps.Store.SaveAttempt(ctx, s.deps.Store.Pool(), award.ID,
			AttemptStepHandoff, AttemptStateUnknown, cause.Error(), &retryAt); saveErr != nil {
			s.deps.Logger.Error().Err(saveErr).Msg("could not park the delivery hand-off step")
		}
		return false, cause
	}

	claim, err := s.deps.Store.ClaimByAwardID(ctx, s.deps.Store.Pool(), award.ID)
	if err != nil {
		return false, asDomainError(err)
	}
	payload := deliveryAssignPayload(award, request, claim)
	if err := s.deps.Store.EnsureHandoff(ctx, s.deps.Store.Pool(), payload, request.CityID); err != nil {
		return false, asDomainError(err)
	}

	// Deny by default, evaluated for the request's city and the requester.
	// The flag decides only while nothing may have reached delivery-service
	// (no unresolved send): then an evaluation failure is not an answer (the
	// sweep asks again) and an OFF flag is — nothing is sent and the award
	// unwinds through the one compensation funnel (the captured fee reversed
	// with a linked entry, never re-charged). The decision and the send's
	// write-ahead are taken under the hand-off row's lock, so a concurrent
	// run can never compensate an award another run is handing off.
	port := s.delivery()
	enabled, flagErr := s.deps.Flags.Enabled(ctx, cityconfig.FlagMarketplaceDelivery, request.CityID, award.RequesterID.String())
	decision, closedReason, err := s.deps.Store.DecideHandoffSend(ctx, award.ID, flagErr == nil, enabled, deliveryPortWired(port))
	if err != nil {
		return false, asDomainError(err)
	}
	switch decision {
	case handoffDecisionFlagUnknown:
		return park(HandoffUnknown, fmt.Errorf("the marketplace_delivery flag could not be evaluated: %w", flagErr), 0, "", false)
	case handoffDecisionDisabled, handoffDecisionClosed:
		// Nothing was ever put on the wire (disabled), or delivery-service
		// already refused this award for good: never sent (again).
		s.compensateAward(ctx, award.ID, closedReason, true)
		return false, nil
	}
	if flagErr != nil || !enabled {
		s.deps.Logger.Warn().Str("award_id", award.ID.String()).
			Msg("marketplace_delivery is off or unreadable, but an earlier hand-off may already have created the delivery; reconciling through the idempotent re-send")
	}

	answer, callErr := port.Assign(ctx, payload)
	if callErr != nil {
		var refusal *DeliveryAssignError
		if !errors.As(callErr, &refusal) {
			return park(HandoffUnknown, callErr, 0, "", false)
		}
		switch refusal.Outcome {
		case HandoffOutcomePermanent:
			s.deps.Logger.Error().Str("award_id", award.ID.String()).Int("status", refusal.Status).
				Str("code", refusal.Code).Msg("ALARM: delivery-service permanently refused the award hand-off; compensating the award")
			// A replay mismatch means a delivery DOES exist for this award
			// (for other parties): that send is not "nothing created".
			if recErr := s.deps.Store.RecordHandoffAnswer(ctx, s.deps.Store.Pool(), award.ID, HandoffRefused,
				refusal.Status, refusal.Code, refusal.Message, refusal.Code != "AWARD_REPLAY_MISMATCH"); recErr != nil {
				s.deps.Logger.Error().Err(recErr).Str("award_id", award.ID.String()).Msg("could not record the refused hand-off")
			}
			s.compensateAward(ctx, award.ID, "delivery_handoff_refused: "+refusal.Code, true)
			return false, nil
		case HandoffOutcomeMisconfigured:
			s.deps.Logger.Error().Str("award_id", award.ID.String()).Int("status", refusal.Status).
				Str("code", refusal.Code).Msg("ALARM: the delivery hand-off cannot authenticate (deployment misconfiguration); the award stays pending")
			// delivery-service's 401/403/503 come before anything is
			// written; an unwired port (status 0) never counted a send.
			return park(HandoffBlocked, refusal, refusal.Status, refusal.Code, refusal.Status != 0)
		default:
			return park(HandoffUnknown, refusal, refusal.Status, refusal.Code, false)
		}
	}
	if !assignmentMatches(answer, payload) {
		s.deps.Logger.Error().Str("award_id", award.ID.String()).Str("delivery_id", answer.ID).
			Msg("ALARM: delivery-service answered a delivery that does not match this award; not adopted")
		return park(HandoffUnknown, errors.New("delivery-service answered a delivery that does not match the award"),
			answer.HTTPStatus, "ASSIGNMENT_MISMATCH", false)
	}

	deliveryID := uuid.MustParse(answer.ID)
	retryAt := now.Add(attemptRetryDelay)
	err = s.deps.Store.InTx(ctx, func(tx pgx.Tx) error {
		if err := s.deps.Store.MarkHandoffDelivered(ctx, tx, award.ID, deliveryID, answer.TrackingNumber, answer.HTTPStatus, now); err != nil {
			return err
		}
		if err := writeAudit(ctx, tx, AuditRecord{
			ActorID:     "ride-service",
			ActorRole:   "system",
			Action:      "mp.delivery.handed_off",
			SubjectType: subjectAward,
			SubjectID:   award.ID.String(),
			After: map[string]any{
				"deliveryId":   deliveryID.String(),
				"httpStatus":   answer.HTTPStatus,
				"fencingToken": payload.FencingToken,
				"fareMinor":    payload.FareMinor,
				"currency":     payload.Currency,
			},
			Reason: "delivery-service materialised the awarded delivery (idempotent on the award id)",
		}); err != nil {
			return err
		}
		return s.deps.Store.SaveAttempt(ctx, tx, award.ID, AttemptStepFinalize, AttemptStatePending, "", &retryAt)
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

// ---------------------------------------------------------------------------
// Store: mp.delivery_handoffs
// ---------------------------------------------------------------------------

// DeliveryHandoff is one mp.delivery_handoffs row.
type DeliveryHandoff struct {
	AwardID        uuid.UUID
	RequestID      uuid.UUID
	DriverID       uuid.UUID
	RequesterID    uuid.UUID
	FencingToken   int64
	FareMinor      int64
	Currency       string
	State          string
	DeliveryID     *uuid.UUID
	TrackingNumber string
	Attempts       int
	// UnresolvedSends counts sends that may have reached delivery-service
	// without a definite "nothing created" answer.
	UnresolvedSends int
	LastStatus      *int
	LastCode        string
	LastError       string
	DeliveredAt     *time.Time
}

// EnsureHandoff writes the hand-off's first record (what is sent), once.
func (s *Store) EnsureHandoff(ctx context.Context, db DB, req DeliveryAssignRequest, cityID string) error {
	if _, err := db.Exec(ctx, `
		INSERT INTO mp.delivery_handoffs (
			award_id, request_id, requester_id, driver_id, city_id,
			fencing_token, fare_minor, currency, state
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (award_id) DO NOTHING`,
		req.AwardID, req.RequestID, req.CustomerID, req.DriverID, cityID,
		req.FencingToken, req.FareMinor, req.Currency, HandoffSending); err != nil {
		return fmt.Errorf("failed to record the delivery hand-off: %w", err)
	}
	return nil
}

// Hand-off send decisions (DecideHandoffSend).
const (
	// handoffDecisionSend: put the hand-off on the wire (counted first when
	// the port can reach delivery-service).
	handoffDecisionSend = "send"
	// handoffDecisionFlagUnknown: nothing may have been sent yet and the
	// flag could not be read — ask again later.
	handoffDecisionFlagUnknown = "flag_unknown"
	// handoffDecisionDisabled: nothing may have been sent and the flag is
	// off — recorded as disabled; compensate.
	handoffDecisionDisabled = "disabled"
	// handoffDecisionClosed: the hand-off already ended without a delivery
	// (disabled, or permanently refused) — never send again; compensate.
	handoffDecisionClosed = "closed"
)

// DecideHandoffSend decides, under the hand-off row's lock, whether this run
// may put the hand-off on the wire, and records the send's write-ahead in the
// same transaction. The flag is consulted only while no send is unresolved:
// once one may have reached delivery-service, the delivery may exist and the
// only honest move is the idempotent re-send. It answers the decision and,
// for a closed or disabled hand-off, the compensation reason.
func (s *Store) DecideHandoffSend(ctx context.Context, awardID uuid.UUID, flagKnown, flagOn, wired bool) (string, string, error) {
	decision, reason := "", ""
	err := s.InTx(ctx, func(tx pgx.Tx) error {
		var state, code string
		var unresolved int
		if err := tx.QueryRow(ctx, `
			SELECT state, unresolved_sends, COALESCE(last_code, '')
			FROM mp.delivery_handoffs WHERE award_id = $1 FOR UPDATE`, awardID).Scan(&state, &unresolved, &code); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return domain.ErrNotFound
			}
			return fmt.Errorf("failed to lock the delivery hand-off: %w", err)
		}
		switch {
		case state == HandoffRefused:
			decision, reason = handoffDecisionClosed, "delivery_handoff_refused: "+code
			return nil
		case state == HandoffDisabled:
			decision, reason = handoffDecisionClosed, "delivery_handoff_disabled"
			return nil
		case unresolved == 0 && state != HandoffDelivered && !flagKnown:
			decision = handoffDecisionFlagUnknown
			return nil
		case unresolved == 0 && state != HandoffDelivered && !flagOn:
			decision, reason = handoffDecisionDisabled, "delivery_handoff_disabled"
			if _, err := tx.Exec(ctx, `
				UPDATE mp.delivery_handoffs SET
					state = $2, attempts = attempts + 1, last_status = NULL, last_code = NULL,
					last_error = $3, updated_at = now()
				WHERE award_id = $1`,
				awardID, HandoffDisabled, "marketplace_delivery is off for this city; nothing was sent"); err != nil {
				return fmt.Errorf("failed to record the disabled hand-off: %w", err)
			}
			return nil
		}
		decision = handoffDecisionSend
		if !wired {
			return nil
		}
		if _, err := tx.Exec(ctx, `
			UPDATE mp.delivery_handoffs SET unresolved_sends = unresolved_sends + 1, updated_at = now()
			WHERE award_id = $1`, awardID); err != nil {
			return fmt.Errorf("failed to record the hand-off send: %w", err)
		}
		return nil
	})
	if err != nil {
		return "", "", err
	}
	return decision, reason, nil
}

// RecordHandoffAnswer records one non-success answer. A delivered row is
// never moved back. `resolved` marks an answer that DEFINITELY created
// nothing, taking that send off the unresolved count.
func (s *Store) RecordHandoffAnswer(ctx context.Context, db DB, awardID uuid.UUID, state string, status int, code, lastError string, resolved bool) error {
	var statusValue *int
	if status != 0 {
		statusValue = &status
	}
	if _, err := db.Exec(ctx, `
		UPDATE mp.delivery_handoffs SET
			state = $2, attempts = attempts + 1, last_status = $3, last_code = $4,
			last_error = $5,
			unresolved_sends = CASE WHEN $7 THEN GREATEST(unresolved_sends - 1, 0) ELSE unresolved_sends END,
			updated_at = now()
		WHERE award_id = $1 AND state <> $6`,
		awardID, state, statusValue, nullable(code), nullable(truncateRunes(lastError, 500)), HandoffDelivered, resolved); err != nil {
		return fmt.Errorf("failed to record the delivery hand-off answer: %w", err)
	}
	return nil
}

// MarkHandoffDelivered records the delivery the award now executes as. A
// replay of the same delivery is a no-op; a DIFFERENT delivery for an award
// already delivered is refused (the database's unique delivery id is the
// backstop across awards).
func (s *Store) MarkHandoffDelivered(ctx context.Context, tx pgx.Tx, awardID, deliveryID uuid.UUID, trackingNumber string, status int, now time.Time) error {
	tag, err := tx.Exec(ctx, `
		UPDATE mp.delivery_handoffs SET
			state = $2, delivery_id = $3, tracking_number = COALESCE($4, tracking_number),
			attempts = attempts + 1, last_status = $5, last_code = NULL, last_error = NULL,
			delivered_at = COALESCE(delivered_at, $6), updated_at = now()
		WHERE award_id = $1 AND (state <> $2 OR delivery_id = $3)`,
		awardID, HandoffDelivered, deliveryID, nullable(trackingNumber), status, now)
	if err != nil {
		return fmt.Errorf("failed to record the handed-off delivery: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return domain.Errorf(domain.CodeConflict, "this award already handed off a different delivery").
			WithDetails(map[string]any{"awardId": awardID.String()})
	}
	return nil
}

// HandoffByAward reads one award's hand-off record.
func (s *Store) HandoffByAward(ctx context.Context, db DB, awardID uuid.UUID) (*DeliveryHandoff, error) {
	var h DeliveryHandoff
	err := db.QueryRow(ctx, `
		SELECT award_id, request_id, driver_id, requester_id, fencing_token, fare_minor, currency,
			state, delivery_id, COALESCE(tracking_number, ''), attempts, unresolved_sends, last_status,
			COALESCE(last_code, ''), COALESCE(last_error, ''), delivered_at
		FROM mp.delivery_handoffs WHERE award_id = $1`, awardID).Scan(
		&h.AwardID, &h.RequestID, &h.DriverID, &h.RequesterID, &h.FencingToken, &h.FareMinor, &h.Currency,
		&h.State, &h.DeliveryID, &h.TrackingNumber, &h.Attempts, &h.UnresolvedSends, &h.LastStatus,
		&h.LastCode, &h.LastError, &h.DeliveredAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrNotFound
		}
		return nil, fmt.Errorf("failed to read the delivery hand-off: %w", err)
	}
	return &h, nil
}
