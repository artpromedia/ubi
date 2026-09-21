// Ride.Assigned (C05 / G01): the post-award screen the marketplace BidDetail
// container hands off to with { rideId, pickupPin? } — that contract is kept.
// Everything rendered comes from GET /v1/rides/{rideId}; the one-time PIN from
// the select response is vaulted in the Keychain for process-death recovery
// and never logged or tracked. The server's driver summary is pseudonymous
// today (G09, owned by C06): this screen shows exactly what the server serves
// and claims nothing more.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
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
import { ridesApi, rideMoney, isTerminalCancel } from "../../api/rides";
import {
  storePickupPin,
  loadPickupPin,
  clearPickupPin,
} from "../../lib/pinVault";
import { useRideView, rideScreenFor } from "./useRideView";
import type { RideStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState } from "../../components/states";

const etaLabel = (etaSeconds?: number) =>
  etaSeconds === undefined
    ? "ETA not reported yet"
    : "Arriving in about " + Math.max(1, Math.round(etaSeconds / 60)) + " min";

export function AssignedScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<RideStackParamList, "Assigned">>();
  const q = useRideView(params.rideId);
  const [pin, setPin] = useState<string | null>(params.pickupPin ?? null);
  useEffect(() => {
    if (params.pickupPin) {
      void storePickupPin(params.rideId, params.pickupPin);
    } else {
      void loadPickupPin(params.rideId).then((p) => {
        if (p) setPin(p);
      });
    }
    // The one-time PIN is captured exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const view = q.data;
  useEffect(() => {
    if (!view) return;
    const target = rideScreenFor(view);
    if (target === "InTrip" || target === "Pay") {
      void clearPickupPin();
      nav.navigate(target, { rideId: view.rideId });
    }
  }, [view, nav]);
  const cancel = useMutation({
    mutationFn: () => ridesApi.cancel(params.rideId),
    onSuccess: () => {
      void clearPickupPin();
      void q.refetch();
    },
  });
  if (q.isError)
    return (
      <Screen title="Your ride" onBack={nav.goBack}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (!view)
    return (
      <Screen title="Your ride" onBack={nav.goBack}>
        <LoadingState />
      </Screen>
    );
  const cancelled = isTerminalCancel(view.state);
  const searching =
    view.state === "matching" ||
    view.state === "rematching" ||
    view.state === "no_driver";
  return (
    <Screen title="Your ride" subtitle={view.status} onBack={nav.goBack}>
      {cancelled ? (
        <Banner
          tone="warn"
          title="This ride was cancelled"
          body={
            view.cancelReasonCode
              ? "Reason: " + view.cancelReasonCode
              : "No pickup will happen for this ride."
          }
        />
      ) : null}
      <Card testID={TEST_IDS.rider.assigned.driverCard}>
        <Text
          variant="label"
          tone={cancelled ? "warnInk" : searching ? "info" : "ok"}
        >
          {view.status}
        </Text>
        <View style={{ gap: 4, marginTop: 8 }}>
          <Text variant="bodyStrong">
            {view.driver
              ? "Driver confirmed"
              : searching
                ? "Looking for your driver"
                : "Driver pending"}
          </Text>
          <Text variant="bodySm" tone="text2">
            {view.driver
              ? etaLabel(view.driver.etaSeconds)
              : "You’ll see the pickup PIN below the moment a driver is on the way."}
          </Text>
        </View>
      </Card>
      {view.pinRequired && !cancelled ? (
        <Card emphasis>
          <Text variant="label" tone="text2">
            Pickup PIN — give it only in the car
          </Text>
          {pin ? (
            <Text
              testID={TEST_IDS.rider.pin.display}
              variant="display"
              tabular
              accessibilityLabel="Your pickup PIN"
            >
              {pin}
            </Text>
          ) : (
            <Text variant="bodySm" tone="warnInk">
              PIN unavailable on this device. It is shown exactly once when a
              driver is chosen and can’t be re-fetched — if you reinstalled the
              app, cancel and request again, or ask support.
            </Text>
          )}
          {view.pinVerified ? (
            <Text variant="bodySm" tone="ok">
              PIN verified by your driver.
            </Text>
          ) : null}
        </Card>
      ) : null}
      <Card>
        <Row label="Pickup" value={view.pickup.address ?? "Pinned location"} />
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
          last
        />
      </Card>
      {!cancelled ? (
        <Button
          testID={TEST_IDS.rider.assigned.cancel}
          label="Cancel ride"
          kind="danger"
          accessibilityLabel="Cancel ride"
          loading={cancel.isPending}
          onPress={() => cancel.mutate()}
        />
      ) : (
        <Button
          label="Back to Home"
          accessibilityLabel="Back to Home"
          onPress={() => nav.navigate("Main" as never)}
        />
      )}
      {cancel.isError ? (
        <ErrorState error={cancel.error} title="Couldn’t cancel" />
      ) : null}
      <Button
        label="Emergency (SOS)"
        kind="secondary"
        accessibilityLabel="Emergency SOS"
        onPress={() => nav.navigate("Sos", { rideId: view.rideId })}
      />
    </Screen>
  );
}
