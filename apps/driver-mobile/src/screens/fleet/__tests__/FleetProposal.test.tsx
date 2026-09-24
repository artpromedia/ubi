// C2 FleetProposalReview + C2b motion lock, on the real wire. Covers the terms diff
// (vehicle, shift, remittance as the server's Money, what changes and needs a PIN),
// UBI's check, the no-penalty decline copy, the motion lock (moving → no details and
// no controls, the earliest deadline; stale → only the SERVER's parked ack unlocks),
// the exact sign POST ({pin} only, with an Idempotency-Key) and decline POST (no body),
// and every PIN refusal: wrong PIN with tries left (a new key next time), lockout, no
// PIN set, an expired offer, and offline (the retry reuses the same key).
import React from "react";
import "@testing-library/react-native/extend-expect";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { IdempotencyKeySchema, dynamicTestId } from "@ubi/contracts";
import { installWire, type WireCall } from "../../../../jest/wire";
import {
  PARKED_ACK,
  offer,
  offers,
  schedule,
  signed,
} from "../../../../jest/fleetFixtures";
import { resetMotionForDev, setMotionForDev } from "../../../lib/motion";
import { FleetProposalScreen } from "../FleetProposalScreen";
import { FLEET_TID } from "../testIds";

const mockNavigate = jest.fn();
let mockParams: { offerId?: string } | undefined = { offerId: "fpr_1" };
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

const SIGN = "/v1/fleet-offers/fpr_1/sign";
const DECLINE = "/v1/fleet-offers/fpr_1/decline";

let client: QueryClient;
const harness = () => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return render(
    <ThemeProvider defaultMode="dark">
      <QueryClientProvider client={client}>
        <FleetProposalScreen />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

const keyOf = (call: WireCall) => {
  const key = call.headers["Idempotency-Key"];
  expect(IdempotencyKeySchema.safeParse(key).success).toBe(true);
  return key;
};

const serve = (
  handlers: Partial<Record<string, (call: WireCall) => unknown>> = {},
  list = offers(),
) =>
  installWire((call) => {
    if (call.method === "GET" && call.path === "/v1/drivers/me/fleet-offers")
      return { status: 200, json: list };
    if (call.method === "GET" && call.path === "/v1/drivers/me/schedule")
      return { status: 200, json: schedule() };
    if (call.path === "/v1/mp/driver/parked")
      return { status: 200, json: PARKED_ACK };
    const handler = handlers[call.path];
    return handler
      ? (handler(call) as { status: number; json?: unknown } | "offline")
      : undefined;
  });

const typePin = (digits: string) => {
  for (const d of digits)
    fireEvent.press(screen.getByTestId(dynamicTestId(FLEET_TID.pinKey, d)));
};

describe("FleetProposalScreen (C2 / C2b)", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockParams = { offerId: "fpr_1" };
    resetMotionForDev();
  });

  it("shows the terms diff with the server's amounts, UBI's check and the no-penalty decline", async () => {
    serve();
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    const terms = await screen.findByTestId(FLEET_TID.proposalTerms);
    expect(terms).toHaveTextContent("LAG-744-MM · Toyota Corolla", {
      exact: false,
    });
    expect(terms).toHaveTextContent("Night · 18:00–06:00", { exact: false });
    expect(terms).toHaveTextContent("Was Day · 06:00–18:00", { exact: false });
    // weekly_fixed remittance: the server's Money, formatted, never computed.
    expect(terms).toHaveTextContent("₦40,000 / week", { exact: false });
    expect(terms).toHaveTextContent("Was ₦35,000 / week", { exact: false });
    expect(terms).toHaveTextContent("Carry forward, up to 4 weeks", {
      exact: false,
    });
    expect(terms).toHaveTextContent("Your fleet pays for servicing", {
      exact: false,
    });
    expect(terms).toHaveTextContent("Changes · needs your PIN", {
      exact: false,
    });
    expect(terms).toHaveTextContent("Not enough data", { exact: false });
    expect(screen.getByTestId(FLEET_TID.proposalCheck)).toHaveTextContent(
      "This doesn’t clash with your availability or your bookings (checked by UBI).",
      { exact: false },
    );
    expect(
      screen.getByText(
        "If you decline, nothing changes and there is no penalty. Your fleet only sees “declined”.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId(FLEET_TID.proposalAccept)).toHaveTextContent(
      "Accept & sign with PIN",
    );
    expect(screen.getByTestId(FLEET_TID.proposalDecline)).toHaveTextContent(
      "Decline, no penalty",
    );
    view.unmount();
  });

  it("while MOVING shows only the lock: no terms, no controls, the earliest deadline", async () => {
    const wire = serve();
    act(() => setMotionForDev("moving"));
    const view = harness();
    const lock = await screen.findByTestId(FLEET_TID.motionLock);
    expect(lock).toHaveTextContent("Review when stopped", { exact: false });
    // The booking alert (09:20) is earlier than the offer's expiry (10:02).
    expect(screen.getByTestId(FLEET_TID.motionDeadline)).toHaveTextContent(
      "Earliest deadline 09:20",
      { exact: false },
    );
    expect(screen.queryByTestId(FLEET_TID.proposalTerms)).toBeNull();
    expect(screen.queryByTestId(FLEET_TID.proposalAccept)).toBeNull();
    expect(screen.queryByTestId(FLEET_TID.proposalDecline)).toBeNull();
    expect(wire.writes()).toEqual([]);
    view.unmount();
  });

  it("stale location: the terms are readable but only the server's parked ack unlocks the decision", async () => {
    const wire = serve();
    const view = harness();
    await screen.findByTestId(FLEET_TID.proposalTerms);
    expect(screen.getByTestId(FLEET_TID.motionLock)).toHaveTextContent(
      "Confirm you’re stopped",
      { exact: false },
    );
    expect(screen.queryByTestId(FLEET_TID.proposalAccept)).toBeNull();
    fireEvent.press(screen.getByTestId(FLEET_TID.motionParked));
    expect(await screen.findByTestId(FLEET_TID.proposalAccept)).toBeTruthy();
    expect(wire.writes().map((c) => c.path)).toEqual(["/v1/mp/driver/parked"]);
    view.unmount();
  });

  it("signs with the PIN: POST …/sign {pin} with an Idempotency-Key, then the signature evidence", async () => {
    const wire = serve({ [SIGN]: () => ({ status: 200, json: signed() }) });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.proposalAccept));
    expect(screen.getByTestId(FLEET_TID.pinPad)).toBeTruthy();
    expect(screen.getByTestId(FLEET_TID.signPin)).toBeDisabled();
    typePin("432");
    expect(screen.getByLabelText("3 of up to 6 digits entered")).toBeTruthy();
    expect(screen.getByTestId(FLEET_TID.signPin)).toBeDisabled();
    typePin("1");
    fireEvent.press(screen.getByTestId(FLEET_TID.signPin));
    const outcome = await screen.findByTestId(FLEET_TID.proposalOutcome);
    expect(outcome).toHaveTextContent("Signed with your PIN", { exact: false });
    expect(outcome).toHaveTextContent(
      "Your arrangement with Example Fleet starts 2026-10-01.",
      { exact: false },
    );
    expect(outcome).toHaveTextContent("Terms v2", { exact: false });
    const writes = wire.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("POST");
    expect(writes[0].path).toBe(SIGN);
    expect(writes[0].body).toEqual({ pin: "4321" });
    keyOf(writes[0]);
    // The PIN never shows on screen, and it isn't kept in React Query's mutation
    // cache (whose variables outlive the request) once it has been sent.
    expect(screen.queryByText("4321")).toBeNull();
    const cached = client.getMutationCache().getAll();
    expect(cached.length).toBeGreaterThan(0);
    for (const mutation of cached)
      expect(JSON.stringify(mutation.state.variables ?? null)).not.toContain(
        "4321",
      );
    view.unmount();
  });

  it("a wrong PIN says how many tries are left, signs nothing, and the next attempt is a new command", async () => {
    let attempt = 0;
    const wire = serve({
      [SIGN]: () => {
        attempt += 1;
        return attempt === 1
          ? {
              status: 422,
              json: {
                code: "wrong_pin",
                message: "the PIN was not accepted",
                details: { attemptsRemaining: 2 },
              },
            }
          : { status: 200, json: signed() };
      },
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.proposalAccept));
    typePin("1111");
    fireEvent.press(screen.getByTestId(FLEET_TID.signPin));
    const error = await screen.findByTestId(FLEET_TID.pinError);
    expect(error).toHaveTextContent("That PIN isn’t right", { exact: false });
    expect(error).toHaveTextContent(
      "2 tries left before your PIN locks. Nothing was signed.",
      { exact: false },
    );
    // The pad stays open and empty for another try.
    expect(screen.getByLabelText("0 of up to 6 digits entered")).toBeTruthy();
    typePin("4321");
    fireEvent.press(screen.getByTestId(FLEET_TID.signPin));
    await screen.findByTestId(FLEET_TID.proposalOutcome);
    const [first, second] = wire.writes();
    expect(first.body).toEqual({ pin: "1111" });
    expect(second.body).toEqual({ pin: "4321" });
    expect(keyOf(second)).not.toBe(keyOf(first));
    view.unmount();
  });

  it("a locked PIN, a missing PIN and an expired offer each say what happened", async () => {
    const refusals = [
      {
        status: 403,
        json: {
          code: "pin_locked",
          message: "locked",
          details: { lockedUntil: "2026-09-30T08:00:00.000Z" },
        },
      },
      {
        status: 409,
        json: { code: "pin_not_verified", message: "no PIN" },
      },
      {
        status: 409,
        json: {
          code: "offer_expired",
          message: "This offer expired. Your fleet can send a new one.",
        },
      },
    ];
    let i = 0;
    serve({ [SIGN]: () => refusals[i++] });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.proposalAccept));
    typePin("4321");
    fireEvent.press(screen.getByTestId(FLEET_TID.signPin));
    expect(await screen.findByTestId(FLEET_TID.pinError)).toHaveTextContent(
      "Your PIN is locked",
      { exact: false },
    );
    expect(screen.getByTestId(FLEET_TID.pinError)).toHaveTextContent(
      "you can try again after Wed 30 Sep · 09:00. Nothing was signed.",
      { exact: false },
    );
    typePin("4321");
    fireEvent.press(screen.getByTestId(FLEET_TID.signPin));
    expect(
      await screen.findByText("Set up your wallet PIN first"),
    ).toBeTruthy();
    typePin("4321");
    fireEvent.press(screen.getByTestId(FLEET_TID.signPin));
    expect(await screen.findByText("This offer expired")).toBeTruthy();
    expect(
      screen.getByText("This offer expired. Your fleet can send a new one."),
    ).toBeTruthy();
    view.unmount();
  });

  it("offline: nothing is signed and the retry reuses the SAME Idempotency-Key", async () => {
    let offline = true;
    const wire = serve({
      [SIGN]: () => (offline ? "offline" : { status: 200, json: signed() }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.proposalAccept));
    typePin("4321");
    fireEvent.press(screen.getByTestId(FLEET_TID.signPin));
    expect(await screen.findByTestId(FLEET_TID.pinError)).toHaveTextContent(
      "You’re offline",
      { exact: false },
    );
    offline = false;
    typePin("4321");
    fireEvent.press(screen.getByTestId(FLEET_TID.signPin));
    await screen.findByTestId(FLEET_TID.proposalOutcome);
    const [first, second] = wire.writes();
    expect(keyOf(second)).toBe(keyOf(first));
    view.unmount();
  });

  it("declines with POST …/decline — no body, an Idempotency-Key, and the no-penalty outcome", async () => {
    const wire = serve({
      [DECLINE]: () => ({
        status: 200,
        json: { offerId: "fpr_1", status: "declined" },
      }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(FLEET_TID.proposalDecline));
    const outcome = await screen.findByTestId(FLEET_TID.proposalOutcome);
    expect(outcome).toHaveTextContent(
      "Nothing changes and there is no penalty. Example Fleet only sees “declined”.",
      { exact: false },
    );
    const writes = wire.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(DECLINE);
    expect(writes[0].body).toBeUndefined();
    keyOf(writes[0]);
    view.unmount();
  });

  it("with several proposals and none chosen, lists them to pick from", async () => {
    mockParams = undefined;
    serve(
      {},
      offers([
        offer(),
        offer({
          offerId: "fpr_2",
          fleet: { fleetId: "flt_2", name: "Lekki Rides" },
          expiresAt: "2026-10-02T09:00:00.000Z",
        }),
      ]),
    );
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    expect(
      await screen.findByTestId(dynamicTestId(FLEET_TID.proposalCard, "fpr_2")),
    ).toHaveTextContent("Proposal from Lekki Rides", { exact: false });
    fireEvent.press(
      screen.getByLabelText("Review the proposal from Lekki Rides"),
    );
    expect(await screen.findByTestId(FLEET_TID.proposalTerms)).toBeTruthy();
    view.unmount();
  });

  it("no pending proposal: says so honestly", async () => {
    serve({}, offers([]));
    const view = harness();
    expect(
      await screen.findByTestId(FLEET_TID.proposalEmpty),
    ).toHaveTextContent("No proposals waiting", { exact: false });
    view.unmount();
  });

  it("fleet-service's 404 feature_disabled renders the honest not-available state", async () => {
    installWire(() => ({
      status: 404,
      json: {
        code: "feature_disabled",
        message: "fleet is not available here",
      },
    }));
    const view = harness();
    expect(await screen.findByTestId(FLEET_TID.unavailable)).toHaveTextContent(
      "Fleet tools aren’t available yet in your city",
      { exact: false },
    );
    view.unmount();
  });
});
