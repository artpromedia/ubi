// R01 — Marketplace.Details. Annotation-only board: ride|delivery toggle (delivery behind its
// own flag), coarse pickup/dropoff areas and delivery weight/handling, leading into the fare
// editor. No map dependency; the RN-01 place-search port will replace the area inputs.
import React, { useState } from "react";
import { View, TextInput, type TextStyle } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { Screen, Text, Card, Chip, Button, useTheme } from "@ubi/mobile-ui";
import { track, useFlag } from "@ubi/mobile-core";
import type { MarketplaceQuoteParams } from "../../navigation/routes";

// Illustrative dev centroids (area-level only — never a house number). Until the place-search
// port lands, typed labels keep these coarse anchors; fixtures ignore coordinates entirely.
const DEFAULT_PICKUP = { label: "Lekki Phase 1", lat: 6.4478, lng: 3.4723 };
const DEFAULT_DROPOFF = { label: "Victoria Island", lat: 6.4281, lng: 3.4216 };
const HANDLING = ["Fragile", "Keep upright", "Food"];

export function RequestDetailsScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const t = useTheme();
  const deliveryOn = useFlag("marketplace_delivery");
  const [service, setService] = useState<"ride" | "delivery">("ride");
  const [pickup, setPickup] = useState(DEFAULT_PICKUP.label);
  const [dropoff, setDropoff] = useState(DEFAULT_DROPOFF.label);
  const [weightRaw, setWeightRaw] = useState("");
  const [handling, setHandling] = useState<string[]>([]);
  const weightKg = Number(weightRaw.replace(",", "."));
  const weightInvalid =
    service === "delivery" &&
    (weightRaw.trim() === "" || !Number.isFinite(weightKg) || weightKg <= 0);
  const input = (
    value: string,
    onChangeText: (v: string) => void,
    a11y: string,
    keyboard?: "number-pad",
  ) => (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      accessibilityLabel={a11y}
      keyboardType={keyboard}
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
  );
  const onContinue = () => {
    const quoteParams: MarketplaceQuoteParams = {
      service,
      vehicleClass: service === "ride" ? "standard" : "bike",
      pickup: {
        ...DEFAULT_PICKUP,
        label: pickup.trim() || DEFAULT_PICKUP.label,
      },
      dropoff: {
        ...DEFAULT_DROPOFF,
        label: dropoff.trim() || DEFAULT_DROPOFF.label,
      },
      ...(service === "delivery" ? { weightKg, handling } : {}),
    };
    track("mp_details_continue", { service });
    nav.navigate("Fare", { quoteParams });
  };
  return (
    <Screen
      title="Name your fare"
      subtitle="You set the price · drivers answer with offers"
      onBack={nav.goBack}
    >
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Chip
          label="Ride"
          selected={service === "ride"}
          onPress={() => setService("ride")}
        />
        {deliveryOn ? (
          <Chip
            label="Delivery"
            selected={service === "delivery"}
            onPress={() => setService("delivery")}
          />
        ) : null}
      </View>
      <Card style={{ gap: 4 }}>
        <Text variant="label" tone="text3">
          Pickup area
        </Text>
        {input(pickup, setPickup, "Pickup area")}
        <Text variant="label" tone="text3" style={{ marginTop: 10 }}>
          Drop-off area
        </Text>
        {input(dropoff, setDropoff, "Drop-off area")}
        <Text variant="caption" tone="text3" style={{ marginTop: 6 }}>
          Drivers see the area only. Exact addresses go to your driver after you
          choose an offer.
        </Text>
      </Card>
      {service === "delivery" ? (
        <Card style={{ gap: 4 }}>
          <Text variant="label" tone="text3">
            Package weight (kg)
          </Text>
          {input(
            weightRaw,
            setWeightRaw,
            "Package weight in kilograms",
            "number-pad",
          )}
          {weightInvalid && weightRaw.trim() !== "" ? (
            <Text variant="caption" tone="errorInk">
              Enter a weight above 0 kg.
            </Text>
          ) : null}
          <Text variant="label" tone="text3" style={{ marginTop: 10 }}>
            Handling
          </Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {HANDLING.map((h) => (
              <Chip
                key={h}
                label={h}
                selected={handling.includes(h)}
                onPress={() =>
                  setHandling(
                    handling.includes(h)
                      ? handling.filter((x) => x !== h)
                      : [...handling, h],
                  )
                }
              />
            ))}
          </View>
        </Card>
      ) : null}
      <Button
        label="Continue to fare"
        disabled={weightInvalid}
        onPress={onContinue}
      />
    </Screen>
  );
}
