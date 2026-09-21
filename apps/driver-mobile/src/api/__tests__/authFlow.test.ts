// Auth flow — real api layer (src/api/auth.ts), mocked HTTP only
// (installFixtures). Covers OTP verify → session persisted, a rider account
// refused, and restore across cold start / near-expiry / dead refresh token.
import {
  installFixtures,
  loadSession,
  clearSession,
  saveSession,
} from "@ubi/mobile-core";
import { authApi, restoreSession } from "../auth";

const otpAck = () => ({
  status: 200,
  json: {
    success: true,
    data: { message: "OTP sent successfully", expiresIn: 300 },
  },
});

function verifyOtpFixture(role: "RIDER" | "DRIVER") {
  return {
    status: 200,
    json: {
      success: true,
      data: {
        user: {
          id: "u_drv_1",
          phone: "+2348099999999",
          email: "d1@example.com",
          firstName: "Emeka",
          lastName: "Okafor",
          role,
          status: "ACTIVE",
        },
        tokens: {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          expiresIn: 900,
        },
      },
    },
  };
}

beforeEach(async () => {
  await clearSession();
  installFixtures(async () => undefined);
});

describe("driver auth flow", () => {
  it("verifies a driver account and persists the session", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/login/otp") return otpAck();
      if (method === "POST" && path === "/v1/auth/verify-otp") {
        return verifyOtpFixture("DRIVER");
      }
      return undefined;
    });

    await authApi.requestOtp("+2348099999999");
    const outcome = await authApi.verifyOtp("+2348099999999", "654321");

    expect(outcome.result).toBe("authenticated");
    const session = await loadSession();
    expect(session?.userId).toBe("u_drv_1");
    expect(session?.role).toBe("driver");
  });

  it("refuses a rider account instead of saving a driver session", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/verify-otp") {
        return verifyOtpFixture("RIDER");
      }
      return undefined;
    });

    const outcome = await authApi.verifyOtp("+2348099999999", "654321");

    expect(outcome).toEqual({ result: "wrong_app", role: "rider" });
    expect(await loadSession()).toBeUndefined();
  });

  it("cold boot with no stored session restores as unauthenticated", async () => {
    await expect(restoreSession()).resolves.toBe("unauthenticated");
  });

  it("a stored RIDER session on this app is cleared, not adopted", async () => {
    await saveSession({
      accessToken: "a",
      refreshToken: "r",
      userId: "u_1",
      role: "rider",
      deviceId: "dev_1",
      expiresAt: Date.now() + 900_000,
    });
    await expect(restoreSession()).resolves.toBe("unauthenticated");
    expect(await loadSession()).toBeUndefined();
  });

  it("refreshes a near-expiry session on restore and adopts the new tokens", async () => {
    await saveSession({
      accessToken: "stale-access",
      refreshToken: "refresh-old",
      userId: "u_drv_1",
      role: "driver",
      deviceId: "dev_1",
      expiresAt: Date.now() + 60_000,
    });
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/refresh") {
        return {
          status: 200,
          json: {
            success: true,
            data: {
              tokens: {
                accessToken: "fresh-access",
                refreshToken: "fresh-refresh",
                expiresIn: 900,
              },
            },
          },
        };
      }
      return undefined;
    });

    await expect(restoreSession()).resolves.toBe("authenticated");
    expect((await loadSession())?.accessToken).toBe("fresh-access");
  });

  it("a dead refresh token clears the session rather than looping", async () => {
    await saveSession({
      accessToken: "stale-access",
      refreshToken: "refresh-dead",
      userId: "u_drv_1",
      role: "driver",
      deviceId: "dev_1",
      expiresAt: Date.now() + 60_000,
    });
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/refresh") {
        return {
          status: 401,
          json: {
            code: "session_expired",
            message: "Session expired. Please login again.",
          },
        };
      }
      return undefined;
    });

    await expect(restoreSession()).resolves.toBe("unauthenticated");
    expect(await loadSession()).toBeUndefined();
  });
});
