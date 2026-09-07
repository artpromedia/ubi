/**
 * Wiring the wallet ledger to this service's singletons.
 *
 * Kept apart from `src/index.ts` so the same dependency bundle can be built
 * against a real, isolated database in the tests — the operations never reach
 * for a module-level client of their own.
 */
import { prisma } from "../lib/prisma";

import { createCityConfigProvider } from "./city-config";
import type { WalletDeps } from "./context";
import { createPrismaDirectory } from "./directory";
import { httpBankRailProvider, httpTopupProvider } from "./providers";
import type { LedgerDb } from "./types";

export function createWalletDeps(db: LedgerDb): WalletDeps {
  return {
    db,
    config: createCityConfigProvider(db),
    directory: createPrismaDirectory(db),
    bankRail: httpBankRailProvider(),
    topupRail: httpTopupProvider(),
    now: () => new Date(),
  };
}

/**
 * The service's own dependency bundle, built on the shared Prisma singleton.
 *
 * The singleton is a `$extends`-wrapped client whose delegates carry the
 * extension's generic parameter; it satisfies `LedgerDb` structurally but the
 * two generic instantiations are not identical, so the conversion is stated
 * once here rather than leaking a looser type into every operation.
 */
export function walletDeps(): WalletDeps {
  return createWalletDeps(prisma as unknown as LedgerDb);
}
