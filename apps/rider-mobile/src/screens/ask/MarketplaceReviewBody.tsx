import React from "react";
import { View } from "react-native";
import { Text, MoneyText, Row, Banner, useTheme } from "@ubi/mobile-ui";
import type { MarketplaceReview } from "../../api/ask";

/**
 * Design D01 Flow 5 · AskProposal — the structured marketplace proposal. Every
 * number is the server's persisted review (price, the driver's offer, the
 * bounds); the driver commission is its own line and is never added to the
 * rider's price. Nothing here computes money.
 */
export function MarketplaceReviewBody({
  review,
  secondsLeft,
}: {
  review: MarketplaceReview;
  secondsLeft: number;
}) {
  const t = useTheme();
  const selection = review.selection;
  const publish = review.publish;
  return (
    <View style={{ gap: 8 }} testID="ask.mpReview.body">
      <Banner
        tone="neutral"
        testID="ask.mpReview.statement"
        body={review.statement}
      />
      <View
        style={{
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: t.radius.card,
          paddingHorizontal: 12,
          paddingVertical: 2,
        }}
      >
        <Row
          label={selection ? "Your price for this offer" : "Fare you offer"}
          value={
            <MoneyText
              testID="ask.mpReview.price"
              money={review.price}
              variant="bodySmStrong"
            />
          }
        />
        {selection ? (
          <>
            <Row
              label="Driver's offer"
              value={<MoneyText money={selection.bidAmount} variant="bodySm" />}
            />
            <Row
              label="Driver commission"
              value={
                selection.commission.amount ? (
                  <MoneyText
                    money={selection.commission.amount}
                    variant="bodySm"
                  />
                ) : (
                  <Text
                    variant="caption"
                    tone="text2"
                    testID="ask.mpReview.commission"
                  >
                    Paid by the driver — not added to your price
                  </Text>
                )
              }
            />
            <Row
              label="Vehicle"
              value={selection.vehicle}
              last={secondsLeft <= 0}
            />
            {secondsLeft > 0 ? (
              <Row
                label="Offer held for"
                value={
                  Math.floor(secondsLeft / 60) +
                  ":" +
                  String(secondsLeft % 60).padStart(2, "0")
                }
                last
              />
            ) : null}
          </>
        ) : null}
        {publish ? (
          <>
            <Row
              label="Allowed range"
              value={
                <Text variant="bodySm">
                  <MoneyText money={publish.bounds.minimum} variant="bodySm" />
                  {" – "}
                  <MoneyText money={publish.bounds.maximum} variant="bodySm" />
                </Text>
              }
            />
            <Row label="Vehicle" value={publish.vehicleClass} last />
          </>
        ) : null}
      </View>
      {selection ? (
        <Text variant="caption" tone="text2">
          {selection.commission.note}
        </Text>
      ) : null}
      {review.awardsNothing ? (
        <Text variant="caption" tone="text2" testID="ask.mpReview.noAward">
          Publishing asks drivers for offers. No driver is booked until you
          approve one.
        </Text>
      ) : null}
    </View>
  );
}
