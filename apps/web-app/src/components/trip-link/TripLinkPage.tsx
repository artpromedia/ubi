"use client";
/**
 * /trip-link — the guest passenger's trip page (A06 part B). Reads the token ONLY from the URL
 * fragment (`#t=…`), removes the fragment from the address bar straight away (the token is then
 * held for this tab's session only), and talks to the three public trip-link routes with the
 * token in the `X-Trip-Access-Token` header — never in a query string, a body, analytics or a
 * log. This page is outside the app's provider tree on purpose: no analytics, no auth store.
 * The view refreshes while the trip is live; a refused link (expired / revoked / invalid) is
 * forgotten and never retried from storage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FINAL_TRIP_STATUSES,
  TRIP_LINK_FAILURE_COPY,
  createDeclineCommand,
  createTripLinkClient,
  forgetTripToken,
  takeTripTokenFromLocation,
  type TripAccessView,
  type TripLinkClient,
  type TripLinkFailure,
} from "@/lib/trip-link";
import { TripLinkView, type DeclineState, type PinState } from "./TripLinkView";

/** The gateway, via the web app's same-origin `/api/v1/*` rewrite unless configured. */
const TRIP_API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";
const REFRESH_MS = 15_000;
const TERMINAL: ReadonlySet<TripLinkFailure> = new Set([
  "invalid",
  "expired",
  "revoked",
]);

function sessionStore(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function TripLinkPage({ client }: { client?: TripLinkClient }) {
  const api = useMemo(
    () =>
      client ??
      createTripLinkClient({
        baseUrl: TRIP_API_BASE,
        fetch: (url, init) => fetch(url, init),
      }),
    [client],
  );
  const decline = useMemo(() => createDeclineCommand(api), [api]);
  const token = useRef<string | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "missing" | "refused" | "trip"
  >("loading");
  const [failure, setFailure] = useState<TripLinkFailure>("error");
  const [view, setView] = useState<TripAccessView | null>(null);
  const [stale, setStale] = useState(false);
  const [pin, setPin] = useState<PinState>({ state: "hidden" });
  const [declineState, setDeclineState] = useState<DeclineState>({
    confirming: false,
    busy: false,
    refusal: null,
  });

  const refuse = useCallback((f: TripLinkFailure) => {
    if (TERMINAL.has(f)) {
      forgetTripToken(sessionStore());
      token.current = null;
    }
    setFailure(f);
    setPhase("refused");
  }, []);

  const load = useCallback(async () => {
    const t = token.current;
    if (!t) return;
    const r = await api.view(t);
    if (r.ok) {
      setView(r.data);
      setStale(false);
      setPhase("trip");
      return;
    }
    // A refresh that failed for a transient reason keeps the last answer, marked stale.
    if (!TERMINAL.has(r.failure) && view) {
      setStale(true);
      return;
    }
    refuse(r.failure);
  }, [api, refuse, view]);

  useEffect(() => {
    // The fragment only — and out of the address bar (and this history entry) at once.
    const t = takeTripTokenFromLocation(
      window.location,
      window.history,
      sessionStore(),
    );
    if (!t) {
      setPhase("missing");
      return;
    }
    token.current = t;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const live =
    phase === "trip" && view && !FINAL_TRIP_STATUSES.has(view.status);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  const revealPin = async () => {
    const t = token.current;
    if (!t) return;
    setPin({ state: "loading" });
    const r = await api.pin(t);
    if (r.ok) setPin({ state: "shown", pin: r.data.pin });
    else if (TERMINAL.has(r.failure)) refuse(r.failure);
    else
      setPin({
        state: "refused",
        title: TRIP_LINK_FAILURE_COPY[r.failure].title,
        body:
          r.failure === "unavailable"
            ? "Your PIN isn’t needed right now."
            : TRIP_LINK_FAILURE_COPY[r.failure].body,
      });
  };

  const confirmDecline = async () => {
    const t = token.current;
    if (!t) return;
    setDeclineState({ confirming: true, busy: true, refusal: null });
    const r = await decline(t);
    if (r.ok) {
      setView(r.data);
      setPin({ state: "hidden" });
      setDeclineState({ confirming: false, busy: false, refusal: null });
      return;
    }
    if (TERMINAL.has(r.failure)) {
      refuse(r.failure);
      return;
    }
    setDeclineState({
      confirming: true,
      busy: false,
      refusal: TRIP_LINK_FAILURE_COPY[r.failure],
    });
  };

  if (phase === "trip" && view)
    return (
      <TripLinkView
        phase="trip"
        view={view}
        stale={stale}
        pin={pin}
        onRevealPin={() => void revealPin()}
        decline={declineState}
        onDecline={() =>
          setDeclineState({ confirming: true, busy: false, refusal: null })
        }
        onConfirmDecline={() => void confirmDecline()}
        onCancelDecline={() =>
          setDeclineState({ confirming: false, busy: false, refusal: null })
        }
        onRefresh={() => void load()}
      />
    );
  if (phase === "refused")
    return (
      <TripLinkView
        phase="refused"
        failure={failure}
        onRetry={
          token.current
            ? () => {
                setPhase("loading");
                void load();
              }
            : undefined
        }
      />
    );
  return <TripLinkView phase={phase === "missing" ? "missing" : "loading"} />;
}
