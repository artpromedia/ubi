/**
 * Reconstructs the canonical {@link EventEnvelope} from a persisted
 * `outbox_events` row and validates it against `EventEnvelopeSchema` before it
 * is allowed onto the wire.
 *
 * The row is read with raw SQL (see relay.ts) so the fields arrive with their
 * snake_case database names and native driver types (BigInt for `sequence`,
 * `Date` for the timestamps, parsed JSON for `payload`). This module is the one
 * place that knows that mapping, and the one place that decides a row is
 * unpublishable.
 */
import { EventEnvelopeSchema, type EventEnvelope } from "@ubi/contracts";

/** A raw `outbox_events` row as returned by `$queryRawUnsafe`. */
export interface RawOutboxRow {
  readonly id: string;
  readonly name: string;
  readonly schema_version: number;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly from_version: number | null;
  readonly to_version: number;
  readonly sequence: bigint | null;
  readonly city_id: string | null;
  readonly actor_type: string;
  readonly actor_id: string;
  readonly idempotency_key: string;
  readonly correlation_id: string | null;
  readonly causation_id: string | null;
  readonly payload: unknown;
  readonly occurred_at: Date | string;
  readonly published_at: Date | string | null;
  readonly attempts: number;
  readonly last_error: string | null;
  readonly created_at: Date | string;
}

export type EnvelopeParse =
  | { readonly ok: true; readonly envelope: EventEnvelope }
  | { readonly ok: false; readonly error: string };

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * A PII-safe summary of a Zod failure: field paths and issue codes only, never
 * the offending values (CLAUDE.md #6/#12 — no PII in logs or the quarantine
 * record). At most a handful of issues are reported.
 */
function summarizeIssues(error: { readonly issues: ReadonlyArray<{ path: PropertyKey[]; code: string }> }): string {
  const parts = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
    return `${path}:${issue.code}`;
  });
  return parts.join(", ");
}

/**
 * Maps a raw row to an envelope candidate and validates it. Nullable optional
 * fields (`sequence`, `correlationId`, `causationId`) are dropped rather than
 * passed as `null`, because the envelope schema treats them as optional (absent)
 * rather than nullable.
 */
export function envelopeFromRow(row: RawOutboxRow): EnvelopeParse {
  const candidate: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    version: row.schema_version,
    occurredAt: toIso(row.occurred_at),
    actor: { type: row.actor_type, id: row.actor_id },
    subject: { type: row.aggregate_type, id: row.aggregate_id },
    idempotencyKey: row.idempotency_key,
    fromVersion: row.from_version,
    toVersion: row.to_version,
    cityId: row.city_id,
    payload: row.payload,
  };
  if (row.sequence !== null) candidate.sequence = Number(row.sequence);
  if (row.correlation_id !== null) candidate.correlationId = row.correlation_id;
  if (row.causation_id !== null) candidate.causationId = row.causation_id;

  const parsed = EventEnvelopeSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: summarizeIssues(parsed.error) };
  }
  return { ok: true, envelope: parsed.data };
}
