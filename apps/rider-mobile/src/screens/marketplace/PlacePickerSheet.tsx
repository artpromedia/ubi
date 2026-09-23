// Map pin picker for a stop or a destination (A02). There is no geocoding/place-search
// service behind the gateway yet, so a place is exactly what the rider pins on the map
// plus an optional name they type. An unnamed pin is sent without a label and the SERVER
// names it by its area (never a house number). Coordinates leave only through the
// contract's validated stop encoder; nothing here prices or routes anything.
import React, { useEffect, useState } from "react";
import { Modal, TextInput, View, type TextStyle } from "react-native";
import MapView, { Marker, type MapPressEvent } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Text, useTheme } from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";

export type PickedPlace = { lat: number; lng: number; label?: string };

const TID = TEST_IDS.mp.rider.place;
/** Stop labels are at most 80 characters (contracts MpStopInputSchema). */
const MAX_LABEL = 80;

export function PlacePickerSheet({
  visible,
  title,
  near,
  initial,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  /** Where the map opens (the trip's pickup or last point). */
  near: { lat: number; lng: number };
  initial?: PickedPlace | null;
  onConfirm: (place: PickedPlace) => void;
  onCancel: () => void;
}) {
  const t = useTheme();
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!visible) return;
    setPin(initial ? { lat: initial.lat, lng: initial.lng } : null);
    setLabel(initial?.label ?? "");
  }, [visible, initial]);
  const onPress = (e: MapPressEvent) => {
    const c = e.nativeEvent?.coordinate;
    if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
      setPin({ lat: c.latitude, lng: c.longitude });
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView
        testID={TID.sheet}
        style={{ flex: 1, backgroundColor: t.colors.bg }}
      >
        <View style={{ paddingHorizontal: 20, paddingVertical: 12, gap: 4 }}>
          <Text variant="display" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="caption" tone="text2">
            Tap the map to drop a pin. Drivers see only the area until you
            choose one of them.
          </Text>
        </View>
        <MapView
          testID={TID.map}
          accessibilityLabel="Map. Tap to place the pin."
          style={{ flex: 1 }}
          initialRegion={{
            latitude: near.lat,
            longitude: near.lng,
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          }}
          onPress={onPress}
        >
          {pin ? (
            <Marker
              testID={TID.pin}
              coordinate={{ latitude: pin.lat, longitude: pin.lng }}
            />
          ) : null}
        </MapView>
        <View style={{ padding: 20, gap: 10 }}>
          <Text variant="label" tone="text3">
            Name (optional)
          </Text>
          <TextInput
            testID={TID.label}
            value={label}
            onChangeText={(v) => setLabel(v.slice(0, MAX_LABEL))}
            accessibilityLabel="Place name, optional"
            placeholder="e.g. Pharmacy on Awolowo Road"
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
          <Text variant="caption" tone="text2">
            {pin
              ? "Pin placed. Without a name, UBI labels it by its area."
              : "No pin yet — tap the map where you want to go."}
          </Text>
          <Button
            testID={TID.confirm}
            label="Use this place"
            disabled={!pin}
            onPress={() => {
              if (!pin) return;
              const name = label.trim();
              onConfirm(name ? { ...pin, label: name } : pin);
            }}
          />
          <Button
            testID={TID.cancel}
            label="Cancel"
            kind="ghost"
            onPress={onCancel}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}
