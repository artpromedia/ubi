// Small shared pieces of the rider's A02/A03 screens: a status tag that always PRINTS its
// word (colour is never the only signal), the ordered route list (pickup → stops →
// destination), the flag-off fallback card, and the load-state blocks (loading / error /
// offline / stale) with registered testIDs.
import React from "react";
import { View } from "react-native";
import { Banner, Button, Card, Skeleton, Text, useTheme } from "@ubi/mobile-ui";
import type { Staleness, Tone } from "./riderCopy";

export function StateTag({
  label,
  tone,
  testID,
}: {
  label: string;
  tone: Tone;
  testID?: string;
}) {
  const t = useTheme();
  const colors: Record<Tone, { bg: string; fg: string }> = {
    ok: { bg: t.colors.okTint, fg: t.colors.ok },
    warn: { bg: t.colors.warnTint, fg: t.colors.warnInk },
    error: { bg: t.colors.errorTint, fg: t.colors.errorInk },
    info: { bg: t.colors.infoTint, fg: t.colors.info },
    neutral: { bg: t.colors.bg2, fg: t.colors.text2 },
  };
  const c = colors[tone];
  return (
    <View
      testID={testID}
      accessibilityRole="text"
      accessibilityLabel={"Status: " + label}
      style={{
        alignSelf: "flex-start",
        backgroundColor: c.bg,
        borderRadius: t.radius.chip,
        paddingHorizontal: 9,
        paddingVertical: 4,
      }}
    >
      <Text variant="label" style={{ color: c.fg }}>
        {label}
      </Text>
    </View>
  );
}

export type RoutePoint = {
  key: string;
  label: string;
  detail?: string;
  kind: "pickup" | "stop" | "dropoff";
  /** Printed next to the point (e.g. "Done", "Skipped") — never colour alone. */
  status?: string;
  muted?: boolean;
};

/** The ordered route as a vertical list: pickup → stops (numbered) → destination. */
export function RouteList({
  points,
  testID,
}: {
  points: RoutePoint[];
  testID?: string;
}) {
  const t = useTheme();
  let stopNo = 0;
  return (
    <View testID={testID} accessibilityRole="list" style={{ gap: 10 }}>
      {points.map((p) => {
        if (p.kind === "stop") stopNo += 1;
        const marker =
          p.kind === "pickup"
            ? "A"
            : p.kind === "dropoff"
              ? "B"
              : String(stopNo);
        const kindWord =
          p.kind === "pickup"
            ? "Pickup"
            : p.kind === "dropoff"
              ? "Destination"
              : "Stop " + stopNo;
        return (
          <View
            key={p.key}
            accessible
            accessibilityLabel={
              kindWord +
              ": " +
              p.label +
              (p.detail ? ", " + p.detail : "") +
              (p.status ? ", " + p.status : "")
            }
            style={{ flexDirection: "row", gap: 10, alignItems: "center" }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor:
                  p.kind === "stop" ? t.colors.bg2 : t.colors.inverse,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                variant="label"
                tone={p.kind === "stop" ? "text" : "onInverse"}
              >
                {marker}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text
                variant="bodySmStrong"
                tone={p.muted ? "text3" : "text"}
                style={p.muted ? { textDecorationLine: "line-through" } : null}
              >
                {p.label}
              </Text>
              {p.detail || p.status ? (
                <Text variant="caption" tone="text2">
                  {[kindWord, p.detail, p.status].filter(Boolean).join(" · ")}
                </Text>
              ) : (
                <Text variant="caption" tone="text2">
                  {kindWord}
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function LoadingBlocks({ heights }: { heights: number[] }) {
  return (
    <View accessibilityLabel="Loading" style={{ gap: 12 }}>
      {heights.map((h, i) => (
        <Skeleton key={i} height={h} />
      ))}
    </View>
  );
}

/** Load failure: offline (no server answer) vs a server error, with retry. */
export function LoadFailure({
  offline,
  title,
  body,
  onRetry,
  testIDs,
}: {
  offline: boolean;
  title: string;
  body: string;
  onRetry: () => void;
  testIDs: { offline: string; error: string; retry: string };
}) {
  return (
    <View style={{ gap: 12 }}>
      <Banner
        testID={offline ? testIDs.offline : testIDs.error}
        tone={offline ? "warn" : "error"}
        title={offline ? "You’re offline" : title}
        body={
          offline
            ? "This loads from the server. Reconnect and try again."
            : body
        }
      />
      <Button
        testID={testIDs.retry}
        label="Try again"
        kind="secondary"
        onPress={onRetry}
      />
    </View>
  );
}

/**
 * Shown above last-known data when a background refresh failed — ONLY when there is data from
 * an earlier answer (a list that never loaded shows an error instead, never "last update").
 * Actions stay available on these screens and every one is re-checked by the server against
 * the current state (versions / idempotency), so the copy says exactly that.
 */
export function StaleBanner({
  stale,
  testIDs,
}: {
  stale: Staleness;
  testIDs: { offline: string; error: string };
}) {
  if (!stale) return null;
  return (
    <Banner
      testID={stale === "offline" ? testIDs.offline : testIDs.error}
      tone="neutral"
      title={stale === "offline" ? "Reconnecting…" : "Couldn’t refresh"}
      body={
        stale === "offline"
          ? "Showing the last update from the server. Anything you do needs a connection and is checked against the latest state first."
          : "Showing the last update from the server. Anything you do is checked against the latest state first."
      }
    />
  );
}

/** Honest "not here" for a flag-off surface, with a useful way forward. */
export function UnavailableCard({
  title,
  body,
  action,
  testID,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void; testID?: string };
  testID: string;
}) {
  return (
    <Card testID={testID} style={{ gap: 10 }}>
      <Text variant="bodyStrong">{title}</Text>
      <Text variant="bodySm" tone="text2">
        {body}
      </Text>
      {action ? (
        <Button
          testID={action.testID}
          label={action.label}
          kind="secondary"
          onPress={action.onPress}
        />
      ) : null}
    </Card>
  );
}
