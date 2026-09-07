import { afterAll, describe, expect, it } from "vitest";

import { createRemedyRoutes } from "../../src/finance/remedies";
import { closeTestDb, makeDeps, seedCity, seedUser, testDb, uid } from "../ledger/helpers";

const db = testDb();
const deps = makeDeps(db);
const app = createRemedyRoutes(deps);

const INTERNAL_KEY = "remedy-test-internal-key";
process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;

afterAll(async () => {
  await closeTestDb();
});

interface RemedyView {
  entryId: string;
  caseRef: string | null;
  lines: { account: string; amountMinor: number; currency: string; counterpartRef: string | null }[];
  replayed: boolean;
}

async function post(body: unknown, idempotencyKey: string): Promise<Response> {
  return app.request("/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      // This endpoint is service-to-service only.
      "x-service-key": INTERNAL_KEY,
    },
    body: JSON.stringify(body),
  });
}

async function remedyBody(overrides: Record<string, unknown> = {}) {
  const city = await seedCity(db, { currency: "NGN" });
  const user = await seedUser(db, "Adaeze");
  return {
    caseId: uid("case"),
    remedyId: uid("rem"),
    type: "fee_reversal",
    amountMinor: 50_000,
    currency: "NGN",
    cityId: city.cityId,
    beneficiary: { userType: "user", userId: user.id },
    subject: { type: "ride", id: "rd_314" },
    reason: "fee charged on a ride the driver cancelled",
    ...overrides,
  };
}

describe("posting a support remedy", () => {
  it("credits the beneficiary and draws the fee reversal from commission", async () => {
    const body = await remedyBody();
    const response = await post(body, uid("idem"));
    expect(response.status).toBe(201);

    const view = (await response.json()) as RemedyView;
    expect(view.caseRef).toBe(body.caseId);
    expect(view.replayed).toBe(false);

    const total = view.lines.reduce((sum, line) => sum + line.amountMinor, 0);
    expect(total, "a remedy entry must sum to zero like any other").toBe(0);

    const wallet = view.lines.find((line) => line.account === "wallet");
    const source = view.lines.find((line) => line.account === "ubi_commission");
    expect(wallet?.amountMinor).toBe(50_000);
    expect(source?.amountMinor).toBe(-50_000);
    // Every line points back at the case that authorised it.
    for (const line of view.lines) {
      expect(line.counterpartRef).toBe(`case:${body.caseId}`);
    }
  });

  it("draws each remedy type from its own account, so goodwill is not booked as a refund", async () => {
    const cases: Array<[string, string]> = [
      ["fee_reversal", "ubi_commission"],
      ["refund", "refund_reserve"],
      ["credit", "ubi_float"],
      ["redelivery", "ubi_float"],
      ["cash_dispute_resolution", "cash_owed"],
    ];
    for (const [type, account] of cases) {
      const body = await remedyBody({ type });
      const view = (await (await post(body, uid("idem"))).json()) as RemedyView;
      const source = view.lines.find((line) => line.account !== "wallet");
      expect(source?.account, `${type} must draw from ${account}`).toBe(account);
    }
  });

  it("replays the original entry instead of paying twice", async () => {
    const body = await remedyBody();
    const key = uid("idem");

    const first = (await (await post(body, key)).json()) as RemedyView;
    const second = (await (await post(body, key)).json()) as RemedyView;

    expect(second.entryId).toBe(first.entryId);
    expect(second.replayed).toBe(true);

    const entries = await db.journalEntry.count({ where: { caseRef: body.caseId } });
    expect(entries, "a retry must not post a second entry").toBe(1);
  });

  it("refuses a remedy with no Idempotency-Key rather than risking a double payment", async () => {
    const body = await remedyBody();
    const response = await app.request("/", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-service-key": INTERNAL_KEY,
      },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(422);
  });

  it("refuses a currency the city does not use", async () => {
    const body = await remedyBody({ currency: "KES" });
    const response = await post(body, uid("idem"));
    expect(response.status).toBe(422);
    expect(await db.journalEntry.count({ where: { caseRef: body.caseId } })).toBe(0);
  });

  it("refuses an untyped remedy", async () => {
    const body = await remedyBody({ type: "just_give_them_money" });
    const response = await post(body, uid("idem"));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await db.journalEntry.count({ where: { caseRef: body.caseId } })).toBe(0);
  });

  it("refuses a negative or zero amount", async () => {
    for (const amountMinor of [0, -1000]) {
      const body = await remedyBody({ amountMinor });
      const response = await post(body, uid("idem"));
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await db.journalEntry.count({ where: { caseRef: body.caseId } })).toBe(0);
    }
  });

  it("leaves the entry it corrects completely untouched", async () => {
    const body = await remedyBody();
    // A prior entry the case is about.
    const before = await db.journalEntry.findMany({ orderBy: { id: "asc" }, include: { lines: true } });
    await post(body, uid("idem"));
    const after = await db.journalEntry.findMany({
      where: { id: { in: before.map((entry) => entry.id) } },
      orderBy: { id: "asc" },
      include: { lines: true },
    });
    expect(JSON.stringify(after, (_k, v) => (typeof v === "bigint" ? v.toString() : v))).toBe(
      JSON.stringify(before, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    );
  });
});
