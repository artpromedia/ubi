import "./env";

import { afterEach, describe, expect, it } from "vitest";

import {
  IDENTITY_CONTEXT_AUDIENCE,
  IDENTITY_CONTEXT_ISSUER,
  type IdentityContext,
  signIdentityContext,
  verifyIdentityContext,
} from "../src/identity/context";

const BASE: IdentityContext = {
  userId: "usr_1",
  role: "rider",
  scopes: ["ride:book:cash", "wallet:read"],
  modes: ["limited"],
  cityId: "LOS",
  tenantId: null,
  sessionId: "sess_1",
  deviceId: "dev_1",
  requestId: "req_1",
};

const CURRENT_SECRET = process.env.UBI_IDENTITY_SECRET as string;

afterEach(() => {
  process.env.UBI_IDENTITY_SECRET = CURRENT_SECRET;
  process.env.UBI_IDENTITY_KEY_ID = "test-k1";
  delete process.env.UBI_IDENTITY_SECRET_PREVIOUS;
  delete process.env.UBI_IDENTITY_KEY_ID_PREVIOUS;
});

function decodeSegment(token: string, index: 0 | 1): Record<string, unknown> {
  const segment = token.split(".")[index];
  if (segment === undefined) throw new Error("malformed token");
  return JSON.parse(
    Buffer.from(segment, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

describe("signed internal identity context", () => {
  it("round-trips every field", async () => {
    const verified = await verifyIdentityContext(
      await signIdentityContext(BASE),
    );
    expect(verified).toEqual(BASE);
  });

  it("carries the key id, issuer and audience so a consumer can pin them", async () => {
    const token = await signIdentityContext(BASE);
    expect(decodeSegment(token, 0)).toMatchObject({
      alg: "HS256",
      kid: "test-k1",
      typ: "UBI-IC",
    });
    expect(decodeSegment(token, 1)).toMatchObject({
      iss: IDENTITY_CONTEXT_ISSUER,
      aud: IDENTITY_CONTEXT_AUDIENCE,
    });
  });

  it("rejects a tampered payload", async () => {
    const token = await signIdentityContext(BASE);
    const [header, payload, signature] = token.split(".");
    expect(header).toBeDefined();
    expect(payload).toBeDefined();
    expect(signature).toBeDefined();

    const claims = JSON.parse(
      Buffer.from(payload as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    claims.sub = "usr_victim";
    claims.scp = ["wallet:transfer:p2p", "security:pin:change"];
    claims.mod = [];
    const forged = Buffer.from(JSON.stringify(claims), "utf8").toString(
      "base64url",
    );

    await expect(
      verifyIdentityContext(
        `${header as string}.${forged}.${signature as string}`,
      ),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects a context signed with a different key", async () => {
    const token = await signIdentityContext(BASE);
    process.env.UBI_IDENTITY_SECRET =
      "a-completely-different-internal-secret-9";
    await expect(verifyIdentityContext(token)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("rejects an expired context", async () => {
    const token = await signIdentityContext(BASE, -1);
    await expect(verifyIdentityContext(token)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("rejects a context signed with the client-facing JWT secret", async () => {
    process.env.UBI_IDENTITY_SECRET =
      "an-interim-internal-secret-for-signing-1";
    const token = await signIdentityContext(BASE);

    process.env.UBI_IDENTITY_SECRET = process.env.JWT_SECRET;
    await expect(verifyIdentityContext(token)).rejects.toThrow(
      /must not equal JWT_SECRET/,
    );
    await expect(signIdentityContext(BASE)).rejects.toThrow(
      /must not equal JWT_SECRET/,
    );
  });

  it("refuses a signing secret that is too short to be a key", async () => {
    process.env.UBI_IDENTITY_SECRET = "short";
    await expect(signIdentityContext(BASE)).rejects.toThrow(
      /at least 32 characters/,
    );
  });

  it("still verifies contexts signed with the previous key during a rotation", async () => {
    const oldSecret = "the-previous-internal-identity-secret-01";
    process.env.UBI_IDENTITY_SECRET = oldSecret;
    process.env.UBI_IDENTITY_KEY_ID = "k0";
    const signedWithOldKey = await signIdentityContext(BASE);

    process.env.UBI_IDENTITY_SECRET =
      "the-next-internal-identity-secret-000001";
    process.env.UBI_IDENTITY_KEY_ID = "k1";
    process.env.UBI_IDENTITY_SECRET_PREVIOUS = oldSecret;
    process.env.UBI_IDENTITY_KEY_ID_PREVIOUS = "k0";

    const verified = await verifyIdentityContext(signedWithOldKey);
    expect(verified.userId).toBe("usr_1");

    // ...and once the previous key is retired, that same context stops working.
    delete process.env.UBI_IDENTITY_SECRET_PREVIOUS;
    await expect(verifyIdentityContext(signedWithOldKey)).rejects.toMatchObject(
      {
        code: "unauthorized",
      },
    );
  });

  it("drops unknown scopes and modes rather than passing them through", async () => {
    const token = await signIdentityContext({
      ...BASE,
      scopes: [
        "ride:read",
        "not:a:real:scope",
      ] as unknown as IdentityContext["scopes"],
      modes: ["limited", "god_mode"] as unknown as IdentityContext["modes"],
    });
    const verified = await verifyIdentityContext(token);
    expect(verified.scopes).toEqual(["ride:read"]);
    expect(verified.modes).toEqual(["limited"]);
  });
});
