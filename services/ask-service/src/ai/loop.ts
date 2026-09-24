/**
 * The bounded tool loop (rule #18).
 *
 * The loop is where the model's freedom ends and the server's authority begins.
 * On every round it:
 *   - redacts the outgoing context and ASSERTS nothing sensitive survived, so no
 *     card, PIN, document or precise address can reach the provider (rule #20);
 *   - runs at most `maxToolLoops` provider round-trips, and at most
 *     `MAX_TOOL_CALLS_PER_ROUND` tool calls from any one of them;
 *   - for each tool the model names: refuses forbidden capabilities outright and
 *     logs them; rejects unknown or role-forbidden tools; rejects arguments that
 *     are not JSON; validates arguments against the tool's strict schema; and
 *     runs the tool with the actor from the gateway context — never from the
 *     arguments;
 *   - stops the turn when the model asks for clarification, proposes a
 *     transaction (which is only ever a review, never an execution) or answers.
 *
 * The transcript it replays is the tool-calling protocol itself (recheck A04):
 * the assistant turn that asked for tools goes back as ONE assistant record with
 * its text and the complete list of calls (ids, names, the exact argument
 * bytes), followed by one tool result per call, in the same order, answering
 * that call's id — including the calls that were rejected, malformed or failed,
 * so the model can recover. Nothing is fabricated in their place.
 *
 * It returns a plain description of what happened. Persisting the assistant
 * message, the review and the ai_actions rows is the caller's single transaction.
 */
import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt";
import {
  assertNoSensitive,
  findSensitive,
  redact,
  redactValue,
} from "./redaction";
import {
  FORBIDDEN_CAPABILITIES,
  toolByName,
  toolSpecsForRole,
  type AskToolContext,
  type ReviewProposal,
} from "./tools";
import { generateId } from "../lib/ids";

import type { AskEvent, Card, ClarifyField, Source } from "./events";
import type { ModelMessage, ModelToolCall } from "./model-provider";
import type { AiActionInput, ActorKind } from "../ops/audit";
import type { AskDeps } from "../ops/context";
import type { Actor, AskRole } from "../ops/types";

/**
 * At most this many tool calls from one model turn are run. Calls beyond it are
 * left out of the replayed transcript entirely (so no call is left unanswered)
 * and logged once; the model may ask for them again on the next round.
 */
export const MAX_TOOL_CALLS_PER_ROUND = 8;

/** Call ids replayed to the model: the characters servers actually issue. */
const SAFE_CALL_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export interface StoredMessage {
  readonly sender: "user" | "assistant" | "system";
  readonly text: string;
}

export interface TurnInput {
  readonly actor: Actor;
  readonly role: AskRole;
  readonly actorKind: ActorKind;
  readonly cityId: string;
  readonly threadId: string;
  readonly history: readonly StoredMessage[];
  readonly userText: string;
  /** The gateway granted the marketplace scope (see AskToolContext). */
  readonly marketplaceAllowed: boolean;
}

export interface TurnResult {
  /** Card and source events, in the order they were produced. */
  readonly events: readonly AskEvent[];
  readonly cards: readonly Card[];
  readonly sources: readonly Source[];
  readonly aiActions: readonly AiActionInput[];
  readonly answerText: string;
  readonly proposal: ReviewProposal | null;
  readonly refused: {
    readonly policy: string;
    readonly deepLink: string;
  } | null;
  readonly clarify: readonly ClarifyField[] | null;
  readonly providerRefs: readonly string[];
  readonly usageTokens: number;
}

function toModelHistory(history: readonly StoredMessage[]): ModelMessage[] {
  return history
    .filter((message) => message.sender !== "system")
    .map((message) =>
      message.sender === "assistant"
        ? { role: "assistant" as const, content: message.text }
        : { role: "user" as const, content: message.text },
    );
}

/**
 * The call exactly as it will be recorded, replayed and run: a unique, plain id
 * (a missing, repeated or odd one is replaced), and — only if the model's output
 * looks like a card, PIN, document or address — a redacted name and redacted
 * arguments. The tool runs with the same arguments the transcript shows. (No
 * real tool name looks sensitive, so a redacted name never runs anything; it is
 * answered as an unavailable tool instead of tripping the backstop.)
 */
function recordableCall(
  call: ModelToolCall,
  usedIds: Set<string>,
): ModelToolCall {
  let id = call.id;
  if (
    !SAFE_CALL_ID.test(id) ||
    usedIds.has(id) ||
    findSensitive(id).length > 0
  ) {
    id = generateId("call");
  }
  usedIds.add(id);
  const name =
    findSensitive(call.name).length > 0 ? redact(call.name) : call.name;
  if (findSensitive([call.arguments, call.rawArguments ?? ""]).length === 0) {
    return id === call.id && name === call.name ? call : { ...call, id, name };
  }
  if (call.argumentsError !== undefined) {
    return {
      ...call,
      id,
      name,
      rawArguments: redact(call.rawArguments ?? ""),
    };
  }
  const safe = redactValue(call.arguments);
  return {
    ...call,
    id,
    name,
    arguments: safe,
    rawArguments: JSON.stringify(safe ?? {}),
  };
}

/**
 * The forbidden-capability entry for a name, by OWN key only: a hallucinated
 * name such as `constructor` or `toString` must not resolve to an
 * Object.prototype member and be mistaken for a (policy-less) refusal.
 */
function forbiddenCapability(
  name: string,
): { readonly policy: string; readonly deepLink: string } | undefined {
  return Object.hasOwn(FORBIDDEN_CAPABILITIES, name)
    ? FORBIDDEN_CAPABILITIES[name]
    : undefined;
}

/** Schema issues as paths and codes — never the rejected values themselves. */
function describeIssues(issues: readonly unknown[]): string {
  const parts = issues.slice(0, 6).map((raw) => {
    const issue = raw as {
      path?: readonly (string | number)[];
      code?: string;
      keys?: readonly string[];
    };
    const path =
      issue.path !== undefined && issue.path.length > 0
        ? issue.path.join(".")
        : "(arguments)";
    const keys =
      issue.code === "unrecognized_keys" && issue.keys !== undefined
        ? ` ${issue.keys.join(",")}`
        : "";
    return `${path}: ${issue.code ?? "invalid"}${keys}`;
  });
  return redact(parts.join("; ")).slice(0, 400);
}

export async function runTurn(
  deps: AskDeps,
  input: TurnInput,
): Promise<TurnResult> {
  const ctx: AskToolContext = {
    deps,
    actor: input.actor,
    cityId: input.cityId,
    threadId: input.threadId,
    marketplaceAllowed: input.marketplaceAllowed,
  };
  const tools = toolSpecsForRole(input.role);
  const events: AskEvent[] = [];
  const cards: Card[] = [];
  const sources: Source[] = [];
  const aiActions: AiActionInput[] = [];
  const providerRefs: string[] = [];
  const usedCallIds = new Set<string>();
  let usageTokens = 0;

  const messages: ModelMessage[] = [
    ...toModelHistory(input.history),
    { role: "user", content: redact(input.userText) },
  ];

  const base = {
    actorKind: input.actorKind,
    actorRef: input.actor.id,
    threadId: input.threadId,
    promptVersion: PROMPT_VERSION,
  } as const;
  // Each row records the identity that served the round it came from: the
  // attested serving identity when the provider attests (A05), otherwise the
  // configured model and label.
  let identity = {
    model: deps.model.model,
    modelRevision: deps.model.revision,
  };

  const maxLoops = deps.limits.maxToolLoops;
  for (let loop = 0; loop < maxLoops; loop += 1) {
    const request = {
      system: SYSTEM_PROMPT,
      messages,
      tools,
      toolChoice: "auto" as const,
      requestBudget: maxLoops - loop,
    };
    // Backstop: the exact object about to reach the provider must be clean.
    assertNoSensitive({ system: request.system, messages, tools });

    const startedAt = deps.now().getTime();
    const response = await deps.model.complete(request);
    const latencyMs = deps.now().getTime() - startedAt;
    usageTokens += response.usage.tokens;
    if (response.identity !== undefined) {
      identity = {
        model: response.identity.model,
        modelRevision: response.identity.revision,
      };
    }
    const audit = { ...base, ...identity };

    if (response.toolCalls.length === 0) {
      const answerText = response.text;
      aiActions.push({
        ...audit,
        action: "assistant.answer",
        authKind: "read_only",
        outcome: "done",
        tokens: response.usage.tokens,
        latencyMs,
        redactedInputs: { turn: loop },
      });
      return finalize(events, cards, sources, aiActions, providerRefs, {
        answerText,
        proposal: null,
        refused: null,
        clarify: null,
        usageTokens,
      });
    }

    const calls = response.toolCalls
      .slice(0, MAX_TOOL_CALLS_PER_ROUND)
      .map((call) => recordableCall(call, usedCallIds));
    if (response.toolCalls.length > MAX_TOOL_CALLS_PER_ROUND) {
      aiActions.push({
        ...audit,
        action: "tool.rejected",
        authKind: "none",
        outcome: "blocked",
        reasonCode: "tool_call_budget",
        redactedInputs: {
          requested: response.toolCalls.length,
          run: MAX_TOOL_CALLS_PER_ROUND,
        },
      });
    }
    // The assistant turn goes back as the protocol record it was: its text and
    // every call it made, before any of their results.
    messages.push({
      role: "assistant",
      content: redact(response.text),
      toolCalls: calls,
    });
    const answer = (call: ModelToolCall, content: string): void => {
      messages.push({
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        content,
      });
    };

    for (const call of calls) {
      const forbidden = forbiddenCapability(call.name);
      if (forbidden !== undefined) {
        aiActions.push({
          ...audit,
          action: "tool.refused",
          tool: call.name,
          authKind: "none",
          outcome: "refused",
          reasonCode: forbidden.policy,
          latencyMs,
          redactedInputs: { tool: call.name },
        });
        return finalize(events, cards, sources, aiActions, providerRefs, {
          answerText: "",
          proposal: null,
          refused: { policy: forbidden.policy, deepLink: forbidden.deepLink },
          clarify: null,
          usageTokens,
        });
      }

      const tool = toolByName(call.name);
      const available = tool !== undefined && tool.roles.includes(input.role);
      // A call whose arguments did not parse — to a tool the caller may use, or
      // an unparseable block with no name at all — is answered with an error the
      // model can recover from. Nothing runs.
      if (
        call.argumentsError !== undefined &&
        (available || call.name.length === 0)
      ) {
        aiActions.push({
          ...audit,
          action: "tool.call",
          tool: call.name.length > 0 ? call.name : null,
          authKind: "read_only",
          outcome: "blocked",
          reasonCode: "arguments_malformed",
          redactedInputs: { tool: call.name },
        });
        answer(
          call,
          call.name.length > 0
            ? `The arguments for ${call.name} were not valid JSON, so nothing ran. Call ${call.name} again with one JSON object that matches its schema.`
            : "That tool call could not be parsed, so nothing ran. Emit the call again with a tool name and one JSON object of arguments.",
        );
        continue;
      }

      if (tool === undefined || !available) {
        aiActions.push({
          ...audit,
          action: "tool.rejected",
          tool: call.name,
          authKind: "none",
          outcome: "blocked",
          reasonCode: "tool_not_available",
          redactedInputs: { tool: call.name },
        });
        answer(call, `Tool ${call.name} is not available to you.`);
        continue;
      }

      const parsed = tool.schema.safeParse(call.arguments);
      if (!parsed.success) {
        aiActions.push({
          ...audit,
          action: "tool.call",
          tool: call.name,
          authKind: "read_only",
          outcome: "blocked",
          reasonCode: "schema_rejected",
          redactedInputs: { tool: call.name },
        });
        answer(
          call,
          `Arguments rejected by the ${call.name} schema (${describeIssues(parsed.error.issues)}). Nothing ran; fix the arguments and call again.`,
        );
        continue;
      }

      let result;
      try {
        result = await tool.run(ctx, parsed.data);
      } catch (error) {
        aiActions.push({
          ...audit,
          action: "tool.call",
          tool: call.name,
          authKind: "read_only",
          outcome: "error",
          reasonCode: "tool_failed",
          redactedInputs: { tool: call.name },
        });
        // Upstream error text is not the model's to see verbatim: anything in
        // it that looks like a card, PIN, document or address is redacted, so a
        // failure is answered as a recoverable tool result instead of tripping
        // the backstop and failing the whole turn.
        answer(
          call,
          error instanceof Error
            ? `Tool ${call.name} failed: ${redact(error.message)}`
            : `Tool ${call.name} failed.`,
        );
        continue;
      }

      if (result.cards) {
        for (const card of result.cards) {
          cards.push(card);
          events.push({ type: "card", card });
        }
      }
      if (result.sources && result.sources.length > 0) {
        sources.push(...result.sources);
        events.push({ type: "sources", sources: result.sources });
      }
      if (result.providerRefs) {
        providerRefs.push(...result.providerRefs);
      }

      aiActions.push({
        ...audit,
        action: "tool.call",
        tool: call.name,
        authKind: "read_only",
        outcome: result.ownershipDenied ? "blocked" : "done",
        reasonCode: result.ownershipDenied ? "ownership_denied" : null,
        providerRefs: result.providerRefs ?? [],
        redactedInputs: { tool: call.name, argKeys: argKeysOf(parsed.data) },
      });

      if (result.clarify && result.clarify.length > 0) {
        return finalize(events, cards, sources, aiActions, providerRefs, {
          answerText: "",
          proposal: null,
          refused: null,
          clarify: result.clarify,
          usageTokens,
        });
      }
      if (result.proposal) {
        return finalize(events, cards, sources, aiActions, providerRefs, {
          answerText: "",
          proposal: result.proposal,
          refused: null,
          clarify: null,
          usageTokens,
        });
      }

      answer(call, result.content);
    }
  }

  aiActions.push({
    ...base,
    ...identity,
    action: "loop.exhausted",
    authKind: "read_only",
    outcome: "partial",
    reasonCode: "loop_budget",
    redactedInputs: { maxLoops },
  });
  return finalize(events, cards, sources, aiActions, providerRefs, {
    answerText:
      "I could not finish that within the allowed number of steps. You can try rephrasing or use the conventional flow.",
    proposal: null,
    refused: null,
    clarify: null,
    usageTokens,
  });
}

function argKeysOf(value: unknown): readonly string[] {
  return typeof value === "object" && value !== null ? Object.keys(value) : [];
}

function finalize(
  events: readonly AskEvent[],
  cards: readonly Card[],
  sources: readonly Source[],
  aiActions: readonly AiActionInput[],
  providerRefs: readonly string[],
  rest: {
    answerText: string;
    proposal: ReviewProposal | null;
    refused: { policy: string; deepLink: string } | null;
    clarify: readonly ClarifyField[] | null;
    usageTokens: number;
  },
): TurnResult {
  return { events, cards, sources, aiActions, providerRefs, ...rest };
}
