/**
 * Passenger trip-link SMS deliverer — unit tests through in-memory ports
 * (the Redis-backed ports and the real pattern subscription are exercised in
 * consumer.test.ts). The SMS provider is a fake that records what it was
 * asked to send.
 */
/* eslint-disable require-await, @typescript-eslint/require-await -- async port fakes intentionally have no awaits */
import { describe, expect, it } from "vitest";

import {
  TripAccessSmsDeliverer,
  fillSmsTemplate,
  type TripAccessDeadLetter,
  type TripAccessFinal,
  type TripAccessSmsPorts,
} from "./deliverer.js";
import { loadTripAccessKeyRing, type TripAccessKeyRing } from "./sealed.js";
import {
  GUEST_SMS_TEMPLATE,
  issuedEnvelope,
  randomKeyBase64,
} from "../test-support/trip-access.js";

import type { SmsSendResult } from "../providers/sms.js";
import type { EventEnvelope } from "@ubi/contracts";

const KEY = randomKeyBase64();
const KID = "k-2026-09";
const PHONE = "+2348031234567";
const TOKEN = "uta_Q2hpbmVkdS1sb25nLXRva2VuLXZhbHVlLTEyMzQ1Njc4";
const LINK_BASE = "https://ride.ubi.africa/trip";

function keys(): TripAccessKeyRing {
  const result = loadTripAccessKeyRing({
    TRIP_ACCESS_DELIVERY_KEY: KEY,
    TRIP_ACCESS_DELIVERY_KID: KID,
  });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.ring;
}

interface LogLine {
  level: string;
  obj: unknown;
  msg?: string;
}

function harness(
  cfg: {
    results?: SmsSendResult[]; // consumed in order; last one repeats
    throwOnSend?: Error;
    maxAttempts?: number;
    now?: Date;
  } = {},
) {
  const sent: { to: string; message: string }[] = [];
  const deadLetters: TripAccessDeadLetter[] = [];
  const claims = new Map<string, string>();
  const revoked = new Set<string>();
  const logs: LogLine[] = [];
  let sendIdx = 0;
  const log =
    (level: string) =>
    (obj: unknown, msg?: string): void => {
      logs.push({ level, obj, msg });
    };

  const ports: TripAccessSmsPorts = {
    keys: keys(),
    linkBaseUrl: LINK_BASE,
    sms: {
      send: async (to, message) => {
        sent.push({ to, message });
        if (cfg.throwOnSend) {
          throw cfg.throwOnSend;
        }
        const results = cfg.results ?? [
          { success: true, messageId: "SM1", provider: "fake" },
        ];
        const r = results[Math.min(sendIdx, results.length - 1)];
        sendIdx += 1;
        return r ?? { success: true };
      },
    },
    state: {
      claim: async (tokenId) => {
        if (claims.has(tokenId)) {
          return false;
        }
        claims.set(tokenId, "pending");
        return true;
      },
      finish: async (tokenId, outcome: TripAccessFinal) => {
        claims.set(tokenId, outcome);
      },
      markRevoked: async (tokenId) => {
        revoked.add(tokenId);
      },
      isRevoked: async (tokenId) => revoked.has(tokenId),
    },
    deadLetters: {
      record: async (entry) => {
        deadLetters.push(entry);
      },
    },
    logger: {
      debug: log("debug"),
      info: log("info"),
      warn: log("warn"),
      error: log("error"),
    },
    now: () => cfg.now ?? new Date("2026-09-23T10:00:00Z"),
    maxAttempts: cfg.maxAttempts ?? 3,
    backoff: { baseMs: 1, maxMs: 2 },
    delay: async () => {},
  };
  return {
    deliverer: new TripAccessSmsDeliverer(ports),
    sent,
    deadLetters,
    claims,
    logs,
  };
}

function envelope(
  overrides: Partial<Parameters<typeof issuedEnvelope>[0]> = {},
): EventEnvelope {
  return issuedEnvelope({
    keyBase64: KEY,
    kid: KID,
    tokenId: "tac_1",
    phone: PHONE,
    token: TOKEN,
    firstName: "Ada",
    ...overrides,
  });
}

/** Everything that left the deliverer other than the SMS itself. */
function observable(h: ReturnType<typeof harness>): string {
  return JSON.stringify({ logs: h.logs, deadLetters: h.deadLetters });
}

function expectNoSecrets(h: ReturnType<typeof harness>): void {
  const text = observable(h);
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(PHONE);
  expect(text).not.toContain(PHONE.slice(1)); // without the "+"
}

describe("TripAccessSmsDeliverer", () => {
  it("sends ONE SMS to the sealed phone, with the template filled and the token in the URL fragment", async () => {
    const h = harness();
    const res = await h.deliverer.handle(envelope());

    expect(res.outcome).toBe("sent");
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]?.to).toBe(PHONE);
    expect(h.sent[0]?.message).toBe(
      GUEST_SMS_TEMPLATE.replace("{firstName}", "Ada").replace(
        "{link}",
        `${LINK_BASE}#t=${TOKEN}`,
      ),
    );
    expect(h.sent[0]?.message).not.toContain("{link}");
    expect(h.sent[0]?.message).not.toContain("{firstName}");
    expect(h.claims.get("tac_1")).toBe("sent");
    expectNoSecrets(h);
    // The success line carries the MASKED phone for support correlation.
    expect(observable(h)).toContain("+234********67");
  });

  it("fills placeholders in one pass: a name cannot inject the link twice", () => {
    const message = fillSmsTemplate("Hi {firstName}: {link}", {
      firstName: "{link}",
      link: "https://x#t=abc",
    });
    expect(message).toBe("Hi {link}: https://x#t=abc");
  });

  it("strips control characters from the passenger's first name", async () => {
    const h = harness();
    await h.deliverer.handle(envelope({ firstName: "Ada\u0007\u001b[31m" }));
    expect(h.sent[0]?.message.startsWith("Ada[31m, a UBI rider")).toBe(true);
  });

  it("is idempotent by tokenId: a redelivery (same or new event id) never sends twice", async () => {
    const h = harness();
    const first = envelope({ eventId: "evt_a" });
    expect((await h.deliverer.handle(first)).outcome).toBe("sent");
    expect((await h.deliverer.handle(first)).outcome).toBe("deduped");
    expect(
      (await h.deliverer.handle(envelope({ eventId: "evt_b" }))).outcome,
    ).toBe("deduped");
    expect(h.sent).toHaveLength(1);
  });

  it("dead-letters a permanent provider failure at once (no retry), masked", async () => {
    const h = harness({
      results: [
        {
          success: false,
          permanent: true,
          provider: "twilio",
          error: `The 'To' number ${PHONE} is not a valid phone number.`,
        },
      ],
    });
    const res = await h.deliverer.handle(envelope());

    expect(res.outcome).toBe("dead_lettered");
    expect(h.sent).toHaveLength(1);
    expect(h.deadLetters).toHaveLength(1);
    const dlq = h.deadLetters[0];
    expect(dlq?.reason.startsWith("permanent_failure:")).toBe(true);
    expect(dlq?.reason).toContain("[redacted]");
    expect(dlq?.maskedPhone).toBe("+234********67");
    expect(dlq?.tokenId).toBe("tac_1");
    // The envelope stays sealed: replayable with the key, opaque without.
    expect(dlq?.sealed?.kid).toBe(KID);
    expect(h.claims.get("tac_1")).toBe("dead");
    expectNoSecrets(h);
  });

  it("retries a transient failure with backoff, then dead-letters after exhausted attempts", async () => {
    const h = harness({
      results: [{ success: false, error: "503 upstream unavailable" }],
      maxAttempts: 3,
    });
    const res = await h.deliverer.handle(envelope());
    expect(res.outcome).toBe("dead_lettered");
    expect(res.attempts).toBe(3);
    expect(h.sent).toHaveLength(3);
    expect(h.deadLetters[0]?.reason).toBe(
      "retries_exhausted: 503 upstream unavailable",
    );
    expectNoSecrets(h);
  });

  it("recovers when a retry succeeds", async () => {
    const h = harness({
      results: [{ success: false, error: "timeout" }, { success: true }],
    });
    const res = await h.deliverer.handle(envelope());
    expect(res.outcome).toBe("sent");
    expect(res.attempts).toBe(2);
    expect(h.deadLetters).toHaveLength(0);
  });

  it("scrubs a thrown provider error that echoes the phone and token", async () => {
    const h = harness({
      throwOnSend: new Error(
        `socket closed while sending ${TOKEN} to ${PHONE}`,
      ),
      maxAttempts: 2,
    });
    const res = await h.deliverer.handle(envelope());
    expect(res.outcome).toBe("dead_lettered");
    expectNoSecrets(h);
  });

  it("refuses a legacy payload with the token/phone/name in clear — nothing sent, values never logged", async () => {
    const h = harness();
    const res = await h.deliverer.handle(
      envelope({
        extraPayload: {
          accessToken: TOKEN,
          recipient: { channel: "sms", phone: PHONE, firstName: "Ada" },
        },
      }),
    );
    expect(res.outcome).toBe("dead_lettered");
    expect(h.sent).toHaveLength(0);
    expect(h.deadLetters[0]?.reason).toContain("payload_invalid");
    expect(h.deadLetters[0]?.reason).toContain("accessToken");
    expectNoSecrets(h);
  });

  it("refuses an envelope that does not authenticate (wrong key) and dead-letters it", async () => {
    const h = harness();
    const res = await h.deliverer.handle(
      envelope({ keyBase64: randomKeyBase64() }),
    );
    expect(res.outcome).toBe("dead_lettered");
    expect(h.sent).toHaveLength(0);
    expect(h.deadLetters[0]?.reason).toBe("open_failed: auth_failed");
    expectNoSecrets(h);
  });

  it("refuses an envelope whose tokenId is not the event's aggregate id", async () => {
    const h = harness();
    const env = envelope();
    const res = await h.deliverer.handle({
      ...env,
      subject: { type: "trip_access", id: "tac_other" },
    });
    expect(res.outcome).toBe("dead_lettered");
    expect(h.deadLetters[0]?.reason).toBe("token_id_mismatch");
    expect(h.sent).toHaveLength(0);
  });

  it("never sends a link revoked before its SMS went out", async () => {
    const h = harness();
    await h.deliverer.handle({
      ...envelope(),
      id: "evt_rev",
      name: "trip_access.revoked",
      payload: { tokenId: "tac_1", requestId: "r", reason: "replaced" },
    });
    const res = await h.deliverer.handle(envelope());
    expect(res.outcome).toBe("suppressed_revoked");
    expect(h.sent).toHaveLength(0);
  });

  it("does not send an already-expired link", async () => {
    const h = harness({ now: new Date("2026-09-23T12:00:00Z") });
    const res = await h.deliverer.handle(
      envelope({ expiresAt: "2026-09-23T11:59:59Z" }),
    );
    expect(res.outcome).toBe("skipped_expired");
    expect(h.sent).toHaveLength(0);
  });

  it("ignores trip_access.declined (the requester's push handles it)", async () => {
    const h = harness();
    const res = await h.deliverer.handle({
      ...envelope(),
      name: "trip_access.declined",
      payload: { tokenId: "tac_1", requesterId: "u", feeMinor: 0 },
    });
    expect(res.outcome).toBe("skipped_event");
    expect(h.sent).toHaveLength(0);
  });
});
