// Trip.Offer (C05 / G01): the one-time "you won this job" landing screen,
// entered from the marketplace jobs surface (JobsTimelineContainer) with the
// real executionRef ride id. Everything shown comes from GET /v1/rides/{id};
// nothing here is a local guess about the fare or the rider. Commission was
// already captured at selection (the marketplace award saga) — this screen
// does not re-state or re-charge anything.
import React, { useEffect, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { Screen, Text, Card, Row, Button, MoneyText } from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";
import { ridesApi, rideMoney } from "../../api/rides";
import { useTripView, tripScreenFor } from "./useTripView";
import type { TripStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState } from "../../components/states";
import { CancelReasonPicker } from "../../components/CancelReasonPicker";

export function OfferScreen() {
  const nav = useNavigation<{
    replace: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<TripStackParamList, "Offer">>();
  const q = useTripView(params.tripId);
  const view = q.data;
  const [showReasons, setShowReasons] = useState(false);
  // Offer is the Trip stack's single entry point from the jobs surface,
  // whether this is a fresh win or the driver resuming a job already under
  // way — so a ride that has already moved past "driver_assigned" (the
  // driver backgrounded the app mid-trip, say) skips straight to the real
  // current step instead of showing a stale "start navigating" landing.
  useEffect(() => {
    if (view) {
      const target = tripScreenFor(view);
      if (target !== "Navigate") {
        nav.replace(target, { tripId: params.tripId });
      }
    }
  }, [view, nav, params.tripId]);
  const decline = useMutation({
    mutationFn: (reasonCode: string) =>
      ridesApi.cancel(params.tripId, reasonCode),
    onSuccess: () => nav.goBack(),
  });
  if (q.isError)
    return (
      <Screen title="Your job" onBack={nav.goBack}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (!view)
    return (
      <Screen title="Your job">
        <LoadingState />
      </Screen>
    );
  return (
    <Screen title="You won this job">
      <Card emphasis testID={TEST_IDS.driver.offer.economics}>
        <Text variant="label" tone="text2">
          Agreed fare — server confirmed
        </Text>
        <MoneyText
          money={rideMoney(view, view.quotedFareMinor)}
          variant="display"
        />
      </Card>
      <Card>
        <Row label="Pickup" value={view.pickup.address ?? "Pinned location"} />
        <Row
          label="Dropoff"
          value={view.dropoff.address ?? "Pinned location"}
        />
        <Row label="Vehicle class" value={view.vehicleClass} last />
      </Card>
      <Button
        testID={TEST_IDS.driver.offer.accept}
        label="Start navigating"
        accessibilityLabel="Start navigating to pickup"
        onPress={() => nav.replace("Navigate", { tripId: params.tripId })}
      />
      {!showReasons ? (
        <Button
          testID={TEST_IDS.driver.offer.decline}
          label="Can’t take this job"
          kind="secondary"
          accessibilityLabel="Can’t take this job"
          onPress={() => setShowReasons(true)}
        />
      ) : (
        <CancelReasonPicker
          pending={decline.isPending}
          onPick={(code) => decline.mutate(code)}
        />
      )}
      {decline.isError ? (
        <ErrorState error={decline.error} title="Couldn’t cancel" />
      ) : null}
    </Screen>
  );
}
