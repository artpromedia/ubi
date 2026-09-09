/**
 * The bounded tool loop (rule #18).
 *
 * The loop is where the model's freedom ends and the server's authority begins.
 * On every round it:
 *   - redacts the outgoing context and ASSERTS nothing sensitive survived, so no
 *     card, PIN, document or precise address can reach the provider (rule #20);
 *   - runs at most `maxToolLoops` provider round-trips;
 *   - for each tool the model names: refuses forbidden capabilities outright and
 *     logs them; rejects unknown or role-forbidden tools; validates arguments
 *     against the tool's strict schema; and runs the tool with the actor from the
 *     gateway context — never from the arguments;
 *   - stops the turn when the model asks for clarification, proposes a
 *     transaction (which is only ever a review, never an execution) or answers.
 *
 * It returns a plain description of what happened. Persisting the assistant
 * message, the review and the ai_actions rows is the caller's single transaction.
 */
import { assertNoSensitive, redact } from "./redaction";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "./prompt";
import {
  FORBIDDEN_CAPABILITIES,
  toolByName,
  toolSpecsForRole,
  type AskToolContext,
  type ReviewProposal,
} from "./tools";

import type { AskEvent, Card, ClarifyField, Source } from "./events";
import type { ModelMessage } from "./model-provider";
import type { AskDeps } from "../ops/context";
import type { AiActionInput, ActorKind } from "../ops/audit";
import type { Actor, AskRole } from "../ops/types";

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
}

export interface TurnResult {
  /** Card and source events, in the order they were produced. */
  readonly events: readonly AskEvent[];
  readonly cards: readonly Card[];
  readonly sources: readonly Source[];
  readonly aiActions: readonly AiActionInput[];
  readonly answerText: string;
  readonly proposal: ReviewProposal | null;
  readonly refused: { readonly policy: string; readonly deepLink: string } | null;
  readonly clarify: readonly ClarifyField[] | null;
  readonly providerRefs: readonly string[];
  readonly usageTokens: number;
}

function toModelHistory(history: readonly StoredMessage[]): ModelMessage[] {
  return history
    .filter((message) => message.sender !== "system")
    .map((message) => ({
      role: message.sender === "assistant" ? "assistant" : "user",
      content: message.text,
    }));
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
  };
  const tools = toolSpecsForRole(input.role);
  const events: AskEvent[] = [];
  const cards: Card[] = [];
  const sources: Source[] = [];
  const aiActions: AiActionInput[] = [];
  const providerRefs: string[] = [];
  let usageTokens = 0;

  const messages: ModelMessage[] = [
    ...toModelHistory(input.history),
    { role: "user", content: redact(input.userText) },
  ];

  const base = {
    actorKind: input.actorKind,
    actorRef: input.actor.id,
    threadId: input.threadId,
    model: deps.model.model,
    modelRevision: deps.model.revision,
    promptVersion: PROMPT_VERSION,
  } as const;

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

    if (response.toolCalls.length === 0) {
      const answerText = response.text;
      aiActions.push({
        ...base,
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

    for (const call of response.toolCalls) {
      const forbidden = FORBIDDEN_CAPABILITIES[call.name];
      if (forbidden !== undefined) {
        aiActions.push({
          ...base,
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
      if (tool === undefined || !tool.roles.includes(input.role)) {
        aiActions.push({
          ...base,
          action: "tool.rejected",
          tool: call.name,
          authKind: "none",
          outcome: "blocked",
          reasonCode: "tool_not_available",
          redactedInputs: { tool: call.name },
        });
        messages.push({ role: "assistant", content: `(calling ${call.name})` });
        messages.push({
          role: "tool",
          toolName: call.name,
          toolCallId: call.id,
          content: `Tool ${call.name} is not available to you.`,
        });
        continue;
      }

      const parsed = tool.schema.safeParse(call.arguments);
      if (!parsed.success) {
        aiActions.push({
          ...base,
          action: "tool.call",
          tool: call.name,
          authKind: "read_only",
          outcome: "blocked",
          reasonCode: "schema_rejected",
          redactedInputs: { tool: call.name },
        });
        messages.push({ role: "assistant", content: `(calling ${call.name})` });
        messages.push({
          role: "tool",
          toolName: call.name,
          toolCallId: call.id,
          content: `Arguments rejected by the ${call.name} schema. Fix and retry.`,
        });
        continue;
      }

      let result;
      try {
        result = await tool.run(ctx, parsed.data);
      } catch (error) {
        aiActions.push({
          ...base,
          action: "tool.call",
          tool: call.name,
          authKind: "read_only",
          outcome: "error",
          reasonCode: "tool_failed",
          redactedInputs: { tool: call.name },
        });
        messages.push({ role: "assistant", content: `(calling ${call.name})` });
        messages.push({
          role: "tool",
          toolName: call.name,
          toolCallId: call.id,
          content:
            error instanceof Error
              ? `Tool ${call.name} failed: ${error.message}`
              : `Tool ${call.name} failed.`,
        });
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
        ...base,
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

      messages.push({ role: "assistant", content: `(calling ${call.name})` });
      messages.push({
        role: "tool",
        toolName: call.name,
        toolCallId: call.id,
        content: result.content,
      });
    }
  }

  aiActions.push({
    ...base,
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
