/**
 * Shared types for the growth ops modules.
 *
 * As in support-service and the ledger, nothing here opens its own database
 * transaction: every mutating function takes a transaction client supplied by
 * `auditedTransaction`, so the state change, the audit row and the outbox rows
 * are one unit of work.
 */
import type { PrismaClient } from "@prisma/client/index";
// The generated client's types are reachable through the "./index" subpath but
// not through the package root under `moduleResolution: nodenext`. Type-only
// import, erased at build time.

/** A Prisma client scoped to an open transaction — no lifecycle methods. */
export type GrowthTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * A Prisma client that can open an interactive transaction. `$queryRaw` and
 * `$executeRaw` are inherited from `GrowthTx` (only lifecycle methods are
 * omitted), so the transaction client and the top-level client share one raw
 * surface — that is what lets a `SELECT … FOR UPDATE` run on the same
 * connection as the writes it guards.
 */
export interface GrowthDb extends GrowthTx {
  $transaction<T>(fn: (tx: GrowthTx) => Promise<T>): Promise<T>;
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
 * An authenticated actor. The gateway proves who this is; a request body may
 * never name one (CLAUDE.md non-negotiable #1 — the server is authoritative).
 */
export interface Actor {
  readonly id: string;
  readonly role: string;
}
