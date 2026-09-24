/**
 * Fleet privacy on the client — a last line of defence behind the server's.
 *
 * fleet-service parses every response through its contract schema, which
 * drops any undeclared key, and its privacy test walks every response schema
 * for forbidden names (packages/contracts/src/fleet.ts
 * `FLEET_FORBIDDEN_FIELD_PATTERNS`). The portal repeats that walk on what it
 * RECEIVES: `stripForbidden` removes every key matching the same patterns at
 * any depth before a response reaches a screen, and `projectOccupiedBlock`
 * rebuilds each booking from its eight allowed fields. So even a response
 * that grew a rider, pickup, fare or driver-net field (a proxy bug, a future
 * upstream) cannot be rendered here: fleets never see rider identity,
 * contact, location, route, fare, safety evidence or a driver's net.
 */
import type { OccupiedBlock } from "./fleet-types";

/** Mirror of FLEET_FORBIDDEN_FIELD_PATTERNS (packages/contracts/src/fleet.ts). */
export const FLEET_FORBIDDEN_FIELD_PATTERNS: readonly RegExp[] = [
  /rider/i,
  /passenger/i,
  /requester/i,
  /pickup/i,
  /dropoff/i,
  /destination/i,
  /address/i,
  /location/i,
  /^(lat|lng|latitude|longitude|coordinates?)$/i,
  /route/i,
  /polyline/i,
  /waypoint/i,
  /fare/i,
  /price/i,
  /phone/i,
  /email/i,
  /contact/i,
  /safety/i,
  /evidence/i,
  /incident/i,
  /^net/i,
  /driverNet/i,
  /earningsNet/i,
  /^requestId$/,
  /^awardId$/,
  /^bidId$/,
  /paymentMethod/i,
];

export const isForbiddenField = (key: string): boolean =>
  FLEET_FORBIDDEN_FIELD_PATTERNS.some((pattern) => pattern.test(key));

/** A deep copy with every forbidden key removed (not nulled — removed). */
export function stripForbidden<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripForbidden(item)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!isForbiddenField(key)) {
        out[key] = stripForbidden(inner);
      }
    }
    return out as T;
  }
  return value;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/**
 * Rebuilds a booking from the OccupiedBlock allowlist, or null when it is not
 * one (a block without its times cannot be placed, so it is not guessed).
 */
export function projectOccupiedBlock(raw: unknown): OccupiedBlock | null {
  if (raw === null || typeof raw !== "object") {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const blockId = text(r.blockId);
  const driverId = text(r.driverId);
  const startsAt = text(r.startsAt);
  const endsAt = text(r.endsAt);
  if (
    blockId === null ||
    driverId === null ||
    startsAt === null ||
    endsAt === null
  ) {
    return null;
  }
  return {
    blockId,
    driverId,
    vehicleId: text(r.vehicleId),
    startsAt,
    endsAt,
    kind: r.kind === "on_trip" ? "on_trip" : "booked",
    risk: r.risk === "at_risk" ? "at_risk" : "ok",
    decisionDeadline: text(r.decisionDeadline),
  };
}

/** Every booking in a list, projected; anything that is not one is dropped. */
export const projectOccupiedBlocks = (
  raw: readonly unknown[] | null | undefined,
): OccupiedBlock[] =>
  (raw ?? [])
    .map((block) => projectOccupiedBlock(block))
    .filter((block): block is OccupiedBlock => block !== null);
