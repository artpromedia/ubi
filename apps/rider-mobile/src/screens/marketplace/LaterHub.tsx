// A03 Book for Later hub — Marketplace.Later. Lists the rider's one-off scheduled
// requests, advance bookings (reserved drivers) and recurring journeys, each with its
// status WORD. Reads are never flag-gated server-side (turning a product off stops new
// bookings only), so existing items always show; "Book a ride for later" appears only
// while at least one Book for Later product is on here.
import React from "react";
import { Pressable, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Banner, Button, Card, Screen, Text } from "@ubi/mobile-ui";
import { useFlag } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import {
  marketplaceApi,
  type MpAdvanceBooking,
  type MpRecurringTemplate,
  type MpScheduledRequest,
} from "../../api/marketplace";
import {
  WEEKDAYS,
  bookingStatus,
  isOffline,
  scheduledStatus,
  seriesStatus,
  stalenessOf,
  type Staleness,
  type StatusWord,
} from "./riderCopy";
import {
  LoadFailure,
  LoadingBlocks,
  StaleBanner,
  StateTag,
} from "./riderParts";

const TID = TEST_IDS.mp.rider.later;

export type LaterRow = {
  id: string;
  title: string;
  detail: string;
  status: StatusWord;
  onOpen: () => void;
};

export type LaterSectionError = {
  key: "bookings" | "scheduled" | "series";
  title: string;
  offline: boolean;
  onRetry: () => void;
};

export type LaterHubProps = {
  loading: boolean;
  failure: { offline: boolean; body: string; onRetry: () => void } | null;
  stale: Staleness;
  /** Lists that never loaded — an error each, never "the last update". */
  sectionErrors: LaterSectionError[];
  scheduled: LaterRow[];
  bookings: LaterRow[];
  series: LaterRow[];
  onBook: (() => void) | null;
  onBack: () => void;
};

function SectionError({ e }: { e: LaterSectionError }) {
  return (
    <View testID={dynamicTestId(TID.sectionError, e.key)} style={{ gap: 8 }}>
      <Banner
        tone={e.offline ? "warn" : "error"}
        title={e.title}
        body={
          e.offline
            ? "You’re offline, so this list hasn’t loaded. Reconnect and try again."
            : "This list couldn’t load. What you booked is unchanged — try again."
        }
      />
      <Button
        label="Try again"
        kind="secondary"
        size="md"
        onPress={e.onRetry}
      />
    </View>
  );
}

function Section({
  title,
  rows,
  testID,
}: {
  title: string;
  rows: LaterRow[];
  testID: string;
}) {
  if (!rows.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text variant="label" tone="text3">
        {title}
      </Text>
      {rows.map((r) => (
        <Pressable
          key={r.id}
          testID={dynamicTestId(testID, r.id)}
          accessibilityRole="button"
          accessibilityLabel={r.title + ". " + r.status.label + ". " + r.detail}
          onPress={r.onOpen}
        >
          <Card style={{ gap: 6 }}>
            <Text variant="bodySmStrong">{r.title}</Text>
            <StateTag label={r.status.label} tone={r.status.tone} />
            <Text variant="caption" tone="text2">
              {r.detail}
            </Text>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

export function LaterHubView(p: LaterHubProps) {
  const empty =
    !p.scheduled.length &&
    !p.bookings.length &&
    !p.series.length &&
    !p.sectionErrors.length;
  const errorFor = (key: LaterSectionError["key"]) =>
    p.sectionErrors.find((e) => e.key === key);
  return (
    <Screen
      title="Booked for later"
      subtitle="Scheduled ≠ confirmed — each shows its own status"
      onBack={p.onBack}
    >
      <View testID={TID.screen} style={{ gap: 14 }}>
        {p.loading ? (
          <LoadingBlocks heights={[80, 80, 80]} />
        ) : p.failure ? (
          <LoadFailure
            offline={p.failure.offline}
            title="Couldn’t load your bookings"
            body={p.failure.body}
            onRetry={p.failure.onRetry}
            testIDs={TID}
          />
        ) : (
          <>
            <StaleBanner stale={p.stale} testIDs={TID} />
            {empty ? (
              <Card testID={TID.empty} style={{ gap: 4 }}>
                <Text variant="bodyStrong">Nothing booked for later</Text>
                <Text variant="bodySm" tone="text2">
                  Scheduled trips, reserved drivers and recurring journeys
                  appear here.
                </Text>
              </Card>
            ) : null}
            {errorFor("bookings") ? (
              <SectionError e={errorFor("bookings")!} />
            ) : null}
            <Section
              title="Reserved drivers"
              rows={p.bookings}
              testID={TID.booking}
            />
            {errorFor("scheduled") ? (
              <SectionError e={errorFor("scheduled")!} />
            ) : null}
            <Section
              title="Scheduled requests"
              rows={p.scheduled}
              testID={TID.scheduled}
            />
            {errorFor("series") ? (
              <SectionError e={errorFor("series")!} />
            ) : null}
            <Section
              title="Recurring journeys"
              rows={p.series}
              testID={TID.series}
            />
          </>
        )}
        {p.onBook ? (
          <Button
            testID={TID.book}
            label="Book a ride for later"
            onPress={p.onBook}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const ACTIVE_BOOKING = new Set([
  "held",
  "payment_pending",
  "confirmed",
  "reconfirmed",
  "activated",
]);

export const seriesPattern = (s: MpRecurringTemplate) =>
  WEEKDAYS.filter((d) => s.daysOfWeek.includes(d.code))
    .map((d) => d.label)
    .join(", ") +
  " at " +
  s.localTime +
  " (" +
  s.timeZone +
  ")";

export function LaterHubContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const scheduledOn = useFlag("scheduled_rides");
  const advanceOn = useFlag("marketplace_advance_reservations");
  const seriesOn = useFlag("marketplace_recurring_journeys");
  const scheduledQ = useQuery({
    queryKey: ["mp", "later", "scheduled"],
    queryFn: marketplaceApi.scheduledList,
    retry: false,
  });
  const bookingsQ = useQuery({
    queryKey: ["mp", "later", "bookings"],
    queryFn: marketplaceApi.bookings,
    retry: false,
  });
  const seriesQ = useQuery({
    queryKey: ["mp", "later", "series"],
    queryFn: marketplaceApi.seriesList,
    retry: false,
  });
  const queries = [scheduledQ, bookingsQ, seriesQ];
  const sections = [
    {
      key: "bookings" as const,
      title: "Couldn’t load your reserved drivers",
      q: bookingsQ,
    },
    {
      key: "scheduled" as const,
      title: "Couldn’t load your scheduled requests",
      q: scheduledQ,
    },
    {
      key: "series" as const,
      title: "Couldn’t load your recurring journeys",
      q: seriesQ,
    },
  ];
  const loading = queries.some((q) => q.isPending);
  // Nothing to show at all: every list failed without ever loading.
  const allFailed = queries.every((q) => q.isError && !q.data);
  const firstError = queries.find((q) => q.isError)?.error;
  const retry = () => queries.forEach((q) => void q.refetch());

  const scheduled = (scheduledQ.data?.items ?? []).map(
    (sr: MpScheduledRequest): LaterRow => ({
      id: sr.scheduledRequestId,
      title: sr.pickup.label + " → " + sr.dropoff.label,
      detail: sr.schedule.label + " · " + sr.statusLabel,
      status: scheduledStatus(sr),
      onOpen: () =>
        nav.navigate("Scheduled", {
          scheduledRequestId: sr.scheduledRequestId,
        }),
    }),
  );
  const bookings = [...(bookingsQ.data?.items ?? [])]
    .sort(
      (a, b) =>
        Number(ACTIVE_BOOKING.has(b.state)) -
        Number(ACTIVE_BOOKING.has(a.state)),
    )
    .map(
      (b: MpAdvanceBooking): LaterRow => ({
        id: b.bookingId,
        title: b.pickup.label + " → " + b.dropoff.label,
        detail:
          b.schedule.label + (b.driver ? " · " + b.driver.displayName : ""),
        status: bookingStatus(b),
        onOpen: () => nav.navigate("Booking", { bookingId: b.bookingId }),
      }),
    );
  const series = (seriesQ.data?.items ?? []).map(
    (s: MpRecurringTemplate): LaterRow => ({
      id: s.templateId,
      title: s.pickup.label + " → " + s.dropoff.label,
      detail: seriesPattern(s),
      status: seriesStatus(s),
      onOpen: () => nav.navigate("Series", { templateId: s.templateId }),
    }),
  );

  return (
    <LaterHubView
      loading={loading}
      failure={
        !loading && allFailed
          ? {
              offline: isOffline(firstError),
              body: (firstError as Error)?.message ?? "",
              onRetry: retry,
            }
          : null
      }
      // Stale = a refresh failed on a list that HAD loaded; a list that never loaded is its
      // own section error below, never "showing the last update".
      stale={stalenessOf(
        ...queries.map((q) => (q.isError && q.data ? q.error : null)),
      )}
      sectionErrors={
        allFailed
          ? []
          : sections
              .filter((s) => s.q.isError && !s.q.data)
              .map((s) => ({
                key: s.key,
                title: s.title,
                offline: isOffline(s.q.error),
                onRetry: () => void s.q.refetch(),
              }))
      }
      scheduled={scheduled}
      bookings={bookings}
      series={series}
      onBook={
        scheduledOn || advanceOn || seriesOn
          ? () => nav.navigate("Details")
          : null
      }
      onBack={nav.goBack}
    />
  );
}
