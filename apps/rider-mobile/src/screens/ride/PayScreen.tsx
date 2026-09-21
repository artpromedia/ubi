// Ride.Pay (C05 / G01): the receipt. Totals are EXCLUSIVELY the server's —
// finalFareMinor / waitFeeMinor / quotedFareMinor from GET /v1/rides/{rideId},
// composed with the view's own currency and rendered by the shared formatter.
// While the server hasn't stated a final fare yet the screen says so instead
// of showing the quote as if it were the receipt. Wallet settlement happens
// server-side at completion; nothing here claims a payment the ledger hasn't
// confirmed.
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
import { TEST_IDS } from "@ubi/contracts";
import { rideMoney } from "../../api/rides";
import { useRideView } from "./useRideView";
import type { RideStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState } from "../../components/states";

export function PayScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<RideStackParamList, "Pay">>();
  const q = useRideView(params.rideId);
  const view = q.data;
  if (q.isError)
    return (
      <Screen title="Receipt">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (!view)
    return (
      <Screen title="Receipt">
        <LoadingState />
      </Screen>
    );
  const finalKnown =
    view.finalFareMinor !== null && view.finalFareMinor !== undefined;
  const cash = view.paymentMethodId.toLowerCase().includes("cash");
  const paymentFailed = view.state === "payment_failed";
  return (
    <Screen title="Trip complete" subtitle={view.status}>
      <Card emphasis testID={TEST_IDS.rider.pay.breakdown}>
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
            The final total hasn’t been confirmed by the server yet. This screen
            updates itself — nothing to do.
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
          label="Paid with"
          value={cash ? "Cash to the driver" : "UBI Wallet"}
          last
        />
      </Card>
      {paymentFailed ? (
        <Banner
          tone="error"
          title="Payment failed"
          body="The wallet charge didn’t go through. UBI retries it server-side; support can help if it stays failed."
        />
      ) : null}
      {cash && finalKnown ? (
        <Banner
          tone="info"
          title="Pay the driver in cash"
          body="Hand the driver the total above. Cash is settled between you and the driver — UBI records it on the driver’s statement."
        />
      ) : null}
      <Button
        testID="rider.pay.rate"
        label="Rate this trip"
        kind="secondary"
        accessibilityLabel="Rate this trip"
        onPress={() => nav.navigate("Rate", { rideId: view.rideId })}
      />
      <Button
        label="Done"
        accessibilityLabel="Done"
        onPress={() => nav.navigate("Main" as never)}
      />
    </Screen>
  );
}
