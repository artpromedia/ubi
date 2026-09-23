/**
 * The model tool-calling protocol on the wire (recheck A04).
 *
 * Every test here drives the REAL loop through the REAL OpenAI-compatible HTTP
 * provider against a local server that records each request body exactly as it
 * arrived and plays back scripted model replies (tests/openai-stub.ts). The
 * assertions are on those captured outbound bodies:
 *
 *   - an assistant turn that asked for tools is replayed as ONE assistant record
 *     with the complete `tool_calls` array (id, type, wire name, the argument
 *     bytes exactly as the model emitted them), never as fabricated prose;
 *   - it is followed by one `tool` message per call, in call order, whose
 *     `tool_call_id` is that call's id — including calls that were rejected,
 *     malformed, schema-invalid or failed, so the model can recover;
 *   - the transcript only ever grows by appending, round after round;
 *   - bounds hold: max rounds, max calls per round, timeouts, and a response
 *     from a model other than the attested one is never acted on.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { ContractError } from "@ubi/contracts";

import { runTurn, MAX_TOOL_CALLS_PER_ROUND } from "../src/ai/loop";
import {
  fromWireToolName,
  parseOpenAiCompletion,
  toWireToolName,
  type ModelProvider,
} from "../src/ai/model-provider";
import { FORBIDDEN_CAPABILITIES, toolsForRole } from "../src/ai/tools";
import { handleMessage, openThread } from "../src/ops/threads";
import {
  closeTestDb,
  FakeRidePort,
  FakeTravelPort,
  makeDeps,
  rider,
  seedCity,
  testDb,
  uid,
  type TestDeps,
} from "./helpers";
import {
  completion,
  expectValidToolTranscript,
  matchingAttestation,
  SERVED_MODEL,
  startOpenAiStub,
  stubProvider,
  wireToolCall,
  type ChatBody,
  type OpenAiStub,
} from "./openai-stub";

import type { Actor } from "../src/ops/types";

let stub: OpenAiStub;
let cityId: string;
let actor: Actor;

beforeAll(async () => {
  stub = await startOpenAiStub({ attestation: matchingAttestation() });
  cityId = await seedCity(testDb());
});

afterAll(async () => {
  await stub.close();
  await closeTestDb();
});

beforeEach(() => {
  actor = rider();
});

afterEach(() => {
  stub.requests.length = 0;
});

/** A ride port whose status lookup fails like an upstream timeout. */
class FailingStatusRidePort extends FakeRidePort {
  override async status(): Promise<never> {
    throw new Error("upstream timeout");
  }
}

function depsWith(provider: ModelProvider, maxToolLoops?: number): TestDeps {
  const travel = new FakeTravelPort();
  travel.searchResults = [
    {
      offerRef: "off_los_acc",
      kind: "flight",
      title: "LOS → ACC 08:10",
      subtitle: null,
      priceMinor: 4_500_000,
      currency: "NGN",
      quotedAt: new Date().toISOString(),
      warnings: [],
    },
  ];
  return makeDeps(testDb(), {
    model: provider,
    travel,
    ride: new FailingStatusRidePort(),
    limits: maxToolLoops === undefined ? {} : { maxToolLoops },
  });
}

async function turn(deps: TestDeps, userText: string) {
  return runTurn(deps, {
    actor,
    role: "rider",
    actorKind: "rider",
    cityId,
    threadId: uid("thr"),
    history: [],
    userText,
  });
}

function messagesOf(body: ChatBody | undefined): Record<string, unknown>[] {
  return [...(body?.messages ?? [])];
}

describe("multi-round tool transcript (captured requests)", () => {
  // The exact argument bytes a model emitted — odd spacing, key order and
  // non-ASCII included. They must come back byte-for-byte.
  const QUOTE_ARGS = '{"pickupRef": "place_home" ,  "dropoffRef":"place_work"}';
  const FLIGHT_ARGS =
    '{"passengers":1,"origin":"LOS","destination":"ACC","departDate":"2026-10-01"}';
  const POLICY_ARGS = '{"query":"refunds on a flight — réservation annulée"}';

  it("replays complete tool_calls and matching tool results over three rounds", async () => {
    stub.setCompletions([
      completion({
        content: null,
        tool_calls: [
          wireToolCall("chatcmpl-tool-11aa", "ride__quote", QUOTE_ARGS),
          wireToolCall("chatcmpl-tool-22bb", "flight__search", FLIGHT_ARGS),
        ],
      }),
      completion({
        content: "Let me check the refund policy as well.",
        tool_calls: [
          wireToolCall("chatcmpl-tool-33cc", "support__policy", POLICY_ARGS),
        ],
      }),
      completion({ content: "Here is your ride quote and one flight." }),
    ]);
    const provider = stubProvider(stub);
    const deps = depsWith(provider);
    const thread = await openThread(deps, {
      actor,
      cityId,
      source: "home",
      correlationId: null,
    });

    const result = await handleMessage(deps, {
      actor,
      cityId,
      threadId: thread.id,
      text: "Quote me a ride to work and find a flight to Accra on 1 October",
      clarifications: null,
      correlationId: null,
    });

    const bodies = stub.chatBodies();
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body.model).toBe(SERVED_MODEL);
      expect(body.tool_choice).toBe("auto");
      expectValidToolTranscript(body);
      // Every declared tool name fits the OpenAI function-name grammar.
      for (const tool of body.tools ?? []) {
        expect(tool.function.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      }
    }
    // Nothing is fabricated in place of a protocol record, in any request.
    for (const request of stub.completions()) {
      expect(request.rawBody).not.toContain("(calling");
    }

    const round1 = messagesOf(bodies[0]);
    expect(round1).toHaveLength(2);
    expect(round1[0]?.role).toBe("system");
    expect(round1[1]).toEqual({
      role: "user",
      content:
        "Quote me a ride to work and find a flight to Accra on 1 October",
    });

    // Round 2: the assistant record with BOTH calls, then both results in order.
    const round2 = messagesOf(bodies[1]);
    expect(round2.slice(0, 2)).toEqual(round1);
    expect(round2.slice(2)).toEqual([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "chatcmpl-tool-11aa",
            type: "function",
            function: { name: "ride__quote", arguments: QUOTE_ARGS },
          },
          {
            id: "chatcmpl-tool-22bb",
            type: "function",
            function: { name: "flight__search", arguments: FLIGHT_ARGS },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "chatcmpl-tool-11aa",
        content: expect.stringContaining("LIVE PRICE") as unknown,
      },
      {
        role: "tool",
        tool_call_id: "chatcmpl-tool-22bb",
        content: expect.stringContaining("off_los_acc") as unknown,
      },
    ]);
    // Byte-for-byte: the escaped argument strings appear verbatim on the wire.
    const raw2 = stub.completions()[1]?.rawBody ?? "";
    expect(raw2).toContain(JSON.stringify(QUOTE_ARGS));
    expect(raw2).toContain(JSON.stringify(FLIGHT_ARGS));

    // Round 3: append-only — round 2's transcript, then the text+call turn.
    const round3 = messagesOf(bodies[2]);
    expect(round3.slice(0, round2.length)).toEqual(round2);
    expect(round3.slice(round2.length)).toEqual([
      {
        role: "assistant",
        content: "Let me check the refund policy as well.",
        tool_calls: [
          {
            id: "chatcmpl-tool-33cc",
            type: "function",
            function: { name: "support__policy", arguments: POLICY_ARGS },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "chatcmpl-tool-33cc",
        content: expect.stringContaining("Policy passages") as unknown,
      },
    ]);
    expect(stub.completions()[2]?.rawBody).toContain(
      JSON.stringify(POLICY_ARGS),
    );

    // The turn produced the cards and the final answer.
    expect(result.events.some((e) => e.type === "card")).toBe(true);
    const assistant = await deps.db.askMessage.findFirst({
      where: { threadId: thread.id, sender: "assistant" },
    });
    expect(assistant?.redactedText).toBe(
      "Here is your ride quote and one flight.",
    );

    // Every audit row names the ATTESTED serving identity, not a config string.
    const rows = await deps.db.aiAction.findMany({
      where: { threadId: thread.id, action: { not: "thread.opened" } },
      orderBy: { at: "asc" },
    });
    expect(rows.map((row) => [row.action, row.tool])).toEqual([
      ["tool.call", "ride.quote"],
      ["tool.call", "flight.search"],
      ["tool.call", "support.policy"],
      ["assistant.answer", null],
    ]);
    const attested = provider.lastAttestation?.();
    expect(attested?.ok).toBe(true);
    for (const row of rows) {
      expect(row.model).toBe(SERVED_MODEL);
      expect(row.modelRevision).toBe(attested?.auditRevision);
      expect(row.modelRevision).toMatch(/^2507\+att\.[0-9a-f]{16}$/);
    }
  });

  it("answers rejected, malformed, invalid and failed calls as tool results in order", async () => {
    const MALFORMED = '{"pickupRef": "home", "dropoffRef": ';
    const EXTRA_KEY =
      '{"pickupRef":"home","dropoffRef":"work","overridePriceMinor":1}';
    const GOOD = '{"pickupRef":"home","dropoffRef":"work"}';
    stub.setCompletions([
      completion({
        content: "Working on it.",
        tool_calls: [
          wireToolCall("c1", "wallet__drain", '{"all":true}'),
          wireToolCall(
            "c2",
            "driver__incentive__explain",
            '{"postingId":"p1"}',
          ),
          wireToolCall("c3", "ride__quote", MALFORMED),
          wireToolCall("c4", "ride__quote", EXTRA_KEY),
          wireToolCall("c5", "ride__status", '{"tripId":"trip_1"}'),
          wireToolCall("c6", "ride__quote", GOOD),
        ],
      }),
      completion({ content: "One quote worked; the rest did not." }),
    ]);
    const deps = depsWith(stubProvider(stub));

    const result = await turn(deps, "do several things");

    const [, second] = stub.chatBodies();
    expect(second).toBeDefined();
    expectValidToolTranscript(second as ChatBody);
    const tail = messagesOf(second).slice(2);
    const assistant = tail[0] as {
      content: string;
      tool_calls: {
        id: string;
        function: { name: string; arguments: string };
      }[];
    };
    expect(assistant.content).toBe("Working on it.");
    expect(assistant.tool_calls.map((c) => c.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
    ]);
    expect(assistant.tool_calls.map((c) => c.function.arguments)).toEqual([
      '{"all":true}',
      '{"postingId":"p1"}',
      // Unparseable arguments are replayed as "{}" (vLLM json.loads() every
      // replayed argument string); the tool result says they were malformed.
      "{}",
      EXTRA_KEY,
      '{"tripId":"trip_1"}',
      GOOD,
    ]);

    const results = tail.slice(1) as {
      tool_call_id: string;
      content: string;
    }[];
    expect(results.map((r) => r.tool_call_id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
    ]);
    expect(results[0]?.content).toBe(
      "Tool wallet.drain is not available to you.",
    );
    expect(results[1]?.content).toBe(
      "Tool driver.incentive.explain is not available to you.",
    );
    expect(results[2]?.content).toContain(
      "were not valid JSON, so nothing ran",
    );
    expect(results[3]?.content).toContain(
      "Arguments rejected by the ride.quote schema",
    );
    expect(results[3]?.content).toContain(
      "unrecognized_keys overridePriceMinor",
    );
    expect(results[4]?.content).toBe(
      "Tool ride.status failed: upstream timeout",
    );
    expect(results[5]?.content).toContain("LIVE PRICE");

    expect(
      result.aiActions.map((a) => [
        a.action,
        a.tool ?? null,
        a.reasonCode ?? null,
      ]),
    ).toEqual([
      ["tool.rejected", "wallet.drain", "tool_not_available"],
      ["tool.rejected", "driver.incentive.explain", "tool_not_available"],
      ["tool.call", "ride.quote", "arguments_malformed"],
      ["tool.call", "ride.quote", "schema_rejected"],
      ["tool.call", "ride.status", "tool_failed"],
      ["tool.call", "ride.quote", null],
      ["assistant.answer", null, null],
    ]);
    expect(result.answerText).toBe("One quote worked; the rest did not.");
  });

  it("recovers a <tool_call> block the server's parser could not parse", async () => {
    stub.setCompletions([
      // vLLM's hermes parser returns the raw block as content on a JSON error.
      completion({
        content:
          'I will get a quote.\n<tool_call>\n{"name": "ride__quote", "arguments": {"pickupRef": "home" "dropoffRef": "work"}}\n</tool_call>',
      }),
      completion({
        content: null,
        tool_calls: [
          wireToolCall(
            "chatcmpl-tool-retry",
            "ride__quote",
            '{"pickupRef":"home","dropoffRef":"work"}',
          ),
        ],
      }),
      completion({ content: "Your ride is quoted." }),
    ]);
    const deps = depsWith(stubProvider(stub));

    const result = await turn(deps, "quote home to work");

    const bodies = stub.chatBodies();
    expect(bodies).toHaveLength(3);
    const tail = messagesOf(bodies[1]).slice(2) as {
      role: string;
      content: string | null;
      tool_call_id?: string;
      tool_calls?: {
        id: string;
        function: { name: string; arguments: string };
      }[];
    }[];
    expect(tail[0]?.content).toBe("I will get a quote.");
    expect(tail[0]?.tool_calls).toHaveLength(1);
    const recovered = tail[0]?.tool_calls?.[0];
    expect(recovered?.function).toEqual({
      name: "ride__quote",
      arguments: "{}",
    });
    expect(tail[1]?.tool_call_id).toBe(recovered?.id);
    expect(tail[1]?.content).toContain("not valid JSON");
    for (const body of bodies) {
      expectValidToolTranscript(body);
    }
    // Nothing ran from the unparsed block; the retried call did.
    expect(result.aiActions.map((a) => a.reasonCode ?? null)).toEqual([
      "arguments_malformed",
      null,
      null,
    ]);
    expect(result.answerText).toBe("Your ride is quoted.");
  });

  it("gives missing and repeated call ids unique ids that the results carry", async () => {
    stub.setCompletions([
      completion({
        tool_calls: [
          wireToolCall(
            undefined,
            "ride__quote",
            '{"pickupRef":"a","dropoffRef":"b"}',
          ),
          wireToolCall(
            "dup",
            "ride__quote",
            '{"pickupRef":"c","dropoffRef":"d"}',
          ),
          wireToolCall(
            "dup",
            "ride__quote",
            '{"pickupRef":"e","dropoffRef":"f"}',
          ),
        ],
      }),
      completion({
        // A server reusing an id from an earlier round.
        tool_calls: [
          wireToolCall(
            "dup",
            "ride__quote",
            '{"pickupRef":"g","dropoffRef":"h"}',
          ),
        ],
      }),
      completion({ content: "done" }),
    ]);
    const deps = depsWith(stubProvider(stub));

    await turn(deps, "quotes");

    const bodies = stub.chatBodies();
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expectValidToolTranscript(body);
    }
    const ids = messagesOf(bodies[2])
      .flatMap((m) => (m.tool_calls as { id: string }[] | undefined) ?? [])
      .map((call) => call.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(ids[1]).toBe("dup");
  });

  it("carries already-parsed and empty arguments as JSON strings", async () => {
    stub.setCompletions([
      completion({
        tool_calls: [
          // Some servers/proxies hand back parsed arguments or "".
          wireToolCall("p1", "ride__quote", {
            pickupRef: "a",
            dropoffRef: "b",
          }),
          wireToolCall("p2", "promotion__eligibility", ""),
        ],
      }),
      completion({ content: "ok" }),
    ]);
    const deps = depsWith(stubProvider(stub));

    const result = await turn(deps, "quote and promo");

    const calls = messagesOf(stub.chatBodies()[1])[2]?.tool_calls as {
      function: { arguments: string };
    }[];
    expect(calls.map((c) => c.function.arguments)).toEqual([
      '{"pickupRef":"a","dropoffRef":"b"}',
      "{}",
    ]);
    expect(result.aiActions.map((a) => a.outcome)).toEqual([
      "done",
      "done",
      "done",
    ]);
  });

  it("never replays model output that looks like an address verbatim", async () => {
    stub.setCompletions([
      completion({
        tool_calls: [
          wireToolCall(
            "s1",
            "support__policy",
            '{"query":"deliveries to 12 Allen Avenue after dark"}',
          ),
        ],
      }),
      completion({ content: "Here is the policy." }),
    ]);
    const deps = depsWith(stubProvider(stub));

    const result = await turn(deps, "delivery policy");

    const raw = stub.completions()[1]?.rawBody ?? "";
    expect(raw).not.toContain("12 Allen Avenue");
    expect(raw).toContain("address omitted");
    expectValidToolTranscript(stub.chatBodies()[1] as ChatBody);
    expect(result.answerText).toBe("Here is the policy.");
  });

  it("answers hallucinated prototype-key and sensitive-looking tool names, and redacted upstream errors, as tool results", async () => {
    class AddressLeakingRidePort extends FakeRidePort {
      override async status(): Promise<never> {
        throw new Error("upstream: trip at 12 Allen Avenue not found");
      }
    }
    stub.setCompletions([
      completion({
        tool_calls: [
          // Object.prototype members are not forbidden capabilities.
          wireToolCall("h1", "constructor", "{}"),
          wireToolCall("h2", "toString", "{}"),
          // A name that looks like an address is never replayed verbatim.
          wireToolCall("h3", "route to 12 Allen Avenue", "{}"),
          wireToolCall("h4", "ride__status", '{"tripId":"trip_1"}'),
        ],
      }),
      completion({ content: "Nothing I tried is available." }),
    ]);
    const deps = makeDeps(testDb(), {
      model: stubProvider(stub),
      ride: new AddressLeakingRidePort(),
    });

    const result = await turn(deps, "try things");

    // Not a (policy-less) refusal: the turn went on to a second round.
    expect(result.refused).toBeNull();
    expect(stub.completions()).toHaveLength(2);
    const second = stub.chatBodies()[1] as ChatBody;
    expectValidToolTranscript(second);
    const results = messagesOf(second)
      .slice(3)
      .map((m) => m.content as string);
    expect(results[0]).toBe("Tool constructor is not available to you.");
    expect(results[1]).toBe("Tool toString is not available to you.");
    expect(results[2]).toContain("is not available to you.");
    expect(results[3]).toContain("Tool ride.status failed: upstream:");
    const raw = stub.completions()[1]?.rawBody ?? "";
    expect(raw).not.toContain("12 Allen Avenue");
    expect(raw).toContain("address omitted");
    expect(
      result.aiActions.map((a) => [a.action, a.reasonCode ?? null]),
    ).toEqual([
      ["tool.rejected", "tool_not_available"],
      ["tool.rejected", "tool_not_available"],
      ["tool.rejected", "tool_not_available"],
      ["tool.call", "tool_failed"],
      ["assistant.answer", null],
    ]);
    // The audit row never records the sensitive-looking name either.
    expect(JSON.stringify(result.aiActions)).not.toContain("12 Allen Avenue");
    expect(result.answerText).toBe("Nothing I tried is available.");
  });
});

describe("bounds", () => {
  it("stops at the round limit with every request still a valid transcript", async () => {
    let n = 0;
    stub.setCompletions(() => {
      n += 1;
      return completion({
        tool_calls: [
          wireToolCall(
            `loop-${n}`,
            "ride__quote",
            '{"pickupRef":"a","dropoffRef":"b"}',
          ),
        ],
      });
    });
    const deps = depsWith(stubProvider(stub), 3);

    const result = await turn(deps, "loop forever");

    const bodies = stub.chatBodies();
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expectValidToolTranscript(body);
    }
    const lastCalls = messagesOf(bodies[2]).filter((m) => m.tool_calls);
    expect(lastCalls).toHaveLength(2);
    expect(result.aiActions.at(-1)).toMatchObject({
      action: "loop.exhausted",
      reasonCode: "loop_budget",
    });
  });

  it("runs at most MAX_TOOL_CALLS_PER_ROUND calls and replays only those", async () => {
    const calls = Array.from({ length: MAX_TOOL_CALLS_PER_ROUND + 2 }, (_, i) =>
      wireToolCall(
        `many-${i}`,
        "ride__quote",
        '{"pickupRef":"a","dropoffRef":"b"}',
      ),
    );
    stub.setCompletions([
      completion({ tool_calls: calls }),
      completion({ content: "ok" }),
    ]);
    const deps = depsWith(stubProvider(stub));

    const result = await turn(deps, "many");

    const second = stub.chatBodies()[1] as ChatBody;
    expectValidToolTranscript(second);
    const replayed = messagesOf(second)[2]?.tool_calls as { id: string }[];
    expect(replayed.map((c) => c.id)).toEqual(
      calls.slice(0, MAX_TOOL_CALLS_PER_ROUND).map((c) => c.id),
    );
    expect(result.aiActions[0]).toMatchObject({
      action: "tool.rejected",
      reasonCode: "tool_call_budget",
      redactedInputs: {
        requested: MAX_TOOL_CALLS_PER_ROUND + 2,
        run: MAX_TOOL_CALLS_PER_ROUND,
      },
    });
  });

  it("refuses a forbidden capability and ends the turn without another request", async () => {
    stub.setCompletions([
      completion({
        tool_calls: [
          wireToolCall(
            "f1",
            "ride__quote",
            '{"pickupRef":"a","dropoffRef":"b"}',
          ),
          wireToolCall(
            "f2",
            "wallet__transfer",
            '{"to":"someone","amountMinor":500000}',
          ),
        ],
      }),
    ]);
    const deps = depsWith(stubProvider(stub));

    const result = await turn(deps, "send money");

    expect(stub.completions()).toHaveLength(1);
    expect(result.refused?.policy).toBe("p2p_out_of_scope");
    expect(result.aiActions.at(-1)).toMatchObject({
      action: "tool.refused",
      tool: "wallet.transfer",
      authKind: "none",
    });
  });

  it("acts on nothing from a response naming a model other than the attested one", async () => {
    stub.setCompletions([
      completion(
        {
          tool_calls: [
            wireToolCall(
              "x1",
              "ride__quote",
              '{"pickupRef":"a","dropoffRef":"b"}',
            ),
          ],
        },
        { model: "some/other-model" },
      ),
    ]);
    const provider = stubProvider(stub);
    const deps = depsWith(provider);

    const error = await turn(deps, "quote").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ContractError);
    expect((error as ContractError).code).toBe("service_unavailable");
    expect((error as ContractError).details).toMatchObject({
      reason: "served_model_mismatch",
    });
    // The attestation was dropped: the next call re-checks the server first.
    const listingsBefore = stub.modelListings().length;
    stub.setCompletions([completion({ content: "hello" })]);
    await turn(deps, "hi");
    expect(stub.modelListings().length).toBe(listingsBefore + 1);
  });

  it("maps a refused request and a timeout to service_unavailable", async () => {
    stub.setCompletions([{ status: 400, json: { error: "bad request" } }]);
    const refused = await turn(depsWith(stubProvider(stub)), "x").catch(
      (e: unknown) => e,
    );
    expect(refused).toMatchObject({
      code: "service_unavailable",
      details: { status: 400 },
    });

    stub.setCompletions([{ delayMs: 400, ...completion({ content: "late" }) }]);
    const slow = await turn(
      depsWith(stubProvider(stub, { timeoutMs: 100 })),
      "x",
    ).catch((e: unknown) => e);
    expect(slow).toMatchObject({
      code: "service_unavailable",
      details: { reason: "timeout" },
    });
  });
});

describe("parser and wire names", () => {
  it("parses text alongside calls, content parts and odd tool_call entries", () => {
    const parsed = parseOpenAiCompletion({
      model: SERVED_MODEL,
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: [
              { type: "text", text: "Checking " },
              { type: "text", text: "now." },
            ],
            tool_calls: [
              {
                id: "a",
                type: "function",
                function: { name: "ride__quote", arguments: null },
              },
              { id: "b", type: "retrieval", function: { name: "ride__quote" } },
              "garbage",
            ],
          },
        },
      ],
      usage: { total_tokens: 42 },
    });
    expect(parsed.text).toBe("Checking now.");
    expect(parsed.servedModel).toBe(SERVED_MODEL);
    expect(parsed.finishReason).toBe("tool_calls");
    expect(parsed.usage.tokens).toBe(42);
    expect(parsed.toolCalls[0]).toMatchObject({
      id: "a",
      name: "ride.quote",
      arguments: {},
      rawArguments: "{}",
    });
    // A non-function call and a garbage entry are kept (to be answered) with no
    // runnable name; the garbage entry gets a synthetic id.
    expect(parsed.toolCalls[1]?.name).toBe("");
    expect(parsed.toolCalls[2]?.name).toBe("");
    expect(parsed.toolCalls[2]?.id).toMatch(/^call_/);
  });

  it("refuses a completion without choices", () => {
    expect(() => parseOpenAiCompletion({ model: SERVED_MODEL })).toThrow(
      ContractError,
    );
  });

  it("round-trips every tool and forbidden capability name through the wire encoding", () => {
    const names = [
      ...toolsForRole("rider").map((t) => t.name),
      ...toolsForRole("driver").map((t) => t.name),
      ...Object.keys(FORBIDDEN_CAPABILITIES),
    ];
    for (const name of names) {
      const wire = toWireToolName(name);
      expect(wire).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(fromWireToolName(wire)).toBe(name);
    }
  });
});
