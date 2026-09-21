// Trip.Complete (C05 / G01): the receipt. Totals are EXCLUSIVELY the server's
// (finalFareMinor / quotedFareMinor from GET /v1/rides/{id}) composed with the
// view's own currency. The ride view carries no driver-specific commission
// field (that lives in the marketplace award/claim, not the ride record), so
// this screen does not guess a net number — it points to Jobs, where the real
// fee receipt (server-issued at selection) already lives.
import React from "react";
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
import { isCash, isTerminalCancel, rideMoney } from "../../api/rides";
import { useTripView } from "./useTripView";
import type { TripStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState } from "../../components/states";

export function CompleteScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void }>();
  const { params } = useRoute<RouteProp<TripStackParamList, "Complete">>();
  const q = useTripView(params.tripId);
  const view = q.data;
  if (q.isError)
    return (
      <Screen title="Trip complete">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (!view)
    return (
      <Screen title="Trip complete">
        <LoadingState />
      </Screen>
    );
  const cancelled = isTerminalCancel(view.state);
  const finalKnown =
    view.finalFareMinor !== null && view.finalFareMinor !== undefined;
  return (
    <Screen
      title={cancelled ? "Trip cancelled" : "Trip complete"}
      subtitle={view.status}
    >
      {cancelled ? (
        <Banner
          tone="warn"
          title="This trip was cancelled"
          body={
            view.cancelReasonCode
              ? "Reason: " + view.cancelReasonCode
              : "No fare is due for this trip."
          }
        />
      ) : (
        <Card emphasis testID="driver.trip.receipt">
          <Text variant="label" tone="text2">
            Total — stated by the server
          </Text>
          {finalKnown ? (
            <MoneyText
              money={rideMoney(view, view.finalFareMinor)}
              variant="display"
            />
          ) : (
            <Text variant="bodySm" tone="warnInk">
              The final total hasn’t been confirmed by the server yet. This
              screen updates itself — nothing to do.
            </Text>
          )}
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
            label="Paid by rider"
            value={isCash(view) ? "Cash — collected" : "UBI Wallet"}
            last
          />
        </Card>
      )}
      <Text variant="caption" tone="text3" align="center">
        Your commission for this fare was captured when you accepted it — see
        Jobs for the fee receipt.
      </Text>
      <Button
        testID="driver.trip.jobHistory"
        label="View job history"
        kind="secondary"
        accessibilityLabel="View job history"
        onPress={() => nav.navigate("Jobs")}
      />
      <Button
        label="Done"
        accessibilityLabel="Done"
        onPress={() => nav.navigate("Main")}
      />
    </Screen>
  );
}
