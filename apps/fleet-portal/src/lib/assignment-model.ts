/**
 * Proposals and consent (B7) as pure data.
 *
 * A fleet proposes; only the driver signs, with their PIN, in the driver
 * app. The overlap and city-cap checks are the server's (a proposal that
 * overlaps a signed shift or is above the cap is refused with 422 and never
 * sent). Managers propose only under the driver's CURRENTLY SIGNED terms
 * version; new remittance terms are owner-only. The fleet sees only the
 * outcome of a proposal — never why a driver declined — and declining has
 * no penalty.
 */
import { ApiError } from "./api-client";
import { shiftName, PROPOSAL_STATUS_LABELS } from "./labels";
import { formatMinor, formatMoney } from "./money";
import { dateTimeIn, shortDate, zoneShort } from "./time";

import type {
  ArrangementView,
  AssignmentTerms,
  FleetShiftInput,
  ProposalView,
  TermDiffField,
} from "./fleet-types";

export const shiftKeyOf = (shift: {
  readonly kind: string;
  readonly start: string;
  readonly end: string;
}): string =>
  shift.kind === "custom" ? `custom:${shift.start}-${shift.end}` : shift.kind;

export const shiftInputKey = (shift: FleetShiftInput): string =>
  typeof shift === "string" ? shift : `custom:${shift.start}-${shift.end}`;

/** A shift as typed in the form ("Night shift", "Shift 14:00–22:00"). */
export function shiftInputText(shift: FleetShiftInput): string {
  if (shift === "full") {
    return "Full shift";
  }
  if (shift === "day") {
    return "Day shift";
  }
  if (shift === "night") {
    return "Night shift";
  }
  return `Shift ${shift.start}–${shift.end}`;
}

export function remittanceText(terms: AssignmentTerms): string {
  if (terms.type === "weekly_fixed") {
    return `${formatMinor(terms.amountMinor, terms.currency)} / week (weekly fixed)`;
  }
  return `${terms.percent ?? "—"}% of weekly net (percent of net)`;
}

export const shortfallText = (terms: AssignmentTerms): string =>
  `Carry forward · up to ${terms.shortfall.maxWeeks} ${terms.shortfall.maxWeeks === 1 ? "week" : "weeks"}`;

export const validityText = (from: string, to: string | null): string =>
  to === null
    ? `From ${shortDate(from)}`
    : `${shortDate(from)} – ${shortDate(to)}`;

export interface DiffRow {
  readonly term: string;
  readonly current: string;
  readonly proposed: string;
  readonly changed: boolean;
}

export interface ProposedDraft {
  readonly vehiclePlate: string;
  /** "Night shift", "Shift 14:00–22:00" — the named windows are the city's. */
  readonly shiftText: string | null;
  /** `day`, `night`, `full` or `custom:HH:mm-HH:mm`, to compare with the signed shift. */
  readonly shiftKey: string | null;
  readonly validFrom: string;
  readonly validTo: string | null;
  /** null = the driver's currently signed terms are reused. */
  readonly terms: AssignmentTerms | null;
}

/**
 * "What {driver} will see" before sending: the driver's current signed
 * arrangement beside the draft. After sending, the SERVER's diff (with its
 * material flags) replaces this (`serverDiffRows`).
 */
export function draftDiffRows(
  current: ArrangementView | null,
  draft: ProposedDraft,
  plates: ReadonlyMap<string, string>,
): DiffRow[] {
  const currentPlate =
    current === null
      ? "None"
      : (plates.get(current.vehicleId) ?? "Signed vehicle");
  const currentShift = current === null ? "None" : shiftName(current.shift);
  const proposedShift = draft.shiftText ?? "—";
  const currentTerms =
    current === null ? "None" : remittanceText(current.terms);
  let proposedTerms =
    current === null
      ? "Needs an owner's terms"
      : `Unchanged (signed terms v${current.termsVersion})`;
  let proposedShortfall = current === null ? "—" : "Unchanged";
  if (draft.terms !== null) {
    proposedTerms = remittanceText(draft.terms);
    proposedShortfall = shortfallText(draft.terms);
  }
  const currentShortfall =
    current === null ? "—" : shortfallText(current.terms);
  return [
    {
      term: "Vehicle",
      current: currentPlate,
      proposed: draft.vehiclePlate || "—",
      changed: currentPlate !== draft.vehiclePlate,
    },
    {
      term: "Shift",
      current: currentShift,
      proposed: proposedShift,
      changed: current === null || shiftKeyOf(current.shift) !== draft.shiftKey,
    },
    {
      term: "Validity",
      current:
        current === null
          ? "—"
          : validityText(current.validFrom, current.validTo),
      proposed:
        draft.validFrom === ""
          ? "—"
          : validityText(draft.validFrom, draft.validTo),
      changed: true,
    },
    {
      term: "Remittance",
      current: currentTerms,
      proposed: proposedTerms,
      changed: draft.terms !== null,
    },
    {
      term: "Shortfall",
      current: currentShortfall,
      proposed: proposedShortfall,
      changed: draft.terms !== null,
    },
  ];
}

const DIFF_FIELD_LABELS: Readonly<Record<TermDiffField, string>> = {
  vehicle: "Vehicle",
  shift: "Shift",
  validity: "Validity",
  remittance: "Remittance",
  shortfall: "Shortfall",
  fuelBy: "Fuel paid by",
  servicingBy: "Servicing paid by",
};

export function proposedValue(
  proposal: ProposalView,
  field: TermDiffField,
  plates: ReadonlyMap<string, string>,
): string {
  switch (field) {
    case "vehicle":
      return plates.get(proposal.vehicleId) ?? "Proposed vehicle";
    case "shift":
      return shiftName(proposal.shift);
    case "validity":
      return validityText(proposal.validFrom, proposal.validTo);
    case "remittance":
      return remittanceText(proposal.terms);
    case "shortfall":
      return shortfallText(proposal.terms);
    case "fuelBy":
      return proposal.terms.fuelBy === "driver" ? "Driver" : "Fleet";
    default:
      return proposal.terms.servicingBy === "driver" ? "Driver" : "Fleet";
  }
}

/** The server's diff: each changed term, and whether it needs a new PIN. */
export function serverDiffRows(
  proposal: ProposalView,
  plates: ReadonlyMap<string, string>,
): { term: string; proposed: string; consent: string }[] {
  return proposal.diff.map((diff) => ({
    term: DIFF_FIELD_LABELS[diff.field],
    proposed: proposedValue(proposal, diff.field, plates),
    consent: diff.material
      ? "Needs a new PIN signature"
      : "No new signature needed",
  }));
}

/** The server check's result in words (never computed here). */
export function checkCopy(proposal: ProposalView): string {
  const overlap = proposal.check.shiftOverlap
    ? "The server found an overlap with a signed shift."
    : "Server check passed: no overlap with a signed shift";
  if (proposal.terms.type !== "weekly_fixed") {
    return proposal.check.shiftOverlap ? overlap : `${overlap}.`;
  }
  const amount = formatMinor(
    proposal.terms.amountMinor,
    proposal.terms.currency,
  );
  const cap = formatMoney(proposal.check.cityCap);
  return proposal.check.withinCityCap
    ? `${overlap}, and ${amount} is within the city cap (${cap}).`
    : `${overlap}. ${amount} is above the city cap (${cap}).`;
}

interface OverlapDetail {
  readonly reason?: unknown;
  readonly plate?: unknown;
  readonly driverDisplayName?: unknown;
  readonly shift?: {
    readonly kind?: unknown;
    readonly start?: unknown;
    readonly end?: unknown;
  };
}

/** A 422 from `assignments/propose` as the blocked-variant copy, or null. */
export function proposeRefusal(
  error: unknown,
  requested: string,
): string | null {
  if (!(error instanceof ApiError)) {
    return null;
  }
  if (error.code === "shift_overlap") {
    const overlaps = Array.isArray(error.details?.overlaps)
      ? (error.details?.overlaps as OverlapDetail[])
      : [];
    const lines = overlaps.map((overlap) => {
      if (overlap.reason === "driver_has_other_arrangement") {
        return `${requested} overlaps a signed shift this driver has with another fleet. Change the times to send.`;
      }
      if (overlap.reason === "signed_concurrently") {
        return "Another signature took this slot just now. Change the times to send.";
      }
      const shift =
        overlap.shift !== undefined &&
        typeof overlap.shift.start === "string" &&
        typeof overlap.shift.end === "string"
          ? ` (${overlap.shift.start}–${overlap.shift.end})`
          : "";
      const who =
        typeof overlap.driverDisplayName === "string"
          ? `${overlap.driverDisplayName}'s`
          : "a";
      const plate =
        typeof overlap.plate === "string" ? ` on ${overlap.plate}` : "";
      return `${requested} overlaps ${who} signed shift${plate}${shift}. Change the times to send.`;
    });
    return lines.length > 0
      ? lines.join(" ")
      : `${requested} overlaps a signed shift. Change the times to send.`;
  }
  if (error.code === "above_city_cap") {
    const amount = error.details?.amount as
      | { amountMinor?: unknown; currency?: unknown }
      | undefined;
    const cap = error.details?.cityCap as
      | { amountMinor?: unknown; currency?: unknown }
      | undefined;
    return `${formatMinor(amount?.amountMinor, amount?.currency)} is above the city cap of ${formatMinor(cap?.amountMinor, cap?.currency)}. Lower it to send.`;
  }
  if (error.code === "terms_owner_only") {
    return error.details?.reason === "no_signed_terms"
      ? "This driver has no signed terms with your fleet yet. A fleet owner proposes the first terms."
      : "New remittance terms are proposed by a fleet owner. Managers propose shift and vehicle changes under the driver's signed terms.";
  }
  if (error.code === "validation_failed") {
    return error.detail;
  }
  return null;
}

export interface ConsentStep {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly state: "done" | "current" | "todo" | "ended";
}

function waitingState(
  waiting: boolean,
  sentAt: string | null,
): ConsentStep["state"] {
  if (waiting) {
    return "current";
  }
  return sentAt === null ? "todo" : "done";
}

/** Sent → waiting for the signature (with its expiry) → the outcome. */
export function consentTimeline(
  proposal: ProposalView,
  zone: string,
): ConsentStep[] {
  const driver = proposal.driverDisplayName;
  const at = (iso: string | null): string =>
    iso === null
      ? ""
      : `${dateTimeIn(iso, zone)} ${zoneShort(zone, new Date(iso).getTime())}`;
  const waiting =
    proposal.status === "sent" || proposal.status === "pending_signature";
  const steps: ConsentStep[] = [
    {
      key: "sent",
      title: "Sent",
      detail: proposal.sentAt === null ? "Not sent" : at(proposal.sentAt),
      state: proposal.sentAt === null ? "todo" : "done",
    },
    {
      key: "waiting",
      title: `Waiting for ${driver}'s signature`,
      detail:
        proposal.expiresAt === null
          ? "Not counted as availability."
          : `Expires ${at(proposal.expiresAt)} (48 h). Not counted as availability.`,
      state: waitingState(waiting, proposal.sentAt),
    },
  ];
  const outcome: Record<string, ConsentStep> = {
    signed: {
      key: "outcome",
      title: "Signed with PIN",
      detail: `Terms v${proposal.termsVersion} is active from its start date. Changing it needs a new signature.`,
      state: "done",
    },
    declined: {
      key: "outcome",
      title: "Declined",
      detail: `${driver} declined. No reason is required and there is no penalty.`,
      state: "ended",
    },
    expired: {
      key: "outcome",
      title: "Expired",
      detail: "No reply in 48 h. You can send a new proposal.",
      state: "ended",
    },
    withdrawn: {
      key: "outcome",
      title: "Withdrawn",
      detail:
        "Your fleet withdrew this proposal. Nothing changed for the driver.",
      state: "ended",
    },
    superseded: {
      key: "outcome",
      title: "Superseded",
      detail: "A newer proposal replaced this one.",
      state: "ended",
    },
  };
  steps.push(
    outcome[proposal.status] ?? {
      key: "outcome",
      title: "Signed with PIN",
      detail: "The shift goes live from its start date once signed.",
      state: "todo",
    },
  );
  return steps;
}

export const proposalStatusText = (proposal: ProposalView): string =>
  PROPOSAL_STATUS_LABELS[proposal.status];
