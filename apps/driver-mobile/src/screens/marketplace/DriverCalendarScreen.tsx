// A03 "DriverReservations" (design handoff A01 flow 9): the driver's booking calendar —
// committed FUTURE bookings, separate from the live current/next jobs. Each booking
// shows its pickup window and route (coarse areas until activation), what the driver
// keeps (server netMinor), its status in words, reconfirmation (required state + action)
// and withdrawal with its financial outcome explained up front. There is no
// acceptance-rate metric anywhere on this screen.
import React from "react";
import { TextInput, View } from "react-native";
import {
  Banner,
  Button,
  Card,
  MoneyText,
  Row,
  Screen,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { dynamicTestId } from "@ubi/contracts";
import { MP_DRIVER_TID } from "./testIds";
import { StateTag, type TagTone } from "./TripParts";
import type { Refusal, Staleness } from "./tripCopy";

const TID = MP_DRIVER_TID.calendar;

export type BookingCardView = {
  bookingId: string;
  windowLabel: string;
  routeLabel: string;
  statusLabel: string;
  statusTone: TagTone;
  fareMinor: Money;
  commissionMinor: Money | null;
  netMinor: Money | null;
  fundingLabel: string;
  notices: string[];
  reconfirm: null | {
    text: string;
    tone: "warn" | "ok" | "neutral" | "error";
    onReconfirm: (() => void) | null;
    busy: boolean;
  };
  withdraw: null | {
    open: boolean;
    reason: string;
    onReason: (v: string) => void;
    onOpen: () => void;
    onCancel: () => void;
    onConfirm: () => void;
    busy: boolean;
  };
  failure: null | { title: string; outcomes: string[] };
  onOpenTrip: (() => void) | null;
};
export type DriverCalendarProps = {
  note: string;
  bookings: BookingCardView[];
  conflicts: string[];
  banner: null | (Refusal & { tone: "error" | "warn" | "ok" });
  stale: Staleness;
  onBack: () => void;
};

function BookingCard({ b }: { b: BookingCardView }) {
  const t = useTheme();
  return (
    <Card testID={dynamicTestId(TID.booking, b.bookingId)} style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text
          testID={dynamicTestId(TID.window, b.bookingId)}
          variant="bodyStrong"
          style={{ flex: 1 }}
        >
          {b.windowLabel}
        </Text>
      </View>
      <StateTag
        testID={dynamicTestId(TID.status, b.bookingId)}
        label={b.statusLabel}
        tone={b.statusTone}
      />
      <Text
        testID={dynamicTestId(TID.route, b.bookingId)}
        variant="bodySm"
        tone="text2"
      >
        {b.routeLabel}
      </Text>
      <Row
        label="Agreed fare"
        value={<MoneyText money={b.fareMinor} variant="bodySmStrong" />}
      />
      {b.commissionMinor ? (
        <Row
          label="Commission (10%, captured once at selection)"
          value={<MoneyText money={b.commissionMinor} variant="bodySmStrong" />}
        />
      ) : null}
      {b.netMinor ? (
        <Row
          testID={dynamicTestId(TID.net, b.bookingId)}
          label="You keep"
          value={<MoneyText money={b.netMinor} variant="heading" tone="ok" />}
        />
      ) : null}
      <Row label="Rider payment" value={b.fundingLabel} last />
      {b.notices.map((n, i) => (
        <Text key={i} variant="caption" tone="text2">
          {n}
        </Text>
      ))}
      {b.failure ? (
        <View
          testID={dynamicTestId(TID.outcome, b.bookingId)}
          style={{ gap: 2 }}
        >
          <Text variant="bodySmStrong">{b.failure.title}</Text>
          {b.failure.outcomes.map((o, i) => (
            <Text key={i} variant="caption" tone="text2">
              {"• " + o}
            </Text>
          ))}
        </View>
      ) : null}
      {b.reconfirm ? (
        <View style={{ gap: 6 }}>
          <Text
            testID={dynamicTestId(TID.reconfirmState, b.bookingId)}
            variant="caption"
            tone={
              b.reconfirm.tone === "warn"
                ? "warnInk"
                : b.reconfirm.tone === "error"
                  ? "errorInk"
                  : b.reconfirm.tone === "ok"
                    ? "ok"
                    : "text2"
            }
          >
            {b.reconfirm.text}
          </Text>
          {b.reconfirm.onReconfirm ? (
            <Button
              testID={dynamicTestId(TID.reconfirm, b.bookingId)}
              label="Reconfirm I’ll be there"
              size="md"
              loading={b.reconfirm.busy}
              onPress={b.reconfirm.onReconfirm}
            />
          ) : null}
        </View>
      ) : null}
      {b.onOpenTrip ? (
        <Button
          testID={dynamicTestId(TID.openTrip, b.bookingId)}
          label="Open trip stops"
          kind="secondary"
          size="md"
          onPress={b.onOpenTrip}
        />
      ) : null}
      {b.withdraw ? (
        b.withdraw.open ? (
          <View style={{ gap: 8 }}>
            <Text variant="caption" tone="text2">
              If you can’t attend, withdraw now. The booking ends: the 10%
              commission captured when you were selected is returned to your
              wallet as a linked reversal, the rider’s payment hold is released
              and, if there’s still time before pickup, the rider may choose a
              rematch — no one is substituted for you.
            </Text>
            <TextInput
              testID={dynamicTestId(TID.withdrawReason, b.bookingId)}
              accessibilityLabel="Why you can’t attend"
              placeholder="Why you can’t attend (shared with support)"
              placeholderTextColor={t.colors.text3}
              maxLength={280}
              value={b.withdraw.reason}
              onChangeText={b.withdraw.onReason}
              style={{
                ...t.type.body,
                color: t.colors.text,
                minHeight: t.targets.min,
                borderWidth: 1,
                borderColor: t.colors.border,
                borderRadius: t.radius.control,
                paddingHorizontal: 12,
                backgroundColor: t.colors.card,
              }}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button
                testID={dynamicTestId(TID.withdrawCancel, b.bookingId)}
                label="Keep booking"
                kind="secondary"
                size="md"
                onPress={b.withdraw.onCancel}
                style={{ flex: 1 }}
              />
              <Button
                testID={dynamicTestId(TID.withdrawConfirm, b.bookingId)}
                label="Withdraw"
                kind="danger"
                size="md"
                disabled={!b.withdraw.reason.trim()}
                loading={b.withdraw.busy}
                onPress={b.withdraw.onConfirm}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : (
          <Button
            testID={dynamicTestId(TID.withdraw, b.bookingId)}
            label="I can’t attend…"
            kind="ghost"
            size="md"
            onPress={b.withdraw.onOpen}
          />
        )
      ) : null}
    </Card>
  );
}

export function DriverCalendarScreen(p: DriverCalendarProps) {
  return (
    <Screen
      title="Your bookings"
      subtitle="Future trips, separate from your current and next job"
      onBack={p.onBack}
      bg="bg2"
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        {p.banner ? (
          <Banner
            testID={TID.actionError}
            tone={p.banner.tone}
            title={p.banner.title}
            body={p.banner.body}
          />
        ) : null}
        {p.stale === "error" ? (
          <Banner
            testID={TID.error}
            tone="warn"
            title="Couldn’t refresh"
            body="Showing the bookings the server last sent. We’ll keep trying."
          />
        ) : null}
        {p.stale === "offline" ? (
          <Banner
            testID={TID.offline}
            tone="warn"
            title="You’re offline"
            body="Showing the bookings the server last sent. Reconfirming or withdrawing needs a connection — retrying is safe."
          />
        ) : null}
        <Text testID={TID.note} variant="caption" tone="text2">
          {p.note}
        </Text>
        {p.conflicts.map((c, i) => (
          <Banner
            key={i}
            testID={dynamicTestId(TID.conflict, i)}
            tone="warn"
            title="Bookings overlap"
            body={c}
          />
        ))}
        {p.bookings.length === 0 ? (
          <Card testID={TID.empty}>
            <Text variant="bodyStrong">No future bookings</Text>
            <Text variant="caption" tone="text2">
              When a rider selects your offer on an advance booking, it appears
              here with its pickup window and what you’ll keep.
            </Text>
          </Card>
        ) : (
          p.bookings.map((b) => <BookingCard key={b.bookingId} b={b} />)
        )}
      </View>
    </Screen>
  );
}
