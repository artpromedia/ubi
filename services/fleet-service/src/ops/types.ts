/**
 * Shared types for the fleet ops modules.
 *
 * Nothing here opens its own transaction for a state change: mutating flows
 * take the branded transaction `withOutbox` supplies, so the state change,
 * its audit row and its outbox rows are one unit of work.
 */
import type { PrismaClient } from "@prisma/client/index";
// The generated client's types are reachable through the "./index" subpath but
// not through the package root under `moduleResolution: nodenext`. Type-only
// import, erased at build time.

/** A Prisma client scoped to an open transaction — no lifecycle methods. */
export type FleetTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** A Prisma client that can open one. */
export interface FleetDb extends FleetTx {
  $transaction<T>(fn: (tx: FleetTx) => Promise<T>): Promise<T>;
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
 * never name one (CLAUDE.md #1 — the server is authoritative).
 */
export interface Actor {
  readonly id: string;
  readonly role: string;
  /**
   * In what capacity the actor acts, as the event envelope records it: the
   * driver routes set `driver`; fleet staff default to `fleet`.
   */
  readonly as?: "fleet" | "driver";
}
