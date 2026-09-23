/**
 * The signed traveller identity travel-service presents to ride-service
 * (src/lib/ride-context.ts).
 *
 * Parity is proven with fixed vectors, not with a second implementation:
 *   - the gateway's parity fixture (services/api-gateway/tests/
 *     ride-signature.test.ts ↔ ride-service TestSigningParityWithTheGateway);
 *   - the delegation vectors ride-service feeds through its REAL verifier and
 *     RequireIdentity middleware (services/ride-service/internal/handler/
 *     ask_delegation_test.go) and expects to accept. The verifier is
 *     signer-agnostic — it checks the payload, the key list and the encoding —
 *     so a signer that reproduces these bytes is accepted exactly as the
 *     gateway and ask-service are. The Go table is READ here and compared
 *     field by field with the literals pinned below, so neither side can drift
 *     alone.
 */
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  isProductionEnvironment,
  loadRideContextKeys,
  parseRideContextKeys,
  riderIdentityHeaders,
  rideContextPayload,
  signRideContext,
} from "../src/lib/ride-context";

/** The literals ride-service's Go verifier test accepts (ask_delegation_test.go). */
const RIDE_VERIFIER_VECTORS = [
  {
    name: "rider in Lagos, single key",
    secret: "ask-delegation-vector-secret-0001",
    userId: "3f6c1a52-8d0e-4b7a-9c21-5e4f0a9b7d13",
    role: "rider",
    cityId: "LOS",
    issuedAt: 1758400123,
    signature: "6wUOqkL0K4rh5FV02DcIlaNvkx1QyELUouzwXHJjWMc",
  },
  {
    name: "driver in Accra, rotated key list (first key signs)",
    secret:
      "ask-delegation-vector-new-key-0002,ask-delegation-vector-old-key-0001",
    userId: "b2e4d6f8-1a3c-4e5f-8a9b-0c1d2e3f4a5b",
    role: "driver",
    cityId: "ACC",
    issuedAt: 1758400456,
    signature: "sO6FEHob8dR2xu7m3ErEK1l12QmdcWLgpuNUOgKa_ZY",
  },
] as const;

const OLD_KEY_SIGNATURE = "hWZeXalAF2293bRqjpA95XXC5QTwYXs9Xo9vA49oRpg";

describe("signer parity with ride-service's verifier", () => {
  it("agrees with the gateway and ride-service on the gateway's pinned fixture", () => {
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

  it.each(RIDE_VERIFIER_VECTORS)(
    "produces the bytes ride-service's verifier accepts: $name",
    (vector) => {
      const [signingKey] = parseRideContextKeys(vector.secret);
      expect(
        signRideContext(
          signingKey as string,
          vector.userId,
          vector.role,
          vector.cityId,
          vector.issuedAt,
        ),
      ).toBe(vector.signature);
    },
  );

  it("signs a rotation's old key exactly as ride-service expects", () => {
    const vector = RIDE_VERIFIER_VECTORS[1];
    const [, oldKey] = parseRideContextKeys(vector.secret);
    expect(
      signRideContext(
        oldKey as string,
        vector.userId,
        vector.role,
        vector.cityId,
        vector.issuedAt,
      ),
    ).toBe(OLD_KEY_SIGNATURE);
  });

  it("signs the exact canonical bytes, HMAC-SHA256, base64url without padding", () => {
    const payload = rideContextPayload(
      "3f6c1a52-8d0e-4b7a-9c21-5e4f0a9b7d13",
      "rider",
      "LOS",
      1758400123,
    );
    expect(payload).toBe(
      "ubi.internal.v1|3f6c1a52-8d0e-4b7a-9c21-5e4f0a9b7d13|rider|LOS|1758400123",
    );
    const signature = signRideContext(
      "ask-delegation-vector-secret-0001",
      "3f6c1a52-8d0e-4b7a-9c21-5e4f0a9b7d13",
      "rider",
      "LOS",
      1758400123,
    );
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      Buffer.from(signature, "base64url").equals(
        createHmac("sha256", "ask-delegation-vector-secret-0001")
          .update(payload)
          .digest(),
      ),
    ).toBe(true);
  });
});

describe("cross-language vector sync", () => {
  const GO_TEST = path.resolve(
    __dirname,
    "../../ride-service/internal/handler/ask_delegation_test.go",
  );
  const GO_ROLES: Readonly<Record<string, string>> = {
    "move.RoleRider": "rider",
    "move.RoleDriver": "driver",
  };

  function goLiteral(raw: string): string | number {
    if (raw.startsWith('"')) {
      return JSON.parse(raw) as string;
    }
    if (/^\d+$/.test(raw)) {
      return Number(raw);
    }
    const role = GO_ROLES[raw];
    if (role === undefined) {
      throw new Error(`unexpected Go literal in the vector table: ${raw}`);
    }
    return role;
  }

  it("pins exactly the literals ride-service's Go verifier test feeds through RequireIdentity", () => {
    const source = readFileSync(GO_TEST, "utf8");
    const table =
      /var askDelegationVectors = \[\]askDelegationVector\{\n([\s\S]*?)\n\}\n/.exec(
        source,
      )?.[1];
    expect(table).toBeDefined();
    const goVectors = (table ?? "")
      .split(/\n\t\},?/)
      .filter((entry) => entry.includes("signature:"))
      .map((entry) => {
        const fields: Record<string, string | number> = {};
        for (const match of entry.matchAll(
          /^\t\t(\w+):\s+("(?:[^"\\]|\\.)*"|[\w.]+),$/gm,
        )) {
          fields[match[1] as string] = goLiteral(match[2] as string);
        }
        return {
          name: fields.name,
          secret: fields.secret,
          userId: fields.userID,
          role: fields.role,
          cityId: fields.cityID,
          issuedAt: fields.issuedAt,
          signature: fields.signature,
        };
      });
    expect(goVectors).toEqual(
      RIDE_VERIFIER_VECTORS.map((vector) => ({ ...vector })),
    );
    const oldKey = /const askOldKeySignature = ("[^"]*")/.exec(source)?.[1];
    expect(oldKey === undefined ? undefined : goLiteral(oldKey)).toBe(
      OLD_KEY_SIGNATURE,
    );
  });
});

describe("the RIDE_INTERNAL_CONTEXT_SECRET key list", () => {
  it("trims keys, drops empties and keeps the current key first", () => {
    expect(parseRideContextKeys(" new-key , old-key ,, ")).toEqual([
      "new-key",
      "old-key",
    ]);
    expect(parseRideContextKeys(undefined)).toEqual([]);
  });

  it("refuses to boot in production without a key (fail closed)", () => {
    for (const nodeEnv of ["production", "prod", " Production "]) {
      expect(isProductionEnvironment(nodeEnv)).toBe(true);
      expect(() => loadRideContextKeys({ NODE_ENV: nodeEnv })).toThrow(
        /RIDE_INTERNAL_CONTEXT_SECRET must be set in production/,
      );
      expect(() =>
        loadRideContextKeys({
          NODE_ENV: nodeEnv,
          RIDE_INTERNAL_CONTEXT_SECRET: " , ",
        }),
      ).toThrow(/must be set in production/);
    }
    expect(
      loadRideContextKeys({
        NODE_ENV: "production",
        RIDE_INTERNAL_CONTEXT_SECRET: "k-new,k-old",
      }),
    ).toEqual(["k-new", "k-old"]);
  });

  it("the real service process refuses to boot in production without it", async () => {
    const serviceDir = path.resolve(__dirname, "..");
    const env: Record<string, string | undefined> = {
      ...process.env,
      NODE_ENV: "production",
      PORT: "0",
      LOG_LEVEL: "fatal",
    };
    delete env.RIDE_INTERNAL_CONTEXT_SECRET;
    const child = spawn(
      path.resolve(serviceDir, "node_modules/.bin/tsx"),
      ["src/index.ts"],
      {
        cwd: serviceDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const code = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve(null);
      }, 45_000);
      child.once("exit", (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });
    expect(code, output).toBe(1);
    expect(output).toMatch(/refusing to start/);
    expect(output).toMatch(
      /RIDE_INTERNAL_CONTEXT_SECRET must be set in production/,
    );
  }, 60_000);

  it("allows an unsigned identity only outside production", () => {
    for (const nodeEnv of ["development", "test", undefined]) {
      expect(loadRideContextKeys({ NODE_ENV: nodeEnv })).toEqual([]);
    }
  });
});

describe("the traveller identity headers", () => {
  it("are exactly the wire headers ride-service verifies, as a rider", () => {
    const vector = RIDE_VERIFIER_VECTORS[0];
    const headers = riderIdentityHeaders(
      parseRideContextKeys(vector.secret),
      { userId: vector.userId, cityId: vector.cityId },
      new Date(vector.issuedAt * 1000 + 999),
    );
    expect(headers).toEqual({
      "x-auth-user-id": vector.userId,
      "x-auth-user-role": "rider",
      "x-auth-city-id": vector.cityId,
      "x-auth-issued-at": String(vector.issuedAt),
      "x-auth-signature": vector.signature,
    });
  });

  it("always presents the rider role — never driver, ops or service", () => {
    const headers = riderIdentityHeaders(
      ["k"],
      { userId: "3f6c1a52-8d0e-4b7a-9c21-5e4f0a9b7d13", cityId: "LOS" },
      new Date(),
    );
    expect(headers["x-auth-user-role"]).toBe("rider");
  });

  it("sends the identity unsigned when no key is configured (development)", () => {
    expect(
      riderIdentityHeaders([], { userId: "u-1", cityId: "LOS" }, new Date()),
    ).toEqual({
      "x-auth-user-id": "u-1",
      "x-auth-user-role": "rider",
      "x-auth-city-id": "LOS",
    });
  });

  it("refuses fields that would make the canonical payload ambiguous", () => {
    for (const principal of [
      { userId: "u-1|admin", cityId: "LOS" },
      { userId: "u-1", cityId: "LOS|1758400000" },
      { userId: " u-1", cityId: "LOS" },
      { userId: "u-1", cityId: "" },
    ]) {
      expect(() => riderIdentityHeaders(["k"], principal, new Date())).toThrow(
        expect.objectContaining({
          code: "forbidden",
          details: { reason: "principal_not_signable" },
        }),
      );
    }
  });
});
