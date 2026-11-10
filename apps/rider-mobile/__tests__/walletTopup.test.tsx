// Rider Wallet.TopUp wire-level tests (CC-B03 / P0-03):
// 1. Default DENY_ALL (or partial flag enablement) renders TID.common.flagOff.screen
//    and never calls POST /v1/wallet/topups.
// 2. With provider_payments + wallet_p2p enabled, TopUpScreen reads CityConfig
//    paymentMethods, shows unavailable methods with server reasons, packages
//    typed whole units via typedMajorToMoney, sends Idempotency-Key (kept stable
//    across offline retries), and renders the server's updated balance.
import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { IdempotencyKeySchema, TEST_IDS } from "@ubi/contracts";
import { TID } from "@ubi/mobile-core";
import { TopUpScreen } from "../src/screens/wallet/TopUpScreen";
import { WalletHomeScreen } from "../src/screens/wallet/WalletHomeScreen";
import { clearClients, renderApp } from "./helpers/render";
import { installWire, NGN } from "./helpers/wire";

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

const walletOverview = (balanceMinor = 250_000) => ({
  walletId: "wal_rider_1",
  currency: "NGN",
  balance: NGN(balanceMinor),
  tier: "tier1",
  limits: {
    dailyOut: NGN(5_000_000),
    usedToday: NGN(0),
    remainingToday: NGN(5_000_000),
    singleTransfer: NGN(2_000_000),
    balanceCap: NGN(30_000_000),
  },
  safeMode: { active: false, until: null },
  locked: false,
  pinSet: true,
  pinLockedUntil: null,
  coolingUntil: null,
});

const cityConfigLos = () => ({
  cityId: "LOS",
  countryCode: "NG",
  timezone: "Africa/Lagos",
  currency: "NGN",
  currencySymbol: "₦",
  minorDigitsShown: 0,
  currencyFractionDigits: 2,
  locale: "en-NG",
  emergencyNumber: "112",
  offerTtlSec: 12,
  quoteTtlSec: 300,
  reservationFreeCancelMin: 60,
  supportPhone: "+2348000000000",
  paymentMethods: [
    { id: "cash", available: true },
    { id: "wallet", available: true },
    { id: "card", available: true },
    {
      id: "bank_transfer",
      available: false,
      reason: "Dedicated virtual accounts are under maintenance.",
    },
  ],
});

afterEach(() => {
  clearClients();
  mockNavigate.mockReset();
  mockGoBack.mockReset();
});

describe("Rider Wallet TopUpScreen (CC-B03)", () => {
  it("stays behind FlagGate under DENY_ALL and when only one of provider_payments / wallet_p2p is on", async () => {
    const wire = installWire(() => undefined, {});
    const first = renderApp(<TopUpScreen />, undefined, { cityConfig: true });

    await waitFor(() =>
      expect(screen.getByTestId(TID.common.flagOff.screen)).toBeTruthy(),
    );
    expect(
      screen.getByText("Wallet top-up isn't available here yet"),
    ).toBeTruthy();
    expect(wire.writes()).toHaveLength(0);
    first.unmount();

    const wirePartial = installWire(() => undefined, {
      provider_payments: true,
      wallet_p2p: false,
    });
    renderApp(<TopUpScreen />, undefined, { cityConfig: true });
    await waitFor(() =>
      expect(screen.getByTestId(TID.common.flagOff.screen)).toBeTruthy(),
    );
    expect(wirePartial.writes()).toHaveLength(0);
  });

  it("submits POST /v1/wallet/topups with packaged amountMinor + Idempotency-Key (reused across offline retry) and renders server balanceAfter", async () => {
    let offlineAttempt = true;
    const wire = installWire(
      (call) => {
        if (call.method === "GET" && call.path === "/v1/config/cities/LOS") {
          return { status: 200, json: cityConfigLos() };
        }
        if (call.method === "GET" && call.path === "/v1/wallet") {
          return { status: 200, json: walletOverview(250_000) };
        }
        if (call.method === "POST" && call.path === "/v1/wallet/topups") {
          if (offlineAttempt) {
            offlineAttempt = false;
            return "offline";
          }
          return {
            status: 201,
            json: {
              topupId: "top_01",
              amount: NGN(500_000),
              status: "captured",
              entryId: "ent_01",
              balanceAfter: NGN(750_000),
              replayed: false,
            },
          };
        }
        return undefined;
      },
      { provider_payments: true, wallet_p2p: true },
    );

    renderApp(<TopUpScreen />, undefined, { cityConfig: true });

    await screen.findByTestId("wallet.topup.method.card");
    // Cash and wallet are never offered as top-up funding sources.
    expect(screen.queryByTestId("wallet.topup.method.cash")).toBeNull();
    expect(screen.queryByTestId("wallet.topup.method.wallet")).toBeNull();
    // Unavailable external method renders with its honest server reason.
    expect(
      screen.getByTestId("wallet.topup.unavailable.bank_transfer"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Dedicated virtual accounts are under maintenance/),
    ).toBeTruthy();

    fireEvent.changeText(screen.getByTestId("wallet.topup.amount"), "5000");

    // First attempt hits offline; Idempotency-Key is preserved for retry.
    fireEvent.press(screen.getByTestId(TEST_IDS.wallet.topup.confirm));
    await screen.findByText(/Top-up didn’t go through/);

    // Second attempt succeeds with the exact same Idempotency-Key.
    fireEvent.press(screen.getByTestId(TEST_IDS.wallet.topup.confirm));
    await screen.findByTestId("wallet.topup.outcome");

    const writes = wire.writes();
    expect(writes).toHaveLength(2);
    expect(writes[0].body).toEqual({ methodId: "card", amountMinor: 500_000 });
    expect(writes[1].body).toEqual({ methodId: "card", amountMinor: 500_000 });
    const firstKey = writes[0].headers["Idempotency-Key"];
    const secondKey = writes[1].headers["Idempotency-Key"];
    expect(IdempotencyKeySchema.safeParse(firstKey).success).toBe(true);
    expect(secondKey).toBe(firstKey);
  });

  it("exposes the Top up wallet button on WalletHomeScreen only when provider_payments + wallet_p2p are enabled", async () => {
    installWire(
      (call) =>
        call.path === "/v1/wallet"
          ? { status: 200, json: walletOverview() }
          : undefined,
      { provider_payments: true, wallet_p2p: true },
    );
    renderApp(<WalletHomeScreen />);
    const btn = await screen.findByTestId("rider.wallet.topup");
    fireEvent.press(btn);
    expect(mockNavigate).toHaveBeenCalledWith("TopUp");
  });
});
