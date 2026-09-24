/**
 * Vehicle detail (B4) as pure data: documents against 30 days of
 * commitments, maintenance upcoming / past with the moves its state allows,
 * and the week's money lines.
 *
 * Which bookings fall after a document expiry is the SERVER's call: a
 * booking is highlighted only when fleet-service has opened a
 * `document_expires_in_booking` conflict naming it. Money is the server's
 * (payment-service settles it); fleet-service answers `available: false`
 * today, so the lines say "Not available yet" with the server's reason —
 * nothing is estimated. A driver's net is never a line, whatever arrives.
 */
import {
  documentLabel,
  MAINTENANCE_KIND_LABELS,
  MAINTENANCE_STATUS_LABELS,
} from "./labels";
import { formatMoney } from "./money";
import { localDateOf, shortDate, timeRangeIn } from "./time";

import type {
  ConflictView,
  DocumentStatusView,
  MaintenanceBlockView,
  Money,
  MoneyUnavailable,
  OccupiedBlock,
} from "./fleet-types";

export interface TimelineMarker {
  readonly key: string;
  readonly label: string;
  readonly pct: number;
  readonly tone: "ok" | "warn" | "bad";
}

export interface TimelineBooking {
  readonly blockId: string;
  readonly pct: number;
  readonly label: string;
  readonly afterExpiry: boolean;
  readonly atRisk: boolean;
}

export interface DocumentCard {
  readonly title: string;
  readonly status: string;
  readonly hint: string;
  readonly tone: "ok" | "warn" | "bad";
}

export interface DocumentsTimeline {
  readonly rangeLabel: string;
  readonly markers: readonly TimelineMarker[];
  readonly bookings: readonly TimelineBooking[];
  readonly cards: readonly DocumentCard[];
}

const TONE: Readonly<
  Record<DocumentStatusView["status"], "ok" | "warn" | "bad">
> = {
  valid: "ok",
  expiring: "warn",
  expired: "bad",
  missing: "warn",
};

export function documentsTimeline(input: {
  readonly documents: readonly DocumentStatusView[];
  readonly occupied: readonly OccupiedBlock[];
  readonly conflicts: readonly ConflictView[];
  readonly from: string;
  readonly to: string;
  readonly zone: string;
}): DocumentsTimeline {
  const start = new Date(input.from).getTime();
  const end = new Date(input.to).getTime();
  const pct = (iso: string): number =>
    Math.min(
      Math.max(((new Date(iso).getTime() - start) / (end - start)) * 100, 0),
      100,
    );
  const flagged = new Set(
    input.conflicts
      .filter(
        (conflict) =>
          conflict.type === "document_expires_in_booking" &&
          (conflict.status === "open" || conflict.status === "resolving"),
      )
      .flatMap((conflict) =>
        conflict.subjects.map((subject) => subject.blockId),
      )
      .filter((blockId): blockId is string => blockId !== null),
  );
  const markers = input.documents
    .filter(
      (doc) =>
        doc.expiresAt !== null && new Date(doc.expiresAt).getTime() <= end,
    )
    .map((doc) => ({
      key: doc.kind,
      label: documentLabel(doc, input.zone),
      pct: pct(doc.expiresAt as string),
      tone: TONE[doc.status],
    }));
  const bookings = input.occupied.map((block) => ({
    blockId: block.blockId,
    pct: pct(block.startsAt),
    label: `${block.kind === "on_trip" ? "On a trip" : "Booked"} · ${shortDate(localDateOf(new Date(block.startsAt).getTime(), input.zone))} ${timeRangeIn(block.startsAt, block.endsAt, input.zone)}`,
    afterExpiry: flagged.has(block.blockId),
    atRisk: block.risk === "at_risk",
  }));
  const cards = input.documents.map((doc) => {
    const after = bookings.filter((booking) => booking.afterExpiry).length;
    const expiringHint =
      after > 0
        ? `${after} ${after === 1 ? "booking" : "bookings"} after this date (flagged by UBI)`
        : "Upload the renewal to clear the flag";
    const hints: Readonly<Record<DocumentStatusView["status"], string>> = {
      expired: "Enforced by UBI · status only",
      missing: "UBI holds no verified expiry yet",
      expiring: expiringHint,
      valid: "No action needed",
    };
    const hint = hints[doc.status];
    return {
      title: doc.kind === "insurance" ? "Insurance" : "Inspection",
      status: documentLabel(doc, input.zone).replace(
        /^(Insurance|Inspection) /,
        "",
      ),
      hint,
      tone: TONE[doc.status],
    };
  });
  return {
    rangeLabel: `${shortDate(localDateOf(start, input.zone))} – ${shortDate(localDateOf(end - 1, input.zone))}`,
    markers,
    bookings,
    cards,
  };
}

export type BlockMove = "resolve" | "cancel" | "complete";

/** The moves a block's state allows (fleet-service re-checks each). */
export function blockMoves(
  block: MaintenanceBlockView,
  now: number,
): BlockMove[] {
  const moves: BlockMove[] = [];
  if (block.status === "needs_resolution" || block.status === "draft") {
    moves.push("resolve");
  }
  if (
    block.kind !== "unplanned_off_road" &&
    ["draft", "checking", "needs_resolution", "scheduled"].includes(
      block.status,
    )
  ) {
    moves.push("cancel");
  }
  if (
    block.status === "active" ||
    (block.status === "scheduled" && new Date(block.startsAt).getTime() <= now)
  ) {
    moves.push("complete");
  }
  return moves;
}

export interface MaintenanceLine {
  readonly block: MaintenanceBlockView;
  readonly kind: string;
  readonly when: string;
  readonly status: string;
}

export function maintenanceLines(
  blocks: readonly MaintenanceBlockView[],
  now: number,
  zone: string,
): { upcoming: MaintenanceLine[]; past: MaintenanceLine[] } {
  const line = (block: MaintenanceBlockView): MaintenanceLine => ({
    block,
    kind: MAINTENANCE_KIND_LABELS[block.kind],
    when: `${shortDate(localDateOf(new Date(block.startsAt).getTime(), zone))} ${timeRangeIn(block.startsAt, block.endsAt, zone)}`,
    status: block.offRoadFlagged
      ? `${MAINTENANCE_STATUS_LABELS[block.status]} · flagged for UBI review`
      : MAINTENANCE_STATUS_LABELS[block.status],
  });
  const past = (block: MaintenanceBlockView): boolean =>
    block.status === "completed" ||
    block.status === "cancelled" ||
    (block.endsAt !== null &&
      new Date(block.endsAt).getTime() <= now &&
      block.status !== "active");
  return {
    upcoming: blocks.filter((block) => !past(block)).map(line),
    past: blocks.filter(past).map(line).reverse(),
  };
}

/** A week split, if payment-service ever publishes one to fleets. Not served today. */
export interface WeekMoneyAvailable {
  readonly available: true;
  readonly weekGross?: Money;
  readonly ubiCommission?: Money;
  readonly fleetRemittance?: Money;
  readonly remittanceStatus?: string;
}

export interface MoneyLine {
  readonly label: string;
  readonly value: string;
}

/**
 * The four lines a fleet may see — week gross, UBI commission, fleet
 * remittance, remittance status — from the server's own values. Only these
 * named fields are read: a driver-net (or any other) field is never shown.
 */
export function weekMoneyLines(money: MoneyUnavailable | WeekMoneyAvailable): {
  available: boolean;
  lines: MoneyLine[];
  note: string;
} {
  if (money.available !== true) {
    return {
      available: false,
      lines: [
        { label: "Week gross", value: "Not available yet" },
        { label: "UBI commission", value: "Not available yet" },
        { label: "Fleet remittance", value: "Not available yet" },
        { label: "Remittance status", value: "Not available yet" },
      ],
      note: "UBI settles gross, commission and remittance on its ledger. They aren't published to the fleet portal yet, so nothing is estimated here.",
    };
  }
  return {
    available: true,
    lines: [
      { label: "Week gross", value: formatMoney(money.weekGross) },
      { label: "UBI commission", value: formatMoney(money.ubiCommission) },
      { label: "Fleet remittance", value: formatMoney(money.fleetRemittance) },
      { label: "Remittance status", value: money.remittanceStatus ?? "—" },
    ],
    note: "All amounts are computed by UBI in integer minor units.",
  };
}
