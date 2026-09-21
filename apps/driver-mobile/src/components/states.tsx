// Shared loading / error / empty blocks so every new screen carries the same
// honest states (C05 quality bar). Errors keep the server's phrasing where the
// service speaks a contract error; otherwise a plain offline line with retry.
import React from "react";
import { View } from "react-native";
import { Banner, Button, Skeleton, Text } from "@ubi/mobile-ui";
import { ApiError } from "@ubi/mobile-core";
import { NotYetSupported } from "../api/unsupported";

export function LoadingState({ lines = 3 }: { lines?: number }) {
  return (
    <View accessibilityLabel="Loading" style={{ gap: 12 }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={i === 0 ? 110 : 64} />
      ))}
    </View>
  );
}

export function errorText(e: unknown): string {
  if (e instanceof NotYetSupported) return e.message;
  if (e instanceof ApiError) {
    const d = e.details as
      | { error?: { message?: string }; message?: string }
      | undefined;
    const server = d?.error?.message ?? d?.message;
    if (server) return server;
    if (e.message && !e.message.startsWith("http_")) return e.message;
  }
  return "Couldn’t reach the server. You may be offline — try again.";
}

export function ErrorState({
  error,
  onRetry,
  title = "Something didn’t load",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <View style={{ gap: 12 }}>
      <Banner tone="error" title={title} body={errorText(error)} />
      {onRetry ? (
        <Button
          label="Try again"
          kind="secondary"
          accessibilityLabel="Try again"
          onPress={onRetry}
        />
      ) : null}
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ gap: 4, paddingVertical: 24, alignItems: "center" }}>
      <Text variant="bodyStrong">{title}</Text>
      <Text variant="bodySm" tone="text2" align="center">
        {body}
      </Text>
    </View>
  );
}
