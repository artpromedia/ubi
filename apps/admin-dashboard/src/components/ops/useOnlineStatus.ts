"use client";
import { useSyncExternalStore } from "react";

/**
 * The browser's online flag as React state. During SSR/prerender there is
 * no navigator, which reads as online (the page then loads client-side).
 * While offline, TanStack Query pauses reads, so a board would otherwise sit
 * on "Loading…" — pages use this to say "offline" instead.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine !== false,
    () => true,
  );
}
