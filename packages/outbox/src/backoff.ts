/**
 * Capped exponential backoff for outbox publish retries.
 *
 * `attempts` is the number of failures recorded so far for the row (>= 1 after
 * the first failure). The delay doubles each time from `baseMs` and is clamped
 * to `maxMs`, so a persistently failing row is retried ever more slowly instead
 * of being hammered in a hot loop. The exponent is clamped before shifting so a
 * large attempt count cannot overflow into a nonsense delay.
 */
export interface BackoffOptions {
  readonly baseMs: number;
  readonly maxMs: number;
}

const MAX_EXPONENT = 30;

export function backoffDelayMs(attempts: number, opts: BackoffOptions): number {
  const failures = Math.max(1, Math.floor(attempts));
  const exponent = Math.min(failures - 1, MAX_EXPONENT);
  const raw = opts.baseMs * 2 ** exponent;
  return Math.min(raw, opts.maxMs);
}
