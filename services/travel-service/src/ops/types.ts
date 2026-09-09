/**
 * Shared types for the travel ops module.
 *
 * As in the ledger, nothing here opens its own database transaction: the
 * mutating flows take a transaction client supplied by `withOutbox`, so the
 * state change, the travel_order_events row and the outbox rows are one unit of
 * work.
 */
import type { PrismaClient } from "@prisma/client/index";
// The generated client's types are reachable through the "./index" subpath but
// not through the package root under `moduleResolution: nodenext`. Type-only
// import, erased at build time.

/** A Prisma client scoped to an open transaction — no lifecycle methods. */
export type TravelTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** A Prisma client that can open one. */
export interface TravelDb extends TravelTx {
  $transaction<T>(fn: (tx: TravelTx) => Promise<T>): Promise<T>;
}

/** JSON that Prisma will accept in a `Json` column — no `undefined`, no Date. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRecord = Record<string, JsonValue>;

/**
 * An authenticated actor. The gateway proves who this is; a request body may
 * never name one (CLAUDE.md non-negotiable #1 — the server is authoritative).
 */
export interface Actor {
  readonly id: string;
  readonly role: string;
}
