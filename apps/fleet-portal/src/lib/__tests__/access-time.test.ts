/**
 * Honest states (access.ts, idempotency.ts) and city time (time.ts).
 */
import { describe, expect, it } from "vitest";

import {
  classifyError,
  commandErrorText,
  FLAG_OFF_COPY,
  toReadState,
} from "../access";
import { ApiError } from "../api-client";
import { isAmbiguousFailure, keyAfter } from "../idempotency";
import {
  dayLabel,
  dayRuler,
  localInputToIso,
  localToInstant,
  mondayOf,
  nowOn,
  spanOn,
  timeRangeIn,
  weekRangeLabel,
  zoneLabel,
  zoneLongName,
} from "../time";
import { NOW, ZONE } from "./fixtures";

describe("classifyError", () => {
  it("tells flag off from permission from not-a-member from offline", () => {
    expect(
      classifyError(new ApiError(404, "feature_disabled", "off"), true),
    ).toMatchObject({
      kind: "flag_off",
      message: FLAG_OFF_COPY,
    });
    expect(FLAG_OFF_COPY).toBe(
      "Fleet tools aren't available yet in your city.",
    );
    expect(
      classifyError(
        new ApiError(403, "forbidden", "x", {
          capability: "manage_maintenance",
          allowedRoles: ["owner", "manager"],
        }),
        true,
      ),
    ).toMatchObject({
      kind: "forbidden",
      message:
        "Your role can view the calendar but can't create maintenance. Ask a fleet owner or manager.",
    });
    expect(
      classifyError(new ApiError(404, "not_found", "fleet not found"), true)
        .kind,
    ).toBe("not_found");
    expect(
      classifyError(new ApiError(401, "unauthorized", "x"), true).kind,
    ).toBe("unauthenticated");
    expect(
      classifyError(new ApiError(403, "limited_mode", "x"), true).kind,
    ).toBe("device_unverified");
    expect(
      classifyError(new ApiError(503, "service_unavailable", "x"), true).kind,
    ).toBe("unavailable");
    expect(classifyError(new TypeError("fetch failed"), true).kind).toBe(
      "offline",
    );
    expect(
      classifyError(new ApiError(500, "internal_error", "x"), false).kind,
    ).toBe("offline");
    expect(
      classifyError(new ApiError(500, "internal_error", "boom"), true).kind,
    ).toBe("error");
  });
});

describe("toReadState", () => {
  const base = {
    data: undefined,
    error: null,
    isError: false,
    fetchStatus: "idle" as const,
    dataUpdatedAt: 0,
  };

  it("is loading until the server answers", () => {
    expect(toReadState({ ...base, fetchStatus: "fetching" }, true)).toEqual({
      kind: "loading",
    });
  });

  it("is offline — never empty — when a read is paused with nothing to show", () => {
    const state = toReadState({ ...base, fetchStatus: "paused" }, true);
    expect(state.kind).toBe("failed");
    expect(state.kind === "failed" && state.access.kind).toBe("offline");
  });

  it("keeps the last good data, marked stale with its time, when offline or erroring", () => {
    const offline = toReadState(
      { ...base, data: { n: 1 }, dataUpdatedAt: NOW },
      false,
    );
    expect(offline).toMatchObject({
      kind: "ready",
      data: { n: 1 },
      updatedAt: NOW,
      stale: { kind: "offline" },
    });
    const failing = toReadState(
      {
        ...base,
        data: { n: 1 },
        isError: true,
        error: new ApiError(503, "service_unavailable", "x"),
        dataUpdatedAt: NOW,
      },
      true,
    );
    expect(failing).toMatchObject({
      kind: "ready",
      stale: { kind: "unavailable" },
    });
  });

  it("drops old fleet data on a definitive refusal (flag off, removed, signed out)", () => {
    for (const error of [
      new ApiError(404, "feature_disabled", "off"),
      new ApiError(404, "not_found", "x"),
      new ApiError(403, "forbidden", "x"),
      new ApiError(401, "unauthorized", "x"),
    ]) {
      const state = toReadState(
        { ...base, data: { n: 1 }, isError: true, error, dataUpdatedAt: NOW },
        true,
      );
      expect(state.kind).toBe("failed");
    }
  });

  it("is ready and fresh otherwise", () => {
    expect(
      toReadState({ ...base, data: { n: 2 }, dataUpdatedAt: NOW }, true),
    ).toEqual({
      kind: "ready",
      data: { n: 2 },
      updatedAt: NOW,
      stale: null,
    });
  });
});

describe("idempotency keys", () => {
  it("keeps the key after an ambiguous failure and renews it after a definite answer", () => {
    expect(isAmbiguousFailure(new TypeError("network"))).toBe(true);
    expect(isAmbiguousFailure(new ApiError(502, null, "bad gateway"))).toBe(
      true,
    );
    expect(isAmbiguousFailure(new ApiError(409, "needs_resolution", "x"))).toBe(
      false,
    );
    expect(
      isAmbiguousFailure(new ApiError(409, "needs_resolution", "x"), false),
    ).toBe(true);
    expect(
      keyAfter("k-same-0001", { ok: false, error: new TypeError("network") }),
    ).toBe("k-same-0001");
    expect(
      keyAfter("k-same-0001", {
        ok: false,
        error: new ApiError(422, "shift_overlap", "x"),
      }),
    ).not.toBe("k-same-0001");
    expect(keyAfter("k-same-0001", { ok: true })).not.toBe("k-same-0001");
    expect(commandErrorText(new TypeError("network"), true)).toMatch(
      /safe: the same request is re-sent/,
    );
    // A kept key re-sent with changed details: explained, never the raw code.
    const reuse = commandErrorText(
      new ApiError(
        409,
        "idempotency_key_reuse",
        "this Idempotency-Key was already used with a different request",
      ),
      true,
    );
    expect(reuse).toMatch(/may already have reached UBI/);
    expect(reuse).not.toMatch(/Idempotency-Key/);
  });
});

describe("city time, zone labelled", () => {
  it("labels the zone the way the handoff does", () => {
    expect(zoneLabel(ZONE, NOW)).toBe("Africa/Lagos · WAT (UTC+1)");
    expect(zoneLongName(ZONE, NOW)).toBe("West Africa Time");
    expect(zoneLabel("Africa/Nairobi", NOW)).toBe(
      "Africa/Nairobi · EAT (UTC+3)",
    );
  });

  it("turns local wall clock into real instants through the zone", () => {
    expect(
      new Date(localToInstant("2026-09-30", "06:00", ZONE)).toISOString(),
    ).toBe("2026-09-30T05:00:00.000Z");
    expect(localInputToIso("2026-09-30", "10:00", ZONE)).toBe(
      "2026-09-30T09:00:00.000Z",
    );
    expect(
      timeRangeIn("2026-09-30T06:15:00.000Z", "2026-09-30T08:40:00.000Z", ZONE),
    ).toBe("07:15–09:40");
    expect(
      timeRangeIn("2026-09-30T21:00:00.000Z", "2026-10-01T05:00:00.000Z", ZONE),
    ).toBe("30 Sep 22:00–1 Oct 06:00");
    expect(dayLabel("2026-09-30")).toBe("Wed 30 Sep 2026");
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
    expect(weekRangeLabel("2026-09-29", "2026-10-05")).toBe(
      "29 Sep – 5 Oct 2026",
    );
  });

  it("draws the 06:00–22:00 ruler with a now marker", () => {
    const ruler = dayRuler("2026-09-30", ZONE);
    expect(ruler.ticks.map((tick) => tick.label)).toEqual([
      "06:00",
      "08:00",
      "10:00",
      "12:00",
      "14:00",
      "16:00",
      "18:00",
      "20:00",
      "22:00",
    ]);
    expect(ruler.dstNote).toBeNull();
    expect(nowOn(ruler, NOW)).toBeCloseTo(((9 * 60 + 42 - 360) / 960) * 100, 5);
    expect(nowOn(ruler, Date.parse("2026-10-01T08:00:00.000Z"))).toBeNull();
    const span = spanOn(
      ruler,
      "2026-09-30T21:30:00.000Z",
      "2026-09-30T22:30:00.000Z",
    );
    expect(span).toBeNull();
    const clipped = spanOn(
      ruler,
      "2026-09-30T04:00:00.000Z",
      "2026-09-30T06:00:00.000Z",
    );
    expect(clipped).toMatchObject({
      leftPct: 0,
      clippedStart: true,
      clippedEnd: false,
    });
  });

  it("labels DST days: the ruler repeats or skips the hour", () => {
    const fallBack = dayRuler("2026-10-25", "Europe/London");
    expect(fallBack.dayHours).toBe(25);
    expect(fallBack.dstNote).toBe(
      "Sun 25 Oct · 25-hour day · 01:00 happens twice",
    );
    const springForward = dayRuler("2026-03-29", "Europe/London");
    expect(springForward.dayHours).toBe(23);
    expect(springForward.dstNote).toBe(
      "Sun 29 Mar · 23-hour day · 01:00 is skipped",
    );
  });
});
