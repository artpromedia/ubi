import React from "react";
import { Pressable, View } from "react-native";
import {
  Card,
  Text,
  StatusPill,
  MoneyText,
  Chip,
  useTheme,
  type StatusKey,
} from "@ubi/mobile-ui";
import { TEST_IDS as TID, dynamicTestId } from "@ubi/contracts";
import type { LinkedItem } from "../../api/travel";
import { StateTag } from "../../screens/marketplace/riderParts";
import { LINKED_STATUS_WORD } from "../../screens/travel/transferCopy";

/**
 * Board 21c/21e. One card per order/reservation with its own status word, refs, policy and actions.
 * An `airport_transfer` item (travel-v2 LinkedItem) prints its own transfer word — pending / sent
 * to drivers / driver confirmed — and opens the transfer; it is a separate order from the flight.
 */
export function ItemCard({
  item,
  onAction,
  onOpen,
}: {
  item: LinkedItem;
  onAction: (key: string) => void;
  /** Opens the item's own screen (an airport transfer's status). */
  onOpen?: () => void;
}) {
  useTheme();
  const ride =
    item.kind === "ride_reservation" || item.kind === "airport_transfer";
  const tone = ride ? "primaryInk" : "travelInk";
  const word = LINKED_STATUS_WORD[item.status];
  const actions = item.actions ?? [];
  const card = (
    <Card
      testID={
        item.kind === "airport_transfer" && item.transferId
          ? dynamicTestId(TID.travel.transfer.linkedItem, item.transferId)
          : ride
            ? TID.travel.linked.ride
            : TID.travel.itinerary.item
      }
      tone={
        item.status === "not_reserved" || item.status === "failed"
          ? "error"
          : "default"
      }
      style={{ gap: 6, opacity: item.status === "not_booked" ? 0.75 : 1 }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text variant="label" tone={tone} style={{ flex: 1 }}>
          {item.dateLabel ?? ""}
        </Text>
        {word ? (
          <StateTag label={word.label} tone={word.tone} />
        ) : (
          <StatusPill status={item.status as StatusKey} />
        )}
      </View>
      <Text variant="heading">{item.title}</Text>
      {item.subtitle ? (
        <Text variant="caption" tone="text2">
          {item.subtitle}
        </Text>
      ) : null}
      {item.kind === "airport_transfer" && !item.driverSecured ? (
        <Text variant="caption" tone="text2">
          No driver is secured for this ride yet.
        </Text>
      ) : null}
      {item.refs ? (
        <Text variant="caption" tone="text2">
          {item.refs}
        </Text>
      ) : null}
      {item.charged ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text variant="caption" tone="text2">
            Charged
          </Text>
          <MoneyText money={item.charged} variant="bodySmStrong" />
        </View>
      ) : null}
      {item.policy ? (
        <Text variant="caption" tone="text2">
          {item.policy}
        </Text>
      ) : null}
      {item.disruption ? (
        <Text variant="caption" tone="text2">
          {item.disruption}
        </Text>
      ) : null}
      {actions.length ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 4,
          }}
        >
          {actions.map((a) => (
            <Chip
              key={a.key}
              label={a.label}
              selected={a.primary}
              onPress={() => onAction(a.key)}
            />
          ))}
        </View>
      ) : null}
    </Card>
  );
  return onOpen ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title + ". " + (word?.label ?? item.status)}
      onPress={onOpen}
    >
      {card}
    </Pressable>
  ) : (
    card
  );
}
