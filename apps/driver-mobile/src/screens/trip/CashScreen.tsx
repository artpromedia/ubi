// Trip.Cash (C05 / G01): the trip is already completed server-side (POST
// /complete has run) — this screen is an explicit acknowledgment of the exact,
// server-confirmed amount to collect. There is no separate cash-acknowledgment
// endpoint reachable through the gateway (checked: ride-service's route table
// and payment-service's mounted routes carry none), so "acknowledged" here
// means the driver has seen the real total before moving on — it never
// invents a second money-moving call the server hasn't offered.
import React, { useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { Screen, Text, Card, Button, Banner, MoneyText } from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";
import { rideMoney } from "../../api/rides";
import { useTripView } from "./useTripView";
import type { TripStackParamList } from "../../navigation/routes";
import { LoadingState, ErrorState } from "../../components/states";

export function CashScreen() {
  const nav = useNavigation<{ replace: (n: string, p?: unknown) => void }>();
  const { params } = useRoute<RouteProp<TripStackParamList, "Cash">>();
  const q = useTripView(params.tripId);
  const [disputing, setDisputing] = useState(false);
  const view = q.data;
  if (q.isError)
    return (
      <Screen title="Collect cash">
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  if (!view)
    return (
      <Screen title="Collect cash">
        <LoadingState />
      </Screen>
    );
  return (
    <Screen title="Collect cash from the rider">
      <Card emphasis testID={TEST_IDS.driver.cash.received}>
        <Text variant="label" tone="text2">
          Total — confirmed by the server
        </Text>
        <MoneyText
          money={rideMoney(view, view.finalFareMinor ?? view.quotedFareMinor)}
          variant="display"
        />
        <Text variant="bodySm" tone="text2" style={{ marginTop: 8 }}>
          This trip is already marked complete. Collect this exact amount in
          cash — UBI records it on your statement; it is not deducted from your
          wallet.
        </Text>
      </Card>
      <Button
        testID="driver.cash.acknowledge"
        label="I’ve collected the cash"
        accessibilityLabel="I’ve collected the cash"
        onPress={() => nav.replace("Complete", { tripId: params.tripId })}
      />
      {disputing ? (
        <Banner
          tone="info"
          title="Contact support"
          body={
            "There’s no in-app dispute flow yet — contact UBI support with this ride ID: " +
            view.rideId
          }
        />
      ) : (
        <Button
          testID={TEST_IDS.driver.cash.dispute}
          label="This amount looks wrong"
          kind="secondary"
          accessibilityLabel="Report a problem with this amount"
          onPress={() => setDisputing(true)}
        />
      )}
    </Screen>
  );
}
