// Auth flow — real api layer (src/api/auth.ts), mocked HTTP only
// (installFixtures). Covers signup with cityId, OTP verify → city-bound session,
// cityless existing driver → city_required → POST /v1/auth/city, rider account
// refused, and restore across cold start / near-expiry / dead refresh token / P3-05.
import {
  clearSession,
  configureApi,
  getAccessToken,
  installFixtures,
  loadSession,
  saveSession,
} from "@ubi/mobile-core";
import { authApi, restoreSession } from "../auth";

const otpAck = () => ({
  status: 200,
  json: {
    success: true,
    data: { expiresInSeconds: 300 },
  },
});

function verifyOtpFixture(
  role: "RIDER" | "DRIVER",
  opts: { cityId?: string | null; citySelectionRequired?: boolean } = {},
) {
  const cityId = opts.cityId !== undefined ? opts.cityId : "LOS";
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
          cityId,
          homeCityId: cityId,
        },
        tokens: {
          accessToken: "access-1",
          refreshToken: "refresh-1",
          expiresIn: 900,
          mode: "full",
        },
        citySelectionRequired: opts.citySelectionRequired ?? cityId === null,
      },
    },
  };
}

beforeEach(async () => {
  await clearSession();
  configureApi({ baseUrl: "http://gateway.test" });
  installFixtures(async () => undefined);
});

describe("driver auth flow", () => {
  it("signs up with operating cityId, verifies OTP, and persists city-bound driver session", async () => {
    let seenSignupBody: Record<string, unknown> | undefined;
    installFixtures(async ({ method, path, body }) => {
      if (method === "POST" && path === "/v1/auth/signup") {
        seenSignupBody = body as Record<string, unknown>;
        return {
          status: 201,
          json: {
            success: true,
            data: {
              user: { id: "u_drv_1", phone: "+2348099999999" },
              expiresInSeconds: 300,
            },
          },
        };
      }
      if (method === "POST" && path === "/v1/auth/otp") return otpAck();
      if (method === "POST" && path === "/v1/auth/verify") {
        return verifyOtpFixture("DRIVER", { cityId: "LOS" });
      }
      return undefined;
    });

    await authApi.register({
      phone: "+2348099999999",
      firstName: "Emeka",
      lastName: "Okafor",
      cityId: "LOS",
      country: "NG",
    });
    expect(seenSignupBody).toMatchObject({
      phone: "+2348099999999",
      cityId: "LOS",
      role: "DRIVER",
    });

    await authApi.requestOtp("+2348099999999");
    const outcome = await authApi.verifyOtp("+2348099999999", "654321");

    expect(outcome.result).toBe("authenticated");
    const session = await loadSession();
    expect(session?.userId).toBe("u_drv_1");
    expect(session?.role).toBe("driver");
    expect(session?.cityId).toBe("LOS");
  });

  it("routes a cityless driver to city_required until POST /v1/auth/city sets their operating city", async () => {
    installFixtures(async ({ method, path, body }) => {
      if (method === "POST" && path === "/v1/auth/verify") {
        return verifyOtpFixture("DRIVER", {
          cityId: null,
          citySelectionRequired: true,
        });
      }
      if (method === "POST" && path === "/v1/auth/city") {
        expect(body).toEqual({ cityId: "LOS" });
        return {
          status: 200,
          json: {
            success: true,
            data: {
              cityId: "LOS",
              tokens: {
                accessToken: "drv-access-los",
                refreshToken: "drv-refresh-los",
                expiresIn: 900,
                mode: "full",
              },
            },
          },
        };
      }
      return undefined;
    });

    const outcome = await authApi.verifyOtp("+2348099999999", "654321");
    expect(outcome.result).toBe("city_required");
    await expect(restoreSession()).resolves.toBe("city_required");

    await authApi.selectCity("LOS");
    await expect(restoreSession()).resolves.toBe("authenticated");
    const session = await loadSession();
    expect(session?.cityId).toBe("LOS");
    expect(session?.accessToken).toBe("drv-access-los");
  });

  it("refuses a rider account instead of saving a driver session", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/verify") {
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
      cityId: "LOS",
      expiresAt: Date.now() + 60_000,
    });
    installFixtures(async ({ method, path, body }) => {
      if (method === "POST" && path === "/v1/auth/refresh") {
        expect(body).toEqual({
          refreshToken: "refresh-old",
          deviceId: "dev_1",
        });
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

  it("mobile-core getAccessToken() unwraps {success,data:{tokens}} on sub-30s refresh (P3-05)", async () => {
    await saveSession({
      accessToken: "stale-core",
      refreshToken: "refresh-core-drv",
      userId: "u_drv_1",
      role: "driver",
      deviceId: "dev_drv_core",
      cityId: "LOS",
      expiresAt: Date.now() + 5_000,
    });
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/refresh") {
        return {
          status: 200,
          json: {
            success: true,
            data: {
              tokens: {
                accessToken: "drv-core-fresh",
                refreshToken: "drv-core-refresh",
                expiresIn: 900,
              },
            },
          },
        };
      }
      return undefined;
    });

    await expect(getAccessToken()).resolves.toBe("drv-core-fresh");
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
