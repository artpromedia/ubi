// Ride.InTrip (C05 / G01): live trip state straight from GET /v1/rides/{rideId}.
// There is no client-side ETA or progress guesswork — the screen shows the
// server state word, the agreed fare and any server wait fee, and moves to the
// receipt only when the server says the trip completed. Trip sharing has no
// gateway endpoint yet (UNSUPPORTED registry), so the safety row offers SOS
// only — nothing implies a live-share that would not work.
import React, { useEffect } from "react";
import { View } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import {
  Screen,
  Text,
  Card,
  Row,
  Button,
  Banner,
  MoneyText,
} from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";
import { useFlag } from "@ubi/mobile-core";
import { rideMoney, isTerminalCancel, isCompleted } from "../../api/rides";
import { useRideView } from "./useRideView";
import type { RideStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState } from "../../components/states";

export function InTripScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<RideStackParamList, "InTrip">>();
  const q = useRideView(params.rideId);
  const view = q.data;
  // A02: stops, waiting and route changes live on the marketplace trip, keyed by the
  // request this ride executes; offered only while either capability is on here.
  const amendmentsOn = useFlag("marketplace_trip_amendments");
  const multiStopOn = useFlag("marketplace_multi_stop");
  useEffect(() => {
    if (view && isCompleted(view.state)) {
      nav.navigate("Pay", { rideId: view.rideId });
    }
  }, [view, nav]);
  if (q.isError)
    return (
      <Screen title="On the way">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (!view)
    return (
      <Screen title="On the way">
        <LoadingState />
      </Screen>
    );
  const held = view.state === "safety_hold";
  return (
    <Screen title="On the way" subtitle={view.status}>
      {held ? (
        <Banner
          tone="warn"
          title="Safety hold"
          body="UBI paused this trip’s state while a safety check runs. The driver sees the same notice."
        />
      ) : null}
      {isTerminalCancel(view.state) ? (
        <Banner
          tone="warn"
          title="This ride was cancelled"
          body="See the trip details for what happened."
        />
      ) : null}
      <Card>
        <Text testID={TEST_IDS.rider.trip.status} variant="bodyStrong">
          {view.status}
        </Text>
        <Text testID={TEST_IDS.rider.trip.eta} variant="bodySm" tone="text2">
          {view.startedAt
            ? "Started " + new Date(view.startedAt).toLocaleTimeString()
            : "Not started yet"}
          {" · live ETA isn’t reported by the server yet"}
        </Text>
      </Card>
      <Card>
        <Row
          label="Dropoff"
          value={view.dropoff.address ?? "Pinned location"}
        />
        <Row
          label="Agreed fare"
          value={
            <MoneyText
              money={rideMoney(view, view.quotedFareMinor)}
              variant="bodySmStrong"
            />
          }
        />
        <Row
          label="Wait fee so far"
          value={
            <MoneyText
              money={rideMoney(view, view.waitFeeMinor)}
              variant="bodySmStrong"
            />
          }
          last
        />
      </Card>
      {params.requestId && (amendmentsOn || multiStopOn) ? (
        <Button
          testID={TEST_IDS.mp.rider.trip.entry}
          label="Stops, waiting & route changes"
          kind="secondary"
          onPress={() =>
            nav.navigate("Marketplace", {
              screen: "Trip",
              params: { requestId: params.requestId },
            })
          }
        />
      ) : null}
      <View style={{ gap: 8 }}>
        <Button
          testID={TEST_IDS.rider.trip.safetyHub}
          label="Emergency (SOS)"
          kind="danger"
          accessibilityLabel="Emergency SOS"
          onPress={() => nav.navigate("Sos", { rideId: view.rideId })}
        />
        <Text variant="caption" tone="text3" align="center">
          Live trip sharing isn’t available yet.
        </Text>
      </View>
    </Screen>
  );
}
