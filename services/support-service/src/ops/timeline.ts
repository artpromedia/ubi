/**
 * The unified case timeline.
 *
 * Board 12b asks for one timeline across the ride, the wallet and the messages —
 * an agent should not have to open three consoles to understand what happened.
 *
 * The case's own record lives in `case_events`. The ride and wallet halves are
 * *projections*, read at request time from the transactional outbox (the same
 * stream the live-ops consoles read) and from the journal. They are not copied
 * into `case_events`, because a copy taken when the case was opened is stale by
 * the time an agent reads it, and a second copy of a ride's history is a second
 * thing that can disagree with the first.
 *
 * Everything crossing this boundary is filtered by the reader's role: an agent
 * who may not see contact details does not get them because a ride event
 * happened to carry a driver's name (CLAUDE.md #6).
 */
import { can, locationForRole, maskEmail, maskPhone } from "./roles";

import type { JsonRecord, JsonValue, SupportTx } from "./types";

export const TIMELINE_SOURCES = ["case", "ride", "wallet"] as const;
export type TimelineSource = (typeof TIMELINE_SOURCES)[number];

export interface TimelineItem {
  readonly at: string;
  readonly source: TimelineSource;
  readonly kind: string;
  /** Stable identity of the underlying record, so a client can de-duplicate. */
  readonly ref: string;
  readonly actor: string | null;
  readonly detail: JsonRecord;
}

/** Case-native event kinds. Closed so a timeline row is always renderable. */
export const CASE_EVENT_KINDS = [
  "case.opened",
  "case.message",
  "case.status_changed",
  "case.remedy_posted",
  "case.resolved",
  "case.note",
] as const;
export type CaseEventKind = (typeof CASE_EVENT_KINDS)[number];

/** Keys that carry a person's identity or whereabouts wherever they appear. */
const CONTACT_KEYS = new Set([
  "phone",
  "phoneNumber",
  "msisdn",
  "email",
  "displayName",
  "name",
  "firstName",
  "lastName",
  "plate",
  "address",
  "description",
  "note",
  "text",
]);

const LOCATION_KEYS = new Set(["lat", "latitude", "lng", "longitude"]);

function redactValue(role: string, key: string, value: JsonValue): JsonValue {
  if (typeof value === "string" && CONTACT_KEYS.has(key) && !can(role, "pii.contact")) {
    if (key === "email") {
      return maskEmail(value);
    }
    if (key === "phone" || key === "phoneNumber" || key === "msisdn") {
      return maskPhone(value);
    }
    return "[withheld]";
  }
  if (typeof value === "number" && LOCATION_KEYS.has(key) && !can(role, "pii.location")) {
    const coarse = locationForRole(role, { lat: value, lng: value });
    return coarse === null ? value : coarse.lat;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(role, key, entry));
  }
  if (typeof value === "object" && value !== null) {
    return redactRecord(role, value as JsonRecord);
  }
  return value;
}

export function redactRecord(role: string, record: JsonRecord): JsonRecord {
  const output: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(record)) {
    output[key] = redactValue(role, key, value);
  }
  return output;
}

function asJsonRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as JsonRecord;
}

export interface TimelineScope {
  readonly caseId: string;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly userId: string | null;
  /** Only journal activity at or after this instant is shown on the case. */
  readonly walletWindowStart: Date;
  readonly limitPerSource: number;
}

/** The case's own events — the durable record, most recent first. */
export async function caseTimeline(
  tx: SupportTx,
  role: string,
  scope: TimelineScope,
): Promise<TimelineItem[]> {
  const rows = await tx.caseEvent.findMany({
    where: { caseId: scope.caseId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: scope.limitPerSource,
  });
  return rows.map((row) => ({
    at: row.createdAt.toISOString(),
    source: "case" as const,
    kind: row.kind,
    ref: row.id,
    actor: row.actor,
    detail: redactRecord(role, asJsonRecord(row.payload)),
  }));
}

/**
 * The subject's event stream, read from the outbox — the same source live ops
 * reads, so support and ops never disagree about what happened on a ride.
 */
export async function subjectTimeline(
  tx: SupportTx,
  role: string,
  scope: TimelineScope,
): Promise<TimelineItem[]> {
  if (scope.subjectType === null || scope.subjectId === null) {
    return [];
  }
  const rows = await tx.outboxEvent.findMany({
    where: { aggregateType: scope.subjectType, aggregateId: scope.subjectId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: scope.limitPerSource,
  });
  return rows.map((row) => ({
    at: row.occurredAt.toISOString(),
    source: "ride" as const,
    kind: row.name,
    ref: row.id,
    actor: row.actorId,
    detail: redactRecord(role, {
      ...asJsonRecord(row.payload),
      fromVersion: row.fromVersion,
      toVersion: row.toVersion,
    }),
  }));
}

/**
 * The customer's wallet movements in the window the case covers. Amounts are
 * integer minor units with their currency, exactly as the journal holds them —
 * this service never re-derives a balance or a fare.
 */
export async function walletTimeline(
  tx: SupportTx,
  role: string,
  scope: TimelineScope,
): Promise<TimelineItem[]> {
  if (scope.userId === null) {
    return [];
  }
  const wallets = await tx.wallet.findMany({
    where: { ownerId: scope.userId },
    select: { id: true },
  });
  if (wallets.length === 0) {
    return [];
  }
  const lines = await tx.journalLine.findMany({
    where: {
      walletId: { in: wallets.map((wallet) => wallet.id) },
      createdAt: { gte: scope.walletWindowStart },
    },
    include: { entry: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: scope.limitPerSource,
  });
  return lines.map((line) => ({
    at: line.entry.occurredAt.toISOString(),
    source: "wallet" as const,
    kind: `wallet.${line.entry.kind}`,
    ref: line.id,
    actor: null,
    detail: redactRecord(role, {
      entryId: line.entryId,
      account: line.account,
      amountMinor: Number(line.amountMinor),
      currency: line.currency,
      counterpartRef: line.counterpartRef,
      caseRef: line.entry.caseRef,
      reference: line.entry.reference,
    }),
  }));
}

/** Newest first, ties broken by ref so the order is stable across reads. */
export function mergeTimeline(
  parts: readonly (readonly TimelineItem[])[],
): TimelineItem[] {
  const merged = parts.flat();
  merged.sort((a, b) => {
    if (a.at === b.at) {
      return a.ref < b.ref ? 1 : a.ref > b.ref ? -1 : 0;
    }
    return a.at < b.at ? 1 : -1;
  });
  return merged;
}

export async function unifiedTimeline(
  tx: SupportTx,
  role: string,
  scope: TimelineScope,
): Promise<TimelineItem[]> {
  const [ownEvents, subjectEvents, walletEvents] = await Promise.all([
    caseTimeline(tx, role, scope),
    subjectTimeline(tx, role, scope),
    walletTimeline(tx, role, scope),
  ]);
  return mergeTimeline([ownEvents, subjectEvents, walletEvents]);
}
