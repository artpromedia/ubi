/**
 * A local stand-in for an OpenAI-compatible model server (vLLM / SGLang).
 *
 * It is a real HTTP server on 127.0.0.1 that RECORDS every request exactly as it
 * arrived (method, path, headers, raw body bytes and the parsed JSON) and answers
 * from a script. It replaces only the external model server: the provider that
 * serializes requests and parses responses, and the loop that drives it, are the
 * real `src/` code talking real HTTP. Nothing here decides what the service does
 * with a response — it only plays back what a model server would have said.
 *
 * Routes:
 *   GET  /v1/models            the model listing (attestation source)
 *   GET  /attestation.json     the serving deployment's attestation document
 *   POST /v1/chat/completions  scripted completions
 */
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

import {
  loadModelServingConfig,
  type ModelServingConfig,
} from "../src/ai/attestation";
import {
  createHttpModelProvider,
  type ModelHttpOptions,
  type ModelProvider,
} from "../src/ai/model-provider";

import type { AddressInfo } from "node:net";

export const SERVED_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507";
export const WEIGHTS_REVISION = "0123456789abcdef0123456789abcdef01234567";
export const TOKENIZER_REVISION = "89abcdef0123456789abcdef0123456789abcdef";
export const SERVING_IMAGE = `vllm/vllm-openai@sha256:${"ab".repeat(32)}`;
export const TOOL_PARSER = "vllm:hermes+auto-tool-choice";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  /** The body bytes exactly as received. */
  readonly rawBody: string;
  /** The parsed JSON body (null when there was none). */
  readonly body: unknown;
}

export interface ScriptedReply {
  readonly status?: number;
  readonly json?: unknown;
  /** A non-JSON body (e.g. a proxy's HTML error page). */
  readonly text?: string;
  /** Delay before answering, to exercise client timeouts. */
  readonly delayMs?: number;
}

/** A chat-completions request body as the stub parsed it. */
export interface ChatBody {
  readonly model: string;
  readonly messages: readonly Record<string, unknown>[];
  readonly tools?: readonly {
    readonly type: string;
    readonly function: { readonly name: string };
  }[];
  readonly tool_choice?: unknown;
}

export type CompletionScript =
  | readonly ScriptedReply[]
  | ((body: ChatBody, index: number) => ScriptedReply);

export interface StubOptions {
  readonly servedModelId?: string;
  /** Extra metadata keys on the served model's `/models` entry. */
  readonly modelCard?: Readonly<Record<string, unknown>>;
  /** Replaces the whole `/models` reply. */
  readonly models?: ScriptedReply;
  /** The attestation document; null/undefined serves 404. */
  readonly attestation?: Readonly<Record<string, unknown>> | null;
  readonly completions?: CompletionScript;
}

export interface OpenAiStub {
  /** `http://127.0.0.1:<port>/v1` — what the provider is pointed at. */
  readonly baseUrl: string;
  readonly attestationUrl: string;
  /** Every request received, in order. */
  readonly requests: RecordedRequest[];
  /** The recorded `/chat/completions` requests. */
  completions(): RecordedRequest[];
  /** The recorded `/chat/completions` bodies, parsed. */
  chatBodies(): ChatBody[];
  modelListings(): RecordedRequest[];
  setCompletions(script: CompletionScript): void;
  setOptions(options: Partial<StubOptions>): void;
  close(): Promise<void>;
}

/** The service's MODEL_* environment, fully pinned to the stub's identity. */
export function pinnedEnv(
  stub: Pick<OpenAiStub, "attestationUrl">,
  overrides: Readonly<Record<string, string | undefined>> = {},
): Record<string, string | undefined> {
  return {
    MODEL_NAME: SERVED_MODEL,
    MODEL_REVISION: "2507",
    MODEL_WEIGHTS_REVISION: WEIGHTS_REVISION,
    MODEL_TOKENIZER_REVISION: TOKENIZER_REVISION,
    MODEL_SERVING_IMAGE: SERVING_IMAGE,
    MODEL_TOOL_PARSER: TOOL_PARSER,
    MODEL_ATTESTATION_URL: stub.attestationUrl,
    ...overrides,
  };
}

export function pinnedServing(
  stub: Pick<OpenAiStub, "attestationUrl">,
  overrides: Readonly<Record<string, string | undefined>> = {},
): ModelServingConfig {
  return loadModelServingConfig(pinnedEnv(stub, overrides), {
    model: SERVED_MODEL,
    revision: "2507",
  });
}

/** The REAL HTTP provider, pointed at the stub, strictly pinned. */
export function stubProvider(
  stub: OpenAiStub,
  options: Partial<ModelHttpOptions> = {},
): ModelProvider {
  return createHttpModelProvider({
    baseUrl: stub.baseUrl,
    model: SERVED_MODEL,
    revision: "2507",
    serving: pinnedServing(stub),
    timeoutMs: 5_000,
    ...options,
  });
}

/** A full attestation document matching the test pins. */
export function matchingAttestation(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    served_model_id: SERVED_MODEL,
    weights_revision: WEIGHTS_REVISION,
    tokenizer_revision: TOKENIZER_REVISION,
    serving_image: SERVING_IMAGE,
    tool_parser: TOOL_PARSER,
    ...overrides,
  };
}

/** A wire-format tool call exactly as vLLM returns it. */
export function wireToolCall(
  id: string | undefined,
  name: string,
  args: unknown,
): Record<string, unknown> {
  return {
    ...(id === undefined ? {} : { id }),
    type: "function",
    function: { name, arguments: args },
  };
}

/** A chat completion reply as vLLM shapes it. */
export function completion(
  message: { content?: string | null; tool_calls?: readonly unknown[] },
  options: { model?: string; finishReason?: string; tokens?: number } = {},
): ScriptedReply {
  const toolCalls = message.tool_calls ?? [];
  return {
    json: {
      id: `chatcmpl-${Math.random().toString(16).slice(2)}`,
      object: "chat.completion",
      created: 1_790_000_000,
      model: options.model ?? SERVED_MODEL,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: message.content ?? null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          },
          finish_reason:
            options.finishReason ??
            (toolCalls.length > 0 ? "tool_calls" : "stop"),
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: options.tokens ?? 120,
      },
    },
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startOpenAiStub(
  initial: StubOptions = {},
): Promise<OpenAiStub> {
  let options: StubOptions = { ...initial };
  let script: CompletionScript = initial.completions ?? [];
  let completionIndex = 0;
  const requests: RecordedRequest[] = [];

  const reply = async (
    res: ServerResponse,
    scripted: ScriptedReply,
  ): Promise<void> => {
    if (scripted.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, scripted.delayMs));
    }
    if (res.destroyed) {
      return;
    }
    const status = scripted.status ?? 200;
    if (scripted.text !== undefined) {
      res.writeHead(status, { "content-type": "text/html" });
      res.end(scripted.text);
      return;
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(scripted.json ?? {}));
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const rawBody = await readBody(req);
      let body: unknown = null;
      if (rawBody.length > 0) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = null;
        }
      }
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      requests.push({
        method: req.method ?? "GET",
        path,
        headers: req.headers,
        rawBody,
        body,
      });

      if (req.method === "GET" && path === "/v1/models") {
        const servedId = options.servedModelId ?? SERVED_MODEL;
        await reply(
          res,
          options.models ?? {
            json: {
              object: "list",
              data: [
                {
                  id: servedId,
                  object: "model",
                  created: 1_790_000_000,
                  owned_by: "vllm",
                  root: `/models/${servedId}`,
                  parent: null,
                  max_model_len: 32768,
                  ...options.modelCard,
                },
              ],
            },
          },
        );
        return;
      }
      if (req.method === "GET" && path === "/attestation.json") {
        await reply(
          res,
          options.attestation === null || options.attestation === undefined
            ? { status: 404, json: { error: "not found" } }
            : { json: options.attestation },
        );
        return;
      }
      if (req.method === "POST" && path === "/v1/chat/completions") {
        const index = completionIndex;
        completionIndex += 1;
        const scripted =
          typeof script === "function"
            ? script(body as ChatBody, index)
            : script[index];
        await reply(
          res,
          scripted ?? {
            status: 500,
            json: { error: `no scripted completion #${index}` },
          },
        );
        return;
      }
      await reply(res, { status: 404, json: { error: "not found" } });
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    baseUrl: `${origin}/v1`,
    attestationUrl: `${origin}/attestation.json`,
    requests,
    completions: () =>
      requests.filter((r) => r.path === "/v1/chat/completions"),
    chatBodies: () =>
      requests
        .filter((r) => r.path === "/v1/chat/completions")
        .map((r) => r.body as ChatBody),
    modelListings: () => requests.filter((r) => r.path === "/v1/models"),
    setCompletions: (next) => {
      script = next;
      completionIndex = 0;
    },
    setOptions: (next) => {
      options = { ...options, ...next };
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

/**
 * An independent check of the OpenAI tool-calling transcript rules on a
 * recorded request body (deliberately not the service's own validator): every
 * assistant `tool_calls` entry is a complete record, and is followed at once by
 * one `tool` message per call, in order, carrying its id; no tool message is
 * orphaned and no id repeats.
 */
export function expectValidToolTranscript(body: ChatBody): void {
  const seen = new Set<string>();
  const messages = body.messages;
  let i = 0;
  while (i < messages.length) {
    const message = messages[i] as Record<string, unknown>;
    i += 1;
    if (message.role === "tool") {
      throw new Error(`orphaned tool message at ${i - 1}`);
    }
    const calls = message.tool_calls as
      | readonly Record<string, unknown>[]
      | undefined;
    if (message.role !== "assistant" || calls === undefined) {
      continue;
    }
    if (calls.length === 0) {
      throw new Error("assistant tool_calls must not be empty when present");
    }
    for (const call of calls) {
      const fn = call.function as Record<string, unknown> | undefined;
      if (
        typeof call.id !== "string" ||
        call.id.length === 0 ||
        call.type !== "function" ||
        typeof fn?.name !== "string" ||
        typeof fn.arguments !== "string"
      ) {
        throw new Error(`incomplete tool call record ${JSON.stringify(call)}`);
      }
      // vLLM json.loads() every replayed argument string.
      JSON.parse(fn.arguments);
      if (seen.has(call.id)) {
        throw new Error(`duplicate tool call id ${call.id}`);
      }
      seen.add(call.id);
      const next = messages[i] as Record<string, unknown> | undefined;
      if (next?.role !== "tool" || next.tool_call_id !== call.id) {
        throw new Error(`tool call ${call.id} not answered in order`);
      }
      if (typeof next.content !== "string") {
        throw new Error(`tool result for ${call.id} has no content`);
      }
      i += 1;
    }
  }
}
