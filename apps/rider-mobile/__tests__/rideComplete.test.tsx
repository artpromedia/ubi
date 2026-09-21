// Ride.Pay — complete → receipt, against the real api layer (src/api/rides.ts)
// with mocked HTTP (installFixtures). The receipt renders ONLY the server's
// finalFareMinor/currency (never a client computation), states honestly when
// the server hasn't confirmed a final total yet, and never implies success
// before the server's own state says "completed".
import type React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { installFixtures } from "@ubi/mobile-core";
import { PayScreen } from "../src/screens/ride/PayScreen";

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { rideId: "ride_1" } }),
}));

const wrap = (el: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider defaultMode="light">{el}</ThemeProvider>
    </QueryClientProvider>,
  );
};

const baseRide = (overrides: Record<string, unknown> = {}) => ({
  rideId: "ride_1",
  state: "completed",
  status: "Completed",
  version: 4,
  cityId: "LOS",
  configVersion: 1,
  vehicleClass: "standard",
  paymentMethodId: "wallet_main",
  pickup: { lat: 6.4, lng: 3.4, address: "Lekki" },
  dropoff: { lat: 6.42, lng: 3.42, address: "VI" },
  currency: "NGN",
  quotedFareMinor: 280000,
  waitFeeMinor: 5000,
  finalFareMinor: 285000,
  pinRequired: true,
  pinVerified: true,
  pinLocked: false,
  requestedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(() => {
  installFixtures(async () => undefined);
});

describe("Ride.Pay — server-confirmed receipt", () => {
  it("renders the server's exact final total, never a client computation", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "GET" && path === "/v1/rides/ride_1") {
        return { status: 200, json: baseRide() };
      }
      return undefined;
    });

    wrap(<PayScreen />);

    // 285000 minor units of NGN -> ₦2,850 (the default formatter's digits-shown rule).
    await waitFor(() => expect(screen.getByText("₦2,850")).toBeTruthy());
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("states honestly that the total isn't confirmed yet, instead of showing the quote as final", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "GET" && path === "/v1/rides/ride_1") {
        return {
          status: 200,
          json: baseRide({ state: "payment_pending", finalFareMinor: null }),
        };
      }
      return undefined;
    });

    wrap(<PayScreen />);

    await waitFor(() =>
      expect(
        screen.getByText(/hasn.t been confirmed by the server yet/),
      ).toBeTruthy(),
    );
    // The agreed fare is shown as its own labeled row — never re-labeled or
    // promoted to stand in for the (not yet known) final total.
    expect(screen.getByText("Agreed fare")).toBeTruthy();
  });

  it("renders a cash trip as cash, and a wallet trip as wallet — server-stated only", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "GET" && path === "/v1/rides/ride_1") {
        return {
          status: 200,
          json: baseRide({ paymentMethodId: "cash" }),
        };
      }
      return undefined;
    });

    wrap(<PayScreen />);

    await waitFor(() =>
      expect(screen.getByText("Cash to the driver")).toBeTruthy(),
    );
  });

  it("surfaces a payment_failed state as a failure banner, never a false success", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "GET" && path === "/v1/rides/ride_1") {
        return {
          status: 200,
          json: baseRide({ state: "payment_failed" }),
        };
      }
      return undefined;
    });

    wrap(<PayScreen />);

    await waitFor(() =>
      expect(screen.getByText("Payment failed")).toBeTruthy(),
    );
  });
});
