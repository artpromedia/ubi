// Caller-held Idempotency-Keys for the trip/booking state POSTs (launch CLAUDE.md #3).
// api() mints a fresh key per call, which would turn a retry after a dropped response
// into a second command. Instead each distinct command (its fingerprint: action + ids +
// the exact revisions it binds to) keeps ONE key until the server gives a definite
// answer — success or a 4xx refusal. A network failure or a 5xx keeps the key, so the
// retry replays the server's first outcome rather than acting twice. Same pattern as
// DriverPreferencesContainer's pendingKey, generalised for several actions per screen.
import { useMemo, useRef } from "react";
import { ApiError } from "@ubi/mobile-core";

/** url-safe, 8–64 chars (contracts IdempotencyKeySchema). */
export const newIdempotencyKey = (prefix: string) =>
  prefix +
  "_" +
  Date.now().toString(36) +
  "_" +
  Math.random().toString(36).slice(2, 10);

/** A definite server answer retires the key; offline/5xx keeps it for a safe retry. */
export const retiresKey = (error: unknown) =>
  error instanceof ApiError && error.status < 500;

export type IdempotencyKeys = {
  /** The key for this command, minted once and reused until settled. */
  keyFor: (fingerprint: string) => string;
  /** Call after the attempt: no error (success) or a definite refusal retires the key. */
  settle: (fingerprint: string, error?: unknown) => void;
};

export function useIdempotencyKeys(prefix: string): IdempotencyKeys {
  const keys = useRef(new Map<string, string>());
  return useMemo(
    () => ({
      keyFor: (fingerprint) => {
        const held = keys.current.get(fingerprint);
        if (held) return held;
        const key = newIdempotencyKey(prefix);
        keys.current.set(fingerprint, key);
        return key;
      },
      settle: (fingerprint, error) => {
        if (error === undefined || retiresKey(error))
          keys.current.delete(fingerprint);
      },
    }),
    [prefix],
  );
}
