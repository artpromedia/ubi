// Ride.Details (C05 / G01): history detail rendered from GET /v1/rides/{rideId}.
// One source of truth for what happened — states, timestamps, server totals,
// cancellation reason — with no client-side reconstruction.
import React from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { Screen, Card, Row, Banner, MoneyText, Text } from "@ubi/mobile-ui";
import { rideMoney, isTerminalCancel } from "../../api/rides";
import { useRideView } from "./useRideView";
import type { RideStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState } from "../../components/states";

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString() : "—";

export function RideDetailsScreen() {
  const nav = useNavigation<{ goBack: () => void }>();
  const { params } = useRoute<RouteProp<RideStackParamList, "Details">>();
  const q = useRideView(params.rideId);
  const view = q.data;
  if (q.isError)
    return (
      <Screen title="Trip details" onBack={nav.goBack}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (!view)
    return (
      <Screen title="Trip details" onBack={nav.goBack}>
        <LoadingState />
      </Screen>
    );
  return (
    <Screen title="Trip details" subtitle={view.status} onBack={nav.goBack}>
      {isTerminalCancel(view.state) ? (
        <Banner
          tone="neutral"
          title="Cancelled"
          body={
            (view.cancelledByRole
              ? "Cancelled by " + view.cancelledByRole
              : "Cancelled") +
            (view.cancelReasonCode ? " · " + view.cancelReasonCode : "")
          }
        />
      ) : null}
      <Card>
        <Row label="Pickup" value={view.pickup.address ?? "Pinned location"} />
        <Row
          label="Dropoff"
          value={view.dropoff.address ?? "Pinned location"}
        />
        <Row label="Vehicle class" value={view.vehicleClass} />
        <Row label="Requested" value={when(view.requestedAt)} />
        <Row label="Started" value={when(view.startedAt)} />
        <Row label="Completed" value={when(view.completedAt)} last />
      </Card>
      <Card>
        <Text variant="label" tone="text2">
          Money — as the server recorded it
        </Text>
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
          label="Wait fee"
          value={
            <MoneyText
              money={rideMoney(view, view.waitFeeMinor)}
              variant="bodySmStrong"
            />
          }
        />
        <Row
          label="Final total"
          value={
            view.finalFareMinor !== null &&
            view.finalFareMinor !== undefined ? (
              <MoneyText
                money={rideMoney(view, view.finalFareMinor)}
                variant="bodySmStrong"
              />
            ) : (
              "Not stated"
            )
          }
          last
        />
      </Card>
    </Screen>
  );
}
