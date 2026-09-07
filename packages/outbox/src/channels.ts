/**
 * Redis channel naming for outbox delivery.
 *
 * Every published event lands on two channels:
 *   - the *subject* channel, which mirrors the realtime topic exactly
 *     (`topicFor` from @ubi/contracts, e.g. `ride.rd_314`). This is what the
 *     realtime-gateway and per-aggregate consumers subscribe to.
 *   - the *event-type* channel (`event:<name>`, e.g. `event:ride.completed`),
 *     which fan-out consumers (ledger, recon, notification) subscribe to by
 *     name or by the `event:*` pattern, regardless of which aggregate emitted
 *     it.
 *
 * The two namespaces do not collide: a subject topic is `<subjectType>.<id>`
 * and an event-type channel is always prefixed with `event:`.
 */
import { topicFor, type SubjectType } from "@ubi/contracts";

/** Prefix for per-event-type channels. */
export const EVENT_TYPE_CHANNEL_PREFIX = "event:";

/** The subject/topic channel, identical to the realtime topic. */
export function subjectChannel(subject: { readonly type: SubjectType; readonly id: string }): string {
  return topicFor(subject);
}

/** The per-event-type channel for an event name, e.g. `event:ride.completed`. */
export function eventTypeChannel(name: string): string {
  return `${EVENT_TYPE_CHANNEL_PREFIX}${name}`;
}
