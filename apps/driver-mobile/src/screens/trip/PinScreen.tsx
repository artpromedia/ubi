// Trip.Pin (C05 / G01): enter the rider's pickup PIN against
// POST /v1/rides/{id}/verify-pin. The server is the sole authority — a wrong
// PIN costs a real, server-recorded attempt (rendered here as `attemptsLeft`),
// and repeated attempts are rate-limited server-side (429 `rate_limited`) on
// top of the per-ride attempt cap (429 `pin_attempts_exhausted` once
// exhausted). A verified PIN immediately starts the trip — this app never
// invents a "verified" state the server hasn't confirmed.
import React, { useState } from "react";
import { View, TextInput, type TextStyle } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { Screen, Text, Card, Button, Banner, useTheme } from "@ubi/mobile-ui";
import { ApiError } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import { ridesApi } from "../../api/rides";
import type { TripStackParamList } from "../../navigation/routes";
import { errorText } from "../../components/states";

type PinFailure = {
  code: string;
  attemptsLeft: number | null;
  locked: boolean;
  rateLimited: boolean;
};

function pinFailure(e: unknown): PinFailure | null {
  if (!(e instanceof ApiError)) return null;
  // ride-service's wire shape nests the count at `details.attemptsLeft`
  // (services/ride-service/internal/domain/errors.go Error{Details}), and
  // mobile-core's real-fetch path unwraps ApiError.details to that inner
  // object directly. Its dev-fixture path (used by this test's HTTP mock)
  // instead sets ApiError.details to the WHOLE response body, so the same
  // field can also land one level up. Reading both keeps this screen correct
  // against a real server without depending on that mobile-core quirk.
  const details = e.details as
    | { attemptsLeft?: number; details?: { attemptsLeft?: number } }
    | undefined;
  const attemptsLeft = details?.attemptsLeft ?? details?.details?.attemptsLeft;
  return {
    code: e.code,
    attemptsLeft: typeof attemptsLeft === "number" ? attemptsLeft : null,
    locked: e.code === "pin_attempts_exhausted",
    rateLimited: e.code === "rate_limited",
  };
}

export function PinScreen() {
  const t = useTheme();
  const nav = useNavigation<{
    goBack: () => void;
    replace: (n: string, p?: unknown) => void;
  }>();
  const { params } = useRoute<RouteProp<TripStackParamList, "Pin">>();
  const [pin, setPin] = useState("");
  const start = useMutation({
    mutationFn: () => ridesApi.start(params.tripId),
    onSuccess: () => nav.replace("InTrip", { tripId: params.tripId }),
  });
  const verify = useMutation({
    mutationFn: () => ridesApi.verifyPin(params.tripId, pin),
    onSuccess: () => {
      setPin("");
      start.mutate();
    },
  });
  const failure = verify.isError ? pinFailure(verify.error) : null;
  const valid = /^\d{4,6}$/.test(pin);
  const locked = failure?.locked ?? false;
  return (
    <Screen
      title="Enter pickup PIN"
      onBack={nav.goBack}
      footer={
        <Button
          testID={TEST_IDS.driver.pin.submit}
          label={verify.isSuccess ? "Starting trip…" : "Verify PIN"}
          accessibilityLabel="Verify pickup PIN"
          disabled={!valid || locked || start.isPending}
          loading={verify.isPending || start.isPending}
          onPress={() => verify.mutate()}
        />
      }
    >
      <View style={{ gap: 12, paddingTop: 12 }}>
        <Text variant="bodySm" tone="text2">
          Ask the rider for the PIN they were shown when they chose you.
        </Text>
        <TextInput
          testID={TEST_IDS.driver.pin.input}
          accessibilityLabel="Pickup PIN"
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          maxLength={6}
          editable={!locked}
          placeholder="••••"
          placeholderTextColor={t.colors.text3}
          style={[
            t.type.display as TextStyle,
            {
              color: t.colors.text,
              letterSpacing: 8,
              textAlign: "center",
              borderBottomWidth: 1,
              borderBottomColor: t.colors.border,
              paddingVertical: 10,
            },
          ]}
        />
        {failure ? (
          <Banner
            tone={locked || failure.rateLimited ? "error" : "warn"}
            title={
              locked
                ? "PIN locked for this ride"
                : failure.rateLimited
                  ? "Too many attempts"
                  : "That PIN doesn’t match"
            }
            body={
              errorText(verify.error) +
              (failure.attemptsLeft !== null && !locked
                ? " · " + failure.attemptsLeft + " attempt(s) left"
                : "")
            }
          />
        ) : null}
        {start.isError ? (
          <Banner
            tone="error"
            title="PIN verified, but the trip didn’t start"
            body={errorText(start.error)}
          />
        ) : null}
        {locked ? (
          <Card>
            <Text variant="bodySm" tone="text2">
              This ride’s PIN is now locked. Contact support — this trip cannot
              be started from this screen anymore.
            </Text>
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}
