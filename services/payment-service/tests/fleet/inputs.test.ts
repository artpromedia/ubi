/**
 * INTERNAL CONTRACT B — payment-service's consumer of fleet-service's
 * settlement inputs, over real HTTP against a faithful double
 * (tests/fleet/fixtures.ts). Both sides test against the same text: the
 * transcribed example parses with this service's schema AND with the shared
 * contract's (packages/contracts/src/fleet.ts). The consumer fails closed:
 * no key or a short key never sends a request, and a wrong key, an outage or
 * a body that is not exactly the contract settles nothing.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- this suite sets FLEET_SERVICE_URL / FLEET_PAYMENT_SERVICE_KEY on purpose */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  clientFor,
  exampleInputs,
  FLEET_KEY,
  FleetServiceDouble,
  item,
  weekOf,
} from "./fixtures";
import { SettlementInputsResponseSchema as ContractSchema } from "../../../../packages/contracts/src/fleet";
import {
  assertInputsEnvelope,
  httpSettlementInputsClient,
  inputsConfigFromEnv,
  itemProblem,
  parseInputs,
  SettlementInputsResponseSchema,
} from "../../src/fleet/inputs";

const double = new FleetServiceDouble();
let baseUrl = "";

beforeAll(async () => {
  baseUrl = await double.start();
});

afterAll(async () => {
  await double.stop();
});

async function refusalOf(promise: Promise<unknown>): Promise<{
  code?: string;
  details?: Record<string, unknown>;
}> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; details?: Record<string, unknown> };
  }
  throw new Error("expected a refusal");
}

describe("the contract text", () => {
  it("parses the transcribed example with this service's schema and the shared contract's", () => {
    const example = exampleInputs();
    const mine = SettlementInputsResponseSchema.parse(example);
    const shared = ContractSchema.parse(example);
    expect(mine.items[0]).toEqual({
      assignmentId: "asg_1",
      fleetId: "flt_1",
      driverId: "drv_1",
      vehicleId: "veh_1",
      termsVersion: 3,
      terms: {
        type: "weekly_fixed",
        amountMinor: 2_500_000,
        currency: "NGN",
        percent: null,
        shortfall: { policy: "carry_forward", maxWeeks: 4 },
      },
      shiftHoursInWeek: 60,
      plannedMaintenanceHoursInWeek: 12,
      unplannedOffRoadHoursInWeek: 0,
      activeFrom: "2026-09-21T00:00:00Z",
      activeTo: null,
    });
    expect(shared.items[0]).toEqual(mine.items[0]);
    expect({ ...mine, items: [] }).toEqual({ ...shared, items: [] });
    expect(itemProblem(mine.items[0]!, "NGN")).toBeNull();
  });

  it("refuses a body that is not exactly the contract", () => {
    const example = exampleInputs();
    for (const broken of [
      { ...example, items: [{ ...example.items[0], shiftHoursInWeek: -1 }] },
      {
        ...example,
        items: [
          {
            ...example.items[0],
            terms: { ...example.items[0]!.terms, type: "per_trip" },
          },
        ],
      },
      { ...example, items: [{ ...example.items[0], activeTo: "yesterday" }] },
      { ...example, weekStart: "21/09/2026" },
    ]) {
      let code: string | undefined;
      try {
        parseInputs(broken);
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).toBe("service_unavailable");
    }
  });
});

describe("the HTTP consumer against the double", () => {
  it("presents the key, sends weekStart and cityId, and answers the contract", async () => {
    double.setWeek("city_contract_b", exampleInputs());
    const inputs = await clientFor(baseUrl).fetchInputs(
      "city_contract_b",
      "2026-09-21",
    );
    expect(inputs.items).toHaveLength(1);
    expect(inputs.items[0]?.assignmentId).toBe("asg_1");
    expect(double.requests.at(-1)).toEqual({
      cityId: "city_contract_b",
      weekStart: "2026-09-21",
    });
  });

  it("fails closed on a wrong key (the double refuses it)", async () => {
    const rejectedBefore = double.rejected;
    const refused = await refusalOf(
      clientFor(baseUrl, "not-the-fleet-key-but-long-enough-0000").fetchInputs(
        "city_contract_b",
        "2026-09-21",
      ),
    );
    expect(refused.code).toBe("service_unavailable");
    expect(refused.details?.reason).toBe("fleet_inputs_refused");
    expect(double.rejected).toBe(rejectedBefore + 1);
  });

  it("never sends a request with no key or a key shorter than 32 characters", async () => {
    const sentBefore = double.requests.length + double.rejected;
    const short = await refusalOf(
      clientFor(baseUrl, "short-key").fetchInputs("c", "2026-09-21"),
    );
    expect(short.code).toBe("service_unavailable");
    expect(short.details?.reason).toBe("fleet_inputs_unconfigured");

    const savedUrl = process.env.FLEET_SERVICE_URL;
    const savedKey = process.env.FLEET_PAYMENT_SERVICE_KEY;
    try {
      process.env.FLEET_SERVICE_URL = baseUrl;
      delete process.env.FLEET_PAYMENT_SERVICE_KEY;
      expect(() => inputsConfigFromEnv()).toThrow(/unavailable/);
      const unset = await refusalOf(
        httpSettlementInputsClient().fetchInputs("c", "2026-09-21"),
      );
      expect(unset.details?.reason).toBe("fleet_inputs_unconfigured");
      process.env.FLEET_PAYMENT_SERVICE_KEY = FLEET_KEY;
      delete process.env.FLEET_SERVICE_URL;
      expect(() => inputsConfigFromEnv()).toThrow(/unavailable/);
    } finally {
      if (savedUrl === undefined) {
        delete process.env.FLEET_SERVICE_URL;
      } else {
        process.env.FLEET_SERVICE_URL = savedUrl;
      }
      if (savedKey === undefined) {
        delete process.env.FLEET_PAYMENT_SERVICE_KEY;
      } else {
        process.env.FLEET_PAYMENT_SERVICE_KEY = savedKey;
      }
    }
    expect(double.requests.length + double.rejected).toBe(sentBefore);
  });

  it("refuses an outage and a malformed answer", async () => {
    double.failWith = 503;
    try {
      const outage = await refusalOf(
        clientFor(baseUrl).fetchInputs("city_x", "2026-09-21"),
      );
      expect(outage.details).toMatchObject({
        reason: "fleet_inputs_refused",
        status: 503,
      });
    } finally {
      double.failWith = null;
    }
    double.rawBody = JSON.stringify({ weekStart: "2026-09-21", items: "no" });
    try {
      const garbage = await refusalOf(
        clientFor(baseUrl).fetchInputs("city_x", "2026-09-21"),
      );
      expect(garbage.details?.reason).toBe("fleet_inputs_invalid");
    } finally {
      double.rawBody = null;
    }
  });

  it("never follows a redirect, so the key is never re-sent elsewhere", async () => {
    const elsewhere = new FleetServiceDouble();
    const elsewhereUrl = await elsewhere.start();
    double.redirectTo = elsewhereUrl;
    try {
      const redirected = await refusalOf(
        clientFor(baseUrl).fetchInputs("city_x", "2026-09-21"),
      );
      expect(redirected.code).toBe("service_unavailable");
      expect(redirected.details?.reason).toBe("fleet_inputs_unreachable");
      expect(elsewhere.requests.length + elsewhere.rejected).toBe(0);
    } finally {
      double.redirectTo = null;
      await elsewhere.stop();
    }
  });

  it("refuses to ask for a week that is not named by its Monday", async () => {
    const refused = await refusalOf(
      clientFor(baseUrl).fetchInputs("city_x", "2026-09-22"),
    );
    expect(refused.code).toBe("validation_failed");
  });
});

describe("the envelope must be the week asked for, in the city's zone", () => {
  const expected = { weekStart: "2026-09-21", timezone: "Africa/Lagos" };

  it("accepts the example", () => {
    expect(() => assertInputsEnvelope(exampleInputs(), expected)).not.toThrow();
  });

  it("refuses another week, a wrong week end, another zone and a duplicated assignment", () => {
    const one = item({ assignmentId: "asg_dup" });
    for (const [inputs, reason] of [
      [weekOf("2026-09-14", []), "fleet_inputs_wrong_week"],
      [
        { ...weekOf("2026-09-21", []), weekEnd: "2026-09-28" },
        "fleet_inputs_wrong_week_end",
      ],
      [
        { ...weekOf("2026-09-21", []), zone: "Africa/Nairobi" },
        "fleet_inputs_zone_mismatch",
      ],
      [weekOf("2026-09-21", [one, one]), "fleet_inputs_duplicate_assignment"],
    ] as const) {
      let details: Record<string, unknown> | undefined;
      try {
        assertInputsEnvelope(inputs, expected);
      } catch (error) {
        details = (error as { details?: Record<string, unknown> }).details;
      }
      expect(details?.reason).toBe(reason);
    }
  });

  it("flags an item this service cannot settle, without refusing the week", () => {
    expect(itemProblem(item({ currency: "KES" }), "NGN")?.reason).toBe(
      "currency_mismatch",
    );
    expect(itemProblem(item({ fleetId: "flt:1" }), "NGN")?.reason).toBe(
      "invalid_identifier",
    );
    expect(
      itemProblem(item({ type: "weekly_fixed", percent: 10 }), "NGN")?.reason,
    ).toBe("terms_invalid");
    expect(
      itemProblem(item({ type: "percent_of_net", percent: 12.345 }), "NGN")
        ?.reason,
    ).toBe("terms_invalid");
    expect(itemProblem(item({ shift: 10.123 }), "NGN")?.reason).toBe(
      "hours_invalid",
    );
    expect(
      itemProblem(
        item({
          activeFrom: "2026-09-22T00:00:00Z",
          activeTo: "2026-09-21T00:00:00Z",
        }),
        "NGN",
      )?.reason,
    ).toBe("active_window_invalid");
  });
});
