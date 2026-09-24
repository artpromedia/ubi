// R04 + R07 container — Marketplace.Offers. Polls the owner snapshot (searching/open ≈ 5s,
// award_pending ≈ 2s, terminal off). Offer order is stable: the SERVER's order at the moment the
// rider picked a sort (arrival order by default), with later arrivals appended — nothing reshuffles
// under touch — and withdrawn/dropped offers keep their last-known card struck through instead of
// vanishing mid-interaction. A06 part A: sorting asks the server (`?sort=`); every comparison figure
// on a card is the server's.
import React, { useEffect, useRef, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Screen, Skeleton } from "@ubi/mobile-ui";
import { track, useFlag } from "@ubi/mobile-core";
import type { MpOfferSort } from "@ubi/contracts";
import type {
  MarketplaceStackParamList,
  MarketplaceQuoteParams,
} from "../../navigation/routes";
import { marketplaceApi, type MpOfferDto } from "../../api/marketplace";
import {
  OfferInboxScreen,
  type Offer,
  type OfferOrderView,
} from "./OfferInboxScreen";
import { displayOrder, mergeArrivalOrder } from "./offerOrder";
import {
  SORT_CHIP,
  SORT_FALLBACK,
  badgesOf,
  driverCardOf,
  fitLineOf,
  payableOf,
  pickupLineOf,
  reliabilityLineOf,
  savedLabelOf,
  vehicleLineOf,
} from "./offerView";
import { closedOutcomeOf, preferredWindowCopy } from "./confidenceCopy";
import { PassengerLinkCard } from "./PassengerLinkCard";
import { BusinessRequestCard } from "./BusinessParts";
import { useNow } from "./riderCopy";

const minsLeft = (iso: string) =>
  Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 60_000));
const kmLabel = (meters: number) => {
  const km = meters / 1000;
  return (Number.isInteger(km) ? String(km) : km.toFixed(1)) + " km";
};

/** The snapshot's cache key: the neutral order shares the key every other screen reads. */
export const snapshotKey = (requestId: string, sort: MpOfferSort) =>
  sort === "offered"
    ? ["mp", "request", requestId]
    : ["mp", "request", requestId, { sort }];

export function OfferInboxContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    replace?: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<MarketplaceStackParamList, "Offers">>();
  const multiStopOn = useFlag("marketplace_multi_stop");
  const [sort, setSort] = useState<MpOfferSort>("offered");
  const q = useQuery({
    queryKey: snapshotKey(params.requestId, sort),
    queryFn: () => marketplaceApi.request(params.requestId, sort),
    // A new sort keeps showing the last answer (in its last order) until the server replies.
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const s = query.state.data?.request.state;
      if (s === "award_pending") return 2_000;
      if (s === undefined || s === "draft" || s === "open") return 5_000;
      return false;
    },
  });
  const snap = q.data;
  // Keep-last-known cache + arrival order (stable across updates).
  const cacheRef = useRef<Map<string, MpOfferDto>>(new Map());
  const arrivalRef = useRef<string[]>([]);
  if (snap) {
    for (const o of snap.offers) cacheRef.current.set(o.bidId, o);
    arrivalRef.current = mergeArrivalOrder(arrivalRef.current, snap.offers);
  }
  // The server order taken when the rider picked a sort (null = arrival order).
  const [sortedIds, setSortedIds] = useState<string[] | null>(null);
  const [snapshotFor, setSnapshotFor] = useState<MpOfferSort>("offered");
  useEffect(() => {
    if (!snap || q.isPlaceholderData || snapshotFor === sort) return;
    setSnapshotFor(sort);
    setSortedIds(sort === "offered" ? null : snap.offers.map((o) => o.bidId));
  }, [snap, q.isPlaceholderData, sort, snapshotFor]);
  useNow(1_000); // re-render for elapsed/expiry labels (time only)
  const cancel = useMutation({
    mutationFn: () => marketplaceApi.cancel(params.requestId),
    onSuccess: () => {
      track("mp_request_cancelled", { requestId: params.requestId });
      nav.goBack();
    },
  });
  // A03: an advance-booking request takes offers on a FUTURE window — its own inbox. It
  // REPLACES this screen, so Back never lands on an inbox that would bounce straight back.
  const advance = snap?.request.booking?.kind === "advance";
  useEffect(() => {
    if (!advance) return;
    const go = nav.replace ?? nav.navigate;
    go("AdvanceOffers", { requestId: params.requestId });
  }, [advance]);
  // Award convergence: only durable server state moves the rider forward.
  const award = snap?.award;
  useEffect(() => {
    if (advance || award?.state !== "confirmed") return;
    if (award.slot === "next")
      nav.navigate("Queued", { requestId: params.requestId });
    else if (award.executionRef?.service === "ride" && award.executionRef.id) {
      // Real execution id only (contract executionRef {service,id}); never a placeholder.
      // No pickupPin here: the one-time PIN exists only on the ORIGINAL select 202 body
      // (BidDetailContainer holds it) — snapshot/award replays never carry it by design.
      nav.navigate("Ride", {
        screen: "Assigned",
        params: { rideId: award.executionRef.id, requestId: params.requestId },
      });
    }
  }, [award?.state, award?.executionRef?.id]);
  if (!snap)
    return (
      <Screen title="Your request is live">
        <Skeleton height={90} />
        <Skeleton height={130} />
        <Skeleton height={130} />
      </Screen>
    );
  const r = snap.request;
  const dtos = displayOrder(arrivalRef.current, sortedIds)
    .map((id) => cacheRef.current.get(id))
    .filter((o): o is MpOfferDto => !!o);
  const offers: Offer[] = dtos.map((o) => ({
    bidId: o.bidId,
    bidVersion: o.bidVersion,
    payableMinor: payableOf(o),
    totalLabel: o.totalLabel ?? null,
    totalNote: o.totalNote ?? null,
    // Server-phrased only: the client never compares or subtracts amounts.
    deltaLabel: o.deltaLabel ?? null,
    kind: o.kind,
    driver: driverCardOf(o),
    vehicleLine: vehicleLineOf(o),
    pickupLabel: pickupLineOf(o),
    reliability: reliabilityLineOf(o.reliability),
    fitLabel: fitLineOf(o.serviceFit)?.label ?? null,
    savedLabel: savedLabelOf(o),
    badges: badgesOf(o),
    expiresLabel: minsLeft(o.expiresAt) + " min",
    withdrawn: o.withdrawn,
  }));
  const closedOutcome = closedOutcomeOf(r);
  const phase =
    closedOutcome ||
    r.state === "no_offers" ||
    (r.state === "expired" && offers.length === 0)
      ? "no_offers"
      : (r.state === "open" || r.state === "draft") && offers.length === 0
        ? "searching"
        : params.unavailableNotice
          ? "winner_unavailable"
          : "offers";
  const elapsedSec = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(r.createdAt)) / 1000),
  );
  const stops = [...(r.stops ?? [])].sort((a, b) => a.order - b.order);
  const onRepost = (kind: "suggested" | "same_wider") => {
    const quoteParams: MarketplaceQuoteParams = {
      service: r.service,
      vehicleClass: r.vehicleClass,
      pickup: r.pickup,
      dropoff: r.dropoff,
      ...(r.delivery
        ? { weightKg: r.delivery.weightKg, handling: r.delivery.handling }
        : {}),
      // A02: a repost keeps the same ordered stops — never silently a different route.
      ...(stops.length
        ? {
            stops: stops.map((s) => ({
              lat: s.lat,
              lng: s.lng,
              label: s.label,
              purpose: s.purpose,
              dwellSec: s.dwellSec,
            })),
          }
        : {}),
    };
    track("mp_request_repost", { requestId: r.requestId, kind });
    nav.navigate("Fare", { quoteParams });
  };
  const routeContext = stops.length
    ? {
        title:
          "Offers are for your route with " +
          stops.length +
          (stops.length === 1 ? " stop" : " stops"),
        line: [
          r.pickup.label,
          ...stops.map((s) => s.label),
          r.dropoff.label,
        ].join(" → "),
        detail:
          "Drivers offered on this exact route" +
          (r.routeRevision ? " (route version " + r.routeRevision + ")" : "") +
          ". Changing it closes these offers.",
      }
    : null;
  const served = snap.offerOrder;
  const order: OfferOrderView = {
    sort,
    options: (served?.options ?? SORT_FALLBACK).map((o) => ({
      key: o.key,
      chip: SORT_CHIP[o.key],
      label: o.label,
    })),
    label:
      served && !q.isPlaceholderData
        ? served.label
        : (SORT_FALLBACK.find((s) => s.key === sort)?.label ?? ""),
    tieBreak: served && !q.isPlaceholderData ? served.tieBreak : null,
    note: served?.note ?? null,
    pending: q.isPlaceholderData,
  };
  return (
    <OfferInboxScreen
      phase={phase}
      connection={q.isError ? "reconnecting" : "online"}
      requestedMinor={r.requestedFareMinor}
      elapsedLabel={
        Math.floor(elapsedSec / 60) +
        ":" +
        String(elapsedSec % 60).padStart(2, "0")
      }
      expiresLabel={"in " + minsLeft(r.expiresAt) + " min"}
      envelopeLabel={
        "Eligible drivers within " +
        kmLabel(r.searchEnvelope.radiusMeters) +
        " can see your request"
      }
      widenedBanner={
        r.searchEnvelope.step > 0
          ? "Search widened to " +
            kmLabel(r.searchEnvelope.radiusMeters) +
            " — your existing offers are kept."
          : null
      }
      order={order}
      onSort={(s) => {
        if (s === sort) return;
        setSort(s);
        track("mp_offers_sorted", { requestId: r.requestId, sort: s });
      }}
      offers={offers}
      onOpenOffer={(bidId) =>
        nav.navigate("BidDetail", { requestId: r.requestId, bidId })
      }
      unavailableNotice={params.unavailableNotice ?? null}
      onCancel={() => cancel.mutate()}
      onRepost={onRepost}
      routeContext={routeContext}
      onEditRoute={
        multiStopOn && r.service === "ride" && r.state === "open"
          ? () => nav.navigate("Route", { requestId: r.requestId })
          : null
      }
      preferred={
        r.preferredDriver ? preferredWindowCopy(r.preferredDriver) : null
      }
      closedOutcome={closedOutcome}
      panels={
        <>
          {r.passenger ? (
            <PassengerLinkCard
              requestId={r.requestId}
              passenger={r.passenger}
              requestOpen={
                !["cancelled", "expired", "no_offers"].includes(r.state)
              }
            />
          ) : null}
          {r.business ? <BusinessRequestCard business={r.business} /> : null}
        </>
      }
    />
  );
}
