/**
 * The routing surface, checked against contracts/openapi/support-config.yaml.
 */
import { describe, expect, it } from "vitest";

import { buildApp } from "@/app";

const app = buildApp();

describe("app surface", () => {
  it("exposes exactly the config and flag paths from the contract", async () => {
    const response = await app.request("/openapi.json");
    expect(response.status).toBe(200);
    const doc = (await response.json()) as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths).sort()).toEqual([
      "/v1/config/change-requests",
      "/v1/config/change-requests/{id}/approve",
      "/v1/config/cities/{cityId}",
      "/v1/config/cities/{cityId}/history",
      "/v1/flags",
      "/v1/flags/{key}",
    ]);
  });

  it("answers a liveness check without touching a dependency", async () => {
    const response = await app.request("/health/live");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { status: string }).status).toBe("alive");
  });

  it("returns a canonical error body for an unknown endpoint", async () => {
    const response = await app.request("/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "not_found", message: "no such endpoint" });
  });

  it("rejects a change request with no idempotency key as validation_failed", async () => {
    const response = await app.request("/v1/config/change-requests", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "usr_ops",
        "x-user-role": "config_admin",
      },
      body: JSON.stringify({ cityId: "LOS", patch: {}, reason: "no key" }),
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe("validation_failed");
  });
});
