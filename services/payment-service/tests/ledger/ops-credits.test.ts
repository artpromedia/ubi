/**
 * Audited dual-approval ops driver wallet credits (CC-B03, DEC-6 Part B):
 * ledger invariants, two-person approval, city caps, rider-wallet isolation,
 * spendable-checked reversal against active marketplace commission holds, and
 * HTTP route auth guards.
 */
import * as jose from "jose";
import { afterAll, describe, expect, it } from "vitest";

import { ContractError } from "@ubi/contracts";

import { reserveHold } from "../../src/ledger/mp-holds";
import {
  approveOpsCredit,
  getOpsCredit,
  listOpsCredits,
  rejectOpsCredit,
  requestOpsCredit,
  reverseOpsCredit,
} from "../../src/ledger/ops-credits";
import { createOpsWalletCreditRoutes } from "../../src/routes/ops-wallet-credits";
import {
  closeTestDb,
  makeDeps,
  seedCity,
  seedDriverUser,
  seedUser,
  testDb,
  uid,
} from "./helpers";

const IDENTITY_SECRET = "test-ubi-identity-secret-minimum-32-chars!!";

async function signIdentity(claims: {
  readonly userId: string;
  readonly role: string;
  readonly modes?: readonly string[];
}): Promise<string> {
  return new jose.SignJWT({
    role: claims.role,
    scp: ["finance:ops"],
    mod: claims.modes ?? ["full"],
    city: "LOS",
    rid: uid("req"),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuer("ubi-gateway")
    .setAudience("ubi-internal")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(IDENTITY_SECRET));
}

describe("ops driver wallet credits (CC-B03 Part B)", () => {
  const db = testDb();
  afterAll(async () => {
    await closeTestDb();
  });

  it("refuses requests with 404 feature_disabled when ops_driver_wallet_credit is off (default)", async () => {
    const city = await seedCity(db);
    const driver = await seedDriverUser(db);
    const deps = makeDeps(db);

    await expect(
      requestOpsCredit(deps, {
        actor: { id: "ops_author_1", role: "finance_ops" },
        cityId: city.cityId,
        driverUserId: driver.id,
        amountMinor: 500_000,
        reasonCode: "pilot_commission_seed",
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "feature_disabled", status: 404 });
  });

  it("refuses requests with 503 config_unavailable when opsCreditPolicy is omitted from city config", async () => {
    const city = await seedCity(db, {
      flags: { ops_driver_wallet_credit: true },
      omitOpsCreditPolicy: true,
    });
    const driver = await seedDriverUser(db);
    const deps = makeDeps(db);

    await expect(
      requestOpsCredit(deps, {
        actor: { id: "ops_author_1", role: "finance_ops" },
        cityId: city.cityId,
        driverUserId: driver.id,
        amountMinor: 500_000,
        reasonCode: "pilot_commission_seed",
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "config_unavailable", status: 503 });
  });

  it("never touches rider funds: refuses targeting a rider account", async () => {
    const city = await seedCity(db, {
      flags: { ops_driver_wallet_credit: true },
    });
    const rider = await seedUser(db, "RiderOnly");
    const deps = makeDeps(db);

    await expect(
      requestOpsCredit(deps, {
        actor: { id: "ops_author_1", role: "finance_ops" },
        cityId: city.cityId,
        driverUserId: rider.id,
        amountMinor: 500_000,
        reasonCode: "pilot_commission_seed",
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "validation_failed", status: 422 });
  });

  it("enforces dual approval (author !== approver), posts balanced ubi_float -> wallet only on approval, and backs marketplace commission holds", async () => {
    const city = await seedCity(db, {
      flags: {
        ops_driver_wallet_credit: true,
        marketplace_rides: true,
      },
    });
    const driver = await seedDriverUser(db);
    const deps = makeDeps(db);
    const author = { id: uid("ops_author"), role: "finance_ops" };
    const approver = { id: uid("ops_approver"), role: "ops_admin" };

    // 1. Request credit: pending_approval, zero wallet balance, zero journal lines.
    const requested = await requestOpsCredit(deps, {
      actor: author,
      cityId: city.cityId,
      driverUserId: driver.id,
      amountMinor: 1_000_000,
      reasonCode: "pilot_commission_seed",
      note: "Lagos pilot onboarding commission float",
      reference: "PILOT-DRV-001",
      idempotencyKey: uid("idem_req"),
    });
    expect(requested.credit.status).toBe("pending_approval");
    expect(requested.credit.entryId).toBeNull();
    expect(requested.balanceAfter.amountMinor).toBe(0);

    // 2. Author cannot approve their own request (two-person rule + DB CHECK).
    await expect(
      approveOpsCredit(deps, {
        actor: author,
        creditId: requested.credit.id,
        idempotencyKey: uid("idem_self"),
      }),
    ).rejects.toMatchObject({ code: "approver_is_author", status: 409 });

    // 3. Second operator approves -> balanced `ops_driver_credit` journal entry,
    //    audit trail, outbox event, and cleared spendable balance.
    const approveKey = uid("idem_app");
    const approved = await approveOpsCredit(deps, {
      actor: approver,
      creditId: requested.credit.id,
      idempotencyKey: approveKey,
    });
    expect(approved.replayed).toBe(false);
    expect(approved.credit.status).toBe("approved");
    expect(approved.credit.entryId).toBeTruthy();
    expect(approved.balanceAfter).toEqual({
      amountMinor: 1_000_000,
      currency: "NGN",
    });

    // Replay of the exact approval key returns replayed: true without double-crediting.
    const replayedApproval = await approveOpsCredit(deps, {
      actor: approver,
      creditId: requested.credit.id,
      idempotencyKey: approveKey,
    });
    expect(replayedApproval.replayed).toBe(true);
    expect(replayedApproval.balanceAfter.amountMinor).toBe(1_000_000);

    // Verify journal conservation: sum of lines = 0, accounts are ubi_float (-1M) & wallet (+1M).
    const lines = await db.journalLine.findMany({
      where: { entryId: approved.credit.entryId! },
    });
    expect(lines).toHaveLength(2);
    const sum = lines.reduce((acc, line) => acc + Number(line.amountMinor), 0);
    expect(sum).toBe(0);
    expect(
      lines.find((line) => line.account === "ubi_float")?.amountMinor,
    ).toBe(BigInt(-1_000_000));
    expect(lines.find((line) => line.account === "wallet")?.amountMinor).toBe(
      BigInt(1_000_000),
    );

    // Audit & Outbox verification.
    const audits = await db.auditLog.findMany({
      where: { subjectId: requested.credit.id },
    });
    expect(audits.map((row) => row.action).sort()).toEqual([
      "wallet.ops_credit.approved",
      "wallet.ops_credit.requested",
    ]);
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: requested.credit.id },
    });
    expect(events.map((row) => row.name).sort()).toEqual([
      "wallet.ops_credit.approved",
      "wallet.ops_credit.requested",
    ]);

    // 4. Driver places a marketplace bid requiring a 400_000 commission hold.
    const hold = await reserveHold(
      deps,
      {
        cityId: city.cityId,
        driverId: driver.id,
        bidRef: uid("bid"),
        requestRef: uid("mp_req"),
        amountMinor: 400_000, // 10% of 4_000_000
        baseMinor: 4_000_000,
        currency: "NGN",
        policyVersion: 1,
      },
      uid("idem_hold"),
    );
    expect(hold.hold.amountMinor.amountMinor).toBe(400_000);

    // 5. Reversing the 1_000_000 credit while 400_000 is held fails with
    //    `insufficient_spendable` (spendable is 600_000 < 1_000_000).
    await expect(
      reverseOpsCredit(deps, {
        actor: approver,
        creditId: requested.credit.id,
        reason: "entered against wrong pilot cohort",
        idempotencyKey: uid("idem_rev_blocked"),
      }),
    ).rejects.toMatchObject({ code: "insufficient_spendable", status: 422 });
  });

  it("reverses an unencumbered approved credit cleanly and records ops_driver_credit_reversal", async () => {
    const city = await seedCity(db, {
      flags: { ops_driver_wallet_credit: true },
    });
    const driver = await seedDriverUser(db);
    const deps = makeDeps(db);

    const req = await requestOpsCredit(deps, {
      actor: { id: uid("author"), role: "finance_ops" },
      cityId: city.cityId,
      driverUserId: driver.id,
      amountMinor: 300_000,
      reasonCode: "goodwill_adjustment",
      idempotencyKey: uid("idem_req"),
    });
    await approveOpsCredit(deps, {
      actor: { id: uid("approver"), role: "ops_admin" },
      creditId: req.credit.id,
      idempotencyKey: uid("idem_app"),
    });

    const reversed = await reverseOpsCredit(deps, {
      actor: { id: uid("reverser"), role: "admin" },
      creditId: req.credit.id,
      reason: "duplicate cohort upload",
      idempotencyKey: uid("idem_rev"),
    });
    expect(reversed.credit.status).toBe("reversed");
    expect(reversed.credit.reversalEntryId).toBeTruthy();
    expect(reversed.balanceAfter.amountMinor).toBe(0);

    const fetched = await getOpsCredit(deps, req.credit.id);
    expect(fetched.status).toBe("reversed");
  });

  it("enforces per-credit, per-driver-daily, and per-city-daily caps from city config, plus idempotency body mismatch refusal", async () => {
    const city = await seedCity(db, {
      flags: { ops_driver_wallet_credit: true },
      opsCreditPolicy: {
        maxPerCreditMinor: 400_000,
        maxDriverDailyMinor: 600_000,
        maxCityDailyMinor: 900_000,
        reasonCodes: ["pilot_commission_seed"],
      },
    });
    const driver1 = await seedDriverUser(db, "DriverOne");
    const driver2 = await seedDriverUser(db, "DriverTwo");
    const deps = makeDeps(db, {
      now: () => new Date("2026-06-15T10:00:00.000Z"),
    });
    const author = { id: uid("author"), role: "finance_ops" };

    // Above per-credit cap (500_000 > 400_000).
    await expect(
      requestOpsCredit(deps, {
        actor: author,
        cityId: city.cityId,
        driverUserId: driver1.id,
        amountMinor: 500_000,
        reasonCode: "pilot_commission_seed",
        idempotencyKey: uid("idem_cap1"),
      }),
    ).rejects.toMatchObject({ code: "above_city_cap", status: 422 });

    // Unlisted reasonCode -> validation_failed.
    await expect(
      requestOpsCredit(deps, {
        actor: author,
        cityId: city.cityId,
        driverUserId: driver1.id,
        amountMinor: 200_000,
        reasonCode: "invented_reason",
        idempotencyKey: uid("idem_reason"),
      }),
    ).rejects.toMatchObject({ code: "validation_failed", status: 422 });

    // First valid 400_000 credit for driver1 succeeds.
    const sharedKey = uid("idem_first");
    const first = await requestOpsCredit(deps, {
      actor: author,
      cityId: city.cityId,
      driverUserId: driver1.id,
      amountMinor: 400_000,
      reasonCode: "pilot_commission_seed",
      idempotencyKey: sharedKey,
    });
    expect(first.replayed).toBe(false);

    // Reusing `sharedKey` with a different amount is refused (`idempotency_key_reuse`).
    await expect(
      requestOpsCredit(deps, {
        actor: author,
        cityId: city.cityId,
        driverUserId: driver1.id,
        amountMinor: 100_000,
        reasonCode: "pilot_commission_seed",
        idempotencyKey: sharedKey,
      }),
    ).rejects.toMatchObject({ code: "idempotency_key_reuse", status: 409 });

    // Second 300_000 credit for driver1 on same Lagos day exceeds maxDriverDailyMinor (400k + 300k > 600k).
    await expect(
      requestOpsCredit(deps, {
        actor: author,
        cityId: city.cityId,
        driverUserId: driver1.id,
        amountMinor: 300_000,
        reasonCode: "pilot_commission_seed",
        idempotencyKey: uid("idem_drv_cap"),
      }),
    ).rejects.toMatchObject({ code: "limit_exceeded", status: 422 });

    // Driver2 takes 400_000 (city total = 800_000 <= 900_000) -> ok; then another 200_000 exceeds maxCityDailyMinor (1_000_000 > 900_000).
    await requestOpsCredit(deps, {
      actor: author,
      cityId: city.cityId,
      driverUserId: driver2.id,
      amountMinor: 400_000,
      reasonCode: "pilot_commission_seed",
      idempotencyKey: uid("idem_d2_a"),
    });
    await expect(
      requestOpsCredit(deps, {
        actor: author,
        cityId: city.cityId,
        driverUserId: driver2.id,
        amountMinor: 200_000,
        reasonCode: "pilot_commission_seed",
        idempotencyKey: uid("idem_city_cap"),
      }),
    ).rejects.toMatchObject({ code: "above_city_cap", status: 422 });

    // Rejecting first credit frees cap and records rejected status.
    const rejected = await rejectOpsCredit(deps, {
      actor: { id: uid("reviewer"), role: "ops_admin" },
      creditId: first.credit.id,
      reason: "superseded",
      idempotencyKey: uid("idem_rej"),
    });
    expect(rejected.credit.status).toBe("rejected");

    const listed = await listOpsCredits(deps, { cityId: city.cityId });
    expect(listed.length).toBe(2);
  });

  it("enforces signed identity role and limited-mode guards on /v1/ops/wallet-credits HTTP routes", async () => {
    const prevSecret = process.env.UBI_IDENTITY_SECRET;
    process.env.UBI_IDENTITY_SECRET = IDENTITY_SECRET;
    try {
      const city = await seedCity(db, {
        flags: { ops_driver_wallet_credit: true },
      });
      const driver = await seedDriverUser(db);
      const router = createOpsWalletCreditRoutes(makeDeps(db));

      // Rider role -> 403 forbidden.
      const riderJwt = await signIdentity({
        userId: uid("rider"),
        role: "rider",
      });
      const riderRes = await router.request("http://test/", {
        headers: { "x-ubi-identity": riderJwt },
      });
      expect(riderRes.status).toBe(403);

      // Limited-mode ops token -> 403 limited_mode.
      const limitedJwt = await signIdentity({
        userId: uid("ops_lim"),
        role: "finance_ops",
        modes: ["limited"],
      });
      const limRes = await router.request("http://test/", {
        headers: { "x-ubi-identity": limitedJwt },
      });
      expect(limRes.status).toBe(403);
      const limBody = (await limRes.json()) as { code: string };
      expect(limBody.code).toBe("limited_mode");

      // Full-mode finance_ops creates + ops_admin approves over HTTP.
      const authorJwt = await signIdentity({
        userId: uid("http_author"),
        role: "finance_ops",
      });
      const createRes = await router.request("http://test/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ubi-identity": authorJwt,
          "idempotency-key": uid("http_idem_create"),
        },
        body: JSON.stringify({
          cityId: city.cityId,
          driverUserId: driver.id,
          amountMinor: 250_000,
          reasonCode: "pilot_commission_seed",
        }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as {
        credit: { id: string; status: string };
      };
      expect(created.credit.status).toBe("pending_approval");

      // Negative control: author attempting HTTP approve gets 409 approver_is_author.
      const selfApprove = await router.request(
        `http://test/${created.credit.id}/approve`,
        {
          method: "POST",
          headers: {
            "x-ubi-identity": authorJwt,
            "idempotency-key": uid("http_idem_self"),
          },
        },
      );
      expect(selfApprove.status).toBe(409);
      const selfBody = (await selfApprove.json()) as { code: string };
      expect(selfBody.code).toBe("approver_is_author");

      // Distinct ops_admin approves -> 200 OK.
      const approverJwt = await signIdentity({
        userId: uid("http_approver"),
        role: "ops_admin",
      });
      const approveRes = await router.request(
        `http://test/${created.credit.id}/approve`,
        {
          method: "POST",
          headers: {
            "x-ubi-identity": approverJwt,
            "idempotency-key": uid("http_idem_app"),
          },
        },
      );
      expect(approveRes.status).toBe(200);
    } finally {
      if (prevSecret === undefined) {
        delete process.env.UBI_IDENTITY_SECRET;
      } else {
        process.env.UBI_IDENTITY_SECRET = prevSecret;
      }
    }
  });
});
