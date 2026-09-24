/**
 * The model provider.
 *
 * The assistant is backed by a privately served instruction model — the pinned
 * candidate is `Qwen/Qwen3-30B-A3B-Instruct-2507`, served behind vLLM or SGLang
 * (both expose an OpenAI-compatible chat API). This module defines the interface
 * the tool loop depends on and a real HTTP adapter for that endpoint. It is
 * pinned to a *serving identity*, not to a proprietary inference SDK: the adapter
 * is a plain fetch against an OpenAI-shaped `/chat/completions`, so the same code
 * runs against vLLM, SGLang or any compatible server.
 *
 * Wire protocol (OpenAI Chat Completions tool calling — recheck A04). An
 * assistant turn that requested tools goes back on the next round as
 * `role: "assistant"` carrying the COMPLETE `tool_calls` array (id,
 * `type: "function"`, `function.name`, `function.arguments` as the exact JSON
 * string the model emitted), followed by one `role: "tool"` message per call, in
 * the same order, whose `tool_call_id` is that call's id. Nothing is fabricated
 * in place of those records. Order matters beyond the ids: Qwen's chat template
 * renders tool results as positional `<tool_response>` blocks.
 *
 * Tool names are encoded for the wire (`ride.quote` ⇄ `ride__quote`) because the
 * OpenAI function-name grammar is `[A-Za-z0-9_-]{1,64}`; the loop, the tools and
 * the audit log only ever see canonical names.
 *
 * Serving identity (A05). Before any completion the adapter checks the deployed
 * server against the pinned identity (./attestation.ts) and refuses to run the
 * model unattested; every response must also name the pinned served model. The
 * attested identity rides back on each response for the audit row.
 *
 * LIVE SERVING IS EXTERNALLY BLOCKED here (no GPU, no weights). Tests drive this
 * adapter against a local HTTP stand-in for the model server (the serializer and
 * parser under test are this code), and the evaluation harness in
 * tests/eval/model-eval.ts runs against a deployed server. When the endpoint is
 * absent, unreachable or unattested the adapter raises `service_unavailable` and
 * the caller falls back to the conventional flow (rule #18).
 *
 * The provider is given *tools*, not permissions. It can only propose a tool and
 * arguments; whether that tool may run, and as whom, is decided entirely by the
 * server from the gateway identity — never by anything the model returns.
 */
import { ContractError } from "@ubi/contracts";

import {
  attestServing,
  type ModelAttestation,
  type ModelServingConfig,
} from "./attestation";
import { generateId } from "../lib/ids";
import { modelLogger } from "../lib/logger";

/** A JSON-schema description of a tool's arguments (draft-07 object schema). */
export interface ToolSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolSchema;
}

export type ModelRole = "user" | "assistant" | "tool";

export interface ModelToolCall {
  /** The call id the server issued. Exactly one tool result answers it. */
  readonly id: string;
  /** The tool's canonical (server-side) name, e.g. `ride.quote`. */
  readonly name: string;
  /**
   * Parsed arguments, validated by the tool's schema before anything runs.
   * `undefined` when `argumentsError` is set.
   */
  readonly arguments: unknown;
  /**
   * The arguments exactly as the model emitted them (a JSON string), echoed back
   * byte-for-byte on the next round. Absent for in-process providers, whose
   * arguments are serialized from `arguments`.
   */
  readonly rawArguments?: string;
  /** The model's arguments were not valid JSON; the loop answers with an error. */
  readonly argumentsError?: "malformed_json";
}

export interface ModelUserMessage {
  readonly role: "user";
  readonly content: string;
}

export interface ModelAssistantMessage {
  readonly role: "assistant";
  /** Visible assistant text; may be empty on a turn that only called tools. */
  readonly content: string;
  /** The complete tool-call records of this turn, in the model's order. */
  readonly toolCalls?: readonly ModelToolCall[];
}

export interface ModelToolMessage {
  readonly role: "tool";
  /** The id of the assistant tool call this result answers. */
  readonly toolCallId: string;
  /** Which tool produced this content (canonical name). */
  readonly toolName: string;
  readonly content: string;
}

export type ModelMessage =
  | ModelUserMessage
  | ModelAssistantMessage
  | ModelToolMessage;

export interface ModelRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
  readonly toolChoice?: "auto" | "none" | "required";
  readonly maxTokens?: number;
  /** Hard cap on provider round-trips for this turn (rule #18 — bounded loop). */
  readonly requestBudget?: number;
}

export interface ModelUsage {
  readonly tokens: number;
  readonly costMinor?: number;
  readonly currency?: string;
}

/** Which serving identity produced a response — what the audit row records. */
export interface ModelIdentity {
  readonly model: string;
  readonly revision: string;
}

export interface ModelResponse {
  /** Assistant text. May accompany tool calls. */
  readonly text: string;
  /** Tool calls the model wants run before it can answer. May be empty. */
  readonly toolCalls: readonly ModelToolCall[];
  readonly usage: ModelUsage;
  /** The attested identity that served this response, when the provider attests. */
  readonly identity?: ModelIdentity;
}

export interface ModelProvider {
  /** The configured model (Hugging Face id). */
  readonly model: string;
  /** The human-readable revision label. Not evidence of what is served. */
  readonly revision: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
  /**
   * Checks the serving endpoint against the pinned identity (cached for a short
   * TTL; `force` re-checks). In-process providers have no endpoint and omit it.
   */
  attest?(options?: { readonly force?: boolean }): Promise<ModelAttestation>;
  /** The latest attestation without any network call; null before the first. */
  lastAttestation?(): ModelAttestation | null;
}

// ---------------------------------------------------------------------------
// Wire names
// ---------------------------------------------------------------------------

/** `ride.quote` → `ride__quote` (OpenAI names allow only [A-Za-z0-9_-]). */
export function toWireToolName(name: string): string {
  return name.replaceAll(".", "__");
}

/** `ride__quote` → `ride.quote`. Inverse of `toWireToolName` for every tool name. */
export function fromWireToolName(wireName: string): string {
  return wireName.replaceAll("__", ".");
}

// ---------------------------------------------------------------------------
// Transcript invariant + serializer (OpenAI-compatible)
// ---------------------------------------------------------------------------

/**
 * Throws if the transcript is not a valid tool-calling conversation: every
 * assistant tool call must be answered, immediately and in order, by exactly one
 * tool message carrying its id; no tool message may exist without such a call;
 * no id may repeat. A violation is a server defect, never a model outcome, so it
 * fails loudly instead of sending an orphaned result a strict server rejects.
 */
export function assertToolTranscript(messages: readonly ModelMessage[]): void {
  const seen = new Set<string>();
  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    index += 1;
    if (message === undefined) {
      continue;
    }
    if (message.role === "tool") {
      throw new Error(
        `tool transcript invariant violated: orphaned tool result ${message.toolCallId}`,
      );
    }
    if (
      message.role !== "assistant" ||
      (message.toolCalls ?? []).length === 0
    ) {
      continue;
    }
    for (const call of message.toolCalls ?? []) {
      if (call.id.length === 0 || seen.has(call.id)) {
        throw new Error(
          `tool transcript invariant violated: duplicate or empty tool call id ${call.id}`,
        );
      }
      seen.add(call.id);
      const answer = messages[index];
      if (answer?.role !== "tool" || answer.toolCallId !== call.id) {
        throw new Error(
          `tool transcript invariant violated: tool call ${call.id} is not answered in order`,
        );
      }
      index += 1;
    }
  }
}

/** The `function.arguments` string that goes back for a recorded call. */
function wireArguments(call: ModelToolCall): string {
  if (call.argumentsError !== undefined) {
    // vLLM json.loads() every assistant tool_call's arguments when it applies
    // the chat template; echoing unparseable text would fail the whole next
    // round. The tool result tells the model its arguments were malformed.
    return "{}";
  }
  return call.rawArguments ?? JSON.stringify(call.arguments ?? {});
}

export type OpenAiMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly tool_calls?: readonly {
        readonly id: string;
        readonly type: "function";
        readonly function: {
          readonly name: string;
          readonly arguments: string;
        };
      }[];
    }
  | {
      readonly role: "tool";
      readonly tool_call_id: string;
      readonly content: string;
    };

export function toOpenAiMessages(
  system: string,
  messages: readonly ModelMessage[],
): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    switch (message.role) {
      case "user":
        out.push({ role: "user", content: message.content });
        break;
      case "assistant": {
        const calls = message.toolCalls ?? [];
        if (calls.length === 0) {
          out.push({ role: "assistant", content: message.content });
          break;
        }
        out.push({
          role: "assistant",
          content: message.content.length > 0 ? message.content : null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: {
              name: toWireToolName(call.name),
              arguments: wireArguments(call),
            },
          })),
        });
        break;
      }
      case "tool":
        out.push({
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        });
        break;
    }
  }
  return out;
}

/** The exact `/chat/completions` body for a request. */
export function toOpenAiRequestBody(
  servedModelId: string,
  request: ModelRequest,
): Record<string, unknown> {
  assertToolTranscript(request.messages);
  return {
    model: servedModelId,
    messages: toOpenAiMessages(request.system, request.messages),
    tools: request.tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: toWireToolName(tool.name),
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
    tool_choice: request.toolChoice ?? "auto",
    max_tokens: request.maxTokens ?? 1024,
    temperature: 0,
  };
}

// ---------------------------------------------------------------------------
// Response parser
// ---------------------------------------------------------------------------

export interface ParsedCompletion extends ModelResponse {
  /** The `model` the server says produced this completion. */
  readonly servedModel: string | null;
  readonly finishReason: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function syntheticCallId(): string {
  return generateId("call");
}

type ParsedArguments = Pick<
  ModelToolCall,
  "arguments" | "rawArguments" | "argumentsError"
>;

function parseArguments(raw: unknown): ParsedArguments {
  if (raw === undefined || raw === null) {
    return { arguments: {}, rawArguments: "{}" };
  }
  if (typeof raw === "string") {
    if (raw.trim().length === 0) {
      // Some servers emit "" for a no-argument call; "{}" is its JSON form.
      return { arguments: {}, rawArguments: "{}" };
    }
    try {
      return { arguments: JSON.parse(raw) as unknown, rawArguments: raw };
    } catch {
      return {
        arguments: undefined,
        rawArguments: raw,
        argumentsError: "malformed_json",
      };
    }
  }
  // Already-parsed arguments (some servers and proxies do this).
  try {
    return { arguments: raw, rawArguments: JSON.stringify(raw) };
  } catch {
    return {
      arguments: undefined,
      rawArguments: "{}",
      argumentsError: "malformed_json",
    };
  }
}

function parseToolCall(entry: unknown): ModelToolCall {
  const call = isRecord(entry) ? entry : {};
  const fn = isRecord(call.function) ? call.function : {};
  const id =
    typeof call.id === "string" && call.id.trim().length > 0
      ? call.id.trim()
      : syntheticCallId();
  const typeOk = call.type === undefined || call.type === "function";
  const wireName = typeof fn.name === "string" && typeOk ? fn.name.trim() : "";
  return {
    id,
    name: fromWireToolName(wireName),
    ...parseArguments(fn.arguments),
  };
}

/**
 * vLLM's hermes parser (and SGLang's qwen25 parser) hand back a `<tool_call>`
 * block as plain content when its JSON does not parse. Such a block is a
 * malformed tool call, not an answer: it becomes a call with `argumentsError`,
 * which the loop answers with an error the model can recover from, and it never
 * runs a tool — even when it happens to parse here, since the server's parser
 * rejected it (a parser mismatch is what attestation is for).
 */
const UNPARSED_TOOL_CALL = /<tool_call>([\s\S]*?)(?:<\/tool_call>|$)/g;
const NAME_IN_BLOCK = /"name"\s*:\s*"([^"\\]{1,128})"/;

function recoverUnparsedToolCalls(text: string): {
  text: string;
  calls: ModelToolCall[];
} {
  if (!text.includes("<tool_call>")) {
    return { text, calls: [] };
  }
  const calls: ModelToolCall[] = [];
  const remaining = text.replace(UNPARSED_TOOL_CALL, (_block, body: string) => {
    const name = NAME_IN_BLOCK.exec(body)?.[1] ?? "";
    calls.push({
      id: syntheticCallId(),
      name: fromWireToolName(name),
      arguments: undefined,
      rawArguments: "{}",
      argumentsError: "malformed_json",
    });
    return "";
  });
  return { text: remaining.trim(), calls };
}

function parseContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        isRecord(part) && typeof part.text === "string" ? part.text : "",
      )
      .join("");
  }
  return "";
}

/**
 * Parses an OpenAI-compatible completion. Tolerant of what a model emits (text
 * alongside calls, string or pre-parsed arguments, malformed JSON, missing ids);
 * strict about what a server must return (a `choices` array).
 */
export function parseOpenAiCompletion(payload: unknown): ParsedCompletion {
  const record = isRecord(payload) ? payload : {};
  if (!Array.isArray(record.choices) || record.choices.length === 0) {
    throw new ContractError(
      "service_unavailable",
      "the assistant is temporarily unavailable",
      { reason: "malformed_completion" },
    );
  }
  const first: unknown = record.choices[0];
  const choice = isRecord(first) ? first : {};
  const message = isRecord(choice.message) ? choice.message : {};
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const recovered = recoverUnparsedToolCalls(parseContent(message.content));
  const toolCalls = [...rawCalls.map(parseToolCall), ...recovered.calls];
  const usage = isRecord(record.usage) ? record.usage : {};
  return {
    text: recovered.text,
    toolCalls,
    usage: {
      tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : 0,
    },
    servedModel: typeof record.model === "string" ? record.model : null,
    finishReason:
      typeof choice.finish_reason === "string" ? choice.finish_reason : null,
  };
}

// ---------------------------------------------------------------------------
// Real HTTP adapter (OpenAI-compatible: vLLM / SGLang)
// ---------------------------------------------------------------------------

export interface ModelHttpOptions {
  readonly baseUrl: string;
  /** The configured model (Hugging Face id), reported as `ModelProvider.model`. */
  readonly model: string;
  /** The human-readable revision label. */
  readonly revision: string;
  /**
   * The pinned serving identity. Absent means "nothing pinned": the served id
   * defaults to `model` and strict attestation fails as `pin_incomplete`, so an
   * unconfigured provider never runs the model (deny by default).
   */
  readonly serving?: ModelServingConfig;
  /**
   * Name of the environment variable holding the bearer token for the private
   * endpoint. The secret is resolved by reference at call time and never stored
   * on the object or logged (rule #20).
   */
  readonly apiKeyEnv?: string;
  readonly timeoutMs?: number;
  readonly attestationTimeoutMs?: number;
  /** How long a successful attestation is trusted before it is re-checked. */
  readonly attestationTtlMs?: number;
  /** How long a failed attestation is cached before the endpoint is re-probed. */
  readonly attestationRetryMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

function unavailable(details: Record<string, unknown>): ContractError {
  return new ContractError(
    "service_unavailable",
    "the assistant is temporarily unavailable",
    details,
  );
}

export function createHttpModelProvider(
  options: ModelHttpOptions,
): ModelProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const now = options.now ?? (() => new Date());
  const ttlMs = options.attestationTtlMs ?? 60_000;
  const retryMs = options.attestationRetryMs ?? 10_000;
  const serving: ModelServingConfig = options.serving ?? {
    revisionLabel: options.revision,
    pin: {
      servedModelId: options.model,
      weightsRevision: null,
      tokenizerRevision: null,
      servingImage: null,
      toolParser: null,
    },
    mode: "strict",
    attestationUrl: null,
    problems: [],
  };
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (options.apiKeyEnv !== undefined) {
      const key = process.env[options.apiKeyEnv];
      if (key !== undefined && key.length > 0) {
        headers.authorization = `Bearer ${key}`;
      }
    }
    return headers;
  }

  let cached: { at: number; attestation: ModelAttestation } | null = null;
  let inflight: Promise<ModelAttestation> | null = null;

  /** One real check against the server; logs whenever the verdict changes. */
  async function runAttestation(): Promise<ModelAttestation> {
    const previous = cached?.attestation ?? null;
    const attestation = await attestServing({
      baseUrl,
      config: serving,
      fetchImpl: doFetch,
      headers: authHeaders(),
      timeoutMs: options.attestationTimeoutMs ?? 3_000,
      now,
    });
    cached = { at: now().getTime(), attestation };
    if (
      previous === null ||
      previous.ok !== attestation.ok ||
      previous.digest !== attestation.digest ||
      previous.reason !== attestation.reason
    ) {
      const summary = {
        ok: attestation.ok,
        reason: attestation.reason,
        detail: attestation.detail,
        mode: attestation.mode,
        servedModelId: attestation.expected.servedModelId,
        fields: attestation.fields,
        digest: attestation.digest,
      };
      if (attestation.ok) {
        modelLogger.info(summary, "model serving identity attested");
      } else {
        modelLogger.warn(
          summary,
          "model serving identity NOT attested: AI execution is off",
        );
      }
    }
    return attestation;
  }

  async function attest(
    attestOptions: { readonly force?: boolean } = {},
  ): Promise<ModelAttestation> {
    if (attestOptions.force !== true && cached !== null) {
      const age = now().getTime() - cached.at;
      if (age < (cached.attestation.ok ? ttlMs : retryMs)) {
        return cached.attestation;
      }
    }
    // Concurrent callers share one probe.
    inflight ??= runAttestation().finally(() => {
      inflight = null;
    });
    const attestation = await inflight;
    return attestation;
  }

  return {
    model: options.model,
    revision: options.revision,
    attest,
    lastAttestation: () => cached?.attestation ?? null,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const attestation = await attest();
      if (!attestation.ok || attestation.auditRevision === null) {
        throw unavailable({
          reason: "model_unattested",
          attestation: attestation.reason,
        });
      }

      const url = `${baseUrl}/chat/completions`;
      const body = toOpenAiRequestBody(serving.pin.servedModelId, request);

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      let parsed: ParsedCompletion;
      try {
        const response = await doFetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          signal: controller.signal,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          modelLogger.error(
            { status: response.status, model: serving.pin.servedModelId },
            "model endpoint refused the request",
          );
          throw unavailable({ status: response.status });
        }
        const payload: unknown = await response.json();
        parsed = parseOpenAiCompletion(payload);
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        modelLogger.error({ err: error }, "model endpoint call failed");
        throw unavailable({
          reason:
            error instanceof Error && error.name === "AbortError"
              ? "timeout"
              : "model_call_failed",
        });
      } finally {
        clearTimeout(timer);
      }

      if (parsed.servedModel !== serving.pin.servedModelId) {
        // The server answered as a different model than the one attested: drop
        // the attestation so the next call re-checks, and act on none of it.
        cached = null;
        modelLogger.error(
          {
            expected: serving.pin.servedModelId,
            served: parsed.servedModel,
          },
          "model endpoint served an unattested model",
        );
        throw unavailable({ reason: "served_model_mismatch" });
      }
      return {
        text: parsed.text,
        toolCalls: parsed.toolCalls,
        usage: parsed.usage,
        identity: {
          model: serving.pin.servedModelId,
          revision: attestation.auditRevision,
        },
      };
    },
  };
}
