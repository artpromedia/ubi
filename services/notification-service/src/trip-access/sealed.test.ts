/**
 * TRIP-LINK SEALED DELIVERY CONTRACT — consumer side: the fixed interop
 * vector, tamper detection, key rotation and fail-closed key loading.
 */
import { describe, expect, it } from "vitest";

import {
  TripAccessOpenError,
  loadTripAccessKeyRing,
  openTripAccess,
  tripAccessAad,
  type TripAccessKeyRing,
} from "./sealed.js";
import {
  VECTOR,
  randomKeyBase64,
  sealForTest,
} from "../test-support/trip-access.js";

function ring(env: Record<string, string | undefined>): TripAccessKeyRing {
  const result = loadTripAccessKeyRing(env);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.ring;
}

const vectorRing = (): TripAccessKeyRing =>
  ring({
    TRIP_ACCESS_DELIVERY_KEY: VECTOR.keyBase64,
    TRIP_ACCESS_DELIVERY_KID: "vector",
  });

const vectorEnvelope = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  alg: "A256GCM",
  kid: "vector",
  iv: VECTOR.ivBase64Url,
  ct: VECTOR.ctBase64Url,
  tag: VECTOR.tagBase64Url,
  ...overrides,
});

/** Flip one bit of a base64url string's decoded bytes. */
function flipBit(b64url: string, byte = 0, bit = 0): string {
  const buf = Buffer.from(b64url, "base64url");
  buf[byte] = (buf[byte] ?? 0) ^ (1 << bit);
  return buf.toString("base64url");
}

function openError(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof TripAccessOpenError) {
      return err.code;
    }
    throw err;
  }
  throw new Error("expected the envelope to be refused");
}

describe("fixed interop vector", () => {
  it("opens to the exact plaintext", () => {
    const opened = openTripAccess(
      vectorRing(),
      VECTOR.tokenId,
      vectorEnvelope(),
    );
    expect(opened).toEqual(JSON.parse(VECTOR.plaintext));
    expect(opened).toEqual({
      phone: "+2348000000000",
      token: "tat_test_TOKEN_value_0001",
      firstName: "Ada",
    });
  });

  it("uses the contract's AAD", () => {
    expect(tripAccessAad(VECTOR.tokenId).toString("utf8")).toBe(VECTOR.aad);
  });

  it("the test sealer reproduces ct and tag exactly (so envelopes built in tests are contract-true)", () => {
    const sealed = sealForTest({
      keyBase64: VECTOR.keyBase64,
      kid: "vector",
      tokenId: VECTOR.tokenId,
      plaintext: VECTOR.plaintext,
      iv: Buffer.from(VECTOR.ivBase64Url, "base64url"),
    });
    expect(sealed.ct).toBe(VECTOR.ctBase64Url);
    expect(sealed.tag).toBe(VECTOR.tagBase64Url);
    expect(sealed.iv).toBe(VECTOR.ivBase64Url);
  });

  it.each([
    ["first ciphertext bit", { ct: flipBit(VECTOR.ctBase64Url, 0, 0) }],
    // The 80-byte plaintext gives an 80-byte ciphertext: byte 79 is the last.
    ["last ciphertext bit", { ct: flipBit(VECTOR.ctBase64Url, 79, 7) }],
    ["a tag bit", { tag: flipBit(VECTOR.tagBase64Url, 5, 3) }],
    ["an iv bit", { iv: flipBit(VECTOR.ivBase64Url, 11, 0) }],
  ])("a one-bit tamper of the %s fails to open", (_label, overrides) => {
    expect(
      openError(() =>
        openTripAccess(vectorRing(), VECTOR.tokenId, vectorEnvelope(overrides)),
      ),
    ).toBe("auth_failed");
  });

  it("a one-bit change of the AAD (another token's id) fails to open", () => {
    const aadTamperedTokenId = "tac_0123456789abcdeg"; // 'f' ^ 1 = 'g'
    expect(
      openError(() =>
        openTripAccess(vectorRing(), aadTamperedTokenId, vectorEnvelope()),
      ),
    ).toBe("auth_failed");
  });
});

describe("envelope structure", () => {
  it.each([
    ["an unknown version", { v: 2 }],
    ["another algorithm", { alg: "A128GCM" }],
    ["a padded iv", { iv: `${VECTOR.ivBase64Url}==` }],
    ["a short iv", { iv: "oKGio6Slpqeo" }],
    ["a short tag", { tag: "F8NgMLVA0GJzT4obDPRk" }],
    [
      "standard (non-url) base64",
      { ct: VECTOR.ctBase64Url.replace(/_/g, "/") },
    ],
    ["an extra key", { note: "x" }],
    ["a bad kid", { kid: "bad kid!" }],
  ])("refuses %s as malformed", (_label, overrides) => {
    expect(
      openError(() =>
        openTripAccess(vectorRing(), VECTOR.tokenId, vectorEnvelope(overrides)),
      ),
    ).toBe("malformed_envelope");
  });

  it("refuses an unknown key id without trying another key", () => {
    expect(
      openError(() =>
        openTripAccess(
          vectorRing(),
          VECTOR.tokenId,
          vectorEnvelope({ kid: "someone-else" }),
        ),
      ),
    ).toBe("unknown_kid");
  });

  it("refuses an authenticated plaintext that breaks the contract (phone not E.164)", () => {
    const key = randomKeyBase64();
    const sealed = sealForTest({
      keyBase64: key,
      kid: "k1",
      tokenId: "tac_x",
      plaintext: JSON.stringify({
        phone: "08000000000",
        token: "uta_abc",
        firstName: "Ada",
      }),
    });
    const keys = ring({
      TRIP_ACCESS_DELIVERY_KEY: key,
      TRIP_ACCESS_DELIVERY_KID: "k1",
    });
    expect(openError(() => openTripAccess(keys, "tac_x", sealed))).toBe(
      "invalid_plaintext",
    );
  });

  it("does not depend on plaintext key order", () => {
    const key = randomKeyBase64();
    const sealed = sealForTest({
      keyBase64: key,
      kid: "k1",
      tokenId: "tac_order",
      plaintext:
        '{"firstName":"Bola","token":"uta_Zm9vYmFy","phone":"+254700000001"}',
    });
    const keys = ring({
      TRIP_ACCESS_DELIVERY_KEY: key,
      TRIP_ACCESS_DELIVERY_KID: "k1",
    });
    expect(openTripAccess(keys, "tac_order", sealed)).toEqual({
      phone: "+254700000001",
      token: "uta_Zm9vYmFy",
      firstName: "Bola",
    });
  });
});

describe("key rotation", () => {
  it("opens envelopes sealed under the previous key, selected by kid", () => {
    const current = randomKeyBase64();
    const previous = randomKeyBase64();
    const keys = ring({
      TRIP_ACCESS_DELIVERY_KEY: current,
      TRIP_ACCESS_DELIVERY_KID: "2026-09",
      TRIP_ACCESS_DELIVERY_KEY_PREVIOUS: previous,
      TRIP_ACCESS_DELIVERY_KID_PREVIOUS: "2026-08",
    });
    const plaintext = JSON.stringify({
      phone: "+2348000000001",
      token: "uta_prev",
      firstName: "Chi",
    });
    const old = sealForTest({
      keyBase64: previous,
      kid: "2026-08",
      tokenId: "tac_rot",
      plaintext,
    });
    const fresh = sealForTest({
      keyBase64: current,
      kid: "2026-09",
      tokenId: "tac_rot",
      plaintext,
    });
    expect(openTripAccess(keys, "tac_rot", old).token).toBe("uta_prev");
    expect(openTripAccess(keys, "tac_rot", fresh).token).toBe("uta_prev");
    // The previous key under the current kid does not authenticate.
    expect(
      openError(() =>
        openTripAccess(keys, "tac_rot", { ...old, kid: "2026-09" }),
      ),
    ).toBe("auth_failed");
  });

  it("ignores a half-configured previous pair with a warning (current still works)", () => {
    const result = loadTripAccessKeyRing({
      TRIP_ACCESS_DELIVERY_KEY: VECTOR.keyBase64,
      TRIP_ACCESS_DELIVERY_KID: "vector",
      TRIP_ACCESS_DELIVERY_KEY_PREVIOUS: randomKeyBase64(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ring.kids).toEqual(["vector"]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).not.toContain(VECTOR.keyBase64);
    }
  });
});

describe("fail-closed key loading", () => {
  it.each([
    ["no key at all", {}],
    ["a key without a kid", { TRIP_ACCESS_DELIVERY_KEY: VECTOR.keyBase64 }],
    ["a kid without a key", { TRIP_ACCESS_DELIVERY_KID: "k1" }],
    [
      "a 16-byte key",
      {
        TRIP_ACCESS_DELIVERY_KEY: Buffer.alloc(16, 1).toString("base64"),
        TRIP_ACCESS_DELIVERY_KID: "k1",
      },
    ],
    [
      "a key without padding (not canonical standard base64)",
      {
        TRIP_ACCESS_DELIVERY_KEY: VECTOR.keyBase64.replace(/=+$/, ""),
        TRIP_ACCESS_DELIVERY_KID: "k1",
      },
    ],
    [
      "a url-safe base64 key",
      {
        TRIP_ACCESS_DELIVERY_KEY: Buffer.alloc(32, 0xfb).toString("base64url"),
        TRIP_ACCESS_DELIVERY_KID: "k1",
      },
    ],
    [
      "a kid with spaces",
      {
        TRIP_ACCESS_DELIVERY_KEY: VECTOR.keyBase64,
        TRIP_ACCESS_DELIVERY_KID: "key one",
      },
    ],
  ])("refuses %s, without echoing key material", (_label, env) => {
    const result = loadTripAccessKeyRing(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toContain(VECTOR.keyBase64);
    }
  });
});
