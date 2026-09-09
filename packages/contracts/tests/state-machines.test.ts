import { describe, expect, it } from "vitest";

import {
  MACHINES,
  MACHINE_NAMES,
  TERMINAL_ONLY_STATES,
  allowedTransitions,
  assertTransition,
  canTransition,
  initialState,
  isTerminal,
  reachableStates,
  IllegalTransitionError,
  UnknownStateError,
  type MachineName,
} from "../src/state-machines";

describe("canonical state machines", () => {
  it("exposes every machine in contracts/state-machines.json", () => {
    expect([...MACHINE_NAMES].sort()).toEqual(
      [
        "driver",
        "fleetAssignment",
        "flightBooking",
        "journeyLeg",
        "order",
        "reservation",
        "rider",
        "shipment",
        "stayBooking",
        "supportCase",
        "walletTransfer",
        // RN-migration handoff machines (AI / travel / growth).
        "askReview",
        "askExecution",
        "travelOrder",
        "travelRefund",
        "rideReservation",
        "mandate",
        "mandateRun",
        "campaign",
        "referral",
        "promotionReservation",
      ].sort(),
    );
  });

  it.each(MACHINE_NAMES)(
    "%s: every transition target is a declared state",
    (name) => {
      const machine = MACHINES[name];
      for (const [from, targets] of Object.entries(machine.transitions)) {
        for (const to of targets) {
          expect(
            Object.prototype.hasOwnProperty.call(machine.transitions, to),
            `${name}: ${from} → ${to} targets an undeclared state`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(MACHINE_NAMES)(
    "%s: every state is reachable from the initial state",
    (name) => {
      const reachable = reachableStates(name);
      const declared = Object.keys(MACHINES[name].transitions);
      expect([...declared].filter((s) => !reachable.has(s))).toEqual([]);
    },
  );

  it("records states the contract declares only as transition targets", () => {
    // These are terminal leaves in the source contract; the generator keeps them
    // in the state union instead of dropping them.
    expect(TERMINAL_ONLY_STATES.rider).toEqual([
      "cancelled_by_ops",
      "cancelled_by_rider",
      "no_show",
    ]);
    for (const [machine, states] of Object.entries(TERMINAL_ONLY_STATES)) {
      for (const state of states) {
        expect(isTerminal(machine as MachineName, state)).toBe(true);
      }
    }
  });
});

describe("rider machine", () => {
  it("starts idle and walks the acceptance-demo happy path", () => {
    expect(initialState("rider")).toBe("idle");
    const happyPath = [
      "idle",
      "destination_selected",
      "quote_ready",
      "requesting",
      "matching",
      "driver_assigned",
      "driver_arrived",
      "pin_verification",
      "in_progress",
      "completed",
      "rated",
    ];
    for (let i = 0; i < happyPath.length - 1; i += 1) {
      const from = happyPath[i] as string;
      const to = happyPath[i + 1] as string;
      expect(canTransition("rider", from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it("refuses to skip PIN verification before the trip starts", () => {
    expect(canTransition("rider", "driver_arrived", "in_progress")).toBe(false);
    expect(() =>
      assertTransition("rider", "driver_arrived", "in_progress"),
    ).toThrow(IllegalTransitionError);
  });

  it("refuses to jump from matching straight to completed", () => {
    expect(() => assertTransition("rider", "matching", "completed")).toThrow(
      IllegalTransitionError,
    );
  });

  it("allows the recovery paths on the board", () => {
    expect(canTransition("rider", "matching", "no_driver")).toBe(true);
    expect(canTransition("rider", "no_driver", "matching")).toBe(true);
    expect(canTransition("rider", "driver_assigned", "rematching")).toBe(true);
    expect(canTransition("rider", "in_progress", "safety_hold")).toBe(true);
    expect(canTransition("rider", "payment_pending", "payment_failed")).toBe(
      true,
    );
  });

  it("rejects unknown states rather than guessing", () => {
    expect(() => assertTransition("rider", "teleporting", "idle")).toThrow(
      UnknownStateError,
    );
    expect(() => assertTransition("rider", "idle", "teleporting")).toThrow(
      UnknownStateError,
    );
    expect(canTransition("rider", "idle", "teleporting")).toBe(false);
  });
});

describe("driver machine", () => {
  it("cannot start the trip before the PIN is verified", () => {
    expect(canTransition("driver", "waiting", "in_trip")).toBe(false);
    expect(canTransition("driver", "waiting", "pin_verified")).toBe(true);
    expect(canTransition("driver", "pin_verified", "in_trip")).toBe(true);
  });

  it("returns to available after a completed trip", () => {
    expect(canTransition("driver", "in_trip", "collecting_payment")).toBe(true);
    expect(canTransition("driver", "collecting_payment", "completed")).toBe(
      true,
    );
    expect(canTransition("driver", "completed", "available")).toBe(true);
  });

  it("cannot accept an expired offer", () => {
    expect(canTransition("driver", "offer_expired", "accepted")).toBe(false);
    expect(allowedTransitions("driver", "offer_expired")).toEqual([
      "available",
    ]);
  });
});

describe("wallet transfer machine", () => {
  it("never allows a posted transfer to be pulled back unilaterally", () => {
    // CLAUDE.md #7: reversal requires recipient consent or a dispute.
    expect(canTransition("walletTransfer", "posted", "reversed")).toBe(false);
    expect(canTransition("walletTransfer", "posted", "return_requested")).toBe(
      true,
    );
    expect(
      canTransition("walletTransfer", "return_requested", "reversed"),
    ).toBe(true);
    expect(
      canTransition("walletTransfer", "declined_by_recipient", "disputed"),
    ).toBe(true);
    expect(canTransition("walletTransfer", "disputed", "reversed")).toBe(true);
  });
});

describe("travel order machine", () => {
  it("starts at payment_authorized and walks the confirm→ticket ladder", () => {
    expect(initialState("travelOrder")).toBe("payment_authorized");
    expect(canTransition("travelOrder", "payment_authorized", "submitted")).toBe(
      true,
    );
    expect(canTransition("travelOrder", "confirmed", "ticketed")).toBe(true);
    expect(canTransition("travelOrder", "ticketed", "completed")).toBe(true);
  });

  it("a PNR (confirmed) is not a ticket — ticketed is unreachable before confirmed", () => {
    // CLAUDE.md #24: ticketed only via documents_issued out of confirmed.
    expect(canTransition("travelOrder", "submitted", "ticketed")).toBe(false);
    expect(canTransition("travelOrder", "supplier_pending", "ticketed")).toBe(
      false,
    );
    expect(canTransition("travelOrder", "payment_authorized", "ticketed")).toBe(
      false,
    );
    expect(() =>
      assertTransition("travelOrder", "submitted", "ticketed"),
    ).toThrow(IllegalTransitionError);
  });

  it("resolves an unknown order only by lookup, never straight to ticketed", () => {
    // CLAUDE.md #24: unknown_reconciling → confirmed|failed_released only.
    expect(allowedTransitions("travelOrder", "unknown_reconciling")).toEqual([
      "confirmed",
      "failed_released",
    ]);
    expect(canTransition("travelOrder", "unknown_reconciling", "ticketed")).toBe(
      false,
    );
  });

  it("keeps failed_released, completed and refunded terminal", () => {
    expect(isTerminal("travelOrder", "failed_released")).toBe(true);
    expect(isTerminal("travelOrder", "completed")).toBe(true);
    expect(isTerminal("travelOrder", "refunded")).toBe(true);
  });
});

describe("promotion reservation machine", () => {
  it("reserves, then consumes on qualification or releases on expiry", () => {
    // CLAUDE.md #29: budget reserved on promise, consumed on qualification.
    expect(initialState("promotionReservation")).toBe("reserved");
    expect(canTransition("promotionReservation", "reserved", "consumed")).toBe(
      true,
    );
    expect(canTransition("promotionReservation", "reserved", "released")).toBe(
      true,
    );
    expect(canTransition("promotionReservation", "consumed", "reversed")).toBe(
      true,
    );
  });

  it("cannot release budget that was already consumed", () => {
    expect(canTransition("promotionReservation", "consumed", "released")).toBe(
      false,
    );
    expect(() =>
      assertTransition("promotionReservation", "consumed", "released"),
    ).toThrow(IllegalTransitionError);
  });
});

describe("mandate machine", () => {
  it("can pause and resume, or revoke, an active mandate", () => {
    expect(initialState("mandate")).toBe("active");
    expect(canTransition("mandate", "active", "paused")).toBe(true);
    expect(canTransition("mandate", "paused", "active")).toBe(true);
    expect(canTransition("mandate", "active", "revoked")).toBe(true);
  });

  it("never reactivates a revoked or expired mandate", () => {
    expect(isTerminal("mandate", "revoked")).toBe(true);
    expect(isTerminal("mandate", "expired")).toBe(true);
    expect(canTransition("mandate", "revoked", "active")).toBe(false);
    expect(() => assertTransition("mandate", "revoked", "active")).toThrow(
      IllegalTransitionError,
    );
  });
});
