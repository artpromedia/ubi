/**
 * Access tokens (src/identity/tokens.ts) — what a limited-mode token carries.
 *
 * The token's `scopes` claim NARROWS the gateway's scope set (the gateway
 * intersects role ceiling ∩ token claim ∩ its own limited-mode allowlist), so
 * a scope this service leaves out of a limited token is lost to every limited
 * session, whatever the gateway allows. Round 6 found exactly that: the
 * gateway's limited-mode rules kept the assistant's chat (ask:converse) and
 * travel reads (travel:read), but tokens minted here never carried them.
 *
 * These are real tokens, verified with the same secret and claims the gateway
 * checks (services/api-gateway/src/middleware/auth.ts). The end-to-end half —
 * the same minted tokens through the real gateway scope matrix — is
 * services/api-gateway/tests/limited-token.test.ts.
 */
import * as jose from "jose";
import { describe, expect, it } from "vitest";

import { LIMITED_MODE_SCOPES as GATEWAY_LIMITED_MODE_SCOPES } from "../../../api-gateway/src/identity/scopes";
import {
  issueAccessToken,
  LIMITED_MODE_SCOPES,
} from "../../src/identity/tokens";

async function claimsOf(token: string): Promise<jose.JWTPayload> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const { payload } = await jose.jwtVerify(token, secret, {
    issuer: "ubi.africa",
    audience: "ubi-api",
  });
  return payload;
}

describe("limited-mode access tokens", () => {
  it("carry the assistant's chat and travel reads, and nothing that moves money", async () => {
    const issued = await issueAccessToken({
      userId: "usr_tokens_limited",
      email: "limited@example.test",
      role: "RIDER",
      mode: "limited",
      deviceId: "dev_limited",
      cityId: "LOS",
    });
    const claims = await claimsOf(issued.accessToken);

    expect(issued.mode).toBe("limited");
    expect(claims.mode).toBe("limited");
    expect(claims.role).toBe("rider");
    expect(claims.cityId).toBe("LOS");
    const scopes = claims.scopes as string[];
    expect(scopes).toEqual(issued.scopes);
    expect(scopes).toContain("ask:converse");
    expect(scopes).toContain("travel:read");
    for (const moving of [
      "ask:transact",
      "travel:book",
      "mp:request",
      "wallet:topup",
      "wallet:transfer:p2p",
      "wallet:transfer:nip",
      "ride:book:wallet",
      "mandate:manage",
      "security:pin:change",
    ]) {
      expect(scopes, moving).not.toContain(moving);
    }
  });

  it("states exactly the gateway's limited-mode allowlist, so neither side silently narrows the other", () => {
    expect([...LIMITED_MODE_SCOPES].sort()).toEqual(
      [...GATEWAY_LIMITED_MODE_SCOPES].sort(),
    );
  });

  it("leaves a full-mode token unnarrowed (the role ceiling applies)", async () => {
    const issued = await issueAccessToken({
      userId: "usr_tokens_full",
      email: "full@example.test",
      role: "rider",
      mode: "full",
      deviceId: "dev_full",
    });
    const claims = await claimsOf(issued.accessToken);
    expect(issued.scopes).toBeNull();
    expect(claims.scopes).toBeUndefined();
    expect(claims.mode).toBe("full");
  });
});
