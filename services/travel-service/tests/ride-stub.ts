/**
 * A real HTTP listener standing in for ride-service's Book for Later routes
 * (services/ride-service/internal/handler/marketplace_scheduling.go and the
 * quote / request-cancel routes), driven over a socket by the REAL HTTP ride
 * port — so what the assertions see is what went on the wire.
 *
 * It is not a permissive echo:
 *  - every request's identity is checked with ride-service's own algorithm
 *    (internal/handler/identity.go, re-implemented here with node:crypto, not
 *    with the code under test): user id + role present and trimmed, a known
 *    role, a UUID user id, `x-auth-signature` = base64url(HMAC-SHA256(key,
 *    "ubi.internal.v1|user|role|city|issuedAt")) under any listed key, and an
 *    issued-at within five minutes either side. A request that fails is
 *    answered 401/403 exactly as ride-service would, and counted;
 *  - bodies are validated against the documented contract schemas
 *    (MpCreateScheduledRequestSchema, strict) and answers are validated
 *    against the documented response schemas (MpQuoteEnvelopeSchema,
 *    MpScheduledRequestSchema) BEFORE they are sent;
 *  - the semantics travel-service relies on are ride-service's: an
 *    Idempotency-Key replays its stored answer and refuses a different body
 *    (idempotency_key_reuse), the rider-only rule, quote ownership and expiry,
 *    fare bounds, the lead/horizon rule, local-time → instant resolution in the
 *    IANA zone, cancelling a published intent answering request_closed with the
 *    request id, and an awarded request whose cancellation ride-service refuses.
 *
 * State moves the market makes (publication, an award the rider selected, no
 * driver) are scripted by the test through `publish` / `award` / `unfulfill`.
 */
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

import {
  MpCreateScheduledRequestSchema,
  MpQuoteEnvelopeSchema,
  MpScheduledRequestSchema,
  type MpCreateScheduledRequest,
} from "@ubi/contracts";

export interface StubIdentity {
  readonly userId: string;
  readonly role: string;
  readonly cityId: string;
}

export interface StubCall {
  readonly method: string;
  readonly path: string;
  readonly idempotencyKey: string | null;
  readonly body: unknown;
  /** The identity ride-service's verifier accepted (null: refused). */
  readonly identity: StubIdentity | null;
  readonly status: number;
}

interface StubQuote {
  readonly quoteId: string;
  readonly requesterId: string;
  readonly cityId: string;
  readonly vehicleClass: string;
  readonly suggestedMinor: number;
  readonly minMinor: number;
  readonly maxMinor: number;
  readonly routedDurationSec: number;
  readonly expiresAt: Date;
  readonly pickup: { lat: number; lng: number };
  readonly dropoff: { lat: number; lng: number };
}

export interface StubScheduled {
  readonly id: string;
  readonly requesterId: string;
  readonly cityId: string;
  readonly vehicleClass: string;
  state: string;
  version: number;
  requestedMinor: number;
  maxFareMinor: number;
  readonly paymentMethodId: string;
  readonly body: MpCreateScheduledRequest;
  readonly pickupAt: Date;
  readonly windowEnd: Date;
  readonly publishAt: Date;
  readonly pickup: { lat: number; lng: number };
  readonly dropoff: { lat: number; lng: number };
  requestId: string | null;
  requestState: string | null;
  closeReason: string | null;
  approval: { reason: string; message: string; minMinor: number } | null;
  readonly createdAt: Date;
  updatedAt: Date;
}

export interface StubTerms {
  suggestedMinor: number;
  minMinor: number;
  maxMinor: number;
  routedDurationSec: number;
}

export interface StubPolicy {
  readonly timeZone: string;
  readonly currency: string;
  readonly minLeadSec: number;
  readonly maxHorizonSec: number;
  readonly publishLeadSec: number;
  readonly minWindowSec: number;
  readonly maxWindowSec: number;
}

type Reply = { status: number; body: unknown };

export interface RideStub {
  readonly url: string;
  readonly calls: StubCall[];
  /** Requests refused by the identity verifier. */
  readonly refusedIdentities: StubCall[];
  readonly scheduled: Map<string, StubScheduled>;
  terms: StubTerms;
  /** What cancelling an AWARDED request does: ride-service's rule is its own. */
  awardedCancel: "refuse" | "allow";
  /** A one-shot answer for the next request whose `METHOD path-prefix` matches. */
  failNext(match: string, reply: Reply): void;
  publish(id: string): StubScheduled;
  award(id: string): StubScheduled;
  unfulfill(id: string, reason?: string): StubScheduled;
  needsApproval(id: string, minMinor: number): StubScheduled;
  byRequestId(requestId: string): StubScheduled | undefined;
  /** Verified calls: a string matches `METHOD /path` exactly, a RegExp tests it. */
  count(match: string | RegExp): number;
  close(): Promise<void>;
}

const KNOWN_ROLES = new Set(["rider", "driver", "admin", "service"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,64}$/;
const MAX_AGE_MS = 5 * 60_000;

function header(message: IncomingMessage, name: string): string {
  const value = message.headers[name];
  return (Array.isArray(value) ? value.join(",") : (value ?? "")).trim();
}

function base64urlHmac(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/**
 * ride-service's RequireIdentity + InternalContextVerifier.verify, rule for
 * rule. Returns the accepted identity or the refusal it would answer.
 */
function verifyIdentity(
  message: IncomingMessage,
  secrets: readonly string[],
  realNow: number,
): StubIdentity | Reply {
  const userId = header(message, "x-auth-user-id");
  const role = header(message, "x-auth-user-role");
  const cityId = header(message, "x-auth-city-id");
  if (userId === "" || role === "") {
    return {
      status: 401,
      body: { code: "unauthorized", message: "no caller identity" },
    };
  }
  if (!KNOWN_ROLES.has(role)) {
    return {
      status: 403,
      body: {
        code: "forbidden",
        message: `the role ${role} may not use this service`,
      },
    };
  }
  if (!UUID.test(userId)) {
    return {
      status: 401,
      body: {
        code: "unauthorized",
        message: "the caller identity is not a user id",
      },
    };
  }
  if (secrets.length > 0) {
    const signature = header(message, "x-auth-signature");
    const issuedAt = header(message, "x-auth-issued-at");
    if (signature === "" || issuedAt === "") {
      return {
        status: 401,
        body: { code: "unauthorized", message: "no signed caller identity" },
      };
    }
    if (!/^-?\d+$/.test(issuedAt)) {
      return {
        status: 401,
        body: {
          code: "unauthorized",
          message: "unreadable identity timestamp",
        },
      };
    }
    const age = realNow - Number(issuedAt) * 1000;
    if (age < -MAX_AGE_MS || age > MAX_AGE_MS) {
      return {
        status: 401,
        body: { code: "unauthorized", message: "caller identity expired" },
      };
    }
    const payload = ["ubi.internal.v1", userId, role, cityId, issuedAt].join(
      "|",
    );
    const ok = secrets.some((secret) => {
      const expected = Buffer.from(base64urlHmac(secret, payload));
      const given = Buffer.from(signature);
      return (
        expected.length === given.length && timingSafeEqual(expected, given)
      );
    });
    if (!ok) {
      return {
        status: 401,
        body: {
          code: "unauthorized",
          message: "caller identity is not signed by the gateway",
        },
      };
    }
  }
  return { userId, role, cityId };
}

function wallClock(
  at: Date,
  timeZone: string,
): { date: string; time: string; offsetMin: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}`;
  const asUtc = Date.parse(`${date}T${time}:00Z`);
  return {
    date,
    time,
    offsetMin: Math.round(
      (asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000,
    ),
  };
}

/** Local date + time in an IANA zone → the instant (earlier / later occurrence). */
function resolveLocal(
  localDate: string,
  localTime: string,
  timeZone: string,
  disambiguation: string | undefined,
): Date | null {
  const naive = Date.parse(`${localDate}T${localTime}:00Z`);
  const candidates: number[] = [];
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const instant = naive - offset * 60_000;
    const local = wallClock(new Date(instant), timeZone);
    if (
      local.date === localDate &&
      local.time === localTime &&
      !candidates.includes(instant)
    ) {
      candidates.push(instant);
    }
  }
  candidates.sort((a, b) => a - b);
  if (candidates.length === 0) {
    return null;
  }
  const chosen =
    disambiguation === "later"
      ? candidates[candidates.length - 1]
      : candidates[0];
  return new Date(chosen as number);
}

function offsetLabel(offsetMin: number): string {
  const sign = offsetMin < 0 ? "-" : "+";
  const abs = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Go's time.Time JSON: RFC 3339 with nanoseconds. */
function goTime(at: Date): string {
  return at.toISOString().replace(/\.(\d{3})Z$/, ".$1000000Z");
}

export async function startRideStub(options: {
  readonly secret: string;
  readonly now: () => Date;
  readonly policy: StubPolicy;
  readonly terms?: StubTerms;
}): Promise<RideStub> {
  const secrets = options.secret
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const calls: StubCall[] = [];
  const refusedIdentities: StubCall[] = [];
  const quotes = new Map<string, StubQuote>();
  const scheduled = new Map<string, StubScheduled>();
  const idempotency = new Map<string, { hash: string; reply: Reply }>();
  const scripted: { match: string; reply: Reply }[] = [];
  const policy = options.policy;

  const stub = {
    terms: options.terms ?? {
      suggestedMinor: 1_200_000,
      minMinor: 900_000,
      maxMinor: 2_400_000,
      routedDurationSec: 2_700,
    },
    awardedCancel: "refuse" as "refuse" | "allow",
  };

  function money(amountMinor: number): {
    amountMinor: number;
    currency: string;
  } {
    return { amountMinor, currency: policy.currency };
  }

  function view(sr: StubScheduled): unknown {
    const local = wallClock(sr.pickupAt, policy.timeZone);
    let statusLabel = "Scheduled — no driver secured yet";
    let notice =
      "We will send your request to drivers at its lead time. No driver is secured until you choose an offer.";
    let driverSecured = false;
    if (sr.state === "needs_rider_approval") {
      statusLabel = "Needs your approval — no driver secured yet";
      notice = sr.approval?.message ?? "Review and approve to continue.";
    } else if (sr.state === "published") {
      statusLabel = "Sent to drivers — no driver secured yet";
      notice = "Choose an offer to secure a driver.";
      if (sr.requestState === "awarded" || sr.requestState === "execution") {
        driverSecured = true;
        statusLabel = "Driver secured";
        notice =
          "A driver accepted through your selection. Follow the trip from the request.";
      } else if (
        sr.requestState === "cancelled" ||
        sr.requestState === "expired" ||
        sr.requestState === "no_offers"
      ) {
        statusLabel = "Closed — no driver";
        notice = "The request closed without a driver. Nothing was charged.";
      }
    } else if (sr.state === "unfulfilled") {
      statusLabel = "No driver found";
      notice =
        "No driver took this trip in time. Nothing was charged; you can book again.";
    } else if (sr.state === "cancelled") {
      statusLabel = "Cancelled";
      notice =
        "You cancelled this trip before any driver was secured. Nothing was charged.";
    }
    const body = {
      scheduledRequestId: sr.id,
      product: "scheduled_request",
      state: sr.state,
      version: sr.version,
      driverSecured,
      statusLabel,
      notice,
      service: "ride",
      vehicleClass: sr.vehicleClass,
      cityId: sr.cityId,
      currency: policy.currency,
      pickup: { label: "Near pickup", lat: sr.pickup.lat, lng: sr.pickup.lng },
      dropoff: {
        label: "Near dropoff",
        lat: sr.dropoff.lat,
        lng: sr.dropoff.lng,
      },
      schedule: {
        localDate: local.date,
        localTime: local.time,
        timeZone: policy.timeZone,
        utcOffset: offsetLabel(local.offsetMin),
        dstResolution: "exact",
        pickupAt: goTime(sr.pickupAt),
        windowStart: goTime(sr.pickupAt),
        windowEnd: goTime(sr.windowEnd),
        windowMinutes: Math.round(
          (sr.windowEnd.getTime() - sr.pickupAt.getTime()) / 60_000,
        ),
        label: `${local.date} ${local.time} (UTC${offsetLabel(local.offsetMin)})`,
      },
      publishAt: goTime(sr.publishAt),
      requestedFareMinor: money(sr.requestedMinor),
      maxFareMinor: money(sr.maxFareMinor),
      paymentMethodId: sr.paymentMethodId,
      requestId: sr.requestId,
      requestState: sr.requestState,
      templateId: null,
      occurrenceDate: null,
      approval:
        sr.approval === null
          ? null
          : {
              reason: sr.approval.reason,
              message: sr.approval.message,
              refreshedTerms: {
                minimumFareMinor: money(sr.approval.minMinor),
                maximumFareMinor: money(sr.approval.minMinor * 2),
                suggestedFareMinor: money(sr.approval.minMinor),
              },
            },
      closeReason: sr.closeReason,
      createdAt: goTime(sr.createdAt),
      updatedAt: goTime(sr.updatedAt),
    };
    // The answer must be exactly what the contract documents.
    MpScheduledRequestSchema.parse(body);
    return body;
  }

  function ownedScheduled(
    id: string,
    who: StubIdentity,
  ): StubScheduled | Reply {
    const sr = scheduled.get(id);
    if (sr === undefined || sr.requesterId !== who.userId) {
      return {
        status: 404,
        body: {
          code: "not_found",
          message: "that scheduled request does not exist",
        },
      };
    }
    return sr;
  }

  function idempotent(
    scope: string,
    who: StubIdentity,
    key: string | null,
    body: unknown,
    work: () => Reply,
  ): Reply {
    if (key === null || !IDEMPOTENCY_KEY.test(key)) {
      return {
        status: 422,
        body: {
          code: "validation_failed",
          message: "Idempotency-Key is required",
        },
      };
    }
    const slot = `${scope}|${who.userId}|${key}`;
    const hash = createHash("sha256")
      .update(JSON.stringify(body))
      .digest("base64url");
    const seen = idempotency.get(slot);
    if (seen !== undefined) {
      if (seen.hash !== hash) {
        return {
          status: 409,
          body: {
            code: "idempotency_key_reuse",
            message: `idempotency key ${key} was already used with a different request body`,
          },
        };
      }
      return seen.reply;
    }
    const reply = work();
    if (reply.status < 300) {
      // Like ride-service: only a success is stored under the key.
      idempotency.set(slot, { hash, reply });
    }
    return reply;
  }

  function route(
    method: string,
    url: URL,
    who: StubIdentity,
    key: string | null,
    body: unknown,
  ): Reply {
    const path = url.pathname;
    const now = options.now();
    if (method === "GET" && path === "/v1/mp/quote") {
      if (who.role !== "rider") {
        return {
          status: 403,
          body: {
            code: "forbidden",
            message: "only a requester can ask for a quote",
          },
        };
      }
      const q = url.searchParams;
      const coords = ["pickupLat", "pickupLng", "dropoffLat", "dropoffLng"].map(
        (name) => Number(q.get(name)),
      );
      if (
        q.get("service") !== "ride" ||
        coords.some((value) => !Number.isFinite(value))
      ) {
        return {
          status: 422,
          body: { code: "validation_failed", message: "bad quote query" },
        };
      }
      const quote: StubQuote = {
        quoteId: randomUUID(),
        requesterId: who.userId,
        cityId: who.cityId,
        vehicleClass: q.get("vehicleClass") ?? "",
        suggestedMinor: stub.terms.suggestedMinor,
        minMinor: stub.terms.minMinor,
        maxMinor: stub.terms.maxMinor,
        routedDurationSec: stub.terms.routedDurationSec,
        expiresAt: new Date(now.getTime() + 300_000),
        pickup: { lat: coords[0] as number, lng: coords[1] as number },
        dropoff: { lat: coords[2] as number, lng: coords[3] as number },
      };
      quotes.set(quote.quoteId, quote);
      const envelope = {
        quoteId: quote.quoteId,
        service: "ride",
        vehicleClass: quote.vehicleClass,
        cityId: quote.cityId,
        currency: policy.currency,
        suggestedFareMinor: money(quote.suggestedMinor),
        minimumFareMinor: money(quote.minMinor),
        maximumFareMinor: money(quote.maxMinor),
        expiresAt: goTime(quote.expiresAt),
        pricingVersion: "engine.v1/cfg.1",
        policyVersion: 3,
        breakdown: [
          { label: "Base", amountMinor: money(quote.suggestedMinor) },
        ],
        routedDistanceMeters: 21_000,
        routedDurationSec: quote.routedDurationSec,
      };
      MpQuoteEnvelopeSchema.parse(envelope);
      return { status: 200, body: envelope };
    }

    if (method === "POST" && path === "/v1/mp/scheduled-requests") {
      return idempotent("scheduled.create", who, key, body, () => {
        if (who.role !== "rider") {
          return {
            status: 403,
            body: {
              code: "forbidden",
              message: "only a requester can schedule a request",
            },
          };
        }
        const parsed = MpCreateScheduledRequestSchema.safeParse(body);
        if (!parsed.success) {
          return {
            status: 422,
            body: {
              code: "validation_failed",
              message: parsed.error.issues
                .map((i) => `${i.path.join(".")}: ${i.message}`)
                .join("; "),
            },
          };
        }
        const input = parsed.data;
        const quote = quotes.get(input.quoteId);
        if (quote === undefined || quote.requesterId !== who.userId) {
          return {
            status: 404,
            body: { code: "not_found", message: "that quote does not exist" },
          };
        }
        if (now >= quote.expiresAt) {
          return {
            status: 409,
            body: {
              code: "quote_expired",
              message: "this quote has expired; ask for a new one",
            },
          };
        }
        if (
          input.requestedFareMinor.currency !== policy.currency ||
          input.maxFareMinor.currency !== policy.currency
        ) {
          return {
            status: 422,
            body: { code: "validation_failed", message: "currency" },
          };
        }
        const asked = input.requestedFareMinor.amountMinor;
        if (asked < quote.minMinor || asked > quote.maxMinor) {
          return {
            status: 409,
            body: {
              code: "fare_out_of_bounds",
              message: "outside the quote's bounds",
              details: { minimumMinor: quote.minMinor },
            },
          };
        }
        if (input.maxFareMinor.amountMinor < asked) {
          return {
            status: 422,
            body: {
              code: "validation_failed",
              message: "the approved maximum cannot be below the asked fare",
            },
          };
        }
        const zone = input.schedule.timeZone ?? policy.timeZone;
        const pickupAt = resolveLocal(
          input.schedule.localDate,
          input.schedule.localTime,
          zone,
          input.schedule.dstDisambiguation,
        );
        const windowSec = (input.schedule.windowMinutes ?? 10) * 60;
        if (
          pickupAt === null ||
          windowSec < policy.minWindowSec ||
          windowSec > policy.maxWindowSec
        ) {
          return {
            status: 422,
            body: {
              code: "validation_failed",
              message: "bad schedule",
              details: { field: "schedule" },
            },
          };
        }
        const lead = pickupAt.getTime() - now.getTime();
        if (lead < policy.minLeadSec * 1000) {
          return {
            status: 422,
            body: {
              code: "validation_failed",
              message: "too soon",
              details: {
                field: "schedule",
                minimumLeadMinutes: policy.minLeadSec / 60,
              },
            },
          };
        }
        if (lead > policy.maxHorizonSec * 1000) {
          return {
            status: 422,
            body: {
              code: "validation_failed",
              message: "too far",
              details: {
                field: "schedule",
                maximumHorizonDays: policy.maxHorizonSec / 86_400,
              },
            },
          };
        }
        const sr: StubScheduled = {
          id: randomUUID(),
          requesterId: who.userId,
          cityId: quote.cityId,
          vehicleClass: quote.vehicleClass,
          state: "scheduled_unassigned",
          version: 1,
          requestedMinor: asked,
          maxFareMinor: input.maxFareMinor.amountMinor,
          paymentMethodId: input.paymentMethodId,
          body: input,
          pickupAt,
          windowEnd: new Date(pickupAt.getTime() + windowSec * 1000),
          publishAt: new Date(
            pickupAt.getTime() - policy.publishLeadSec * 1000,
          ),
          pickup: quote.pickup,
          dropoff: quote.dropoff,
          requestId: null,
          requestState: null,
          closeReason: null,
          approval: null,
          createdAt: now,
          updatedAt: now,
        };
        scheduled.set(sr.id, sr);
        return { status: 201, body: view(sr) };
      });
    }

    const scheduledMatch =
      /^\/v1\/mp\/scheduled-requests\/([^/]+)(\/cancel|\/approve)?$/.exec(path);
    if (scheduledMatch !== null) {
      const found = ownedScheduled(
        decodeURIComponent(scheduledMatch[1] as string),
        who,
      );
      if (!("id" in found)) {
        return found;
      }
      const sr = found;
      const action = scheduledMatch[2];
      if (method === "GET" && action === undefined) {
        return { status: 200, body: view(sr) };
      }
      if (method === "POST" && action === "/cancel") {
        return idempotent(
          "scheduled.cancel",
          who,
          key,
          { scheduledRequestId: sr.id },
          () => {
            if (sr.state === "published" && sr.requestId !== null) {
              return {
                status: 409,
                body: {
                  code: "request_closed",
                  message:
                    "this trip was already sent to drivers; cancel the request instead",
                  details: { requestId: sr.requestId },
                },
              };
            }
            if (
              sr.state !== "scheduled_unassigned" &&
              sr.state !== "needs_rider_approval"
            ) {
              return {
                status: 409,
                body: {
                  code: "request_closed",
                  message: "this scheduled request can no longer be cancelled",
                  details: { state: sr.state },
                },
              };
            }
            sr.state = "cancelled";
            sr.closeReason = "cancelled_by_rider";
            sr.version += 1;
            sr.updatedAt = now;
            return { status: 200, body: view(sr) };
          },
        );
      }
      if (method === "POST" && action === "/approve") {
        return idempotent("scheduled.approve", who, key, body, () => {
          const input = body as {
            expectedVersion?: unknown;
            maxFareMinor?: { amountMinor?: unknown };
          };
          if (sr.state !== "needs_rider_approval") {
            return {
              status: 409,
              body: { code: "conflict", message: "not waiting for approval" },
            };
          }
          if (input.expectedVersion !== sr.version) {
            return {
              status: 409,
              body: { code: "version_conflict", message: "changed" },
            };
          }
          const max = Number(input.maxFareMinor?.amountMinor);
          if (sr.approval !== null && max < sr.approval.minMinor) {
            return {
              status: 409,
              body: {
                code: "fare_out_of_bounds",
                message: "below the refreshed minimum",
              },
            };
          }
          sr.maxFareMinor = max;
          sr.state = "scheduled_unassigned";
          sr.approval = null;
          sr.version += 1;
          sr.updatedAt = now;
          return { status: 200, body: view(sr) };
        });
      }
    }

    const requestCancel = /^\/v1\/mp\/requests\/([^/]+)\/cancel$/.exec(path);
    if (method === "POST" && requestCancel !== null) {
      const requestId = decodeURIComponent(requestCancel[1] as string);
      const sr = [...scheduled.values()].find(
        (candidate) => candidate.requestId === requestId,
      );
      if (sr === undefined || sr.requesterId !== who.userId) {
        return {
          status: 404,
          body: { code: "not_found", message: "that request does not exist" },
        };
      }
      return idempotent("request.cancel", who, key, { requestId }, () => {
        if (
          sr.requestState === "open" ||
          (sr.requestState === "awarded" && stub.awardedCancel === "allow")
        ) {
          sr.requestState = "cancelled";
          sr.updatedAt = now;
          return { status: 200, body: { requestId, state: "cancelled" } };
        }
        if (sr.requestState === "award_pending") {
          return {
            status: 409,
            body: {
              code: "award_unresolved",
              message: "the award is being confirmed",
            },
          };
        }
        return {
          status: 409,
          body: {
            code: "request_closed",
            message:
              "this request can no longer be cancelled here; cancel from the trip",
            details: { state: sr.requestState },
          },
        };
      });
    }
    return {
      status: 404,
      body: { code: "not_found", message: `no route ${method} ${path}` },
    };
  }

  const server: Server = createServer((message, response) => {
    const chunks: Buffer[] = [];
    message.on("data", (chunk: Buffer) => chunks.push(chunk));
    message.on("end", () => {
      const method = message.method ?? "GET";
      const url = new URL(message.url ?? "/", "http://stub");
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: unknown = undefined;
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const key = header(message, "idempotency-key") || null;
      const identity = verifyIdentity(message, secrets, Date.now());
      let reply: Reply;
      let who: StubIdentity | null = null;
      if ("status" in identity) {
        reply = identity;
      } else {
        who = identity;
        const index = scripted.findIndex((entry) =>
          `${method} ${url.pathname}`.startsWith(entry.match),
        );
        if (index >= 0) {
          reply = (scripted.splice(index, 1)[0] as { reply: Reply }).reply;
        } else {
          reply = route(method, url, who, key, body);
        }
      }
      const call: StubCall = {
        method,
        path: url.pathname,
        idempotencyKey: key,
        body,
        identity: who,
        status: reply.status,
      };
      calls.push(call);
      if (who === null) {
        refusedIdentities.push(call);
      }
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the ride stub did not bind a TCP port");
  }

  function must(id: string): StubScheduled {
    const sr = scheduled.get(id);
    if (sr === undefined) {
      throw new Error(`no scheduled request ${id}`);
    }
    return sr;
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    refusedIdentities,
    scheduled,
    get terms() {
      return stub.terms;
    },
    set terms(next: StubTerms) {
      stub.terms = next;
    },
    get awardedCancel() {
      return stub.awardedCancel;
    },
    set awardedCancel(next: "refuse" | "allow") {
      stub.awardedCancel = next;
    },
    failNext(match, reply) {
      scripted.push({ match, reply });
    },
    publish(id) {
      const sr = must(id);
      sr.state = "published";
      sr.requestId = randomUUID();
      sr.requestState = "open";
      sr.version += 1;
      return sr;
    },
    award(id) {
      const sr = must(id);
      if (sr.state !== "published") {
        throw new Error("only a published request can be awarded");
      }
      sr.requestState = "awarded";
      return sr;
    },
    unfulfill(id, reason = "no_driver_found") {
      const sr = must(id);
      sr.state = "unfulfilled";
      sr.closeReason = reason;
      if (sr.requestState === "open") {
        sr.requestState = "expired";
      }
      sr.version += 1;
      return sr;
    },
    needsApproval(id, minMinor) {
      const sr = must(id);
      sr.state = "needs_rider_approval";
      sr.approval = {
        reason: "fare_above_approval",
        message:
          "The minimum fare for this trip is now above what you approved. Nothing was sent to drivers.",
        minMinor,
      };
      sr.version += 1;
      return sr;
    },
    byRequestId(requestId) {
      return [...scheduled.values()].find(
        (candidate) => candidate.requestId === requestId,
      );
    },
    count(match) {
      return calls.filter((call) => {
        if (call.identity === null) {
          return false;
        }
        const line = `${call.method} ${call.path}`;
        return typeof match === "string" ? line === match : match.test(line);
      }).length;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
