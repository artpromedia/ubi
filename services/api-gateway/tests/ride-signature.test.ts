/**
 * The ride-service HMAC context: the gateway must overwrite any forged
 * `x-auth-*` signature headers with its own, sign the exact canonical payload
 * the Go verifier reconstructs (`ubi.internal.v1|user|role|city|issuedAt`),
 * sign with the FIRST configured key so rotation has no flag day, and send
 * nothing when no key is configured.
 *
 * The parity fixture here is ALSO asserted by the Go side
 * (services/ride-service/internal/handler/ride_test.go,
 * TestSigningParityWithTheGateway) — change one and the other goes red.
 */
import "./env";

import { createHmac } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import {
  rideContextPayload,
  signRideContext,
} from "../src/identity/ride-context";
import { setIdentityStateStore } from "../src/lib/redis";
import {
  clientToken,
  openRiskStore,
  startUpstream,
  type Upstream,
} from "./helpers";

const RIDE_SECRET = "gateway-test-ride-context-secret-01";
const PREVIOUS_RIDE_SECRET = "gateway-test-ride-context-secret-00";

let upstream: Upstream;
const app = createApp("test");

beforeAll(async () => {
  upstream = await startUpstream();
  process.env.RIDE_SERVICE_URL = upstream.url;
  process.env.USER_SERVICE_URL = upstream.url;
});

afterAll(async () => {
  await upstream.close();
  delete process.env.RIDE_INTERNAL_CONTEXT_SECRET;
});

beforeEach(() => {
  upstream.received.length = 0;
  setIdentityStateStore(openRiskStore);
  process.env.RIDE_INTERNAL_CONTEXT_SECRET = RIDE_SECRET;
});

describe("ride-service HMAC identity context", () => {
  it("replaces forged signature headers with the gateway's own valid signature", async () => {
    const token = await clientToken({
      sub: "usr_real",
      role: "rider",
      cityId: "LOS",
    });

    const response = await app.fetch(
      new Request("http://gateway.test/v1/rides/active", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          // A "client" asserting somebody else's identity, pre-signed.
          "x-auth-user-id": "usr_victim",
          "x-auth-user-role": "admin",
          "x-auth-city-id": "NBO",
          "x-auth-issued-at": "1111111111",
          "x-auth-signature": "forged-signature-value",
        },
      }),
    );

    expect(response.status).toBe(200);
    const forwarded = upstream.received[0];
    expect(forwarded).toBeDefined();

    // The identity that crossed the wire is the gateway's, not the client's.
    expect(forwarded?.headers["x-auth-user-id"]).toBe("usr_real");
    expect(forwarded?.headers["x-auth-user-role"]).toBe("rider");
    expect(forwarded?.headers["x-auth-city-id"]).toBe("LOS");
    expect(forwarded?.headers["x-auth-issued-at"]).not.toBe("1111111111");
    expect(forwarded?.headers["x-auth-signature"]).not.toBe(
      "forged-signature-value",
    );

    // And it verifies exactly the way the Go ride-service verifies it:
    // HMAC-SHA256 over ubi.internal.v1|user|role|city|issuedAt, base64url.
    const issuedAt = Number(forwarded?.headers["x-auth-issued-at"]);
    expect(Number.isInteger(issuedAt)).toBe(true);
    expect(Math.abs(Date.now() / 1000 - issuedAt)).toBeLessThan(60);

    const expected = createHmac("sha256", RIDE_SECRET)
      .update(rideContextPayload("usr_real", "rider", "LOS", issuedAt))
      .digest("base64url");
    expect(forwarded?.headers["x-auth-signature"]).toBe(expected);
  });

  it("signs with the FIRST key of a comma-separated rotation list", async () => {
    process.env.RIDE_INTERNAL_CONTEXT_SECRET = ` ${RIDE_SECRET} , ${PREVIOUS_RIDE_SECRET} `;
    const token = await clientToken({ sub: "usr_real", role: "rider" });

    await app.fetch(
      new Request("http://gateway.test/v1/rides/active", {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      }),
    );

    const forwarded = upstream.received[0];
    const issuedAt = Number(forwarded?.headers["x-auth-issued-at"]);
    // No city claim on this token → the payload's city segment is empty,
    // matching the Go side's empty x-auth-city-id.
    expect(forwarded?.headers["x-auth-city-id"]).toBeUndefined();
    expect(forwarded?.headers["x-auth-signature"]).toBe(
      signRideContext(RIDE_SECRET, "usr_real", "rider", "", issuedAt),
    );
    expect(forwarded?.headers["x-auth-signature"]).not.toBe(
      signRideContext(PREVIOUS_RIDE_SECRET, "usr_real", "rider", "", issuedAt),
    );
  });

  it("sends no HMAC headers at all when no key is configured", async () => {
    delete process.env.RIDE_INTERNAL_CONTEXT_SECRET;
    const token = await clientToken({ sub: "usr_real", role: "rider" });

    await app.fetch(
      new Request("http://gateway.test/v1/rides/active", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          // Even then, a forged signature must not leak through.
          "x-auth-signature": "forged-signature-value",
          "x-auth-issued-at": "1111111111",
        },
      }),
    );

    const forwarded = upstream.received[0];
    expect(forwarded?.headers["x-auth-signature"]).toBeUndefined();
    expect(forwarded?.headers["x-auth-issued-at"]).toBeUndefined();
  });

  it("agrees with the Go ride-service on the pinned parity fixture", () => {
    // The same fixture is asserted by ride_test.go TestSigningParityWithTheGateway.
    expect(
      signRideContext(
        "parity-fixture-secret",
        "9d5b7f2e-0000-4000-8000-000000000001",
        "rider",
        "LOS",
        1758400000,
      ),
    ).toBe("v-vS7A-Mp7ynOjzi_dH7Jpyev-XT4hVBDI2Fg_xMjac");
  });
});
