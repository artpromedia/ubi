// Trip.Complete — complete → receipt, against the real api layer
// (src/api/rides.ts) with mocked HTTP (installFixtures). The receipt renders
// ONLY the server's finalFareMinor/currency — never a client computation —
// and a cancelled ride renders as cancelled, never as a paid trip.
import type React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { installFixtures } from "@ubi/mobile-core";
import { CompleteScreen } from "../CompleteScreen";

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: { tripId: "ride_9" } }),
}));

const wrap = (el: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider defaultMode="dark">{el}</ThemeProvider>
    </QueryClientProvider>,
  );
};

const baseRide = (overrides: Record<string, unknown> = {}) => ({
  rideId: "ride_9",
  state: "completed",
  status: "Completed",
  version: 6,
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

describe("Trip.Complete — server-confirmed receipt", () => {
  it("renders the server's exact final total for a completed wallet trip", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "GET" && path === "/v1/rides/ride_9") {
        return { status: 200, json: baseRide() };
      }
      return undefined;
    });

    wrap(<CompleteScreen />);

    await waitFor(() => expect(screen.getByText("₦2,850")).toBeTruthy());
    expect(screen.getByText("UBI Wallet")).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("renders cash as collected, never as a wallet charge", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "GET" && path === "/v1/rides/ride_9") {
        return { status: 200, json: baseRide({ paymentMethodId: "cash" }) };
      }
      return undefined;
    });

    wrap(<CompleteScreen />);

    await waitFor(() =>
      expect(screen.getByText("Cash — collected")).toBeTruthy(),
    );
  });

  it("renders a cancelled ride as cancelled, never as a paid receipt", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "GET" && path === "/v1/rides/ride_9") {
        return {
          status: 200,
          json: baseRide({
            state: "cancelled_by_rider",
            status: "Cancelled",
            finalFareMinor: null,
            cancelReasonCode: "changed_mind",
          }),
        };
      }
      return undefined;
    });

    wrap(<CompleteScreen />);

    await waitFor(() =>
      expect(screen.getByText("This trip was cancelled")).toBeTruthy(),
    );
    expect(screen.queryByText("₦2,850")).toBeNull();
    expect(screen.queryByTestId("driver.trip.receipt")).toBeNull();
  });
});
