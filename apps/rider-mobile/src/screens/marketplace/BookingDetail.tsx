// A03 ReservationDetail — Marketplace.Booking. An advance booking as its rider sees it.
// DRIVER CONFIRMED only when a named driver is committed AND the rider's funding is
// secured (or explicitly cash); "driver reserved · payment pending" is a different,
// weaker state and is labelled as such. Notices (incl. the no-guaranteed-pickup
// disclosure) are the server's words. A failed booking explains what happened and the
// financial outcome, and offers a CONSENTED rematch only when the server says one is
// available — never an automatic substitute. Cancel and rematch carry caller-held
// Idempotency-Keys.
import React, { useState } from "react";
import { View } from "react-native";
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
  MoneyText,
  Row,
  Screen,
  Sheet,
  Text,
} from "@ubi/mobile-ui";
import { track } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import { marketplaceApi, type MpAdvanceBooking } from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import {
  BOOKING_FAILURE_OUTCOME,
  bookingStatus,
  isOffline,
  refusalFor,
  stalenessOf,
  whenLabel,
  type Refusal,
  type Staleness,
} from "./riderCopy";
import {
  LoadFailure,
  LoadingBlocks,
  StaleBanner,
  StateTag,
} from "./riderParts";

const TID = TEST_IDS.mp.rider.booking;
const ENDED = new Set(["completed", "failed", "cancelled", "released"]);
const CANCELLABLE = new Set(["payment_pending", "confirmed", "reconfirmed"]);

export type BookingDetailProps = {
  b: MpAdvanceBooking;
  stale: Staleness;
  banner: (Refusal & { tone: "ok" | "warn" | "error" }) | null;
  cancel: {
    open: boolean;
    busy: boolean;
    onOpen: () => void;
    onClose: () => void;
    onConfirm: () => void;
  } | null;
  rematch: {
    open: boolean;
    busy: boolean;
    onOpen: () => void;
    onClose: () => void;
    onConfirm: () => void;
  } | null;
  onOpenRematch: (() => void) | null;
  onOpenTrip: (() => void) | null;
  onBack: () => void;
};

export function BookingDetailView(p: BookingDetailProps) {
  const { b } = p;
  const status = bookingStatus(b);
  const tz = b.schedule.timeZone;
  const confirmedDriver = b.driverReserved && b.fullySecured;
  const reservedUnsecured = b.driverReserved && !b.fullySecured;
  return (
    <Screen
      title="Your reservation"
      subtitle={b.schedule.label}
      onBack={p.onBack}
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        <StaleBanner stale={p.stale} testIDs={TID} />
        {p.banner ? (
          <Banner
            testID={TID.refusal}
            tone={p.banner.tone}
            title={p.banner.title}
            body={p.banner.body}
          />
        ) : null}
        <Card style={{ gap: 6 }}>
          <StateTag
            testID={TID.status}
            label={status.label}
            tone={status.tone}
          />
          <Text variant="bodyStrong">{b.statusLabel}</Text>
          {confirmedDriver && b.driver ? (
            <Text variant="bodySm" tone="text2">
              {b.driver.displayName +
                " has committed to this specific trip and your payment is secured."}
            </Text>
          ) : null}
          {reservedUnsecured ? (
            <Text variant="bodySm" tone="warnInk">
              Your driver is reserved, but this booking isn’t fully secured
              until your payment is.
            </Text>
          ) : null}
        </Card>
        {b.driver ? (
          <Card testID={TID.driver} style={{ gap: 2 }}>
            <Text variant="label" tone="text3">
              {b.driverReserved
                ? "Your reserved driver"
                : "The driver you chose"}
            </Text>
            <Text variant="bodyStrong">
              {b.driver.displayName + " · ★ " + b.driver.rating}
            </Text>
            <Text variant="caption" tone="text2">
              {b.driver.vehicle + " · " + b.driver.plateMasked}
            </Text>
          </Card>
        ) : null}
        <Card>
          <Row
            testID={TID.window}
            label="Pickup window"
            value={
              whenLabel(b.schedule.windowStart, tz) +
              " – " +
              whenLabel(b.schedule.windowEnd, tz)
            }
          />
          <Row
            testID={TID.fare}
            label="Agreed fare"
            value={<MoneyText money={b.fareMinor} variant="heading" />}
          />
          <Row label="From" value={b.pickup.label} />
          <Row label="To" value={b.dropoff.label} last />
        </Card>
        <Card testID={TID.funding} style={{ gap: 4 }}>
          <Text variant="label" tone="text3">
            Payment
          </Text>
          <Text variant="bodySm">{b.funding.label}</Text>
          {b.funding.deadline && !ENDED.has(b.state) ? (
            <Text variant="caption" tone="text2">
              {"Must be secured by " +
                whenLabel(b.funding.deadline, tz) +
                ". If it can’t be, the booking is cancelled at no charge."}
            </Text>
          ) : null}
        </Card>
        {!ENDED.has(b.state) && b.state !== "activated" ? (
          <Card testID={TID.reconfirm} style={{ gap: 4 }}>
            <Text variant="label" tone="text3">
              Before your trip
            </Text>
            <Text variant="caption" tone="text2">
              {b.reconfirmation.reconfirmedAt
                ? "Your driver reconfirmed on " +
                  whenLabel(b.reconfirmation.reconfirmedAt, tz) +
                  "."
                : "Your driver reconfirms between " +
                  whenLabel(b.reconfirmation.opensAt, tz) +
                  " and " +
                  whenLabel(b.reconfirmation.deadline, tz) +
                  ". If they don’t, we tell you and you decide what happens next."}
            </Text>
            <Text variant="caption" tone="text2">
              {"Your trip starts being arranged from " +
                whenLabel(b.activationAt, tz) +
                "."}
            </Text>
          </Card>
        ) : null}
        {b.notices.length ? (
          <Card testID={TID.notices} style={{ gap: 4 }}>
            {b.notices.map((n) => (
              <Text key={n} variant="caption" tone="text2">
                {"• " + n}
              </Text>
            ))}
          </Card>
        ) : null}
        {b.failure ? (
          <Card testID={TID.failure} tone="error" style={{ gap: 6 }}>
            <Text variant="bodyStrong">What happened</Text>
            <Text variant="bodySm">{b.failure.message}</Text>
            <View testID={TID.outcome} style={{ gap: 2 }}>
              {BOOKING_FAILURE_OUTCOME(b.failure).map((line) => (
                <Text key={line} variant="caption" tone="text2">
                  {"• " + line}
                </Text>
              ))}
            </View>
          </Card>
        ) : null}
        {p.rematch ? (
          <Button
            testID={TID.rematch}
            label="Look for another driver"
            onPress={p.rematch.onOpen}
          />
        ) : null}
        {p.onOpenRematch ? (
          <Button
            label="See your new request"
            kind="secondary"
            onPress={p.onOpenRematch}
          />
        ) : null}
        {p.onOpenTrip ? (
          <Button
            testID={TID.openTrip}
            label="Open your trip"
            onPress={p.onOpenTrip}
          />
        ) : null}
        {p.cancel ? (
          <>
            <Card testID={TID.terms}>
              <Text variant="caption" tone="text2">
                Cancelling before your trip starts is free: your driver is
                released and any payment hold is returned.
              </Text>
            </Card>
            <Button
              testID={TID.cancel}
              label="Cancel reservation"
              kind="danger"
              onPress={p.cancel.onOpen}
            />
          </>
        ) : null}
      </View>
      {p.cancel ? (
        <Sheet visible={p.cancel.open} onDismiss={p.cancel.onClose}>
          <View style={{ gap: 10 }}>
            <Text variant="title">Cancel this reservation?</Text>
            <Text variant="bodySm" tone="text2">
              Your driver is released and any payment hold is returned. There’s
              no cancellation fee.
            </Text>
            <Button
              testID={TID.cancelConfirm}
              label="Cancel reservation"
              kind="danger"
              loading={p.cancel.busy}
              onPress={p.cancel.onConfirm}
            />
            <Button
              label="Keep it"
              kind="secondary"
              onPress={p.cancel.onClose}
            />
          </View>
        </Sheet>
      ) : null}
      {p.rematch ? (
        <Sheet visible={p.rematch.open} onDismiss={p.rematch.onClose}>
          <View style={{ gap: 10 }}>
            <Text variant="title">Look for another driver?</Text>
            <Text variant="bodySm" tone="text2">
              We’ll ask drivers to offer on the same pickup window at your
              original fare. If prices have moved above it, we’ll ask you first
              — we never raise it on our own.
            </Text>
            <Text variant="bodySm" tone="text2">
              No driver is secured until you choose one of the new offers.
            </Text>
            <Button
              testID={TID.rematchConfirm}
              label="Yes, ask drivers again"
              loading={p.rematch.busy}
              onPress={p.rematch.onConfirm}
            />
            <Button
              label="Not now"
              kind="secondary"
              onPress={p.rematch.onClose}
            />
          </View>
        </Sheet>
      ) : null}
    </Screen>
  );
}

export function BookingDetailContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } =
    useRoute<RouteProp<MarketplaceStackParamList, "Booking">>();
  const id = params.bookingId;
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("booking");
  const key = ["mp", "booking", id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => marketplaceApi.booking(id),
    retry: false,
    refetchInterval: (query) =>
      query.state.data && ENDED.has(query.state.data.state) ? false : 15_000,
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [rematchOpen, setRematchOpen] = useState(false);
  const [banner, setBanner] = useState<
    (Refusal & { tone: "ok" | "warn" | "error" }) | null
  >(null);
  const onRefused = (e: unknown) => {
    if (!isOffline(e)) void q.refetch();
    setBanner({ ...refusalFor(e), tone: isOffline(e) ? "warn" : "error" });
  };
  const cancel = useMutation({
    mutationFn: (version: number) =>
      marketplaceApi.cancelBooking(id, keys.keyFor("cancel:" + version)),
    onSuccess: (b, version) => {
      keys.settle("cancel:" + version);
      setCancelOpen(false);
      queryClient.setQueryData(key, b);
      void queryClient.invalidateQueries({ queryKey: ["mp", "later"] });
      setBanner({
        tone: "ok",
        title: "Reservation cancelled",
        body: "Your driver was released and any payment hold returned. You weren’t charged.",
      });
      track("mp_booking_cancelled", { bookingId: id });
    },
    onError: (e, version) => {
      keys.settle("cancel:" + version, e);
      setCancelOpen(false);
      onRefused(e);
    },
  });
  const rematch = useMutation({
    mutationFn: (version: number) =>
      marketplaceApi.rematchBooking(id, keys.keyFor("rematch:" + version)),
    onSuccess: (r, version) => {
      keys.settle("rematch:" + version);
      setRematchOpen(false);
      void queryClient.invalidateQueries({ queryKey: key });
      track("mp_booking_rematched", { bookingId: id });
      nav.navigate("AdvanceOffers", { requestId: r.requestId });
    },
    onError: (e, version) => {
      keys.settle("rematch:" + version, e);
      setRematchOpen(false);
      onRefused(e);
    },
  });

  if (!q.data)
    return (
      <Screen title="Your reservation" onBack={nav.goBack}>
        {q.isError ? (
          <LoadFailure
            offline={isOffline(q.error)}
            title="Couldn’t load this reservation"
            body={(q.error as Error).message}
            onRetry={() => void q.refetch()}
            testIDs={TID}
          />
        ) : (
          <LoadingBlocks heights={[90, 110, 110]} />
        )}
      </Screen>
    );
  const b = q.data;
  return (
    <BookingDetailView
      b={b}
      stale={stalenessOf(q.isError ? q.error : null)}
      banner={banner}
      cancel={
        CANCELLABLE.has(b.state)
          ? {
              open: cancelOpen,
              busy: cancel.isPending,
              onOpen: () => {
                setBanner(null);
                setCancelOpen(true);
              },
              onClose: () => setCancelOpen(false),
              onConfirm: () => cancel.mutate(b.version),
            }
          : null
      }
      rematch={
        b.failure?.rematchAvailable && !b.rematchRequestId
          ? {
              open: rematchOpen,
              busy: rematch.isPending,
              onOpen: () => {
                setBanner(null);
                setRematchOpen(true);
              },
              onClose: () => setRematchOpen(false),
              onConfirm: () => rematch.mutate(b.version),
            }
          : null
      }
      onOpenRematch={
        b.rematchRequestId
          ? () =>
              nav.navigate("AdvanceOffers", { requestId: b.rematchRequestId })
          : null
      }
      onOpenTrip={
        b.state === "activated"
          ? () => nav.navigate("AdvanceOffers", { requestId: b.requestId })
          : null
      }
      onBack={nav.goBack}
    />
  );
}
