/**
 * The published driver requirements are derived from the document types this
 * service reviews; no database is needed to serve them.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_TYPES } from "../../src/identity/documents";
import {
  DRIVER_REQUIREMENTS_BY_CITY,
  driverRequirementsFor,
} from "../../src/identity/requirements";
import { createKycRoutes } from "../../src/routes/kyc";

const app = createKycRoutes();

async function get(path: string): Promise<Response> {
  const response = await app.fetch(
    new Request(`http://user-service.test${path}`),
  );
  return response;
}

describe("driver requirements", () => {
  it("names the Lagos set: licence, LASDRI, identity, vehicle papers, background check", () => {
    const lagos = driverRequirementsFor("los");
    expect(lagos.cityId).toBe("LOS");
    expect(lagos.documents.map((d) => d.type)).toEqual([
      "licence",
      "lasdri",
      "nin_identity",
      "insurance",
      "roadworthiness",
      "vehicle_registration",
      "background_check",
    ]);
    expect(lagos.documents.every((d) => d.required)).toBe(true);
  });

  it("covers every document type the review queue knows, per city", () => {
    for (const [cityId, documents] of Object.entries(
      DRIVER_REQUIREMENTS_BY_CITY,
    )) {
      const types = new Set(documents.map((d) => d.type));
      for (const type of DOCUMENT_TYPES) {
        if (type === "lasdri" && cityId !== "LOS") {
          continue;
        }
        expect(types.has(type), `${cityId} is missing ${type}`).toBe(true);
      }
      expect(types.has("nin_identity")).toBe(true);
    }
  });

  it("does not ask Abuja drivers for a LASDRI card", () => {
    const abuja = driverRequirementsFor("ABV");
    expect(abuja.documents.some((d) => d.type === "lasdri")).toBe(false);
    expect(abuja.documents.filter((d) => d.owner === "vehicle")).toHaveLength(
      3,
    );
  });

  it("serves GET /v1/kyc/requirements and the gateway-stripped path alike", async () => {
    for (const path of [
      "/v1/kyc/requirements?cityId=LOS&role=driver",
      "/kyc/requirements?cityId=LOS&role=driver",
    ]) {
      const response = await get(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("max-age");
      const body = (await response.json()) as {
        success: boolean;
        data: { cityId: string; role: string; documents: unknown[] };
      };
      expect(body.success).toBe(true);
      expect(body.data.cityId).toBe("LOS");
      expect(body.data.role).toBe("driver");
      expect(body.data.documents).toHaveLength(7);
    }
  });

  it("answers city_unsupported for a city with no published set", async () => {
    const response = await get("/v1/kyc/requirements?cityId=KAN&role=driver");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("city_unsupported");
  });

  it("rejects a missing cityId or an unknown role as validation_failed", async () => {
    const missing = await get("/v1/kyc/requirements?role=driver");
    expect(missing.status).toBe(422);
    const rider = await get("/v1/kyc/requirements?cityId=LOS&role=rider");
    expect(rider.status).toBe(422);
  });
});
