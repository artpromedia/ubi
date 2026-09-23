// A02 rider route-change composer — presentational. The rider edits only what is still
// ahead: the remaining stops (reorder, remove, add a pinned stop) and the destination.
// Stops already reached are history and are not shown as editable. Nothing here carries
// a price: sending asks UBI to price the change and check the driver's next job; the
// proposal then waits for both approvals while the original agreement stays in force.
import React from "react";
import { View } from "react-native";
import { Banner, Button, Card, Screen, Text } from "@ubi/mobile-ui";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { Refusal } from "./riderCopy";
import { LoadingBlocks, UnavailableCard } from "./riderParts";

const TID = TEST_IDS.mp.rider.change;

export type ChangeStopRow = {
  key: string;
  label: string;
  detail: string;
  isNew: boolean;
};

export type ProposeChangeProps = {
  loading: boolean;
  unavailable: { title: string; body: string } | null;
  reachedNote: string | null;
  stops: ChangeStopRow[];
  onUp: (key: string) => void;
  onDown: (key: string) => void;
  onRemove: (key: string) => void;
  onAdd: (() => void) | null;
  addNote: string | null;
  dropoffLabel: string;
  dropoffChanged: boolean;
  onEditDropoff: () => void;
  changed: boolean;
  busy: boolean;
  refusal: Refusal | null;
  onSend: () => void;
  onCancel: () => void;
};

export function ProposeChangeScreen(p: ProposeChangeProps) {
  if (p.loading)
    return (
      <Screen title="Change your route" onBack={p.onCancel}>
        <LoadingBlocks heights={[120, 90]} />
      </Screen>
    );
  if (p.unavailable)
    return (
      <Screen title="Change your route" onBack={p.onCancel}>
        <UnavailableCard
          testID={TID.unavailable}
          title={p.unavailable.title}
          body={p.unavailable.body}
          action={{ label: "Back to your trip", onPress: p.onCancel }}
        />
      </Screen>
    );
  return (
    <Screen
      title="Change your route"
      subtitle="A proposal — your driver approves it too"
      onBack={p.onCancel}
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        <Banner
          testID={TID.inForce}
          tone="info"
          body="Your current agreement stays in force until this change commits. UBI prices the change and checks your driver’s next pickup before anyone is asked to approve."
        />
        {p.reachedNote ? (
          <Text variant="caption" tone="text2">
            {p.reachedNote}
          </Text>
        ) : null}
        <Card style={{ gap: 8 }}>
          <Text variant="label" tone="text3">
            Stops still ahead
          </Text>
          {p.stops.length === 0 ? (
            <Text variant="bodySm" tone="text2">
              No stops ahead.
            </Text>
          ) : null}
          {p.stops.map((s, i) => (
            <View
              key={s.key}
              testID={dynamicTestId(TID.stop, s.key)}
              accessibilityLabel={
                "Stop " + (i + 1) + ": " + s.label + (s.isNew ? ", new" : "")
              }
              style={{ gap: 6 }}
            >
              <Text variant="bodySmStrong">
                {i + 1 + ". " + s.label + (s.isNew ? " · new" : "")}
              </Text>
              <Text variant="caption" tone="text2">
                {s.detail}
              </Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Button
                  testID={dynamicTestId(TID.up, s.key)}
                  label="Up"
                  accessibilityLabel={"Move " + s.label + " earlier"}
                  kind="secondary"
                  size="md"
                  disabled={i === 0}
                  onPress={() => p.onUp(s.key)}
                />
                <Button
                  testID={dynamicTestId(TID.down, s.key)}
                  label="Down"
                  accessibilityLabel={"Move " + s.label + " later"}
                  kind="secondary"
                  size="md"
                  disabled={i === p.stops.length - 1}
                  onPress={() => p.onDown(s.key)}
                />
                <Button
                  testID={dynamicTestId(TID.remove, s.key)}
                  label="Remove"
                  accessibilityLabel={"Remove " + s.label}
                  kind="danger"
                  size="md"
                  onPress={() => p.onRemove(s.key)}
                />
              </View>
            </View>
          ))}
          {p.onAdd ? (
            <Button
              testID={TID.add}
              label="+ Add a stop"
              kind="secondary"
              size="md"
              onPress={p.onAdd}
            />
          ) : null}
          {p.addNote ? (
            <Text variant="caption" tone="text2">
              {p.addNote}
            </Text>
          ) : null}
        </Card>
        <Card style={{ gap: 6 }}>
          <Text variant="label" tone="text3">
            Destination
          </Text>
          <Text testID={TID.dropoff} variant="bodySmStrong">
            {p.dropoffLabel + (p.dropoffChanged ? " · new" : "")}
          </Text>
          <Button
            testID={TID.editDropoff}
            label="Change destination on the map"
            kind="ghost"
            size="md"
            onPress={p.onEditDropoff}
          />
        </Card>
        {p.refusal ? (
          <Banner
            testID={TID.refusal}
            tone="error"
            title={p.refusal.title}
            body={p.refusal.body}
          />
        ) : null}
        <Button
          testID={TID.send}
          label="Get the price and propose"
          disabled={!p.changed}
          loading={p.busy}
          onPress={p.onSend}
        />
        <Button
          testID={TID.cancel}
          label="Keep my current route"
          kind="secondary"
          onPress={p.onCancel}
        />
      </View>
    </Screen>
  );
}
