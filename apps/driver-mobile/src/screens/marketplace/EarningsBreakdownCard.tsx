// A04.1 offer earnings breakdown (design handoff flow 9 "StopOffer card"). Renders the
// SERVER-composed breakdown field by field: gross, the 10% UBI commission, the fleet
// remittance (an explicit "None" with the server's reason — never a number the client
// made up), the estimated net, the unpaid pickup, the paid route, stop waiting and the
// per-hour estimate. Every amount is a server Money rendered by MoneyText; every
// distance/time line is a server-phrased label. Nothing here adds, subtracts,
// multiplies or divides money — a breakdown that looks inconsistent is shown exactly
// as the server sent it (the server is the one place that arithmetic happens).
import React from "react";
import { View } from "react-native";
import { Text, Row, MoneyText } from "@ubi/mobile-ui";
import { bpsToPercent } from "@ubi/mobile-core";
import { dynamicTestId } from "@ubi/contracts";
import type { MpEarningsBreakdown } from "../../api/marketplace";
import { MP_DRIVER_TID } from "./testIds";

export type EarningsBreakdownProps = {
  earnings: MpEarningsBreakdown;
  /** compact: the feed card's three lines; full: every row (request detail). */
  variant: "compact" | "full";
  /** List items append their id so every card's rows stay addressable. */
  idSuffix?: string;
};

const tid = (base: string, suffix?: string) =>
  suffix ? dynamicTestId(base, suffix) : base;

/** The one word every estimated figure carries. Colour never carries meaning alone. */
function EstimateTag() {
  return (
    <Text variant="caption" tone="text3">
      {" "}
      estimate
    </Text>
  );
}

export function EarningsBreakdownCard({
  earnings,
  variant,
  idSuffix,
}: EarningsBreakdownProps) {
  const e = earnings;
  const fleetNone = e.fleetRemittance.status === "none";
  if (variant === "compact") {
    return (
      <View
        testID={tid(MP_DRIVER_TID.earnings.card, idSuffix)}
        style={{ gap: 2 }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            flexWrap: "wrap",
          }}
        >
          <Text variant="caption" tone="text2">
            You keep{" "}
          </Text>
          <MoneyText
            testID={tid(MP_DRIVER_TID.earnings.net, idSuffix)}
            money={e.estimatedNetMinor}
            variant="bodySmStrong"
            tone="ok"
          />
          <EstimateTag />
          <Text variant="caption" tone="text2">
            {" · UBI fee "}
          </Text>
          <MoneyText
            testID={tid(MP_DRIVER_TID.earnings.commission, idSuffix)}
            money={e.commissionMinor}
            variant="caption"
            tone="text2"
          />
          <Text
            testID={tid(MP_DRIVER_TID.earnings.fleet, idSuffix)}
            variant="caption"
            tone="text2"
          >
            {fleetNone ? " · fleet share none" : ""}
          </Text>
        </View>
        <Text
          testID={tid(MP_DRIVER_TID.earnings.pickup, idSuffix)}
          variant="caption"
          tone="text2"
        >
          {e.pickup.label}
        </Text>
        {e.route ? (
          <Text
            testID={tid(MP_DRIVER_TID.earnings.route, idSuffix)}
            variant="caption"
            tone="text2"
          >
            {e.route.label + " · " + e.route.waitingLabel}
          </Text>
        ) : null}
        {e.estimatedNetPerHour ? (
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <Text variant="caption" tone="text2">
              ≈{" "}
            </Text>
            <MoneyText
              testID={tid(MP_DRIVER_TID.earnings.perHour, idSuffix)}
              money={e.estimatedNetPerHour.amountMinor}
              variant="caption"
              tone="text2"
            />
            <Text variant="caption" tone="text2">
              /h
            </Text>
            <EstimateTag />
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <View testID={tid(MP_DRIVER_TID.earnings.card, idSuffix)}>
      <Row
        label={
          e.grossBasis === "requested_fare"
            ? "Fare · requester's price"
            : "Fare · this offer"
        }
        value={
          <MoneyText
            testID={tid(MP_DRIVER_TID.earnings.gross, idSuffix)}
            money={e.grossMinor}
            variant="bodySmStrong"
          />
        }
      />
      <Row
        label={"UBI commission · " + bpsToPercent(e.commissionBps)}
        value={
          <MoneyText
            testID={tid(MP_DRIVER_TID.earnings.commission, idSuffix)}
            money={e.commissionMinor}
            variant="bodySmStrong"
            tone="warnInk"
          />
        }
      />
      <Row
        testID={tid(MP_DRIVER_TID.earnings.fleet, idSuffix)}
        label="Fleet remittance"
        value={fleetNone ? "None" : ""}
      />
      {fleetNone ? (
        <Text variant="caption" tone="text3">
          {e.fleetRemittance.reason}
        </Text>
      ) : null}
      <Row
        label="Estimated net"
        value={
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <MoneyText
              testID={tid(MP_DRIVER_TID.earnings.net, idSuffix)}
              money={e.estimatedNetMinor}
              variant="bodySmStrong"
              tone="ok"
            />
            <EstimateTag />
          </View>
        }
      />
      <Row
        label="Pickup"
        value={
          <Text
            testID={tid(MP_DRIVER_TID.earnings.pickup, idSuffix)}
            variant="bodySm"
            tone="text2"
            style={{ flexShrink: 1, textAlign: "right" }}
          >
            {e.pickup.label}
          </Text>
        }
      />
      <Row
        label="Paid route"
        value={
          <Text
            testID={tid(MP_DRIVER_TID.earnings.route, idSuffix)}
            variant="bodySm"
            tone="text2"
            style={{ flexShrink: 1, textAlign: "right" }}
          >
            {e.route ? e.route.label : "Route details unavailable"}
          </Text>
        }
      />
      {e.route ? (
        <Row
          label="Stops & waiting"
          value={
            <Text
              testID={tid(MP_DRIVER_TID.earnings.waiting, idSuffix)}
              variant="bodySm"
              tone="text2"
            >
              {e.route.waitingLabel}
            </Text>
          }
        />
      ) : null}
      <Row
        label="Net per hour"
        last
        value={
          e.estimatedNetPerHour ? (
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <MoneyText
                testID={tid(MP_DRIVER_TID.earnings.perHour, idSuffix)}
                money={e.estimatedNetPerHour.amountMinor}
                variant="bodySmStrong"
              />
              <Text variant="bodySm" tone="text2">
                /h
              </Text>
              <EstimateTag />
            </View>
          ) : (
            <Text variant="bodySm" tone="text3">
              Not estimated
            </Text>
          )
        }
      />
      {e.estimatedNetPerHour ? (
        <Text variant="caption" tone="text3">
          {e.estimatedNetPerHour.basis}
        </Text>
      ) : null}
      <Text
        testID={tid(MP_DRIVER_TID.earnings.costs, idSuffix)}
        variant="caption"
        tone="text3"
      >
        {e.runningCosts.reason}
      </Text>
      <Text variant="caption" tone="text3">
        {e.disclaimer}
      </Text>
    </View>
  );
}
