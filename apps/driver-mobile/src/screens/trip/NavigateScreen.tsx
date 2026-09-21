// Trip.Navigate (C05 / G01): heading to the pickup point. "I've arrived" calls
// POST /v1/rides/{id}/arrived, which the server refuses (not_at_pickup) unless
// this driver's most recently INGESTED location (lib/location.ts) is fresh and
// inside the city's geofence — the server is authoritative here, this screen
// only surfaces its verdict.
import React, { useEffect, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { Screen, Card, Row, Button, Banner } from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";
import { ridesApi } from "../../api/rides";
import { useTripView, tripScreenFor } from "./useTripView";
import type { TripStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState, errorText } from "../../components/states";
import { CancelReasonPicker } from "../../components/CancelReasonPicker";

export function NavigateScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    replace: (n: string, p?: unknown) => void;
  }>();
  const { params } = useRoute<RouteProp<TripStackParamList, "Navigate">>();
  const q = useTripView(params.tripId);
  const [showReasons, setShowReasons] = useState(false);
  const view = q.data;
  useEffect(() => {
    if (view) {
      const target = tripScreenFor(view);
      if (target !== "Navigate") nav.replace(target, { tripId: params.tripId });
    }
  }, [view, nav, params.tripId]);
  const arrive = useMutation({
    mutationFn: () => ridesApi.arrived(params.tripId),
    onSuccess: () => nav.replace("Waiting", { tripId: params.tripId }),
  });
  const cancel = useMutation({
    mutationFn: (reasonCode: string) =>
      ridesApi.cancel(params.tripId, reasonCode),
    onSuccess: () => nav.navigate("Main"),
  });
  if (q.isError)
    return (
      <Screen title="Heading to pickup">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (!view)
    return (
      <Screen title="Heading to pickup">
        <LoadingState />
      </Screen>
    );
  return (
    <Screen title="Heading to pickup" subtitle={view.status}>
      <Card testID={TEST_IDS.driver.pickup.navigate}>
        <Row label="Pickup" value={view.pickup.address ?? "Pinned location"} />
        <Row
          label="Dropoff"
          value={view.dropoff.address ?? "Pinned location"}
          last
        />
      </Card>
      {arrive.isError ? (
        <Banner
          tone="warn"
          title="Not confirmed as arrived"
          body={errorText(arrive.error)}
        />
      ) : null}
      <Button
        testID={TEST_IDS.driver.pickup.arrived}
        label="I’ve arrived"
        accessibilityLabel="I’ve arrived at pickup"
        loading={arrive.isPending}
        onPress={() => arrive.mutate()}
      />
      <Button
        testID="driver.trip.safetyHub"
        label="Emergency (SOS)"
        kind="secondary"
        accessibilityLabel="Emergency SOS"
        onPress={() => nav.navigate("Sos", { tripId: view.rideId })}
      />
      {!showReasons ? (
        <Button
          label="Cancel trip"
          kind="danger"
          accessibilityLabel="Cancel trip"
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
