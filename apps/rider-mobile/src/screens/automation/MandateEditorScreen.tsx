import { type ReactNode, useEffect, useState } from "react";
import { View, TextInput, Alert } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Screen,
  Text,
  Chip,
  Button,
  Row,
  Toggle,
  useTheme,
} from "@ubi/mobile-ui";
import { TID, track, useCityConfig, formatMinor } from "@ubi/mobile-core";
import type { AccountStackParamList } from "../../navigation/routes";
import {
  mandatesApi,
  type Constraint,
  type MandateInput,
  type AllowedAction,
} from "../../api/mandates";

const ACTIONS: { id: AllowedAction; label: string; hint: string }[] = [
  {
    id: "airport_pickup.reserve",
    label: "Reserve an airport pickup for a flight in my itinerary",
    hint: "read-only otherwise",
  },
  {
    id: "flight.rebook_on_cancel",
    label: "Rebook my flight if the airline cancels",
    hint: "same route, same day",
  },
  {
    id: "scheduled_ride.book",
    label: "Book a recurring scheduled ride",
    hint: "weekdays only",
  },
  {
    id: "marketplace.ride.select",
    label: "Pick a driver's offer on my ride request",
    hint: "within my limits · I still set the fare",
  },
];
const MARKETPLACE_ACTION: AllowedAction = "marketplace.ride.select";
const CLASSES = ["UBI Go", "Comfort", "XL"];
/**
 * Marketplace classes are the ids the marketplace reports on a request (the
 * rider app publishes "standard" rides); the server checks the mandate's
 * categories and its vehicle_class values against exactly these.
 */
const MARKETPLACE_CLASSES: { id: string; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "comfort", label: "Comfort" },
];
const TIME_WINDOW = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const CONSTRAINT_LABEL: Record<string, string> = {
  vehicle_class: "Only these vehicle classes",
  time_window: "Only between (city time)",
  city: "Only in my city",
  price_above_cap: "Price is above my per-ride limit",
  lands_after_23_00: "Flight lands after 23:00",
  pickup_not_airport: "Pickup is not the arrival airport",
};
const labelOf = (c: Constraint) => c.label ?? CONSTRAINT_LABEL[c.key] ?? c.key;

/** A marketplace mandate's checkable limits, as typed constraint values. */
function marketplaceConstraints(cityId: string | undefined): Constraint[] {
  return [
    {
      key: "vehicle_class",
      label: CONSTRAINT_LABEL.vehicle_class,
      mode: "allow",
      values: ["standard"],
    },
    {
      key: "time_window",
      label: CONSTRAINT_LABEL.time_window,
      mode: "allow",
      values: ["07:00-10:00"],
    },
    ...(cityId
      ? [
          {
            key: "city",
            label: CONSTRAINT_LABEL.city,
            mode: "allow" as const,
            values: [cityId],
          },
        ]
      : []),
  ];
}
const DEFAULT: MandateInput = {
  action: "airport_pickup.reserve",
  title: "Airport ride when my flight lands",
  passengers: "self_only",
  categories: ["UBI Go", "Comfort"],
  perRunCap: { amountMinor: 1_500_000, currency: "NGN" },
  periodCap: {
    amount: { amountMinor: 6_000_000, currency: "NGN" },
    runs: 4,
    period: "month",
  },
  expiresAt: "2026-12-31T23:59:59+01:00",
  constraints: [
    {
      key: "price_above_cap",
      label: "Price is above my per-ride limit",
      mode: "always_ask",
    },
    {
      key: "lands_after_23_00",
      label: "Flight lands after 23:00",
      mode: "ask",
    },
    {
      key: "pickup_not_airport",
      label: "Pickup is not the arrival airport",
      mode: "always_ask",
    },
  ],
};

/** Board 20d / D01 MandateApprove — editor. Allowed action (incl. the marketplace selection), who, class, caps, expiry (≤ 12 months), stop-and-ask constraints and the typed limit VALUES the server checks (vehicle class, time window, city). Save/revoke need PIN. */
export function MandateEditorScreen() {
  const t = useTheme();
  const qc = useQueryClient();
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } =
    useRoute<RouteProp<AccountStackParamList, "MandateEditor">>();
  const existing = useQuery({
    queryKey: ["mandate", params?.mandateId],
    queryFn: () => mandatesApi.get(params!.mandateId!),
    enabled: !!params?.mandateId,
  });
  const [m, setM] = useState<MandateInput>(DEFAULT);
  useEffect(() => {
    if (existing.data) setM(existing.data);
  }, [existing.data]);
  const { config } = useCityConfig();
  const isMarketplace = m.action === MARKETPLACE_ACTION;
  const timeWindow = m.constraints.find((c) => c.key === "time_window");
  const windowInvalid =
    isMarketplace &&
    timeWindow !== undefined &&
    !(timeWindow.values ?? []).every((v) => TIME_WINDOW.test(v));
  const chooseAction = (action: AllowedAction) => {
    if (action === m.action) return;
    if (action === MARKETPLACE_ACTION) {
      setM({
        ...m,
        action,
        title: "Pick a driver for my ride",
        categories: ["standard"],
        constraints: marketplaceConstraints(config?.cityId),
      });
    } else if (m.action === MARKETPLACE_ACTION) {
      setM({
        ...m,
        action,
        categories: DEFAULT.categories,
        constraints: DEFAULT.constraints,
      });
    } else {
      setM({ ...m, action });
    }
  };
  const setValues = (key: string, values: string[]) =>
    setM({
      ...m,
      // The vehicle_class values and the categories are one limit.
      ...(key === "vehicle_class" ? { categories: values } : {}),
      constraints: m.constraints.map((c) =>
        c.key === key ? { ...c, values } : c,
      ),
    });
  const money = (v: string) => ({
    amountMinor: Math.max(
      0,
      Math.round(Number(v.replace(/[^0-9]/g, "")) * 100),
    ),
    currency: config?.currency ?? "NGN",
  });

  const save = () =>
    !windowInvalid &&
    nav.navigate("SecureConfirm", {
      purpose: "Save automation",
      onProof: async (proof: string) => {
        if (params?.mandateId)
          await mandatesApi.patch(params.mandateId, "edit", m, proof);
        else await mandatesApi.create(m, proof);
        track("mandate_created", {
          action: m.action,
          perRunCap: m.perRunCap.amountMinor,
        });
        await qc.invalidateQueries({ queryKey: ["mandates"] });
        nav.goBack();
      },
    });
  const revoke = () =>
    Alert.alert(
      "Revoke this automation?",
      "Future runs stop immediately. Anything already booked stays booked.",
      [
        { text: "Keep" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: () =>
            nav.navigate("SecureConfirm", {
              purpose: "Revoke automation",
              onProof: async (proof: string) => {
                await mandatesApi.patch(
                  params!.mandateId!,
                  "revoke",
                  undefined,
                  proof,
                );
                track("mandate_revoked", {});
                await qc.invalidateQueries({ queryKey: ["mandates"] });
                nav.goBack();
              },
            }),
        },
      ],
    );

  const field = (label: string, child: ReactNode) => (
    <View style={{ gap: 6 }}>
      <Text variant="label" tone="text2">
        {label}
      </Text>
      {child}
    </View>
  );
  const box = {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: t.colors.border,
    borderRadius: t.radius.control,
    backgroundColor: t.colors.card,
  };
  return (
    <Screen
      title={m.title}
      onBack={nav.goBack}
      bg="bg"
      footer={
        <View style={{ gap: 8 }}>
          <Button
            testID={TID.mandates.edit.savePin}
            label="Save with PIN"
            onPress={save}
          />
          {params?.mandateId ? (
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Button
                label={existing.data?.status === "paused" ? "Resume" : "Pause"}
                kind="ghost"
                size="md"
                onPress={async () => {
                  await mandatesApi.patch(
                    params.mandateId!,
                    existing.data?.status === "paused" ? "resume" : "pause",
                  );
                  await qc.invalidateQueries({ queryKey: ["mandates"] });
                  nav.goBack();
                }}
              />
              <Button
                testID={TID.mandates.edit.revoke}
                label="Revoke"
                kind="danger"
                size="md"
                onPress={revoke}
              />
            </View>
          ) : null}
        </View>
      }
    >
      {field(
        "Allowed action",
        <View style={{ gap: 8 }}>
          {ACTIONS.map((a) => (
            <Chip
              key={a.id}
              testID={"mandates.edit.action." + a.id.replace(/\./g, "_")}
              label={a.label}
              selected={m.action === a.id}
              onPress={() => chooseAction(a.id)}
            />
          ))}
          {isMarketplace ? (
            <Text variant="caption" tone="text2">
              UBI may pick an offer on a ride you requested only inside these
              limits. You always set the fare; anything outside them waits for
              you.
            </Text>
          ) : null}
        </View>,
      )}
      {field(
        "For",
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip
            label="Only me"
            selected={m.passengers === "self_only"}
            onPress={() => setM({ ...m, passengers: "self_only" })}
          />
          <Chip
            label="Saved passengers"
            selected={m.passengers === "saved_passengers"}
            onPress={() => setM({ ...m, passengers: "saved_passengers" })}
          />
        </View>,
      )}
      {isMarketplace
        ? field(
            "Vehicle class",
            <View style={{ flexDirection: "row", gap: 8 }}>
              {MARKETPLACE_CLASSES.map((c) => (
                <Chip
                  key={c.id}
                  testID={"mandates.edit.class." + c.id}
                  label={c.label}
                  selected={m.categories.includes(c.id)}
                  onPress={() =>
                    setValues(
                      "vehicle_class",
                      m.categories.includes(c.id)
                        ? m.categories.filter((x) => x !== c.id)
                        : [...m.categories, c.id],
                    )
                  }
                />
              ))}
            </View>,
          )
        : field(
            "Ride class",
            <View style={{ flexDirection: "row", gap: 8 }}>
              {CLASSES.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  selected={m.categories.includes(c)}
                  onPress={() =>
                    setM({
                      ...m,
                      categories: m.categories.includes(c)
                        ? m.categories.filter((x) => x !== c)
                        : [...m.categories, c],
                    })
                  }
                />
              ))}
            </View>,
          )}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          {field(
            "Max per ride",
            <TextInput
              testID={TID.mandates.edit.perRideCap}
              accessibilityLabel="Maximum per ride"
              keyboardType="number-pad"
              defaultValue={formatMinor(m.perRunCap)}
              onEndEditing={(e) =>
                setM({ ...m, perRunCap: money(e.nativeEvent.text) })
              }
              style={[
                box,
                {
                  fontFamily: "Inter-SemiBold",
                  fontSize: 15,
                  color: t.colors.text,
                },
              ]}
            />,
          )}
        </View>
        <View style={{ flex: 1 }}>
          {field(
            "Max per month",
            <TextInput
              testID={TID.mandates.edit.monthlyCap}
              accessibilityLabel="Maximum per month"
              keyboardType="number-pad"
              defaultValue={formatMinor(m.periodCap.amount)}
              onEndEditing={(e) =>
                setM({
                  ...m,
                  periodCap: {
                    ...m.periodCap,
                    amount: money(e.nativeEvent.text),
                  },
                })
              }
              style={[
                box,
                {
                  fontFamily: "Inter-SemiBold",
                  fontSize: 15,
                  color: t.colors.text,
                },
              ]}
            />,
          )}
        </View>
      </View>
      {field(
        "Runs until",
        <View
          style={[
            box,
            { flexDirection: "row", justifyContent: "space-between" },
          ]}
        >
          <Text variant="bodySm">
            {new Date(m.expiresAt).toLocaleDateString("en-NG", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </Text>
          <Text variant="bodySm" tone="text2">
            max 12 months
          </Text>
        </View>,
      )}
      {isMarketplace
        ? field(
            "Limits UBI checks before picking",
            <View style={[box, { paddingVertical: 6, gap: 6 }]}>
              {m.constraints.map((c) => (
                <View key={c.key} style={{ gap: 4 }}>
                  <Text variant="bodySmStrong">{labelOf(c)}</Text>
                  {c.key === "time_window" ? (
                    <>
                      <TextInput
                        testID="mandates.edit.timeWindow"
                        accessibilityLabel="Allowed time window, city time"
                        defaultValue={(c.values ?? []).join(",")}
                        placeholder="07:00-10:00"
                        placeholderTextColor={t.colors.text3}
                        onEndEditing={(e) =>
                          setValues(
                            "time_window",
                            e.nativeEvent.text
                              .split(",")
                              .map((v) => v.trim())
                              .filter((v) => v.length > 0),
                          )
                        }
                        style={{
                          fontFamily: "Inter-SemiBold",
                          fontSize: 15,
                          color: t.colors.text,
                        }}
                      />
                      {windowInvalid ? (
                        <Text variant="caption" tone="errorInk">
                          Use HH:MM-HH:MM, e.g. 07:00-10:00
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text variant="caption" tone="text2">
                      {(c.values ?? []).join(", ") || "any"}
                    </Text>
                  )}
                  <Toggle
                    label="Ask me instead of skipping"
                    value={c.mode === "ask"}
                    onChange={(v) =>
                      setM({
                        ...m,
                        constraints: m.constraints.map((x) =>
                          x.key === c.key
                            ? { ...x, mode: v ? "ask" : "allow" }
                            : x,
                        ),
                      })
                    }
                  />
                </View>
              ))}
            </View>,
          )
        : field(
            "Stop and ask me if",
            <View style={[box, { paddingVertical: 2 }]}>
              {m.constraints.map((c, i) =>
                c.mode === "always_ask" ? (
                  <Row
                    key={c.key}
                    label={labelOf(c)}
                    value="always"
                    last={i === m.constraints.length - 1}
                  />
                ) : (
                  <Toggle
                    key={c.key}
                    label={labelOf(c)}
                    value={c.mode === "ask"}
                    onChange={(v) =>
                      setM({
                        ...m,
                        constraints: m.constraints.map((x) =>
                          x.key === c.key
                            ? { ...x, mode: v ? "ask" : "allow" }
                            : x,
                        ),
                      })
                    }
                  />
                ),
              )}
            </View>,
          )}
    </Screen>
  );
}
