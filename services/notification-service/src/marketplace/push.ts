/**
 * Durable outbox push delivery (G10; extended for the round 2-6 events).
 *
 * Turns a validated outbox envelope (mp.*, trip_access.declined,
 * reservation.*, shipment.return_proposed) into FCM pushes with PER-VIEWER
 * copy to the authorized roles only (./audience.ts, ./specs.ts), with the
 * properties a real notifier needs:
 *
 *   - dedupe: idempotent per event id (an at-least-once outbox redelivers);
 *   - ordering: a per-subject sequence guard drops out-of-order / superseded
 *     (e.g. expired-then-reasserted) events;
 *   - recipients: the payload's own party ids first; otherwise the party
 *     directory (./parties.ts). A role that cannot be resolved is
 *     dead-lettered as `audience_unresolved` — never guessed, never broadcast.
 *     A bid's driver is ONLY the payload's bidding driver (never the award's);
 *   - the actor of an event is not pushed about their own action (unless the
 *     catalog names them as the audience);
 *   - retry with capped exponential backoff, then a dead-letter path;
 *   - token rotation/invalidation: FCM's invalid-token failures deactivate the
 *     stale token so it is not retried forever;
 *   - preferences: per-user push opt-out honored, with a documented allow
 *     default when a user has no preference row;
 *   - offline recipients are RECORDED for later retry rather than dropped;
 *     for time-critical events (spec.smsFallback) ONE SMS goes to the
 *     recipient's own verified account phone instead (SMS critical-alert
 *     preference honored; a push opt-out is honored for SMS too);
 *   - the payload is a HINT only — ids + type, never money, a name, a phone or
 *     a PIN — so a push can never disclose a private bid amount, the driver's
 *     commission, rider PII or a pickup PIN.
 *
 * The deliverer is pure and port-driven so it unit-tests without Redis, Prisma
 * or FCM; production wiring lives in ./consumer.ts.
 */
import { backoffDelayMs, type BackoffOptions } from "@ubi/outbox";

import {
  addressedRoles,
  buildHintData,
  isPersonActor,
  payloadId,
  type NotificationSpec,
  type PushPrefCategory,
  type Role,
  type ViewerCopy,
} from "./audience.js";
import { NOTIFICATION_SPECS } from "./specs.js";
import { maskPhone, redactSecrets, safeErrorText } from "../lib/redact.js";

import type {
  AwardParties,
  PartyDirectory,
  PhoneDirectory,
} from "./parties.js";
import type { SmsSender, SmsSendResult } from "../providers/sms.js";
import type { EventEnvelope } from "@ubi/contracts";

export type MarketplacePushOutcome =
  | "delivered"
  | "deferred_no_device"
  | "dead_lettered"
  | "suppressed_prefs"
  | "skipped_actor"
  | "deduped"
  | "stale"
  | "skipped_event";

export type SmsFallbackOutcome =
  | "sent"
  | "suppressed_prefs"
  | "no_phone"
  | "dead_lettered";

export interface PerUserResult {
  readonly userId: string;
  readonly role: Role;
  readonly outcome: MarketplacePushOutcome;
  readonly attempts: number;
  /** Set when a time-critical push could not be delivered and SMS was tried. */
  readonly sms?: SmsFallbackOutcome;
}

export interface UnresolvedRole {
  readonly role: Role;
  readonly reason: string;
}

export interface MarketplacePushResult {
  readonly eventId: string;
  readonly eventName: string;
  readonly outcome: "processed" | "deduped" | "stale" | "skipped_event";
  readonly perUser: PerUserResult[];
  readonly unresolved: UnresolvedRole[];
}

export interface PushNotification {
  readonly title: string;
  readonly body: string;
  readonly type: string;
  readonly data: Record<string, string>;
}

export interface PushSendResult {
  readonly success: boolean;
  /** Tokens FCM reported as unregistered/invalid — to be deactivated. */
  readonly invalidTokens?: string[];
  readonly error?: string;
}

export interface DeadLetterEntry {
  readonly eventId: string;
  readonly eventName: string;
  /** Empty when the audience itself could not be resolved. */
  readonly userId: string;
  readonly attempts: number;
  readonly reason: string;
  readonly role?: Role;
  readonly channel?: "push" | "sms";
}

export interface PendingEntry {
  readonly eventId: string;
  readonly eventName: string;
  readonly userId: string;
  readonly reason: string;
}

export interface PushLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface MarketplacePushPorts {
  readonly devices: {
    activeTokens(userId: string): Promise<string[]>;
    deactivate(tokens: string[]): Promise<void>;
  };
  readonly prefs: {
    allows(userId: string, category: PushPrefCategory): Promise<boolean>;
  };
  readonly sender: {
    send(
      userId: string,
      tokens: string[],
      notification: PushNotification,
    ): Promise<PushSendResult>;
  };
  readonly state: {
    /** SET NX on the event id: true the first time, false on redelivery. */
    firstSightOfEvent(eventId: string): Promise<boolean>;
    /** Records the max sequence per subject; false when seq <= what we've seen. */
    advanceSubjectSequence(
      subjectKey: string,
      sequence: number,
    ): Promise<boolean>;
  };
  readonly deadLetters: { record(entry: DeadLetterEntry): Promise<void> };
  readonly pending: { record(entry: PendingEntry): Promise<void> };
  readonly logger: PushLogger;
  /** Resolves parties the payload does not name. Absent: payload ids only. */
  readonly parties?: PartyDirectory;
  /** SMS fallback for time-critical events. Absent: push only. */
  readonly sms?: {
    readonly phones: PhoneDirectory;
    readonly sender: SmsSender;
    /** The recipient's SMS critical-alert preference. */
    allows(userId: string): Promise<boolean>;
  };
  /** The spec table; defaults to NOTIFICATION_SPECS. */
  readonly specs?: Readonly<Record<string, NotificationSpec>>;
  readonly maxAttempts?: number;
  readonly backoff?: BackoffOptions;
  readonly delay?: (ms: number) => Promise<void>;
}

interface Recipient {
  readonly userId: string;
  readonly role: Role;
  readonly copy: ViewerCopy;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 200, maxMs: 30_000 };

/** One SMS line from a push's copy. */
export function smsTextFor(copy: ViewerCopy): string {
  const title = copy.title.trim();
  const joiner = /[.?!]$/.test(title) ? " " : ". ";
  return `UBI: ${title}${joiner}${copy.body}`;
}

export class MarketplacePushDeliverer {
  private readonly maxAttempts: number;
  private readonly backoff: BackoffOptions;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly specs: Readonly<Record<string, NotificationSpec>>;

  constructor(private readonly ports: MarketplacePushPorts) {
    this.maxAttempts = Math.max(1, ports.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.backoff = ports.backoff ?? DEFAULT_BACKOFF;
    this.specs = ports.specs ?? NOTIFICATION_SPECS;
    this.delay =
      ports.delay ??
      (async (ms: number) => {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
      });
  }

  async handle(envelope: EventEnvelope): Promise<MarketplacePushResult> {
    const base = {
      eventId: envelope.id,
      eventName: envelope.name,
      perUser: [] as PerUserResult[],
      unresolved: [] as UnresolvedRole[],
    };

    const spec = this.specs[envelope.name];
    const roles = spec ? addressedRoles(envelope, spec) : [];
    if (!spec || roles.length === 0) {
      // Not a notifiable event, or not in this state (e.g. a close reason
      // nobody is told about): nothing recorded, nothing sent.
      return { ...base, outcome: "skipped_event" };
    }

    // Dedupe: an at-least-once outbox can redeliver the same id.
    if (!(await this.ports.state.firstSightOfEvent(envelope.id))) {
      return { ...base, outcome: "deduped" };
    }

    // Ordering: drop an event whose sequence is not newer than what we've
    // already processed for this subject. This tolerates out-of-order delivery
    // and suppresses a stale (e.g. expired) event that arrives after a newer
    // one for the same aggregate.
    if (typeof envelope.sequence === "number") {
      const subjectKey = `${envelope.subject.type}:${envelope.subject.id}`;
      const fresh = await this.ports.state.advanceSubjectSequence(
        subjectKey,
        envelope.sequence,
      );
      if (!fresh) {
        return { ...base, outcome: "stale" };
      }
    }

    const data = buildHintData(envelope);
    const awards = new Map<string, Promise<AwardParties | null>>();
    const seen = new Set<string>();
    const perUser: PerUserResult[] = [];
    const unresolved: UnresolvedRole[] = [];

    for (const { role, copy } of roles) {
      const resolved = await this.resolve(envelope, role, awards);
      if ("reason" in resolved) {
        unresolved.push({ role, reason: resolved.reason });
        await this.ports.deadLetters.record({
          eventId: envelope.id,
          eventName: envelope.name,
          userId: "",
          attempts: 0,
          role,
          reason: `audience_unresolved: ${resolved.reason}`,
        });
        this.ports.logger.warn(
          {
            eventId: envelope.id,
            eventName: envelope.name,
            role,
            reason: resolved.reason,
          },
          "notification audience unresolved; dead-lettered for replay",
        );
        continue;
      }
      const userId = resolved.userId;
      if (seen.has(userId)) {
        continue;
      }
      seen.add(userId);
      if (
        !spec.notifyActor &&
        isPersonActor(envelope.actor) &&
        envelope.actor.id === userId
      ) {
        // They performed the action; the response already told them.
        perUser.push({ userId, role, outcome: "skipped_actor", attempts: 0 });
        continue;
      }
      perUser.push(
        await this.deliverToUser(envelope, spec, { userId, role, copy }, data),
      );
    }
    return { ...base, outcome: "processed", perUser, unresolved };
  }

  /**
   * The userId for one role: the payload's own id first, then the party
   * directory. Never a list, never a guess.
   */
  private async resolve(
    envelope: EventEnvelope,
    role: Role,
    awards: Map<string, Promise<AwardParties | null>>,
  ): Promise<{ userId: string } | { reason: string }> {
    const parties = this.ports.parties;
    // One award lookup per event, however many roles need it.
    const award = async (awardId: string): Promise<AwardParties | null> => {
      let found = awards.get(awardId);
      if (found === undefined) {
        found = parties ? parties.award(awardId) : Promise.resolve(null);
        awards.set(awardId, found);
      }
      const resolved = await found;
      return resolved;
    };
    const awardId =
      payloadId(envelope, "awardId") ??
      (envelope.subject.type === "mp_award" ? envelope.subject.id : null);

    try {
      switch (role) {
        case "requester": {
          const direct = payloadId(envelope, "requesterId");
          if (direct) {
            return { userId: direct };
          }
          if (!parties) {
            return { reason: "requester_not_in_payload" };
          }
          if (awardId) {
            const found = (await award(awardId))?.requesterId;
            if (found) {
              return { userId: found };
            }
          }
          const requestId =
            payloadId(envelope, "requestId") ??
            (envelope.subject.type === "mp_request"
              ? envelope.subject.id
              : null);
          if (requestId) {
            const found = await parties.requester(requestId);
            if (found) {
              return { userId: found };
            }
          }
          return { reason: "requester_not_found" };
        }
        case "driver": {
          const direct = payloadId(envelope, "driverId");
          if (direct) {
            return { userId: direct };
          }
          if (envelope.subject.type === "mp_bid") {
            // A bid event is about ITS bidder only: never fall back to the
            // award's driver (that could be the winner of someone else's bid).
            return { reason: "bid_without_driver" };
          }
          if (!parties) {
            return { reason: "driver_not_in_payload" };
          }
          if (awardId) {
            const found = (await award(awardId))?.driverId;
            if (found) {
              return { userId: found };
            }
          }
          return { reason: "driver_not_found" };
        }
        case "sender": {
          const direct = payloadId(envelope, "senderId");
          return direct
            ? { userId: direct }
            : { reason: "sender_not_in_payload" };
        }
        case "traveller": {
          const transferId =
            payloadId(envelope, "transferId") ??
            (envelope.subject.type === "reservation"
              ? envelope.subject.id
              : null);
          if (!transferId) {
            return { reason: "transfer_not_in_payload" };
          }
          if (!parties) {
            return { reason: "traveller_not_in_payload" };
          }
          const found = await parties.traveller(transferId);
          return found ? { userId: found } : { reason: "traveller_not_found" };
        }
      }
    } catch (err) {
      this.ports.logger.warn(
        {
          eventId: envelope.id,
          eventName: envelope.name,
          role,
          err: safeErrorText(err),
        },
        "notification audience lookup failed",
      );
      return { reason: "lookup_failed" };
    }
  }

  private async deliverToUser(
    envelope: EventEnvelope,
    spec: NotificationSpec,
    recipient: Recipient,
    data: Record<string, string>,
  ): Promise<PerUserResult> {
    const { userId, role } = recipient;
    if (!(await this.ports.prefs.allows(userId, spec.prefCategory))) {
      return { userId, role, outcome: "suppressed_prefs", attempts: 0 };
    }

    let tokens = await this.ports.devices.activeTokens(userId);
    if (tokens.length === 0) {
      // Offline / no registered device: record for later retry (a token
      // registration or a REST refresh reconciles) rather than dropping it.
      await this.ports.pending.record({
        eventId: envelope.id,
        eventName: envelope.name,
        userId,
        reason: "no_active_device",
      });
      const sms = await this.smsFallback(envelope, spec, recipient);
      return {
        userId,
        role,
        outcome: "deferred_no_device",
        attempts: 0,
        ...(sms ? { sms } : {}),
      };
    }

    const notification: PushNotification = {
      title: recipient.copy.title,
      body: recipient.copy.body,
      type: spec.type,
      data,
    };

    let attempts = 0;
    let lastError = "";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      attempts = attempt;
      let result: PushSendResult;
      try {
        result = await this.ports.sender.send(userId, tokens, notification);
      } catch (err) {
        result = {
          success: false,
          error: err instanceof Error ? err.message : "send threw",
        };
      }

      if (result.invalidTokens && result.invalidTokens.length > 0) {
        // Token rotation/invalidation: stop retrying a dead token.
        await this.ports.devices.deactivate(result.invalidTokens);
        const invalid = new Set(result.invalidTokens);
        tokens = tokens.filter((t) => !invalid.has(t));
      }

      if (result.success) {
        return { userId, role, outcome: "delivered", attempts };
      }
      lastError = result.error ?? "delivery_failed";

      if (tokens.length === 0) {
        // Every token was invalidated: nothing left to retry. Defer for retry
        // once the user re-registers a device.
        await this.ports.pending.record({
          eventId: envelope.id,
          eventName: envelope.name,
          userId,
          reason: "all_tokens_invalidated",
        });
        const sms = await this.smsFallback(envelope, spec, recipient);
        return {
          userId,
          role,
          outcome: "deferred_no_device",
          attempts,
          ...(sms ? { sms } : {}),
        };
      }

      if (attempt < this.maxAttempts) {
        await this.delay(backoffDelayMs(attempt, this.backoff));
      }
    }

    await this.ports.deadLetters.record({
      eventId: envelope.id,
      eventName: envelope.name,
      userId,
      attempts,
      role,
      channel: "push",
      reason: lastError || "retries_exhausted",
    });
    this.ports.logger.warn(
      { eventId: envelope.id, eventName: envelope.name, userId, attempts },
      "marketplace push dead-lettered after exhausted retries",
    );
    const sms = await this.smsFallback(envelope, spec, recipient);
    return {
      userId,
      role,
      outcome: "dead_lettered",
      attempts,
      ...(sms ? { sms } : {}),
    };
  }

  /**
   * ONE SMS to the recipient's own verified account phone, for time-critical
   * events whose push could not be delivered. The text is the same hint copy
   * (no money, no PII). The phone is logged masked only.
   */
  private async smsFallback(
    envelope: EventEnvelope,
    spec: NotificationSpec,
    recipient: Recipient,
  ): Promise<SmsFallbackOutcome | undefined> {
    const sms = this.ports.sms;
    if (!spec.smsFallback || !sms) {
      return undefined;
    }
    const { userId, role } = recipient;
    let phone: string | null;
    try {
      if (!(await sms.allows(userId))) {
        return "suppressed_prefs";
      }
      phone = await sms.phones.verifiedPhone(userId);
    } catch (err) {
      this.ports.logger.warn(
        { eventId: envelope.id, userId, err: safeErrorText(err) },
        "sms fallback lookup failed",
      );
      phone = null;
    }
    if (!phone) {
      return "no_phone";
    }

    let result: SmsSendResult;
    try {
      result = await sms.sender.send(phone, smsTextFor(recipient.copy));
    } catch (err) {
      result = { success: false, error: safeErrorText(err, [phone]) };
    }
    if (result.success) {
      this.ports.logger.info(
        {
          eventId: envelope.id,
          eventName: envelope.name,
          userId,
          role,
          to: maskPhone(phone),
          provider: result.provider,
        },
        "time-critical notification sent by SMS fallback",
      );
      return "sent";
    }
    await this.ports.deadLetters.record({
      eventId: envelope.id,
      eventName: envelope.name,
      userId,
      attempts: 1,
      role,
      channel: "sms",
      reason: `sms_fallback_failed: ${redactSecrets(result.error ?? "sms_failed", [phone]).slice(0, 300)}`,
    });
    return "dead_lettered";
  }
}
