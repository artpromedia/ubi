// Trip.InTrip (C05 / G01): live trip state from GET /v1/rides/{id}. Completing
// reads no amount from this screen — POST /v1/rides/{id}/complete computes the
// total server-side (agreed fare + any wait fee) and this screen only ever
// renders what comes back. Cash rides route through Trip.Cash for an explicit
// acknowledgment of the server-confirmed amount; wallet rides settle
// automatically and go straight to the receipt.
import React, { useEffect, useState } from "react";
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
import { isCash, isTerminalCancel, rideMoney, ridesApi } from "../../api/rides";
import { useTripView } from "./useTripView";
import type { TripStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState, errorText } from "../../components/states";

export function InTripScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    replace: (n: string, p?: unknown) => void;
  }>();
  const { params } = useRoute<RouteProp<TripStackParamList, "InTrip">>();
  const q = useTripView(params.tripId);
  const [confirming, setConfirming] = useState(false);
  const view = q.data;
  const complete = useMutation({
    mutationFn: () => ridesApi.complete(params.tripId),
    onSuccess: (ride) => {
      if (isCash(ride)) {
        nav.replace("Cash", { tripId: params.tripId });
      } else {
        nav.replace("Complete", { tripId: params.tripId });
      }
    },
  });
  useEffect(() => {
    if (view && isTerminalCancel(view.state)) {
      nav.replace("Complete", { tripId: params.tripId });
    }
  }, [view, nav, params.tripId]);
  if (q.isError)
    return (
      <Screen title="Trip in progress">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (!view)
    return (
      <Screen title="Trip in progress">
        <LoadingState />
      </Screen>
    );
  const held = view.state === "safety_hold";
  return (
    <Screen title="Trip in progress" subtitle={view.status}>
      {held ? (
        <Banner
          tone="warn"
          title="Safety hold"
          body="UBI paused this trip’s state while a safety check runs. The rider sees the same notice."
        />
      ) : null}
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
          label="Paid with"
          value={isCash(view) ? "Cash" : "UBI Wallet"}
          last
        />
      </Card>
      {complete.isError ? (
        <Banner
          tone="error"
          title="Couldn’t complete the trip"
          body={errorText(complete.error)}
        />
      ) : null}
      {!confirming ? (
        <Button
          testID={TEST_IDS.driver.trip.complete}
          label="End trip"
          accessibilityLabel="End trip"
          onPress={() => setConfirming(true)}
        />
      ) : (
        <Card emphasis>
          <Text variant="bodyStrong">Confirm you’ve reached the dropoff</Text>
          <Text variant="bodySm" tone="text2">
            The server computes the final total the moment you confirm — this
            can’t be undone from here.
          </Text>
          <Button
            label="Yes, end the trip"
            kind="danger"
            accessibilityLabel="Confirm end trip"
            loading={complete.isPending}
            onPress={() => complete.mutate()}
            style={{ marginTop: 12 }}
          />
        </Card>
      )}
    </Screen>
  );
}
