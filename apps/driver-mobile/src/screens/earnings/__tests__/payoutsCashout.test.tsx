// Driver Earnings.Payouts & Earnings.Cashout wire-level tests (CC-B03 / P0-03):
// 1. Default DENY_ALL shows TID.common.flagOff.screen on both PayoutsScreen and
//    CashoutScreen and issues zero wallet mutations.
// 2. With provider_payments + wallet_nip enabled, PayoutsScreen displays server
//    cleared/spendable/held balances and ops_driver_credit / nip_transfer lines.
// 3. CashoutScreen runs Step 1 GET /v1/wallet/nip/name-enquiry, shows the
//    verified account holder name, then submits Step 2 POST /v1/wallet/nip with
//    Idempotency-Key (kept stable across offline retries).
import type React from "react";
import "@testing-library/react-native/extend-expect";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { ConfigProvider, FlagsProvider, TID } from "@ubi/mobile-core";
import { IdempotencyKeySchema, TEST_IDS } from "@ubi/contracts";
import { installWire, NGN } from "../../../../jest/wire";
import { PayoutsScreen } from "../PayoutsScreen";
import { CashoutScreen } from "../CashoutScreen";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    canGoBack: () => true,
  }),
  useRoute: () => ({ params: {} }),
}));
jest.mock("@ubi/mobile-core", () => ({
  ...jest.requireActual("@ubi/mobile-core"),
  track: jest.fn(),
}));

const clients: QueryClient[] = [];

function renderWithProviders(
  el: React.ReactElement,
  cityId: string | undefined = "LOS",
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(qc);
  return render(
    <ThemeProvider defaultMode="dark">
      <QueryClientProvider client={qc}>
        <ConfigProvider cityId={cityId}>
          <FlagsProvider cityId={cityId}>{el}</FlagsProvider>
        </ConfigProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const driverWalletOverview = (balanceMinor = 2_400_000) => ({
  walletId: "wal_drv_1",
  currency: "NGN",
  balance: NGN(balanceMinor),
  tier: "tier2",
  limits: {
    dailyOut: NGN(20_000_000),
    usedToday: NGN(0),
    remainingToday: NGN(20_000_000),
    singleTransfer: NGN(10_000_000),
    balanceCap: NGN(50_000_000),
  },
  safeMode: { active: false, until: null },
  locked: false,
  pinSet: true,
  pinLockedUntil: null,
  coolingUntil: null,
});

const cityConfigLos = () => ({
  cityId: "LOS",
  version: 1,
  timezone: "Africa/Lagos",
  currency: "NGN",
  currencyFractionDigits: 2,
  locale: "en-NG",
  emergencyNumber: "112",
  supportPhone: "+23417000824",
  vehicleClasses: ["go", "comfort", "xl"] as const,
  fares: {
    go: {
      baseMinor: 60_000,
      perKmMinor: 18_000,
      perMinMinor: 2_500,
      bookingFeeMinor: 10_000,
      minFareMinor: 120_000,
    },
  },
  waitPolicy: { freeSec: 300, perMinMinor: 5_000 },
  cancelPolicy: {
    riderFeeAfterAssignMinor: 30_000,
    driverFeeMinor: 0,
    freeWindowSec: 120,
  },
  pinRequired: true,
  offerTtlSec: 12,
  quoteTtlSec: 300,
  matchingRings: [{ radiusMeters: 2_000, maxCandidates: 5 }],
  arrivedGeofenceMeters: 120,
  maxPinAttempts: 3,
  paymentMethods: [
    { id: "cash", available: true },
    { id: "wallet", available: true },
  ],
  kycTiers: [
    {
      tier: "tier1",
      dailyOutMinor: 5_000_000,
      singleTransferMinor: 2_000_000,
      balanceCapMinor: 30_000_000,
    },
  ],
  serviceFeePct: 20,
  remittanceCapMinor: 15_000_000,
  reservationFreeReleaseSec: 900,
  airport: {
    codes: ["LOS"],
    arrivalBufferMin: 20,
    checkInCutoffMin: 90,
    trafficBufferMin: 45,
    doors: { domestic_arrivals: "Door 2" },
  },
  taxes: { vat: 7.5 },
});

afterEach(() => {
  for (const c of clients.splice(0)) c.clear();
  mockNavigate.mockReset();
  mockGoBack.mockReset();
});

describe("Driver PayoutsScreen & CashoutScreen (CC-B03)", () => {
  it("keeps both PayoutsScreen and CashoutScreen behind FlagGate under DENY_ALL", async () => {
    const wire = installWire(() => undefined);
    const first = renderWithProviders(<PayoutsScreen />, undefined);

    await waitFor(() =>
      expect(screen.getByTestId(TID.common.flagOff.screen)).toBeTruthy(),
    );
    expect(screen.getByText("Payouts isn't available here yet")).toBeTruthy();
    expect(wire.writes()).toHaveLength(0);
    first.unmount();

    const second = renderWithProviders(<CashoutScreen />, undefined);
    await waitFor(() =>
      expect(screen.getByTestId(TID.common.flagOff.screen)).toBeTruthy(),
    );
    expect(
      screen.getByText("Bank cash-out isn't available here yet"),
    ).toBeTruthy();
    expect(wire.writes()).toHaveLength(0);
    second.unmount();
  });

  it("renders wallet + marketplace spendable balances and ops_driver_credit / nip_transfer statement lines", async () => {
    installWire((call) => {
      if (call.path.startsWith("/v1/config/flags")) {
        return {
          status: 200,
          json: { provider_payments: true, wallet_nip: true },
        };
      }
      if (call.path === "/v1/config/cities/LOS") {
        return { status: 200, json: cityConfigLos() };
      }
      if (call.path === "/v1/wallet") {
        return { status: 200, json: driverWalletOverview(2_400_000) };
      }
      if (call.path === "/v1/wallet/mp/overview?cityId=LOS") {
        return {
          status: 200,
          json: {
            clearedMinor: NGN(2_400_000),
            heldMinor: NGN(400_000),
            spendableMinor: NGN(2_000_000),
            holds: [],
          },
        };
      }
      if (call.path.startsWith("/v1/wallet/statements?")) {
        return {
          status: 200,
          json: {
            walletId: "wal_drv_1",
            currency: "NGN",
            from: "2026-09-01",
            to: "2026-09-30",
            opening: NGN(0),
            in: NGN(2_500_000),
            out: NGN(100_000),
            closing: NGN(2_400_000),
            lines: [
              {
                entryId: "ent_ops_1",
                lineId: "lin_ops_1",
                kind: "ops_driver_credit",
                account: "wallet",
                description: "ops driver wallet credit (bank_deposit_verified)",
                counterpartRef: "ops_credit:ocrd_01",
                amountMinor: 500_000,
                runningBalanceMinor: 2_500_000,
                occurredAt: "2026-09-29T12:00:00.000Z",
              },
              {
                entryId: "ent_nip_1",
                lineId: "lin_nip_1",
                kind: "nip_transfer",
                account: "wallet",
                description: "bank transfer instructed",
                counterpartRef: "nip:nip_01",
                amountMinor: -100_000,
                runningBalanceMinor: 2_400_000,
                occurredAt: "2026-09-30T08:00:00.000Z",
              },
            ],
          },
        };
      }
      return undefined;
    });

    const view = renderWithProviders(<PayoutsScreen />, "LOS");
    await screen.findByTestId("driver.payouts.balance");
    await screen.findByTestId("driver.payouts.mpBalances");
    const history = await screen.findByTestId("driver.payouts.history");
    expect(history).toHaveTextContent("ops driver wallet credit", {
      exact: false,
    });
    expect(history).toHaveTextContent("bank transfer instructed", {
      exact: false,
    });

    fireEvent.press(screen.getByTestId(TEST_IDS.driver.earnings.cashout));
    expect(mockNavigate).toHaveBeenCalledWith("Cashout");
    view.unmount();
  });

  it("verifies bank account holder first via GET /v1/wallet/nip/name-enquiry, then posts POST /v1/wallet/nip with stable Idempotency-Key", async () => {
    let offlineOnce = true;
    const wire = installWire((call) => {
      if (call.path.startsWith("/v1/config/flags")) {
        return {
          status: 200,
          json: { provider_payments: true, wallet_nip: true },
        };
      }
      if (call.path === "/v1/config/cities/LOS") {
        return { status: 200, json: cityConfigLos() };
      }
      if (call.path === "/v1/wallet") {
        return { status: 200, json: driverWalletOverview(2_400_000) };
      }
      if (
        call.method === "GET" &&
        call.path ===
          "/v1/wallet/nip/name-enquiry?bankCode=058&accountNumber=0123456789"
      ) {
        return {
          status: 200,
          json: {
            accountName: "ADAEZE OKAFOR",
            sessionId: "ses_nip_01",
          },
        };
      }
      if (call.method === "POST" && call.path === "/v1/wallet/nip") {
        if (offlineOnce) {
          offlineOnce = false;
          return "offline";
        }
        return {
          status: 201,
          json: {
            nipTransferId: "nip_02",
            status: "pending",
            accountName: "ADAEZE OKAFOR",
            amount: NGN(1_500_000),
            entryId: "ent_nip_2",
            balanceAfter: NGN(900_000),
            replayed: false,
          },
        };
      }
      return undefined;
    });

    const view = renderWithProviders(<CashoutScreen />, "LOS");
    await screen.findByTestId("wallet.nip.bankCode");

    // Step 2 inputs are hidden until account holder is verified.
    expect(screen.queryByTestId("wallet.nip.amount")).toBeNull();

    fireEvent.changeText(screen.getByTestId("wallet.nip.bankCode"), "058");
    fireEvent.changeText(
      screen.getByTestId("wallet.nip.accountNumber"),
      "0123456789",
    );
    fireEvent.press(screen.getByTestId("wallet.nip.verifyAccount"));

    const verifiedCard = await screen.findByTestId(
      "wallet.nip.verifiedAccount",
    );
    expect(verifiedCard).toHaveTextContent("ADAEZE OKAFOR", { exact: false });

    fireEvent.changeText(screen.getByTestId("wallet.nip.amount"), "15000");
    fireEvent.changeText(screen.getByTestId("wallet.nip.pin"), "1234");

    // First attempt offline -> preserves Idempotency-Key.
    fireEvent.press(screen.getByTestId(TEST_IDS.wallet.nip.confirm));
    await screen.findByText(/Bank payout didn’t go through/);

    // Retry succeeds with the same Idempotency-Key.
    fireEvent.press(screen.getByTestId(TEST_IDS.wallet.nip.confirm));
    const statusCard = await screen.findByTestId(TEST_IDS.wallet.nip.status);
    expect(statusCard).toHaveTextContent("ADAEZE OKAFOR", { exact: false });

    const writes = wire.writes();
    expect(writes).toHaveLength(2);
    expect(writes[0].body).toEqual({
      bankCode: "058",
      accountNumber: "0123456789",
      amountMinor: 1_500_000,
      pin: "1234",
    });
    const firstKey = writes[0].headers["Idempotency-Key"];
    const secondKey = writes[1].headers["Idempotency-Key"];
    expect(IdempotencyKeySchema.safeParse(firstKey).success).toBe(true);
    expect(secondKey).toBe(firstKey);
    view.unmount();
  });
});
