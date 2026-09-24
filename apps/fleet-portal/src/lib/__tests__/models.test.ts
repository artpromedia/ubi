/**
 * Conflicts (B6), maintenance (B5), proposals (B7), utilisation (B8),
 * staff (B9) and vehicle detail (B4) models.
 */
import { describe, expect, it } from "vitest";

import { ApiError } from "../api-client";
import {
  checkCopy,
  consentTimeline,
  draftDiffRows,
  proposeRefusal,
  serverDiffRows,
} from "../assignment-model";
import { conflictRow, conflictSummary, planAction } from "../conflicts-model";
import {
  confirmControl,
  formFromWindow,
  formWindow,
  offRoadOutcome,
  refusalState,
  suggestionModels,
  type EditorState,
  type MaintenanceForm,
} from "../maintenance-model";
import { can, ROLE_MATRIX } from "../roles";
import { staffBody, staffProblems } from "../staff-model";
import { definitionList, utilisationRows } from "../utilisation-model";
import {
  blockMoves,
  documentsTimeline,
  maintenanceLines,
  weekMoneyLines,
} from "../vehicle-model";
import {
  assignments,
  conflicts,
  dayCalendar,
  feasiblePreview,
  infeasiblePreview,
  maintenanceList,
  NOW,
  utilisation,
  VEH,
  vehicleAvailability,
  vehicleView,
  ZONE,
} from "./fixtures";

import type { ConflictView, ProposalView } from "../fleet-types";

describe("conflict centre model — actions only from allowedActions", () => {
  const [maint, doc, driver, held] = conflicts.conflicts as [
    ConflictView,
    ConflictView,
    ConflictView,
    ConflictView,
  ];

  it("offers exactly the server's allowed actions, in its order", () => {
    const row = conflictRow(maint, ZONE, {
      plates: new Map([[VEH.ab, "LAG-118-AB"]]),
      drivers: new Map(),
    });
    expect(row.actions.map((plan) => plan.action)).toEqual(
      maint.allowedActions,
    );
    expect(row.noActionText).toBeNull();
    expect(row.title).toBe("Maintenance overlaps a confirmed booking");
    expect(row.subject).toBe("LAG-118-AB · Driver · 1 booking");
    expect(row.resolver).toBe("Fleet → driver → rider");
    expect(row.deadline).toBe("30 Sep 09:20 WAT");
  });

  it("wires each action to the one route that performs it", () => {
    expect(planAction(maint, "ask_driver")).toEqual({
      action: "ask_driver",
      label: "Ask the driver to review",
      kind: "remind",
      conflictId: "fcf_maint",
    });
    expect(planAction(maint, "propose_vehicle_swap")).toMatchObject({
      kind: "swap",
      bookingBlockId: "blk_ab_1",
      fromVehicleId: VEH.ab,
    });
    expect(planAction(maint, "move_block")).toMatchObject({
      kind: "maintenance",
      href: `/vehicles/${VEH.ab}#maintenance`,
    });
    expect(planAction(doc, "renew_document")).toMatchObject({
      kind: "unavailable",
    });
    expect(planAction(doc, "propose_vehicle_swap")).toMatchObject({
      kind: "unavailable",
      reason: "No booking is linked to this conflict.",
    });
  });

  it("is view only for a driver's conflict and no action for UBI's", () => {
    const driverRow = conflictRow(driver, ZONE);
    expect(driverRow.actions).toEqual([]);
    expect(driverRow.noActionText).toBe("View only");
    expect(driverRow.resolver).toBe("Driver (resolving)");
    expect(driverRow.title).toBe("Driver resolving a booking");
    expect(JSON.stringify(driverRow)).not.toMatch(/time off/i);
    expect(conflictRow(held, ZONE).noActionText).toBe("No action");
  });

  it("summarises open conflicts", () => {
    expect(conflictSummary(conflicts.conflicts)).toBe(
      "3 open · 1 status only · sorted by deadline",
    );
  });
});

describe("maintenance editor model (B5)", () => {
  const window = {
    vehicleId: VEH.ab,
    kind: "planned_service" as const,
    startsAt: "2026-09-30T09:00:00.000Z",
    endsAt: "2026-09-30T14:00:00.000Z",
  };

  it("keeps Confirm disabled until the server says the window is free", () => {
    const states: [EditorState, boolean, string | null][] = [
      [{ phase: "form" }, false, "Check the impact with the server first."],
      [
        { phase: "checking", window },
        false,
        "Checking impact with the server…",
      ],
      [
        { phase: "preview", window, preview: infeasiblePreview },
        false,
        "Must be resolved first.",
      ],
      [{ phase: "preview", window, preview: feasiblePreview }, true, null],
      [
        { phase: "saving", window, preview: feasiblePreview },
        false,
        "Saving with UBI…",
      ],
    ];
    for (const [state, enabled, reason] of states) {
      const control = confirmControl(state, true, true);
      expect(control.visible).toBe(true);
      expect(control.enabled).toBe(enabled);
      expect(control.reason).toBe(reason);
    }
    expect(
      confirmControl(
        { phase: "preview", window, preview: feasiblePreview },
        false,
        true,
      ).enabled,
    ).toBe(false);
    expect(
      confirmControl(
        { phase: "preview", window, preview: feasiblePreview },
        true,
        false,
      ).visible,
    ).toBe(false);
  });

  it("presents only the server's suggestions, with neutral copy and no remittance amounts", () => {
    const models = suggestionModels(infeasiblePreview, ZONE);
    expect(models.map((model) => model.title)).toEqual([
      "Move block to 13:40–18:40",
      "Propose a vehicle swap for the booking (Booked · 11:20–13:00)",
      "Ask Bola A. to review the booking (Booked · 11:20–13:00)",
    ]);
    expect(models[0]?.detail).toBe(
      "Next window the server found with no overlaps (buffers included)",
    );
    expect(
      models[1]?.kind === "swap" &&
        models[1].eligible.map((candidate) => candidate.plate),
    ).toEqual(["LAG-744-MM"]);
    expect(models[2]?.detail).toBe(
      "Only Bola A. can withdraw. The block stays in needs_resolution until they decide.",
    );
    const text = JSON.stringify(models);
    expect(text).not.toMatch(
      /₦|remittance|pro-rat|\bher\b|\bshe\b|\bhis\b|\bhe\b/i,
    );
  });

  it("holds the block on a 409 needs_resolution and explains other refusals", () => {
    const details = {
      block: dayCalendar.rows[1]?.maintenance[0],
      affectedBlocks: [],
      conflictIds: ["fcf_maint"],
    };
    const held = refusalState(
      new ApiError(409, "needs_resolution", "x", details),
      window,
      "mpv_x",
    );
    expect(held).toMatchObject({
      phase: "held",
      previewToken: "mpv_x",
      details: { conflictIds: ["fcf_maint"] },
    });
    expect(
      refusalState(new ApiError(409, "preview_stale", "x"), window, "t"),
    ).toEqual({
      phase: "refused",
      window,
      message:
        "The window changed since the server checked it. Check the impact again.",
    });
    expect(refusalState(new TypeError("network"), window, "t")).toBeNull();
  });

  it("turns city-time form fields into the server's window, and back", () => {
    const form: MaintenanceForm = {
      vehicleId: VEH.ab,
      kind: "inspection",
      startDate: "2026-09-30",
      startTime: "10:00",
      endDate: "2026-09-30",
      endTime: "15:00",
      note: "",
    };
    expect(formWindow(form, ZONE)).toEqual({
      window: {
        vehicleId: VEH.ab,
        kind: "inspection",
        startsAt: "2026-09-30T09:00:00.000Z",
        endsAt: "2026-09-30T14:00:00.000Z",
      },
    });
    expect(formWindow({ ...form, endTime: "09:00" }, ZONE)).toEqual({
      problem: "The block must end after it starts.",
    });
    expect(formWindow({ ...form, vehicleId: "" }, ZONE)).toEqual({
      problem: "Choose a vehicle.",
    });
    expect(
      formFromWindow(
        {
          startsAt: "2026-09-30T12:40:00.000Z",
          endsAt: "2026-09-30T17:40:00.000Z",
        },
        form,
        ZONE,
      ),
    ).toMatchObject({ startTime: "13:40", endTime: "18:40" });
  });

  it("says an off-road report puts bookings at risk, never cancels them", () => {
    expect(
      offRoadOutcome(
        [{ blockId: "b", decisionDeadline: "2026-09-30T08:20:00.000Z" }],
        ZONE,
      ),
    ).toEqual([
      "The vehicle is off-road now. 1 booking is at risk. Nothing was cancelled.",
      "At risk · needs a decision by 30 Sep 09:20",
    ]);
    expect(offRoadOutcome([], ZONE)).toEqual([
      "The vehicle is off-road now. No booking was affected.",
    ]);
  });
});

describe("proposal and consent model (B7)", () => {
  const [kemi, declined] = assignments.proposals as [
    ProposalView,
    ProposalView,
  ];

  it("walks sent → waiting (with expiry, not availability) → outcome", () => {
    const steps = consentTimeline(kemi, ZONE);
    expect(steps.map((step) => [step.title, step.state])).toEqual([
      ["Sent", "done"],
      ["Waiting for Kemi L.'s signature", "current"],
      ["Signed with PIN", "todo"],
    ]);
    expect(steps[1]?.detail).toBe(
      "Expires 25 Sep 10:02 WAT (48 h). Not counted as availability.",
    );
  });

  it("never shows why a driver declined, and says there is no penalty", () => {
    const outcome = consentTimeline(declined, ZONE)[2];
    expect(outcome?.detail).toBe(
      "Tunde B. declined. No reason is required and there is no penalty.",
    );
    expect(
      consentTimeline({ ...kemi, status: "expired" }, ZONE)[2]?.detail,
    ).toBe("No reply in 48 h. You can send a new proposal.");
  });

  it("states the server's checks with the server's amounts", () => {
    expect(checkCopy(kemi)).toBe(
      "Server check passed: no overlap with a signed shift, and ₦40,000.00 is within the city cap (₦150,000.00).",
    );
    expect(checkCopy(declined)).toBe(
      "Server check passed: no overlap with a signed shift.",
    );
    expect(serverDiffRows(kemi, new Map([[VEH.mm, "LAG-744-MM"]]))).toEqual([
      {
        term: "Vehicle",
        proposed: "LAG-744-MM",
        consent: "Needs a new PIN signature",
      },
      {
        term: "Shift",
        proposed: "Shift 14:00–22:00",
        consent: "Needs a new PIN signature",
      },
      {
        term: "Remittance",
        proposed: "₦40,000.00 / week (weekly fixed)",
        consent: "Needs a new PIN signature",
      },
    ]);
  });

  it("explains a blocked proposal with the server's overlap or cap", () => {
    const overlap = new ApiError(422, "shift_overlap", "x", {
      overlaps: [
        {
          reason: "vehicle_shift_taken",
          plate: "LAG-744-MM",
          driverDisplayName: "Tunde B.",
          shift: { kind: "day", start: "06:00", end: "14:00" },
        },
      ],
    });
    expect(proposeRefusal(overlap, "Shift 12:00–20:00")).toBe(
      "Shift 12:00–20:00 overlaps Tunde B.'s signed shift on LAG-744-MM (06:00–14:00). Change the times to send.",
    );
    const other = new ApiError(422, "shift_overlap", "x", {
      overlaps: [{ reason: "driver_has_other_arrangement" }],
    });
    expect(proposeRefusal(other, "Night shift")).toBe(
      "Night shift overlaps a signed shift this driver has with another fleet. Change the times to send.",
    );
    const cap = new ApiError(422, "above_city_cap", "x", {
      amount: { amountMinor: 20_000_000, currency: "NGN" },
      cityCap: { amountMinor: 15_000_000, currency: "NGN" },
    });
    expect(proposeRefusal(cap, "Day shift")).toBe(
      "₦200,000.00 is above the city cap of ₦150,000.00. Lower it to send.",
    );
    expect(
      proposeRefusal(
        new ApiError(403, "terms_owner_only", "x", {
          reason: "no_signed_terms",
        }),
        "Day shift",
      ),
    ).toMatch(/A fleet owner proposes the first terms/);
  });

  it("shows the driver's signed terms beside the draft", () => {
    const current = assignments.arrangements[0] ?? null;
    const rows = draftDiffRows(
      current,
      {
        vehiclePlate: "LAG-118-AB",
        shiftText: "Night shift",
        shiftKey: "night",
        validFrom: "2026-10-01",
        validTo: null,
        terms: null,
      },
      new Map([[VEH.ab, "LAG-118-AB"]]),
    );
    expect(rows.find((row) => row.term === "Vehicle")).toMatchObject({
      current: "LAG-118-AB",
      changed: false,
    });
    expect(rows.find((row) => row.term === "Shift")).toMatchObject({
      current: "Day shift 06:00–18:00",
      proposed: "Night shift",
      changed: true,
    });
    expect(rows.find((row) => row.term === "Remittance")).toMatchObject({
      proposed: "Unchanged (signed terms v1)",
      changed: false,
    });
  });
});

describe("roles (B9)", () => {
  it("lets only owners propose terms and manage staff, and nobody see rider data", () => {
    expect(can("manager", "propose_assignment")).toBe(true);
    expect(can("manager", "propose_terms")).toBe(false);
    expect(can("read_only", "manage_maintenance")).toBe(false);
    expect(can("owner", "manage_staff")).toBe(true);
    expect(can(null, "view_calendar")).toBe(false);
    const never = ROLE_MATRIX.find((row) =>
      row.capability.startsWith("See rider identity"),
    );
    expect(never?.cells).toEqual({
      owner: "Never",
      manager: "Never",
      read_only: "Never",
    });
    expect(
      ROLE_MATRIX.find((row) => row.capability === "Manage staff")?.cells,
    ).toEqual({ owner: "Yes", manager: "No", read_only: "No" });
  });

  it("keeps at least one owner in the staff list", () => {
    expect(
      staffProblems([{ userId: "u1", role: "manager", displayName: null }]),
    ).toEqual(["A fleet must keep at least one owner."]);
    expect(
      staffProblems([
        { userId: "u1", role: "owner", displayName: null },
        { userId: "u1", role: "manager", displayName: null },
      ]),
    ).toEqual(["u1 is listed twice."]);
    expect(
      staffBody([{ userId: " u1 ", role: "owner", displayName: "A" }]),
    ).toEqual({ staff: [{ userId: "u1", role: "owner" }] });
  });
});

describe("utilisation model (B8)", () => {
  it("draws only measured metrics, names the rest unavailable, and says Not enough data", () => {
    const [ab, zx] = utilisationRows(utilisation);
    expect(ab?.segments.map((segment) => segment.text)).toEqual([
      "Booked ahead 7 h",
      "Maintenance 10.5 h",
    ]);
    expect(ab?.segments[1]?.pct).toBeCloseTo((10.5 / 168) * 100, 5);
    expect(ab?.unavailable).toEqual([
      {
        metric: "On trip",
        reason:
          "no per-vehicle trip-hours history is available to fleet-service",
      },
    ]);
    expect(zx).toMatchObject({
      enoughData: false,
      note: "Not enough data · added 26 Sep",
      segments: [],
    });
    expect(definitionList(utilisation).map((entry) => entry.label)).toEqual([
      "On trip",
      "Online idle",
      "Booked ahead",
      "Maintenance",
      "Offline",
    ]);
  });
});

describe("vehicle detail model (B4)", () => {
  it("flags a booking after an expiry only when the server's conflict names it", () => {
    const occupied = vehicleAvailability.rows[0]?.occupied ?? [];
    const unflagged = documentsTimeline({
      documents: vehicleView.documents,
      occupied,
      conflicts: [],
      from: vehicleAvailability.from,
      to: vehicleAvailability.to,
      zone: ZONE,
    });
    expect(unflagged.bookings.some((booking) => booking.afterExpiry)).toBe(
      false,
    );
    const flagged = documentsTimeline({
      documents: vehicleView.documents,
      occupied,
      conflicts: [
        {
          ...(conflicts.conflicts[1] as ConflictView),
          type: "document_expires_in_booking",
          subjects: [
            { vehicleId: VEH.ab, driverId: null, blockId: "blk_ab_late" },
          ],
        },
      ],
      from: vehicleAvailability.from,
      to: vehicleAvailability.to,
      zone: ZONE,
    });
    expect(
      flagged.bookings.find((booking) => booking.blockId === "blk_ab_late")
        ?.afterExpiry,
    ).toBe(true);
    expect(flagged.cards[0]).toMatchObject({
      title: "Insurance",
      status: "expiring · 15 Oct",
      hint: "1 booking after this date (flagged by UBI)",
    });
    expect(flagged.rangeLabel).toBe("30 Sep – 29 Oct");
    expect(flagged.markers.map((marker) => marker.label)).toEqual([
      "Insurance expiring · 15 Oct",
    ]);
  });

  it("splits maintenance into upcoming and past with the moves each state allows", () => {
    const lines = maintenanceLines(maintenanceList.blocks, NOW, ZONE);
    expect(
      lines.upcoming.map((line) => `${line.kind} · ${line.status}`),
    ).toEqual(["Planned service · Needs resolution", "Inspection · Scheduled"]);
    expect(
      lines.past.map((line) => `${line.kind} · ${line.when} · ${line.status}`),
    ).toEqual(["Repair · 12 Sep 09:00–13:30 · Completed"]);
    const [held, inspection] = lines.upcoming.map((line) => line.block);
    expect(held && blockMoves(held, NOW)).toEqual(["resolve", "cancel"]);
    expect(inspection && blockMoves(inspection, NOW)).toEqual(["cancel"]);
    expect(
      inspection && blockMoves({ ...inspection, status: "active" }, NOW),
    ).toEqual(["complete"]);
    expect(
      inspection &&
        blockMoves(
          { ...inspection, kind: "unplanned_off_road", status: "active" },
          NOW,
        ),
    ).toEqual(["complete"]);
  });

  it("shows the week's four money lines — never a driver's net — and nothing estimated", () => {
    const unavailable = weekMoneyLines(vehicleView.money);
    expect(unavailable.available).toBe(false);
    expect(
      unavailable.lines.map((line) => `${line.label}: ${line.value}`),
    ).toEqual([
      "Week gross: Not available yet",
      "UBI commission: Not available yet",
      "Fleet remittance: Not available yet",
      "Remittance status: Not available yet",
    ]);
    const served = weekMoneyLines({
      available: true,
      weekGross: { amountMinor: 18_450_000, currency: "NGN" },
      ubiCommission: { amountMinor: 1_845_000, currency: "NGN" },
      fleetRemittance: { amountMinor: 4_500_000, currency: "NGN" },
      remittanceStatus: "Covered",
      ...({ driverNet: { amountMinor: 999_999, currency: "NGN" } } as object),
    });
    expect(served.lines.map((line) => `${line.label}: ${line.value}`)).toEqual([
      "Week gross: ₦184,500.00",
      "UBI commission: ₦18,450.00",
      "Fleet remittance: ₦45,000.00",
      "Remittance status: Covered",
    ]);
    expect(JSON.stringify(served)).not.toMatch(/9,999\.99|net/i);
  });
});
