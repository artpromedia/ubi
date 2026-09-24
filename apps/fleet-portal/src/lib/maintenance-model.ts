/**
 * The maintenance editor (B5) as pure data.
 *
 * Feasibility is the server's: the editor shows "Checking impact with the
 * server…" until `maintenance:preview` answers, and "Confirm block" stays
 * disabled while checking, while offline, and whenever the server's preview
 * is not feasible ("Must be resolved first"). Planned maintenance is never
 * confirmed over a confirmed booking — if a confirm races a new booking the
 * server answers 409 `needs_resolution` and the block is held, never
 * scheduled. Resolution options are the server's suggestions only.
 *
 * Decisions doc: the preview lists affected assignments and opaque bookings
 * and does NOT show per-driver pro-rated remittance amounts; a vehicle swap
 * always needs the rider's consent (Q3); a breakdown is "Report off-road",
 * which follows the signed terms' shortfall rule (Q8) — no pro-rating copy.
 */
import { ApiError } from "./api-client";
import { reasonLabel } from "./labels";
import {
  dateTimeIn,
  localDateOf,
  localInputToIso,
  localTimeOf,
  timeRangeIn,
} from "./time";

import type {
  MaintenanceBlockView,
  MaintenancePreviewView,
  MaintenanceWindowInput,
  NeedsResolutionDetails,
  OccupiedBlock,
} from "./fleet-types";

export type EditorState =
  | { readonly phase: "form" }
  | { readonly phase: "checking"; readonly window: MaintenanceWindowInput }
  | {
      readonly phase: "preview";
      readonly window: MaintenanceWindowInput;
      readonly preview: MaintenancePreviewView;
    }
  | {
      readonly phase: "saving";
      readonly window: MaintenanceWindowInput;
      readonly preview: MaintenancePreviewView;
    }
  | { readonly phase: "scheduled"; readonly block: MaintenanceBlockView }
  | {
      readonly phase: "held";
      readonly window: MaintenanceWindowInput;
      readonly details: NeedsResolutionDetails;
      readonly previewToken: string;
    }
  | {
      readonly phase: "refused";
      readonly window: MaintenanceWindowInput | null;
      readonly message: string;
    };

export interface ConfirmControl {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly label: string;
  readonly reason: string | null;
}

/** "Confirm block": disabled until the server's preview says it is feasible. */
export function confirmControl(
  state: EditorState,
  online: boolean,
  canManage: boolean,
): ConfirmControl {
  if (!canManage) {
    // Permission denied hides the control (B9).
    return {
      visible: false,
      enabled: false,
      label: "Confirm block",
      reason: null,
    };
  }
  const disabled = (reason: string): ConfirmControl => ({
    visible: true,
    enabled: false,
    label: "Confirm block",
    reason,
  });
  if (!online) {
    return disabled(
      "You're offline. Nothing is saved or queued until you reconnect.",
    );
  }
  switch (state.phase) {
    case "form":
      return disabled("Check the impact with the server first.");
    case "checking":
      return disabled("Checking impact with the server…");
    case "saving":
      return disabled("Saving with UBI…");
    case "preview":
      return state.preview.feasible
        ? { visible: true, enabled: true, label: "Confirm block", reason: null }
        : disabled("Must be resolved first.");
    case "held":
      return disabled(
        "Must be resolved first. Re-check once each booking is resolved.",
      );
    default:
      return {
        visible: false,
        enabled: false,
        label: "Confirm block",
        reason: null,
      };
  }
}

export interface AffectedAssignmentLine {
  readonly driver: string;
  readonly lost: string;
  readonly note: string;
}

export function affectedAssignmentLines(
  preview: MaintenancePreviewView,
  zone: string,
): AffectedAssignmentLine[] {
  return preview.affectedAssignments.map((assignment) => ({
    driver: assignment.driverDisplayName,
    lost: `No vehicle ${timeRangeIn(assignment.lostInterval.startsAt, assignment.lostInterval.endsAt, zone)}`,
    note: `${assignment.driverDisplayName} will be notified. Their signed terms don't change.`,
  }));
}

/** "Booked · 11:20–13:00" — the only way a booking appears (decisions Q1). */
export const bookingLabel = (block: OccupiedBlock, zone: string): string =>
  `${block.kind === "on_trip" ? "On a trip" : "Booked"} · ${timeRangeIn(block.startsAt, block.endsAt, zone)}`;

export type SuggestionModel =
  | {
      readonly kind: "move";
      readonly key: string;
      readonly title: string;
      readonly detail: string;
      readonly window: { readonly startsAt: string; readonly endsAt: string };
    }
  | {
      readonly kind: "swap";
      readonly key: string;
      readonly title: string;
      readonly detail: string;
      readonly bookingBlockId: string;
      readonly eligible: readonly {
        readonly vehicleId: string;
        readonly plate: string;
      }[];
    }
  | {
      readonly kind: "ask_driver";
      readonly key: string;
      readonly title: string;
      readonly detail: string;
      readonly bookingBlockId: string;
      readonly driver: string;
    };

export function suggestionModels(
  preview: MaintenancePreviewView,
  zone: string,
  driverNames: ReadonlyMap<string, string> = new Map(),
): SuggestionModel[] {
  const names = new Map(driverNames);
  for (const assignment of preview.affectedAssignments) {
    names.set(assignment.driverId, assignment.driverDisplayName);
  }
  const bookingText = (blockId: string): string => {
    const block = preview.affectedBlocks.find(
      (candidate) => candidate.blockId === blockId,
    );
    return block === undefined
      ? "the booking"
      : `the booking (${bookingLabel(block, zone)})`;
  };
  return preview.suggestions.map((suggestion, index) => {
    if (suggestion.kind === "move") {
      return {
        kind: "move" as const,
        key: `move-${index}`,
        title: `Move block to ${timeRangeIn(suggestion.startsAt, suggestion.endsAt, zone)}`,
        detail:
          "Next window the server found with no overlaps (buffers included)",
        window: { startsAt: suggestion.startsAt, endsAt: suggestion.endsAt },
      };
    }
    if (suggestion.kind === "swap") {
      const eligible = suggestion.candidates.filter(
        (candidate) => candidate.eligible,
      );
      const ineligible = suggestion.candidates.filter(
        (candidate) => !candidate.eligible,
      );
      const why = ineligible
        .map(
          (candidate) =>
            `${candidate.plate}: ${candidate.reasons.map(reasonLabel).join(", ") || "not eligible"}`,
        )
        .join("; ");
      let detail =
        "The driver accepts first, then the rider confirms the new vehicle. Nothing changes until both agree.";
      if (suggestion.candidates.length === 0) {
        detail = "No other vehicle in your fleet can take it.";
      } else if (eligible.length === 0) {
        detail = `No eligible vehicle: ${why}`;
      } else if (ineligible.length > 0) {
        detail = `${detail} Not eligible: ${why}`;
      }
      return {
        kind: "swap" as const,
        key: `swap-${index}`,
        title: `Propose a vehicle swap for ${bookingText(suggestion.bookingBlockId)}`,
        detail,
        bookingBlockId: suggestion.bookingBlockId,
        eligible: eligible.map((candidate) => ({
          vehicleId: candidate.vehicleId,
          plate: candidate.plate,
        })),
      };
    }
    const driver = names.get(suggestion.driverId) ?? "the driver";
    return {
      kind: "ask_driver" as const,
      key: `ask-${index}`,
      title: `Ask ${driver} to review ${bookingText(suggestion.bookingBlockId)}`,
      detail: `Only ${driver} can withdraw. The block stays in needs_resolution until they decide.`,
      bookingBlockId: suggestion.bookingBlockId,
      driver,
    };
  });
}

export const PLANNED_NEVER_CANCELS =
  'Planned maintenance never cancels a booking. Breakdown? Use "Report off-road".';

/** A create/confirm/move answer that is not a success, as the editor state. */
export function refusalState(
  error: unknown,
  window: MaintenanceWindowInput | null,
  previewToken: string | null,
): EditorState | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  if (
    error.code === "needs_resolution" &&
    error.details !== null &&
    window !== null
  ) {
    const details = error.details as unknown as NeedsResolutionDetails;
    if (details.block !== undefined && Array.isArray(details.affectedBlocks)) {
      return {
        phase: "held",
        window,
        details,
        previewToken: previewToken ?? "",
      };
    }
  }
  const messages: Readonly<Record<string, string>> = {
    preview_stale:
      "The window changed since the server checked it. Check the impact again.",
    maintenance_overlap:
      "This overlaps another maintenance block on the vehicle. Change the times.",
    validation_failed: error.detail,
    illegal_transition:
      "This block can no longer change that way. Reload to see its current state.",
  };
  const message = error.code === null ? undefined : messages[error.code];
  return message === undefined ? null : { phase: "refused", window, message };
}

/** Off-road outcome copy: bookings are at risk (never cancelled), with deadlines. */
export function offRoadOutcome(
  atRisk: readonly {
    readonly blockId: string;
    readonly decisionDeadline: string;
  }[],
  zone: string,
): string[] {
  if (atRisk.length === 0) {
    return ["The vehicle is off-road now. No booking was affected."];
  }
  return [
    `The vehicle is off-road now. ${atRisk.length === 1 ? "1 booking is" : `${atRisk.length} bookings are`} at risk. Nothing was cancelled.`,
    ...atRisk.map(
      (booking) =>
        `At risk · needs a decision by ${dateTimeIn(booking.decisionDeadline, zone)}`,
    ),
  ];
}

export interface MaintenanceForm {
  readonly vehicleId: string;
  readonly kind: MaintenanceWindowInput["kind"];
  readonly startDate: string;
  readonly startTime: string;
  readonly endDate: string;
  readonly endTime: string;
  readonly note: string;
}

/**
 * The form's local (city-zone) start and end as the server's window, or the
 * reason it can't be sent. Only shape is checked here — whether the window
 * is free is the server's answer.
 */
export function formWindow(
  form: MaintenanceForm,
  zone: string,
): { readonly window: MaintenanceWindowInput } | { readonly problem: string } {
  if (form.vehicleId === "") {
    return { problem: "Choose a vehicle." };
  }
  if (
    form.startDate === "" ||
    form.startTime === "" ||
    form.endDate === "" ||
    form.endTime === ""
  ) {
    return { problem: "Set a start and an end." };
  }
  const startsAt = localInputToIso(form.startDate, form.startTime, zone);
  const endsAt = localInputToIso(form.endDate, form.endTime, zone);
  if (!(endsAt > startsAt)) {
    return { problem: "The block must end after it starts." };
  }
  return {
    window: { vehicleId: form.vehicleId, kind: form.kind, startsAt, endsAt },
  };
}

/** The form fields for a server window (a "move" suggestion, a held block). */
export function formFromWindow(
  window: { readonly startsAt: string; readonly endsAt: string },
  base: MaintenanceForm,
  zone: string,
): MaintenanceForm {
  const start = new Date(window.startsAt).getTime();
  const end = new Date(window.endsAt).getTime();
  return {
    ...base,
    startDate: localDateOf(start, zone),
    startTime: localTimeOf(start, zone),
    endDate: localDateOf(end, zone),
    endTime: localTimeOf(end, zone),
  };
}

export const sameWindow = (
  a: { readonly startsAt: string; readonly endsAt: string | null },
  b: { readonly startsAt: string; readonly endsAt: string | null },
): boolean =>
  new Date(a.startsAt).getTime() === new Date(b.startsAt).getTime() &&
  (a.endsAt === null ? null : new Date(a.endsAt).getTime()) ===
    (b.endsAt === null ? null : new Date(b.endsAt).getTime());
