/**
 * The guest passenger's trip link (A06 part B, "book for another adult") — pure client logic
 * for the /trip-link page. No React, no analytics, no logging.
 *
 * The passenger is not a UBI user. notification-service texts them
 * `PASSENGER_TRIP_LINK_BASE_URL + "#t=" + token`: the token lives in the URL FRAGMENT, which a
 * browser never sends to any server (not in the request line, not in a Referer). This module:
 *  - reads the token ONLY from the fragment (`#t=…`) — a `?t=` query parameter is ignored, never
 *    read, so a token that leaked into a URL a server could log is not honoured;
 *  - sends it ONLY in the `X-Trip-Access-Token` header of the three public trip-link routes the
 *    gateway exposes (GET /v1/mp/trip-access, GET /v1/mp/trip-access/pin, POST
 *    /v1/mp/trip-access/decline) — never in a URL, a body, analytics or a log;
 *  - keeps it at most in `sessionStorage` (this tab's session), never localStorage or a cookie,
 *    so a reload in the same tab still works after the fragment is removed from the address bar;
 *  - maps every refusal (401 invalid / expired / revoked, 429, 409 past pickup, offline) to a
 *    distinct outcome the page words honestly.
 *
 * Shapes mirror @ubi/contracts `MpTripAccessViewSchema` / `MpTripAccessPinSchema` (the web app
 * does not depend on the contracts package; __tests__ parse fixtures against the real schema).
 */

/** The header the trip link authenticates with (contracts MP_TRIP_ACCESS_HEADER). */
export const TRIP_ACCESS_HEADER = "X-Trip-Access-Token";

/** The session key the token is kept under for this tab only. */
export const TRIP_TOKEN_SESSION_KEY = "ubi.tripLink.token";

/** Same charset/bound the gateway accepts before forwarding ("uta_" + base64url today). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export type GuestTripStatus =
  | "finding_driver"
  | "confirming_driver"
  | "driver_queued"
  | "driver_on_the_way"
  | "driver_arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "declined";

/** contracts MpOfferDriverSchema — the same verified-card projection every rider surface uses. */
export type TripDriver = {
  displayName: string;
  initials: string;
  rating: string;
  completedTrips: number;
  vehicle: string;
  plateMasked: string;
  profileStatus: "verified" | "unavailable";
};

/** contracts MpTripAccessViewSchema. */
export type TripAccessView = {
  status: GuestTripStatus;
  statusLabel: string;
  passenger: { firstName: string };
  pickup: { label: string };
  dropoff: { label: string };
  driver: TripDriver | null;
  eta: {
    label: string;
    etaSeconds: number | null;
    basis: "routed_leg" | "unavailable";
    asOf: string;
  } | null;
  pickupVerification: {
    method: "pin" | "first_name";
    pinAvailable: boolean;
    instructions: string;
  };
  support: {
    reference: string;
    emergencyNumber: string | null;
    note: string;
  };
  actions: {
    canDecline: boolean;
    declineIsFree: true;
    declineNote: string;
  };
  expiresAt: string;
  asOf: string;
};

/** contracts MpTripAccessPinSchema. */
export type TripAccessPin = { pin: string; state: string; expiresAt: string };

export type TripLinkFailure =
  | "invalid"
  | "expired"
  | "revoked"
  | "rate_limited"
  | "past_pickup"
  | "unavailable"
  | "offline"
  | "error";

export type TripLinkResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: TripLinkFailure; message: string };

/**
 * The token from a URL fragment (`#t=…`), or null. Only the fragment is ever read: pass
 * `window.location.hash`, never `search`.
 */
export function readTripTokenFromFragment(hash: string): string | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const pair of fragment.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0 || pair.slice(0, eq) !== "t") continue;
    let value: string;
    try {
      value = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      return null;
    }
    return TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

type SessionLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Resolve the token for this page load: the fragment wins (and is then kept for this tab's
 * session only); otherwise a token this same tab already opened. Storage failures (private
 * mode) are ignored — the token then lives in memory for this page only.
 */
export function resolveTripToken(
  hash: string,
  session: SessionLike | null,
): string | null {
  const fromFragment = readTripTokenFromFragment(hash);
  if (fromFragment) {
    try {
      session?.setItem(TRIP_TOKEN_SESSION_KEY, fromFragment);
    } catch {
      /* memory only */
    }
    return fromFragment;
  }
  try {
    const held = session?.getItem(TRIP_TOKEN_SESSION_KEY) ?? null;
    return held && TOKEN_PATTERN.test(held) ? held : null;
  } catch {
    return null;
  }
}

/** Forget the token (a refused link must not be retried from storage). */
export function forgetTripToken(session: SessionLike | null): void {
  try {
    session?.removeItem(TRIP_TOKEN_SESSION_KEY);
  } catch {
    /* nothing held */
  }
}

/** An Idempotency-Key for the decline (url-safe, 8–64 chars). */
export function newDeclineKey(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return ("tripdecl_" + random).slice(0, 64);
}

type ErrorBody = {
  code?: string;
  message?: string;
  details?: { reason?: string };
};

/** A non-2xx trip-link answer as a distinct outcome (the server never names the trip). */
export function failureOf(
  status: number,
  body: ErrorBody | undefined,
): {
  failure: TripLinkFailure;
  message: string;
} {
  const reason = body?.details?.reason;
  const message = body?.message ?? "";
  if (status === 401) {
    if (reason === "expired" || reason === "revoked")
      return { failure: reason, message };
    return { failure: "invalid", message };
  }
  if (status === 429) return { failure: "rate_limited", message };
  if (status === 409 && reason === "past_pickup")
    return { failure: "past_pickup", message };
  if (status === 409) return { failure: "unavailable", message };
  return { failure: "error", message };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The trip-link client. The token travels ONLY in the header; answers are never cached and
 * no credentials or referrer are sent.
 */
export function createTripLinkClient(opts: {
  baseUrl: string;
  fetch: FetchLike;
}) {
  const call = async <T>(
    method: "GET" | "POST",
    path: string,
    token: string,
    idempotencyKey?: string,
  ): Promise<TripLinkResult<T>> => {
    const headers: Record<string, string> = {
      accept: "application/json",
      [TRIP_ACCESS_HEADER]: token,
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let res: Response;
    try {
      res = await opts.fetch(opts.baseUrl + path, {
        method,
        headers,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch {
      return { ok: false, failure: "offline", message: "" };
    }
    let json: unknown;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok)
      return { ok: false, ...failureOf(res.status, json as ErrorBody) };
    return { ok: true, data: json as T };
  };
  return {
    view: (token: string) =>
      call<TripAccessView>("GET", "/v1/mp/trip-access", token),
    pin: (token: string) =>
      call<TripAccessPin>("GET", "/v1/mp/trip-access/pin", token),
    decline: (token: string, idempotencyKey: string) =>
      call<TripAccessView>(
        "POST",
        "/v1/mp/trip-access/decline",
        token,
        idempotencyKey,
      ),
  };
}

export type TripLinkClient = ReturnType<typeof createTripLinkClient>;

/** Statuses after which nothing more happens on this link. */
export const FINAL_TRIP_STATUSES: ReadonlySet<GuestTripStatus> = new Set([
  "completed",
  "cancelled",
  "declined",
]);

/** The page's words for every refusal — distinct, honest, never naming a trip. */
export const TRIP_LINK_FAILURE_COPY: Record<
  TripLinkFailure,
  { title: string; body: string }
> = {
  invalid: {
    title: "This link doesn’t work",
    body: "Check that you opened the whole link from your text message. If it still doesn’t open, ask the person who booked your ride to send a new one.",
  },
  expired: {
    title: "This trip link has expired",
    body: "Links stop working after the trip. If your ride is still ahead, ask the person who booked it to send a new link.",
  },
  revoked: {
    title: "This trip link was replaced or withdrawn",
    body: "The person who booked your ride sent a newer link or withdrew this one. Open the newest link in your text messages.",
  },
  rate_limited: {
    title: "Too many tries",
    body: "Wait a minute, then try again.",
  },
  past_pickup: {
    title: "Your ride has already started",
    body: "It can no longer be declined here. If something is wrong, contact support with your trip reference.",
  },
  unavailable: {
    title: "Not available right now",
    body: "This can’t be done at this moment. Try again shortly.",
  },
  offline: {
    title: "You’re offline",
    body: "Reconnect and try again. Nothing changed.",
  },
  error: {
    title: "Something went wrong",
    body: "Try again in a moment. Nothing changed.",
  },
};

/**
 * The decline command: ONE Idempotency-Key per decline until the server gives a definite
 * answer — a retry after a dropped connection replays the first outcome instead of acting
 * twice. Success or a refusal retires the key; offline or a server error keeps it.
 */
export function createDeclineCommand(
  client: TripLinkClient,
  mintKey: () => string = newDeclineKey,
) {
  let held: string | null = null;
  return async (token: string): Promise<TripLinkResult<TripAccessView>> => {
    held = held ?? mintKey();
    const result = await client.decline(token, held);
    if (
      result.ok ||
      (result.failure !== "offline" && result.failure !== "error")
    )
      held = null;
    return result;
  };
}

type LocationLike = { hash: string; pathname: string; search: string };
type HistoryLike = {
  replaceState: (data: unknown, unused: string, url?: string) => void;
};

/**
 * Page boot: take the token from the FRAGMENT (never `search`), then remove the fragment from
 * the address bar and this history entry so the token isn't left on screen, in a bookmark or
 * in a copied URL. Returns the token (or one this tab already opened), else null.
 */
export function takeTripTokenFromLocation(
  location: LocationLike,
  history: HistoryLike,
  session: SessionLike | null,
): string | null {
  const token = resolveTripToken(location.hash, session);
  if (location.hash)
    history.replaceState(null, "", location.pathname + location.search);
  return token;
}
