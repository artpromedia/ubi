// Auth flow — real api layer (src/api/auth.ts), mocked HTTP only
// (installFixtures, the same boundary mobile-core's api() and session refresh check).
// Covers: signup with launched cityId, OTP verify → city-bound session persisted,
// cityless existing user → city_required → POST /v1/auth/city → authenticated,
// driver account refused, refresh rotation, and mobile-core getAccessToken() envelope refresh.
import {
  clearSession,
  configureApi,
  getAccessToken,
  installFixtures,
  loadSession,
  saveSession,
} from "@ubi/mobile-core";
import {
  authApi,
  isCitySelectionRequiredError,
  restoreSession,
} from "../src/api/auth";

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
          id: "u_1",
          phone: "+2348012345678",
          email: "u1@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
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

describe("rider auth flow", () => {
  it("lists launched cities, signs up with cityId, verifies OTP, and persists cityId on session", async () => {
    let seenSignupBody: Record<string, unknown> | undefined;
    let seenVerifyBody: Record<string, unknown> | undefined;

    installFixtures(async ({ method, path, body }) => {
      if (method === "GET" && path === "/v1/auth/cities") {
        return {
          status: 200,
          json: {
            success: true,
            data: {
              cities: [{ id: "LOS", name: "Lagos", country: "NG" }],
            },
          },
        };
      }
      if (method === "POST" && path === "/v1/auth/signup") {
        seenSignupBody = body as Record<string, unknown>;
        return {
          status: 201,
          json: {
            success: true,
            data: {
              user: { id: "u_1", phone: "+2348012345678" },
              expiresInSeconds: 300,
            },
          },
        };
      }
      if (method === "POST" && path === "/v1/auth/otp") return otpAck();
      if (method === "POST" && path === "/v1/auth/verify") {
        seenVerifyBody = body as Record<string, unknown>;
        return verifyOtpFixture("RIDER", { cityId: "LOS" });
      }
      return undefined;
    });

    const cities = await authApi.listCities();
    expect(cities).toEqual([{ id: "LOS", name: "Lagos", country: "NG" }]);

    await authApi.register({
      phone: "+2348012345678",
      firstName: "Ada",
      lastName: "Lovelace",
      cityId: "LOS",
      country: "NG",
    });
    expect(seenSignupBody).toMatchObject({
      phone: "+2348012345678",
      cityId: "LOS",
      role: "RIDER",
    });

    await authApi.requestOtp("+2348012345678");
    const outcome = await authApi.verifyOtp("+2348012345678", "123456");

    expect(outcome.result).toBe("authenticated");
    expect(typeof seenVerifyBody?.deviceId).toBe("string");
    const session = await loadSession();
    expect(session?.userId).toBe("u_1");
    expect(session?.role).toBe("rider");
    expect(session?.cityId).toBe("LOS");
    expect(session?.accessToken).toBe("access-1");
  });

  it("routes a cityless account to city_required, then upgrades session via POST /v1/auth/city", async () => {
    installFixtures(async ({ method, path, body }) => {
      if (method === "POST" && path === "/v1/auth/verify") {
        return verifyOtpFixture("RIDER", {
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
                accessToken: "access-los",
                refreshToken: "refresh-los",
                expiresIn: 900,
                mode: "full",
              },
            },
          },
        };
      }
      return undefined;
    });

    const outcome = await authApi.verifyOtp("+2348012345678", "123456");
    expect(outcome.result).toBe("city_required");
    await expect(restoreSession()).resolves.toBe("city_required");

    await authApi.selectCity("LOS");
    await expect(restoreSession()).resolves.toBe("authenticated");
    const updated = await loadSession();
    expect(updated?.cityId).toBe("LOS");
    expect(updated?.accessToken).toBe("access-los");
  });

  it("unwraps 409 city_selection_required envelopes into ApiError.code", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/city") {
        return {
          status: 409,
          json: {
            success: false,
            error: {
              code: "city_selection_required",
              message: "Select your home city before continuing.",
            },
          },
        };
      }
      return undefined;
    });

    let caught: unknown;
    try {
      await authApi.selectCity("LOS");
    } catch (err) {
      caught = err;
    }
    expect(isCitySelectionRequiredError(caught)).toBe(true);
  });

  it("refuses a driver account instead of saving a rider session", async () => {
    installFixtures(async ({ method, path }) => {
      if (method === "POST" && path === "/v1/auth/verify") {
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
      cityId: "LOS",
      expiresAt: Date.now() + 60_000, // inside the 10-minute refresh-ahead window
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
    const session = await loadSession();
    expect(session?.accessToken).toBe("fresh-access");
    expect(session?.cityId).toBe("LOS");
  });

  it("mobile-core getAccessToken() refreshes <30s sessions via {success,data:{tokens}} (P3-05)", async () => {
    await saveSession({
      accessToken: "expiring-now",
      refreshToken: "refresh-core-1",
      userId: "u_1",
      role: "rider",
      deviceId: "dev_core_1",
      cityId: "LOS",
      expiresAt: Date.now() + 5_000,
    });
    installFixtures(async ({ method, path, body }) => {
      if (method === "POST" && path === "/v1/auth/refresh") {
        expect(body).toEqual({
          refreshToken: "refresh-core-1",
          deviceId: "dev_core_1",
        });
        return {
          status: 200,
          json: {
            success: true,
            data: {
              tokens: {
                accessToken: "core-fresh-access",
                refreshToken: "core-fresh-refresh",
                expiresIn: 900,
              },
            },
          },
        };
      }
      return undefined;
    });

    await expect(getAccessToken()).resolves.toBe("core-fresh-access");
    const session = await loadSession();
    expect(session?.refreshToken).toBe("core-fresh-refresh");
    expect(session?.cityId).toBe("LOS");
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
