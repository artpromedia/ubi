/**
 * The model provider.
 *
 * The assistant is backed by a privately served instruction model — the pinned
 * candidate is `Qwen/Qwen3-30B-A3B-Instruct-2507`, served behind vLLM or SGLang
 * (both expose an OpenAI-compatible chat API). This module defines the interface
 * the tool loop depends on and a real HTTP adapter for that endpoint. It is
 * pinned to a *revision*, not to a proprietary inference SDK: the adapter is a
 * plain fetch against an OpenAI-shaped `/chat/completions`, so the same code
 * runs against vLLM, SGLang or any compatible server.
 *
 * LIVE SERVING IS EXTERNALLY BLOCKED here (no GPU, no weights), so production
 * wiring points at a configured endpoint and the tests inject a deterministic
 * provider that does real tool-selection over these same strict schemas. When
 * the endpoint is absent or unreachable the adapter raises `service_unavailable`
 * and the caller falls back to the conventional flow (rule #18).
 *
 * The provider is given *tools*, not permissions. It can only propose a tool and
 * arguments; whether that tool may run, and as whom, is decided entirely by the
 * server from the gateway identity — never by anything the model returns.
 */
import { ContractError } from "@ubi/contracts";

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

export interface ModelMessage {
  readonly role: ModelRole;
  readonly content: string;
  /** Present on a `tool` message: which tool produced this content. */
  readonly toolName?: string;
  /** Correlates a tool result with the call that asked for it. */
  readonly toolCallId?: string;
}

export interface ModelRequest {
  readonly system: string;
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
  readonly toolChoice?: "auto" | "none" | "required";
  readonly maxTokens?: number;
  /** Hard cap on provider round-trips for this turn (rule #18 — bounded loop). */
  readonly requestBudget?: number;
}

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  /** Raw arguments as the model produced them; validated by the tool's schema. */
  readonly arguments: unknown;
}

export interface ModelUsage {
  readonly tokens: number;
  readonly costMinor?: number;
  readonly currency?: string;
}

export interface ModelResponse {
  /** Assistant text, if the model chose to answer rather than call a tool. */
  readonly text: string;
  /** Tool calls the model wants run before it can answer. May be empty. */
  readonly toolCalls: readonly ModelToolCall[];
  readonly usage: ModelUsage;
}

export interface ModelProvider {
  readonly model: string;
  readonly revision: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

// ---------------------------------------------------------------------------
// Real HTTP adapter (OpenAI-compatible: vLLM / SGLang)
// ---------------------------------------------------------------------------

export interface ModelHttpOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly revision: string;
  /**
   * Name of the environment variable holding the bearer token for the private
   * endpoint. The secret is resolved by reference at call time and never stored
   * on the object or logged (rule #20).
   */
  readonly apiKeyEnv?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface OpenAiToolCall {
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown };
}

interface OpenAiChoice {
  message?: {
    content?: unknown;
    tool_calls?: unknown;
  };
}

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== "string") {
    return raw ?? {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    // A model that emitted non-JSON arguments has proposed nothing runnable; the
    // tool's zod schema will reject `{}` if the tool needs arguments.
    return {};
  }
}

export function createHttpModelProvider(
  options: ModelHttpOptions,
): ModelProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  return {
    model: options.model,
    revision: options.revision,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const url = `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (options.apiKeyEnv !== undefined) {
        const key = process.env[options.apiKeyEnv];
        if (key !== undefined && key.length > 0) {
          headers.authorization = `Bearer ${key}`;
        }
      }

      const body = {
        model: options.model,
        messages: [
          { role: "system", content: request.system },
          ...request.messages.map((message) => {
            if (message.role === "tool") {
              return {
                role: "tool" as const,
                content: message.content,
                tool_call_id: message.toolCallId ?? message.toolName ?? "",
              };
            }
            return { role: message.role, content: message.content };
          }),
        ],
        tools: request.tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: request.toolChoice ?? "auto",
        max_tokens: request.maxTokens ?? 1024,
        temperature: 0,
      };

      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await doFetch(url, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          modelLogger.error(
            { status: response.status, model: options.model },
            "model endpoint refused the request",
          );
          throw new ContractError(
            "service_unavailable",
            "the assistant is temporarily unavailable",
            { status: response.status },
          );
        }
        const payload: unknown = await response.json();
        return interpretOpenAi(payload);
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        modelLogger.error({ err: error }, "model endpoint call failed");
        throw new ContractError(
          "service_unavailable",
          "the assistant is temporarily unavailable",
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function interpretOpenAi(payload: unknown): ModelResponse {
  const record = (payload ?? {}) as {
    choices?: unknown;
    usage?: { total_tokens?: unknown };
  };
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] as OpenAiChoice | undefined;
  const message = first?.message ?? {};
  const text = typeof message.content === "string" ? message.content : "";
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls: ModelToolCall[] = rawCalls.map((entry, index) => {
    const call = entry as OpenAiToolCall;
    return {
      id: typeof call.id === "string" ? call.id : `call_${index}`,
      name:
        typeof call.function?.name === "string" ? call.function.name : "",
      arguments: parseArguments(call.function?.arguments),
    };
  });
  const tokens =
    typeof record.usage?.total_tokens === "number"
      ? record.usage.total_tokens
      : 0;
  return { text, toolCalls, usage: { tokens } };
}
