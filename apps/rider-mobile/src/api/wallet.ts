// Wallet READ surface against payment-service THROUGH the gateway (C05 / G12).
// Routes verified in services/payment-service/src/routes/wallet-v1.ts (mounted
// at /v1/wallet in src/index.ts; gateway proxies /wallet/* to payment-service):
//   GET /v1/wallet                       -> WalletOverview (bare JSON, no envelope)
//   GET /v1/wallet/statements?from&to    -> Statement (from/to are YYYY-MM-DD)
// Every amount is a server Money object; this file only names the shapes.
// Transfers/top-ups/PIN routes exist server-side but are money-moving flows
// outside C05's read-only wallet scope — deliberately not consumed here.
import { api, type Money } from "@ubi/mobile-core";

export type WalletOverview = {
  walletId: string;
  currency: string;
  balance: Money;
  tier: string;
  limits: {
    dailyOut: Money;
    usedToday: Money;
    remainingToday: Money;
    singleTransfer: Money;
    balanceCap: Money | null;
  };
  safeMode: { active: boolean; until: string | null };
  locked: boolean;
  pinSet: boolean;
  pinLockedUntil: string | null;
  coolingUntil: string | null;
};

export type StatementLine = {
  entryId: string;
  lineId: string;
  kind: string;
  account: string;
  description: string | null;
  counterpartRef: string | null;
  amountMinor: number;
  runningBalanceMinor: number;
  occurredAt: string;
};

export type WalletStatement = {
  walletId: string;
  currency: string;
  from: string;
  to: string;
  opening: Money;
  in: Money;
  out: Money;
  closing: Money;
  lines: StatementLine[];
};

/** Bare statement integers + the statement's own currency, for display only. */
export const statementMoney = (
  s: Pick<WalletStatement, "currency">,
  amountMinor: number,
): Money => ({ amountMinor, currency: s.currency });

export const walletApi = {
  overview: () => api<WalletOverview>("GET", "/v1/wallet"),
  statement: (from: string, to: string) =>
    api<WalletStatement>(
      "GET",
      "/v1/wallet/statements?from=" +
        encodeURIComponent(from) +
        "&to=" +
        encodeURIComponent(to),
    ),
};
