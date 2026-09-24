"use client";

/**
 * Small client hooks shared by the fleet screens.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { isAmbiguousFailure, keyAfter, newIdempotencyKey } from "./idempotency";

const subscribeOnline = (onChange: () => void): (() => void) => {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
};

/** The browser's online flag. SSR reads as online (data loads client-side). */
export const useOnlineStatus = (): boolean =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );

/** "Now", refreshed every `everyMs` (the calendar's now marker). */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

/**
 * One idempotency key per user intent: `settle` after each answer keeps the
 * key after an ambiguous failure (so "Try again" is safe) and renews it after
 * a definite one.
 */
export function useIdempotencyKey(): {
  readonly current: () => string;
  readonly settle: (
    outcome:
      | { readonly ok: true }
      | { readonly ok: false; readonly error: unknown },
    online?: boolean,
  ) => void;
} {
  const key = useRef<string | null>(null);
  return {
    current: () => {
      key.current ??= newIdempotencyKey();
      return key.current;
    },
    settle: (outcome, online = true) => {
      key.current = keyAfter(
        key.current ?? newIdempotencyKey(),
        outcome,
        online,
      );
    },
  };
}

export type CommandState<T> =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "done"; readonly result: T }
  | {
      readonly status: "failed";
      readonly error: unknown;
      readonly ambiguous: boolean;
    };

/**
 * A state-changing command with its own idempotency key: pending while it
 * runs, the server's result or refusal after. A retry after an ambiguous
 * failure re-sends the same key (so it cannot apply twice).
 */
export function useCommand<T>(): {
  readonly state: CommandState<T>;
  readonly run: (
    work: (key: string) => Promise<T>,
    online: boolean,
  ) => Promise<T | undefined>;
  readonly reset: () => void;
} {
  const key = useIdempotencyKey();
  const [state, setState] = useState<CommandState<T>>({ status: "idle" });
  return {
    state,
    run: async (work, online) => {
      setState({ status: "pending" });
      try {
        const result = await work(key.current());
        key.settle({ ok: true });
        setState({ status: "done", result });
        return result;
      } catch (error) {
        key.settle({ ok: false, error }, online);
        setState({
          status: "failed",
          error,
          ambiguous: isAmbiguousFailure(error, online),
        });
        return undefined;
      }
    },
    reset: () => setState({ status: "idle" }),
  };
}
