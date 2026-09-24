/**
 * A 403 from travel-service is a PERMISSION refusal the assistant can
 * explain — never `service_unavailable` (round 8).
 *
 * travel-service re-checks the gateway's scopes on the relayed context
 * (services/travel-service/src/middleware/scopes.ts): every travel write
 * needs `travel:book` and is refused in limited mode, and a declared city
 * that disagrees with the signed one is refused on every route
 * (middleware/auth.ts). Those refusals arrive as 403 with travel-service's
 * `{code, message, details}` body. Before this, the port reported every
 * non-2xx that was not a 401 as "travel search is not available right now" —
 * so a user on an unverified device was told the service was down.
 *
 * The travel end here answers exactly the bodies travel-service builds
 * (ContractError(...).toBody() with the same codes and details); the REAL
 * travel-service producing them for the REAL port is pinned in
 * services/travel-service/tests/ask-travel-relay.test.ts.
 */
import { describe, expect, it } from "vitest";

import { ContractError } from "@ubi/contracts";

import { createHttpTravelPort } from "../src/ports/travel-port";

import type { Actor } from "../src/ops/types";

const actor: Actor = { id: "rider_refusals_1", role: "rider" };

/** An offer reference as a travel search hands it out: `<searchId>.<offerKey>`. */
const OFFER_REF = "tsr_refusals0000001.of_0123456789ab";

/** One reviewed flight item, as runExecution books it. */
function bookInput(idempotencyKey: string) {
  return {
    grantId: "grant_1",
    offerRef: OFFER_REF,
    idempotencyKey,
    paymentMethodId: "pm_wallet",
    kind: "flight" as const,
    priceMinor: 14_850_000,
    currency: "NGN",
    travellers: [
      {
        givenNames: "Ada",
        surname: "Obi",
        dateOfBirth: "1990-04-21",
        phone: "+2348030000001",
      },
    ],
    purchase: {
      kind: "flight" as const,
      offerRef: "AP-P4-7120",
      fareFamilyId: "saver",
    },
  };
}

/** A travel end that answers every request with `status` and `body`. */
function travelAnswering(status: number, body: unknown) {
  const calls: string[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return {
    calls,
    port: createHttpTravelPort({
      baseUrl: "http://travel-service.internal",
      fetchImpl,
    }),
  };
}

async function refusal(work: Promise<unknown>): Promise<ContractError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ContractError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to be refused");
}

const LIMITED = new ContractError(
  "limited_mode",
  "This device is not verified yet. Finish the security check to book, cancel or change travel.",
  { modes: ["limited"], required: ["travel:book"] },
).toBody();

const NO_BOOK_SCOPE = new ContractError(
  "forbidden",
  "This action is not available for your account type",
  { required: ["travel:book"] },
).toBody();

const CITY_MISMATCH = new ContractError(
  "forbidden",
  "the declared city does not match the signed-in city",
  { reason: "city_mismatch" },
).toBody();

describe("travel-service's 403 is a permission refusal", () => {
  it("limited mode: the user can finish the security check — nothing was booked", async () => {
    const travel = travelAnswering(403, LIMITED);
    const error = await refusal(
      travel.port.book(actor, bookInput("exec_1:0:" + OFFER_REF)),
    );
    expect(error.code).toBe("limited_mode");
    expect(error.status).toBe(403);
    expect(error.details).toEqual({
      reason: "limited_mode",
      required: ["travel:book"],
    });
    expect(error.message).toContain("limited mode");
    expect(error.message).toContain("security check");
    expect(error.message).toContain("Nothing was booked");
    // Refused at the first write — pricing the cart — before any checkout.
    expect(travel.calls).toEqual(["POST /v1/travel/carts"]);
  });

  it("a session without travel:book is told so, on searches and bookings alike", async () => {
    for (const work of [
      (port: ReturnType<typeof travelAnswering>["port"]) =>
        port.searchFlights(
          actor,
          {
            origin: "LOS",
            destination: "ABV",
            departDate: "2026-10-01",
            passengers: 1,
          },
          5,
        ),
      (port: ReturnType<typeof travelAnswering>["port"]) =>
        port.book(actor, bookInput("exec_2:0:" + OFFER_REF)),
    ]) {
      const travel = travelAnswering(403, NO_BOOK_SCOPE);
      const error = await refusal(work(travel.port));
      expect(error.code).toBe("forbidden");
      expect(error.details).toEqual({
        reason: "scope_missing",
        required: ["travel:book"],
      });
      expect(error.message).toContain("not allowed to book travel");
    }
  });

  it("a city the session is not in, and an unreadable 403, are still refusals", async () => {
    const mismatch = await refusal(
      travelAnswering(403, CITY_MISMATCH).port.bookingStatus(actor, "tord_1"),
    );
    expect(mismatch.code).toBe("forbidden");
    expect(mismatch.details).toEqual({ reason: "city_mismatch" });

    const unreadable = await refusal(
      travelAnswering(403, "<html>forbidden</html>").port.resolveOffer(
        actor,
        OFFER_REF,
      ),
    );
    expect(unreadable.code).toBe("forbidden");
    expect(unreadable.details).toEqual({ reason: "travel_refused" });
  });

  it("never passes upstream text through to the model, and outages stay outages", async () => {
    const leaky = new ContractError(
      "forbidden",
      "call +2348000000000 for help",
      { required: ["travel:book"] },
    ).toBody();
    const error = await refusal(
      travelAnswering(403, leaky).port.bookingStatus(actor, "tord_1"),
    );
    expect(error.message).not.toContain("2348000000000");

    const outage = await refusal(
      travelAnswering(503, {
        code: "service_unavailable",
        message: "down",
      }).port.bookingStatus(actor, "tord_1"),
    );
    expect(outage.code).toBe("service_unavailable");

    const expired = await refusal(
      travelAnswering(401, {
        code: "unauthorized",
        message: "expired",
      }).port.bookingStatus(actor, "tord_1"),
    );
    expect(expired.code).toBe("unauthorized");
  });
});
