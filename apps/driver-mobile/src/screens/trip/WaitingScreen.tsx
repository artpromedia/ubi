// Trip.Waiting (C05 / G01): the driver has arrived (POST /arrived already
// confirmed) and is waiting for the rider. If this city requires a pickup
// PIN, the driver enters it here; otherwise the trip starts directly. Both
// actions call the real ride-service lifecycle endpoints — nothing here
// starts a trip the server hasn't recorded arrival for.
import React, { useEffect, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { Screen, Text, Card, Button, Banner } from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";
import { ridesApi } from "../../api/rides";
import { useTripView, tripScreenFor } from "./useTripView";
import type { TripStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState, errorText } from "../../components/states";
import { CancelReasonPicker } from "../../components/CancelReasonPicker";

function elapsedLabel(since?: string | null): string {
  if (!since) return "";
  const sec = Math.max(
    0,
    Math.floor((Date.now() - new Date(since).getTime()) / 1000),
  );
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return "Waiting " + m + ":" + String(s).padStart(2, "0");
}

export function WaitingScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    replace: (n: string, p?: unknown) => void;
  }>();
  const { params } = useRoute<RouteProp<TripStackParamList, "Waiting">>();
  const q = useTripView(params.tripId);
  const [showReasons, setShowReasons] = useState(false);
  // Elapsed time ticks forward on the trip-view poll (useTripView refetches
  // every 3s while waiting), which is close enough for a waiting timer
  // without an extra render-forcing interval of its own.
  const view = q.data;
  useEffect(() => {
    if (view) {
      const target = tripScreenFor(view);
      if (target === "InTrip" || target === "Complete") {
        nav.replace(target, { tripId: params.tripId });
      }
    }
  }, [view, nav, params.tripId]);
  const start = useMutation({
    mutationFn: () => ridesApi.start(params.tripId),
    onSuccess: () => nav.replace("InTrip", { tripId: params.tripId }),
  });
  const cancel = useMutation({
    mutationFn: (reasonCode: string) =>
      ridesApi.cancel(params.tripId, reasonCode),
    onSuccess: () => nav.navigate("Main"),
  });
  if (q.isError)
    return (
      <Screen title="Waiting for rider">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (!view)
    return (
      <Screen title="Waiting for rider">
        <LoadingState />
      </Screen>
    );
  return (
    <Screen title="Waiting for rider" subtitle={view.status}>
      <Card>
        <Text testID={TEST_IDS.driver.wait.timer} variant="display" tabular>
          {elapsedLabel(view.arrivedAt)}
        </Text>
        <Text variant="bodySm" tone="text2">
          {view.pinRequired
            ? "Ask the rider for their pickup PIN when they get in."
            : "This city doesn’t use pickup PINs — start the trip once the rider is in."}
        </Text>
      </Card>
      {start.isError ? (
        <Banner
          tone="warn"
          title="Couldn’t start the trip"
          body={errorText(start.error)}
        />
      ) : null}
      {view.pinRequired ? (
        <Button
          testID="driver.wait.enterPin"
          label="Enter PIN"
          accessibilityLabel="Enter pickup PIN"
          onPress={() => nav.navigate("Pin", { tripId: params.tripId })}
        />
      ) : (
        <Button
          testID="driver.wait.start"
          label="Start trip"
          accessibilityLabel="Start trip"
          loading={start.isPending}
          onPress={() => start.mutate()}
        />
      )}
      {!showReasons ? (
        <Button
          testID={TEST_IDS.driver.wait.noShow}
          label="Rider hasn’t shown up"
          kind="danger"
          accessibilityLabel="Report rider no-show"
          onPress={() => setShowReasons(true)}
        />
      ) : (
        <CancelReasonPicker
          pending={cancel.isPending}
          onPick={(code) => cancel.mutate(code)}
        />
      )}
      {cancel.isError ? (
        <ErrorState error={cancel.error} title="Couldn’t cancel" />
      ) : null}
    </Screen>
  );
}
