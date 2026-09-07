/**
 * The two HTTP adapters this service talks to the rest of the platform through.
 *
 * The `fetch` they use is injected, so these tests exercise the real adapter
 * code — the URL it builds, the idempotency header it sends, the error codes it
 * maps — without a network and without a mock inside `src/`.
 */
import { describe, expect, it } from "vitest";

import { IDEMPOTENCY_HEADER, money } from "@ubi/contracts";

import { createHttpLedger, type RemedyPostingRequest } from "../src/ops/ledger-port";
import { createHttpNotifier, type SafetyAlert } from "../src/ops/notifier";

interface Call {
  url: string;
  init: RequestInit;
}

function recordingFetch(
  response: () => Response | Promise<Response>,
): { calls: Call[]; impl: typeof fetch } {
  const calls: Call[] = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const result = await response();
    return result;
  }) as typeof fetch;
  return { calls, impl };
}

const request: RemedyPostingRequest = {
  caseId: "case_abc",
  remedyId: "rem_abc",
  type: "fee_reversal",
  amount: money(30_000, "NGN"),
  cityId: "LOS",
  beneficiary: { userType: "rider", userId: "user_1" },
  subject: { type: "ride", id: "rd_1" },
  reason: "wait fee charged in error",
  idempotencyKey: "support.remedy:case_abc:agent_1:key-1234",
  actor: { id: "agent_1", role: "support_agent" },
};

describe("ledger port over HTTP", () => {
  it("sends the intent, the idempotency key and the actor headers", async () => {
    const { calls, impl } = recordingFetch(
      () =>
        new Response(
          JSON.stringify({
            entryId: "je_1",
            caseRef: "case_abc",
            lines: [
              { account: "ubi_float", amountMinor: -30_000, currency: "NGN" },
              {
                account: "wallet",
                amountMinor: 30_000,
                currency: "NGN",
                counterpartRef: "case:case_abc",
              },
            ],
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    );

    const ledger = createHttpLedger({
      baseUrl: "http://payment-service:4003/",
      fetchImpl: impl,
      serviceKey: "s3cret",
    });
    const posted = await ledger.postRemedy(request);

    expect(posted.entryId).toBe("je_1");
    expect(posted.caseRef).toBe("case_abc");
    expect(posted.lines).toHaveLength(2);
    expect(posted.lines.reduce((total, line) => total + line.amountMinor, 0)).toBe(0);

    const call = calls[0];
    expect(call?.url).toBe("http://payment-service:4003/v1/finance/remedies");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers[IDEMPOTENCY_HEADER]).toBe(request.idempotencyKey);
    expect(headers["X-City-ID"]).toBe("LOS");
    expect(headers["X-User-ID"]).toBe("agent_1");
    expect(headers["X-Service-Key"]).toBe("s3cret");

    const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      caseId: "case_abc",
      remedyId: "rem_abc",
      type: "fee_reversal",
      amountMinor: 30_000,
      currency: "NGN",
    });
    // The support service does not name accounts: that is the ledger's job.
    expect(body.account).toBeUndefined();
    expect(body.lines).toBeUndefined();
  });

  it("surfaces a refusal as service_unavailable and keeps the ledger's own code", async () => {
    const { impl } = recordingFetch(
      () =>
        new Response(JSON.stringify({ code: "insufficient_funds" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
    );
    const ledger = createHttpLedger({ baseUrl: "http://payment", fetchImpl: impl });

    const error = await ledger.postRemedy(request).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "service_unavailable",
      details: { status: 422, ledgerCode: "insufficient_funds" },
    });
  });

  it("refuses a response it cannot read rather than inventing an entry", async () => {
    const { impl } = recordingFetch(
      () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const ledger = createHttpLedger({ baseUrl: "http://payment", fetchImpl: impl });
    await expect(ledger.postRemedy(request)).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });

  it("turns a transport failure into service_unavailable", async () => {
    const impl = (async () => {
      await Promise.resolve();
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const ledger = createHttpLedger({ baseUrl: "http://payment", fetchImpl: impl });
    await expect(ledger.postRemedy(request)).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });
});

describe("safety notifier over HTTP", () => {
  const alert: SafetyAlert = {
    caseId: "sfc_1",
    severity: "critical",
    cityId: "LOS",
    audience: [{ userType: "agent", userId: "trust_and_safety_queue" }],
    emergencyNumber: "112",
    rideId: "rd_1",
  };

  it("sends the channel, the case and the city's emergency number and nothing else", async () => {
    const { calls, impl } = recordingFetch(() => new Response("", { status: 202 }));
    const notifier = createHttpNotifier({
      baseUrl: "http://notification-service:4006",
      fetchImpl: impl,
    });
    await notifier.deliver("sms", alert);

    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body).toEqual({
      channel: "sms",
      caseId: "sfc_1",
      severity: "critical",
      rideId: "rd_1",
      emergencyNumber: "112",
      audience: [{ userType: "agent", userId: "trust_and_safety_queue" }],
    });
    // The location never leaves this service through the notification pipeline.
    expect(body.location).toBeUndefined();
  });

  it("throws when the channel refuses, so the caller can fall back and retry", async () => {
    const { impl } = recordingFetch(() => new Response("", { status: 500 }));
    const notifier = createHttpNotifier({ baseUrl: "http://notif", fetchImpl: impl });
    await expect(notifier.deliver("push", alert)).rejects.toMatchObject({
      code: "service_unavailable",
      details: { channel: "push" },
    });
  });
});
