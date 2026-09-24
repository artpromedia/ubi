/**
 * The delegated identity the assistant signs for ride-service
 * (src/lib/ride-context.ts).
 *
 * Parity is proven with fixed vectors, not with a second implementation:
 *   - the gateway's own parity fixture (services/api-gateway/tests/
 *     ride-signature.test.ts ↔ ride-service TestSigningParityWithTheGateway), so
 *     the assistant's signer is byte-identical to the gateway's;
 *   - the ask vectors (tests/ride-context-vectors.ts), whose SAME literals
 *     ride-service feeds through its real verifier and RequireIdentity
 *     middleware (services/ride-service/internal/handler/
 *     ask_delegation_test.go) and expects to be accepted — and refused when
 *     tampered with, skewed or signed with the wrong key.
 * Change the payload, the encoding or the key rule on any side and a test goes
 * red on that side.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ASK_OLD_KEY_SIGNATURE, ASK_VECTORS } from "./ride-context-vectors";
import {
  delegatedIdentityHeaders,
  isProductionEnvironment,
  loadRideContextKeys,
  parseRideContextKeys,
  rideContextPayload,
  signRideContext,
} from "../src/lib/ride-context";

describe("signer parity", () => {
  it("agrees with the gateway and ride-service on the gateway's pinned fixture", () => {
    // services/api-gateway/tests/ride-signature.test.ts and ride_test.go
    // TestSigningParityWithTheGateway pin the same value.
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

  it.each(ASK_VECTORS)(
    "produces the ask vector ride-service accepts: $name",
    (vector) => {
      const [signingKey] = parseRideContextKeys(vector.secret);
      expect(signingKey).toBeDefined();
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
    const vector = ASK_VECTORS[1];
    const [, oldKey] = parseRideContextKeys(vector.secret);
    expect(
      signRideContext(
        oldKey as string,
        vector.userId,
        vector.role,
        vector.cityId,
        vector.issuedAt,
      ),
    ).toBe(ASK_OLD_KEY_SIGNATURE);
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
    // 32 bytes → 43 base64url characters, no `=`, no `+` or `/`.
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

/**
 * The parity proof only holds while BOTH sides pin the very same literals:
 * regenerating one side's vector consistently would leave both suites green
 * while no longer proving anything about the other. So the Go test's vector
 * table is read (not executed) and compared field by field with ours.
 */
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
    expect(goVectors).toEqual(ASK_VECTORS.map((vector) => ({ ...vector })));

    const oldKey = /const askOldKeySignature = ("[^"]*")/.exec(source)?.[1];
    expect(oldKey === undefined ? undefined : goLiteral(oldKey)).toBe(
      ASK_OLD_KEY_SIGNATURE,
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
    expect(parseRideContextKeys(" , ,")).toEqual([]);
  });

  it("refuses to boot in production without a key", () => {
    for (const nodeEnv of ["production", "prod", " Production "]) {
      expect(isProductionEnvironment(nodeEnv)).toBe(true);
      expect(() => loadRideContextKeys({ NODE_ENV: nodeEnv })).toThrow(
        /RIDE_INTERNAL_CONTEXT_SECRET must be set in production/,
      );
      // A value that is only separators and spaces is no key at all.
      expect(() =>
        loadRideContextKeys({
          NODE_ENV: nodeEnv,
          RIDE_INTERNAL_CONTEXT_SECRET: " , ",
        }),
      ).toThrow(/must be set in production/);
    }
  });

  it("loads the keys in production when configured", () => {
    expect(
      loadRideContextKeys({
        NODE_ENV: "production",
        RIDE_INTERNAL_CONTEXT_SECRET: "k-new,k-old",
      }),
    ).toEqual(["k-new", "k-old"]);
  });

  it("allows an unsigned identity only outside production", () => {
    for (const nodeEnv of ["development", "test", "staging", undefined]) {
      expect(isProductionEnvironment(nodeEnv)).toBe(false);
      expect(loadRideContextKeys({ NODE_ENV: nodeEnv })).toEqual([]);
    }
  });
});

describe("delegated identity headers", () => {
  it.each(ASK_VECTORS)(
    "are exactly the wire headers ride-service verifies: $name",
    (vector) => {
      const headers = delegatedIdentityHeaders(
        parseRideContextKeys(vector.secret),
        { userId: vector.userId, role: vector.role, cityId: vector.cityId },
        new Date(vector.issuedAt * 1000 + 999),
      );
      // Sub-second time truncates to the same unix second the gateway signs.
      expect(headers).toEqual({
        "x-auth-user-id": vector.userId,
        "x-auth-user-role": vector.role,
        "x-auth-city-id": vector.cityId,
        "x-auth-issued-at": String(vector.issuedAt),
        "x-auth-signature": vector.signature,
      });
    },
  );

  it("sends the identity unsigned when no key is configured (development)", () => {
    const headers = delegatedIdentityHeaders(
      [],
      { userId: "u-1", role: "rider", cityId: "LOS" },
      new Date(),
    );
    expect(headers).toEqual({
      "x-auth-user-id": "u-1",
      "x-auth-user-role": "rider",
      "x-auth-city-id": "LOS",
    });
  });

  it("never signs an elevated principal", () => {
    for (const role of ["admin", "service", "ops_admin", "ai_ops", ""]) {
      expect(() =>
        delegatedIdentityHeaders(
          ["k"],
          { userId: "u-1", role, cityId: "LOS" },
          new Date(),
        ),
      ).toThrow(
        expect.objectContaining({
          code: "forbidden",
          details: { reason: "role_not_delegable" },
        }),
      );
    }
  });

  it("refuses fields that would make the canonical payload ambiguous or unverifiable", () => {
    const cases = [
      { userId: "u-1|admin", role: "rider", cityId: "LOS" },
      { userId: "u-1", role: "rider", cityId: "LOS|1758400000" },
      { userId: " u-1", role: "rider", cityId: "LOS" },
      { userId: "u-1", role: "rider", cityId: "LOS " },
      { userId: "u-1", role: "rider", cityId: "" },
      { userId: "", role: "rider", cityId: "LOS" },
      { userId: "u-1", role: "rider", cityId: "Lagos\nx-auth-user-role" },
    ];
    for (const principal of cases) {
      expect(() =>
        delegatedIdentityHeaders(["k"], principal, new Date()),
      ).toThrow(
        expect.objectContaining({
          code: "forbidden",
          details: { reason: "principal_not_signable" },
        }),
      );
    }
  });
});
