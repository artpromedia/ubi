// Map pin picker for a stop or a destination (A02), with place SEARCH when the server offers it:
// ride-service mounts GET /v1/locations/{autocomplete,place} only when Maps is configured (the
// gateway proxies /v1/locations/*). Any failure — 503 MAPS_NOT_CONFIGURED, offline, an error —
// switches the sheet to the pin: the rider taps the map and may type a name. A search result
// fills the pin with the place's coordinates and its NAME (never a full street address, so
// drivers still see only the area); an unnamed pin is sent without a label and the SERVER names
// it by its area (never a house number). Coordinates leave only through the contract's
// validated stop encoder; nothing here prices or routes anything.
import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  TextInput,
  View,
  type TextStyle,
} from "react-native";
import MapView, { Marker, type MapPressEvent } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Text, useTheme } from "@ubi/mobile-ui";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import { locationsApi, type PlacePrediction } from "../../api/locations";

export type PickedPlace = { lat: number; lng: number; label?: string };

const TID = TEST_IDS.mp.rider.place;
/** Stop labels are at most 80 characters (contracts MpStopInputSchema). */
const MAX_LABEL = 80;
/** Characters before a search is sent, and the pause after typing. */
const MIN_QUERY = 3;
const DEBOUNCE_MS = 350;

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
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlacePrediction[]>([]);
  const [searchOff, setSearchOff] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    if (!visible) return;
    setPin(initial ? { lat: initial.lat, lng: initial.lng } : null);
    setLabel(initial?.label ?? "");
    setQuery("");
    setResults([]);
  }, [visible, initial]);
  useEffect(() => {
    if (!visible || searchOff) return;
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setResults([]);
      return;
    }
    const call = ++latest.current;
    const timer = setTimeout(() => {
      locationsApi
        .autocomplete(q, near)
        .then((found) => {
          if (call === latest.current) setResults(found.slice(0, 6));
        })
        .catch(() => {
          // Not configured, offline or failing: the pin is the way forward.
          if (call === latest.current) {
            setResults([]);
            setSearchOff(true);
          }
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, visible, searchOff]);
  const onPress = (e: MapPressEvent) => {
    const c = e.nativeEvent?.coordinate;
    if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
      setPin({ lat: c.latitude, lng: c.longitude });
  };
  const choose = (p: PlacePrediction) => {
    setResolving(p.place_id);
    locationsApi
      .place(p.place_id)
      .then((d) => {
        if (Number.isFinite(d.lat) && Number.isFinite(d.lng)) {
          setPin({ lat: d.lat, lng: d.lng });
          setLabel((d.name || p.main_text).slice(0, MAX_LABEL));
          setResults([]);
          setQuery("");
        }
      })
      .catch(() => setSearchOff(true))
      .finally(() => setResolving(null));
  };
  const inputStyle = [
    t.type.body as TextStyle,
    {
      color: t.colors.text,
      borderBottomWidth: 1,
      borderBottomColor: t.colors.border,
      paddingVertical: 8,
    },
  ];
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
          {searchOff ? (
            <Text testID={TID.searchUnavailable} variant="caption" tone="text2">
              Place search isn’t available right now — tap the map to drop a pin
              instead. Drivers see only the area until you choose one of them.
            </Text>
          ) : (
            <>
              <TextInput
                testID={TID.search}
                value={query}
                onChangeText={setQuery}
                accessibilityLabel="Search for a place"
                placeholder="Search for a place, or tap the map"
                placeholderTextColor={t.colors.text3}
                style={inputStyle}
              />
              {results.map((r) => (
                <Pressable
                  key={r.place_id}
                  testID={dynamicTestId(TID.result, r.place_id)}
                  accessibilityRole="button"
                  accessibilityLabel={r.description}
                  onPress={() => choose(r)}
                  style={{ minHeight: t.targets.min, justifyContent: "center" }}
                >
                  <Text variant="bodySmStrong">
                    {resolving === r.place_id ? "Finding… " : ""}
                    {r.main_text}
                  </Text>
                  <Text variant="caption" tone="text2">
                    {r.secondary_text}
                  </Text>
                </Pressable>
              ))}
              <Text variant="caption" tone="text2">
                Drivers see only the area until you choose one of them.
              </Text>
            </>
          )}
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
            style={inputStyle}
          />
          <Text variant="caption" tone="text2">
            {pin
              ? "Pin placed. Without a name, UBI labels it by its area."
              : "No pin yet — search above or tap the map where you want to go."}
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
