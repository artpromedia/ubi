/**
 * Wires the ask service against the real singletons and endpoints.
 *
 * The model and embedding endpoints are private (vLLM / SGLang) — nothing here
 * depends on a proprietary inference SDK. The model is pinned by SERVING
 * IDENTITY (served model id, weights and tokenizer revisions, serving image
 * digest, tool parser — ai/attestation.ts), distinct from the human-readable
 * MODEL_REVISION label. When the endpoint is absent, unreachable or does not
 * attest against the pin, the HTTP provider still exists but every model call
 * fails as `service_unavailable`, which is the honest fallback to the
 * conventional flow (rule #18): the assistant is simply unavailable, never
 * faked, and the rest of the app keeps serving. A malformed pin never stops the
 * boot; it keeps AI execution off and says why (/health/ready). The embedder
 * defaults to the offline lexical embedder so RAG still functions without a GPU;
 * a configured endpoint replaces it.
 *
 * The travel port reaches travel-service directly too, but presents the
 * USER'S OWN gateway-signed context, relayed from the request that caused the
 * call (lib/identity-relay.ts, ports/travel-port.ts); only its background
 * status read uses a service key (TRAVEL_ASK_SERVICE_KEY).
 *
 * The marketplace port reaches ride-service directly, so it must present the
 * same HMAC-signed internal identity the gateway would (lib/ride-context.ts).
 * `createDeps` therefore REFUSES to build in production without
 * RIDE_INTERNAL_CONTEXT_SECRET — the process exits at boot (index.ts), exactly
 * as ride-service itself does — and warns in development, where ride-service
 * accepts the identity unsigned.
 */
import { loadModelServingConfig } from "./ai/attestation";
import {
  createHashEmbeddingProvider,
  createHttpEmbeddingProvider,
  type EmbeddingProvider,
} from "./ai/embedding-provider";
import { createHttpModelProvider } from "./ai/model-provider";
import { createRetriever } from "./ai/rag";
import { logger } from "./lib/logger";
import { prisma } from "./lib/prisma";
import {
  RIDE_CONTEXT_SECRET_ENV,
  loadRideContextKeys,
} from "./lib/ride-context";
import { DEFAULT_LIMITS, type AskDeps } from "./ops/context";
import { createFlagProvider } from "./ops/flags";
import { createHttpGrantPort } from "./ports/grant-port";
import { createHttpMarketplacePort } from "./ports/marketplace-port";
import { createHttpPromotionsPort } from "./ports/promotions-port";
import { createHttpRidePort } from "./ports/ride-port";
import { createHttpSupportPort } from "./ports/support-port";
import { createHttpTravelPort } from "./ports/travel-port";

import type { AskDb } from "./ops/types";

const MODEL_ENDPOINT_URL =
  process.env.MODEL_ENDPOINT_URL ?? "http://model-serving:8000/v1";
const MODEL_NAME = process.env.MODEL_NAME ?? "Qwen/Qwen3-30B-A3B-Instruct-2507";
const MODEL_REVISION = process.env.MODEL_REVISION ?? "2507";
/**
 * The pinned serving identity: MODEL_SERVED_ID (default MODEL_NAME),
 * MODEL_WEIGHTS_REVISION, MODEL_TOKENIZER_REVISION, MODEL_SERVING_IMAGE,
 * MODEL_TOOL_PARSER, MODEL_ATTESTATION_URL and MODEL_ATTESTATION_MODE (strict by
 * default). See docs/MODEL-SERVING.md.
 */
const MODEL_SERVING = loadModelServingConfig(process.env, {
  model: MODEL_NAME,
  revision: MODEL_REVISION,
});
const EMBED_ENDPOINT_URL = process.env.EMBED_ENDPOINT_URL;
const EMBED_NAME = process.env.EMBED_NAME ?? "Qwen/Qwen3-Embedding-0.6B";
const EMBED_REVISION = process.env.EMBED_REVISION ?? "0.6b";

const USER_SERVICE_URL =
  process.env.USER_SERVICE_URL ?? "http://user-service:4001";
const RIDE_SERVICE_URL =
  process.env.RIDE_SERVICE_URL ?? "http://ride-service:4002";
// travel-service listens on 4012 (services/travel-service/src/index.ts).
const TRAVEL_SERVICE_URL =
  process.env.TRAVEL_SERVICE_URL ?? "http://travel-service:4012";
const PROMOTIONS_SERVICE_URL =
  process.env.PROMOTIONS_SERVICE_URL ?? "http://promotions-service:4009";
const SUPPORT_SERVICE_URL =
  process.env.SUPPORT_SERVICE_URL ?? "http://support-service:4011";

export function createDeps(): AskDeps {
  const db = prisma as unknown as AskDb;
  const serviceKey = process.env.INTERNAL_SERVICE_KEY;
  // Throws in production when the secret is missing (fail closed at boot).
  const rideContextKeys = loadRideContextKeys(process.env);
  if (rideContextKeys.length === 0) {
    logger.warn(
      `${RIDE_CONTEXT_SECRET_ENV} is not set: marketplace calls to ride-service carry an UNSIGNED identity (development only)`,
    );
  }

  if (MODEL_SERVING.problems.length > 0) {
    logger.warn(
      { problems: MODEL_SERVING.problems },
      "model serving pin is invalid: AI execution stays off until it is fixed",
    );
  }

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
      serving: MODEL_SERVING,
      apiKeyEnv: "MODEL_API_KEY",
    }),
    embedder,
    retriever: createRetriever(embedder),
    ride: createHttpRidePort({ baseUrl: RIDE_SERVICE_URL, serviceKey }),
    // Marketplace rider routes are served by ride-service (the gateway proxies
    // /v1/mp/* there for human clients). The assistant calls them directly AS
    // the user, under the signed delegated identity, deny-by-default.
    marketplace: createHttpMarketplacePort({
      baseUrl: RIDE_SERVICE_URL,
      signingKeys: rideContextKeys,
    }),
    // Request-scoped travel calls relay the user's own gateway-signed
    // context (lib/identity-relay.ts) — never the service key, never a plain
    // user header in production. The key below opens ONLY travel-service's
    // background-read surface (/internal/ask, TRAVEL_ASK_SERVICE_KEY there).
    travel: createHttpTravelPort({
      baseUrl: TRAVEL_SERVICE_URL,
      internalServiceKey: process.env.TRAVEL_ASK_SERVICE_KEY,
    }),
    promotions: createHttpPromotionsPort({
      baseUrl: PROMOTIONS_SERVICE_URL,
      serviceKey,
    }),
    // user-service authenticates the internal grant surface with
    // AI_GRANTS_SERVICE_KEY (src/grants/service-auth.ts); the port refuses to
    // mint without a key rather than send an unauthenticated request.
    grants: createHttpGrantPort({
      baseUrl: USER_SERVICE_URL,
      serviceKey: process.env.AI_GRANTS_SERVICE_KEY ?? serviceKey,
    }),
    support: createHttpSupportPort({
      baseUrl: SUPPORT_SERVICE_URL,
      serviceKey,
    }),
    limits: DEFAULT_LIMITS,
    now: () => new Date(),
  };
}
