/**
 * Retrieval-augmented grounding for policy answers (rule #18).
 *
 * Retrieval is filtered by the caller's role and market BEFORE ranking, so a
 * driver-only policy is never surfaced to a rider and a market's rules never
 * leak into another market. Every retrieved passage carries a citation — id,
 * title, version, updatedAt — so an answer that leans on policy can be traced to
 * the exact document and version.
 *
 * Crucially, retrieved text is DATA, never instructions. It is placed into the
 * model context as reference material and can never grant a permission, name an
 * actor or authorise a transaction (rule #20 — retrieved documents cannot change
 * permissions). The tool runner and the grant checks ignore anything a document
 * or the model says about who may do what.
 */
import { cosineSimilarity, type EmbeddingProvider } from "./embedding-provider";
import { docsForMarket, type PolicyDoc } from "./policy-docs";

export interface RetrievedDoc {
  readonly doc: PolicyDoc;
  readonly score: number;
}

export interface Citation {
  readonly title: string;
  readonly ref: string;
  readonly version: string;
  readonly updatedAt: string;
}

export interface Retriever {
  retrieve(input: {
    readonly query: string;
    readonly role: string;
    readonly cityId: string;
    readonly topK?: number;
  }): Promise<readonly RetrievedDoc[]>;
}

const DEFAULT_TOP_K = 3;
/** Cap on how much retrieved text is embedded per query (search-volume cap). */
const MAX_CANDIDATES = 24;

export function createRetriever(embedder: EmbeddingProvider): Retriever {
  return {
    async retrieve(input): Promise<readonly RetrievedDoc[]> {
      const topK = input.topK ?? DEFAULT_TOP_K;
      const candidates = docsForMarket(input.cityId)
        .filter(
          (doc) =>
            doc.roles.length === 0 || doc.roles.includes(input.role),
        )
        .slice(0, MAX_CANDIDATES);
      if (candidates.length === 0) {
        return [];
      }
      const [queryVector, ...docVectors] = await embedder.embed([
        input.query,
        ...candidates.map((doc) => `${doc.title}. ${doc.body}`),
      ]);
      if (queryVector === undefined) {
        return [];
      }
      const scored: RetrievedDoc[] = candidates.map((doc, index) => ({
        doc,
        score: cosineSimilarity(queryVector, docVectors[index] ?? []),
      }));
      return scored
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },
  };
}

export function citationsFor(
  retrieved: readonly RetrievedDoc[],
): readonly Citation[] {
  return retrieved.map((entry) => ({
    title: entry.doc.title,
    ref: entry.doc.id,
    version: entry.doc.version,
    updatedAt: entry.doc.updatedAt,
  }));
}
