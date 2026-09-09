/**
 * Wires the ask service against the real singletons and endpoints.
 *
 * The model and embedding endpoints are private (vLLM / SGLang) and are pinned by
 * revision through configuration — nothing here depends on a proprietary
 * inference SDK. When a model endpoint is not configured the HTTP provider still
 * exists but every call fails as `service_unavailable`, which is the honest
 * fallback to the conventional flow (rule #18): the assistant is simply
 * unavailable, never faked. The embedder defaults to the offline lexical embedder
 * so RAG still functions without a GPU; a configured endpoint replaces it.
 */
import {
  createHashEmbeddingProvider,
  createHttpEmbeddingProvider,
  type EmbeddingProvider,
} from "./ai/embedding-provider";
import { createHttpModelProvider } from "./ai/model-provider";
import { createRetriever } from "./ai/rag";
import { createFlagProvider } from "./ops/flags";
import { createHttpGrantPort } from "./ports/grant-port";
import { createHttpPromotionsPort } from "./ports/promotions-port";
import { createHttpRidePort } from "./ports/ride-port";
import { createHttpSupportPort } from "./ports/support-port";
import { createHttpTravelPort } from "./ports/travel-port";
import { prisma } from "./lib/prisma";
import { DEFAULT_LIMITS, type AskDeps } from "./ops/context";

import type { AskDb } from "./ops/types";

const MODEL_ENDPOINT_URL =
  process.env.MODEL_ENDPOINT_URL ?? "http://model-serving:8000/v1";
const MODEL_NAME = process.env.MODEL_NAME ?? "Qwen/Qwen3-30B-A3B-Instruct-2507";
const MODEL_REVISION = process.env.MODEL_REVISION ?? "2507";
const EMBED_ENDPOINT_URL = process.env.EMBED_ENDPOINT_URL;
const EMBED_NAME = process.env.EMBED_NAME ?? "Qwen/Qwen3-Embedding-0.6B";
const EMBED_REVISION = process.env.EMBED_REVISION ?? "0.6b";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ?? "http://user-service:4001";
const RIDE_SERVICE_URL =
  process.env.RIDE_SERVICE_URL ?? "http://ride-service:4002";
const TRAVEL_SERVICE_URL =
  process.env.TRAVEL_SERVICE_URL ?? "http://travel-service:4008";
const PROMOTIONS_SERVICE_URL =
  process.env.PROMOTIONS_SERVICE_URL ?? "http://promotions-service:4009";
const SUPPORT_SERVICE_URL =
  process.env.SUPPORT_SERVICE_URL ?? "http://support-service:4011";

export function createDeps(): AskDeps {
  const db = prisma as unknown as AskDb;
  const serviceKey = process.env.INTERNAL_SERVICE_KEY;

  const embedder: EmbeddingProvider =
    EMBED_ENDPOINT_URL === undefined
      ? createHashEmbeddingProvider()
      : createHttpEmbeddingProvider({
          baseUrl: EMBED_ENDPOINT_URL,
          model: EMBED_NAME,
          revision: EMBED_REVISION,
          dimensions: 1024,
          apiKeyEnv: "MODEL_API_KEY",
        });

  return {
    db,
    flags: createFlagProvider(db),
    model: createHttpModelProvider({
      baseUrl: MODEL_ENDPOINT_URL,
      model: MODEL_NAME,
      revision: MODEL_REVISION,
      apiKeyEnv: "MODEL_API_KEY",
    }),
    embedder,
    retriever: createRetriever(embedder),
    ride: createHttpRidePort({ baseUrl: RIDE_SERVICE_URL, serviceKey }),
    travel: createHttpTravelPort({ baseUrl: TRAVEL_SERVICE_URL, serviceKey }),
    promotions: createHttpPromotionsPort({
      baseUrl: PROMOTIONS_SERVICE_URL,
      serviceKey,
    }),
    grants: createHttpGrantPort({ baseUrl: USER_SERVICE_URL, serviceKey }),
    support: createHttpSupportPort({ baseUrl: SUPPORT_SERVICE_URL, serviceKey }),
    limits: DEFAULT_LIMITS,
    now: () => new Date(),
  };
}
