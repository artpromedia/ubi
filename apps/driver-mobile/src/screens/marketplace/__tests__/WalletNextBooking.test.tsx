// DriverWallet (design A01 flow 9): spendable and held stay the server's two separate
// figures; where advance bookings are on, the next committed booking's net (server
// netMinor) is shown apart from both — never added to either — and a calendar failure
// or a disabled flag simply leaves it out.
import React from "react";
import "@testing-library/react-native/extend-expect";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { FlagsProvider } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import { installWire, NGN, isoIn } from "../../../../jest/wire";
import { booking } from "../../../../jest/mpFixtures";
import { WalletHoldsContainer, nextBookingOf } from "../WalletHoldsContainer";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: undefined }),
}));

const WALLET = TEST_IDS.mp.driver.wallet;
const FLAGS_PATH = "/v1/config/flags?cityId=LOS";
const overview = {
  clearedMinor: NGN(46_080_00),
  heldMinor: NGN(3_900_00),
  spendableMinor: NGN(42_180_00),
  holds: [],
};

const harness = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return render(
    <ThemeProvider defaultMode="dark">
      <FlagsProvider cityId="LOS">
        <QueryClientProvider client={client}>
          <WalletHoldsContainer />
        </QueryClientProvider>
      </FlagsProvider>
    </ThemeProvider>,
  );
};

describe("Wallet — next booking net, separate from spendable and held", () => {
  beforeEach(() => mockNavigate.mockReset());

  it("picks the earliest committed booking by the server's window start", () => {
    const later = booking({
      bookingId: "bkg_later",
      schedule: { windowStart: isoIn(48 * 3_600_000) } as never,
    });
    const sooner = booking({
      bookingId: "bkg_sooner",
      schedule: { windowStart: isoIn(20 * 3_600_000) } as never,
    });
    const failed = booking({
      bookingId: "bkg_failed",
      state: "failed",
      schedule: { windowStart: isoIn(2 * 3_600_000) } as never,
    });
    expect(nextBookingOf([later, failed, sooner])?.bookingId).toBe(
      "bkg_sooner",
    );
    expect(nextBookingOf([failed])).toBeNull();
  });

  it("shows the next booking's net apart from the wallet figures and opens the calendar", async () => {
    installWire((call) => {
      if (call.path === FLAGS_PATH)
        return {
          status: 200,
          json: {
            marketplace_rides: true,
            marketplace_advance_reservations: true,
          },
        };
      if (call.path.startsWith("/v1/wallet/mp/overview"))
        return { status: 200, json: overview };
      if (call.path === "/v1/mp/driver/calendar")
        return {
          status: 200,
          json: { bookings: [booking()], note: "Future bookings." },
        };
      return undefined;
    });
    const view = harness();
    const card = await screen.findByTestId(WALLET.nextBooking);
    expect(card).toHaveTextContent(
      /Next booking · Thu 24 Sep 2026, 07:30 \(UTC\+01:00\).*₦5,040/,
    );
    expect(screen.getByTestId(WALLET.spendable)).toHaveTextContent("₦42,180");
    expect(screen.getByTestId(WALLET.held)).toHaveTextContent("₦3,900");
    // The pressable row is announced by its label alone: it must carry the amount.
    expect(
      screen.getByLabelText(
        "Next booking, Thu 24 Sep 2026, 07:30 (UTC+01:00), you keep 5,040 naira. Open your bookings.",
      ),
    ).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/Open your bookings/));
    expect(mockNavigate).toHaveBeenCalledWith("Calendar");
    view.unmount();
  });

  it("omits the row when advance bookings are off (and never asks for the calendar)", async () => {
    const wire = installWire((call) => {
      if (call.path === FLAGS_PATH)
        return { status: 200, json: { marketplace_rides: true } };
      if (call.path.startsWith("/v1/wallet/mp/overview"))
        return { status: 200, json: overview };
      return undefined;
    });
    const view = harness();
    await screen.findByTestId(WALLET.spendable);
    await waitFor(() =>
      expect(wire.calls.some((c) => c.path === FLAGS_PATH)).toBe(true),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId(WALLET.nextBooking)).toBeNull();
    expect(wire.calls.some((c) => c.path === "/v1/mp/driver/calendar")).toBe(
      false,
    );
    view.unmount();
  });
});
