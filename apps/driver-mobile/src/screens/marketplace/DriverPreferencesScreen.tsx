// A04.2 driver preferences (design handoff flow 9 "DriverPrefs"). Presentational only:
// every option list, bound, disclosure and label arrives from the container, which takes
// them from GET /v1/mp/driver/preferences. Preferences filter and sort the feed and
// suggest an offer — the screen says so and offers no auto-bid control, because none
// exists. Native primitives + @ubi/mobile-ui tokens only.
import React from "react";
import { View, TextInput } from "react-native";
import {
  Screen,
  Text,
  Card,
  Button,
  Banner,
  Row,
  Chip,
  Toggle,
  useTheme,
} from "@ubi/mobile-ui";
import { dynamicTestId, type MpWeekday } from "@ubi/contracts";
import { MP_DRIVER_TID } from "./testIds";

export type PrefsOption<T> = { label: string; value: T };
export type PrefsWindow = {
  day: MpWeekday;
  startMinute: number;
  endMinute: number;
  label: string;
};
export type PrefsDraft = {
  minTripMajor: string; // whole major units as typed; "" = no minimum
  maxPickupMeters: number | null;
  acceptsDeliveries: boolean;
  acceptsStops: boolean;
  maxStops: number | null;
  homeward: null | {
    lat: number;
    lng: number;
    radiusMeters: number;
    label: string;
  };
  homewardOnly: boolean;
  windows: PrefsWindow[];
};
export type PrefsBanner = null | {
  kind: "error" | "offline" | "conflict" | "saved";
  title: string;
  body: string;
};
export type DriverPreferencesProps = {
  draft: PrefsDraft;
  onChange: (patch: Partial<PrefsDraft>) => void;
  disclosure: string; // server: "Preferences … never bid for you …"
  availabilityNote: string; // server: stored-only disclosure + timezone
  versionLine: string;
  minTripHint: string; // "Up to ₦5,000 · hides requests that can never pay it"
  pickupOptions: PrefsOption<number | null>[];
  maxStopsOptions: PrefsOption<number | null>[];
  radiusOptions: PrefsOption<number>[];
  weekdays: PrefsOption<MpWeekday>[];
  homewardLine: string | null; // "Home · within 5 km"
  settingHomeward: boolean;
  homewardError: string | null;
  onSetHomeward: () => void;
  onClearHomeward: () => void;
  newWindow: { day: MpWeekday; start: string; end: string };
  onNewWindow: (w: { day: MpWeekday; start: string; end: string }) => void;
  windowError: string | null;
  onAddWindow: () => void;
  onRemoveWindow: (index: number) => void;
  onOpenRates: () => void;
  banner: PrefsBanner;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onBack: () => void;
};

type BannerKind = NonNullable<PrefsBanner>["kind"];
const BANNER_TEST_ID: Record<BannerKind, string | undefined> = {
  offline: MP_DRIVER_TID.prefs.offline,
  conflict: MP_DRIVER_TID.prefs.conflict,
  error: MP_DRIVER_TID.prefs.error,
  saved: undefined,
};
const BANNER_TONE: Record<BannerKind, "ok" | "error" | "warn"> = {
  saved: "ok",
  error: "error",
  offline: "warn",
  conflict: "warn",
};

export function DriverPreferencesScreen(p: DriverPreferencesProps) {
  const t = useTheme();
  const inputStyle = {
    ...t.type.bodyStrong,
    color: t.colors.text,
    height: t.targets.min,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: t.radius.control,
    paddingHorizontal: 12,
    backgroundColor: t.colors.card,
  };
  const d = p.draft;
  return (
    <Screen title="Preferences" onBack={p.onBack} bg="bg2">
      <View testID={MP_DRIVER_TID.prefs.screen} style={{ gap: 12 }}>
        {p.banner ? (
          <Banner
            testID={BANNER_TEST_ID[p.banner.kind]}
            tone={BANNER_TONE[p.banner.kind]}
            title={p.banner.title}
            body={p.banner.body}
          />
        ) : null}
        <Banner tone="neutral" body={p.disclosure} />

        <Card>
          <Text variant="label" tone="text2">
            Pay
          </Text>
          <Row
            testID={MP_DRIVER_TID.prefs.rates}
            label="Per-km rate & minimum fare"
            value="My rates ›"
            onPress={p.onOpenRates}
            accessibilityLabel="Open my rates"
          />
          <Text variant="caption" tone="text2">
            Minimum trip amount
          </Text>
          <TextInput
            testID={MP_DRIVER_TID.prefs.minTrip}
            accessibilityLabel="Minimum trip amount"
            keyboardType="number-pad"
            placeholder="No minimum"
            placeholderTextColor={t.colors.text3}
            value={d.minTripMajor}
            onChangeText={(v) =>
              p.onChange({ minTripMajor: v.replace(/\D/g, "") })
            }
            style={inputStyle}
          />
          <Text variant="caption" tone="text3">
            {p.minTripHint}
          </Text>
        </Card>

        <Card>
          <Text variant="label" tone="text2">
            Pickups
          </Text>
          <Text variant="caption" tone="text2">
            Maximum pickup distance
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {p.pickupOptions.map((o) => (
              <Chip
                key={String(o.value)}
                testID={dynamicTestId(
                  MP_DRIVER_TID.prefs.pickup,
                  String(o.value ?? "off"),
                )}
                label={o.label}
                selected={d.maxPickupMeters === o.value}
                onPress={() => p.onChange({ maxPickupMeters: o.value })}
              />
            ))}
          </View>
          <Toggle
            testID={MP_DRIVER_TID.prefs.deliveries}
            label="Show deliveries"
            value={d.acceptsDeliveries}
            onChange={(v) => p.onChange({ acceptsDeliveries: v })}
          />
          <Toggle
            testID={MP_DRIVER_TID.prefs.stops}
            label="Show trips with stops"
            detail="Stops and expected waiting are shown on every offer."
            value={d.acceptsStops}
            onChange={(v) =>
              p.onChange(
                v ? { acceptsStops: v } : { acceptsStops: v, maxStops: null },
              )
            }
          />
          {d.acceptsStops ? (
            <>
              <Text variant="caption" tone="text2">
                Most stops per trip
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {p.maxStopsOptions.map((o) => (
                  <Chip
                    key={String(o.value)}
                    testID={dynamicTestId(
                      MP_DRIVER_TID.prefs.maxStops,
                      String(o.value ?? "any"),
                    )}
                    label={o.label}
                    selected={d.maxStops === o.value}
                    onPress={() => p.onChange({ maxStops: o.value })}
                  />
                ))}
              </View>
            </>
          ) : null}
        </Card>

        <Card testID={MP_DRIVER_TID.prefs.homeward}>
          <Text variant="label" tone="text2">
            Homeward
          </Text>
          <Text variant="caption" tone="text2">
            Requests ending in your homeward area are marked and listed first.
            Only you see this area.
          </Text>
          {p.homewardLine ? (
            <Text variant="bodySmStrong">{p.homewardLine}</Text>
          ) : null}
          {p.homewardError ? (
            <Banner tone="error" body={p.homewardError} />
          ) : null}
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              testID={MP_DRIVER_TID.prefs.homewardSet}
              label={d.homeward ? "Move to where I am" : "Set to where I am"}
              kind="secondary"
              size="md"
              loading={p.settingHomeward}
              onPress={p.onSetHomeward}
              style={{ flex: 1 }}
            />
            {d.homeward ? (
              <Button
                testID={MP_DRIVER_TID.prefs.homewardClear}
                label="Remove"
                kind="ghost"
                size="md"
                onPress={p.onClearHomeward}
                style={{ flex: 1 }}
              />
            ) : null}
          </View>
          {d.homeward ? (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {p.radiusOptions.map((o) => (
                  <Chip
                    key={o.value}
                    testID={dynamicTestId(
                      MP_DRIVER_TID.prefs.homewardRadius,
                      o.value,
                    )}
                    label={o.label}
                    selected={d.homeward?.radiusMeters === o.value}
                    onPress={() =>
                      d.homeward &&
                      p.onChange({
                        homeward: { ...d.homeward, radiusMeters: o.value },
                      })
                    }
                  />
                ))}
              </View>
              <Toggle
                testID={MP_DRIVER_TID.prefs.homewardOnly}
                label="Only show homeward requests"
                value={d.homewardOnly}
                onChange={(v) => p.onChange({ homewardOnly: v })}
              />
            </>
          ) : null}
        </Card>

        <Card>
          <Text variant="label" tone="text2">
            Availability
          </Text>
          <Text variant="caption" tone="text3">
            {p.availabilityNote}
          </Text>
          {d.windows.map((w, i) => (
            <Row
              key={w.day + w.startMinute}
              label={w.label}
              value="Remove"
              valueTone="errorInk"
              testID={dynamicTestId(MP_DRIVER_TID.prefs.windowRemove, i)}
              accessibilityLabel={"Remove " + w.label}
              onPress={() => p.onRemoveWindow(i)}
            />
          ))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {p.weekdays.map((o) => (
              <Chip
                key={o.value}
                testID={dynamicTestId(MP_DRIVER_TID.prefs.windowDay, o.value)}
                label={o.label}
                selected={p.newWindow.day === o.value}
                onPress={() => p.onNewWindow({ ...p.newWindow, day: o.value })}
              />
            ))}
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              testID={MP_DRIVER_TID.prefs.windowStart}
              accessibilityLabel="Window start (HH:MM)"
              placeholder="07:00"
              placeholderTextColor={t.colors.text3}
              value={p.newWindow.start}
              onChangeText={(v) => p.onNewWindow({ ...p.newWindow, start: v })}
              style={[inputStyle, { flex: 1 }]}
            />
            <TextInput
              testID={MP_DRIVER_TID.prefs.windowEnd}
              accessibilityLabel="Window end (HH:MM)"
              placeholder="10:00"
              placeholderTextColor={t.colors.text3}
              value={p.newWindow.end}
              onChangeText={(v) => p.onNewWindow({ ...p.newWindow, end: v })}
              style={[inputStyle, { flex: 1 }]}
            />
          </View>
          {p.windowError ? <Banner tone="error" body={p.windowError} /> : null}
          <Button
            testID={MP_DRIVER_TID.prefs.windowAdd}
            label="Add window"
            kind="secondary"
            size="md"
            onPress={p.onAddWindow}
          />
        </Card>

        <Text variant="caption" tone="text3">
          {p.versionLine}
        </Text>
        <Button
          testID={MP_DRIVER_TID.prefs.save}
          label="Save preferences"
          loading={p.saving}
          disabled={!p.canSave}
          onPress={p.onSave}
        />
      </View>
    </Screen>
  );
}
