import { money } from "@ubi/contracts";
import { afterAll, describe, expect, it } from "vitest";

import { balanceOf } from "../../src/ledger/balances";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { createRequest, listRequests, payRequest } from "../../src/ledger/requests";
import { setInitialPin } from "../../src/ledger/wallet-ops";
import { ensureWallet } from "../../src/ledger/wallets";

import {
  closeTestDb,
  fundWallet,
  makeDeps,
  seedCity,
  seedUser,
  testDb,
  uid,
} from "./helpers";

const db = testDb();
const PIN = "4242";

afterAll(async () => {
  await closeTestDb();
});

async function splitScenario() {
  const city = await seedCity(db);
  const deps = makeDeps(db);
  const requester = await seedUser(db, "Ife");
  const payer = await seedUser(db, "Sade");
  const config = await createCityConfigProvider(db).load(city.cityId);

  const requesterWallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", requester.id, config.city),
  );
  const payerWallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", payer.id, config.city),
  );
  await setInitialPin(deps, { id: payer.id, role: "rider" }, city.cityId, PIN);
  await fundWallet(db, payerWallet.id, city.currency, 1_000_000);

  return {
    city,
    deps,
    requester: { id: requester.id, walletId: requesterWallet.id },
    payer: { id: payer.id, walletId: payerWallet.id },
  };
}

describe("split-fare requests", () => {
  it("creates a request that moves nothing until the payer pays it", async () => {
    const s = await splitScenario();
    const rideId = uid("ride");
    const request = await createRequest(s.deps, {
      actor: { id: s.requester.id, role: "rider" },
      cityId: s.city.cityId,
      fromUserId: s.payer.id,
      amountMinor: 175_000,
      rideId,
      idempotencyKey: uid("idem"),
    });

    expect(request.status).toBe("pending");
    expect(await balanceOf(db, s.requester.walletId, s.city.currency)).toEqual(
      money(0, s.city.currency),
    );

    const inbox = await listRequests(db, s.payer.id);
    expect(inbox.owing.map((entry) => entry.requestId)).toContain(request.requestId);

    const paid = await payRequest(s.deps, {
      actor: { id: s.payer.id, role: "rider" },
      cityId: s.city.cityId,
      requestId: request.requestId,
      pin: PIN,
      idempotencyKey: uid("idem"),
    });

    expect(paid.amount).toEqual(money(175_000, s.city.currency));
    expect(await balanceOf(db, s.payer.walletId, s.city.currency)).toEqual(
      money(825_000, s.city.currency),
    );
    expect(await balanceOf(db, s.requester.walletId, s.city.currency)).toEqual(
      money(175_000, s.city.currency),
    );

    const lines = await db.journalLine.findMany({ where: { entryId: paid.entryId } });
    expect(lines).toHaveLength(2);
    expect(
      lines.every((line) => line.counterpartRef?.includes(request.requestId)),
    ).toBe(true);

    const after = await db.transferRequest.findUniqueOrThrow({
      where: { id: request.requestId },
    });
    expect(after.status).toBe("paid");
  });

  it("refuses to let anyone but the person billed pay", async () => {
    const s = await splitScenario();
    const request = await createRequest(s.deps, {
      actor: { id: s.requester.id, role: "rider" },
      cityId: s.city.cityId,
      fromUserId: s.payer.id,
      amountMinor: 10_000,
      idempotencyKey: uid("idem"),
    });

    await expect(
      payRequest(s.deps, {
        actor: { id: s.requester.id, role: "rider" },
        cityId: s.city.cityId,
        requestId: request.requestId,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("pays a request exactly once under a replayed key", async () => {
    const s = await splitScenario();
    const request = await createRequest(s.deps, {
      actor: { id: s.requester.id, role: "rider" },
      cityId: s.city.cityId,
      fromUserId: s.payer.id,
      amountMinor: 60_000,
      idempotencyKey: uid("idem"),
    });
    const key = uid("idem");
    const first = await payRequest(s.deps, {
      actor: { id: s.payer.id, role: "rider" },
      cityId: s.city.cityId,
      requestId: request.requestId,
      pin: PIN,
      idempotencyKey: key,
    });
    const second = await payRequest(s.deps, {
      actor: { id: s.payer.id, role: "rider" },
      cityId: s.city.cityId,
      requestId: request.requestId,
      pin: PIN,
      idempotencyKey: key,
    });

    expect(second.transferId).toBe(first.transferId);
    expect(second.replayed).toBe(true);
    expect(await balanceOf(db, s.requester.walletId, s.city.currency)).toEqual(
      money(60_000, s.city.currency),
    );
  });

  it("refuses a second payment of an already-settled request", async () => {
    const s = await splitScenario();
    const request = await createRequest(s.deps, {
      actor: { id: s.requester.id, role: "rider" },
      cityId: s.city.cityId,
      fromUserId: s.payer.id,
      amountMinor: 30_000,
      idempotencyKey: uid("idem"),
    });
    await payRequest(s.deps, {
      actor: { id: s.payer.id, role: "rider" },
      cityId: s.city.cityId,
      requestId: request.requestId,
      pin: PIN,
      idempotencyKey: uid("idem"),
    });
    await expect(
      payRequest(s.deps, {
        actor: { id: s.payer.id, role: "rider" },
        cityId: s.city.cityId,
        requestId: request.requestId,
        pin: PIN,
        idempotencyKey: uid("idem"),
      }),
    ).rejects.toMatchObject({ code: "illegal_transition" });
  });

  it("replays a duplicated request creation instead of billing twice", async () => {
    const s = await splitScenario();
    const key = uid("idem");
    const first = await createRequest(s.deps, {
      actor: { id: s.requester.id, role: "rider" },
      cityId: s.city.cityId,
      fromUserId: s.payer.id,
      amountMinor: 45_000,
      idempotencyKey: key,
    });
    const second = await createRequest(s.deps, {
      actor: { id: s.requester.id, role: "rider" },
      cityId: s.city.cityId,
      fromUserId: s.payer.id,
      amountMinor: 45_000,
      idempotencyKey: key,
    });
    expect(second.requestId).toBe(first.requestId);
    expect(second.replayed).toBe(true);
    const inbox = await listRequests(db, s.payer.id);
    expect(
      inbox.owing.filter((entry) => entry.requestId === first.requestId),
    ).toHaveLength(1);
  });
});
