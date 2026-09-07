/**
 * Live risk state, read on every authenticated request.
 *
 * Limited mode travels in the token because it is a property of the token's
 * device. Wallet safe mode does not: a SIM-swap signal arrives AFTER tokens
 * were issued and has to bite immediately, so it lives in a shared store that
 * user-service writes and the gateway reads.
 *
 * The read FAILS CLOSED. If the store is unreachable, the gateway assumes safe
 * mode: P2P, NIP and security changes are refused until it can prove otherwise.
 * Booking, reading and cash keep working, so an outage degrades the platform
 * instead of stopping it — but it never opens money movement it could not
 * verify (CLAUDE.md #5).
 */

/** The subset of a Redis client this needs. `ioredis` satisfies it. */
export interface IdentityStateStore {
  get(key: string): Promise<string | null>;
}

/** Written by user-service when it enters safe mode; TTL = the safe-mode window. */
export function safeModeKey(userId: string): string {
  return `ubi:identity:safe_mode:${userId}`;
}

export interface RiskState {
  readonly safeMode: boolean;
  /** ISO instant the hold lifts, when the store could say. */
  readonly safeModeUntil: string | null;
  /** True when the answer is an assumption because the store could not be read. */
  readonly degraded: boolean;
}

const OPEN: RiskState = { safeMode: false, safeModeUntil: null, degraded: false };
const FAIL_CLOSED: RiskState = { safeMode: true, safeModeUntil: null, degraded: true };

export async function readRiskState(
  store: IdentityStateStore | undefined,
  userId: string,
  now: Date = new Date(),
): Promise<RiskState> {
  if (store === undefined) return FAIL_CLOSED;

  let raw: string | null;
  try {
    raw = await store.get(safeModeKey(userId));
  } catch {
    return FAIL_CLOSED;
  }

  if (raw === null) return OPEN;

  const until = new Date(raw);
  if (Number.isNaN(until.getTime())) {
    // A value we cannot read is a value we cannot clear on.
    return FAIL_CLOSED;
  }
  if (until.getTime() <= now.getTime()) return OPEN;

  return { safeMode: true, safeModeUntil: until.toISOString(), degraded: false };
}
