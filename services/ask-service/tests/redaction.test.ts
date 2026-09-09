/**
 * Redaction (rule #20): no card number, PIN, identity document or precise
 * address reaches the model provider — asserted against the exact requests the
 * provider was handed — and none is persisted in the message store either.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assertNoSensitive, findSensitive, redact } from "../src/ai/redaction";
import { handleMessage, openThread } from "../src/ops/threads";
import {
  closeTestDb,
  DeterministicModelProvider,
  makeDeps,
  rider,
  seedCity,
  testDb,
  type TestDeps,
} from "./helpers";

import type { Actor } from "../src/ops/types";

const PAN = "4111 1111 1111 1111";
const PAN_DIGITS = "4111111111111111";
const PIN = "4821";
const ADDRESS = "12 Bourdillon Road";

let deps: TestDeps;
let model: DeterministicModelProvider;
let cityId: string;
let actor: Actor;

beforeAll(async () => {
  const db = testDb();
  model = new DeterministicModelProvider();
  deps = makeDeps(db, { model });
  cityId = await seedCity(db);
  actor = rider();
});

afterAll(async () => {
  await closeTestDb();
});

describe("redaction unit", () => {
  it("rewrites card, pin and address spans", () => {
    const out = redact(`card ${PAN} pin ${PIN}, I live at ${ADDRESS}`);
    expect(out).not.toContain(PAN_DIGITS);
    expect(out).not.toContain(PAN);
    expect(out).not.toContain(`pin ${PIN}`);
    expect(out).not.toContain(ADDRESS);
  });

  it("assertNoSensitive throws on a residual card number", () => {
    expect(() => {
      assertNoSensitive({ note: `pay with ${PAN}` });
    }).toThrow();
    expect(findSensitive({ ok: "just a place name" })).toHaveLength(0);
  });
});

describe("nothing sensitive reaches the provider", () => {
  it("redacts the user message before the model sees it and before it is stored", async () => {
    const thread = await openThread(deps, {
      actor,
      cityId,
      source: "home",
      correlationId: null,
    });
    await handleMessage(deps, {
      actor,
      cityId,
      threadId: thread.id,
      text: `My card ${PAN} pin ${PIN}. I live at ${ADDRESS}. @tool support.policy {"query":"refunds"}`,
      clarifications: null,
      correlationId: null,
    });

    expect(model.requests.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(model.requests);
    expect(serialized).not.toContain(PAN_DIGITS);
    expect(serialized).not.toContain(PAN);
    expect(serialized).not.toContain(PIN);
    expect(serialized).not.toContain(ADDRESS);
    // The belt-and-suspenders guard would have thrown on any residue.
    for (const request of model.requests) {
      expect(
        findSensitive({ system: request.system, messages: request.messages }),
      ).toHaveLength(0);
    }

    const stored = await deps.db.askMessage.findMany({
      where: { threadId: thread.id, sender: "user" },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.redactedText ?? "").not.toContain(PAN_DIGITS);
    expect(stored[0]?.redactedText ?? "").not.toContain(ADDRESS);
  });
});
