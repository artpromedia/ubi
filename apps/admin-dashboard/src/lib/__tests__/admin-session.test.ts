import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { evaluateAdminMiddleware } from "../../middleware";
import {
  ADMIN_DEVICE_COOKIE,
  ADMIN_SESSION_COOKIE,
  REFRESH_BUFFER_MS,
  isAdminConsoleRole,
  sanitizeNextPath,
  sealSessionCookie,
  unsealSessionCookie,
  type AdminSessionData,
} from "../session";
import {
  handleGatewayProxy,
  handleLogoutPost,
  handleRefreshPost,
  handleSelfieStepUpPost,
  handleSessionGet,
  handleVerifyPost,
} from "../session-handlers";

const TEST_SECRET = "test-only-admin-session-secret-with-at-least-32-chars!!";
const GATEWAY_URL = "http://gateway.ubi.internal";

function makeSession(
  overrides: Partial<AdminSessionData> = {},
): AdminSessionData {
  return {
    user: {
      id: "usr_admin_01",
      phone: "+2348011112222",
      email: "adaeze@ubi.africa",
      firstName: "Adaeze",
      lastName: "Okafor",
      role: "super_admin",
      homeCityId: "LOS",
    },
    accessToken: "jwt_access_initial",
    refreshToken: "rt_initial_token_value",
    deviceId: "adm_web_device_0001",
    mode: "full",
    expiresAt: 1_700_000_000_000 + 15 * 60 * 1000,
    stepUp: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sanitizeNextPath", () => {
  it("preserves safe internal console paths and query strings", () => {
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/marketplace/policies?city=lagos")).toBe(
      "/marketplace/policies?city=lagos",
    );
    expect(sanitizeNextPath("/ops/travel")).toBe("/ops/travel");
  });

  it("rejects open redirects, protocol-relative URLs, login loops, and API routes", () => {
    expect(sanitizeNextPath(null)).toBe("/dashboard");
    expect(sanitizeNextPath("")).toBe("/dashboard");
    expect(sanitizeNextPath("/")).toBe("/dashboard");
    expect(sanitizeNextPath("https://evil.example/steal")).toBe("/dashboard");
    expect(sanitizeNextPath("//evil.example/steal")).toBe("/dashboard");
    expect(sanitizeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(sanitizeNextPath("/login")).toBe("/dashboard");
    expect(sanitizeNextPath("/login?next=/users")).toBe("/dashboard");
    expect(sanitizeNextPath("/api/auth/logout")).toBe("/dashboard");
    expect(sanitizeNextPath("/dashboard\r\nSet-Cookie: bad=1")).toBe(
      "/dashboard",
    );
  });
});

describe("isAdminConsoleRole & cookie sealing", () => {
  it("allows operator roles and rejects end-user roles", () => {
    for (const allowed of [
      "admin",
      "SUPER_ADMIN",
      "ops_admin",
      "config_admin",
      "travel_ops",
      "support_agent",
      "growth_admin",
      "ai_ops",
    ]) {
      expect(isAdminConsoleRole(allowed), allowed).toBe(true);
    }
    for (const denied of [
      "rider",
      "RIDER",
      "driver",
      "merchant",
      "restaurant",
      "fleet_manager",
      "",
    ]) {
      expect(isAdminConsoleRole(denied), denied).toBe(false);
    }
  });

  it("round-trips a sealed session and rejects tampered or wrong-role cookies", async () => {
    const session = makeSession();
    const sealed = await sealSessionCookie(session, TEST_SECRET);
    const unsealed = await unsealSessionCookie(sealed, TEST_SECRET);
    expect(unsealed).toEqual(session);

    // Tampered payload
    const [payload, sig] = sealed.split(".");
    const tampered = `${payload}x.${sig}`;
    expect(await unsealSessionCookie(tampered, TEST_SECRET)).toBeNull();

    // Wrong secret
    expect(
      await unsealSessionCookie(
        sealed,
        "another-32-character-secret-that-does-not-match!",
      ),
    ).toBeNull();

    // Forged rider role inside a validly-signed envelope is still rejected
    const riderEnvelope = await sealSessionCookie(
      makeSession({
        user: {
          ...session.user,
          role: "rider",
        },
      }),
      TEST_SECRET,
    );
    expect(await unsealSessionCookie(riderEnvelope, TEST_SECRET)).toBeNull();
  });
});

describe("evaluateAdminMiddleware (route guard + redirects + refresh)", () => {
  const now = 1_700_000_000_000;

  it("redirects unauthenticated (admin) requests to /login?next=... and allows /login", async () => {
    const blocked = await evaluateAdminMiddleware(
      new NextRequest("http://localhost:3001/marketplace/policies?city=lagos"),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(blocked.status).toBe(307);
    expect(blocked.headers.get("location")).toBe(
      "http://localhost:3001/login?next=%2Fmarketplace%2Fpolicies%3Fcity%3Dlagos",
    );

    const loginPage = await evaluateAdminMiddleware(
      new NextRequest("http://localhost:3001/login"),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(loginPage.status).toBe(200);
  });

  it("clears a tampered cookie and redirects to /login", async () => {
    const req = new NextRequest("http://localhost:3001/ops/travel", {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=tampered.value` },
    });
    const res = await evaluateAdminMiddleware(req, {
      sessionSecret: TEST_SECRET,
      nowMs: () => now,
    });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3001/login?next=%2Fops%2Ftravel",
    );
    expect(res.headers.get("set-cookie")).toContain(
      `${ADMIN_SESSION_COOKIE}=;`,
    );
  });

  it("redirects full-mode operators away from /login to validated next path (blocking open redirects)", async () => {
    const sealed = await sealSessionCookie(makeSession(), TEST_SECRET);

    const validNext = await evaluateAdminMiddleware(
      new NextRequest(
        "http://localhost:3001/login?next=%2Fops%2Ftravel%3Ftab%3Dopen",
        { headers: { cookie: `${ADMIN_SESSION_COOKIE}=${sealed}` } },
      ),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(validNext.status).toBe(307);
    expect(validNext.headers.get("location")).toBe(
      "http://localhost:3001/ops/travel?tab=open",
    );

    const evilNext = await evaluateAdminMiddleware(
      new NextRequest("http://localhost:3001/login?next=https://evil.test", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${sealed}` },
      }),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(evilNext.status).toBe(307);
    expect(evilNext.headers.get("location")).toBe(
      "http://localhost:3001/dashboard",
    );
  });

  it("keeps limited-mode operators on /login when finishing step-up", async () => {
    const limited = await sealSessionCookie(
      makeSession({
        mode: "limited",
        stepUp: {
          required: true,
          challengeId: "chal_123",
          methods: ["old_device_approve", "selfie_nin"],
        },
      }),
      TEST_SECRET,
    );
    const res = await evaluateAdminMiddleware(
      new NextRequest("http://localhost:3001/login", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${limited}` },
      }),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(res.status).toBe(200);
  });

  it("rotates the HttpOnly session cookie in middleware before access-token expiry", async () => {
    const nearExpiry = makeSession({
      expiresAt: now + REFRESH_BUFFER_MS - 1_000,
    });
    const sealed = await sealSessionCookie(nearExpiry, TEST_SECRET);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          user: nearExpiry.user,
          tokens: {
            accessToken: "jwt_access_rotated",
            refreshToken: "rt_rotated_value",
            expiresIn: 900,
            mode: "full",
          },
        },
      }),
    );

    const res = await evaluateAdminMiddleware(
      new NextRequest("http://localhost:3001/dashboard", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${sealed}` },
      }),
      {
        gatewayUrl: GATEWAY_URL,
        fetchImpl: fetchMock,
        sessionSecret: TEST_SECRET,
        nowMs: () => now,
      },
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const rotatedCookie = res.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    expect(rotatedCookie).toBeTruthy();
    const decoded = await unsealSessionCookie(rotatedCookie, TEST_SECRET);
    expect(decoded?.accessToken).toBe("jwt_access_rotated");
    expect(decoded?.refreshToken).toBe("rt_rotated_value");
  });
});

describe("session route handlers (verify, negative role refusal, refresh, step-up, proxy, logout)", () => {
  const now = 1_700_000_000_000;

  it("sets HttpOnly, SameSite=Strict, Secure cookies on admin OTP verify and strips raw tokens from JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          user: {
            id: "usr_super_1",
            phone: "+2348011112222",
            email: "super@ubi.africa",
            firstName: "Adaeze",
            lastName: "Okafor",
            role: "SUPER_ADMIN",
            homeCityId: "LOS",
          },
          stepUp: { required: false, challengeId: null, methods: [] },
          tokens: {
            accessToken: "secret_access_jwt",
            refreshToken: "secret_refresh_tok",
            expiresIn: 900,
            mode: "full",
          },
        },
      }),
    );

    const req = new NextRequest("https://admin.ubi.africa/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+2348011112222", code: "123456" }),
    });

    const res = await handleVerifyPost(req, {
      gatewayUrl: GATEWAY_URL,
      fetchImpl: fetchMock,
      sessionSecret: TEST_SECRET,
      nowMs: () => now,
    });

    expect(res.status).toBe(200);
    const rawText = await res.text();
    expect(rawText).not.toContain("secret_access_jwt");
    expect(rawText).not.toContain("secret_refresh_tok");

    const setCookieHeader = res.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(setCookieHeader).toContain(`${ADMIN_DEVICE_COOKIE}=`);
    expect(setCookieHeader).toMatch(/HttpOnly/i);
    expect(setCookieHeader).toMatch(/SameSite=Strict/i);
    expect(setCookieHeader).toMatch(/Secure/i);
  });

  it("NEGATIVE CONTROL: refuses a rider/driver OTP login with 403, revokes upstream session, and sets no session cookie", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            user: {
              id: "usr_rider_99",
              phone: "+2348099998888",
              email: "rider@example.com",
              firstName: "Tunde",
              lastName: "Rider",
              role: "RIDER",
              homeCityId: "LOS",
            },
            stepUp: { required: false, challengeId: null, methods: [] },
            tokens: {
              accessToken: "rider_access_jwt",
              refreshToken: "rider_refresh_tok",
              expiresIn: 900,
              mode: "full",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: { message: "Logged out" } }),
      );

    const req = new NextRequest("https://admin.ubi.africa/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+2348099998888", code: "654321" }),
    });

    const res = await handleVerifyPost(req, {
      gatewayUrl: GATEWAY_URL,
      fetchImpl: fetchMock,
      sessionSecret: TEST_SECRET,
      nowMs: () => now,
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toMatch(/operator access/i);

    // Must have called upstream /v1/auth/logout immediately to kill the session
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${GATEWAY_URL}/v1/auth/logout`);

    // Session cookie is cleared (empty value, Max-Age=0), never populated
    expect(res.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? "").toBe("");
  });

  it("upgrades a limited-mode cookie to full mode when selfie step-up passes", async () => {
    const limited = makeSession({
      mode: "limited",
      stepUp: {
        required: true,
        challengeId: "chal_step_01",
        methods: ["selfie_nin"],
      },
    });
    const sealed = await sealSessionCookie(limited, TEST_SECRET);

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          status: "passed",
          challengeId: "chal_step_01",
          score: 0.96,
          reason: null,
          appealPath: null,
          appealMessage: null,
          token: {
            accessToken: "jwt_full_after_step_up",
            expiresIn: 900,
            mode: "full",
          },
        },
      }),
    );

    const req = new NextRequest(
      "https://admin.ubi.africa/api/auth/step-up/selfie",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${ADMIN_SESSION_COOKIE}=${sealed}`,
        },
        body: JSON.stringify({
          challengeId: "chal_step_01",
          nin: "12345678901",
          imageBase64: "A".repeat(128),
        }),
      },
    );

    const res = await handleSelfieStepUpPost(req, {
      gatewayUrl: GATEWAY_URL,
      fetchImpl: fetchMock,
      sessionSecret: TEST_SECRET,
      nowMs: () => now,
    });

    expect(res.status).toBe(200);
    const updatedCookie = res.cookies.get(ADMIN_SESSION_COOKIE)?.value;
    const unsealed = await unsealSessionCookie(updatedCookie, TEST_SECRET);
    expect(unsealed?.mode).toBe("full");
    expect(unsealed?.stepUp).toBeNull();
    expect(unsealed?.accessToken).toBe("jwt_full_after_step_up");
  });

  it("proxies /api/gateway/v1/* with server-injected Bearer token, refreshes before expiry, and blocks non-/v1 paths", async () => {
    const nearExpiry = makeSession({
      expiresAt: now + REFRESH_BUFFER_MS - 500,
    });
    const sealed = await sealSessionCookie(nearExpiry, TEST_SECRET);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            user: nearExpiry.user,
            tokens: {
              accessToken: "jwt_fresh_for_proxy",
              refreshToken: "rt_fresh_for_proxy",
              expiresIn: 900,
              mode: "full",
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ action: "chase_refund" }));

    const req = new NextRequest(
      "http://localhost:3001/api/gateway/v1/ops/travel/exceptions/ord%2F1/actions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "idempotency-key": "idem-proxy-key-01",
          cookie: `${ADMIN_SESSION_COOKIE}=${sealed}`,
        },
        body: JSON.stringify({ action: "chase_refund" }),
      },
    );

    const res = await handleGatewayProxy(
      req,
      ["v1", "ops", "travel", "exceptions", "ord/1", "actions"],
      {
        gatewayUrl: GATEWAY_URL,
        fetchImpl: fetchMock,
        sessionSecret: TEST_SECRET,
        nowMs: () => now,
      },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ action: "chase_refund" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${GATEWAY_URL}/v1/ops/travel/exceptions/ord%2F1/actions`,
    );
    const proxyHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(proxyHeaders.Authorization).toBe("Bearer jwt_fresh_for_proxy");
    expect(proxyHeaders["idempotency-key"]).toBe("idem-proxy-key-01");

    // Non-/v1 (/internal/*) paths are strictly blocked
    const internalAttempt = await handleGatewayProxy(
      new NextRequest(
        "http://localhost:3001/api/gateway/internal/fleet/active",
        { headers: { cookie: `${ADMIN_SESSION_COOKIE}=${sealed}` } },
      ),
      ["internal", "fleet", "active"],
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(internalAttempt.status).toBe(404);
  });

  it("handles GET /api/auth/session, POST /api/auth/refresh, and clears + revokes on POST /api/auth/logout", async () => {
    const session = makeSession();
    const sealed = await sealSessionCookie(session, TEST_SECRET);

    const getRes = await handleSessionGet(
      new NextRequest("http://localhost:3001/api/auth/session", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${sealed}` },
      }),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      data: { session: { user: { role: string }; accessToken?: string } };
    };
    expect(getBody.data.session.user.role).toBe("super_admin");
    expect(getBody.data.session.accessToken).toBeUndefined();

    const refreshFetch = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          user: session.user,
          tokens: {
            accessToken: "jwt_manual_refresh",
            refreshToken: "rt_manual_refresh",
            expiresIn: 900,
            mode: "full",
          },
        },
      }),
    );
    const refreshRes = await handleRefreshPost(
      new NextRequest("http://localhost:3001/api/auth/refresh", {
        method: "POST",
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${sealed}` },
      }),
      {
        gatewayUrl: GATEWAY_URL,
        fetchImpl: refreshFetch,
        sessionSecret: TEST_SECRET,
        nowMs: () => now,
      },
    );
    expect(refreshRes.status).toBe(200);

    const logoutFetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }));
    const logoutRes = await handleLogoutPost(
      new NextRequest("http://localhost:3001/api/auth/logout", {
        method: "POST",
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${sealed}` },
      }),
      {
        gatewayUrl: GATEWAY_URL,
        fetchImpl: logoutFetch,
        sessionSecret: TEST_SECRET,
      },
    );
    expect(logoutRes.status).toBe(200);
    expect(logoutFetch).toHaveBeenCalledWith(
      `${GATEWAY_URL}/v1/auth/logout`,
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(logoutRes.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? "").toBe("");
  });
});
