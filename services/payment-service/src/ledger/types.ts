/**
 * Shared types for the double-entry ledger.
 *
 * The ledger never opens its own database transaction: every posting function
 * takes a caller-supplied Prisma transaction client so a saga (top-up +
 * transfer) commits or rolls back as one unit.
 */
import type { EntryKind, LedgerAccount } from "./accounts";
import type { PrismaClient } from "@prisma/client/index";
import type { Money } from "@ubi/contracts";
// The generated client's types are reachable through the "./index" subpath but
// not through the package root under `moduleResolution: nodenext` — the root's
// `default.d.ts` re-exports a specifier the exports map cannot resolve, so
// `PrismaClient` degrades to `any` there and every query in this service loses
// its types. This is a type-only import, erased at build time.

/** A Prisma client scoped to an open transaction — no lifecycle methods. */
export type LedgerTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/** A Prisma client that can open one. */
export interface LedgerDb extends LedgerTx {
  $transaction<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T>;
}

export interface JournalLineInput {
  readonly account: LedgerAccount;
  /** Required for wallet-bearing accounts; must be null for pure UBI/rail accounts. */
  readonly walletId?: string | null;
  readonly amount: Money;
  /**
   * What this line is the other half of — a ride id, a transfer id, a case id.
   * Every line carries one so a statement row can always be traced back.
   */
  readonly counterpartRef: string;
}

export interface PostEntryInput {
  readonly kind: EntryKind;
  /** The business object the entry belongs to, e.g. `transfer:tr_abc`. */
  readonly reference: string;
  readonly occurredAt: Date;
  /** Scoped idempotency key. Unique in the database, so a replay cannot double-post. */
  readonly idempotencyKey?: string | null;
  /** Support/ops case this entry answers to. Required for adjustments. */
  readonly caseRef?: string | null;
  readonly description?: string | null;
  readonly lines: readonly JournalLineInput[];
}

export interface PostedLine {
  readonly id: string;
  readonly account: LedgerAccount;
  readonly walletId: string | null;
  readonly amountMinor: number;
  readonly currency: string;
  readonly counterpartRef: string | null;
}

export interface PostedEntry {
  readonly id: string;
  readonly kind: EntryKind;
  readonly reference: string;
  readonly occurredAt: Date;
  readonly caseRef: string | null;
  readonly lines: readonly PostedLine[];
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

/** An authenticated actor. The server sets this; it is never read from a body. */
export interface Actor {
  readonly id: string;
  readonly role: string;
}
