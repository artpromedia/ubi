/**
 * The driver app declares its active city with `X-City-ID` when it asks for
 * the marketplace wallet overview (GET /v1/wallet/mp/overview). That header is
 * client context, not an identity claim (the reserved `x-ubi-city-id` carries
 * the token's city), so the gateway must pass it through to payment-service —
 * without it, payment-service answers city_unsupported and the overview is
 * unusable through the gateway.
 */
import "./env";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app";
import { setIdentityStateStore } from "../src/lib/redis";
import {
  clientToken,
  openRiskStore,
  startUpstream,
  type Upstream,
} from "./helpers";

let upstream: Upstream;
const app = createApp("test");

beforeAll(async () => {
  upstream = await startUpstream();
  process.env.USER_SERVICE_URL = upstream.url;
  process.env.PAYMENT_SERVICE_URL = upstream.url;
});

afterAll(async () => {
  await upstream.close();
});

beforeEach(() => {
  upstream.received.length = 0;
  setIdentityStateStore(openRiskStore);
});

describe("x-city-id forwarding", () => {
  it("forwards the client's x-city-id to payment-service on the wallet overview", async () => {
    const token = await clientToken({
      sub: "usr_driver",
      role: "driver",
      cityId: "LOS",
    });

    const response = await app.fetch(
      new Request(
        "http://gateway.test/v1/wallet/mp/overview?driverId=usr_driver",
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${token}`,
            "x-city-id": "LOS",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(upstream.received).toHaveLength(1);

    const forwarded = upstream.received[0];
    expect(forwarded).toBeDefined();
    // The city context the driver app declared crosses the wire.
    expect(forwarded?.headers["x-city-id"]).toBe("LOS");
    // The reserved identity headers still forward alongside it.
    expect(forwarded?.headers["x-ubi-city-id"]).toBe("LOS");
    expect(forwarded?.headers["x-user-id"]).toBe("usr_driver");
  });

  it("keeps forwarding x-city-id on other proxied routes", async () => {
    const token = await clientToken({ sub: "usr_rider", role: "rider" });

    await app.fetch(
      new Request("http://gateway.test/v1/users/me", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-city-id": "ABJ",
        },
      }),
    );

    expect(upstream.received[0]?.headers["x-city-id"]).toBe("ABJ");
  });
});
