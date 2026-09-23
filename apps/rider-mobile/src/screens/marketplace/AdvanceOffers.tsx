// A03 advance-offer inbox — Marketplace.AdvanceOffers. Drivers' offers on a FUTURE pickup
// window (snapshot `advanceOffers`, never mixed with live offers). No driver is secured
// until the rider selects one: POST /select {bidId, requestVersion, bidVersion} with a
// caller-held Idempotency-Key reserves that driver in advance and answers the booking
// (driver reserved; payment secured now or pending). Without the booking in the answer
// the screen converges on the rider's bookings list — never on a guess.
import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banner, Button, Card, MoneyText, Screen, Text } from "@ubi/mobile-ui";
import { ApiError, track } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import {
  marketplaceApi,
  type MpAdvanceOffer,
  type MpRequestSnapshot,
} from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import {
  inLabel,
  isOffline,
  refusalFor,
  stalenessOf,
  useNow,
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
import { driverCardOf, vehicleLineOf } from "./offerView";

const TID = TEST_IDS.mp.rider.advance;
const CLOSED = new Set(["cancelled", "expired", "no_offers"]);

export type AdvanceOffersProps = {
  snap: MpRequestSnapshot;
  now: number;
  stale: Staleness;
  phase: "offers" | "confirming" | "closed";
  choosing: string | null;
  refusal: Refusal | null;
  onChoose: (offer: MpAdvanceOffer) => void;
  onCancel: (() => void) | null;
  cancelling: boolean;
  onBack: () => void;
};

export function AdvanceOffersView(p: AdvanceOffersProps) {
  const r = p.snap.request;
  const booking = r.booking;
  const offers = p.snap.advanceOffers ?? [];
  return (
    <Screen
      title="Reserve a driver"
      subtitle={booking ? booking.schedule.label : undefined}
      onBack={p.onBack}
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        <StaleBanner stale={p.stale} testIDs={TID} />
        <Banner
          testID={TID.noDriver}
          tone="warn"
          title="No driver secured yet"
          body={
            booking?.notice ??
            "No driver is secured until you choose one of these offers."
          }
        />
        {booking ? (
          <Card testID={TID.window} style={{ gap: 4 }}>
            <Text variant="label" tone="text3">
              Your future pickup window
            </Text>
            <Text variant="bodySmStrong">
              {whenLabel(
                booking.schedule.windowStart,
                booking.schedule.timeZone,
              ) +
                " – " +
                whenLabel(
                  booking.schedule.windowEnd,
                  booking.schedule.timeZone,
                )}
            </Text>
            <Text variant="caption" tone="text2">
              These are offers for that window — not a pickup now.
            </Text>
          </Card>
        ) : null}
        {p.refusal ? (
          <Banner
            testID={TID.refusal}
            tone="error"
            title={p.refusal.title}
            body={p.refusal.body}
          />
        ) : null}
        {p.phase === "confirming" ? (
          <Card testID={TID.pending} style={{ gap: 4 }}>
            <StateTag label="Confirming your driver" tone="info" />
            <Text variant="caption" tone="text2">
              Reserving the driver you chose. This usually takes a few seconds;
              the other offers stay open until it succeeds.
            </Text>
          </Card>
        ) : null}
        {p.phase === "closed" ? (
          <Card testID={TID.closed} style={{ gap: 4 }}>
            <Text variant="bodyStrong">This request is closed</Text>
            <Text variant="bodySm" tone="text2">
              {offers.length
                ? "It closed before a driver was reserved. Nothing was charged."
                : "No driver offered on your window in time. Nothing was charged."}
            </Text>
          </Card>
        ) : null}
        {p.phase !== "closed" && offers.length === 0 ? (
          <Card style={{ gap: 4 }}>
            <Text variant="bodyStrong">Waiting for offers</Text>
            <Text variant="bodySm" tone="text2">
              Eligible drivers can offer on your future window now. You’ll see
              each offer here and choose — nothing is booked automatically.
            </Text>
          </Card>
        ) : null}
        {offers.map((o) => {
          const expires = inLabel(o.expiresAt, p.now);
          // The same honest card as the live inbox: no placeholder rating or trip count.
          const d = driverCardOf(o);
          const who = d.status === "unavailable" ? "this driver" : d.name;
          const disabled =
            o.withdrawn || !expires || p.phase !== "offers" || !!p.choosing;
          return (
            <Card
              key={o.bidId}
              testID={dynamicTestId(TID.card, o.bidId)}
              style={{ gap: 6, opacity: o.withdrawn ? 0.6 : 1 }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    variant="bodyStrong"
                    style={
                      o.withdrawn
                        ? { textDecorationLine: "line-through" }
                        : null
                    }
                  >
                    {d.name}
                  </Text>
                  <Text variant="caption" tone="text2">
                    {d.statusLabel + " · " + d.ratingLabel}
                  </Text>
                  <Text variant="caption" tone="text2">
                    {vehicleLineOf(o) +
                      (d.plateMasked ? " · " + d.plateMasked : "")}
                  </Text>
                </View>
                <MoneyText
                  money={o.totalMinor ?? o.amountMinor}
                  variant="title"
                />
              </View>
              {o.totalLabel ? (
                <Text variant="caption" tone="text2">
                  {o.totalLabel + (o.totalNote ? " · " + o.totalNote : "")}
                </Text>
              ) : null}
              <Text variant="caption" tone="text2">
                {o.pickupLabel}
              </Text>
              <StateTag
                label={
                  o.withdrawn
                    ? "Withdrawn"
                    : expires
                      ? "Offer expires " + expires
                      : "Offer expired"
                }
                tone={o.withdrawn || !expires ? "neutral" : "info"}
              />
              <Pressable
                testID={dynamicTestId(TID.choose, o.bidId)}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                accessibilityLabel={"Reserve " + who + " for this window"}
                disabled={disabled}
                onPress={() => p.onChoose(o)}
              >
                <Card
                  emphasis
                  style={{ alignItems: "center", opacity: disabled ? 0.45 : 1 }}
                >
                  <Text variant="bodyStrong">
                    {p.choosing === o.bidId
                      ? "Reserving…"
                      : d.status === "unavailable"
                        ? "Reserve this driver"
                        : "Reserve " + d.name.split(" ")[0]}
                  </Text>
                </Card>
              </Pressable>
            </Card>
          );
        })}
        {p.onCancel ? (
          <Button
            testID={TID.cancel}
            label="Cancel this request (free)"
            kind="ghost"
            loading={p.cancelling}
            onPress={p.onCancel}
          />
        ) : null}
      </View>
    </Screen>
  );
}

export function AdvanceOffersContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    replace?: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } =
    useRoute<RouteProp<MarketplaceStackParamList, "AdvanceOffers">>();
  const requestId = params.requestId;
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("advsel");
  const snapKey = ["mp", "request", requestId];
  const q = useQuery({
    queryKey: snapKey,
    queryFn: () => marketplaceApi.request(requestId),
    retry: false,
    refetchInterval: (query) => {
      const s = query.state.data?.request.state;
      if (s === "award_pending") return 2_000;
      if (s === undefined || s === "open" || s === "draft") return 5_000;
      return false;
    },
  });
  const snap = q.data;
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const award = snap?.award;
  const confirmedAdvance =
    award?.state === "confirmed" && award.slot === "advance";
  // Converge on the booking the award created (answers list the rider's bookings).
  const bookingsQ = useQuery({
    queryKey: ["mp", "later", "bookings"],
    queryFn: marketplaceApi.bookings,
    enabled: confirmedAdvance || (!!selected && award?.state === "pending"),
    // Poll only until this request's booking appears.
    refetchInterval: (query) =>
      query.state.data?.items?.some((b) => b.requestId === requestId)
        ? false
        : 2_000,
    retry: false,
  });
  const now = useNow(15_000);

  useEffect(() => {
    if (!snap) return;
    // A live (non-advance) request belongs in the ordinary inbox — it REPLACES this screen,
    // so Back never bounces between the two inboxes.
    if (snap.request.booking?.kind !== "advance") {
      (nav.replace ?? nav.navigate)("Offers", { requestId });
      return;
    }
    // Activated booking: the award now names the execution ride.
    if (award?.state === "confirmed" && award.executionRef?.id) {
      nav.navigate("Ride", {
        screen: "Assigned",
        params: { rideId: award.executionRef.id, requestId },
      });
      return;
    }
    const booking = (bookingsQ.data?.items ?? []).find(
      (b) => b.requestId === requestId,
    );
    if (booking) nav.navigate("Booking", { bookingId: booking.bookingId });
  }, [snap, award?.state, award?.executionRef?.id, bookingsQ.data]);

  // The command's fingerprint is fixed when the rider taps: a snapshot poll landing while
  // the call is in flight must not change which key is settled afterwards.
  const selectPrint = (v: { offer: MpAdvanceOffer; requestVersion: number }) =>
    "select:" +
    v.offer.bidId +
    ":" +
    v.requestVersion +
    ":" +
    v.offer.bidVersion;
  const choose = useMutation({
    mutationFn: (v: { offer: MpAdvanceOffer; requestVersion: number }) =>
      marketplaceApi.select(
        requestId,
        {
          bidId: v.offer.bidId,
          requestVersion: v.requestVersion,
          bidVersion: v.offer.bidVersion,
        },
        keys.keyFor(selectPrint(v)),
      ),
    onSuccess: (res, v) => {
      const o = v.offer;
      keys.settle(selectPrint(v));
      track("mp_advance_selected", { requestId, bidId: o.bidId });
      if (res.booking) {
        queryClient.setQueryData(
          ["mp", "booking", res.booking.bookingId],
          res.booking,
        );
        nav.navigate("Booking", { bookingId: res.booking.bookingId });
        return;
      }
      queryClient.setQueryData<MpRequestSnapshot>(snapKey, (old) =>
        old ? { ...old, award: res.award } : old,
      );
      void q.refetch();
    },
    onError: (e, v) => {
      keys.settle(selectPrint(v), e);
      setSelected(null);
      if (
        e instanceof ApiError &&
        (e.code === "version_conflict" || e.code === "bid_not_live")
      )
        void q.refetch();
      setRefusal(refusalFor(e));
    },
  });
  const cancel = useMutation({
    mutationFn: (version: number) =>
      marketplaceApi.cancel(requestId, keys.keyFor("cancel:" + version)),
    onSuccess: (_r, version) => {
      keys.settle("cancel:" + version);
      nav.goBack();
    },
    onError: (e, version) => {
      keys.settle("cancel:" + version, e);
      setRefusal(refusalFor(e));
    },
  });

  if (!snap)
    return (
      <Screen title="Reserve a driver" onBack={nav.goBack}>
        {q.isError ? (
          <LoadFailure
            offline={isOffline(q.error)}
            title="Couldn’t load your request"
            body={(q.error as Error).message}
            onRetry={() => void q.refetch()}
            testIDs={TID}
          />
        ) : (
          <LoadingBlocks heights={[90, 130, 130]} />
        )}
      </Screen>
    );
  const state = snap.request.state;
  const failed = award?.state === "failed";
  const phase: AdvanceOffersProps["phase"] = CLOSED.has(state)
    ? "closed"
    : choose.isPending || state === "award_pending" || confirmedAdvance
      ? "confirming"
      : "offers";
  return (
    <AdvanceOffersView
      snap={snap}
      now={now}
      stale={stalenessOf(q.isError ? q.error : null)}
      phase={phase}
      choosing={choose.isPending ? selected : null}
      refusal={
        refusal ??
        (failed
          ? {
              title: "Couldn’t reserve that driver",
              body:
                award?.failReason ??
                "The driver couldn’t be confirmed. Nothing was charged — choose another offer.",
            }
          : null)
      }
      onChoose={(o) => {
        setRefusal(null);
        setSelected(o.bidId);
        choose.mutate({ offer: o, requestVersion: snap.request.version });
      }}
      onCancel={
        state === "open" && !choose.isPending
          ? () => cancel.mutate(snap.request.version)
          : null
      }
      cancelling={cancel.isPending}
      onBack={nav.goBack}
    />
  );
}
