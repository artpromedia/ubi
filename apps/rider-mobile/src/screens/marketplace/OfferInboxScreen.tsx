// Design handoff R04 + R07 (handoff-marketplace/rn/rider/OfferInboxScreen.tsx), adapted only for repo imports and contracts TEST_IDS.
import React from "react";
import { View, FlatList, Pressable } from "react-native";
import {
  Screen,
  Text,
  Card,
  Button,
  Chip,
  Banner,
  StatusPill,
  Skeleton,
  MoneyText,
  useTheme,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";

/** R04 + R07. List order is STABLE across updates (sort applies on explicit toggle only, never mid-touch). */
export type Offer = {
  bidId: string;
  bidVersion: number; // server
  driverName: string;
  rating: string;
  trips: number;
  vehicle: string;
  initials: string;
  amountMinor: Money;
  deltaLabel: string | null; // e.g. "+₦200" (server-phrased)
  kind: "immediate" | "finishing_trip"; // R09 branch
  pickupLabel: string; // "Pickup in 4 min · 1.2 km away" | "Pickup window 12–18 min"
  expiresLabel: string;
  withdrawn: boolean;
};
export type OfferInboxProps = {
  phase: "searching" | "offers" | "no_offers" | "winner_unavailable";
  connection: "online" | "reconnecting";
  requestedMinor: Money;
  elapsedLabel: string;
  expiresLabel: string;
  envelopeLabel: string; // "Eligible drivers within 3 km can see your request"
  widenedBanner: string | null; // R09 expansion, preserves existing bids
  sort: "price" | "eta";
  onSort: (s: "price" | "eta") => void;
  offers: Offer[];
  onOpenOffer: (bidId: string) => void;
  unavailableNotice: string | null; // R07b, includes release confirmation copy
  onCancel: () => void;
  onRepost: (kind: "suggested" | "same_wider") => void;
};

export function OfferInboxScreen(p: OfferInboxProps) {
  const t = useTheme();
  if (p.phase === "no_offers") {
    return (
      <Screen title="No offers yet">
        <Text variant="body" tone="text2">
          Your request expired without offers. A fare closer to the suggestion
          usually gets answers faster.
        </Text>
        <Button
          testID={TEST_IDS.mp.rider.offers.repost}
          label="Repost at suggested fare"
          onPress={() => p.onRepost("suggested")}
        />
        <Button
          label="Repost same fare · wider search"
          kind="secondary"
          onPress={() => p.onRepost("same_wider")}
        />
      </Screen>
    );
  }
  return (
    <Screen
      title={
        p.phase === "searching"
          ? "Your request is live"
          : p.offers.length + " offers"
      }
      subtitle={"Expires " + p.expiresLabel}
      action={
        p.connection === "reconnecting"
          ? undefined
          : {
              label: "Cancel",
              onPress: p.onCancel,
              testID: TEST_IDS.mp.rider.offers.cancelRequest,
            }
      }
      scroll={false}
    >
      <View style={{ paddingHorizontal: 20, gap: 12, flex: 1 }}>
        {p.connection === "reconnecting" ? (
          <Banner
            tone="neutral"
            body="Showing your last synced offers. Choosing a driver resumes when you're back online — offers are re-checked first."
          />
        ) : null}
        {p.unavailableNotice ? (
          <Banner
            tone="error"
            title="Choose again"
            body={p.unavailableNotice}
          />
        ) : null}
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" tone="text2">
              You asked
            </Text>
            <MoneyText money={p.requestedMinor} variant="title" />
          </View>
          <View>
            <Text variant="caption" tone="text2">
              Elapsed {p.elapsedLabel}
            </Text>
          </View>
        </Card>
        {p.phase === "offers" ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Chip
              testID={TEST_IDS.mp.rider.offers.sortPrice}
              label="Lowest price"
              selected={p.sort === "price"}
              onPress={() => p.onSort("price")}
            />
            <Chip
              testID={TEST_IDS.mp.rider.offers.sortEta}
              label="Fastest pickup"
              selected={p.sort === "eta"}
              onPress={() => p.onSort("eta")}
            />
          </View>
        ) : null}
        {p.widenedBanner ? <Banner tone="warn" body={p.widenedBanner} /> : null}
        {p.phase === "searching" ? (
          <View style={{ gap: 12 }}>
            <Card>
              <Skeleton width="60%" />
              <Skeleton width="82%" />
            </Card>
            <Card>
              <Skeleton width="72%" />
              <Skeleton width="48%" />
            </Card>
            <Text variant="caption" tone="text2" align="center">
              {p.envelopeLabel}
            </Text>
          </View>
        ) : (
          <FlatList
            testID={TEST_IDS.mp.rider.offers.list}
            data={p.offers}
            keyExtractor={(o) => o.bidId}
            renderItem={({ item: o }) => (
              <Pressable
                testID={dynamicTestId(TEST_IDS.mp.rider.offers.card, o.bidId)}
                accessibilityRole="button"
                disabled={o.withdrawn}
                onPress={() => p.onOpenOffer(o.bidId)}
              >
                <Card
                  style={{ marginBottom: 12, opacity: o.withdrawn ? 0.6 : 1 }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor:
                          o.kind === "finishing_trip"
                            ? t.colors.travelTint
                            : t.colors.primaryTint,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text variant="bodyStrong">{o.initials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        variant="bodyStrong"
                        style={
                          o.withdrawn
                            ? { textDecorationLine: "line-through" }
                            : null
                        }
                      >
                        {o.driverName} · ★ {o.rating}
                      </Text>
                      <Text variant="caption" tone="text2">
                        {o.vehicle} · {o.trips.toLocaleString()} trips
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      <MoneyText money={o.amountMinor} variant="title" />
                      {o.withdrawn ? (
                        <StatusPill status="cancelled" suffix="withdrawn" />
                      ) : o.kind === "finishing_trip" ? (
                        <StatusPill
                          status="scheduled"
                          suffix="finishing a trip"
                        />
                      ) : o.deltaLabel ? (
                        <Text variant="label" tone="warnInk">
                          {o.deltaLabel}
                        </Text>
                      ) : (
                        <StatusPill status="confirmed" suffix="your price" />
                      )}
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", marginTop: 10 }}>
                    <Text variant="caption" tone="text2" style={{ flex: 1 }}>
                      {o.pickupLabel}
                    </Text>
                    <Text variant="caption" tone="text3" tabular>
                      expires {o.expiresLabel}
                    </Text>
                  </View>
                </Card>
              </Pressable>
            )}
          />
        )}
      </View>
    </Screen>
  );
}
