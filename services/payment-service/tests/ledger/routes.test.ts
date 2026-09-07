import { afterAll, describe, expect, it } from "vitest";

import { createFinanceRoutes } from "../../src/finance/routes";
import { createCityConfigProvider } from "../../src/ledger/city-config";
import { setInitialPin } from "../../src/ledger/wallet-ops";
import { ensureWallet } from "../../src/ledger/wallets";
import { createWalletV1Routes } from "../../src/routes/wallet-v1";

import {
  closeTestDb,
  fundWallet,
  makeDeps,
  seedCity,
  seedUser,
  testDb,
  uid,
  type SeedCityOptions,
} from "./helpers";

const db = testDb();
const PIN = "7777";

afterAll(async () => {
  await closeTestDb();
});

async function httpScenario(options: SeedCityOptions = {}) {
  const city = await seedCity(db, options);
  const deps = makeDeps(db);
  const app = createWalletV1Routes(deps);
  const finance = createFinanceRoutes(deps);
  const sender = await seedUser(db, "Halima");
  const recipient = await seedUser(db, "Obi");
  const config = await createCityConfigProvider(db).load(city.cityId);
  const senderWallet = await db.$transaction((tx) =>
    ensureWallet(tx, "user", sender.id, config.city),
  );
  await setInitialPin(deps, { id: sender.id, role: "rider" }, city.cityId, PIN);
  await fundWallet(db, senderWallet.id, city.currency, 3_000_000);

  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({
    "X-User-ID": sender.id,
    "X-User-Role": "rider",
    "X-City-ID": city.cityId,
    "content-type": "application/json",
    ...extra,
  });

  return { city, app, finance, sender, recipient, senderWallet, headers };
}

describe("/v1/wallet", () => {
  it("refuses an unauthenticated read", async () => {
    const s = await httpScenario();
    const response = await s.app.request("/", {
      headers: { "X-City-ID": s.city.cityId },
    });
    expect(response.status).toBe(401);
  });

  it("returns the derived balance, tier and remaining limits", async () => {
    const s = await httpScenario();
    const response = await s.app.request("/", { headers: s.headers() });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.balance).toEqual({ amountMinor: 3_000_000, currency: s.city.currency });
    expect(body.tier).toBe("tier1");
    expect(body.safeMode).toEqual({ active: false, until: null });
  });

  it("insists on an idempotency key before it will move money", async () => {
    const s = await httpScenario();
    const response = await s.app.request("/transfers", {
      method: "POST",
      headers: s.headers(),
      body: JSON.stringify({
        toUserId: s.recipient.id,
        amountMinor: 10_000,
        pin: PIN,
      }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("validation_failed");
  });

  it("posts a transfer and answers 201", async () => {
    const s = await httpScenario();
    const response = await s.app.request("/transfers", {
      method: "POST",
      headers: s.headers({ "Idempotency-Key": uid("idem") }),
      body: JSON.stringify({
        toUserId: s.recipient.id,
        amountMinor: 25_000,
        pin: PIN,
        note: "cab share",
      }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { status: string; entryId: string };
    expect(body.status).toBe("posted");
    expect(body.entryId).toBeTruthy();
  });

  it("answers 202 when a transfer is held for review", async () => {
    const s = await httpScenario({ policy: { newRecipientHoldAboveMinor: 1_000 } });
    const response = await s.app.request("/transfers", {
      method: "POST",
      headers: s.headers({ "Idempotency-Key": uid("idem") }),
      body: JSON.stringify({
        toUserId: s.recipient.id,
        amountMinor: 900_000,
        pin: PIN,
      }),
    });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { status: string; reviewCaseId: string };
    expect(body.status).toBe("held_risk");
    expect(body.reviewCaseId).toBeTruthy();
  });

  it("404s the whole surface when the flag is off", async () => {
    const s = await httpScenario({ flags: { wallet_p2p: false } });
    const response = await s.app.request("/transfers", {
      method: "POST",
      headers: s.headers({ "Idempotency-Key": uid("idem") }),
      body: JSON.stringify({
        toUserId: s.recipient.id,
        amountMinor: 1_000,
        pin: PIN,
      }),
    });
    expect(response.status).toBe(404);
  });

  it("gives back a display name and nothing else on a lookup", async () => {
    const s = await httpScenario();
    const response = await s.app.request(
      `/recipients/lookup?q=${encodeURIComponent(s.recipient.phone)}`,
      { headers: s.headers() },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["displayName", "userId"]);
    expect(body.displayName).toBe(s.recipient.displayName);
  });

  it("says tags are unavailable rather than pretending the person does not exist", async () => {
    const s = await httpScenario();
    const response = await s.app.request("/recipients/lookup?q=%40obi", {
      headers: s.headers(),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; details?: unknown };
    expect(body.code).toBe("validation_failed");
    expect(body.details).toMatchObject({ supported: ["phone"] });
  });

  it("refuses a request that does not say which city it is for", async () => {
    const s = await httpScenario();
    const response = await s.app.request("/", {
      headers: { "X-User-ID": s.sender.id, "X-User-Role": "rider" },
    });
    expect(response.status).toBe(404);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("city_unsupported");
  });

  it("rejects a bank callback that carries no verifiable signature", async () => {
    const s = await httpScenario();
    const response = await s.app.request("/nip/callbacks", {
      method: "POST",
      headers: { "content-type": "application/json", "X-City-ID": s.city.cityId },
      body: JSON.stringify({ sessionId: "s", status: "confirmed", reference: "r" }),
    });
    expect(response.status).toBe(503);
  });
});

describe("/v1/finance", () => {
  it("keeps the reconciliation console to ops roles", async () => {
    const s = await httpScenario();
    const asRider = await s.finance.request("/recon/2024-06-10", {
      headers: s.headers(),
    });
    expect(asRider.status).toBe(403);

    const asOps = await s.finance.request("/recon/2024-06-10", {
      headers: s.headers({ "X-User-Role": "ADMIN" }),
    });
    expect(asOps.status).toBe(200);
    const body = (await asOps.json()) as { date: string; closeAllowed: boolean };
    expect(body.date).toBe("2024-06-10");
    expect(body.closeAllowed).toBe(false);
  });

  it("refuses a date that is not a date", async () => {
    const s = await httpScenario();
    const response = await s.finance.request("/recon/not-a-date", {
      headers: s.headers({ "X-User-Role": "ADMIN" }),
    });
    expect(response.status).toBe(422);
  });
});
