export type Envelope<T = unknown> = {
  seq: number;
  type: string;
  occurredAt: string;
  payload: T;
};

export type NormalizedRealtimeFrame =
  | { kind: "event"; envelope: Envelope }
  | { kind: "replay_overflow" }
  | { kind: "heartbeat" }
  | { kind: "ignore" };

/**
 * Normalize a wire frame from `realtime-gateway` into a canonical `Envelope`
 * (or control signal). Accepts both:
 *   - `{ type: "marketplace_event", seq?, occurredAt?, payload: { name, subject, seq?, occurredAt, data, ... } }`
 *   - `{ seq, type, occurredAt, payload }`
 *   - `{ type: "replay_overflow" }`
 *   - `{ type: "heartbeat", payload: { timestamp } }`
 */
export function normalizeRealtimeMessage(
  raw: unknown,
): NormalizedRealtimeFrame {
  if (!raw || typeof raw !== "object") {
    return { kind: "ignore" };
  }
  const msg = raw as Record<string, unknown>;
  if (msg.type === "replay_overflow") {
    return { kind: "replay_overflow" };
  }
  if (msg.type === "heartbeat") {
    return { kind: "heartbeat" };
  }
  if (
    msg.type === "marketplace_event" &&
    msg.payload &&
    typeof msg.payload === "object"
  ) {
    const inner = msg.payload as Record<string, unknown>;
    const seq =
      typeof msg.seq === "number"
        ? msg.seq
        : typeof inner.seq === "number"
          ? inner.seq
          : 0;
    const occurredAt =
      typeof msg.occurredAt === "string"
        ? msg.occurredAt
        : typeof inner.occurredAt === "string"
          ? inner.occurredAt
          : new Date().toISOString();
    return {
      kind: "event",
      envelope: {
        seq,
        type: "marketplace_event",
        occurredAt,
        payload: inner,
      },
    };
  }
  if (typeof msg.type === "string" && typeof msg.seq === "number") {
    return {
      kind: "event",
      envelope: {
        seq: msg.seq,
        type: msg.type,
        occurredAt:
          typeof msg.occurredAt === "string"
            ? msg.occurredAt
            : new Date().toISOString(),
        payload: msg.payload,
      },
    };
  }
  return { kind: "ignore" };
}
