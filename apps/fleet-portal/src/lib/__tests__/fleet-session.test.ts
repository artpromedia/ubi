import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { evaluateFleetMiddleware } from "../../middleware";
import {
  FLEET_DEVICE_COOKIE,
  FLEET_SESSION_COOKIE,
  REFRESH_BUFFER_MS,
  isFleetPortalRole,
  sanitizeNextPath,
  sealSessionCookie,
  unsealSessionCookie,
  type FleetSessionData,
} from "../session";
import {
  handleApproveStepUpPost,
  handleGatewayProxy,
  handleLogoutPost,
  handleRefreshPost,
  handleSelectCityPost,
  handleSelfieStepUpPost,
  handleSessionGet,
  handleVerifyPost,
} from "../session-handlers";

const TEST_SECRET = "test-only-fleet-session-secret-with-at-least-32-chars!!";
const GATEWAY_URL = "http://gateway.ubi.internal";

function makeSession(
  overrides: Partial<FleetSessionData> = {},
): FleetSessionData {
  return {
    user: {
      id: "usr_fleet_01",
      phone: "+2348011112222",
      email: "adewale@fleet.example",
      firstName: "Adewale",
      lastName: "Balogun",
      role: "fleet_manager",
      homeCityId: "LOS",
    },
    accessToken: "jwt_access_initial",
    refreshToken: "rt_initial_token_value",
    deviceId: "flt_web_device_0001",
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
  it("preserves safe internal portal paths and query strings", () => {
    expect(sanitizeNextPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeNextPath("/calendar?zoom=week")).toBe("/calendar?zoom=week");
    expect(sanitizeNextPath("/vehicles")).toBe("/vehicles");
  });

  it("rejects open redirects, protocol-relative URLs, login loops, and API routes", () => {
    expect(sanitizeNextPath(null)).toBe("/dashboard");
    expect(sanitizeNextPath("")).toBe("/dashboard");
    expect(sanitizeNextPath("/")).toBe("/dashboard");
    expect(sanitizeNextPath("https://evil.example/steal")).toBe("/dashboard");
    expect(sanitizeNextPath("//evil.example/steal")).toBe("/dashboard");
    expect(sanitizeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(sanitizeNextPath("/login")).toBe("/dashboard");
    expect(sanitizeNextPath("/login?next=/vehicles")).toBe("/dashboard");
    expect(sanitizeNextPath("/api/auth/logout")).toBe("/dashboard");
    expect(sanitizeNextPath("/dashboard\r\nSet-Cookie: bad=1")).toBe(
      "/dashboard",
    );
  });
});

describe("isFleetPortalRole & cookie sealing (DEC-4 = A)", () => {
  it("allows UBI roles holding fleet:read/fleet:manage and rejects merchant/support roles", () => {
    for (const allowed of [
      "rider",
      "RIDER",
      "driver",
      "DRIVER",
      "fleet_manager",
      "FLEET_MANAGER",
      "admin",
      "super_admin",
    ]) {
      expect(isFleetPortalRole(allowed), allowed).toBe(true);
    }
    for (const denied of [
      "merchant",
      "MERCHANT",
      "restaurant",
      "support_agent",
      "travel_ops",
      "",
    ]) {
      expect(isFleetPortalRole(denied), denied).toBe(false);
    }
  });

  it("round-trips a sealed session and rejects tampered or wrong-role cookies", async () => {
    const session = makeSession();
    const sealed = await sealSessionCookie(session, TEST_SECRET);
    const unsealed = await unsealSessionCookie(sealed, TEST_SECRET);
    expect(unsealed).toEqual(session);

    const [payload, sig] = sealed.split(".");
    const tampered = `${payload}x.${sig}`;
    expect(await unsealSessionCookie(tampered, TEST_SECRET)).toBeNull();

    expect(
      await unsealSessionCookie(
        sealed,
        "another-32-character-secret-that-does-not-match!",
      ),
    ).toBeNull();

    const merchantEnvelope = await sealSessionCookie(
      makeSession({
        user: {
          ...session.user,
          role: "merchant",
        },
      }),
      TEST_SECRET,
    );
    expect(await unsealSessionCookie(merchantEnvelope, TEST_SECRET)).toBeNull();
  });
});

describe("evaluateFleetMiddleware (route guard + redirects + refresh)", () => {
  const now = 1_700_000_000_000;

  it("redirects unauthenticated portal requests to /login?next=... and allows /login", async () => {
    const blocked = await evaluateFleetMiddleware(
      new NextRequest("http://localhost:3004/calendar?zoom=week"),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(blocked.status).toBe(307);
    expect(blocked.headers.get("location")).toBe(
      "http://localhost:3004/login?next=%2Fcalendar%3Fzoom%3Dweek",
    );

    const loginPage = await evaluateFleetMiddleware(
      new NextRequest("http://localhost:3004/login"),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(loginPage.status).toBe(200);
  });

  it("redirects to /login?reason=session_ended when an expired session cannot refresh (signed out elsewhere)", async () => {
    const expired = makeSession({
      expiresAt: now - 10_000,
    });
    const sealed = await sealSessionCookie(expired, TEST_SECRET);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: { code: "invalid_token", message: "Session revoked" },
        },
        401,
      ),
    );

    const res = await evaluateFleetMiddleware(
      new NextRequest("http://localhost:3004/vehicles", {
        headers: { cookie: `${FLEET_SESSION_COOKIE}=${sealed}` },
      }),
      {
        sessionSecret: TEST_SECRET,
        gatewayUrl: GATEWAY_URL,
        fetchImpl: fetchMock,
        nowMs: () => now,
      },
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3004/login?reason=session_ended&next=%2Fvehicles",
    );
    expect(res.headers.get("set-cookie")).toContain(
      `${FLEET_SESSION_COOKIE}=;`,
    );
  });

  it("redirects full-mode users with a home city away from /login, but keeps limited-mode or cityless users on /login", async () => {
    const fullSealed = await sealSessionCookie(makeSession(), TEST_SECRET);
    const resFull = await evaluateFleetMiddleware(
      new NextRequest("http://localhost:3004/login?next=%2Fvehicles", {
        headers: { cookie: `${FLEET_SESSION_COOKIE}=${fullSealed}` },
      }),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(resFull.status).toBe(307);
    expect(resFull.headers.get("location")).toBe(
      "http://localhost:3004/vehicles",
    );

    const limitedSealed = await sealSessionCookie(
      makeSession({
        mode: "limited",
        stepUp: {
          required: true,
          challengeId: "chal_flt_99",
          methods: ["old_device_approve", "selfie_nin"],
        },
      }),
      TEST_SECRET,
    );
    const resLimited = await evaluateFleetMiddleware(
      new NextRequest("http://localhost:3004/login", {
        headers: { cookie: `${FLEET_SESSION_COOKIE}=${limitedSealed}` },
      }),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(resLimited.status).toBe(200);

    const citylessSealed = await sealSessionCookie(
      makeSession({
        user: { ...makeSession().user, homeCityId: null },
      }),
      TEST_SECRET,
    );
    const resCityless = await evaluateFleetMiddleware(
      new NextRequest("http://localhost:3004/login", {
        headers: { cookie: `${FLEET_SESSION_COOKIE}=${citylessSealed}` },
      }),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(resCityless.status).toBe(200);
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

    const res = await evaluateFleetMiddleware(
      new NextRequest("http://localhost:3004/dashboard", {
        headers: { cookie: `${FLEET_SESSION_COOKIE}=${sealed}` },
      }),
      {
        sessionSecret: TEST_SECRET,
        gatewayUrl: GATEWAY_URL,
        fetchImpl: fetchMock,
        nowMs: () => now,
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${FLEET_SESSION_COOKIE}=`);
  });
});

describe("session-handlers (OTP verify, city selection, step-up, refresh, logout, gateway proxy)", () => {
  const now = 1_700_000_000_000;

  it("sets HttpOnly SameSite=Strict session + device cookies for fleet staff and revokes disallowed roles (negative control)", async () => {
    const fetchAllowed = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          user: {
            id: "usr_flt_1",
            phone: "+2348011112222",
            email: "adewale@fleet.example",
            firstName: "Adewale",
            lastName: "Balogun",
            role: "RIDER",
            homeCityId: "LOS",
          },
          stepUp: { required: false, challengeId: null, methods: [] },
          tokens: {
            accessToken: "jwt_acc_1",
            refreshToken: "rt_1",
            expiresIn: 900,
            mode: "full",
          },
        },
      }),
    );

    const reqAllowed = new NextRequest(
      "https://fleet.ubi.africa/api/auth/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+2348011112222", code: "123456" }),
      },
    );
    const resAllowed = await handleVerifyPost(reqAllowed, {
      sessionSecret: TEST_SECRET,
      gatewayUrl: GATEWAY_URL,
      fetchImpl: fetchAllowed,
      nowMs: () => now,
    });
    expect(resAllowed.status).toBe(200);
    const setCookieHeader = resAllowed.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain(`${FLEET_SESSION_COOKIE}=`);
    expect(setCookieHeader).toContain(`${FLEET_DEVICE_COOKIE}=`);
    expect(setCookieHeader).toMatch(/HttpOnly/i);
    expect(setCookieHeader).toMatch(/SameSite=strict/i);

    const bodyAllowed = (await resAllowed.json()) as {
      data?: { session?: Record<string, unknown> };
    };
    expect(bodyAllowed.data?.session?.accessToken).toBeUndefined();
    expect(bodyAllowed.data?.session?.refreshToken).toBeUndefined();

    // Negative control: MERCHANT account is refused with 403 and upstream session is revoked
    const fetchMerchant = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            user: {
              id: "usr_merch_1",
              phone: "+2348099998888",
              email: "shop@merchant.example",
              firstName: "Shop",
              lastName: "Owner",
              role: "MERCHANT",
              homeCityId: "LOS",
            },
            tokens: {
              accessToken: "jwt_merch_acc",
              refreshToken: "rt_merch",
              expiresIn: 900,
              mode: "full",
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    const reqMerchant = new NextRequest(
      "https://fleet.ubi.africa/api/auth/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+2348099998888", code: "654321" }),
      },
    );
    const resMerchant = await handleVerifyPost(reqMerchant, {
      sessionSecret: TEST_SECRET,
      gatewayUrl: GATEWAY_URL,
      fetchImpl: fetchMerchant,
      nowMs: () => now,
    });
    expect(resMerchant.status).toBe(403);
    expect(fetchMerchant).toHaveBeenCalledTimes(2);
    expect(fetchMerchant.mock.calls[1]?.[0]).toBe(
      `${GATEWAY_URL}/v1/auth/logout`,
    );
  });

  it("handles city selection (POST /api/auth/city) and updates the sealed session cookie with homeCityId", async () => {
    const cityless = makeSession({
      user: { ...makeSession().user, homeCityId: null },
    });
    const sealed = await sealSessionCookie(cityless, TEST_SECRET);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          cityId: "LOS",
          tokens: {
            accessToken: "jwt_with_city",
            refreshToken: "rt_with_city",
            expiresIn: 900,
            mode: "full",
          },
        },
      }),
    );

    const req = new NextRequest("http://localhost:3004/api/auth/city", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: `${FLEET_SESSION_COOKIE}=${sealed}`,
      },
      body: JSON.stringify({ cityId: "LOS" }),
    });
    const res = await handleSelectCityPost(req, {
      sessionSecret: TEST_SECRET,
      gatewayUrl: GATEWAY_URL,
      fetchImpl: fetchMock,
      nowMs: () => now,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { session?: { user?: { homeCityId?: string } } };
    };
    expect(body.data?.session?.user?.homeCityId).toBe("LOS");
  });

  it("handles selfie step-up, trusted-device approval, session read, refresh, logout, and gateway proxy with Idempotency-Key forwarding", async () => {
    const limited = makeSession({
      mode: "limited",
      stepUp: {
        required: true,
        challengeId: "chal_flt_01",
        methods: ["old_device_approve", "selfie_nin"],
      },
    });
    const sealedLimited = await sealSessionCookie(limited, TEST_SECRET);

    // Limited session cannot approve another device
    const reqApproveLimited = new NextRequest(
      "http://localhost:3004/api/auth/step-up/approve",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${FLEET_SESSION_COOKIE}=${sealedLimited}`,
        },
        body: JSON.stringify({ challengeId: "chal_other" }),
      },
    );
    const resApproveLimited = await handleApproveStepUpPost(reqApproveLimited, {
      sessionSecret: TEST_SECRET,
    });
    expect(resApproveLimited.status).toBe(403);

    // Selfie step-up upgrades session to full mode
    const fetchSelfie = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          status: "passed",
          challengeId: "chal_flt_01",
          score: 0.96,
          reason: null,
          appealPath: null,
          appealMessage: null,
          token: {
            accessToken: "jwt_full_after_stepup",
            expiresIn: 900,
            mode: "full",
          },
        },
      }),
    );
    const reqSelfie = new NextRequest(
      "http://localhost:3004/api/auth/step-up/selfie",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: `${FLEET_SESSION_COOKIE}=${sealedLimited}`,
        },
        body: JSON.stringify({
          challengeId: "chal_flt_01",
          nin: "12345678901",
          imageBase64: "A".repeat(80),
        }),
      },
    );
    const resSelfie = await handleSelfieStepUpPost(reqSelfie, {
      sessionSecret: TEST_SECRET,
      gatewayUrl: GATEWAY_URL,
      fetchImpl: fetchSelfie,
      nowMs: () => now,
    });
    expect(resSelfie.status).toBe(200);
    const selfieBody = (await resSelfie.json()) as {
      data?: { session?: { mode?: string } };
    };
    expect(selfieBody.data?.session?.mode).toBe("full");

    // Gateway proxy forwards Authorization Bearer and Idempotency-Key
    const fullSealed = await sealSessionCookie(makeSession(), TEST_SECRET);
    const fetchProxy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ fleets: [] }, 200));
    const reqProxy = new NextRequest(
      "http://localhost:3004/api/gateway/v1/fleets?city=LOS",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "idem-fleet-create-01",
          cookie: `${FLEET_SESSION_COOKIE}=${fullSealed}`,
        },
        body: JSON.stringify({ name: "Lagos Express" }),
      },
    );
    const resProxy = await handleGatewayProxy(reqProxy, ["v1", "fleets"], {
      sessionSecret: TEST_SECRET,
      gatewayUrl: GATEWAY_URL,
      fetchImpl: fetchProxy,
      nowMs: () => now,
    });
    expect(resProxy.status).toBe(200);
    const proxiedInit = fetchProxy.mock.calls[0]?.[1] as RequestInit;
    const proxiedHeaders = proxiedInit.headers as Record<string, string>;
    expect(proxiedHeaders.Authorization).toBe("Bearer jwt_access_initial");
    expect(proxiedHeaders["idempotency-key"]).toBe("idem-fleet-create-01");

    // Session GET + Refresh + Logout
    const resSession = await handleSessionGet(
      new NextRequest("http://localhost:3004/api/auth/session", {
        headers: { cookie: `${FLEET_SESSION_COOKIE}=${fullSealed}` },
      }),
      { sessionSecret: TEST_SECRET, nowMs: () => now },
    );
    expect(resSession.status).toBe(200);

    const fetchRefreshFail = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { success: false, error: { code: "session_revoked" } },
          401,
        ),
      );
    const resRefreshFail = await handleRefreshPost(
      new NextRequest("http://localhost:3004/api/auth/refresh", {
        method: "POST",
        headers: { cookie: `${FLEET_SESSION_COOKIE}=${fullSealed}` },
      }),
      {
        sessionSecret: TEST_SECRET,
        gatewayUrl: GATEWAY_URL,
        fetchImpl: fetchRefreshFail,
        nowMs: () => now,
      },
    );
    expect(resRefreshFail.status).toBe(401);
    const refreshFailBody = (await resRefreshFail.json()) as {
      error?: { code?: string };
    };
    expect(refreshFailBody.error?.code).toBe("session_ended");

    const fetchLogout = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }));
    const resLogout = await handleLogoutPost(
      new NextRequest("http://localhost:3004/api/auth/logout", {
        method: "POST",
        headers: { cookie: `${FLEET_SESSION_COOKIE}=${fullSealed}` },
      }),
      {
        sessionSecret: TEST_SECRET,
        gatewayUrl: GATEWAY_URL,
        fetchImpl: fetchLogout,
      },
    );
    expect(resLogout.status).toBe(200);
    expect(resLogout.headers.get("set-cookie")).toContain(
      `${FLEET_SESSION_COOKIE}=;`,
    );
  });
});
