// A02 route amendments on the driver side, wired to the real GET/POST shapes (fixtures
// parsed through @ubi/contracts). Covers the parked gate (moving → "Stop safely to
// review", no details, no countdown, no controls; stale → read-only + attestation;
// server-acknowledged parked → approve / reject), the server-computed card (original vs
// proposed, added distance/time, revised total, incremental commission, net change,
// rider funding, expiry), the exact decision POSTs bound to the amendment's revisions
// with an Idempotency-Key, "no penalty" on reject, plain-copy refusals, the offline
// retry under the same key, and the parked-only proposal of a stop change.
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
import { IdempotencyKeySchema, dynamicTestId } from "@ubi/contracts";
import { installWire, NGN, isoIn, type WireCall } from "../../../../jest/wire";
import {
  amendment,
  amendmentList,
  stop,
  trip,
} from "../../../../jest/mpFixtures";
import {
  currentMotion,
  resetMotionForDev,
  setMotionForDev,
} from "../../../lib/motion";
import { RouteAmendmentContainer } from "../RouteAmendmentContainer";
import { MP_DRIVER_TID } from "../testIds";

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: { requestId: "req_1" } }),
}));

const TID = MP_DRIVER_TID.amend;
const TRIP_PATH = "/v1/mp/requests/req_1/trip";
const LIST_PATH = "/v1/mp/requests/req_1/amendments";
const APPROVE_PATH = "/v1/mp/requests/req_1/amendments/amd_1/approve";
const REJECT_PATH = "/v1/mp/requests/req_1/amendments/amd_1/reject";

const PARKED_ACK = {
  state: "parked_confirmed",
  availabilityEpoch: 9,
  confirmedAt: isoIn(0),
  expiresAt: isoIn(600_000),
  ttlSeconds: 600,
};

const harness = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return render(
    <ThemeProvider defaultMode="dark">
      <QueryClientProvider client={client}>
        <RouteAmendmentContainer />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

const keyOf = (call: WireCall) => {
  const key = call.headers["Idempotency-Key"];
  expect(IdempotencyKeySchema.safeParse(key).success).toBe(true);
  return key;
};

/** A server whose amendment list changes as decisions land. */
const serve = (
  handlers: Partial<Record<string, (call: WireCall) => unknown>> = {},
  initial = amendmentList([amendment()]),
) => {
  let list = initial;
  const wire = installWire((call) => {
    if (call.method === "GET" && call.path === TRIP_PATH)
      return { status: 200, json: trip() };
    if (call.method === "GET" && call.path === LIST_PATH)
      return { status: 200, json: list };
    if (call.path === "/v1/mp/driver/parked")
      return { status: 200, json: PARKED_ACK };
    const handler = handlers[call.path];
    if (handler) {
      const reply = handler(call) as
        | { status: number; json?: unknown }
        | "offline";
      if (
        reply !== "offline" &&
        reply.status < 300 &&
        reply.json &&
        (reply.json as { amendmentId?: string }).amendmentId
      ) {
        const saved = reply.json as ReturnType<typeof amendment>;
        list = amendmentList([
          saved,
          ...list.amendments.filter((a) => a.amendmentId !== saved.amendmentId),
        ]);
      }
      return reply;
    }
    return undefined;
  });
  return wire;
};

describe("RouteAmendmentContainer (A02 driver review)", () => {
  beforeEach(() => resetMotionForDev());

  it("while MOVING shows only “Stop safely to review”: no details, no countdown, no controls", async () => {
    serve();
    act(() => setMotionForDev("moving"));
    const view = harness();
    expect(await screen.findByText("Stop safely to review")).toBeTruthy();
    expect(screen.getByTestId(TID.stopSafely)).toBeTruthy();
    expect(screen.queryByTestId(dynamicTestId(TID.card, "amd_1"))).toBeNull();
    expect(screen.queryByTestId(TID.expiry)).toBeNull();
    expect(screen.queryByTestId(TID.approve)).toBeNull();
    expect(screen.queryByTestId(TID.reject)).toBeNull();
    expect(screen.queryByTestId(TID.propose)).toBeNull();
    expect(
      screen.getByText(
        /an unanswered proposal simply expires, with no penalty/,
      ),
    ).toBeTruthy();
    view.unmount();
  });

  it("stale location: the card is readable but only the SERVER's parked ack unlocks approve/reject", async () => {
    const wire = serve();
    const view = harness(); // default motion: stale_location
    const card = await screen.findByTestId(dynamicTestId(TID.card, "amd_1"));
    expect(card).toBeTruthy();
    expect(screen.queryByTestId(TID.approve)).toBeNull();
    fireEvent.press(screen.getByTestId(TID.parked));
    expect(await screen.findByTestId(TID.approve)).toBeTruthy();
    expect(screen.getByTestId(TID.reject)).toBeTruthy();
    expect(screen.getByTestId(TID.noPenalty)).toHaveTextContent(
      "Rejecting carries no penalty. The original agreement stays in force.",
      { exact: false },
    );
    expect(wire.writes().map((c) => c.path)).toEqual(["/v1/mp/driver/parked"]);
    view.unmount();
  });

  it("renders the server's figures and approves with the exact revisions + Idempotency-Key", async () => {
    const wire = serve({
      [APPROVE_PATH]: () => ({
        status: 200,
        json: amendment({
          approvals: {
            rider: { approved: true, approvedAt: isoIn(-20_000) },
            driver: { approved: true, approvedAt: isoIn(0) },
          },
          state: "committed",
          riderFunding: "committed",
          resolvedAt: isoIn(0),
        }),
      }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    await screen.findByTestId(dynamicTestId(TID.card, "amd_1"));
    expect(screen.getByTestId(TID.original)).toHaveTextContent(
      "Lekki Phase 1 → Ikoyi pharmacy → Obalende → Victoria Island",
      { exact: false },
    );
    expect(screen.getByTestId(TID.proposed)).toHaveTextContent(
      "Lekki Phase 1 → Ikoyi pharmacy → Falomo mall → Obalende → Victoria Island",
      { exact: false },
    );
    expect(screen.getByTestId(TID.addedDistance)).toHaveTextContent("+3.1 km", {
      exact: false,
    });
    expect(screen.getByTestId(TID.addedTime)).toHaveTextContent("+6 min", {
      exact: false,
    });
    expect(screen.getByTestId(TID.revisedTotal)).toHaveTextContent("₦6,750", {
      exact: false,
    });
    expect(screen.getByTestId(TID.fareDelta)).toHaveTextContent("+₦750", {
      exact: false,
    });
    expect(screen.getByTestId(TID.commissionDelta)).toHaveTextContent("+₦75", {
      exact: false,
    });
    expect(screen.getByTestId(TID.netChange)).toHaveTextContent("+₦675", {
      exact: false,
    });
    expect(screen.getByTestId(TID.riderFunding)).toHaveTextContent(
      /Reserved from the rider.*\+₦750/,
    );
    expect(screen.getByText(/Only the extra 10% on the increase/)).toBeTruthy();
    expect(screen.getByTestId(TID.expiry)).toHaveTextContent(
      /^Expires in 1:[0-3]\d$/,
    );

    fireEvent.press(screen.getByTestId(TID.approve));
    expect(await screen.findByText("You approved the change")).toBeTruthy();
    const [approve] = wire.writes();
    expect(approve.method).toBe("POST");
    expect(approve.path).toBe(APPROVE_PATH);
    expect(approve.body).toEqual({ routeRevision: 2, fareRevision: 2 });
    keyOf(approve);
    expect(
      screen.getByText(
        "Both of you approved — the new route and fare are in force.",
      ),
    ).toBeTruthy();
    view.unmount();
  });

  it("rejects with the exact POST and says there is no penalty", async () => {
    const wire = serve({
      [REJECT_PATH]: () => ({
        status: 200,
        json: amendment({
          state: "rejected",
          reason: "driver_rejected",
          riderFunding: "released",
          resolvedAt: isoIn(0),
        }),
      }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(TID.reject));
    expect(await screen.findByText("Change rejected")).toBeTruthy();
    const [reject] = wire.writes();
    expect(reject.path).toBe(REJECT_PATH);
    expect(reject.body).toEqual({ routeRevision: 2, fareRevision: 2 });
    keyOf(reject);
    expect(
      await screen.findByText(
        "You declined. No penalty — the original agreement stayed in force.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId(TID.approve)).toBeNull();
    view.unmount();
  });

  it("an approval the commit could not apply (200 with a closed amendment) is never reported as applied", async () => {
    serve({
      [APPROVE_PATH]: () => ({
        status: 200,
        json: amendment({
          approvals: {
            rider: { approved: true, approvedAt: isoIn(-20_000) },
            driver: { approved: true, approvedAt: isoIn(0) },
          },
          state: "rejected",
          reason: "insufficient_rider_funds",
          riderFunding: "released",
          resolvedAt: isoIn(0),
        }),
      }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(TID.approve));
    expect(await screen.findByText("The change didn’t go ahead")).toBeTruthy();
    expect(screen.getByTestId(TID.refusal)).toHaveTextContent(
      "Declined: the rider’s funds couldn’t cover the higher fare. Nothing was charged.",
      { exact: false },
    );
    expect(screen.queryByText("You approved the change")).toBeNull();
    view.unmount();
  });

  it("renders refusals in plain words: next_job_conflict", async () => {
    serve({
      [APPROVE_PATH]: () => ({
        status: 409,
        json: {
          code: "conflict",
          message:
            "this change would break the pickup window promised to the driver's next rider",
          details: { reason: "next_job_conflict", amendmentId: "amd_1" },
        },
      }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(TID.approve));
    expect(
      await screen.findByText("This would break your next job"),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.refusal)).toHaveTextContent(
      /Nothing was held and this trip continues as agreed/,
    );
    view.unmount();
  });

  it("a NOT_STATIONARY refusal pauses the controls until the driver re-attests", async () => {
    serve({
      [APPROVE_PATH]: () => ({
        status: 403,
        json: {
          code: "driver_ineligible",
          message: "park safely before approving a change to the trip",
          details: { reason: "NOT_STATIONARY", amendmentId: "amd_1" },
        },
      }),
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(TID.approve));
    expect(await screen.findByText("Stop safely first")).toBeTruthy();
    expect(currentMotion()).toBe("stale_location");
    expect(screen.queryByTestId(TID.approve)).toBeNull();
    expect(screen.getByTestId(TID.parked)).toBeTruthy();
    view.unmount();
  });

  it("an offline approval keeps its Idempotency-Key for the retry", async () => {
    let attempts = 0;
    const wire = serve({
      [APPROVE_PATH]: () => {
        attempts += 1;
        if (attempts === 1) return "offline";
        return {
          status: 200,
          json: amendment({
            approvals: {
              rider: { approved: false },
              driver: { approved: true, approvedAt: isoIn(0) },
            },
          }),
        };
      },
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(TID.approve));
    expect(await screen.findByText("You’re offline")).toBeTruthy();
    fireEvent.press(screen.getByTestId(TID.approve));
    expect(await screen.findByText("You approved the change")).toBeTruthy();
    const [first, retry] = wire.writes();
    expect(keyOf(retry)).toBe(keyOf(first));
    expect(retry.body).toEqual(first.body);
    // Driver approved, rider not yet: no second approve, reject stays possible.
    await waitFor(() => expect(screen.queryByTestId(TID.approve)).toBeNull());
    expect(screen.getByTestId(TID.reject)).toBeTruthy();
    view.unmount();
  });

  it("an expired proposal offers no controls", async () => {
    serve({}, amendmentList([amendment({ expiresAt: isoIn(-1_000) })]));
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    expect(await screen.findByText("Expired — refreshing…")).toBeTruthy();
    expect(screen.queryByTestId(TID.approve)).toBeNull();
    expect(screen.queryByTestId(TID.reject)).toBeNull();
    view.unmount();
  });

  it("proposes a stop change only when parked, bound to the trip's revisions, without any amount", async () => {
    const wire = serve(
      {
        [LIST_PATH]: () => ({
          status: 201,
          json: amendment({
            amendmentId: "amd_2",
            proposedByRole: "driver",
            state: "awaiting_approvals_and_funding",
            approvals: {
              rider: { approved: false },
              driver: { approved: false },
            },
            stops: [
              {
                stopId: "stp_2",
                order: 1,
                label: "Obalende",
                lat: 6.47,
                lng: 3.43,
                purpose: "drop_passenger",
                dwellSec: 120,
              },
            ],
            revisedFareMinor: NGN(5700_00),
            fareDeltaMinor: NGN(-300_00),
            riderFundingDeltaMinor: NGN(-300_00),
            riderFunding: "release_on_commit",
            commissionDeltaMinor: NGN(-30_00),
            driverNetDeltaMinor: NGN(-270_00),
            addedDistanceMeters: -900,
            addedDurationSec: -120,
          }),
        }),
      },
      amendmentList([]),
    );
    act(() => setMotionForDev("moving"));
    const view = harness();
    expect(await screen.findByTestId(TID.stopSafely)).toBeTruthy();
    expect(screen.queryByTestId(TID.propose)).toBeNull();
    expect(screen.getByTestId(TID.empty)).toBeTruthy();

    act(() => setMotionForDev("parked_confirmed"));
    fireEvent.press(await screen.findByTestId(TID.propose));
    fireEvent.press(screen.getByTestId(TID.proposeSend)); // unchanged: disabled
    expect(wire.writes()).toEqual([]);
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.proposeRemove, "stp_1")),
    );
    fireEvent.press(screen.getByTestId(TID.proposeSend));
    expect(await screen.findByText("Proposal sent")).toBeTruthy();
    const [propose] = wire.writes();
    expect(propose.method).toBe("POST");
    expect(propose.path).toBe(LIST_PATH);
    expect(propose.body).toEqual({
      stops: [
        {
          lat: 6.47,
          lng: 3.43,
          label: "Obalende",
          purpose: "drop_passenger",
          dwellSec: 120,
        },
      ],
      expectedRouteRevision: 1,
      expectedFareRevision: 1,
    });
    keyOf(propose);
    // The server-priced decrease is now the open proposal.
    const card = await screen.findByTestId(dynamicTestId(TID.card, "amd_2"));
    expect(card).toBeTruthy();
    expect(screen.getByTestId(TID.commissionDelta)).toHaveTextContent("−₦30", {
      exact: false,
    });
    expect(
      screen.getByText(/refunded to you as a linked adjustment/),
    ).toBeTruthy();
    expect(screen.getByTestId(TID.addedDistance)).toHaveTextContent("−0.9 km", {
      exact: false,
    });
    expect(screen.queryByTestId(TID.propose)).toBeNull(); // one open change at a time
    view.unmount();
  });

  it("reorders remaining stops and renders an insufficient_spendable refusal plainly", async () => {
    const wire = serve(
      {
        [LIST_PATH]: () => ({
          status: 422,
          json: {
            code: "insufficient_spendable",
            message: "spendable 1000 < required 3000",
            details: { reason: "insufficient_driver_spendable" },
          },
        }),
      },
      amendmentList([]),
    );
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    fireEvent.press(await screen.findByTestId(TID.propose));
    fireEvent.press(
      screen.getByTestId(dynamicTestId(TID.proposeDown, "stp_1")),
    );
    fireEvent.press(screen.getByTestId(TID.proposeSend));
    expect(await screen.findByText("Not enough in your wallet")).toBeTruthy();
    const [propose] = wire.writes();
    expect(
      (propose.body as { stops: { label: string }[] }).stops.map(
        (s) => s.label,
      ),
    ).toEqual(["Obalende", "Ikoyi pharmacy"]);
    view.unmount();
  });

  it("covers the load states: loading, offline with retry and a trip whose route can no longer change", async () => {
    let offline = true;
    installWire((call) => {
      if (offline) return "offline";
      if (call.path === TRIP_PATH)
        return {
          status: 200,
          json: trip({
            terminatedAt: isoIn(-60_000),
            stops: [
              stop({
                stopId: "stp_1",
                order: 1,
                state: "skipped",
                skipReason: "trip_terminated",
              }),
            ],
          }),
        };
      if (call.path === LIST_PATH)
        return { status: 200, json: amendmentList([]) };
      return undefined;
    });
    act(() => setMotionForDev("parked_confirmed"));
    const view = harness();
    expect(screen.getAllByLabelText("Loading").length).toBeGreaterThan(0);
    expect(await screen.findByTestId(TID.offline)).toBeTruthy();
    offline = false;
    fireEvent.press(screen.getByTestId(TID.retry));
    expect(
      await screen.findByText(
        "This trip ended early, so its route can’t change.",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId(TID.propose)).toBeNull();
    expect(screen.getByTestId(TID.empty)).toBeTruthy();
    view.unmount();
  });
});
