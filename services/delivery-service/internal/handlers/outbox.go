/*
 * Transactional outbox and audit rows (CLAUDE.md #2).
 *
 * delivery-service writes public.outbox_events and public.audit_log — the
 * same Prisma-owned tables every other service writes — in the SAME
 * transaction as the state change they describe. It runs no relay of its
 * own: the shared @ubi/outbox relay (packages/outbox, run by the Node
 * services) claims every unpublished row regardless of producer, validates
 * the envelope against @ubi/contracts and publishes it to
 * `event:<name>` / `subject:<type>:<id>`, exactly as it does for
 * ride-service's Go-written rows (ride-service internal/marketplace/events.go
 * is the pattern this file ports).
 *
 * Payloads carry ids, codes, integer minor amounts and instants only —
 * never a name, phone, address or a free-text reason (CLAUDE.md #12).
 */

package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ubi-africa/ubi-monorepo/services/delivery-service/internal/identity"
)

// Event names this service publishes. A closed set, each registered in the
// contract's EVENT_NAMES (packages/contracts/src/events.ts) and described in
// contracts/events/catalog-additions.md: a producer cannot invent a name no
// consumer or ops timeline can render.
const (
	// EventShipmentReturnProposed: a return was proposed for an unreachable
	// recipient; the sender must answer before consentExpiresAt
	// (notification-service pushes the sender, SMS fallback).
	EventShipmentReturnProposed = "shipment.return_proposed"
	// EventShipmentCancelled: a marketplace delivery was cancelled before
	// pickup because its queued award was cancelled (marketplace-cancel).
	EventShipmentCancelled = "shipment.cancelled"
)

var deliveryEventNames = map[string]struct{}{
	EventShipmentReturnProposed: {},
	EventShipmentCancelled:      {},
}

// subjectShipment is the envelope subject every delivery event uses: the
// delivery id doubles as the shipment id (catalog-additions.md).
const subjectShipment = "shipment"

// Envelope actor types (packages/contracts ACTOR_TYPES).
const (
	envelopeActorRider  = "rider"
	envelopeActorDriver = "driver"
	envelopeActorAgent  = "agent"
	envelopeActorSystem = "system"
)

// envelopeActorType maps a gateway role onto the envelope's actor type. Ops
// (admin) acts as an agent, never as a rider or driver.
func envelopeActorType(role string) string {
	switch role {
	case identity.RoleRider:
		return envelopeActorRider
	case identity.RoleDriver:
		return envelopeActorDriver
	case identity.RoleAdmin:
		return envelopeActorAgent
	default:
		return envelopeActorSystem
	}
}

// outboxEvent is one public.outbox_events row.
type outboxEvent struct {
	Name           string
	AggregateID    string
	FromVersion    *int
	ToVersion      int
	CityID         string
	ActorType      string
	ActorID        string
	IdempotencyKey string
	Payload        map[string]any
	OccurredAt     time.Time
}

// maxIdempotencyKeyLength is the envelope's bound on idempotencyKey
// (EventEnvelopeSchema: max 64): a longer key would be quarantined by the
// relay, never published.
const maxIdempotencyKeyLength = 64

// outboxEventID turns the idempotency key into the row's primary key, so a
// replayed write collides with its own earlier row.
func outboxEventID(idempotencyKey string) string {
	sum := sha256.Sum256([]byte(idempotencyKey))
	return "evt_" + hex.EncodeToString(sum[:])[:32]
}

// writeOutboxEvent appends to public.outbox_events inside tx. A replayed
// write carries the same idempotency key and is dropped, so a consumer never
// sees a duplicate.
func writeOutboxEvent(ctx context.Context, tx pgx.Tx, event outboxEvent) error {
	if _, ok := deliveryEventNames[event.Name]; !ok {
		return fmt.Errorf("refusing to publish unknown event %q", event.Name)
	}
	if event.IdempotencyKey == "" || len(event.IdempotencyKey) > maxIdempotencyKeyLength {
		return fmt.Errorf("event %s needs an idempotency key of 1-%d characters", event.Name, maxIdempotencyKeyLength)
	}
	if strings.TrimSpace(event.AggregateID) == "" || strings.TrimSpace(event.ActorID) == "" {
		return fmt.Errorf("event %s needs a subject id and an actor id", event.Name)
	}
	if event.OccurredAt.IsZero() {
		event.OccurredAt = time.Now().UTC()
	}
	payload, err := json.Marshal(event.Payload)
	if err != nil {
		return fmt.Errorf("event %s has an unserialisable payload: %w", event.Name, err)
	}
	var cityID *string
	if event.CityID != "" {
		cityID = &event.CityID
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO public.outbox_events (
			id, name, schema_version, aggregate_type, aggregate_id,
			from_version, to_version, city_id, actor_type, actor_id,
			idempotency_key, payload, occurred_at
		) VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (idempotency_key) DO NOTHING`,
		outboxEventID(event.IdempotencyKey), event.Name, subjectShipment, event.AggregateID,
		event.FromVersion, event.ToVersion, cityID, event.ActorType, event.ActorID,
		event.IdempotencyKey, payload, event.OccurredAt,
	)
	if err != nil {
		return fmt.Errorf("failed to write outbox event %s: %w", event.Name, err)
	}
	return nil
}

// returnProposedEvent is the shipment.return_proposed row for a return just
// written inside the custody transition's transaction. senderId is the
// sender's USER id (delivery_custody.sender_id — the identity their devices
// are registered under), which is what notification-service addresses.
// chargeStatus is `not_required` for a fee-free return and
// `authorization_required` when the sender must approve a fee: the fee is
// never presented as charged.
func returnProposedEvent(
	cst *custodyRecord, returnID string, actor identity.Actor,
	feeMinor int64, currency *string, chargeStatus string,
	consentExpiresAt time.Time, fromVersion int, occurredAt time.Time,
) outboxEvent {
	var driverID any
	if cst.DriverID != nil {
		driverID = *cst.DriverID
	}
	var feeCurrency any
	if currency != nil {
		feeCurrency = *currency
	}
	from := fromVersion
	return outboxEvent{
		Name:           EventShipmentReturnProposed,
		AggregateID:    cst.DeliveryID,
		FromVersion:    &from,
		ToVersion:      fromVersion + 1,
		ActorType:      envelopeActorType(actor.Role),
		ActorID:        actor.UserID.String(),
		IdempotencyKey: EventShipmentReturnProposed + ":" + returnID,
		OccurredAt:     occurredAt,
		Payload: map[string]any{
			"deliveryId":       cst.DeliveryID,
			"custodyId":        cst.ID,
			"returnId":         returnID,
			"senderId":         cst.SenderID,
			"driverId":         driverID,
			"proposedBy":       actor.UserID.String(),
			"proposedByRole":   actor.Role,
			"feeMinor":         feeMinor,
			"currency":         feeCurrency,
			"chargeStatus":     chargeStatus,
			"consentExpiresAt": consentExpiresAt.UTC().Format(time.RFC3339),
		},
	}
}

// auditRecord is one public.audit_log row.
type auditRecord struct {
	ActorID     string
	ActorRole   string
	Action      string
	SubjectType string
	SubjectID   string
	Before      map[string]any
	After       map[string]any
	Reason      string
}

// writeAuditRow appends to public.audit_log inside tx.
func writeAuditRow(ctx context.Context, tx pgx.Tx, record auditRecord) error {
	var before, after []byte
	var err error
	if record.Before != nil {
		if before, err = json.Marshal(record.Before); err != nil {
			return fmt.Errorf("unserialisable audit before-state: %w", err)
		}
	}
	if record.After != nil {
		if after, err = json.Marshal(record.After); err != nil {
			return fmt.Errorf("unserialisable audit after-state: %w", err)
		}
	}
	var reason *string
	if record.Reason != "" {
		reason = &record.Reason
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO public.audit_log (id, actor_id, actor_role, action, subject_type, subject_id, before, after, reason)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		"aud_"+strings.ReplaceAll(uuid.NewString(), "-", ""),
		record.ActorID, record.ActorRole, record.Action, record.SubjectType, record.SubjectID,
		before, after, reason,
	)
	if err != nil {
		return fmt.Errorf("failed to write audit row for %s: %w", record.Action, err)
	}
	return nil
}
