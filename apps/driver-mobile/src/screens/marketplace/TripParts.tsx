// Small shared pieces of the A02/A03 driver screens: a status tag that always PRINTS its
// word (colour is never the only signal), the "stop safely" gate that replaces every fare
// decision while the server has not acknowledged the driver as parked, and the load-state
// blocks (loading / error / offline) with registered testIDs.
import React from "react";
import { View } from "react-native";
import { Banner, Button, Card, Skeleton, Text, useTheme } from "@ubi/mobile-ui";
import type { MotionState } from "../../lib/motion";

export type TagTone = "ok" | "warn" | "error" | "neutral" | "info";

export function StateTag({
  label,
  tone,
  testID,
}: {
  label: string;
  tone: TagTone;
  testID?: string;
}) {
  const t = useTheme();
  const colors: Record<TagTone, { bg: string; fg: string }> = {
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

/**
 * Renders INSTEAD of fare controls until the server acknowledged the driver as parked
 * (lib/motion adopts only the server's POST /v1/mp/driver/parked answer). The
 * attestation button is the one way out of moving/stale without telemetry — it asks the
 * server, which can refuse; it never grants anything on the client's say-so.
 */
export function StopSafelyGate({
  motion,
  title,
  body,
  confirming,
  error,
  onConfirm,
  testID,
  parkedTestID,
}: {
  motion: MotionState;
  title: string;
  body: string;
  confirming: boolean;
  error: string | null;
  onConfirm: () => void;
  testID: string;
  parkedTestID: string;
}) {
  if (motion === "parked_confirmed") return null;
  return (
    <Card testID={testID} tone="warn" accessibilityRole="summary">
      <Text variant="bodyStrong">{title}</Text>
      <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
        {motion === "moving"
          ? body
          : body +
            " Your location signal is stale — confirm you’re safely parked to continue."}
      </Text>
      {error ? (
        <View style={{ marginTop: 8 }}>
          <Banner tone="error" body={error} />
        </View>
      ) : null}
      <Button
        testID={parkedTestID}
        label="I am safely parked"
        kind="secondary"
        size="md"
        loading={confirming}
        onPress={onConfirm}
        style={{ marginTop: 10 }}
      />
    </Card>
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
