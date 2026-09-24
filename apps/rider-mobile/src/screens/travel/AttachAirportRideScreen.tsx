import React, { useState } from "react";
import { Pressable, TextInput, View, type TextStyle } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banner,
  Button,
  Card,
  Chip,
  Screen,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import { track, useCityConfig, useFlag } from "@ubi/mobile-core";
import { TEST_IDS, VEHICLE_CLASSES, dynamicTestId } from "@ubi/contracts";
import type { TravelStackParamList } from "../../navigation/routes";
import {
  travelApi,
  type AirportTransfer,
  type TransferDirection,
  type TransferPlace,
} from "../../api/travel";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { typedDigits, typedMajorToMoney } from "../../lib/moneyInput";
import { WALLET_PAYMENT_METHOD_ID } from "../../lib/payment";
import { PlacePickerSheet } from "../marketplace/PlacePickerSheet";
import { UnavailableCard } from "../marketplace/riderParts";
import {
  DIRECTION_TEXT,
  directionOf,
  publishNoteFor,
  transferRefusal,
} from "./transferCopy";

const TID = TEST_IDS.travel.transfer;
/** Where the map first opens when nothing is picked yet — a viewport only, never sent. */
const MAP_START = { lat: 6.5244, lng: 3.3792 };
/** Airport rides use car classes (the city's own list decides; the server refuses others). */
const CLASSES = VEHICLE_CLASSES.filter((c) => c !== "moto");
const CLASS_LABEL: Record<string, string> = {
  go: "Go",
  comfort: "Comfort",
  xl: "XL · more luggage",
};

/**
 * Airport transfer INTENT (design flow 4, round-5/6 contract). The traveller links a ride to a
 * leg of their own FLIGHT order and states only the airport point, their own place, the class
 * and the most they approve — the server derives the pickup window from the flight under the
 * city's airport policy, publishes a scheduled ride request near the trip, and the transfer is
 * `awarded` only when the traveller chooses a driver's offer. The strict CreateAirportTransfer
 * body never carries a time, a user, a city or a fare bound. POST carries a caller-held
 * Idempotency-Key; behind the deny-by-default `reservations` flag.
 */
export function AttachAirportRideScreen() {
  const t = useTheme();
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    replace?: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } =
    useRoute<RouteProp<TravelStackParamList, "AttachAirportRide">>();
  const flagOn = useFlag("reservations");
  const { config } = useCityConfig();
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("transfer");
  const orderQ = useQuery({
    queryKey: ["travel", "order", params.orderId],
    queryFn: () => travelApi.order(params.orderId),
    enabled: flagOn,
    retry: false,
  });
  const [direction, setDirection] = useState<TransferDirection>(
    directionOf(params.direction),
  );
  const [airport, setAirport] = useState<TransferPlace | null>(null);
  const [place, setPlace] = useState<TransferPlace | null>(null);
  const [picking, setPicking] = useState<"airport" | "place" | null>(null);
  const [vehicleClass, setVehicleClass] = useState<string>(CLASSES[0]);
  const [limitRaw, setLimitRaw] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [serverCurrency, setServerCurrency] = useState<string | null>(null);
  // The city's currency: the server's own word when it corrected us, else city config,
  // else the flight order's currency. The server re-checks it (currency_mismatch).
  const currency =
    serverCurrency ?? config?.currency ?? orderQ.data?.price.currency ?? null;
  const create = useMutation({
    mutationFn: (v: { body: Parameters<typeof travelApi.createTransfer>[0] }) =>
      travelApi.createTransfer(v.body, keys.keyFor(JSON.stringify(v.body))),
    onSettled: (_r, e, v) =>
      keys.settle(JSON.stringify(v.body), e ?? undefined),
    onSuccess: (transfer: AirportTransfer) => {
      track("airport_transfer_requested", {
        orderId: params.orderId,
        direction,
      });
      queryClient.setQueryData(
        ["travel", "transfer", transfer.transferId],
        transfer,
      );
      const go = nav.replace ?? nav.navigate;
      go("Transfer", { transferId: transfer.transferId });
    },
    onError: (e) => {
      const details = (e as { details?: { currency?: string } }).details;
      if (details?.currency) setServerCurrency(details.currency);
    },
  });
  if (!flagOn)
    return (
      <Screen title="Airport ride" onBack={nav.goBack}>
        <UnavailableCard
          testID={TID.unavailable}
          title="Airport rides aren’t available here yet"
          body="UBI isn’t arranging airport rides in your city right now. Your flight is unaffected — book a ride in the ride app when you’re ready."
          action={{ label: "Back to your trip", onPress: nav.goBack }}
        />
      </Screen>
    );
  const submit = () => {
    const limit = currency ? typedMajorToMoney(limitRaw, currency) : null;
    if (!airport || !place) {
      setFieldError(
        "Choose the airport point and your address — the ride links them.",
      );
      return;
    }
    if (!limit) {
      setFieldError(
        "Enter the most you approve for this ride. Drivers’ offers above it are never accepted.",
      );
      return;
    }
    setFieldError(null);
    create.mutate({
      body: {
        linkedOrderId: params.orderId,
        legIndex: 0,
        direction,
        airportPoint: airport,
        place,
        vehicleClass,
        maxFareMinor: limit,
        paymentMethodId: WALLET_PAYMENT_METHOD_ID,
      },
    });
  };
  const arrival = direction === "arrival_pickup";
  const refusal = create.isError ? transferRefusal(create.error) : null;
  const pointRow = (
    testID: string,
    label: string,
    value: TransferPlace | null,
    empty: string,
    onPress: () => void,
  ) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label + ": " + (value?.label ?? empty)}
      onPress={onPress}
      style={{ minHeight: t.targets.min, justifyContent: "center" }}
    >
      <Text variant="label" tone="text3">
        {label}
      </Text>
      <Text variant="bodySmStrong" tone={value ? "text" : "link"}>
        {value ? (value.label ?? "Pinned on the map") : empty}
      </Text>
    </Pressable>
  );
  return (
    <Screen
      title={arrival ? "Ride from the airport" : "Ride to the airport"}
      subtitle={orderQ.data?.title}
      onBack={nav.goBack}
      footer={
        <Button
          testID={TID.submit}
          label="Ask for this airport ride"
          loading={create.isPending}
          onPress={submit}
        />
      }
    >
      <Banner
        testID={TID.publishNote}
        tone="info"
        title="Pending until a driver is chosen"
        body={publishNoteFor(direction)}
      />
      {refusal ? (
        <Banner
          testID={TID.refusal}
          tone="error"
          title={refusal.title}
          body={refusal.body}
        />
      ) : null}
      <Card testID={TID.form} style={{ gap: 10 }}>
        <View
          testID={TID.direction}
          style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
        >
          {(["arrival_pickup", "departure_dropoff"] as const).map((d) => (
            <Chip
              key={d}
              testID={dynamicTestId(TID.direction, d)}
              label={DIRECTION_TEXT[d]}
              selected={direction === d}
              onPress={() => setDirection(d)}
            />
          ))}
        </View>
        {pointRow(
          TID.airportPoint,
          arrival ? "Airport pickup point" : "Airport drop-off point",
          airport,
          "Choose the terminal or door",
          () => setPicking("airport"),
        )}
        {pointRow(
          TID.place,
          arrival ? "Take me to" : "Pick me up at",
          place,
          "Choose your address",
          () => setPicking("place"),
        )}
        <View
          testID={TID.vehicleClass}
          style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
        >
          {CLASSES.map((c) => (
            <Chip
              key={c}
              testID={dynamicTestId(TID.vehicleClass, c)}
              label={CLASS_LABEL[c] ?? c}
              selected={vehicleClass === c}
              onPress={() => setVehicleClass(c)}
            />
          ))}
        </View>
        <View style={{ gap: 2 }}>
          <Text variant="label" tone="text3">
            {"Most you approve" + (currency ? " (" + currency + ")" : "")}
          </Text>
          <TextInput
            testID={TID.limit}
            value={limitRaw}
            onChangeText={(v) => setLimitRaw(typedDigits(v))}
            keyboardType="number-pad"
            accessibilityLabel="Most you approve for this ride, in whole units"
            placeholder="e.g. 15000"
            placeholderTextColor={t.colors.text3}
            style={[
              t.type.body as TextStyle,
              {
                color: t.colors.text,
                borderBottomWidth: 1,
                borderBottomColor: t.colors.border,
                paddingVertical: 8,
              },
            ]}
          />
          <Text testID={TID.limitHint} variant="caption" tone="text2">
            Drivers offer near pickup and you choose one in the ride app. This
            is your limit for this ride only — a changed flight time never
            raises it, and it is separate from your flight’s price.
          </Text>
        </View>
        {fieldError ? (
          <Text testID={TID.fieldError} variant="caption" tone="errorInk">
            {fieldError}
          </Text>
        ) : null}
      </Card>
      <Text variant="caption" tone="text3">
        This ride is a separate booking from your flight, with its own status,
        payment and receipt.
      </Text>
      <PlacePickerSheet
        visible={picking !== null}
        title={
          picking === "airport"
            ? arrival
              ? "Airport pickup point"
              : "Airport drop-off point"
            : arrival
              ? "Where to after landing"
              : "Where to pick you up"
        }
        near={
          (picking === "airport" ? airport : place) ??
          airport ??
          place ??
          MAP_START
        }
        initial={picking === "airport" ? airport : place}
        onConfirm={(p) => {
          if (picking === "airport") setAirport(p);
          else setPlace(p);
          setPicking(null);
          setFieldError(null);
        }}
        onCancel={() => setPicking(null)}
      />
    </Screen>
  );
}
