// A02 container — Marketplace.Route. Two modes:
//  - new (quoteParams): build pickup → stops → destination and ask the SERVER to price the
//    complete ordered route (GET /v1/mp/quote with the contract-encoded `stops`). The
//    priced envelope is handed to the fare editor / Book for Later through the query
//    cache, so what the rider saw is exactly what they publish.
//  - revise (requestId): an OPEN request's pre-award route edit. Same endpoints, new stop
//    set, re-quoted, then POST /revise {requestedFareMinor, quoteId, expectedVersion} with a
//    caller-held Idempotency-Key. The server closes every live offer and releases its
//    hold; the screen says so before the rider commits.
// Gated on marketplace_multi_stop. The market's stop limit comes from the server's
// refusal (details.maximum) — never a client constant. No money is computed here.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@ubi/mobile-ui";
import {
  ApiError,
  formatMinor,
  track,
  useFlag,
  useFlags,
  type Money,
} from "@ubi/mobile-core";
import { TEST_IDS, type MpStopPurpose } from "@ubi/contracts";
import type {
  MarketplaceQuoteParams,
  MarketplaceStackParamList,
} from "../../navigation/routes";
import {
  marketplaceApi,
  type MpQuoteEnvelope,
  type MpStopInput,
} from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { forgetQuote } from "../../lib/quoteCache";
import { PlacePickerSheet, type PickedPlace } from "./PlacePickerSheet";
import {
  RouteBuilderScreen,
  type RouteQuoteSummary,
  type RouteStopRow,
} from "./RouteBuilderScreen";
import {
  STOP_PURPOSE_TEXT,
  errorDetail,
  isOffline,
  isUnavailable,
  km,
  minutes,
  refusalFor,
  type Refusal,
} from "./riderCopy";
import { LoadFailure, UnavailableCard } from "./riderParts";

const TID = TEST_IDS.mp.rider.route;
/** The contract's own ceiling on a stop list (MpProposeAmendmentSchema / OpenAPI maxItems). */
const CONTRACT_MAX_STOPS = 10;

type Place = { label: string; lat: number; lng: number };
type DraftStop = {
  key: string;
  lat: number;
  lng: number;
  label: string;
  purpose: MpStopPurpose;
  dwellSec: number | undefined;
};
type Picker = { target: "pickup" | "dropoff" } | { target: "stop" } | null;

/** Draft → contract stop input (no id, no order, no price). */
export const toStopInput = (s: DraftStop): MpStopInput => ({
  lat: s.lat,
  lng: s.lng,
  ...(s.label.trim() ? { label: s.label.trim() } : {}),
  purpose: s.purpose,
  ...(s.dwellSec !== undefined ? { dwellSec: s.dwellSec } : {}),
});

/** Priced envelope → the summary the screen renders (formatting only). */
export const summaryOf = (
  quote: MpQuoteEnvelope,
  pickup: string,
  dropoff: string,
): RouteQuoteSummary => ({
  distance: km(quote.routedDistanceMeters),
  duration: minutes(quote.routedDurationSec),
  stopWaiting:
    quote.stops && quote.stops.length
      ? minutes(quote.stopsDwellSec ?? 0) +
        " across " +
        quote.stops.length +
        (quote.stops.length === 1 ? " stop" : " stops")
      : null,
  minimumFareMinor: quote.minimumFareMinor,
  suggestedFareMinor: quote.suggestedFareMinor,
  maximumFareMinor: quote.maximumFareMinor,
  breakdown: quote.breakdown,
  route: [
    { key: "pickup", kind: "pickup", label: pickup },
    ...[...(quote.stops ?? [])]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        key: s.stopId,
        kind: "stop" as const,
        label: s.label,
        detail:
          (STOP_PURPOSE_TEXT[s.purpose] ?? "Stop") +
          " · expected wait " +
          minutes(s.dwellSec),
      })),
    { key: "dropoff", kind: "dropoff", label: dropoff },
  ],
});

export function RouteBuilderContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<MarketplaceStackParamList, "Route">>();
  const reviseId = params.requestId;
  const mode: "new" | "revise" = reviseId ? "revise" : "new";
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("route");
  const { status: flagStatus } = useFlags();
  const multiStop = useFlag("marketplace_multi_stop");
  // Every flag hook runs on every render (no short-circuit between hooks).
  const scheduledOn = useFlag("scheduled_rides");
  const advanceOn = useFlag("marketplace_advance_reservations");
  const seriesOn = useFlag("marketplace_recurring_journeys");
  const laterOn = scheduledOn || advanceOn || seriesOn;

  // Revise mode reads the open request it edits (its stops, endpoints, version, offers).
  const snapQ = useQuery({
    queryKey: ["mp", "request", reviseId],
    queryFn: () => marketplaceApi.request(reviseId!),
    enabled: !!reviseId,
    retry: false,
  });
  const request = snapQ.data?.request;

  const base = params.quoteParams;
  const [pickup, setPickup] = useState<Place | null>(base?.pickup ?? null);
  const [dropoff, setDropoff] = useState<Place | null>(base?.dropoff ?? null);
  const nextKey = useRef(0);
  const mint = () => {
    nextKey.current += 1;
    return "s" + nextKey.current;
  };
  const [stops, setStops] = useState<DraftStop[]>(() =>
    (base?.stops ?? []).map((s) => ({
      key: "s" + ++nextKey.current,
      lat: s.lat,
      lng: s.lng,
      label: s.label ?? "",
      purpose: s.purpose ?? "other",
      dwellSec: s.dwellSec,
    })),
  );
  // Seed the revise draft from the request's current ordered stops, once.
  const seeded = useRef(false);
  useEffect(() => {
    if (!request || seeded.current) return;
    seeded.current = true;
    setPickup(request.pickup);
    setDropoff(request.dropoff);
    setStops(
      [...(request.stops ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          key: mint(),
          lat: s.lat,
          lng: s.lng,
          label: s.label,
          purpose: s.purpose,
          dwellSec: s.dwellSec,
        })),
    );
  }, [request]);

  const [picker, setPicker] = useState<Picker>(null);
  const [stopLimit, setStopLimit] = useState<number | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [priced, setPriced] = useState<{
    quote: MpQuoteEnvelope;
    fingerprint: string;
  } | null>(null);
  const [fareChoice, setFareChoice] = useState<string | null>(null);

  const service = request?.service ?? base?.service ?? "ride";
  const vehicleClass =
    request?.vehicleClass ?? base?.vehicleClass ?? "standard";
  const stopInputs = useMemo(() => stops.map(toStopInput), [stops]);
  const quoteParams: MarketplaceQuoteParams | null =
    pickup && dropoff
      ? {
          service,
          vehicleClass,
          pickup,
          dropoff,
          ...(base?.weightKg !== undefined ? { weightKg: base.weightKg } : {}),
          ...(base?.handling ? { handling: base.handling } : {}),
          ...(stopInputs.length ? { stops: stopInputs } : {}),
        }
      : null;

  const quote = useMutation({
    mutationFn: (qp: MarketplaceQuoteParams) =>
      marketplaceApi.quote({
        service: qp.service,
        vehicleClass: qp.vehicleClass,
        pickupLat: qp.pickup.lat,
        pickupLng: qp.pickup.lng,
        dropoffLat: qp.dropoff.lat,
        dropoffLng: qp.dropoff.lng,
        weightKg: qp.weightKg,
        stops: qp.stops,
      }),
    onSuccess: (q, qp) => {
      setRefusal(null);
      setPriced({
        quote: q,
        fingerprint: JSON.stringify([qp.pickup, qp.dropoff, qp.stops ?? []]),
      });
      // Hand the priced envelope to the fare editor / schedule screen for these exact params.
      queryClient.setQueryData(["mp", "quote", qp], q);
      if (request) setFareChoice("keep");
      track("mp_route_quoted", { stops: qp.stops?.length ?? 0, mode });
    },
    onError: (e) => {
      const maximum = errorDetail<number>(e, "maximum");
      if (
        e instanceof ApiError &&
        e.code === "validation_failed" &&
        errorDetail<string>(e, "field") === "stops" &&
        typeof maximum === "number"
      ) {
        setStopLimit(maximum);
        setRefusal({
          title:
            maximum === 0
              ? "Stops aren’t allowed on this route"
              : "Too many stops for this city",
          body:
            "This city allows up to " +
            maximum +
            (maximum === 1 ? " stop" : " stops") +
            " between pickup and destination. Remove " +
            Math.max(1, stops.length - maximum) +
            " to continue.",
        });
        return;
      }
      if (e instanceof ApiError && e.code === "market_not_configured") {
        setRefusal({
          title: "Not available on this route yet",
          body: "The fare marketplace isn’t set up for this route. Nothing was booked.",
        });
        return;
      }
      setRefusal(refusalFor(e));
    },
  });

  const revise = useMutation({
    mutationFn: (input: {
      requestId: string;
      quoteId: string;
      expectedVersion: number;
      fare: Money;
      print: string;
    }) =>
      marketplaceApi.revise(
        input.requestId,
        {
          requestedFareMinor: input.fare,
          quoteId: input.quoteId,
          expectedVersion: input.expectedVersion,
        },
        keys.keyFor(input.print),
      ),
    onSuccess: (r, input) => {
      keys.settle(input.print);
      // The revise CONSUMED the replacement quote: it can never be published again.
      forgetQuote(queryClient, input.quoteId);
      track("mp_route_revised", {
        requestId: r.requestId,
        routeRevision: r.routeRevision ?? 0,
      });
      void queryClient.invalidateQueries({
        queryKey: ["mp", "request", r.requestId],
      });
      nav.navigate("Offers", { requestId: r.requestId });
    },
    onError: (e, input) => {
      keys.settle(input.print, e);
      if (e instanceof ApiError && e.code === "version_conflict") {
        void snapQ.refetch();
        setPriced(null);
      }
      if (e instanceof ApiError && e.code === "quote_expired") setPriced(null);
      setRefusal(refusalFor(e));
    },
  });

  // The useful fallback when stops are off: the same trip as a direct ride.
  const onDirect = base
    ? () =>
        nav.navigate("Fare", {
          quoteParams: {
            service: base.service,
            vehicleClass: base.vehicleClass,
            pickup: base.pickup,
            dropoff: base.dropoff,
            ...(base.weightKg !== undefined ? { weightKg: base.weightKg } : {}),
            ...(base.handling ? { handling: base.handling } : {}),
          },
        })
    : null;

  if (flagStatus === "loading" || (mode === "revise" && snapQ.isPending))
    return <RouteBuilderScreen {...emptyProps(mode, nav.goBack)} loading />;
  if (mode === "revise" && snapQ.isError)
    return (
      <Screen title="Edit your route" onBack={nav.goBack}>
        <LoadFailure
          offline={isOffline(snapQ.error)}
          title={
            isUnavailable(snapQ.error)
              ? "This request isn’t available"
              : "Couldn’t load your request"
          }
          body={(snapQ.error as Error).message}
          onRetry={() => void snapQ.refetch()}
          testIDs={TID}
        />
      </Screen>
    );
  if (!multiStop)
    return (
      <RouteBuilderScreen
        {...emptyProps(mode, nav.goBack)}
        unavailable={{ onDirect: mode === "new" ? onDirect : null }}
      />
    );
  if (request && request.state !== "open")
    return (
      <Screen title="Edit your route" onBack={nav.goBack}>
        <UnavailableCard
          testID={TID.unavailable}
          title="This request can’t be changed now"
          body="Its route can only change while it’s open for offers. Once you’ve chosen a driver, you can propose a change during the trip instead."
          action={{
            label: "Back to your request",
            onPress: () =>
              nav.navigate("Offers", { requestId: request.requestId }),
          }}
        />
      </Screen>
    );

  const limit = Math.min(stopLimit ?? CONTRACT_MAX_STOPS, CONTRACT_MAX_STOPS);
  const summary =
    priced && pickup && dropoff
      ? summaryOf(priced.quote, pickup.label, dropoff.label)
      : null;
  const outdated =
    !!priced &&
    priced.fingerprint !== JSON.stringify([pickup, dropoff, stopInputs]);
  const liveOffers = (snapQ.data?.offers ?? []).filter(
    (o) => !o.withdrawn,
  ).length;
  const reviseChoices =
    request && priced
      ? [
          {
            key: "keep",
            label: "Keep my fare · " + formatMinor(request.requestedFareMinor),
            money: request.requestedFareMinor,
          },
          {
            key: "suggested",
            label:
              "Use the new suggestion · " +
              formatMinor(priced.quote.suggestedFareMinor),
            money: priced.quote.suggestedFareMinor,
          },
        ]
      : [];
  const patchStop = (key: string, patch: Partial<DraftStop>) =>
    setStops((list) =>
      list.map((s) => (s.key === key ? { ...s, ...patch } : s)),
    );
  const last = stops.length ? stops[stops.length - 1] : null;
  const near = last ?? pickup ?? dropoff;
  const seed = (qp: MarketplaceQuoteParams) => {
    if (priced) queryClient.setQueryData(["mp", "quote", qp], priced.quote);
  };

  return (
    <>
      <RouteBuilderScreen
        mode={mode}
        loading={false}
        unavailable={null}
        pickupLabel={pickup?.label ?? "—"}
        dropoffLabel={dropoff?.label ?? "—"}
        onEditPickup={
          mode === "new" ? () => setPicker({ target: "pickup" }) : null
        }
        onEditDropoff={
          mode === "new" ? () => setPicker({ target: "dropoff" }) : null
        }
        stops={stops.map(
          (s): RouteStopRow => ({
            key: s.key,
            label: s.label,
            purpose: s.purpose,
            dwellSec: s.dwellSec,
          }),
        )}
        onStopLabel={(key, label) =>
          patchStop(key, { label: label.slice(0, 80) })
        }
        onStopPurpose={(key, purpose) => patchStop(key, { purpose })}
        onStopDwell={(key, dwellSec) => patchStop(key, { dwellSec })}
        onMove={(key, by) =>
          setStops((list) => {
            const from = list.findIndex((s) => s.key === key);
            const to = from + by;
            if (from < 0 || to < 0 || to >= list.length) return list;
            const next = [...list];
            [next[from], next[to]] = [next[to], next[from]];
            return next;
          })
        }
        onRemove={(key) =>
          setStops((list) => list.filter((s) => s.key !== key))
        }
        canAddStop={stops.length < limit}
        onAddStop={() => {
          setRefusal(null);
          setPicker({ target: "stop" });
        }}
        stopLimitNote={
          stopLimit !== null
            ? "This city allows up to " +
              stopLimit +
              (stopLimit === 1 ? " stop." : " stops.")
            : null
        }
        quoting={quote.isPending}
        onGetQuote={() => {
          if (!quoteParams) return;
          setRefusal(null);
          quote.mutate(quoteParams);
        }}
        summary={summary}
        outdated={outdated}
        refusal={refusal}
        next={
          mode === "new" && quoteParams
            ? {
                onContinue: () => {
                  seed(quoteParams);
                  track("mp_route_continue", { stops: stopInputs.length });
                  nav.navigate("Fare", { quoteParams });
                },
                onLater: laterOn
                  ? () => {
                      seed(quoteParams);
                      nav.navigate("Schedule", { quoteParams });
                    }
                  : null,
              }
            : null
        }
        revise={
          mode === "revise" && request
            ? {
                liveOffers,
                choices: reviseChoices,
                selected: fareChoice,
                onSelect: setFareChoice,
                busy: revise.isPending,
                onRevise: () => {
                  const choice = reviseChoices.find(
                    (c) => c.key === fareChoice,
                  );
                  if (!priced || !choice) return;
                  setRefusal(null);
                  revise.mutate({
                    requestId: request.requestId,
                    quoteId: priced.quote.quoteId,
                    expectedVersion: request.version,
                    fare: choice.money,
                    print:
                      "revise:" +
                      request.requestId +
                      ":" +
                      priced.quote.quoteId +
                      ":" +
                      request.version +
                      ":" +
                      choice.key,
                  });
                },
              }
            : null
        }
        onBack={nav.goBack}
      />
      {near ? (
        <PlacePickerSheet
          visible={picker !== null}
          title={
            picker?.target === "pickup"
              ? "Pickup"
              : picker?.target === "dropoff"
                ? "Destination"
                : "Add a stop"
          }
          near={near}
          initial={
            picker?.target === "pickup"
              ? pickup
              : picker?.target === "dropoff"
                ? dropoff
                : null
          }
          onCancel={() => setPicker(null)}
          onConfirm={(place: PickedPlace) => {
            const target = picker?.target;
            setPicker(null);
            if (target === "stop") {
              setStops((list) => [
                ...list,
                {
                  key: mint(),
                  lat: place.lat,
                  lng: place.lng,
                  label: place.label ?? "",
                  purpose: "errand",
                  dwellSec: undefined,
                },
              ]);
            } else if (target) {
              const named: Place = {
                lat: place.lat,
                lng: place.lng,
                label:
                  place.label ??
                  (target === "pickup"
                    ? "Pinned pickup"
                    : "Pinned destination"),
              };
              if (target === "pickup") setPickup(named);
              else setDropoff(named);
            }
          }}
        />
      ) : null}
    </>
  );
}

const noop = () => {};
function emptyProps(mode: "new" | "revise", onBack: () => void) {
  return {
    mode,
    loading: false,
    unavailable: null,
    pickupLabel: "",
    dropoffLabel: "",
    onEditPickup: null,
    onEditDropoff: null,
    stops: [],
    onStopLabel: noop,
    onStopPurpose: noop,
    onStopDwell: noop,
    onMove: noop,
    onRemove: noop,
    canAddStop: false,
    onAddStop: noop,
    stopLimitNote: null,
    quoting: false,
    onGetQuote: noop,
    summary: null,
    outdated: false,
    refusal: null,
    next: null,
    revise: null,
    onBack,
  };
}
