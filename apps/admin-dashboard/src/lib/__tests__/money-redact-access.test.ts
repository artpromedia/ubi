/** Money display, PII scrubbing and access classification — the shared seams
 * every new ops renderer goes through. Pure; no network. */
import { describe, expect, it } from "vitest";

import {
  classifyError,
  isAmbiguousFailure,
  isVersionConflict,
  readFailure,
} from "../access";
import { ApiError } from "../api-client";
import {
  redactedCaseExport,
  redactedExport,
  type ResolutionView,
} from "../marketplace-api";
import {
  currencyExponent,
  formatMinor,
  formatMinorUnits,
  formatServerMoney,
} from "../money";
import { maskPhone, redactDeep, scrubText } from "../redact";

describe("formatMinor — string placement of the server's integer, no arithmetic", () => {
  it("places the decimal by the ISO exponent", () => {
    expect(formatMinor(1_234_567, "NGN")).toBe("₦12,345.67");
    expect(formatMinor(5, "NGN")).toBe("₦0.05");
    expect(formatMinor(0, "NGN")).toBe("₦0.00");
    expect(formatMinor(1_500, "JPY")).toBe("JPY 1,500");
    expect(formatMinor(1_234, "KWD")).toBe("KWD 1.234");
    expect(formatMinor(250_050, "KES")).toBe("KSh 2,500.50");
    expect(currencyExponent("NGN")).toBe(2);
  });

  it("keeps the sign of a delta", () => {
    expect(formatMinor(-7_500, "NGN")).toBe("−₦75.00");
  });

  it("is exact beyond float precision (no division)", () => {
    // 2^53 - 1 minor units: a float division would lose the last digits.
    expect(formatMinor(9_007_199_254_740_991, "NGN")).toBe(
      "₦90,071,992,547,409.91",
    );
  });

  it("fails closed on anything the server could not have meant", () => {
    expect(formatMinor(12.5, "NGN")).toBe("—");
    expect(formatMinor("100", "NGN")).toBe("—");
    expect(formatMinor(Number.NaN, "NGN")).toBe("—");
    expect(formatMinor(100, "naira")).toBe("—");
    expect(formatMinor(100, "ZZZ")).toBe("—");
    expect(formatMinor(100, undefined)).toBe("—");
    expect(formatServerMoney(undefined)).toBe("—");
  });

  it("shows an amount without a currency as minor units, never converted", () => {
    expect(formatMinorUnits(150_000)).toBe("150,000 minor units");
    expect(formatMinorUnits(-3)).toBe("−3 minor units");
    expect(formatMinorUnits(1.5)).toBe("—");
  });
});

describe("PII scrubbing", () => {
  it("masks phones to country code and last two digits", () => {
    expect(maskPhone("+2348031234567")).toBe("+234•••••67");
    expect(scrubText("call +2348031234567 now")).toBe("call +234•••••67 now");
    expect(scrubText("local 08031234567")).toBe("local 0•••••67");
  });

  it("removes trip-link tokens and token-shaped secrets but keeps ids", () => {
    const token = "uta_Zk3v9QxPp2LmT8wYbN4cR7sD1fGhJ6kE0aVuWiXoYzA";
    expect(scrubText("link " + token)).toBe("link [link token redacted]");
    expect(scrubText("key Zk3v9QxPp2LmT8wYbN4cR7sD1fGhJ6kE0")).toBe(
      "key [redacted]",
    );
    const uuid = "5b1f0d2e-8c33-4d9e-9a1b-7c6d5e4f3a21";
    expect(scrubText(uuid)).toBe(uuid);
    expect(scrubText("insufficient_rider_funds")).toBe(
      "insufficient_rider_funds",
    );
  });

  it("redacts blocked keys at any depth, including inside JSON strings", () => {
    const out = redactDeep({
      requestId: "req-1",
      nested: { passengerPhone: "+2348031234567", ok: 1 },
      detail: JSON.stringify({ sealed: { ct: "x" }, tokenId: "t", scope: "s" }),
      pickup: { lat: 6.45, lng: 3.39 },
    }) as Record<string, unknown>;
    expect(out.requestId).toBe("req-1");
    expect(out.nested).toEqual({ passengerPhone: "[redacted]", ok: 1 });
    expect(out.detail).toEqual({
      sealed: "[redacted]",
      tokenId: "[redacted]",
      scope: "s",
    });
    expect(out.pickup).toBe("[redacted]");
  });
});

describe("case export", () => {
  const view: ResolutionView = {
    requestId: "req-1",
    cityId: "lagos",
    requestState: "execution",
    recoveries: [],
    stages: [],
    gaps: [],
    events: [
      {
        at: "2026-09-23T09:00:00Z",
        type: "trip_access.issued",
        detail: JSON.stringify({
          tokenId: "5b1f0d2e-8c33-4d9e-9a1b-7c6d5e4f3a21",
          sealed: { ct: "uta_Zk3v9QxPp2LmT8wYbN4cR7sD1fGhJ6kE0aVuWiXoYzA" },
          smsCopy: "Hi Adaeze +2348031234567",
        }),
      },
    ],
  };

  it("exports rendered copy, never the raw payload, phone or token", () => {
    const json = redactedCaseExport(view, { currency: "NGN" });
    expect(json).toContain("Passenger trip link issued");
    expect(json).not.toContain("uta_");
    expect(json).not.toContain("Zk3v9");
    expect(json).not.toContain("+2348031234567");
    expect(json).not.toContain("Adaeze");
    expect(json).not.toContain("smsCopy");
  });

  it("the generic export also parses and redacts a raw payload string", () => {
    const json = redactedExport(view);
    expect(json).not.toContain("Zk3v9");
    expect(json).not.toContain("+2348031234567");
  });
});

describe("access classification (role / device guards)", () => {
  it("tells signed-out, wrong-role, unverified-device and safe-mode apart", () => {
    expect(
      classifyError(new ApiError(401, "unauthorized", "x"), true).kind,
    ).toBe("unauthenticated");
    expect(classifyError(new ApiError(403, "forbidden", "x"), true).kind).toBe(
      "forbidden",
    );
    expect(
      classifyError(new ApiError(403, "limited_mode", "x"), true).kind,
    ).toBe("device_unverified");
    expect(
      classifyError(new ApiError(403, "safe_mode_active", "x"), true).kind,
    ).toBe("safe_mode");
    expect(
      classifyError(new ApiError(404, "feature_disabled", "x"), true).kind,
    ).toBe("feature_disabled");
    expect(classifyError(new ApiError(404, "not_found", "x"), true).kind).toBe(
      "not_found",
    );
  });

  it("treats a network failure or an offline browser as offline", () => {
    expect(classifyError(new TypeError("Failed to fetch"), true).kind).toBe(
      "offline",
    );
    expect(classifyError(new ApiError(500, null, "x"), false).kind).toBe(
      "offline",
    );
  });

  it("keeps any other failure's message", () => {
    const s = classifyError(new ApiError(500, "internal_error", "boom"), true);
    expect(s.kind).toBe("error");
    expect(s.message).toBe("500 boom");
  });

  it("classifies command failures: conflict vs ambiguous vs definite", () => {
    expect(isVersionConflict(new ApiError(409, "version_conflict", "x"))).toBe(
      true,
    );
    expect(isVersionConflict(new ApiError(409, "award_unresolved", "x"))).toBe(
      false,
    );
    expect(isAmbiguousFailure(new TypeError("Failed to fetch"), true)).toBe(
      true,
    );
    expect(isAmbiguousFailure(new ApiError(503, null, "x"), true)).toBe(true);
    expect(isAmbiguousFailure(new ApiError(403, "forbidden", "x"), true)).toBe(
      false,
    );
    expect(isAmbiguousFailure(new ApiError(403, "forbidden", "x"), false)).toBe(
      true,
    );
    // A 2xx whose body failed to parse DID run: never "nothing was applied".
    expect(isAmbiguousFailure(new SyntaxError("Unexpected token"), true)).toBe(
      true,
    );
    expect(isAmbiguousFailure(new Error("unexpected"), true)).toBe(true);
    expect(
      isAmbiguousFailure(new ApiError(409, "version_conflict", "x"), true),
    ).toBe(false);
  });

  it("the offline notice never claims a command was not sent", () => {
    // A dropped POST may have reached UBI; the command panels say so.
    const s = classifyError(new TypeError("Failed to fetch"), true);
    expect(s.message.toLowerCase()).not.toMatch(
      /no command|nothing was (sent|applied)/,
    );
  });
});

describe("readFailure — a paused (offline) read is not an empty board", () => {
  const base = { isError: false, error: null, data: undefined };

  it("a read TanStack paused while offline, with nothing loaded, is 'offline'", () => {
    expect(readFailure({ ...base, fetchStatus: "paused" }, true)?.kind).toBe(
      "offline",
    );
    expect(readFailure({ ...base, fetchStatus: "fetching" }, false)?.kind).toBe(
      "offline",
    );
  });

  it("an in-flight or loaded read is not a failure", () => {
    expect(readFailure({ ...base, fetchStatus: "fetching" }, true)).toBeNull();
    // stale data stays visible (pages add their own offline banner)
    expect(
      readFailure(
        { ...base, data: { rows: [] }, fetchStatus: "paused" },
        false,
      ),
    ).toBeNull();
    // a disabled lookup that was never asked
    expect(readFailure({ ...base, fetchStatus: "idle" }, true)).toBeNull();
  });

  it("an errored read keeps its classified failure", () => {
    expect(
      readFailure(
        {
          isError: true,
          error: new ApiError(403, "limited_mode", "x"),
          data: undefined,
          fetchStatus: "idle",
        },
        true,
      )?.kind,
    ).toBe("device_unverified");
  });
});
