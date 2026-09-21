// PIN verify — success/failure/rate-limit rendering, against the real api
// layer (src/api/rides.ts) with mocked HTTP (installFixtures). Mirrors the
// exact wire contract in services/ride-service/internal/move/lifecycle.go
// VerifyPin: success is a 200 (verified:true) that this screen immediately
// follows with POST /start; a wrong attempt is a 422 `wrong_pin` with
// `details.attemptsLeft`; the per-ride cap is a 429 `pin_attempts_exhausted`;
// the short-window guard is a 429 `rate_limited`.
import type React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { installFixtures } from "@ubi/mobile-core";
import { PinScreen } from "../PinScreen";

const mockReplace = jest.fn();
const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ replace: mockReplace, goBack: mockGoBack }),
  useRoute: () => ({ params: { tripId: "ride_1" } }),
}));

const wrap = (el: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider defaultMode="dark">{el}</ThemeProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mockReplace.mockClear();
  mockGoBack.mockClear();
  installFixtures(async () => undefined);
});

describe("Trip.Pin — verify-pin outcomes", () => {
  it("verified PIN starts the trip and hands off to InTrip", async () => {
    installFixtures(async ({ method, path, body }) => {
      if (method === "POST" && path === "/v1/rides/ride_1/verify-pin") {
        expect((body as { pin: string }).pin).toBe("4831");
        return { status: 200, json: { verified: true, attemptsLeft: 5 } };
      }
      if (method === "POST" && path === "/v1/rides/ride_1/start") {
        return {
          status: 200,
          json: { rideId: "ride_1", state: "in_progress" },
        };
      }
      return undefined;
    });

    wrap(<PinScreen />);
    fireEvent.changeText(screen.getByTestId("driver.pin.input"), "4831");
    fireEvent.press(screen.getByTestId("driver.pin.submit"));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith("InTrip", { tripId: "ride_1" }),
    );
  });

  it("a wrong PIN shows the server's attemptsLeft and stays retryable", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/rides/ride_1/verify-pin") {
        return {
          status: 422,
          json: {
            code: "wrong_pin",
            message: "that PIN does not match",
            details: { attemptsLeft: 3 },
          },
        };
      }
      return undefined;
    });

    wrap(<PinScreen />);
    fireEvent.changeText(screen.getByTestId("driver.pin.input"), "0000");
    fireEvent.press(screen.getByTestId("driver.pin.submit"));

    await waitFor(() =>
      expect(screen.getByText(/3 attempt\(s\) left/)).toBeTruthy(),
    );
    expect(mockReplace).not.toHaveBeenCalled();
    // Still enterable — not locked.
    expect(screen.getByTestId("driver.pin.input").props.editable).not.toBe(
      false,
    );
  });

  it("the per-ride attempt cap locks the PIN and disables the input", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/rides/ride_1/verify-pin") {
        return {
          status: 429,
          json: {
            code: "pin_attempts_exhausted",
            message: "the pickup PIN is now locked for this ride",
            details: { attemptsLeft: 0 },
          },
        };
      }
      return undefined;
    });

    wrap(<PinScreen />);
    fireEvent.changeText(screen.getByTestId("driver.pin.input"), "1234");
    fireEvent.press(screen.getByTestId("driver.pin.submit"));

    await waitFor(() =>
      expect(screen.getByText(/PIN locked for this ride/)).toBeTruthy(),
    );
    expect(screen.getByTestId("driver.pin.input").props.editable).toBe(false);
    expect(
      screen.getByTestId("driver.pin.submit").props.accessibilityState
        ?.disabled,
    ).toBe(true);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("the short-window rate limit is rendered distinctly from a wrong PIN", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/rides/ride_1/verify-pin") {
        return {
          status: 429,
          json: {
            code: "rate_limited",
            message: "too many PIN attempts; wait a moment",
          },
        };
      }
      return undefined;
    });

    wrap(<PinScreen />);
    fireEvent.changeText(screen.getByTestId("driver.pin.input"), "1234");
    fireEvent.press(screen.getByTestId("driver.pin.submit"));

    await waitFor(() =>
      expect(screen.getByText("Too many attempts")).toBeTruthy(),
    );
    expect(screen.queryByText(/attempt\(s\) left/)).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
