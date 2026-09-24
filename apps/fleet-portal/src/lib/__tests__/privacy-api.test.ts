/**
 * Privacy on the wire and the API client: whatever a response carries, a
 * rider, location, fare or driver-net field never reaches a screen; every
 * request carries the staff member's token, every state change its
 * idempotency key, and refusals decode to a code + the server's details.
 */
import { describe, expect, it } from "vitest";

import { ApiError, createFleetApiClient, decodeResponse } from "../api-client";
import { calendarPath, createFleetApi, sanitizeCalendar } from "../fleet-api";
import { refusalState } from "../maintenance-model";
import {
  isForbiddenField,
  projectOccupiedBlock,
  stripForbidden,
} from "../privacy";
import {
  dayCalendar,
  FORBIDDEN_VALUES,
  infeasiblePreview,
  maintenanceList,
  polluted,
  vehicleView,
} from "./fixtures";

import type { FleetCalendar } from "../fleet-types";

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(keysDeep);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, inner]) => [
      key,
      ...keysDeep(inner),
    ]);
  }
  return [];
}

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that answers from a table and records every request. */
function recordingFetch(answer: (url: string, init: RequestInit) => Response): {
  fetch: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return answer(url, init ?? {});
  }) as typeof fetch;
  return { fetch: fake, calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("stripForbidden / projectOccupiedBlock", () => {
  it("names the forbidden fields the contract names", () => {
    for (const key of [
      "rider",
      "riderPhone",
      "passengerName",
      "pickupAddress",
      "dropoff",
      "lat",
      "route",
      "fare",
      "driverNet",
      "netEarnings",
      "requestId",
      "safetyEvidence",
      "paymentMethodId",
    ]) {
      expect(isForbiddenField(key)).toBe(true);
    }
    for (const key of [
      "blockId",
      "driverId",
      "vehicleId",
      "startsAt",
      "endsAt",
      "risk",
      "decisionDeadline",
      "label",
      "nextCursor",
      "amountMinor",
      "remittanceStatus",
    ]) {
      expect(isForbiddenField(key)).toBe(false);
    }
  });

  it("removes forbidden keys at every depth (removed, not nulled)", () => {
    const clean = stripForbidden(polluted(dayCalendar));
    const keys = keysDeep(clean);
    expect(keys.filter(isForbiddenField)).toEqual([]);
    expect(JSON.stringify(clean)).not.toMatch(
      /Ada Obi|Allen Avenue|polyline_ab12|999999/,
    );
    expect(clean.rows[1]?.occupied[0]?.risk).toBe("at_risk");
  });

  it("rebuilds a booking from its eight allowed fields only", () => {
    const raw = {
      ...polluted(dayCalendar.rows[1]?.occupied[0]),
      bookingId: "bk_x",
      zoneLabel: "Ikeja",
    };
    const block = projectOccupiedBlock(raw);
    expect(Object.keys(block ?? {}).sort()).toEqual(
      [
        "blockId",
        "decisionDeadline",
        "driverId",
        "endsAt",
        "kind",
        "risk",
        "startsAt",
        "vehicleId",
      ].sort(),
    );
    expect(projectOccupiedBlock({ blockId: "x" })).toBeNull();
  });

  it("sanitizeCalendar drops everything outside the allowlist from bookings", () => {
    const withExtra: FleetCalendar = {
      ...dayCalendar,
      rows: dayCalendar.rows.map((row) => ({
        ...row,
        occupied: row.occupied.map((block) => ({
          ...block,
          bookingId: "bk_hidden",
          zoneLabel: "Ikeja",
        })),
      })),
    };
    const clean = sanitizeCalendar(withExtra);
    expect(JSON.stringify(clean)).not.toMatch(/bk_hidden|Ikeja/);
  });
});

describe("the API client", () => {
  it("sends the staff token, and an idempotency key on state changes", async () => {
    const recorder = recordingFetch(() => json({ fleets: [] }));
    const client = createFleetApiClient({
      baseUrl: "https://gw.test",
      fetch: recorder.fetch,
      token: () => "tok_staff",
    });
    await client.get("/v1/fleets");
    await client.post(
      "/v1/fleets/f1/off-road",
      { vehicleId: "v1" },
      { idempotencyKey: "key-12345678" },
    );
    const [read, write] = recorder.calls;
    expect(read?.url).toBe("https://gw.test/v1/fleets");
    expect((read?.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok_staff",
    );
    expect(
      (read?.init.headers as Record<string, string>)["idempotency-key"],
    ).toBeUndefined();
    expect(write?.init.method).toBe("POST");
    expect(
      (write?.init.headers as Record<string, string>)["idempotency-key"],
    ).toBe("key-12345678");
    expect(write?.init.body).toBe(JSON.stringify({ vehicleId: "v1" }));
  });

  it("decodes service and gateway refusals to code + details", async () => {
    const service = await decodeResponse(
      json(
        {
          code: "needs_resolution",
          message: "Resolve first",
          details: { conflictIds: ["c1"] },
        },
        409,
      ),
    ).catch((error: unknown) => error);
    expect(service).toBeInstanceOf(ApiError);
    expect((service as ApiError).code).toBe("needs_resolution");
    expect((service as ApiError).details).toEqual({ conflictIds: ["c1"] });

    const gateway = await decodeResponse(
      json(
        {
          success: false,
          error: { code: "limited_mode", message: "Device not verified" },
        },
        403,
      ),
    ).catch((error: unknown) => error);
    expect((gateway as ApiError).status).toBe(403);
    expect((gateway as ApiError).code).toBe("limited_mode");

    const flagOff = await decodeResponse(
      json({ code: "feature_disabled", message: "off" }, 404),
    ).catch((error: unknown) => error);
    expect((flagOff as ApiError).code).toBe("feature_disabled");
  });
});

describe("fleet-api", () => {
  it("builds the calendar query the server reads", () => {
    const path = calendarPath("flt 1", {
      from: "2026-09-29T23:00:00.000Z",
      to: "2026-09-30T23:00:00.000Z",
      zoom: "day",
      rows: "vehicles",
      layers: ["assignments", "bookings"],
      vehicleClass: "comfort",
      conflictsOnly: true,
      q: " LAG ",
      limit: 40,
    });
    expect(path.startsWith("/v1/fleets/flt%201/calendar?")).toBe(true);
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("layers")).toBe("assignments,bookings");
    expect(params.get("class")).toBe("comfort");
    expect(params.get("conflictsOnly")).toBe("true");
    expect(params.get("q")).toBe("LAG");
    expect(params.get("limit")).toBe("40");
    expect(params.has("status")).toBe(false);
    expect(params.has("cursor")).toBe(false);
  });

  it("strips forbidden fields from every response, even a polluted one", async () => {
    const answers: Record<string, unknown> = {
      "/v1/fleets/flt_example/calendar": polluted(dayCalendar),
      "/v1/fleets/flt_example/vehicles/v1": polluted(vehicleView),
      "/v1/fleets/flt_example/maintenance:preview": polluted(infeasiblePreview),
    };
    const recorder = recordingFetch((url) =>
      json(answers[new URL(url).pathname] ?? {}),
    );
    const api = createFleetApi(
      createFleetApiClient({
        baseUrl: "https://gw.test",
        fetch: recorder.fetch,
        token: () => "t",
      }),
    );
    const results = [
      await api.calendar("flt_example", {
        from: dayCalendar.from,
        to: dayCalendar.to,
        zoom: "day",
        rows: "vehicles",
        layers: ["bookings"],
        conflictsOnly: false,
        limit: 40,
      }),
      await api.vehicle("flt_example", "v1"),
      await api.previewMaintenance("flt_example", {
        vehicleId: "v1",
        kind: "planned_service",
        startsAt: "2026-09-30T09:00:00.000Z",
        endsAt: "2026-09-30T14:00:00.000Z",
      }),
    ];
    for (const result of results) {
      expect(keysDeep(result).filter(isForbiddenField)).toEqual([]);
      const text = JSON.stringify(result);
      for (const value of FORBIDDEN_VALUES) {
        expect(text).not.toContain(value);
      }
    }
    // The preview changes nothing: it carries no idempotency key.
    const preview = recorder.calls.find((call) =>
      call.url.includes("maintenance:preview"),
    );
    expect(
      (preview?.init.headers as Record<string, string>)["idempotency-key"],
    ).toBeUndefined();
  });

  it("walks a refusal's details like a body: no forbidden key, bookings rebuilt from the allowlist", async () => {
    const booking = dayCalendar.rows[1]?.occupied[0];
    const block = maintenanceList.blocks[0];
    expect(booking).toBeDefined();
    expect(block).toBeDefined();
    const answers: Record<string, Response> = {
      "/v1/fleets/f/maintenance": json(
        {
          code: "needs_resolution",
          message: "Resolve every overlap first.",
          details: polluted({
            block,
            affectedBlocks: [{ ...booking, bookingId: "bk_hidden" }],
            conflictIds: ["cfl_1"],
          }),
        },
        409,
      ),
      "/v1/fleets/f/assignments/asg_1/terminate": json({
        assignmentId: "asg_1",
        status: "notice",
        noticeEndsOn: "2026-10-14",
        bookingsAfterNotice: [{ ...booking, bookingId: "bk_hidden" }],
        conflictIds: [],
      }),
    };
    const recorder = recordingFetch(
      (url) => answers[new URL(url, "https://gw.test").pathname] ?? json({}),
    );
    const api = createFleetApi(
      createFleetApiClient({
        baseUrl: "",
        fetch: recorder.fetch,
        token: () => "t",
      }),
    );
    const window = {
      vehicleId: "v1",
      kind: "planned_service" as const,
      startsAt: "2026-09-30T09:00:00.000Z",
      endsAt: "2026-09-30T14:00:00.000Z",
    };
    const refused: unknown = await api
      .createMaintenance("f", { ...window, previewToken: "mpv_x" }, "k-create1")
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiError);
    const error = refused as ApiError;
    expect(error.code).toBe("needs_resolution");
    expect(error.status).toBe(409);
    expect(keysDeep(error.details).filter(isForbiddenField)).toEqual([]);
    const text = JSON.stringify(error.details);
    expect(text).not.toContain("bk_hidden");
    for (const value of FORBIDDEN_VALUES) {
      expect(text).not.toContain(value);
    }
    const affected = (error.details?.affectedBlocks ?? []) as unknown[];
    expect(Object.keys(affected[0] ?? {}).sort()).toEqual(
      [
        "blockId",
        "decisionDeadline",
        "driverId",
        "endsAt",
        "kind",
        "risk",
        "startsAt",
        "vehicleId",
      ].sort(),
    );
    // The editor still holds the block from the sanitized refusal.
    expect(refusalState(error, window, "mpv_x")?.phase).toBe("held");

    const notice = await api.terminate("f", "asg_1", "k-notice-1");
    expect(JSON.stringify(notice)).not.toContain("bk_hidden");
    expect(notice.bookingsAfterNotice).toHaveLength(1);
  });

  it("sends each state change with the caller's key to the one route that performs it", async () => {
    const recorder = recordingFetch(() => json({}));
    const api = createFleetApi(
      createFleetApiClient({
        baseUrl: "",
        fetch: recorder.fetch,
        token: () => "t",
      }),
    );
    await api.remind("f", "c1", "k-remind-1");
    await api.requestVehicleSwap("f", "blk_1", "veh_2", "k-swap-001");
    await api.confirmMaintenance("f", "mnt_1", "mpv_x", "k-confirm1");
    await api.moveMaintenance(
      "f",
      "mnt_1",
      { startsAt: "a", endsAt: "b", previewToken: "mpv_y" },
      "k-move-001",
    );
    await api.putStaff("f", { staff: [] }, "k-staff-01");
    expect(
      recorder.calls.map((call) => `${call.init.method} ${call.url}`),
    ).toEqual([
      "POST /v1/fleets/f/conflicts/c1/remind",
      "POST /v1/fleets/f/bookings/blk_1/vehicle-swaps",
      "POST /v1/fleets/f/maintenance/mnt_1/confirm",
      "PATCH /v1/fleets/f/maintenance/mnt_1",
      "PUT /v1/fleets/f/staff",
    ]);
    expect(
      recorder.calls.map(
        (call) =>
          (call.init.headers as Record<string, string>)["idempotency-key"],
      ),
    ).toEqual([
      "k-remind-1",
      "k-swap-001",
      "k-confirm1",
      "k-move-001",
      "k-staff-01",
    ]);
  });
});
