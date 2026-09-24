// Quote envelopes are cached under ["mp", "quote", params] and kept fresh until shortly
// before their server expiry, so the route builder's priced envelope is exactly the one
// the fare editor / Book for Later publish. Once the server has CONSUMED a quote (a
// publish, an advance request, a pre-award revise) it refuses it for any other write
// ("this quote has already been used"), so a later visit with the same trip must price
// afresh instead of reusing the spent envelope from the cache.
import type { QueryClient } from "@tanstack/react-query";

/** Drops every cached envelope carrying this quoteId (a new visit re-prices). */
export function forgetQuote(
  queryClient: QueryClient,
  quoteId: string | null | undefined,
) {
  if (!quoteId) return;
  queryClient.removeQueries({
    queryKey: ["mp", "quote"],
    predicate: (query) =>
      (query.state.data as { quoteId?: unknown } | undefined)?.quoteId ===
      quoteId,
  });
}
