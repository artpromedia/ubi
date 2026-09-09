/**
 * Data wiring for the travel / ask / benefits / trips web pages.
 *
 * Uses the repo's existing web data idiom: TanStack Query (`useQuery`/`useMutation`)
 * over the shared `apiClient` (src/lib/api-client.ts) — the same client the auth pages
 * use, so bearer auth, 401 refresh and error envelopes are handled in one place.
 *
 * The only exception is the Ask thread stream: `apiClient` decodes JSON and cannot read a
 * `text/event-stream`, so streaming uses a direct fetch that mirrors the client's auth
 * (bearer from the auth store) and base URL. Everything the UI shows is server-computed.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient, type ApiResponse } from "@/lib/api-client";
import { useAuthStore } from "@/store";
import type {
  AskContext,
  AskEvent,
  AskThread,
  Benefits,
  FlightSearch,
  FlightSearchInput,
  Trip,
} from "./types";

/** Same base the shared apiClient composes its URLs from. */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

function unwrap<T>(res: ApiResponse<T>): T {
  if (!res.success || res.data === undefined) {
    throw new Error(res.error?.message ?? "Request failed");
  }
  return res.data;
}

// ---------------------------------------------------------------------------
// Benefits (promotions.yaml) — GET /v1/benefits
// ---------------------------------------------------------------------------

export function useBenefits() {
  return useQuery({
    queryKey: ["benefits"],
    queryFn: async () => unwrap(await apiClient.get<Benefits>("/v1/benefits")),
  });
}

// ---------------------------------------------------------------------------
// Trips (travel-v2.yaml) — GET /v1/travel/trips/{tripId}
// ---------------------------------------------------------------------------

export function useTrip(tripId: string) {
  return useQuery({
    queryKey: ["travel", "trip", tripId],
    queryFn: async () =>
      unwrap(await apiClient.get<Trip>(`/v1/travel/trips/${tripId}`)),
    enabled: tripId.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Flight search (travel-v2.yaml) — POST /v1/travel/flights/searches
// ---------------------------------------------------------------------------

export function useFlightSearch() {
  return useMutation({
    mutationFn: async (input: FlightSearchInput) =>
      unwrap(
        await apiClient.post<FlightSearch>(
          "/v1/travel/flights/searches",
          input,
        ),
      ),
  });
}

// ---------------------------------------------------------------------------
// Attribution (promotions.yaml) — POST /v1/attribution/claim (source: web_handoff)
// Best-effort: registers the web→app handoff attribution against the account. The app
// link also carries the code/campaign as a deferred deep link, so attribution survives
// even if this call fails.
// ---------------------------------------------------------------------------

export type AttributionClaimInput = {
  code?: string;
  campaign?: string;
  source: "deferred_link" | "web_handoff" | "manual";
};

export function useAttributionClaim() {
  return useMutation({
    mutationFn: async (input: AttributionClaimInput) =>
      unwrap(
        await apiClient.post<{ attributed: boolean; kind: string }>(
          "/v1/attribution/claim",
          input,
        ),
      ),
  });
}

// ---------------------------------------------------------------------------
// Ask (ask.yaml) — open a thread, then stream a message as text/event-stream.
// Transactions never happen here: a `review_ready` event links out to the review flow.
// ---------------------------------------------------------------------------

export async function openAskThread(context: AskContext): Promise<AskThread> {
  return unwrap(
    await apiClient.post<AskThread>("/v1/ask/threads", {
      source: "web",
      context,
    }),
  );
}

/**
 * POST a message and read the SSE response, emitting one typed AskEvent per `data:` frame.
 * Returns an abort function. onDone(err) fires once when the stream ends or errors.
 */
export function streamAskMessage(
  threadId: string,
  text: string,
  onEvent: (event: AskEvent) => void,
  onDone: (err?: Error) => void,
): () => void {
  const controller = new AbortController();
  void (async () => {
    try {
      const token = useAuthStore.getState().accessToken;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        accept: "text/event-stream",
      };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(
        `${API_BASE_URL}/v1/ask/threads/${threadId}/messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ text }),
          signal: controller.signal,
        },
      );
      if (!res.ok || !res.body) {
        throw new Error(`Ask stream failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf("\n\n");
        while (sep !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          emitFrame(frame, onEvent);
          sep = buffer.indexOf("\n\n");
        }
      }
      if (buffer.trim().length > 0) emitFrame(buffer, onEvent);
      onDone();
    } catch (err) {
      if (controller.signal.aborted) {
        onDone();
      } else {
        onDone(err instanceof Error ? err : new Error("Ask stream error"));
      }
    }
  })();
  return () => controller.abort();
}

function emitFrame(frame: string, onEvent: (event: AskEvent) => void): void {
  const dataLine = frame
    .split("\n")
    .find((line) => line.startsWith("data:"));
  if (!dataLine) return;
  const payload = dataLine.slice(5).trim();
  if (!payload || payload === "[DONE]") return;
  try {
    onEvent(JSON.parse(payload) as AskEvent);
  } catch {
    // Ignore malformed frames rather than tearing down the whole stream.
  }
}
