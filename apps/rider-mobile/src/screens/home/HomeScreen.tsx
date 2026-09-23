import React from "react";
import { View, Pressable } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Screen, Text, Card, useTheme } from "@ubi/mobile-ui";
import { useFlag, track, TID, formatMinor } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import { benefitsApi } from "../../api/benefits";
import { marketplaceApi } from "../../api/marketplace";

// Book for Later items that still need the rider (anything not yet over).
const LIVE_LATER = new Set([
  "scheduled_unassigned",
  "needs_rider_approval",
  "published",
  "held",
  "payment_pending",
  "confirmed",
  "reconfirmed",
  "activated",
  "active",
  "paused",
]);

/** Board 20a. Tiles come from flags; Ask UBI is a peer of the conventional entry, never a replacement. */
export function HomeScreen() {
  const t = useTheme();
  const nav = useNavigation<{
    navigate: (name: string, params?: unknown) => void;
  }>();
  const ask = useFlag("ai_assistant");
  const flightsOn = useFlag("flights_booking");
  const staysOn = useFlag("stays_booking");
  const travel = flightsOn || staysOn;
  const bites = useFlag("bites");
  const send = useFlag("send");
  const promos = useFlag("rider_promotions");
  const marketplace = useFlag("marketplace_rides");
  // A03 Book for Later — three deny-by-default products; hooks run unconditionally.
  const scheduledOn = useFlag("scheduled_rides");
  const advanceOn = useFlag("marketplace_advance_reservations");
  const seriesOn = useFlag("marketplace_recurring_journeys");
  const laterSalesOn = scheduledOn || advanceOn || seriesOn;
  // Switching the products off stops NEW bookings only; the server keeps every read on.
  // While all three are off, Home still shows the tile to a rider who already has a live
  // scheduled trip, reservation or series, so it stays reachable (and cancellable).
  // Same query keys as the hub, so opening it reuses these reads.
  const probeLater = marketplace && !laterSalesOn;
  const probe = { enabled: probeLater, retry: false, staleTime: 60_000 };
  const scheduledProbe = useQuery({
    queryKey: ["mp", "later", "scheduled"],
    queryFn: marketplaceApi.scheduledList,
    ...probe,
  });
  const bookingsProbe = useQuery({
    queryKey: ["mp", "later", "bookings"],
    queryFn: marketplaceApi.bookings,
    ...probe,
  });
  const seriesProbe = useQuery({
    queryKey: ["mp", "later", "series"],
    queryFn: marketplaceApi.seriesList,
    ...probe,
  });
  const hasLiveLater =
    probeLater &&
    [
      ...(scheduledProbe.data?.items ?? []),
      ...(bookingsProbe.data?.items ?? []),
      ...(seriesProbe.data?.items ?? []),
    ].some((item) => LIVE_LATER.has(item.state));
  const laterOn = marketplace && (laterSalesOn || hasLiveLater);
  const benefits = useQuery({
    queryKey: ["benefits"],
    queryFn: benefitsApi.get,
    enabled: promos,
  });
  const tile = (
    label: string,
    detail: string,
    tint: string,
    onPress: () => void,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      onPress={onPress}
      style={{ flex: 1, minWidth: "46%" }}
    >
      <Card>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            backgroundColor: tint,
            marginBottom: 10,
          }}
        />
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="caption" tone="text2">
          {detail}
        </Text>
      </Card>
    </Pressable>
  );
  return (
    <Screen>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <View>
          <Text variant="caption" tone="text2">
            Good morning
          </Text>
          <Text variant="display">Adaeze</Text>
        </View>
      </View>
      <Pressable
        testID={TEST_IDS.rider.home.whereTo}
        accessibilityRole="button"
        accessibilityLabel="Where to? Search a destination"
        onPress={() => nav.navigate("Ride", { screen: "Search" })}
      >
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: t.colors.primary,
            }}
          />
          <Text variant="body" style={{ flex: 1 }}>
            Where to?
          </Text>
          <View
            style={{
              backgroundColor: t.colors.primaryTint,
              borderRadius: 999,
              paddingHorizontal: 11,
              paddingVertical: 7,
            }}
          >
            <Text variant="bodySmStrong" tone="link">
              Later
            </Text>
          </View>
        </Card>
      </Pressable>
      {ask ? (
        <Pressable
          testID={TID.rider.home.askUbi}
          accessibilityRole="button"
          accessibilityLabel="Ask UBI. Plan a trip, check a policy, book with a reviewed confirmation"
          onPress={() => {
            track("ask_thread_opened", { source: "home" });
            nav.navigate("Ask", { screen: "Thread" });
          }}
        >
          <Card
            tone="inverse"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              minHeight: 64,
            }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                backgroundColor: t.colors.primary,
                transform: [{ rotate: "45deg" }],
              }}
            />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" tone="onInverse">
                Ask UBI
              </Text>
              <Text variant="caption" tone="onInverse2">
                Plan a trip, check a policy, book with a reviewed confirmation
              </Text>
            </View>
            <Text variant="heading" tone="onInverse2">
              ›
            </Text>
          </Card>
        </Pressable>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {tile("Move", "Rides now or later", t.colors.primaryTint, () =>
          nav.navigate("Ride", { screen: "Search" }),
        )}
        {marketplace
          ? tile(
              "Name your fare",
              "You set the price, drivers offer",
              t.colors.okTint,
              () => {
                track("mp_details_opened", { source: "home" });
                nav.navigate("Marketplace", { screen: "Details" });
              },
            )
          : null}
        {laterOn ? (
          <Pressable
            key="later"
            testID={TEST_IDS.mp.rider.later.entry}
            accessibilityRole="button"
            accessibilityLabel="Booked for later. Scheduled trips, reserved drivers and recurring journeys"
            onPress={() => {
              track("mp_later_opened", { source: "home" });
              nav.navigate("Marketplace", { screen: "Later" });
            }}
            style={{ flex: 1, minWidth: "46%" }}
          >
            <Card>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  backgroundColor: t.colors.infoTint,
                  marginBottom: 10,
                }}
              />
              <Text variant="bodyStrong">Booked for later</Text>
              <Text variant="caption" tone="text2">
                Scheduled trips and reserved drivers
              </Text>
            </Card>
          </Pressable>
        ) : null}
        {travel
          ? tile(
              "Flights & stays",
              "Domestic flights, hotels",
              t.colors.travelTint,
              () => nav.navigate("Travel", { screen: "FlightSearch" }),
            )
          : null}
        {bites
          ? tile("Bites", "Food from nearby", t.colors.bitesTint, () =>
              nav.navigate("Bites", { screen: "Restaurants" }),
            )
          : null}
        {send
          ? tile("Send", "Packages across town", t.colors.sendTint, () =>
              nav.navigate("Send", { screen: "New" }),
            )
          : null}
      </View>
      {promos && benefits.data ? (
        <Pressable
          testID={TID.rider.home.benefits}
          accessibilityRole="button"
          onPress={() =>
            nav.navigate("Main", {
              screen: "Account",
              params: { screen: "Benefits" },
            })
          }
        >
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodySmStrong">Your benefits</Text>
              <Text variant="caption" tone="text2">
                {formatMinor(benefits.data.creditTotal) +
                  " ride credit · " +
                  benefits.data.offers.filter((o) => o.status === "active")
                    .length +
                  " active offers"}
              </Text>
            </View>
            <Text variant="bodySmStrong" tone="link">
              View
            </Text>
          </Card>
        </Pressable>
      ) : null}
    </Screen>
  );
}
