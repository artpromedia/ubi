// A03 ScheduleRide (design handoff flow 8) — presentational. Three explicitly different
// products, each shown only when its server flag is on:
//  - Scheduled request: stored now, sent to drivers near pickup — NO driver is secured.
//  - Reserve a driver: drivers offer now on the future pickup window; still no driver
//    until the rider selects one.
//  - Repeat: a series whose every trip books (and is secured) on its own.
// Local date + time in the pickup's timezone and a pickup window go to the server, which
// resolves and stores the instant (DST included). Fare bounds are the server's quote;
// typed amounts are packaged only, and the server validates them.
import React from "react";
import { TextInput, View, type TextStyle } from "react-native";
import {
  Banner,
  Button,
  Card,
  Chip,
  MoneyText,
  Row,
  Screen,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import { accessibleMoney, type Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { Refusal } from "./riderCopy";
import {
  LoadFailure,
  LoadingBlocks,
  RouteList,
  UnavailableCard,
  type RoutePoint,
} from "./riderParts";

const TID = TEST_IDS.mp.rider.schedule;

export type ScheduleProduct = "scheduled" | "advance" | "series";

export type ScheduleRideProps = {
  loading: boolean;
  loadFailure: { offline: boolean; body: string; onRetry: () => void } | null;
  unavailable: { onNow: () => void } | null;
  products: { code: ScheduleProduct; label: string; detail: string }[];
  product: ScheduleProduct;
  onProduct: (p: ScheduleProduct) => void;
  route: RoutePoint[];
  routeSummary: string;
  bounds: { minimum: Money; suggested: Money; maximum: Money } | null;
  timeZoneLabel: string;
  // Date/time — one-off date, or the series start date.
  date: string;
  onDate: (v: string) => void;
  dateChips: { label: string; value: string }[];
  time: string;
  onTime: (v: string) => void;
  windowChoices: { label: string; minutes: number | undefined }[];
  windowMinutes: number | undefined;
  onWindow: (m: number | undefined) => void;
  // Series only.
  days: { code: string; label: string; selected: boolean }[] | null;
  onToggleDay: (code: string) => void;
  endsOn: string;
  onEndsOn: (v: string) => void;
  seriesProducts: {
    code: "scheduled_request" | "advance_reservation";
    label: string;
  }[];
  seriesProduct: "scheduled_request" | "advance_reservation";
  onSeriesProduct: (p: "scheduled_request" | "advance_reservation") => void;
  // Fares.
  fareRaw: string;
  /** The amount that will be sent (a server figure or the packaged typed amount). */
  fareSelected: Money | null;
  onFare: (v: string) => void;
  fareChips: { key: string; label: string; money: Money }[];
  fareChip: string | null;
  onFareChip: (key: string) => void;
  maxFare: {
    raw: string;
    selected: Money | null;
    onChange: (v: string) => void;
    chips: { key: string; label: string; money: Money }[];
    chip: string | null;
    onChip: (key: string) => void;
  } | null;
  noDriverCopy: string;
  terms: string[];
  fieldError: string | null;
  refusal: Refusal | null;
  submitLabel: string;
  canSubmit: boolean;
  busy: boolean;
  onSubmit: () => void;
  onBack: () => void;
};

export function ScheduleRideScreen(p: ScheduleRideProps) {
  const t = useTheme();
  if (p.loading)
    return (
      <Screen title="Book for later" onBack={p.onBack}>
        <LoadingBlocks heights={[100, 200]} />
      </Screen>
    );
  if (p.unavailable)
    return (
      <Screen title="Book for later" onBack={p.onBack}>
        <UnavailableCard
          testID={TID.unavailable}
          title="Booking for later isn’t available here yet"
          body="Scheduling rides ahead isn’t offered in your city right now. You can still book this trip now and choose from drivers’ offers."
          action={{
            label: "Book it now instead",
            onPress: p.unavailable.onNow,
          }}
        />
      </Screen>
    );
  if (p.loadFailure)
    return (
      <Screen title="Book for later" onBack={p.onBack}>
        <LoadFailure
          offline={p.loadFailure.offline}
          title="Couldn’t price this trip"
          body={p.loadFailure.body}
          onRetry={p.loadFailure.onRetry}
          testIDs={TID}
        />
      </Screen>
    );
  const input = (
    testID: string,
    value: string,
    onChange: (v: string) => void,
    a11y: string,
    placeholder: string,
    keyboard?: "number-pad",
  ) => (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChange}
      accessibilityLabel={a11y}
      placeholder={placeholder}
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
  return (
    <Screen title="Book for later" onBack={p.onBack}>
      <View testID={TID.screen} style={{ gap: 12 }}>
        <View style={{ gap: 6 }}>
          {p.products.map((opt) => (
            <Chip
              key={opt.code}
              testID={dynamicTestId(TID.product, opt.code)}
              label={opt.label}
              selected={p.product === opt.code}
              onPress={() => p.onProduct(opt.code)}
            />
          ))}
          <Text variant="caption" tone="text2">
            {p.products.find((o) => o.code === p.product)?.detail}
          </Text>
        </View>
        <Banner
          testID={TID.noDriver}
          tone="warn"
          title="No driver secured yet"
          body={p.noDriverCopy}
        />
        <Card testID={TID.stops} style={{ gap: 8 }}>
          <RouteList points={p.route} />
          <Text variant="caption" tone="text2">
            {p.routeSummary}
          </Text>
        </Card>
        <Card style={{ gap: 6 }}>
          {p.days ? (
            <>
              <Text variant="label" tone="text3">
                Repeat on
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {p.days.map((d) => (
                  <Chip
                    key={d.code}
                    testID={dynamicTestId(TID.day, d.code)}
                    label={d.label}
                    selected={d.selected}
                    onPress={() => p.onToggleDay(d.code)}
                  />
                ))}
              </View>
            </>
          ) : null}
          <Text variant="label" tone="text3">
            {p.days ? "Starting on (YYYY-MM-DD)" : "Pickup date (YYYY-MM-DD)"}
          </Text>
          {input(
            TID.date,
            p.date,
            p.onDate,
            p.days ? "Series start date" : "Pickup date",
            "2026-10-01",
          )}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {p.dateChips.map((c) => (
              <Chip
                key={c.value}
                testID={dynamicTestId(TID.dateChip, c.value)}
                label={c.label}
                selected={p.date === c.value}
                onPress={() => p.onDate(c.value)}
              />
            ))}
          </View>
          <Text variant="label" tone="text3">
            Pickup time (HH:MM, 24-hour)
          </Text>
          {input(TID.time, p.time, p.onTime, "Pickup time", "07:30")}
          <Text testID={TID.timeZone} variant="caption" tone="text2">
            {p.timeZoneLabel}
          </Text>
          {p.days ? (
            <>
              <Text variant="label" tone="text3">
                Ends on (optional, YYYY-MM-DD)
              </Text>
              {input(
                TID.endsOn,
                p.endsOn,
                p.onEndsOn,
                "Series end date, optional",
                "",
              )}
            </>
          ) : null}
          <Text variant="label" tone="text3">
            Pickup window
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {p.windowChoices.map((w) => (
              <Chip
                key={w.label}
                testID={dynamicTestId(TID.window, w.minutes ?? "standard")}
                label={w.label}
                selected={p.windowMinutes === w.minutes}
                onPress={() => p.onWindow(w.minutes)}
              />
            ))}
          </View>
          {p.days && p.seriesProducts.length > 1 ? (
            <>
              <Text variant="label" tone="text3">
                Each trip in the series
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {p.seriesProducts.map((sp) => (
                  <Chip
                    key={sp.code}
                    testID={dynamicTestId(TID.product, "series." + sp.code)}
                    label={sp.label}
                    selected={p.seriesProduct === sp.code}
                    onPress={() => p.onSeriesProduct(sp.code)}
                  />
                ))}
              </View>
            </>
          ) : null}
        </Card>
        <Card style={{ gap: 6 }}>
          {p.bounds ? (
            <View
              testID={TID.bounds}
              accessible
              // A grouped element is read by its label ONLY — the amounts must be in it.
              accessibilityLabel={[
                "Fare range today for this route",
                "minimum " + accessibleMoney(p.bounds.minimum),
                "suggested " + accessibleMoney(p.bounds.suggested),
                "maximum " + accessibleMoney(p.bounds.maximum),
              ].join(", ")}
            >
              <Text variant="label" tone="text3">
                Fare range today (priced by UBI)
              </Text>
              <Row
                label="Minimum"
                value={
                  <MoneyText money={p.bounds.minimum} variant="bodySmStrong" />
                }
              />
              <Row
                label="Suggested"
                value={
                  <MoneyText
                    money={p.bounds.suggested}
                    variant="bodySmStrong"
                  />
                }
              />
              <Row
                label="Maximum"
                value={
                  <MoneyText money={p.bounds.maximum} variant="bodySmStrong" />
                }
                last
              />
              <Text variant="caption" tone="text2">
                Prices are refreshed when your trip is sent to drivers.
              </Text>
            </View>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text variant="label" tone="text3" style={{ flex: 1 }}>
              Your fare
            </Text>
            <MoneyText money={p.fareSelected} variant="title" />
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {p.fareChips.map((c) => (
              <Chip
                key={c.key}
                testID={dynamicTestId(TID.fareChip, c.key)}
                label={c.label}
                selected={p.fareChip === c.key}
                onPress={() => p.onFareChip(c.key)}
              />
            ))}
          </View>
          {input(
            TID.fare,
            p.fareRaw,
            p.onFare,
            "Or type your fare in whole naira",
            "Or type an amount (whole naira)",
            "number-pad",
          )}
          {p.maxFare ? (
            <>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Text variant="label" tone="text3" style={{ flex: 1 }}>
                  The most you approve
                </Text>
                <MoneyText money={p.maxFare.selected} variant="title" />
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {p.maxFare.chips.map((c) => (
                  <Chip
                    key={c.key}
                    testID={dynamicTestId(TID.maxFareChip, c.key)}
                    label={c.label}
                    selected={p.maxFare!.chip === c.key}
                    onPress={() => p.maxFare!.onChip(c.key)}
                  />
                ))}
              </View>
              {input(
                TID.maxFare,
                p.maxFare.raw,
                p.maxFare.onChange,
                "Or type the most you approve in whole naira",
                "Or type an amount (whole naira)",
                "number-pad",
              )}
              <Text variant="caption" tone="text2">
                If prices move above this by the time your trip is sent, we ask
                you again before sending it.
              </Text>
            </>
          ) : null}
        </Card>
        <Card testID={TID.terms} style={{ gap: 4 }}>
          <Text variant="label" tone="text3">
            Good to know
          </Text>
          {p.terms.map((line) => (
            <Text key={line} variant="caption" tone="text2">
              {"• " + line}
            </Text>
          ))}
        </Card>
        {p.fieldError ? (
          <Text testID={TID.fieldError} variant="caption" tone="errorInk">
            {p.fieldError}
          </Text>
        ) : null}
        {p.refusal ? (
          <Banner
            testID={TID.refusal}
            tone="error"
            title={p.refusal.title}
            body={p.refusal.body}
          />
        ) : null}
        <Button
          testID={TID.submit}
          label={p.submitLabel}
          disabled={!p.canSubmit}
          loading={p.busy}
          onPress={p.onSubmit}
        />
      </View>
    </Screen>
  );
}
