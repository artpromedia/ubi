// Ride.Pin (C05 / G01): full-screen pickup PIN for handing to the driver.
// The PIN comes from the Keychain vault (revealed once at selection, never
// re-served by the server) and is shown only — never logged, never tracked.
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { Screen, Text, Card, Banner } from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";
import { loadPickupPin } from "../../lib/pinVault";
import { useRideView } from "./useRideView";
import type { RideStackParamList } from "../../navigation/routes";

export function PinDisplayScreen() {
  const nav = useNavigation<{ goBack: () => void }>();
  const { params } = useRoute<RouteProp<RideStackParamList, "Pin">>();
  const q = useRideView(params.rideId);
  const [pin, setPin] = useState<string | null | "loading">("loading");
  useEffect(() => {
    void loadPickupPin(params.rideId).then((p) => setPin(p));
  }, [params.rideId]);
  return (
    <Screen title="Pickup PIN" onBack={nav.goBack}>
      <Card emphasis>
        {pin === "loading" ? null : pin ? (
          <View style={{ alignItems: "center", gap: 8, paddingVertical: 24 }}>
            <Text
              testID={TEST_IDS.rider.pin.display}
              variant="display"
              tabular
              accessibilityLabel="Your pickup PIN"
            >
              {pin}
            </Text>
            <Text variant="bodySm" tone="text2" align="center">
              Give this to your driver only when you’re in the car. The driver
              enters it to start the trip.
            </Text>
          </View>
        ) : (
          <Banner
            tone="warn"
            title="PIN unavailable on this device"
            body="The PIN is shown exactly once when a driver is chosen and can’t be re-fetched. If you reinstalled the app mid-ride, cancel and request again, or contact support."
          />
        )}
      </Card>
      {q.data?.pinVerified ? (
        <Banner
          tone="ok"
          title="PIN verified"
          body="Your driver has already verified this PIN."
        />
      ) : null}
    </Screen>
  );
}
