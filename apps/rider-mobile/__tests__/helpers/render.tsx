// Renders a screen inside the app's real providers: React Query, the theme and the
// deny-by-default FlagsProvider (flags fetched over the stubbed wire for city LOS, so a
// flag is on only when the test's flag map says so).
import type React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@ubi/mobile-ui";
import { ConfigProvider, FlagsProvider } from "@ubi/mobile-core";

const clients: QueryClient[] = [];

export function renderApp(
  el: React.ReactElement,
  client?: QueryClient,
  opts: { cityConfig?: boolean } = {},
) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  clients.push(qc);
  const tree = (
    <FlagsProvider cityId="LOS">
      <ThemeProvider defaultMode="light">{el}</ThemeProvider>
    </FlagsProvider>
  );
  const view = render(
    <QueryClientProvider client={qc}>
      {/* City config (timezone, currency format) as the app loads it, when asked for. */}
      {opts.cityConfig ? (
        <ConfigProvider cityId="LOS">{tree}</ConfigProvider>
      ) : (
        tree
      )}
    </QueryClientProvider>,
  );
  return { ...view, queryClient: qc };
}

export function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Stop polling between tests (refetch intervals would otherwise outlive the test). */
export function clearClients() {
  for (const c of clients.splice(0)) c.clear();
}

/**
 * Resolves once FlagsProvider has fetched AND applied the flag map, so a test can assert
 * that something flag-gated stays hidden without passing merely because flags were
 * still loading.
 */
export async function flagsSettled(calls: { path: string }[]) {
  await waitFor(() =>
    expect(calls.some((c) => c.path === "/v1/config/flags")).toBe(true),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
