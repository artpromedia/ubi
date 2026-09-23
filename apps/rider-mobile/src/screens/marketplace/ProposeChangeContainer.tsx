// A02 container — Marketplace.ProposeChange (rider). Builds a proposal from the trip's
// REMAINING stops (reached stops are history) plus an optional new destination, and
// sends POST .../amendments {stops, dropoff?, expectedRouteRevision, expectedFareRevision}
// with a caller-held Idempotency-Key. The body never carries an amount: the server prices
// the delta under the award's own pricing snapshot, revalidates the driver's queued next
// job first (next_job_conflict) and reserves any top-up before asking for approvals.
// Adding stops needs marketplace_multi_stop; proposing at all needs
// marketplace_trip_amendments.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, track, useFlag, useFlags } from "@ubi/mobile-core";
import type { MpStopPurpose } from "@ubi/contracts";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import {
  marketplaceApi,
  type MpAmendmentList,
  type MpStopInput,
} from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { PlacePickerSheet, type PickedPlace } from "./PlacePickerSheet";
import { ProposeChangeScreen } from "./ProposeChangeScreen";
import {
  STOP_PURPOSE_TEXT,
  errorDetail,
  isUnavailable,
  minutes,
  refusalFor,
  type Refusal,
} from "./riderCopy";

type DraftStop = {
  key: string;
  existing: boolean;
  lat: number;
  lng: number;
  label: string;
  purpose: MpStopPurpose;
  dwellSec: number | undefined;
};
/** A pinned destination; an unnamed pin is sent without a label (the server names its area). */
type Place = { lat: number; lng: number; label?: string };

const toInput = (s: DraftStop): MpStopInput => ({
  lat: s.lat,
  lng: s.lng,
  ...(s.label.trim() ? { label: s.label.trim().slice(0, 80) } : {}),
  purpose: s.purpose,
  ...(s.dwellSec !== undefined ? { dwellSec: s.dwellSec } : {}),
});

export function ProposeChangeContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } =
    useRoute<RouteProp<MarketplaceStackParamList, "ProposeChange">>();
  const requestId = params.requestId;
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("amend");
  const { status: flagStatus } = useFlags();
  const amendmentsOn = useFlag("marketplace_trip_amendments");
  const multiStopOn = useFlag("marketplace_multi_stop");
  const tripKey = ["mp", "trip", requestId];
  const tripQ = useQuery({
    queryKey: tripKey,
    queryFn: () => marketplaceApi.trip(requestId),
    enabled: amendmentsOn,
    retry: false,
  });
  const trip = tripQ.data;
  const remaining = useMemo(
    () =>
      [...(trip?.stops ?? [])]
        .filter((s) => s.state === "pending")
        .sort((a, b) => a.order - b.order),
    [trip],
  );
  const reachedCount = (trip?.stops.length ?? 0) - remaining.length;
  const [draft, setDraft] = useState<DraftStop[] | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [picker, setPicker] = useState<"stop" | "dropoff" | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [limit, setLimit] = useState<number | null>(null);
  const counter = useRef(0);
  // The draft starts as the remaining stops exactly as agreed (a survivor keeps its id).
  useEffect(() => {
    if (!trip || draft) return;
    setDraft(
      remaining.map((s) => ({
        key: s.stopId,
        existing: true,
        lat: s.lat,
        lng: s.lng,
        label: s.label,
        purpose: s.purpose,
        dwellSec: s.dwellSec,
      })),
    );
  }, [trip, remaining, draft]);
  const stops = draft ?? [];

  const propose = useMutation({
    mutationFn: (v: {
      body: Parameters<typeof marketplaceApi.proposeAmendment>[1];
      print: string;
    }) =>
      marketplaceApi.proposeAmendment(requestId, v.body, keys.keyFor(v.print)),
    onSuccess: (a, v) => {
      keys.settle(v.print);
      queryClient.setQueryData<MpAmendmentList>(
        ["mp", "amendments", requestId],
        (old) =>
          old
            ? {
                ...old,
                amendments: [
                  a,
                  ...old.amendments.filter(
                    (x) => x.amendmentId !== a.amendmentId,
                  ),
                ],
              }
            : old,
      );
      void queryClient.invalidateQueries({
        queryKey: ["mp", "amendments", requestId],
      });
      void queryClient.invalidateQueries({ queryKey: tripKey });
      track("mp_amendment_proposed", { requestId, amendmentId: a.amendmentId });
      nav.navigate("Trip", { requestId });
    },
    onError: (e, v) => {
      keys.settle(v.print, e);
      const maximum = errorDetail<number>(e, "maximum");
      if (
        e instanceof ApiError &&
        e.code === "validation_failed" &&
        errorDetail<string>(e, "field") === "stops" &&
        typeof maximum === "number"
      ) {
        setLimit(maximum);
        setRefusal({
          title: "Too many stops",
          body:
            "This trip can take up to " +
            maximum +
            (maximum === 1 ? " more stop" : " more stops") +
            " ahead. Remove one to continue.",
        });
        return;
      }
      if (e instanceof ApiError && e.code === "version_conflict") {
        // The committed terms moved: start again from the refreshed trip.
        setDraft(null);
        setDropoff(null);
        void tripQ.refetch();
      }
      setRefusal(refusalFor(e));
    },
  });

  const loading = flagStatus === "loading" || (amendmentsOn && tripQ.isPending);
  const unavailable = !amendmentsOn
    ? {
        title: "Route changes aren’t available here yet",
        body: "Changing the route during a trip isn’t offered in your city right now. Your trip continues exactly as agreed.",
      }
    : tripQ.isError
      ? isUnavailable(tripQ.error)
        ? {
            title: "This trip can’t be changed",
            body: "It has ended, or route changes aren’t offered for it.",
          }
        : {
            title: "Couldn’t load your trip",
            body: refusalFor(tripQ.error).body,
          }
      : trip?.terminatedAt
        ? {
            title: "This trip ended early",
            body: "Its route can’t change any more.",
          }
        : null;

  const changed =
    !!dropoff ||
    stops.length !== remaining.length ||
    stops.some((s, i) => s.key !== remaining[i]?.stopId);
  const move = (key: string, by: -1 | 1) =>
    setDraft((list) => {
      const next = [...(list ?? [])];
      const from = next.findIndex((s) => s.key === key);
      const to = from + by;
      if (from < 0 || to < 0 || to >= next.length) return list;
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  const canAdd = multiStopOn && (limit === null || stops.length < limit);
  const near = trip
    ? stops.length
      ? stops[stops.length - 1]
      : trip.dropoff
    : null;

  return (
    <>
      <ProposeChangeScreen
        loading={loading}
        unavailable={loading ? null : unavailable}
        reachedNote={
          reachedCount > 0
            ? reachedCount +
              (reachedCount === 1 ? " stop is" : " stops are") +
              " already reached or passed — they stay as they are."
            : null
        }
        stops={stops.map((s) => ({
          key: s.key,
          label: s.label || "Pinned stop",
          detail:
            (STOP_PURPOSE_TEXT[s.purpose] ?? "Stop") +
            (s.dwellSec !== undefined
              ? " · expected wait " + minutes(s.dwellSec)
              : " · standard wait"),
          isNew: !s.existing,
        }))}
        onUp={(key) => move(key, -1)}
        onDown={(key) => move(key, 1)}
        onRemove={(key) =>
          setDraft((list) => (list ?? []).filter((s) => s.key !== key))
        }
        onAdd={canAdd ? () => setPicker("stop") : null}
        addNote={
          !multiStopOn
            ? "Adding stops isn’t offered in your city right now. You can still reorder, remove or change the destination."
            : limit !== null && stops.length >= limit
              ? "This trip can’t take more stops."
              : null
        }
        dropoffLabel={
          dropoff
            ? (dropoff.label ?? "Pinned destination")
            : (trip?.dropoff.label ?? "—")
        }
        dropoffChanged={!!dropoff}
        onEditDropoff={() => setPicker("dropoff")}
        changed={changed}
        busy={propose.isPending}
        refusal={refusal}
        onSend={() => {
          if (!trip) return;
          setRefusal(null);
          const body = {
            stops: stops.map(toInput),
            ...(dropoff
              ? {
                  dropoff: {
                    lat: dropoff.lat,
                    lng: dropoff.lng,
                    ...(dropoff.label
                      ? { label: dropoff.label.slice(0, 80) }
                      : {}),
                  },
                }
              : {}),
            expectedRouteRevision: trip.routeRevision,
            expectedFareRevision: trip.fareRevision,
          };
          propose.mutate({ body, print: "propose:" + JSON.stringify(body) });
        }}
        onCancel={nav.goBack}
      />
      {near ? (
        <PlacePickerSheet
          visible={picker !== null}
          title={picker === "dropoff" ? "New destination" : "Add a stop"}
          near={near}
          onCancel={() => setPicker(null)}
          onConfirm={(place: PickedPlace) => {
            const target = picker;
            setPicker(null);
            if (target === "dropoff") {
              setDropoff({
                lat: place.lat,
                lng: place.lng,
                label: place.label,
              });
              return;
            }
            counter.current += 1;
            setDraft((list) => [
              ...(list ?? []),
              {
                key: "new" + counter.current,
                existing: false,
                lat: place.lat,
                lng: place.lng,
                label: place.label ?? "",
                purpose: "errand",
                dwellSec: undefined,
              },
            ]);
          }}
        />
      ) : null}
    </>
  );
}
