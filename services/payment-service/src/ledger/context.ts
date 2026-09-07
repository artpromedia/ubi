/**
 * The dependencies every wallet operation needs. They are injected rather than
 * imported so the service can be wired against the real singletons in
 * `src/index.ts` and against a real, isolated database in the tests — with no
 * mock layer in production code.
 */
import { ContractError } from "@ubi/contracts";

import type { CityConfigProvider } from "./city-config";
import type { BankRailProvider, TopupProvider } from "./providers";
import type { LedgerDb, LedgerTx } from "./types";

export interface RecipientMatch {
  readonly userId: string;
  /** Shown to the sender before the PIN step so they can confirm who they are paying. */
  readonly displayName: string;
}

/**
 * Resolves a recipient from what the sender typed. `@tag` handles are not
 * provisioned in this schema (see the gap note in the slice report), so a
 * directory that cannot resolve tags says so instead of returning "not found".
 */
export interface RecipientDirectory {
  lookup(query: string): Promise<RecipientMatch>;
  byUserId(userId: string): Promise<RecipientMatch | null>;
}

export interface WalletDeps {
  readonly db: LedgerDb;
  readonly config: CityConfigProvider;
  readonly directory: RecipientDirectory;
  readonly bankRail: BankRailProvider | null;
  readonly topupRail: TopupProvider | null;
  readonly now: () => Date;
}

/**
 * Locks the wallet row for the rest of the transaction so two concurrent
 * transfers from the same wallet cannot both pass the balance check.
 */
export async function lockWallet(
  tx: LedgerTx,
  walletId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM wallets WHERE id = ${walletId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new ContractError("not_found", "wallet not found", { walletId });
  }
}
