/**
 * Shared types for the ask service.
 *
 * As in the other services, nothing here opens its own transaction: every
 * mutating function takes a transaction client supplied by `auditedTransaction`,
 * so the domain row, the ai_actions log row and the outbox rows are one unit of
 * work.
 */
import type { PrismaClient } from "@prisma/client/index";
// The generated client's types are reachable through the "./index" subpath but
// not through the package root under `moduleResolution: nodenext`. Type-only
// import, erased at build time.

/** A Prisma client scoped to an open transaction — no lifecycle methods. */
export type AskTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** A Prisma client that can open one. */
export interface AskDb extends AskTx {
  $transaction<T>(fn: (tx: AskTx) => Promise<T>): Promise<T>;
}

/** JSON that Prisma will accept in a `Json` column — no `undefined`, no Date. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonRecord = Readonly<Record<string, JsonValue>>;

/**
 * An authenticated actor. The gateway proves who this is; a request body or a
 * model tool argument may never name one (CLAUDE.md #1, rule #18 — actor, role
 * and ownership come from the gateway identity context).
 */
export interface Actor {
  readonly id: string;
  readonly role: string;
}

/** The two end-user roles the assistant serves. */
export const ASK_ROLES = ["rider", "driver"] as const;
export type AskRole = (typeof ASK_ROLES)[number];

export function isAskRole(role: string): role is AskRole {
  return (ASK_ROLES as readonly string[]).includes(role);
}
