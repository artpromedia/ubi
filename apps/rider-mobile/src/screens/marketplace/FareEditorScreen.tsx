// Design handoff R02 + R03 (handoff-marketplace/rn/rider/FareEditorScreen.tsx), adapted only for repo imports,
// contracts TEST_IDS, a controlled amount input (amountRaw) and a typed preset callback (the handoff stringified Money).
import React, { useState } from "react";
import { View, TextInput, type TextStyle } from "react-native";
import {
  Screen,
  Text,
  Card,
  Button,
  Chip,
  Banner,
  Sheet,
  MoneyText,
  Row,
  useTheme,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";

/** R02 + R03. Server owns bounds/validation; this renders QuoteEnvelope + field errors verbatim. */
export type QuoteEnvelope = {
  quoteId: string; // server
  suggestedFareMinor: Money;
  minimumFareMinor: Money;
  maximumFareMinor: Money; // server
  currency: string;
  expiresAt: string;
  pricingVersion: string; // server
  breakdown: { label: string; amountMinor: Money }[]; // server
};
export type FareEditorProps = {
  quote: QuoteEnvelope | null; // null → loading
  quoteState: "live" | "expired" | "route_changed"; // route_changed = new revision required, old offers void
  amountRaw: string;
  amountMinor: Money;
  onAmountChange: (raw: string) => void;
  fieldError: string | null; // e.g. server "Below the minimum for this route. Enter at least ₦2,400."
  belowSuggestionHint: string | null; // warn tone
  presets: { label: string; amountMinor: Money }[]; // server amounts, in-bounds
  onPresetSelect: (amountMinor: Money) => void;
  onRefreshQuote: () => void;
  onReview: () => void;
  onBack: () => void;
  review: {
    visible: boolean;
    payment: string;
    cancellation: string;
    publishing: boolean;
    publishError: string | null;
    onSend: () => void;
    onEdit: () => void;
    onDismiss: () => void;
  };
};

export function FareEditorScreen(p: FareEditorProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const expired = p.quoteState !== "live";
  return (
    <Screen title="Set your fare" onBack={p.onBack}>
      {p.quoteState === "expired" ? (
        <Banner
          tone="warn"
          title="Fare quote expired"
          body="Prices refresh every few minutes. Get an updated suggestion before publishing."
        />
      ) : null}
      {p.quoteState === "route_changed" ? (
        <Banner
          tone="warn"
          title="Route changed"
          body="Pricing restarted for the new route. Any offers on the old request were closed and their holds released."
        />
      ) : null}
      <Card
        style={{
          alignItems: "center",
          gap: 8,
          paddingVertical: 18,
          opacity: expired ? 0.55 : 1,
          borderColor: p.fieldError ? t.colors.error : undefined,
          borderWidth: p.fieldError ? 1.5 : undefined,
        }}
      >
        <View
          style={{
            backgroundColor: t.colors.bg2,
            borderRadius: t.radius.chip,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: t.colors.text3,
            paddingHorizontal: 9,
            paddingVertical: 4,
          }}
        >
          <Text variant="label" tone="text2">
            {p.quote ? "Suggested " : "Suggested —"}
            {p.quote ? (
              <MoneyText
                money={p.quote.suggestedFareMinor}
                variant="label"
                tone="text2"
              />
            ) : null}
          </Text>
        </View>
        <TextInput
          testID={TEST_IDS.mp.rider.fare.amountInput}
          accessibilityLabel="Requested fare amount"
          keyboardType="number-pad"
          editable={!expired}
          value={p.amountRaw}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChangeText={p.onAmountChange}
          style={[
            {
              ...t.type.money,
              fontVariant: [...t.type.money.fontVariant],
            } as TextStyle,
            {
              color: p.fieldError ? t.colors.errorInk : t.colors.text,
              borderBottomWidth: 2,
              borderBottomColor: p.fieldError
                ? t.colors.error
                : focused
                  ? t.colors.primary
                  : t.colors.border,
              paddingHorizontal: 10,
              textDecorationLine: expired ? "line-through" : "none",
            },
          ]}
        />
        {p.fieldError ? (
          <Text variant="caption" tone="errorInk">
            {p.fieldError}
          </Text>
        ) : p.belowSuggestionHint ? (
          <Text variant="caption" tone="warnInk">
            {p.belowSuggestionHint}
          </Text>
        ) : null}
        <Text
          testID={TEST_IDS.mp.rider.fare.minMaxHint}
          variant="caption"
          tone="text2"
        >
          {p.quote ? (
            <>
              Minimum{" "}
              <MoneyText
                money={p.quote.minimumFareMinor}
                variant="caption"
                tone="text2"
              />{" "}
              · Maximum{" "}
              <MoneyText
                money={p.quote.maximumFareMinor}
                variant="caption"
                tone="text2"
              />
            </>
          ) : (
            "Loading bounds…"
          )}
        </Text>
      </Card>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {p.presets.map((c, i) => (
          <Chip
            key={c.label}
            testID={dynamicTestId(TEST_IDS.mp.rider.fare.presetChip, i)}
            label={c.label}
            onPress={() => p.onPresetSelect(c.amountMinor)}
          />
        ))}
      </View>
      <Card testID={TEST_IDS.mp.rider.fare.breakdown}>
        {p.quote?.breakdown.map((b, i) => (
          <Row
            key={b.label}
            label={b.label}
            value={<MoneyText money={b.amountMinor} variant="bodySmStrong" />}
            last={i === p.quote!.breakdown.length - 1}
          />
        ))}
      </Card>
      {p.quote ? (
        <Text variant="caption" tone="text3">
          Quote refreshes {p.quote.expiresAt} · pricing {p.quote.pricingVersion}
        </Text>
      ) : null}
      {expired ? (
        <Button
          testID={TEST_IDS.mp.rider.fare.refreshQuote}
          label="Refresh quote"
          onPress={p.onRefreshQuote}
        />
      ) : (
        <Button
          testID={TEST_IDS.mp.rider.fare.review}
          label="Review request"
          disabled={!!p.fieldError || !p.quote}
          onPress={p.onReview}
        />
      )}
      <Sheet visible={p.review.visible} onDismiss={p.review.onDismiss}>
        <Text variant="title">Review request</Text>
        <Card style={{ marginTop: 12 }}>
          <Row
            label="Your requested fare"
            value={<MoneyText money={p.amountMinor} variant="heading" />}
          />
          <Row
            label="UBI suggested"
            value={
              p.quote ? (
                <MoneyText
                  money={p.quote.suggestedFareMinor}
                  variant="bodySmStrong"
                  tone="text2"
                />
              ) : null
            }
          />
          <Row label="Payment" value={p.review.payment} />
          <Row label="Cancellation" value={p.review.cancellation} last />
        </Card>
        <Banner
          tone="ok"
          body="Drivers can offer your price, lower, or higher. Nothing is booked until you choose an offer."
        />
        {p.review.publishError ? (
          <Banner tone="error" body={p.review.publishError} />
        ) : null}
        <Button
          testID={TEST_IDS.mp.rider.review.edit}
          label="Edit fare"
          kind="secondary"
          onPress={p.review.onEdit}
        />
        <Button
          testID={TEST_IDS.mp.rider.review.send}
          label="Send request"
          loading={p.review.publishing}
          onPress={p.review.onSend}
        />
      </Sheet>
    </Screen>
  );
}
