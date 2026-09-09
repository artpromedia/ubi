/**
 * The embedding provider.
 *
 * RAG retrieves versioned policy/support docs by similarity. The pinned
 * production candidate is `Qwen/Qwen3-Embedding-0.6B`, served privately over an
 * OpenAI-compatible `/embeddings` endpoint (the `createHttpEmbeddingProvider`
 * adapter below). That serving is EXTERNALLY BLOCKED here.
 *
 * So the default provider is a deterministic, offline embedder: a feature-hashed
 * bag-of-tokens vector. It is a real algorithm, not a fixture — the same text
 * always maps to the same unit vector, and lexically related text lands nearby —
 * so retrieval, role/market filtering and citations are exercised end to end
 * without a GPU. It is a lexical fallback, not the production-quality semantic
 * embedder; the wiring swaps in the HTTP provider when an endpoint is configured.
 */
import { ContractError } from "@ubi/contracts";

import { modelLogger } from "../lib/logger";

export interface EmbeddingProvider {
  readonly model: string;
  readonly revision: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

const HASH_DIMENSIONS = 256;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % HASH_DIMENSIONS;
}

function embedOne(text: string): number[] {
  const vector = new Array<number>(HASH_DIMENSIONS).fill(0);
  for (const token of tokenize(text)) {
    const index = hashToken(token);
    const current = vector[index] ?? 0;
    vector[index] = current + 1;
  }
  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}

/** Deterministic, offline, lexical embedder. Real algorithm, no external call. */
export function createHashEmbeddingProvider(): EmbeddingProvider {
  return {
    model: "ubi-hash-embed",
    revision: "1",
    dimensions: HASH_DIMENSIONS,
    async embed(
      texts: readonly string[],
    ): Promise<readonly (readonly number[])[]> {
      return texts.map(embedOne);
    },
  };
}

export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Real HTTP adapter (OpenAI-compatible embeddings: vLLM / SGLang)
// ---------------------------------------------------------------------------

export interface EmbeddingHttpOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly revision: string;
  readonly dimensions: number;
  readonly apiKeyEnv?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export function createHttpEmbeddingProvider(
  options: EmbeddingHttpOptions,
): EmbeddingProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  return {
    model: options.model,
    revision: options.revision,
    dimensions: options.dimensions,
    async embed(
      texts: readonly string[],
    ): Promise<readonly (readonly number[])[]> {
      const url = `${options.baseUrl.replace(/\/+$/, "")}/embeddings`;
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (options.apiKeyEnv !== undefined) {
        const key = process.env[options.apiKeyEnv];
        if (key !== undefined && key.length > 0) {
          headers.authorization = `Bearer ${key}`;
        }
      }
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await doFetch(url, {
          method: "POST",
          headers,
          signal: controller.signal,
          body: JSON.stringify({ model: options.model, input: [...texts] }),
        });
        if (!response.ok) {
          throw new ContractError(
            "service_unavailable",
            "the embedding endpoint is unavailable",
            { status: response.status },
          );
        }
        const payload = (await response.json()) as {
          data?: { embedding?: unknown }[];
        };
        const rows = Array.isArray(payload.data) ? payload.data : [];
        return rows.map((row) =>
          Array.isArray(row.embedding)
            ? row.embedding.map((n) => (typeof n === "number" ? n : 0))
            : [],
        );
      } catch (error) {
        if (error instanceof ContractError) {
          throw error;
        }
        modelLogger.error({ err: error }, "embedding endpoint call failed");
        throw new ContractError(
          "service_unavailable",
          "the embedding endpoint is unavailable",
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
