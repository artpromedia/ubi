/**
 * The handoff's fleet portal testIDs, verbatim: every `fleet.*` id in the
 * handoff README's testID block is defined, and nothing else claims to be
 * a handoff id.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  FLEET_STATE_TEST_IDS,
  FLEET_TEST_IDS,
  HANDOFF_FLEET_TEST_IDS,
} from "../test-ids";

const README = path.resolve(
  __dirname,
  "../../../../../docs/launch-readiness/handoff-fleet-calendar/README.md",
);

function handoffFleetIds(): string[] {
  const text = readFileSync(README, "utf8");
  const start = text.indexOf("## testIDs");
  const block = text.slice(
    start,
    text.indexOf("```", text.indexOf("```", start) + 3),
  );
  return [
    ...new Set(block.match(/\bfleet\.[A-Za-z]+\.[A-Za-z]+\b/g) ?? []),
  ].sort();
}

describe("handoff testIDs", () => {
  it("defines every fleet.* id from the handoff README, verbatim", () => {
    const expected = handoffFleetIds();
    expect(expected.length).toBeGreaterThanOrEqual(25);
    expect([...HANDOFF_FLEET_TEST_IDS].sort()).toEqual(expected);
  });

  it("covers the named screens", () => {
    expect(Object.keys(FLEET_TEST_IDS).sort()).toEqual(
      [
        "assignment",
        "calendar",
        "conflicts",
        "maintenance",
        "offRoad",
        "staff",
        "utilisation",
        "vehicle",
      ].sort(),
    );
    expect(FLEET_TEST_IDS.calendar.vehicleRow).toBe(
      "fleet.calendar.vehicleRow",
    );
    expect(FLEET_TEST_IDS.maintenance.confirm).toBe(
      "fleet.maintenance.confirm",
    );
  });

  it("keeps portal-local state ids out of the handoff namespace", () => {
    for (const id of [
      FLEET_STATE_TEST_IDS.loading,
      FLEET_STATE_TEST_IDS.empty,
      FLEET_STATE_TEST_IDS.access("flag_off"),
    ]) {
      expect(id.startsWith("fleet.")).toBe(false);
    }
  });
});
