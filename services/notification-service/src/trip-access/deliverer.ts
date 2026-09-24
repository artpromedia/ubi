/**
 * Passenger trip-link SMS delivery (A06 part B, "book for another adult").
 *
 * Consumes `trip_access.*` outbox events and turns each `trip_access.issued`
 * into exactly one SMS to the guest passenger, per the TRIP-LINK SEALED
 * DELIVERY CONTRACT (./sealed.ts):
 *
 *   - the payload is validated STRICTLY: an event carrying the access token,
 *     the phone or the first name in clear is refused (dead-lettered, never
 *     sent) so an insecure producer is never rewarded;
 *   - `sealed` is opened with the key ring (AAD bound to the tokenId, which
 *     must equal the event's aggregate id);
 *   - `smsCopy` is a TEMPLATE: `{firstName}` and `{link}` are filled in ONE
 *     pass (a name can never inject a second placeholder), where
 *     link = PASSENGER_TRIP_LINK_BASE_URL + "#t=" + token — a URL fragment, so
 *     the token never reaches a server log;
 *   - idempotent by tokenId: a claim (SET NX) before sending and a final
 *     marker after, so a redelivered event (or a second event for the same
 *     token) never sends twice;
 *   - transient provider failures retry with capped backoff; a permanent
 *     failure, an envelope that does not open or exhausted retries go to the
 *     dead-letter queue — which stores only ids, the masked phone and the
 *     still-SEALED envelope (replayable with the key, useless without it);
 *   - `trip_access.revoked` records the revocation, so a link withdrawn before
 *     its SMS went out is never sent; an already-expired link is not sent.
 *
 * The token and the full phone number NEVER reach a log line or a dead-letter
 * entry: phones are masked, provider error text is scrubbed of both.
 *
 * The passenger has no UBI account in this flow; this SMS (and the trip link
 * it carries) is the ONLY channel that reaches them. No push, no lookup.
 */
import { z } from "zod";

import { backoffDelayMs, type BackoffOptions } from "@ubi/outbox";

import {
  TripAccessOpenError,
  isSealedEnvelope,
  openTripAccess,
  type TripAccessKeyRing,
  type TripAccessSealed,
} from "./sealed.js";
import { maskPhone, redactSecrets, safeErrorText } from "../lib/redact.js";

import type { SmsSender, SmsSendResult } from "../providers/sms.js";
import type { EventEnvelope } from "@ubi/contracts";

export const TRIP_ACCESS_ISSUED = "trip_access.issued";
export const TRIP_ACCESS_REVOKED = "trip_access.revoked";

/**
 * The `trip_access.issued` payload, mirroring the contract's
 * MpTripAccessIssuedPayloadSchema. `.strict()`: no key beyond these — in
 * particular no accessToken / phone / firstName in clear.
 */
const IssuedPayloadSchema = z
  .object({
    tokenId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    scope: z.literal("guest_passenger"),
    expiresAt: z.string().datetime({ offset: true }),
    recipient: z.object({ channel: z.literal("sms") }).strict(),
    smsCopy: z
      .string()
      .min(1)
      .max(640)
      .includes("{link}")
      .includes("{firstName}"),
    sealed: z.custom<TripAccessSealed>(isSealedEnvelope),
  })
  .strict();

/** Issue codes and key NAMES only — never a value. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => {
      const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
      const keys =
        issue.code === "unrecognized_keys" ? `(${issue.keys.join(",")})` : "";
      return `${path}:${issue.code}${keys}`;
    })
    .join(", ");
}

export type TripAccessFinal = "sent" | "dead" | "revoked" | "expired";

export interface TripAccessDeadLetter {
  readonly eventId: string;
  readonly tokenId: string;
  readonly requestId: string | null;
  readonly reason: string;
  readonly attempts: number;
  /** Masked only ("+234********00"), for support correlation. */
  readonly maskedPhone?: string;
  /** The still-sealed envelope, so ops can replay it with the key. */
  readonly sealed?: TripAccessSealed;
}

export interface TripAccessLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface TripAccessSmsPorts {
  readonly keys: TripAccessKeyRing;
  /** PASSENGER_TRIP_LINK_BASE_URL, validated at startup (no fragment). */
  readonly linkBaseUrl: string;
  readonly sms: SmsSender;
  readonly state: {
    /** SET NX a short-lived claim on the token: false when already taken. */
    claim(tokenId: string): Promise<boolean>;
    /** Replace the claim with the final outcome (kept past the link's life). */
    finish(tokenId: string, outcome: TripAccessFinal): Promise<void>;
    markRevoked(tokenId: string): Promise<void>;
    isRevoked(tokenId: string): Promise<boolean>;
  };
  readonly deadLetters: { record(entry: TripAccessDeadLetter): Promise<void> };
  readonly logger: TripAccessLogger;
  readonly now?: () => Date;
  readonly maxAttempts?: number;
  readonly backoff?: BackoffOptions;
  readonly delay?: (ms: number) => Promise<void>;
}

export type TripAccessOutcome =
  | "sent"
  | "deduped"
  | "dead_lettered"
  | "suppressed_revoked"
  | "skipped_expired"
  | "revocation_recorded"
  | "skipped_event";

export interface TripAccessResult {
  readonly eventId: string;
  readonly eventName: string;
  readonly tokenId: string | null;
  readonly outcome: TripAccessOutcome;
  readonly attempts: number;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 30_000 };

/** Control characters (C0 and DEL) never belong in an SMS name. */
function cleanName(name: string): string {
  return [...name]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("")
    .trim();
}

/** Fill `{firstName}` and `{link}` in a single pass. */
export function fillSmsTemplate(
  template: string,
  values: { readonly firstName: string; readonly link: string },
): string {
  return template.replace(/\{(firstName|link)\}/g, (_match, key: string) =>
    key === "link" ? values.link : values.firstName,
  );
}

/** The passenger's link: base + "#t=" + token (fragment: never sent to a server). */
export function passengerTripLink(baseUrl: string, token: string): string {
  return `${baseUrl}#t=${token}`;
}

export class TripAccessSmsDeliverer {
  private readonly maxAttempts: number;
  private readonly backoff: BackoffOptions;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly ports: TripAccessSmsPorts) {
    this.maxAttempts = Math.max(1, ports.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.backoff = ports.backoff ?? DEFAULT_BACKOFF;
    this.now = ports.now ?? (() => new Date());
    this.delay =
      ports.delay ??
      (async (ms: number) => {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
      });
  }

  async handle(envelope: EventEnvelope): Promise<TripAccessResult> {
    const base = { eventId: envelope.id, eventName: envelope.name };

    if (envelope.name === TRIP_ACCESS_REVOKED) {
      const tokenId =
        typeof envelope.payload.tokenId === "string" &&
        envelope.payload.tokenId.length > 0
          ? envelope.payload.tokenId
          : envelope.subject.id;
      await this.ports.state.markRevoked(tokenId);
      return { ...base, tokenId, outcome: "revocation_recorded", attempts: 0 };
    }
    if (envelope.name !== TRIP_ACCESS_ISSUED) {
      return { ...base, tokenId: null, outcome: "skipped_event", attempts: 0 };
    }

    const parsed = IssuedPayloadSchema.safeParse(envelope.payload);
    if (!parsed.success) {
      // Never log the payload: a non-conforming producer may have put the
      // token or the phone in it. Paths, codes and key names only.
      const issues = describeIssues(parsed.error);
      this.ports.logger.error(
        {
          alert: "trip_access_payload_refused",
          eventId: envelope.id,
          tokenId: envelope.subject.id,
          issues,
        },
        "trip_access.issued refused: payload does not match the sealed delivery contract; nothing sent",
      );
      await this.ports.deadLetters.record({
        eventId: envelope.id,
        tokenId: envelope.subject.id,
        requestId: null,
        reason: `payload_invalid: ${issues}`,
        attempts: 0,
      });
      return {
        ...base,
        tokenId: envelope.subject.id,
        outcome: "dead_lettered",
        attempts: 0,
      };
    }
    const payload = parsed.data;
    const tokenId = payload.tokenId;

    if (tokenId !== envelope.subject.id) {
      // The AAD binds the envelope to payload.tokenId, and the contract says
      // that is the aggregate id: a mismatch is a malformed event.
      await this.deadLetter(envelope, payload, "token_id_mismatch", 0);
      return { ...base, tokenId, outcome: "dead_lettered", attempts: 0 };
    }

    if (!(await this.ports.state.claim(tokenId))) {
      return { ...base, tokenId, outcome: "deduped", attempts: 0 };
    }

    if (await this.ports.state.isRevoked(tokenId)) {
      await this.ports.state.finish(tokenId, "revoked");
      this.ports.logger.info(
        { eventId: envelope.id, tokenId, requestId: payload.requestId },
        "trip link revoked before its SMS was sent; not sent",
      );
      return { ...base, tokenId, outcome: "suppressed_revoked", attempts: 0 };
    }

    if (Date.parse(payload.expiresAt) <= this.now().getTime()) {
      await this.ports.state.finish(tokenId, "expired");
      this.ports.logger.warn(
        { eventId: envelope.id, tokenId, requestId: payload.requestId },
        "trip link already expired when its event arrived; not sent",
      );
      return { ...base, tokenId, outcome: "skipped_expired", attempts: 0 };
    }

    let opened: { phone: string; token: string; firstName: string };
    try {
      opened = openTripAccess(this.ports.keys, tokenId, payload.sealed);
    } catch (err) {
      const code =
        err instanceof TripAccessOpenError ? err.code : "open_failed";
      this.ports.logger.error(
        {
          alert: "trip_access_envelope_refused",
          eventId: envelope.id,
          tokenId,
          kid: payload.sealed.kid,
          code,
        },
        "trip access envelope did not open; nothing sent",
      );
      await this.deadLetter(envelope, payload, `open_failed: ${code}`, 0);
      await this.ports.state.finish(tokenId, "dead");
      return { ...base, tokenId, outcome: "dead_lettered", attempts: 0 };
    }

    const secrets = [opened.phone, opened.token];
    const maskedPhone = maskPhone(opened.phone);
    const message = fillSmsTemplate(payload.smsCopy, {
      firstName: cleanName(opened.firstName),
      link: passengerTripLink(this.ports.linkBaseUrl, opened.token),
    });

    let attempts = 0;
    let lastError = "";
    let permanent = false;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      attempts = attempt;
      let result: SmsSendResult;
      try {
        result = await this.ports.sms.send(opened.phone, message);
      } catch (err) {
        result = { success: false, error: safeErrorText(err, secrets) };
      }
      if (result.success) {
        await this.ports.state.finish(tokenId, "sent");
        this.ports.logger.info(
          {
            eventId: envelope.id,
            tokenId,
            requestId: payload.requestId,
            to: maskedPhone,
            provider: result.provider,
            messageId: result.messageId,
            attempts,
          },
          "passenger trip link SMS sent",
        );
        return { ...base, tokenId, outcome: "sent", attempts };
      }
      lastError = redactSecrets(result.error ?? "sms_failed", secrets).slice(
        0,
        300,
      );
      if (result.permanent) {
        permanent = true;
        break;
      }
      if (attempt < this.maxAttempts) {
        await this.delay(backoffDelayMs(attempt, this.backoff));
      }
    }

    await this.deadLetter(
      envelope,
      payload,
      permanent
        ? `permanent_failure: ${lastError}`
        : `retries_exhausted: ${lastError}`,
      attempts,
      maskedPhone,
    );
    await this.ports.state.finish(tokenId, "dead");
    this.ports.logger.warn(
      {
        eventId: envelope.id,
        tokenId,
        requestId: payload.requestId,
        to: maskedPhone,
        attempts,
        error: lastError,
      },
      "passenger trip link SMS dead-lettered",
    );
    return { ...base, tokenId, outcome: "dead_lettered", attempts };
  }

  private async deadLetter(
    envelope: EventEnvelope,
    payload: z.infer<typeof IssuedPayloadSchema>,
    reason: string,
    attempts: number,
    maskedPhone?: string,
  ): Promise<void> {
    await this.ports.deadLetters.record({
      eventId: envelope.id,
      tokenId: payload.tokenId,
      requestId: payload.requestId,
      reason,
      attempts,
      ...(maskedPhone ? { maskedPhone } : {}),
      sealed: payload.sealed,
    });
  }
}
