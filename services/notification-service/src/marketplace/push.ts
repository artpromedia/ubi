/**
 * Durable marketplace push delivery (G10).
 *
 * Turns a validated mp.* outbox envelope into FCM pushes to the authorized
 * audience, with the properties a real notifier needs and the previous
 * logging-stub handlers lacked:
 *
 *   - dedupe: idempotent per event id (an at-least-once outbox redelivers);
 *   - ordering: a per-subject sequence guard drops out-of-order / superseded
 *     (e.g. expired-then-reasserted) events;
 *   - retry with capped exponential backoff, then a dead-letter path;
 *   - token rotation/invalidation: FCM's invalid-token failures deactivate the
 *     stale token so it is not retried forever;
 *   - preferences: per-user push opt-out honored, with a documented allow
 *     default when a user has no preference row;
 *   - offline recipients are RECORDED for later retry rather than dropped;
 *   - the payload is a HINT only — ids + type, never money and never a PIN — so
 *     a push can never disclose a private bid amount or a pickup PIN.
 *
 * The deliverer is pure and port-driven so it unit-tests without Redis, Prisma
 * or FCM; production wiring lives in ./consumer.ts.
 */
import { backoffDelayMs, type BackoffOptions } from "@ubi/outbox";

import {
  MARKETPLACE_PUSH_SPECS,
  buildHintData,
  resolveMarketplaceAudience,
  type MarketplacePushSpec,
  type PushPrefCategory,
} from "./audience.js";

import type { EventEnvelope } from "@ubi/contracts";

export type MarketplacePushOutcome =
  | "delivered"
  | "deferred_no_device"
  | "dead_lettered"
  | "suppressed_prefs"
  | "deduped"
  | "stale"
  | "skipped_event";

export interface PerUserResult {
  readonly userId: string;
  readonly outcome: MarketplacePushOutcome;
  readonly attempts: number;
}

export interface MarketplacePushResult {
  readonly eventId: string;
  readonly eventName: string;
  readonly outcome: "processed" | "deduped" | "stale" | "skipped_event";
  readonly perUser: PerUserResult[];
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
  readonly userId: string;
  readonly attempts: number;
  readonly reason: string;
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
  readonly maxAttempts?: number;
  readonly backoff?: BackoffOptions;
  readonly delay?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 200, maxMs: 30_000 };

export class MarketplacePushDeliverer {
  private readonly maxAttempts: number;
  private readonly backoff: BackoffOptions;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(private readonly ports: MarketplacePushPorts) {
    this.maxAttempts = Math.max(1, ports.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    this.backoff = ports.backoff ?? DEFAULT_BACKOFF;
    this.delay =
      ports.delay ??
      (async (ms: number) => {
        await new Promise<void>((resolve) => setTimeout(resolve, ms));
      });
  }

  async handle(envelope: EventEnvelope): Promise<MarketplacePushResult> {
    const base = { eventId: envelope.id, eventName: envelope.name };

    const spec = MARKETPLACE_PUSH_SPECS[envelope.name];
    if (!spec) {
      return { ...base, outcome: "skipped_event", perUser: [] };
    }

    // Dedupe: an at-least-once outbox can redeliver the same id.
    if (!(await this.ports.state.firstSightOfEvent(envelope.id))) {
      return { ...base, outcome: "deduped", perUser: [] };
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
        return { ...base, outcome: "stale", perUser: [] };
      }
    }

    const audience = resolveMarketplaceAudience(envelope);
    const data = buildHintData(envelope);
    const perUser: PerUserResult[] = [];
    for (const userId of audience) {
      perUser.push(await this.deliverToUser(envelope, spec, userId, data));
    }
    return { ...base, outcome: "processed", perUser };
  }

  private async deliverToUser(
    envelope: EventEnvelope,
    spec: MarketplacePushSpec,
    userId: string,
    data: Record<string, string>,
  ): Promise<PerUserResult> {
    if (!(await this.ports.prefs.allows(userId, spec.prefCategory))) {
      return { userId, outcome: "suppressed_prefs", attempts: 0 };
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
      return { userId, outcome: "deferred_no_device", attempts: 0 };
    }

    const notification: PushNotification = {
      title: spec.title,
      body: spec.body,
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
        return { userId, outcome: "delivered", attempts };
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
        return { userId, outcome: "deferred_no_device", attempts };
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
      reason: lastError || "retries_exhausted",
    });
    this.ports.logger.warn(
      { eventId: envelope.id, eventName: envelope.name, userId, attempts },
      "marketplace push dead-lettered after exhausted retries",
    );
    return { userId, outcome: "dead_lettered", attempts };
  }
}
