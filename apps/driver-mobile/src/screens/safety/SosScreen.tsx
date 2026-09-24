// Sos modal (C05 / G01). Honest scope: the city's emergency number and UBI
// support line from city config, dialled through the OS dialler. In-app SOS
// dispatch has NO gateway-reachable endpoint today (UNSUPPORTED registry:
// sosDispatch) and this screen says so — it never implies a control room was
// alerted. City config is read through the gateway's read-only config route
// (GET /v1/config/cities/{cityId}); the numbers still degrade honestly when it
// can't load.
import React from "react";
import { Linking, View } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { Screen, Text, Card, Button, Banner } from "@ubi/mobile-ui";
import { useCityConfig } from "@ubi/mobile-core";
import type { RootStackParamList } from "../../navigation/routes";

export function SosScreen() {
  const nav = useNavigation<{ goBack: () => void }>();
  const { params } = useRoute<RouteProp<RootStackParamList, "Sos">>();
  const { config, status } = useCityConfig();
  const dial = (num: string) => {
    void Linking.openURL("tel:" + num.replace(/\s+/g, ""));
  };
  return (
    <Screen title="Emergency" onBack={nav.goBack}>
      <Card emphasis tone="error" testID="common.sos.hold">
        <Text variant="bodyStrong">Call your local emergency services</Text>
        <Text variant="bodySm" tone="text2">
          This dials your phone — it does not go through UBI.
        </Text>
        <View style={{ marginTop: 12, gap: 8 }}>
          {status === "ready" && config ? (
            <Button
              testID="common.sos.confirm"
              label={"Call " + config.emergencyNumber}
              kind="danger"
              accessibilityLabel={
                "Call emergency number " + config.emergencyNumber
              }
              onPress={() => dial(config.emergencyNumber)}
            />
          ) : (
            <Banner
              tone="warn"
              title="Emergency number unavailable"
              body="Your city’s configured emergency number couldn’t be loaded. Dial your local emergency services directly from the phone app."
            />
          )}
        </View>
      </Card>
      {status === "ready" && config?.supportPhone ? (
        <Card>
          <Text variant="bodyStrong">UBI safety line</Text>
          <Text variant="bodySm" tone="text2">
            Speak to UBI about this trip
            {params?.tripId ? " (" + params.tripId + ")" : ""}.
          </Text>
          <View style={{ marginTop: 8 }}>
            <Button
              label={"Call " + config.supportPhone}
              kind="secondary"
              accessibilityLabel={"Call UBI support " + config.supportPhone}
              onPress={() => dial(config.supportPhone)}
            />
          </View>
        </Card>
      ) : null}
      <Banner
        tone="info"
        title="No automatic dispatch"
        body="UBI’s in-app SOS dispatch isn’t connected yet. Pressing a call button here only places a phone call; no alert is sent to UBI automatically."
      />
    </Screen>
  );
}
