// Auth flow — real api layer (src/api/auth.ts), mocked HTTP only
// (installFixtures, the same boundary mobile-core's api() checks first).
// Covers: OTP verify → session persisted, a driver account refused, restore
// with no session, and restore that refreshes a near-expiry session.
import {
  installFixtures,
  loadSession,
  clearSession,
  saveSession,
} from "@ubi/mobile-core";
import { authApi, restoreSession } from "../src/api/auth";

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
          id: "u_1",
          phone: "+2348012345678",
          email: "u1@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
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

describe("rider auth flow", () => {
  it("verifies a rider account and persists the session", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/login/otp") return otpAck();
      if (method === "POST" && path === "/v1/auth/verify-otp") {
        return verifyOtpFixture("RIDER");
      }
      return undefined;
    });

    await authApi.requestOtp("+2348012345678");
    const outcome = await authApi.verifyOtp("+2348012345678", "123456");

    expect(outcome.result).toBe("authenticated");
    const session = await loadSession();
    expect(session?.userId).toBe("u_1");
    expect(session?.role).toBe("rider");
    expect(session?.accessToken).toBe("access-1");
  });

  it("refuses a driver account instead of saving a rider session", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/verify-otp") {
        return verifyOtpFixture("DRIVER");
      }
      return undefined;
    });

    const outcome = await authApi.verifyOtp("+2348012345678", "123456");

    expect(outcome).toEqual({ result: "wrong_app", role: "driver" });
    expect(await loadSession()).toBeUndefined();
  });

  it("cold boot with no stored session restores as unauthenticated", async () => {
    await expect(restoreSession()).resolves.toBe("unauthenticated");
  });

  it("refreshes a near-expiry session on restore and adopts the new tokens", async () => {
    await saveSession({
      accessToken: "stale-access",
      refreshToken: "refresh-old",
      userId: "u_1",
      role: "rider",
      deviceId: "dev_1",
      expiresAt: Date.now() + 60_000, // inside the 10-minute refresh-ahead window
    });
    installFixtures(async ({ method, path, body }) => {
      if (method === "POST" && path === "/v1/auth/refresh") {
        expect((body as { refreshToken: string }).refreshToken).toBe(
          "refresh-old",
        );
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
    const session = await loadSession();
    expect(session?.accessToken).toBe("fresh-access");
  });

  it("clears the session when the refresh token is rejected", async () => {
    await saveSession({
      accessToken: "stale-access",
      refreshToken: "refresh-dead",
      userId: "u_1",
      role: "rider",
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

  it("logout clears the local session even if the server call fails", async () => {
    await saveSession({
      accessToken: "a",
      refreshToken: "r",
      userId: "u_1",
      role: "rider",
      deviceId: "dev_1",
      expiresAt: Date.now() + 900_000,
    });
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/logout") {
        throw new Error("network down");
      }
      return undefined;
    });

    await authApi.logout();
    expect(await loadSession()).toBeUndefined();
  });
});
