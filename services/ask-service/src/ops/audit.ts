/**
 * The AI action log, and the only door into a mutating ask transaction.
 *
 * Rule #18-21: every action the assistant takes is logged to `ai_actions` with
 * the minimum content — a redacted input summary, the model and revision, the
 * prompt version, the authorisation kind and reference, the outcome and a reason
 * code — and never any card data, PIN, document, precise address, secret or
 * hidden model reasoning (rule #20). Retention is 90 days (a DB default on the
 * row).
 *
 * As in support-service, the log row is not something a handler remembers to
 * write: the transaction client the work receives is *branded* so it can only be
 * obtained from `auditedTransaction`, and that wrapper writes the ai_actions rows
 * and the outbox rows the work describes in the same transaction. A mutation that
 * throws rolls its log and its events back with it; a mutation that commits
 * always commits its log with it.
 */
import { assertKnownEventName, type EventName } from "@ubi/contracts";

import { generateId } from "../lib/ids";
import { findSensitive } from "../ai/redaction";

import type { Actor, JsonRecord, AskDb, AskTx } from "./types";

declare const auditedBrand: unique symbol;

/** A transaction already able to carry ai_actions + outbox rows. */
export type AuditedTx = AskTx & { readonly [auditedBrand]: true };

export type ActorKind = "rider" | "driver" | "mandate" | "admin";
export type AuthKind = "grant" | "mandate" | "read_only" | "none";
export type AiOutcome = "done" | "partial" | "blocked" | "refused" | "error";

export interface AiActionInput {
  readonly actorKind: ActorKind;
  readonly actorRef: string;
  readonly threadId?: string | null;
  readonly action: string;
  readonly tool?: string | null;
  readonly model?: string | null;
  readonly modelRevision?: string | null;
  readonly promptVersion?: string | null;
  /** Ids, amounts and codes only — asserted free of sensitive spans below. */
  readonly redactedInputs?: JsonRecord | null;
  readonly authKind: AuthKind;
  readonly authRef?: string | null;
  readonly providerRefs?: readonly string[];
  readonly outcome: AiOutcome;
  readonly reasonCode?: string | null;
  readonly tokens?: number | null;
  readonly costMinor?: number | null;
  readonly currency?: string | null;
  readonly latencyMs?: number | null;
}

export interface OutboxInput {
  readonly name: EventName | string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly fromVersion: number | null;
  readonly toVersion: number;
  readonly actor: Actor;
  readonly actorType: string;
  readonly cityId: string | null;
  readonly idempotencyKey: string;
  readonly correlationId?: string | null;
  readonly occurredAt: Date;
  /** Ids, amounts and codes only — never PII or model reasoning (rule #20). */
  readonly payload: JsonRecord;
}

export interface AuditedOutcome<T> {
  readonly result: T;
  readonly aiActions?: readonly AiActionInput[];
  readonly events?: readonly OutboxInput[];
}

/**
 * Writes one ai_actions row. Refuses to persist a redacted-input blob that still
 * contains a recognisable card / PIN / document / address — a leak into the log
 * is a defect, not a warning (rule #20).
 */
export async function writeAiAction(
  tx: AskTx,
  input: AiActionInput,
): Promise<void> {
  const redactedInputs = input.redactedInputs ?? null;
  if (redactedInputs !== null && findSensitive(redactedInputs).length > 0) {
    throw new Error("refusing to log sensitive data to ai_actions");
  }
  await tx.aiAction.create({
    data: {
      id: generateId("aia"),
      actorKind: input.actorKind,
      actorRef: input.actorRef,
      threadId: input.threadId ?? null,
      action: input.action,
      tool: input.tool ?? null,
      model: input.model ?? null,
      modelRevision: input.modelRevision ?? null,
      promptVersion: input.promptVersion ?? null,
      redactedInputs:
        redactedInputs === null ? undefined : { ...redactedInputs },
      authKind: input.authKind,
      authRef: input.authRef ?? null,
      providerRefs: input.providerRefs ? [...input.providerRefs] : [],
      outcome: input.outcome,
      reasonCode: input.reasonCode ?? null,
      tokens: input.tokens ?? null,
      costMinor:
        input.costMinor === null || input.costMinor === undefined
          ? null
          : BigInt(input.costMinor),
      currency: input.currency ?? null,
      latencyMs: input.latencyMs ?? null,
    },
  });
}

export async function publishEvent(
  tx: AskTx,
  input: OutboxInput,
): Promise<void> {
  const name = assertKnownEventName(input.name);
  await tx.outboxEvent.create({
    data: {
      id: generateId("evt"),
      name,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      cityId: input.cityId,
      actorType: input.actorType,
      actorId: input.actor.id,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId ?? null,
      payload: { ...input.payload },
      occurredAt: input.occurredAt,
    },
  });
}

/**
 * Runs one ask action. The work receives a branded transaction client, and the
 * ai_actions rows and outbox rows it describes are written in the same
 * transaction before it commits.
 */
export async function auditedTransaction<T>(
  db: AskDb,
  work: (tx: AuditedTx) => Promise<AuditedOutcome<T>>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const outcome = await work(tx as AuditedTx);
    for (const action of outcome.aiActions ?? []) {
      await writeAiAction(tx, action);
    }
    for (const event of outcome.events ?? []) {
      await publishEvent(tx, event);
    }
    return outcome.result;
  });
}

export function actorKindFor(role: string): ActorKind {
  if (role === "driver") {
    return "driver";
  }
  if (role === "mandate") {
    return "mandate";
  }
  if (role === "rider") {
    return "rider";
  }
  return "admin";
}
