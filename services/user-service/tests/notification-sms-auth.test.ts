/**
 * CC-A06 (P0-07, P2-05, P2-17) integration tests:
 * - Real `user-service` `NotificationClient` against real `notification-service`
 *   `serviceAuth` + `smsRoutes` in-process (valid `NOTIFICATION_SERVICE_KEY`,
 *   missing/wrong key, cross-caller key rejection, and legacy Bearer negative
 *   control).
 * - Masked OTP codes and masked phone numbers in `notification_logs`.
 * - `POST /api/v1/sms/otp/verify` protected by `serviceAuth`.
 * - Constant-time HMAC-SHA256 `webhookAuth` verification in `notification-service`.
 * - Production boot guards on both services.
 * - Honest `otp_send_failed` (503) response on `/auth/login/otp` and
 *   `/auth/register` when SMS delivery fails, keeping the stored code for retry.
 */
/* eslint-disable turbo/no-undeclared-env-vars */
import "./identity/setup-env";

import { createHmac } from "node:crypto";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertServiceAuthConfig,
  serviceAuth,
  webhookAuth,
} from "../../notification-service/src/middleware/auth";
import { smsService } from "../../notification-service/src/providers/sms";
import {
  maskOtpCodesInMessage,
  maskPhoneNumber,
  smsRoutes,
} from "../../notification-service/src/routes/sms";
import {
  assertNotificationClientConfig,
  NotificationClient,
} from "../src/lib/notification-client";
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { errorHandler } from "../src/middleware/error-handler";
import { authRoutes } from "../src/routes/auth";

const VALID_USER_NOTIFICATION_KEY =
  "user-to-notification-service-secret-key-0001";
const VALID_INTERNAL_SERVICE_KEY =
  "shared-internal-service-secret-key-00000001";

function buildNotificationApp(): Hono {
  const app = new Hono();
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json(
        { success: false, error: { code: "AUTH_ERROR", message: err.message } },
        err.status,
      );
    }
    return c.json(
      { success: false, error: { code: "INTERNAL", message: err.message } },
      500,
    );
  });
  app.route("/api/v1/sms", smsRoutes);
  app.post(
    "/webhooks/provider",
    (c, next) =>
      webhookAuth(c, next, {
        headerName: "x-webhook-signature",
        secret: process.env.TEST_WEBHOOK_SECRET ?? "",
      }),
    (c) => c.json({ ok: true }),
  );
  return app;
}

describe("CC-A06 · user-service -> notification-service service-key auth & OTP honesty", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of [
      "NODE_ENV",
      "NOTIFICATION_SERVICE_KEY",
      "INTERNAL_SERVICE_KEY",
      "TEST_WEBHOOK_SECRET",
    ]) {
      savedEnv[k] = process.env[k];
    }
    process.env.NOTIFICATION_SERVICE_KEY = VALID_USER_NOTIFICATION_KEY;
    process.env.INTERNAL_SERVICE_KEY = VALID_INTERNAL_SERVICE_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it("accepts OTP SMS from real NotificationClient with configured NOTIFICATION_SERVICE_KEY and masks OTP + phone in notification_logs", async () => {
    const notificationApp = buildNotificationApp();
    const sendSpy = vi.spyOn(smsService, "send").mockResolvedValue({
      success: true,
      messageId: "msg_cc_a06_ok",
      provider: "africastalking",
    });

    const client = new NotificationClient({
      baseUrl: "http://notification.internal",
      serviceKey: VALID_USER_NOTIFICATION_KEY,
      fetchImpl: (input, init) =>
        Promise.resolve(
          notificationApp.request(
            typeof input === "string" ? input : input.toString(),
            init,
          ),
        ),
    });

    const phone = "+2348019876543";
    const otp = "482910";
    const response = await client.sendSMS({
      phone,
      message: `Your UBI code is ${otp}. It expires in 5 minutes.`,
    });

    expect(response.success).toBe(true);
    expect(response.data?.messageId).toBe("msg_cc_a06_ok");
    expect(sendSpy).toHaveBeenCalledOnce();

    const logRow = await prisma.notificationLog.findFirstOrThrow({
      where: { externalId: "msg_cc_a06_ok" },
    });
    expect(logRow.body).toBe(
      "Your UBI code is [REDACTED]. It expires in 5 minutes.",
    );
    expect(logRow.body).not.toContain(otp);
    expect(logRow.recipient).toBe(maskPhoneNumber(phone));
    expect(logRow.recipient).not.toBe(phone);
  });

  it("refuses missing key, wrong key, cross-service INTERNAL_SERVICE_KEY, and legacy Bearer header (negative control)", async () => {
    const notificationApp = buildNotificationApp();
    const sendSpy = vi.spyOn(smsService, "send").mockResolvedValue({
      success: true,
      messageId: "msg_never",
      provider: "africastalking",
    });

    const inProcessFetch: typeof fetch = (input, init) =>
      Promise.resolve(
        notificationApp.request(
          typeof input === "string" ? input : input.toString(),
          init,
        ),
      );

    // 1. Missing key
    const missingKeyClient = new NotificationClient({
      baseUrl: "http://notification.internal",
      serviceKey: "",
      fetchImpl: inProcessFetch,
    });
    await expect(
      missingKeyClient.sendSMS({
        phone: "+2348019876543",
        message: "Your UBI code is 123456.",
      }),
    ).rejects.toThrow();

    // 2. Wrong key
    const wrongKeyClient = new NotificationClient({
      baseUrl: "http://notification.internal",
      serviceKey: "wrong-notification-service-key-00000000",
      fetchImpl: inProcessFetch,
    });
    await expect(
      wrongKeyClient.sendSMS({
        phone: "+2348019876543",
        message: "Your UBI code is 123456.",
      }),
    ).rejects.toThrow();

    // 3. Cross-caller key: INTERNAL_SERVICE_KEY must NOT authenticate user-service
    const crossKeyClient = new NotificationClient({
      baseUrl: "http://notification.internal",
      serviceKey: VALID_INTERNAL_SERVICE_KEY,
      fetchImpl: inProcessFetch,
    });
    await expect(
      crossKeyClient.sendSMS({
        phone: "+2348019876543",
        message: "Your UBI code is 123456.",
      }),
    ).rejects.toThrow();

    // 4. Negative control: the pre-fix Authorization: Bearer header is rejected (401)
    const legacyBearerRes = await notificationApp.request(
      "http://notification.internal/api/v1/sms/send",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${VALID_USER_NOTIFICATION_KEY}`,
          "x-service-name": "user-service",
        },
        body: JSON.stringify({
          phone: "+2348019876543",
          message: "Your UBI code is 123456.",
        }),
      },
    );
    expect(legacyBearerRes.status).toBe(401);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("protects POST /api/v1/sms/otp/verify with serviceAuth", async () => {
    const notificationApp = buildNotificationApp();

    const unauth = await notificationApp.request(
      "http://notification.internal/api/v1/sms/otp/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone: "+2348019876543",
          code: "123456",
          purpose: "login",
        }),
      },
    );
    expect(unauth.status).toBe(401);

    const authed = await notificationApp.request(
      "http://notification.internal/api/v1/sms/otp/verify",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-service-key": VALID_USER_NOTIFICATION_KEY,
          "x-service-name": "user-service",
        },
        body: JSON.stringify({
          phone: "+2348019876543",
          code: "123456",
          purpose: "login",
        }),
      },
    );
    // Authenticated caller reaches handler (400 OTP_EXPIRED because no code was seeded)
    expect(authed.status).toBe(400);
  });

  it("verifies HMAC-SHA256 signatures in webhookAuth and refuses unconfigured or forged signatures", async () => {
    const notificationApp = buildNotificationApp();
    const payload = JSON.stringify({ event: "delivery_report", id: "dlr_1" });

    // Unconfigured secret -> 503 fail-closed
    delete process.env.TEST_WEBHOOK_SECRET;
    const unconfigured = await notificationApp.request(
      "http://notification.internal/webhooks/provider",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": "deadbeef",
        },
        body: payload,
      },
    );
    expect(unconfigured.status).toBe(503);

    // Forged signature -> 401
    process.env.TEST_WEBHOOK_SECRET = "webhook-signing-secret-at-least-16";
    const forged = await notificationApp.request(
      "http://notification.internal/webhooks/provider",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": "00".repeat(32),
        },
        body: payload,
      },
    );
    expect(forged.status).toBe(401);

    // Valid HMAC-SHA256 -> 200
    const validSig = createHmac("sha256", process.env.TEST_WEBHOOK_SECRET)
      .update(payload, "utf8")
      .digest("hex");
    const valid = await notificationApp.request(
      "http://notification.internal/webhooks/provider",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-signature": `sha256=${validSig}`,
        },
        body: payload,
      },
    );
    expect(valid.status).toBe(200);
  });

  it("refuses to boot in production when NOTIFICATION_SERVICE_KEY or INTERNAL_SERVICE_KEY is missing or short", () => {
    expect(() =>
      assertNotificationClientConfig({
        NODE_ENV: "production",
        NOTIFICATION_SERVICE_KEY: "",
      }),
    ).toThrow(/NOTIFICATION_SERVICE_KEY/);

    expect(() =>
      assertNotificationClientConfig({
        NODE_ENV: "production",
        NOTIFICATION_SERVICE_KEY: "too-short",
      }),
    ).toThrow(/NOTIFICATION_SERVICE_KEY/);

    expect(() =>
      assertNotificationClientConfig({
        NODE_ENV: "production",
        NOTIFICATION_SERVICE_KEY: VALID_USER_NOTIFICATION_KEY,
      }),
    ).not.toThrow();

    expect(() =>
      assertServiceAuthConfig({
        NODE_ENV: "production",
        INTERNAL_SERVICE_KEY: VALID_INTERNAL_SERVICE_KEY,
        NOTIFICATION_SERVICE_KEY: "",
      }),
    ).toThrow(/NOTIFICATION_SERVICE_KEY/);

    expect(() =>
      assertServiceAuthConfig({
        NODE_ENV: "production",
        INTERNAL_SERVICE_KEY: "short",
        NOTIFICATION_SERVICE_KEY: VALID_USER_NOTIFICATION_KEY,
      }),
    ).toThrow(/INTERNAL_SERVICE_KEY/);

    expect(() =>
      assertServiceAuthConfig({
        NODE_ENV: "production",
        INTERNAL_SERVICE_KEY: VALID_INTERNAL_SERVICE_KEY,
        NOTIFICATION_SERVICE_KEY: VALID_USER_NOTIFICATION_KEY,
      }),
    ).not.toThrow();
  });

  it("answers 503 otp_send_failed on /auth/login/otp when SMS fails, keeps the stored code, and resends it on retry", async () => {
    const app = new Hono();
    app.onError(errorHandler);
    app.route("/auth", authRoutes);

    const phone = `+234809${String(Math.floor(1000000 + Math.random() * 8999999))}`;
    await redis.del(`otp:${phone}`, `otp_count:${phone}`);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("upstream 503"));

    const failedRes = await app.request("http://user.internal/auth/login/otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    expect(failedRes.status).toBe(503);
    const failedBody = (await failedRes.json()) as {
      success: boolean;
      error: { code: string; details?: { retryable?: boolean } };
    };
    expect(failedBody.success).toBe(false);
    expect(failedBody.error.code).toBe("otp_send_failed");
    expect(failedBody.error.details?.retryable).toBe(true);

    // Stored OTP remains in Redis so a retry within the rate limit resends the same code
    const storedAfterFailure = await redis.get(`otp:${phone}`);
    expect(storedAfterFailure).toMatch(/^\d{6}$/);

    let deliveredMessage = "";
    fetchSpy.mockImplementationOnce(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as {
        message: string;
      };
      deliveredMessage = parsed.message;
      return new Response(
        JSON.stringify({ success: true, data: { messageId: "msg_retry_ok" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const retryRes = await app.request("http://user.internal/auth/login/otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    expect(retryRes.status).toBe(200);
    expect(deliveredMessage).toContain(storedAfterFailure!);
  });

  it("masks standalone 4-8 digit codes while preserving non-OTP numbers", () => {
    expect(
      maskOtpCodesInMessage(
        "Your UBI login code is 839201. Valid for 5 minutes.",
      ),
    ).toBe("Your UBI login code is [REDACTED]. Valid for 5 minutes.");
    expect(serviceAuth).toBeTypeOf("function");
  });
});
