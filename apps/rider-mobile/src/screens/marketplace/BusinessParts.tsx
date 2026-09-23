// A06 part C — organization billing pieces: the verdict the SERVER gave for a business quote
// (allowed / refused with every reason / unavailable — an unanswered check is never shown as
// allowed), and the requester's card on a published business request (who pays, and where the
// organization's budget stands). The app never computes a budget, a cap or what is left.
import React from "react";
import { View } from "react-native";
import { Card, MoneyText, Text } from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";
import type { MpQuoteEnvelope, MpRequest } from "../../api/marketplace";
import { businessFundingText, businessReasonText } from "./confidenceCopy";
import { StateTag } from "./riderParts";

const TID = TEST_IDS.mp.rider.business;

type BusinessCheck = NonNullable<MpQuoteEnvelope["business"]>;

/**
 * The organization's advisory verdict at the quote's suggested fare. `atOtherFare`: refused only
 * for amount reasons (per-trip cap, budget left) at a fare the rider is no longer sending — the
 * server checks the fare they send instead, so the verdict says what it was checked at.
 */
export function BusinessVerdict({
  check,
  organizationName,
  atOtherFare = false,
}: {
  check: BusinessCheck;
  organizationName: string;
  atOtherFare?: boolean;
}) {
  const tag =
    check.status === "allowed"
      ? { label: "Within the travel policy", tone: "ok" as const }
      : check.status === "refused"
        ? atOtherFare
          ? {
              label: "Over the policy at the suggested fare",
              tone: "warn" as const,
            }
          : {
              label: "Not bookable on " + organizationName,
              tone: "error" as const,
            }
        : { label: "Policy check unavailable", tone: "warn" as const };
  return (
    <View testID={TID.verdict} style={{ gap: 4 }}>
      <StateTag label={tag.label} tone={tag.tone} />
      {check.status === "refused"
        ? check.reasons.map((r) => (
            <Text key={r} variant="caption" tone="errorInk">
              {businessReasonText(r)}
            </Text>
          ))
        : null}
      {check.status !== "unavailable" ? (
        <Text variant="caption" tone="text2">
          {"Checked at the suggested fare of "}
          <MoneyText
            money={check.checkedAmountMinor}
            variant="caption"
            tone="text2"
          />
          {atOtherFare
            ? ". Your fare is different, so it is checked again when you send — the request is refused then if it is still outside the policy."
            : "."}
        </Text>
      ) : null}
      {check.status === "allowed" && check.available ? (
        <Text variant="caption" tone="text2">
          {"Budget available on this cost centre: "}
          <MoneyText money={check.available} variant="caption" tone="text2" />
        </Text>
      ) : null}
      <Text variant="caption" tone="text3">
        {check.note}
      </Text>
    </View>
  );
}

/** The requester's view of a published business request (never on a driver surface). */
export function BusinessRequestCard({
  business,
}: {
  business: NonNullable<MpRequest["business"]>;
}) {
  return (
    <Card testID={TID.section} style={{ gap: 4 }}>
      <Text variant="label" tone="text3">
        Billed to your organization
      </Text>
      <Text variant="caption" tone="text2">
        {[
          business.costCentreId ? "Cost centre " + business.costCentreId : null,
          business.expenseCategory,
        ]
          .filter(Boolean)
          .join(" · ") || "Default cost centre"}
      </Text>
      <Text variant="caption" tone="text2">
        {businessFundingText(business)}
      </Text>
    </Card>
  );
}
