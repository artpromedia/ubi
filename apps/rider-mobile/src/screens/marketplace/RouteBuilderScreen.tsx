// A02 RouteBuilder (design handoff flow 7) — presentational. Pickup → reorderable
// intermediate stops (label, purpose, expected wait) → destination, then the SERVER's
// quote for the complete ordered route: routed distance and duration, expected stop
// waiting, fare bounds and breakdown, all rendered verbatim. In `revise` mode (an open
// request, before award) it also states the consequence — every current offer closes
// and drivers must offer again on the new route. Money reaches this file only as server
// Money objects and leaves only through MoneyText.
import React from "react";
import { TextInput, View, type TextStyle } from "react-native";
import {
  Banner,
  Button,
  Card,
  Chip,
  MoneyText,
  Row,
  Screen,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import { accessibleMoney, type Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId, type MpStopPurpose } from "@ubi/contracts";
import { DWELL_CHOICES, STOP_PURPOSES, type Refusal } from "./riderCopy";
import {
  LoadingBlocks,
  RouteList,
  UnavailableCard,
  type RoutePoint,
} from "./riderParts";

const TID = TEST_IDS.mp.rider.route;

export type RouteStopRow = {
  key: string;
  label: string;
  purpose: MpStopPurpose;
  dwellSec: number | undefined;
};

export type RouteQuoteSummary = {
  distance: string;
  duration: string;
  /** Expected waiting at the stops, priced as route time (null: no stops). */
  stopWaiting: string | null;
  minimumFareMinor: Money;
  suggestedFareMinor: Money;
  maximumFareMinor: Money;
  breakdown: { label: string; amountMinor: Money }[];
  /** The ordered route exactly as the server priced it. */
  route: RoutePoint[];
};

export type RouteBuilderProps = {
  mode: "new" | "revise";
  loading: boolean;
  /** The multi-stop capability is off here: stops can't be added. */
  unavailable: { onDirect: (() => void) | null } | null;
  pickupLabel: string;
  dropoffLabel: string;
  onEditPickup: (() => void) | null;
  onEditDropoff: (() => void) | null;
  stops: RouteStopRow[];
  onStopLabel: (key: string, label: string) => void;
  onStopPurpose: (key: string, purpose: MpStopPurpose) => void;
  onStopDwell: (key: string, dwellSec: number | undefined) => void;
  onMove: (key: string, by: -1 | 1) => void;
  onRemove: (key: string) => void;
  canAddStop: boolean;
  onAddStop: () => void;
  /** The market's limit as the server stated it, once it has. */
  stopLimitNote: string | null;
  quoting: boolean;
  onGetQuote: () => void;
  summary: RouteQuoteSummary | null;
  /** The route changed after the price was fetched. */
  outdated: boolean;
  refusal: Refusal | null;
  /** new mode: publish now or book for later with this exact route. */
  next: {
    onContinue: () => void;
    onLater: (() => void) | null;
  } | null;
  /** revise mode: fare to keep on the revised request + the consequence. */
  revise: {
    liveOffers: number;
    choices: { key: string; label: string; money: Money }[];
    selected: string | null;
    onSelect: (key: string) => void;
    busy: boolean;
    onRevise: () => void;
  } | null;
  onBack: () => void;
};

export function RouteBuilderScreen(p: RouteBuilderProps) {
  const t = useTheme();
  const title = p.mode === "revise" ? "Edit your route" : "Plan your route";
  if (p.loading)
    return (
      <Screen title={title} onBack={p.onBack}>
        <LoadingBlocks heights={[160, 120]} />
      </Screen>
    );
  if (p.unavailable)
    return (
      <Screen title={title} onBack={p.onBack}>
        <UnavailableCard
          testID={TID.unavailable}
          title="Stops aren’t available here yet"
          body={
            p.mode === "revise"
              ? "Adding or changing stops isn’t offered in your city right now. Your request and its offers are unchanged."
              : "Adding stops isn’t offered in your city right now. You can still book a direct ride from your pickup to your destination."
          }
          action={
            p.unavailable.onDirect
              ? {
                  label: "Continue with a direct ride",
                  onPress: p.unavailable.onDirect,
                  testID: TID.direct,
                }
              : undefined
          }
        />
      </Screen>
    );
  const labelInput = (row: RouteStopRow) => (
    <TextInput
      testID={dynamicTestId(TID.stopLabel, row.key)}
      value={row.label}
      onChangeText={(v) => p.onStopLabel(row.key, v)}
      accessibilityLabel="Stop name, optional"
      placeholder="Name this stop (optional)"
      placeholderTextColor={t.colors.text3}
      maxLength={80}
      style={[
        t.type.bodySm as TextStyle,
        {
          color: t.colors.text,
          borderBottomWidth: 1,
          borderBottomColor: t.colors.border,
          paddingVertical: 6,
        },
      ]}
    />
  );
  return (
    <Screen
      title={title}
      subtitle={
        p.mode === "revise"
          ? "Same pickup and destination · change the stops in between"
          : "Pickup, stops in order, then your destination"
      }
      onBack={p.onBack}
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        <Card style={{ gap: 10 }}>
          <Row
            testID={TID.pickup}
            label="Pickup"
            value={p.pickupLabel}
            onPress={p.onEditPickup ?? undefined}
            accessibilityLabel={"Pickup: " + p.pickupLabel}
          />
          {p.onEditPickup ? (
            <Button
              testID={TID.editPickup}
              label="Change pickup on the map"
              kind="ghost"
              size="md"
              onPress={p.onEditPickup}
            />
          ) : null}
          {p.stops.map((row, i) => (
            <View
              key={row.key}
              testID={dynamicTestId(TID.stop, row.key)}
              accessibilityLabel={
                "Stop " + (i + 1) + (row.label ? ": " + row.label : "")
              }
              style={{
                gap: 6,
                paddingVertical: 8,
                borderTopWidth: 1,
                borderTopColor: t.colors.divider,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Text variant="bodySmStrong" style={{ flex: 1 }}>
                  {"Stop " + (i + 1)}
                </Text>
                <Button
                  testID={dynamicTestId(TID.stopUp, row.key)}
                  label="Up"
                  accessibilityLabel={"Move stop " + (i + 1) + " earlier"}
                  kind="secondary"
                  size="md"
                  disabled={i === 0}
                  onPress={() => p.onMove(row.key, -1)}
                />
                <Button
                  testID={dynamicTestId(TID.stopDown, row.key)}
                  label="Down"
                  accessibilityLabel={"Move stop " + (i + 1) + " later"}
                  kind="secondary"
                  size="md"
                  disabled={i === p.stops.length - 1}
                  onPress={() => p.onMove(row.key, 1)}
                />
                <Button
                  testID={dynamicTestId(TID.stopRemove, row.key)}
                  label="Remove"
                  accessibilityLabel={"Remove stop " + (i + 1)}
                  kind="danger"
                  size="md"
                  onPress={() => p.onRemove(row.key)}
                />
              </View>
              {labelInput(row)}
              <Text variant="label" tone="text3">
                What’s this stop for?
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {STOP_PURPOSES.map((opt) => (
                  <Chip
                    key={opt.code}
                    testID={dynamicTestId(
                      TID.stopPurpose,
                      row.key + "." + opt.code,
                    )}
                    label={opt.label}
                    selected={row.purpose === opt.code}
                    onPress={() => p.onStopPurpose(row.key, opt.code)}
                  />
                ))}
              </View>
              <Text variant="label" tone="text3">
                Expected wait
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {DWELL_CHOICES.map((opt) => (
                  <Chip
                    key={opt.label}
                    testID={dynamicTestId(
                      TID.stopDwell,
                      row.key + "." + (opt.sec ?? "standard"),
                    )}
                    label={opt.label}
                    selected={row.dwellSec === opt.sec}
                    onPress={() => p.onStopDwell(row.key, opt.sec)}
                  />
                ))}
              </View>
            </View>
          ))}
          <Button
            testID={TID.addStop}
            label="+ Add stop"
            kind="secondary"
            size="md"
            disabled={!p.canAddStop}
            onPress={p.onAddStop}
          />
          {p.stopLimitNote ? (
            <Text testID={TID.stopLimit} variant="caption" tone="warnInk">
              {p.stopLimitNote}
            </Text>
          ) : null}
          <Row
            testID={TID.dropoff}
            label="Destination"
            value={p.dropoffLabel}
            onPress={p.onEditDropoff ?? undefined}
            accessibilityLabel={"Destination: " + p.dropoffLabel}
            last={!p.onEditDropoff}
          />
          {p.onEditDropoff ? (
            <Button
              testID={TID.editDropoff}
              label="Change destination on the map"
              kind="ghost"
              size="md"
              onPress={p.onEditDropoff}
            />
          ) : null}
          <Text variant="caption" tone="text3">
            Waiting you expect at a stop is priced as trip time. Longer waits
            beyond it are paid only up to what you approve.
          </Text>
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
          testID={TID.getQuote}
          label={
            p.summary ? "Get an updated price" : "Get a price for this route"
          }
          kind={p.summary && !p.outdated ? "secondary" : "primary"}
          loading={p.quoting}
          onPress={p.onGetQuote}
        />
        {p.summary ? (
          <Card testID={TID.summary} style={{ gap: 8 }}>
            {p.outdated ? (
              <Banner
                testID={TID.outdated}
                tone="warn"
                title="Route changed"
                body="This price is for the route before your last change. Get an updated price to continue."
              />
            ) : null}
            <Text variant="label" tone="text3">
              Priced by UBI for this exact route
            </Text>
            <RouteList points={p.summary.route} />
            <Row
              testID={TID.distance}
              label="Full route distance"
              value={p.summary.distance}
            />
            <Row
              testID={TID.duration}
              label="Estimated duration"
              value={p.summary.duration}
            />
            {p.summary.stopWaiting ? (
              <Row
                testID={TID.stopWaiting}
                label="Expected waiting at stops"
                value={p.summary.stopWaiting}
              />
            ) : null}
            <View
              testID={TID.bounds}
              accessible
              // A grouped element is read by its label ONLY — the amounts must be in it.
              accessibilityLabel={[
                "Fare range for this route",
                "minimum " + accessibleMoney(p.summary.minimumFareMinor),
                "suggested " + accessibleMoney(p.summary.suggestedFareMinor),
                "maximum " + accessibleMoney(p.summary.maximumFareMinor),
              ].join(", ")}
              style={{ gap: 2 }}
            >
              <Row
                label="Minimum fare"
                value={
                  <MoneyText
                    money={p.summary.minimumFareMinor}
                    variant="bodySmStrong"
                  />
                }
              />
              <Row
                label="Suggested fare"
                value={
                  <MoneyText
                    money={p.summary.suggestedFareMinor}
                    variant="bodySmStrong"
                  />
                }
              />
              <Row
                label="Maximum fare"
                value={
                  <MoneyText
                    money={p.summary.maximumFareMinor}
                    variant="bodySmStrong"
                  />
                }
                last={p.summary.breakdown.length === 0}
              />
            </View>
            {p.summary.breakdown.length ? (
              <View testID={TID.breakdown}>
                <Text variant="label" tone="text3" style={{ marginTop: 6 }}>
                  How the suggestion is built
                </Text>
                {p.summary.breakdown.map((line, i) => (
                  <Row
                    key={line.label + i}
                    label={line.label}
                    value={
                      <MoneyText money={line.amountMinor} variant="bodySm" />
                    }
                    last={i === p.summary!.breakdown.length - 1}
                  />
                ))}
              </View>
            ) : null}
          </Card>
        ) : null}
        {p.revise && p.summary ? (
          <Card style={{ gap: 10 }}>
            <Banner
              testID={TID.reoffer}
              tone="warn"
              title="Drivers must offer again"
              body={
                (p.revise.liveOffers > 0
                  ? "Your " +
                    p.revise.liveOffers +
                    (p.revise.liveOffers === 1
                      ? " current offer"
                      : " current offers") +
                    " will close. "
                  : "") +
                "Offers were made for your old route, so changing it closes every offer and releases any hold on a driver’s wallet. Drivers who want this trip offer again on the new route."
              }
            />
            <Text variant="label" tone="text3">
              Your fare on the new route
            </Text>
            {p.revise.choices.map((c) => (
              <Chip
                key={c.key}
                testID={dynamicTestId(TID.fareChoice, c.key)}
                label={c.label}
                selected={p.revise!.selected === c.key}
                onPress={() => p.revise!.onSelect(c.key)}
              />
            ))}
            {p.revise.choices.map((c) =>
              p.revise!.selected === c.key ? (
                <View
                  key={c.key}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Text variant="bodySm" tone="text2" style={{ flex: 1 }}>
                    You’ll ask
                  </Text>
                  <MoneyText money={c.money} variant="title" />
                </View>
              ) : null,
            )}
            <Button
              testID={TID.revise}
              label="Update route · drivers re-offer"
              disabled={p.outdated || !p.revise.selected}
              loading={p.revise.busy}
              onPress={p.revise.onRevise}
            />
          </Card>
        ) : null}
        {p.next && p.summary ? (
          <View style={{ gap: 8 }}>
            <Button
              testID={TID.continue}
              label="Set your fare"
              disabled={p.outdated}
              onPress={p.next.onContinue}
            />
            {p.next.onLater ? (
              <Button
                testID={TID.later}
                label="Book for later instead"
                kind="secondary"
                disabled={p.outdated}
                onPress={p.next.onLater}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
