// Home (C05 / G01, G05): real driver status against ride-service
// (GET/POST /v1/drivers/me/status) instead of a hardcoded "Online · Lekki"
// card. Going online starts the foreground location watch (lib/location.ts);
// going offline stops it — location is never watched while offline or signed
// out. On mount this also checks for an active ride (GET /v1/rides/active) so
// a process death mid-trip lands the driver back in the Trip stack instead of
// stranding them on Home with no way back in.
import React, { useEffect } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Screen, Text, Card, Button, Banner, useTheme } from "@ubi/mobile-ui";
import { useFlag } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import { incentivesApi } from "../../api/incentives";
import { ridesApi } from "../../api/rides";
import { IncentiveStrip } from "../../components/IncentiveStrip";
import { useLocationWatch } from "../../lib/location";
import { tripScreenFor } from "../trip/useTripView";
import { errorText } from "../../components/states";

export function HomeScreen() {
  const t = useTheme();
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void }>();
  const qc = useQueryClient();
  const rebates = useFlag("driver_commission_rebates");
  const inc = useQuery({
    queryKey: ["driverIncentives"],
    queryFn: incentivesApi.overview,
    enabled: rebates,
    refetchInterval: 60_000,
  });
  const status = useQuery({
    queryKey: ["driver", "status"],
    queryFn: ridesApi.status,
    refetchInterval: 30_000,
  });
  const online = status.data?.online ?? false;
  // A trip in progress also needs telemetry (Waiting/InTrip screens run their
  // own instance too via this same hook, but a process restart lands here
  // first — the watch must already be running by the time the Navigate/Waiting
  // screen checks for a fresh position).
  const activeRide = useQuery({
    queryKey: ["ride", "active"],
    queryFn: ridesApi.active,
    enabled: online,
    refetchInterval: online ? 15_000 : false,
  });
  useLocationWatch(online || !!activeRide.data);
  useEffect(() => {
    if (activeRide.data) {
      nav.navigate("Trip", {
        screen: tripScreenFor(activeRide.data),
        params: { tripId: activeRide.data.rideId },
      });
    }
    // Only react to the ride id changing, not every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRide.data?.rideId]);
  const setOnline = useMutation({
    mutationFn: (next: boolean) => ridesApi.setStatus(next),
    onSuccess: (view) => qc.setQueryData(["driver", "status"], view),
  });
  return (
    <Screen scroll={false} bg="bg">
      <View style={{ flex: 1 }}>
        <View
          accessibilityLabel="Map"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            backgroundColor: t.colors.bg2,
          }}
        />
        <View style={{ padding: 16, gap: 8 }}>
          <Card
            testID="driver.home.status"
            style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: online ? t.colors.ok : t.colors.text3,
              }}
            />
            <Text variant="bodyStrong">
              {status.isLoading
                ? "Checking status…"
                : online
                  ? "Online"
                  : "Offline"}
            </Text>
          </Card>
          {status.isError ? (
            <Banner
              tone="error"
              title="Couldn’t load your status"
              body={errorText(status.error)}
            />
          ) : null}
          {setOnline.isError ? (
            <Banner
              tone="warn"
              title="Couldn’t change status"
              body={errorText(setOnline.error)}
            />
          ) : null}
          {rebates ? <IncentiveStrip strip={inc.data?.strip} /> : null}
        </View>
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: t.colors.bg2,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            gap: 12,
            borderTopWidth: 1,
            borderTopColor: t.colors.border,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View>
              <Text variant="heading">
                {online ? "Looking for trips" : "You’re offline"}
              </Text>
              <Text variant="caption" tone="text2">
                {online
                  ? "Open Requests to see and bid on nearby trips."
                  : "Go online to start seeing trip requests."}
              </Text>
            </View>
            <Button
              testID={TEST_IDS.driver.home.filters}
              label="Filters"
              kind="secondary"
              size="md"
              disabled
              accessibilityLabel="Trip filters (not available yet)"
              onPress={() => {}}
            />
          </View>
          <Button
            testID={
              online
                ? TEST_IDS.driver.home.goOffline
                : TEST_IDS.driver.home.goOnline
            }
            label={online ? "Go offline" : "Go online"}
            kind={online ? "secondary" : "primary"}
            accessibilityLabel={online ? "Go offline" : "Go online"}
            loading={setOnline.isPending}
            onPress={() => setOnline.mutate(!online)}
          />
        </View>
      </View>
    </Screen>
  );
}
