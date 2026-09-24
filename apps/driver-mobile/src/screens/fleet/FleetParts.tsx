// Shared pieces of the fleet calendar driver screens (A05, handoff C1–C5):
//  - FleetGate: the deny-by-default `fleet` flag, with the handoff's honest copy
//    ("Fleet tools aren't available yet in your city") — a deep link into a disabled
//    city lands here, never on a broken screen. Any flag-service failure reads OFF.
//  - FleetUnavailable: the same honest state when fleet-service itself answers 404
//    feature_disabled (the server is the authority; the client flag only hides).
//  - MotionLock (C2b): decisions render only while the SERVER has acknowledged the
//    driver as parked (lib/motion adopts only POST /v1/mp/driver/parked's answer).
//    Moving hides the decision and says when the earliest deadline is; a stale
//    signal asks for the parked attestation, which the server may refuse.
//  - PinPad: the wallet-PIN keypad for signing. The digits live in the caller's state
//    only; the pad never echoes them (dots), never logs and never announces them.
//  - FreshnessBanner: "Offline · showing data from {time}" when a refresh failed but
//    the last good answer is still on screen.
import type React from "react";
import { Pressable, View } from "react-native";
import { Banner, Button, Card, Skeleton, Text, useTheme } from "@ubi/mobile-ui";
import { useFlag, useFlags } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { MotionGate } from "../../lib/motion";
import { FLEET_TID } from "./testIds";
import { dateTimeIn, timeIn, zoneNote, type Refusal } from "./fleetCopy";

const UNAVAILABLE_TITLE = "Fleet tools aren’t available yet in your city";
const UNAVAILABLE_BODY =
  "They’re not offered where you drive right now. We’ll show them as soon as they are.";

export function FleetGate({
  onDismiss,
  children,
}: {
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const on = useFlag("fleet");
  const { status } = useFlags();
  const t = useTheme();
  if (status === "loading")
    return (
      <View
        accessibilityLabel="Loading"
        style={{ padding: 20, gap: 10, flex: 1, backgroundColor: t.colors.bg }}
      >
        <Skeleton height={28} width="60%" />
        <Skeleton height={120} />
      </View>
    );
  if (on) return <>{children}</>;
  return (
    <View
      testID={TEST_IDS.common.flagOff.screen}
      style={{
        flex: 1,
        padding: 24,
        justifyContent: "center",
        gap: 12,
        backgroundColor: t.colors.bg,
      }}
    >
      <Text variant="display" accessibilityRole="header">
        {UNAVAILABLE_TITLE}
      </Text>
      <Text variant="body" tone="text2">
        {UNAVAILABLE_BODY}
      </Text>
      <Button label="Back" kind="inverse" onPress={onDismiss} />
    </View>
  );
}

export function FleetUnavailable() {
  return (
    <Card testID={FLEET_TID.unavailable} accessibilityRole="summary">
      <Text variant="bodyStrong">{UNAVAILABLE_TITLE}</Text>
      <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
        {UNAVAILABLE_BODY}
      </Text>
    </Card>
  );
}

/** A refused action, or a confirmation, above the screen's content. */
export function ActionBanner({
  banner,
}: {
  banner: (Refusal & { tone: "error" | "warn" | "ok" }) | null;
}) {
  if (!banner) return null;
  return (
    <Banner
      testID={FLEET_TID.refusal}
      tone={banner.tone}
      title={banner.title}
      body={banner.body}
    />
  );
}

/** Last good data is still shown after a failed refresh — say how old it is. */
export function FreshnessBanner({
  failed,
  offline,
  asOf,
  zone,
}: {
  failed: boolean;
  offline: boolean;
  asOf: string | null;
  zone: string | null;
}) {
  if (!failed) return null;
  const since = asOf ? " · showing data from " + dateTimeIn(asOf, zone) : "";
  return (
    <Banner
      testID={offline ? FLEET_TID.offline : FLEET_TID.error}
      tone={offline ? "warn" : "error"}
      title={(offline ? "Offline" : "Couldn’t refresh") + since}
      body={
        offline
          ? "Actions are off until you’re back online."
          : "What you see may be out of date. Pull back in a moment."
      }
    />
  );
}

/**
 * C2b. Renders INSTEAD of a decision until the server acknowledged the driver as
 * parked. Returns null once parked, so the caller renders its controls.
 */
export function MotionLock({
  gate,
  waiting,
  deadline,
  zone,
}: {
  gate: MotionGate;
  /** e.g. "You have 1 proposal and 1 booking decision." */
  waiting: string;
  deadline: string | null;
  zone: string | null;
}) {
  if (gate.motion === "parked_confirmed") return null;
  const moving = gate.motion === "moving";
  return (
    <Card
      testID={FLEET_TID.motionLock}
      tone="warn"
      accessibilityRole="summary"
      style={{ gap: 6 }}
    >
      <Text variant="bodyStrong">
        {moving ? "Review when stopped" : "Confirm you’re stopped"}
      </Text>
      <Text variant="caption" tone="text2">
        {moving
          ? waiting + " They’ll open once you’re safely stationary."
          : waiting +
            " Your location signal is stale — confirm you’re safely parked to decide."}
      </Text>
      {deadline ? (
        <Text
          testID={FLEET_TID.motionDeadline}
          variant="bodySmStrong"
          accessibilityLabel={
            "Earliest deadline " +
            dateTimeIn(deadline, zone) +
            ", " +
            zoneNote(zone)
          }
        >
          {"Earliest deadline " + timeIn(deadline, zone)}
          <Text variant="caption" tone="text2">
            {" · " + dateTimeIn(deadline, zone).split(" · ")[0]}
          </Text>
        </Text>
      ) : null}
      {gate.confirmError ? (
        <Banner tone="error" body={gate.confirmError} />
      ) : null}
      <Button
        testID={FLEET_TID.motionParked}
        label="I am safely parked"
        kind="secondary"
        size="md"
        loading={gate.confirming}
        onPress={() => void gate.confirmParked()}
      />
    </Card>
  );
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
const DOTS = [0, 1, 2, 3, 4, 5];

export function PinPad({
  length,
  onDigit,
  onDelete,
  disabled,
}: {
  /** How many digits are entered — the digits themselves never reach the pad. */
  length: number;
  onDigit: (digit: string) => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View testID={FLEET_TID.pinPad} style={{ gap: 12 }}>
      <View
        accessible
        accessibilityLabel={length + " of up to 6 digits entered"}
        style={{ flexDirection: "row", justifyContent: "center", gap: 12 }}
      >
        {DOTS.map((i) => (
          <View
            key={"dot" + i}
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              borderWidth: 1.5,
              borderColor: i < length ? t.colors.text : t.colors.border,
              backgroundColor: i < length ? t.colors.text : "transparent",
              opacity: i < 4 || i < length ? 1 : 0.5,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {KEYS.map((key) =>
          key === "" ? (
            <View key="blank" style={{ width: "31%", height: t.targets.min }} />
          ) : (
            <Pressable
              key={key}
              testID={
                key === "del"
                  ? FLEET_TID.pinDelete
                  : dynamicTestId(FLEET_TID.pinKey, key)
              }
              accessibilityRole="button"
              accessibilityLabel={
                key === "del" ? "Delete digit" : "Digit " + key
              }
              accessibilityState={{ disabled: !!disabled }}
              disabled={disabled}
              onPress={() => (key === "del" ? onDelete() : onDigit(key))}
              style={({ pressed }) => ({
                width: "31%",
                height: Math.max(t.targets.min, 52),
                borderRadius: t.radius.control,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: pressed ? t.colors.bg2 : t.colors.card,
                borderWidth: 1,
                borderColor: t.colors.border,
                opacity: disabled ? 0.45 : 1,
              })}
            >
              <Text variant="heading">{key === "del" ? "⌫" : key}</Text>
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}
