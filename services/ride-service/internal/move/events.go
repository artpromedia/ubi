package move

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// eventNames is the Go port of EVENT_NAMES in packages/contracts/src/events.ts,
// narrowed to the names this service produces. Keeping it closed means a
// producer cannot invent an event that no consumer or ops timeline can render.
var eventNames = map[string]struct{}{
	"quote.created":            {},
	"quote.expired":            {},
	"ride.requested":           {},
	"ride.assigned":            {},
	"ride.driver_arrived":      {},
	"ride.pin_verified":        {},
	"ride.started":             {},
	"ride.completed":           {},
	"ride.cancelled_by_rider":  {},
	"ride.cancelled_by_driver": {},
	"ride.no_driver":           {},
	"ride.safety_hold":         {},
	"ride.rated":               {},
	"matching.retry":           {},
	"matching.restarted":       {},
	"offer.created":            {},
	"offer.expired":            {},
	"offer.declined":           {},
	"offer.accepted":           {},
	"driver.status_changed":    {},
	"pin.locked":               {},
}

// Event is one row of the transactional outbox. It is always written in the
// same transaction as the state change it describes (CLAUDE.md #2); there is
// no code path in this service that publishes without persisting, or persists
// without publishing.
type Event struct {
	Name           string
	AggregateType  string
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

// writeEvent appends to public.outbox_events. A replayed transition writes the
// same idempotency key and is dropped, so a consumer never sees a duplicate.
func writeEvent(ctx context.Context, tx pgx.Tx, event Event) error {
	if _, ok := eventNames[event.Name]; !ok {
		return fmt.Errorf("refusing to publish unknown event %q", event.Name)
	}
	if event.IdempotencyKey == "" {
		return fmt.Errorf("event %s has no idempotency key", event.Name)
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
		deterministicID("evt", event.IdempotencyKey),
		event.Name,
		event.AggregateType,
		event.AggregateID,
		event.FromVersion,
		event.ToVersion,
		cityID,
		event.ActorType,
		event.ActorID,
		event.IdempotencyKey,
		payload,
		event.OccurredAt,
	)
	if err != nil {
		return fmt.Errorf("failed to write outbox event %s: %w", event.Name, err)
	}
	return nil
}

// AuditRecord is one row of public.audit_log. Every money-affecting or
// state-affecting action writes one (CLAUDE.md #2, #4).
type AuditRecord struct {
	ActorID     string
	ActorRole   string
	Action      string
	SubjectType string
	SubjectID   string
	Before      map[string]any
	After       map[string]any
	Reason      string
}

func writeAudit(ctx context.Context, tx pgx.Tx, record AuditRecord) error {
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
		INSERT INTO public.audit_log (
			id, actor_id, actor_role, action, subject_type, subject_id,
			before, after, reason
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		newID("aud"),
		record.ActorID, record.ActorRole, record.Action,
		record.SubjectType, record.SubjectID,
		before, after, reason,
	)
	if err != nil {
		return fmt.Errorf("failed to write audit row for %s: %w", record.Action, err)
	}
	return nil
}
