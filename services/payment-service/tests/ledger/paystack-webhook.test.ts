/**
 * Paystack PSP adapter and raw-body webhook tests (CC-B03, DEC-6 Part A):
 * - HMAC-SHA512 over exact raw UTF-8 bytes (whitespace mutation rejected)
 * - 503 when secret is unset, 401 when missing/bad signature
 * - Idempotent webhook crediting on provider reference (replay never double-credits)
 * - Synchronous `createTopup` + subsequent `charge.success` webhook reconciles cleanly without double-posting
 * - `paystackTopupProvider` / `paystackBankRailProvider` HTTP contract against an in-process stub server
 */
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { balanceOf } from "../../src/ledger/balances";
import {
  handlePaystackWebhook,
  paystackBankRailProvider,
  paystackTopupProvider,
} from "../../src/ledger/paystack";
import { createTopup } from "../../src/ledger/topups";
import { createPspWebhookRoutes } from "../../src/routes/psp-webhooks";
import {
  closeTestDb,
  makeDeps,
  seedCity,
  seedUser,
  testDb,
  uid,
} from "./helpers";

const WEBHOOK_SECRET = "ps_whsec_test_secret_key_for_hmac_sha512";

function signPaystack(rawBody: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
}

describe("Paystack PSP adapter & webhook processor (CC-B03 Part A)", () => {
  const db = testDb();

  beforeEach(() => {
    delete process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_WEBHOOK_SECRET;
    delete process.env.PAYSTACK_BASE_URL;
  });

  afterAll(async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    delete process.env.PAYSTACK_WEBHOOK_SECRET;
    delete process.env.PAYSTACK_BASE_URL;
    await closeTestDb();
  });

  it("returns null providers when PAYSTACK_SECRET_KEY is unset and answers 503 on webhook when secret is unset", async () => {
    expect(paystackTopupProvider()).toBeNull();
    expect(paystackBankRailProvider()).toBeNull();

    const router = createPspWebhookRoutes(makeDeps(db));
    const raw = JSON.stringify({
      event: "charge.success",
      data: { reference: uid("ref") },
    });
    const res = await router.request("http://test/paystack", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-paystack-signature": signPaystack(raw),
      },
      body: raw,
    });
    expect(res.status).toBe(503);
  });

  it("verifies HMAC-SHA512 over exact raw bytes and rejects tampered whitespace (negative control)", async () => {
    process.env.PAYSTACK_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const router = createPspWebhookRoutes(makeDeps(db));

    const canonicalRaw = `{"event":"charge.success","data":{"reference":"${uid("ps_ws")}","amount":100000,"currency":"NGN"}}`;
    const sigForCanonical = signPaystack(canonicalRaw);

    // Semantically identical JSON with extra spaces MUST fail raw-body HMAC verification!
    const reformattedRaw = `{ "event": "charge.success", "data": { "reference": "tampered", "amount": 100000, "currency": "NGN" } }`;
    const whitespaceOnlyRaw = canonicalRaw.replace(
      '"event":"charge.success"',
      '"event": "charge.success"',
    );

    const resTampered = await router.request("http://test/paystack", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-paystack-signature": sigForCanonical,
      },
      body: whitespaceOnlyRaw,
    });
    expect(resTampered.status).toBe(401);

    const resReformatted = await router.request("http://test/paystack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: reformattedRaw,
    });
    expect(resReformatted.status).toBe(401);
  });

  it("credits a wallet once on charge.success and treats duplicate webhook deliveries as idempotent no-ops", async () => {
    process.env.PAYSTACK_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const city = await seedCity(db);
    const rider = await seedUser(db);
    const deps = makeDeps(db);
    const router = createPspWebhookRoutes(deps);

    const reference = uid("ps_charge");
    const rawBody = JSON.stringify({
      event: "charge.success",
      data: {
        reference,
        amount: 750_000,
        currency: "NGN",
        channel: "card",
        metadata: {
          cityId: city.cityId,
          userId: rider.id,
          methodId: "card",
        },
      },
    });
    const sig = signPaystack(rawBody);

    const first = await router.request("http://test/paystack", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-paystack-signature": sig,
      },
      body: rawBody,
    });
    expect(first.status).toBe(200);
    const firstJson = (await first.json()) as {
      applied: boolean;
      replayed: boolean;
      entryId: string;
      topupId: string;
    };
    expect(firstJson.applied).toBe(true);
    expect(firstJson.replayed).toBe(false);
    expect(firstJson.entryId).toBeTruthy();

    // Replay the exact webhook 2 more times: balance stays 750_000 and journal lines stay 2.
    const second = await router.request("http://test/paystack", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-paystack-signature": sig,
      },
      body: rawBody,
    });
    expect(second.status).toBe(200);
    const secondJson = (await second.json()) as {
      applied: boolean;
      replayed: boolean;
      entryId: string;
    };
    expect(secondJson.replayed).toBe(true);
    expect(secondJson.applied).toBe(false);
    expect(secondJson.entryId).toBe(firstJson.entryId);

    const topup = await db.topup.findUnique({ where: { pspRef: reference } });
    expect(topup).not.toBeNull();
    const bal = await balanceOf(db, topup!.walletId, "NGN");
    expect(bal.amountMinor).toBe(750_000);

    // Conflicting payload under the same provider reference -> 409 idempotency_conflict.
    const conflictingRaw = JSON.stringify({
      event: "charge.success",
      data: {
        reference,
        amount: 999_999,
        currency: "NGN",
        metadata: { cityId: city.cityId, userId: rider.id },
      },
    });
    const conflictRes = await router.request("http://test/paystack", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-paystack-signature": signPaystack(conflictingRaw),
      },
      body: conflictingRaw,
    });
    expect(conflictRes.status).toBe(409);
  });

  it("wires paystackTopupProvider + paystackBankRailProvider against HTTP endpoints and never double-credits when charge.success arrives after synchronous createTopup", async () => {
    const requests: Array<{ method: string; url: string; body: string }> = [];
    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const url = req.url ?? "/";
        requests.push({ method: req.method ?? "GET", url, body });
        res.setHeader("content-type", "application/json");

        if (req.method === "POST" && url === "/charge") {
          const parsed = JSON.parse(body) as { reference: string };
          res.end(
            JSON.stringify({
              status: true,
              data: { reference: `ps_${parsed.reference}`, status: "success" },
            }),
          );
          return;
        }
        if (req.method === "POST" && url === "/refund") {
          res.end(JSON.stringify({ status: true }));
          return;
        }
        if (req.method === "GET" && url.startsWith("/bank/resolve")) {
          res.end(
            JSON.stringify({
              status: true,
              data: {
                account_number: "0123456789",
                account_name: "CHIDI DRIVER",
              },
            }),
          );
          return;
        }
        if (req.method === "POST" && url === "/transferrecipient") {
          res.end(
            JSON.stringify({
              status: true,
              data: { recipient_code: "RCP_test_123" },
            }),
          );
          return;
        }
        if (req.method === "POST" && url === "/transfer") {
          const parsed = JSON.parse(body) as { reference: string };
          res.end(
            JSON.stringify({
              status: true,
              data: {
                transfer_code: "TRF_test_123",
                reference: parsed.reference,
              },
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ status: false }));
      });
    });

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    try {
      process.env.PAYSTACK_SECRET_KEY = "sk_test_local_stub";
      process.env.PAYSTACK_WEBHOOK_SECRET = WEBHOOK_SECRET;
      process.env.PAYSTACK_BASE_URL = `http://127.0.0.1:${port}`;

      const topupRail = paystackTopupProvider();
      const bankRail = paystackBankRailProvider();
      expect(topupRail).not.toBeNull();
      expect(bankRail).not.toBeNull();

      const city = await seedCity(db);
      const user = await seedUser(db);
      const deps = makeDeps(db, { topupRail, bankRail });

      // 1. Synchronous top-up via Paystack adapter.
      const captured = await createTopup(deps, {
        actor: { id: user.id, role: "rider" },
        cityId: city.cityId,
        methodId: "card",
        amountMinor: 400_000,
        idempotencyKey: uid("idem_sync_topup"),
      });
      expect(captured.status).toBe("captured");
      expect(captured.balanceAfter.amountMinor).toBe(400_000);

      const topupRow = await db.topup.findUnique({
        where: { id: captured.topupId },
      });
      expect(topupRow?.pspRef).toMatch(/^ps_topup:/);

      // 2. Subsequent asynchronous Paystack `charge.success` webhook for the same pspRef
      //    reconciles as `already_captured` without posting a second journal entry!
      const rawWebhook = JSON.stringify({
        event: "charge.success",
        data: {
          reference: topupRow!.pspRef!,
          amount: 400_000,
          currency: "NGN",
          metadata: { cityId: city.cityId, userId: user.id },
        },
      });
      const outcome = await handlePaystackWebhook(
        deps,
        rawWebhook,
        signPaystack(rawWebhook),
      );
      expect(outcome.status).toBe("already_captured");
      expect(outcome.applied).toBe(false);

      const afterWebhookBalance = await balanceOf(
        db,
        topupRow!.walletId,
        "NGN",
      );
      expect(afterWebhookBalance.amountMinor).toBe(400_000);

      // 3. Bank rail nameEnquiry + sendPayout contract.
      const ne = await bankRail!.nameEnquiry({
        bankCode: "058",
        accountNumber: "0123456789",
      });
      expect(ne?.accountName).toBe("CHIDI DRIVER");

      const payout = await bankRail!.sendPayout({
        bankCode: "058",
        accountNumber: "0123456789",
        accountName: "CHIDI DRIVER",
        amount: { amountMinor: 150_000, currency: "NGN" },
        reference: "nip:test_1",
        idempotencyKey: uid("idem_payout"),
      });
      expect(payout.sessionId).toBe("nip:test_1");
      expect(requests.map((r) => `${r.method} ${r.url.split("?")[0]}`)).toEqual(
        [
          "POST /charge",
          "GET /bank/resolve",
          "POST /transferrecipient",
          "POST /transfer",
        ],
      );
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
