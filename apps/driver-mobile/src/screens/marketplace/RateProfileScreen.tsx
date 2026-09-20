// Design handoff D09 (handoff-marketplace/rn/driver/RateProfileScreen.tsx), adapted for
// repo imports, contracts TEST_IDS, `border2` → `border` (the tokens ship no border2) and
// a real `onBack` prop (the handoff stubbed it). The example calculation comes from
// POST /v1/mp/rate-profiles/preview — never computed on device.
import React from "react";
import { View, TextInput } from "react-native";
import {
  Screen,
  Text,
  Card,
  Button,
  Banner,
  Row,
  useTheme,
} from "@ubi/mobile-ui";
import { TEST_IDS } from "@ubi/contracts";

/** D09. Per city/service/vehicle. Example calc comes from POST /mp/rate-profiles/preview — never computed on device.
 * Saving creates a new version; outstanding bids and won jobs are untouched. */
export type RatePreview = {
  stale: boolean;
  rows: { label: string; value: string; tone?: "ok" | "errorInk" }[]; // gross / −fee / net, server-phrased
  disclaimer: string; // "Before fuel and operating costs…"
};
export type RateProfileProps = {
  scopeLabel: string; // "Lagos · Economy · sedan"
  rateValue: string;
  onRate: (v: string) => void;
  minValue: string;
  onMin: (v: string) => void;
  componentsLine: string; // "Off · not configured" (optional components are config-gated)
  preview: RatePreview | null;
  onRefreshPreview: () => void;
  saveError: string | null; // bounds violation from server, current version stays active
  versionLine: string; // "Changes apply to future calculations only… Saved as v4."
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
};

export function RateProfileScreen(p: RateProfileProps) {
  const t = useTheme();
  const input = (
    testID: string,
    value: string,
    onChange: (v: string) => void,
    label: string,
  ) => (
    <View style={{ flex: 1 }}>
      <Text variant="caption" tone="text2">
        {label}
      </Text>
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        keyboardType="number-pad"
        value={value}
        onChangeText={onChange}
        style={{
          ...t.type.bodyStrong,
          color: t.colors.text,
          height: t.targets.min,
          borderWidth: 1,
          borderColor: t.colors.border,
          borderRadius: t.radius.control,
          paddingHorizontal: 12,
          backgroundColor: t.colors.card,
        }}
      />
    </View>
  );
  return (
    <Screen title="My rates" subtitle={p.scopeLabel} onBack={p.onBack} bg="bg2">
      <Card>
        <View style={{ flexDirection: "row", gap: 12 }}>
          {input(
            TEST_IDS.mp.driver.rates.rateInput,
            p.rateValue,
            p.onRate,
            "Rate per km · gross",
          )}
          {input(
            TEST_IDS.mp.driver.rates.minInput,
            p.minValue,
            p.onMin,
            "Minimum trip fare",
          )}
        </View>
        <Row label="Time & pickup components" value={p.componentsLine} last />
      </Card>
      {p.saveError ? (
        <Banner
          tone="error"
          title="Couldn’t save your rates"
          body={p.saveError}
        />
      ) : null}
      {p.preview ? (
        <Card
          testID={TEST_IDS.mp.driver.rates.preview}
          style={{
            borderStyle: "dashed",
            borderColor: t.colors.border,
            borderWidth: 1,
          }}
        >
          <Text variant="label" tone="text2">
            Example · 10 km trip
          </Text>
          {p.preview.rows.map((r, i) => (
            <Row
              key={r.label}
              label={r.label}
              value={r.value}
              valueTone={r.tone ?? "text"}
              last={i === p.preview!.rows.length - 1}
            />
          ))}
          <Text variant="caption" tone="text3">
            {p.preview.disclaimer}
          </Text>
          {p.preview.stale ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginTop: 8,
              }}
            >
              <Text variant="caption" tone="text2" style={{ flex: 1 }}>
                Inputs changed — this preview is stale.
              </Text>
              <Button
                label="Refresh preview"
                kind="secondary"
                size="md"
                onPress={p.onRefreshPreview}
              />
            </View>
          ) : null}
        </Card>
      ) : null}
      <Banner tone="neutral" body={p.versionLine} />
      <Text variant="caption" tone="text3">
        Profiles suggest your offer — they never bid for you. A below-profile
        fare you tap deliberately is still valid above the platform floor.
      </Text>
      <Button
        testID={TEST_IDS.mp.driver.rates.save}
        label={"Save rates for " + p.scopeLabel}
        loading={p.saving}
        onPress={p.onSave}
      />
    </Screen>
  );
}
