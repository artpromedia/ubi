// Driver wallet & bank cash-out API against payment-service THROUGH the gateway (CC-B03 / P0-03).
// Routes verified in services/payment-service/src/routes/wallet-v1.ts and wallet-mp.ts,
// and in services/api-gateway/tests/route-contract.test.ts:
//   GET  /v1/wallet                                        -> WalletOverview
//   GET  /v1/wallet/mp/overview?cityId=...                 -> MpWalletOverview
//   GET  /v1/wallet/statements?from=...&to=...             -> WalletStatement
//   GET  /v1/wallet/nip/name-enquiry?bankCode&accountNumber -> NipEnquiryResult
//   POST /v1/wallet/nip                                    -> NipResult
// Every amount is a server Money object; zero client-side money math.
import { api, type Money } from "@ubi/mobile-core";
import type { MpWalletOverview } from "@ubi/contracts";

export type DriverWalletOverview = {
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

export type WalletStatementLine = {
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
  lines: WalletStatementLine[];
};

export type NipEnquiryResult = {
  accountName: string;
  sessionId: string;
};

export type CreateNipPayoutBody = {
  bankCode: string;
  accountNumber: string;
  amountMinor: number;
  pin: string;
};

export type NipStatus = "pending" | "confirmed" | "reversed";

export type NipResult = {
  nipTransferId: string;
  status: NipStatus;
  accountName: string;
  amount: Money;
  entryId: string | null;
  balanceAfter: Money;
  replayed: boolean;
};

/** Pair a bare statement integer with the statement's own server currency for display. */
export const statementLineMoney = (
  statement: Pick<WalletStatement, "currency">,
  amountMinor: number,
): Money => ({ amountMinor, currency: statement.currency });

export const driverWalletApi = {
  overview: () => api<DriverWalletOverview>("GET", "/v1/wallet"),
  mpOverview: (cityId: string) =>
    api<MpWalletOverview>(
      "GET",
      "/v1/wallet/mp/overview?cityId=" + encodeURIComponent(cityId),
    ),
  statement: (from: string, to: string) =>
    api<WalletStatement>(
      "GET",
      "/v1/wallet/statements?from=" +
        encodeURIComponent(from) +
        "&to=" +
        encodeURIComponent(to),
    ),
  nameEnquiry: (bankCode: string, accountNumber: string) =>
    api<NipEnquiryResult>(
      "GET",
      "/v1/wallet/nip/name-enquiry?bankCode=" +
        encodeURIComponent(bankCode) +
        "&accountNumber=" +
        encodeURIComponent(accountNumber),
    ),
  createNipPayout: (body: CreateNipPayoutBody, idempotencyKey?: string) =>
    api<NipResult>("POST", "/v1/wallet/nip", body, {
      idempotent: true,
      idempotencyKey,
    }),
};
