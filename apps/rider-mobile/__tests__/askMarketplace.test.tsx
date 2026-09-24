// The Ask marketplace surfaces bound to the REAL client path (recheck P01):
// the screens call askApi → @ubi/mobile-core `api()` → fetch, and the tests
// observe exactly what crosses the wire to the gateway's /v1/ask routes. Only
// the network (global fetch), navigation and analytics are stubbed.
//   1. The structured proposal renders the server's price, the driver's offer
//      and the commission on its own line — no client money math.
//   2. The real "Approve with PIN" button reaches the production execute
//      operation (POST /v1/ask/reviews/:id/confirm) carrying the proposal's
//      persisted scope fingerprint + revision + bid, and a repeated press of
//      the same approval reuses its Idempotency-Key.
//   3. An offer that can't be approved hands off to the conventional request
//      screen — never a dead end.
//   4. The execution view shows per-order outcome and "Check again" calls the
//      reconcile operation.
//   5. The mandate editor exposes marketplace.ride.select and its constraint
//      values, and saves them to /v1/mandates.
import type React from "react";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { TransactionReviewSheet } from "../src/screens/ask/TransactionReviewSheet";
import { ExecutionStatusScreen } from "../src/screens/ask/ExecutionStatusScreen";
import { MandateEditorScreen } from "../src/screens/automation/MandateEditorScreen";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockRouteParams: unknown = {};
jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockRouteParams }),
}));

jest.mock("@ubi/mobile-core", () => ({
  ...jest.requireActual("@ubi/mobile-core"),
  track: jest.fn(),
}));

const BASE = "https://api.ubi.africa";
const NGN = (minor: number) => ({ amountMinor: minor, currency: "NGN" });
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};
let calls: Call[] = [];
let routes: Record<string, (call: Call) => { status: number; json: unknown }> =
  {};

beforeEach(() => {
  calls = [];
  routes = {};
  mockNavigate.mockReset();
  mockRouteParams = {};
  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string>) },
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const handler = routes[call.method + " " + call.url.replace(BASE, "")];
    const reply = handler
      ? handler(call)
      : { status: 404, json: { code: "not_found", message: "no route" } };
    return {
      ok: reply.status < 400,
      status: reply.status,
      statusText: String(reply.status),
      text: async () => JSON.stringify(reply.json),
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

const wrap = (el: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider defaultMode="light">{el}</ThemeProvider>
    </QueryClientProvider>,
  );
};

/** The persisted structured review exactly as ask-service serves it. */
const marketplaceReview = () => ({
  id: "rvw_mp_1",
  kind: "marketplace",
  status: "awaiting_confirmation",
  termsVersion: "mp.review.v1:9f1c0d3b5a7e2c4f6a8b0d1e3f5a7c9e1b3d5f70",
  expiresAt: iso(180_000),
  items: [
    {
      kind: "mp_selection",
      title: "Select the standard offer",
      price: NGN(280_000),
      terms: [],
      offerRef: "bid_emeka",
    },
  ],
  total: NGN(280_000),
  paymentMethod: {
    id: "mp:request",
    label: "The payment method on your request",
  },
  assuranceRequired: "pin",
  notes: ["Selecting awards this driver the job."],
  marketplace: {
    stage: "select",
    action: "mp.select",
    statement: "I can't set prices or book without your OK.",
    scope: {
      fingerprint: "mp.scope.v2:0a1b2c3d4e5f60718293a4b5c6d7e8f901234567",
      actions: ["select"],
      service: "ride",
      cityId: "LOS",
      cap: NGN(280_000),
      vehicleClass: "standard",
      quoteId: "q_mp_1",
    },
    price: NGN(280_000),
    awardsNothing: false,
    selection: {
      requestId: "req_mp_1",
      requestRevision: 2,
      requestVersion: 4,
      bidId: "bid_emeka",
      bidVersion: 1,
      bidAmount: NGN(280_000),
      offerExpiresAt: iso(180_000),
      vehicle: "standard",
      driverRating: "4.9",
      driverProfileStatus: "verified",
      commission: {
        payer: "driver",
        addedToYourPrice: false,
        amount: null,
        note: "The driver pays UBI's commission out of this fare. It is not added to your price.",
      },
    },
    conventionalFlow: "ubi://marketplace/requests/req_mp_1",
  },
});

async function approveWithPin(proof = "4321"): Promise<void> {
  fireEvent.press(screen.getByTestId("ask.mpReview.approve"));
  const secure = mockNavigate.mock.calls.find((c) => c[0] === "SecureConfirm");
  expect(secure).toBeDefined();
  // SecureConfirm hands the proof back exactly as the real screen does.
  await act(async () => {
    await (secure?.[1] as { onProof: (p: string) => Promise<void> }).onProof(
      proof,
    );
  });
}

describe("the structured marketplace proposal", () => {
  it("renders the server's price, offer and a separate driver commission", async () => {
    routes["GET /v1/ask/reviews/rvw_mp_1"] = () => ({
      status: 200,
      json: marketplaceReview(),
    });
    wrap(
      <TransactionReviewSheet
        reviewId="rvw_mp_1"
        onDismiss={jest.fn()}
        onExecuting={jest.fn()}
      />,
    );
    await screen.findByTestId("ask.mpReview.body");
    expect(
      screen.getByText("I can't set prices or book without your OK."),
    ).toBeTruthy();
    // The server's integer minor units, formatted — never re-computed.
    expect(screen.getByTestId("ask.mpReview.price").props.children).toBe(
      "₦2,800",
    );
    expect(screen.getByTestId("ask.mpReview.commission")).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it("the real Approve button calls the execute operation with the persisted scope and revision", async () => {
    routes["GET /v1/ask/reviews/rvw_mp_1"] = () => ({
      status: 200,
      json: marketplaceReview(),
    });
    routes["POST /v1/ask/reviews/rvw_mp_1/confirm"] = () => ({
      status: 202,
      json: { executionId: "exec_mp_1" },
    });
    const onExecuting = jest.fn();
    wrap(
      <TransactionReviewSheet
        reviewId="rvw_mp_1"
        onDismiss={jest.fn()}
        onExecuting={onExecuting}
      />,
    );
    await screen.findByTestId("ask.mpReview.approve");
    await approveWithPin("4321");

    const confirms = calls.filter((c) => c.url.endsWith("/confirm"));
    expect(confirms).toHaveLength(1);
    const [confirm] = confirms;
    expect(confirm?.method).toBe("POST");
    expect(confirm?.url).toBe(BASE + "/v1/ask/reviews/rvw_mp_1/confirm");
    expect(confirm?.body).toEqual({
      termsVersion: marketplaceReview().termsVersion,
      assurance: { method: "pin", proof: "4321" },
      expect: {
        scopeFingerprint: marketplaceReview().marketplace.scope.fingerprint,
        requestRevision: 2,
        bidId: "bid_emeka",
      },
    });
    expect(confirm?.headers["Idempotency-Key"]).toMatch(/^ask_confirm_/);
    await waitFor(() => expect(onExecuting).toHaveBeenCalledWith("exec_mp_1"));
  });

  it("hands off, never dead-ends, when the assistant cannot finish", async () => {
    routes["GET /v1/ask/reviews/rvw_mp_1"] = () => ({
      status: 200,
      json: marketplaceReview(),
    });
    routes["POST /v1/ask/reviews/rvw_mp_1/confirm"] = () => ({
      status: 503,
      json: { code: "service_unavailable", message: "unavailable" },
    });
    const onExecuting = jest.fn();
    wrap(
      <TransactionReviewSheet
        reviewId="rvw_mp_1"
        onDismiss={jest.fn()}
        onExecuting={onExecuting}
      />,
    );
    await screen.findByTestId("ask.mpReview.approve");
    await approveWithPin();
    fireEvent.press(await screen.findByTestId("ask.review.handoff"));
    // The review's own conventional flow: the request's offers screen.
    expect(mockNavigate).toHaveBeenCalledWith("Marketplace", {
      screen: "Offers",
      params: { requestId: "req_mp_1" },
    });
    expect(onExecuting).not.toHaveBeenCalled();
  });

  it("a successful approval hands the execution id over, once", async () => {
    routes["GET /v1/ask/reviews/rvw_mp_1"] = () => ({
      status: 200,
      json: marketplaceReview(),
    });
    routes["POST /v1/ask/reviews/rvw_mp_1/confirm"] = () => ({
      status: 202,
      json: { executionId: "exec_mp_1" },
    });
    const onExecuting = jest.fn();
    wrap(
      <TransactionReviewSheet
        reviewId="rvw_mp_1"
        onDismiss={jest.fn()}
        onExecuting={onExecuting}
      />,
    );
    await screen.findByTestId("ask.mpReview.approve");
    await approveWithPin("1234");
    await waitFor(() => expect(onExecuting).toHaveBeenCalledWith("exec_mp_1"));

    // Pressing approve again (a double tap) reuses the same idempotency key.
    mockNavigate.mockReset();
    await approveWithPin("1234");
    const keys = calls
      .filter((c) => c.url.endsWith("/confirm"))
      .map((c) => c.headers["Idempotency-Key"]);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("hands off to the conventional offers screen when the offer is gone", async () => {
    routes["GET /v1/ask/reviews/rvw_mp_1"] = () => ({
      status: 200,
      json: marketplaceReview(),
    });
    routes["POST /v1/ask/reviews/rvw_mp_1/confirm"] = () => ({
      status: 409,
      json: {
        code: "conflict",
        message: "that offer has been withdrawn",
        details: {
          reason: "offer_withdrawn",
          conventionalFlow: "ubi://marketplace/requests/req_mp_1",
        },
      },
    });
    const onDismiss = jest.fn();
    wrap(
      <TransactionReviewSheet
        reviewId="rvw_mp_1"
        onDismiss={onDismiss}
        onExecuting={jest.fn()}
      />,
    );
    await screen.findByTestId("ask.mpReview.approve");
    await approveWithPin();
    fireEvent.press(await screen.findByTestId("ask.review.handoff"));
    expect(mockNavigate).toHaveBeenCalledWith("Marketplace", {
      screen: "Offers",
      params: { requestId: "req_mp_1" },
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("never claims nothing was selected when the outcome is unknown (504)", async () => {
    routes["GET /v1/ask/reviews/rvw_mp_1"] = () => ({
      status: 200,
      json: marketplaceReview(),
    });
    routes["POST /v1/ask/reviews/rvw_mp_1/confirm"] = () => ({
      status: 504,
      json: { code: "GATEWAY_TIMEOUT", message: "took too long" },
    });
    wrap(
      <TransactionReviewSheet
        reviewId="rvw_mp_1"
        onDismiss={jest.fn()}
        onExecuting={jest.fn()}
      />,
    );
    await screen.findByTestId("ask.mpReview.approve");
    await approveWithPin();
    await screen.findByTestId("ask.review.notice");
    expect(screen.queryByText(/Nothing was selected/)).toBeNull();
    expect(screen.getByText(/couldn't confirm the result/)).toBeTruthy();
    fireEvent.press(screen.getByTestId("ask.review.handoff"));
    // The review's own request screen shows the real outcome.
    expect(mockNavigate).toHaveBeenCalledWith("Marketplace", {
      screen: "Offers",
      params: { requestId: "req_mp_1" },
    });
  });

  it("shows the fresh terms when the offer changed (409 with a new review)", async () => {
    const fresh = {
      ...marketplaceReview(),
      id: "rvw_mp_2",
      total: NGN(300_000),
      marketplace: {
        ...marketplaceReview().marketplace,
        price: NGN(300_000),
      },
    };
    routes["GET /v1/ask/reviews/rvw_mp_1"] = () => ({
      status: 200,
      json: marketplaceReview(),
    });
    routes["GET /v1/ask/reviews/rvw_mp_2"] = () => ({
      status: 200,
      json: fresh,
    });
    routes["POST /v1/ask/reviews/rvw_mp_1/confirm"] = () => ({
      status: 409,
      json: fresh,
    });
    wrap(
      <TransactionReviewSheet
        reviewId="rvw_mp_1"
        onDismiss={jest.fn()}
        onExecuting={jest.fn()}
      />,
    );
    await screen.findByTestId("ask.mpReview.approve");
    await approveWithPin();
    await waitFor(() =>
      expect(screen.getByTestId("ask.mpReview.price").props.children).toBe(
        "₦3,000",
      ),
    );
    expect(screen.getByTestId("ask.review.notice")).toBeTruthy();
  });
});

describe("the marketplace execution status", () => {
  const pending = {
    id: "exec_mp_1",
    status: "processing",
    startedAt: new Date().toISOString(),
    items: [
      {
        kind: "mp_selection",
        title: "Select the standard offer",
        state: "unknown_reconciling",
        orderId: "req_mp_1",
        detail: "We could not confirm the result yet.",
      },
    ],
    marketplace: {
      stage: "select",
      requestId: "req_mp_1",
      intent: { status: "pending", attempts: 1, awardId: null },
      reconcilable: true,
      conventionalFlow: "ubi://marketplace/requests/req_mp_1",
    },
  };

  it("shows per-order outcome and reconciles through the same execution", async () => {
    mockRouteParams = { executionId: "exec_mp_1" };
    routes["GET /v1/ask/executions/exec_mp_1"] = () => ({
      status: 200,
      json: pending,
    });
    routes["POST /v1/ask/executions/exec_mp_1/reconcile"] = () => ({
      status: 200,
      json: {
        ...pending,
        status: "confirmed",
        items: [
          {
            ...pending.items[0],
            state: "driver_confirmed",
            supplierRef: "awd_1",
            fare: NGN(280_000),
            commission: NGN(28_000),
          },
        ],
        marketplace: {
          ...pending.marketplace,
          intent: { status: "awarded", attempts: 1, awardId: "awd_1" },
          reconcilable: false,
        },
      },
    });
    wrap(<ExecutionStatusScreen />);
    expect(await screen.findByText("Checking the result")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId("ask.mpStatus.checkAgain"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("ask.mpStatus.itemState").props.children).toBe(
        "Driver confirmed",
      ),
    );
    const reconcile = calls.find((c) => c.url.endsWith("/reconcile"));
    expect(reconcile?.method).toBe("POST");
    expect(reconcile?.headers["Idempotency-Key"]).toBeTruthy();
    // The driver's commission is its own line, as the server reported it.
    expect(
      screen.getByText("Driver's commission (paid by the driver)"),
    ).toBeTruthy();
    expect(screen.queryByTestId("ask.mpStatus.checkAgain")).toBeNull();

    fireEvent.press(screen.getByTestId("ask.mpStatus.openRequest"));
    expect(mockNavigate).toHaveBeenCalledWith("Marketplace", {
      screen: "Offers",
      params: { requestId: "req_mp_1" },
    });
  });
});

describe("the mandate editor", () => {
  it("exposes marketplace.ride.select and saves its constraint values", async () => {
    mockRouteParams = {};
    routes["POST /v1/mandates"] = (call) => ({
      status: 201,
      json: {
        success: true,
        data: { mandate: { ...(call.body as object), id: "mnd_1" } },
      },
    });
    wrap(<MandateEditorScreen />);
    fireEvent.press(
      screen.getByTestId("mandates.edit.action.marketplace_ride_select"),
    );
    expect(screen.getByText("Only these vehicle classes")).toBeTruthy();
    expect(screen.getByText("Only between (city time)")).toBeTruthy();

    // An unreadable window blocks saving.
    fireEvent(screen.getByTestId("mandates.edit.timeWindow"), "endEditing", {
      nativeEvent: { text: "7am-10am" },
    });
    fireEvent.press(screen.getByTestId("mandates.edit.savePin"));
    expect(
      mockNavigate.mock.calls.find((c) => c[0] === "SecureConfirm"),
    ).toBeUndefined();

    fireEvent(screen.getByTestId("mandates.edit.timeWindow"), "endEditing", {
      nativeEvent: { text: "06:30-09:30" },
    });
    fireEvent.press(screen.getByTestId("mandates.edit.class.comfort"));
    fireEvent.press(screen.getByTestId("mandates.edit.savePin"));
    const secure = mockNavigate.mock.calls.find(
      (c) => c[0] === "SecureConfirm",
    );
    await act(async () => {
      await (secure?.[1] as { onProof: (p: string) => Promise<void> }).onProof(
        "4321",
      );
    });

    const saved = calls.find((c) => c.url === BASE + "/v1/mandates");
    expect(saved?.method).toBe("POST");
    expect(saved?.body).toMatchObject({
      action: "marketplace.ride.select",
      categories: ["standard", "comfort"],
      constraints: expect.arrayContaining([
        expect.objectContaining({
          key: "vehicle_class",
          values: ["standard", "comfort"],
        }),
        expect.objectContaining({
          key: "time_window",
          values: ["06:30-09:30"],
        }),
      ]),
      assurance: { method: "pin", proof: "4321" },
    });
  });
});
