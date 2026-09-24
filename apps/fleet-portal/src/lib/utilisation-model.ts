/**
 * Utilisation (B8) as pure data: per vehicle, the hours the SERVER measured
 * for each metric, the server's definition of each, its asOf, and "Not
 * enough data · added {date}" for a vehicle with less than the policy's
 * minimum (7 days). A metric the server cannot measure yet (null) is listed
 * as unavailable with the server's reason — never drawn as zero, never
 * estimated. No benchmarks, targets or totals are shown.
 */
import { localDateOf, shortDate, hoursLabel } from "./time";

import type {
  Utilisation,
  UtilisationMetric,
  UtilisationRow,
} from "./fleet-types";

export const METRIC_ORDER: readonly UtilisationMetric[] = [
  "onTrip",
  "onlineIdle",
  "bookedAhead",
  "maintenance",
  "offline",
];

export const METRIC_LABELS: Readonly<Record<UtilisationMetric, string>> = {
  onTrip: "On trip",
  onlineIdle: "Online idle",
  bookedAhead: "Booked ahead",
  maintenance: "Maintenance",
  offline: "Offline",
};

export interface UtilisationSegment {
  readonly metric: UtilisationMetric;
  readonly text: string;
  /** Share of the range's hours, for the bar width only. */
  readonly pct: number;
}

export interface UtilisationRowModel {
  readonly vehicleId: string;
  readonly plate: string;
  readonly enoughData: boolean;
  readonly note: string | null;
  readonly segments: readonly UtilisationSegment[];
  readonly unavailable: readonly {
    readonly metric: string;
    readonly reason: string;
  }[];
}

const metricLabel = (metric: string): string =>
  (METRIC_LABELS as Record<string, string>)[metric] ?? metric;

export function utilisationRow(
  row: UtilisationRow,
  rangeHours: number,
  zone: string,
): UtilisationRowModel {
  if (!row.enoughData || row.hours === null) {
    return {
      vehicleId: row.vehicleId,
      plate: row.plate,
      enoughData: false,
      note: `Not enough data · added ${shortDate(localDateOf(new Date(row.addedAt).getTime(), zone))}`,
      segments: [],
      unavailable: [],
    };
  }
  const hours = row.hours;
  const segments = METRIC_ORDER.flatMap((metric) => {
    const value = hours[metric];
    if (value === null) {
      return [];
    }
    return [
      {
        metric,
        text: `${METRIC_LABELS[metric]} ${hoursLabel(value)}`,
        pct: rangeHours > 0 ? Math.min((value / rangeHours) * 100, 100) : 0,
      },
    ];
  });
  return {
    vehicleId: row.vehicleId,
    plate: row.plate,
    enoughData: true,
    note: null,
    segments,
    unavailable: row.unavailable.map((entry) => ({
      metric: metricLabel(entry.metric),
      reason: entry.reason,
    })),
  };
}

export function utilisationRows(data: Utilisation): UtilisationRowModel[] {
  const rangeHours =
    (new Date(data.to).getTime() - new Date(data.from).getTime()) / 3_600_000;
  return data.rows.map((row) => utilisationRow(row, rangeHours, data.zone));
}

/** The server's definitions, in metric order (unknown keys after). */
export function definitionList(
  data: Utilisation,
): { label: string; text: string }[] {
  const known = METRIC_ORDER.filter(
    (metric) => data.definitions[metric] !== undefined,
  ).map((metric) => ({
    label: METRIC_LABELS[metric],
    text: data.definitions[metric] ?? "",
  }));
  const extra = Object.entries(data.definitions)
    .filter(([key]) => !(METRIC_ORDER as readonly string[]).includes(key))
    .map(([key, text]) => ({ label: metricLabel(key), text }));
  return [...known, ...extra];
}
