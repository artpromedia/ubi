/**
 * The dependencies every ask action needs.
 *
 * They are injected rather than imported so `src/wiring.ts` can wire the real
 * singletons and the tests can wire a real, isolated database with fake ports —
 * with no mock layer anywhere in `src/`. The model and embedding providers are
 * injected the same way: production points them at the private endpoints, tests
 * inject a deterministic model provider that does real tool-selection.
 */
import type { EmbeddingProvider } from "../ai/embedding-provider";
import type { ModelProvider } from "../ai/model-provider";
import type { Retriever } from "../ai/rag";
import type { GrantPort } from "../ports/grant-port";
import type { PromotionsPort } from "../ports/promotions-port";
import type { RidePort } from "../ports/ride-port";
import type { SupportPort } from "../ports/support-port";
import type { TravelPort } from "../ports/travel-port";
import type { FlagProvider } from "./flags";
import type { AskDb } from "./types";

export interface AskLimits {
  /** Max provider round-trips per message turn (rule #18 — bounded loop). */
  readonly maxToolLoops: number;
  /** Max offers a single search tool may return (search-volume cap). */
  readonly maxSearchResults: number;
  /** Max messages a single user may send per rolling window. */
  readonly perUserMessagesPerMinute: number;
  /** How long a transaction review is valid before it must be re-quoted. */
  readonly reviewTtlSeconds: number;
  /** How long a minted action grant is valid. */
  readonly grantTtlSeconds: number;
}

export const DEFAULT_LIMITS: AskLimits = {
  maxToolLoops: 6,
  maxSearchResults: 5,
  perUserMessagesPerMinute: 20,
  reviewTtlSeconds: 600,
  grantTtlSeconds: 300,
};

export interface AskDeps {
  readonly db: AskDb;
  readonly flags: FlagProvider;
  readonly model: ModelProvider;
  readonly embedder: EmbeddingProvider;
  readonly retriever: Retriever;
  readonly ride: RidePort;
  readonly travel: TravelPort;
  readonly promotions: PromotionsPort;
  readonly grants: GrantPort;
  readonly support: SupportPort;
  readonly limits: AskLimits;
  /** Injected so expiry and TTL arithmetic is testable without waiting. */
  readonly now: () => Date;
}
