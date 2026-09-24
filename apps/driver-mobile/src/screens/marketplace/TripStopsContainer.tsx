// A02 container — MpTrip (Root screen). GET /v1/mp/requests/:id/trip is the only source
// of truth: stop states, the disputed flag, waiting seconds, the paid-waiting fee, the
// authorized cap and every committed adjustment arrive from the server and are rendered
// as sent (polled every 5 s — waiting is computed server-side from its own timestamps).
// Each stop POST answers the refreshed trip, which replaces the cached copy. Every POST
// carries a caller-held Idempotency-Key (lib/idempotency.ts) and early termination binds
// to the fare revision on screen (expectedFareRevision) — a stale screen gets
// version_conflict, never a silent overwrite. Early termination is a fare decision, so
// it renders only once the server acknowledged the driver as parked.
import React, { useEffect, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@ubi/mobile-ui";
import { ApiError, track, useFlag } from "@ubi/mobile-core";
import type { RootStackParamList } from "../../navigation/routes";
import {
  marketplaceApi,
  type MpTerminationReason,
  type MpTrip,
} from "../../api/marketplace";
import { reportLocationStale, useMotionGate } from "../../lib/motion";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { MP_DRIVER_TID } from "./testIds";
import { LoadFailure, LoadingBlocks, type TagTone } from "./TripParts";
import {
  ADJUSTMENT_KIND_TEXT,
  SETTLEMENT_TEXT,
  STOP_PURPOSE,
  arrivalRefusal,
  clock,
  errorReason,
  isOffline,
  refusalFor,
  stalenessOf,
  stopStatusText,
  type Refusal,
} from "./tripCopy";
import { TripStopsScreen, type TripStopRow } from "./TripStopsScreen";

type StopAction = {
  kind: "arrive" | "depart" | "skip";
  stopId: string;
  disputed?: boolean;
};
const fingerprintOf = (a: StopAction) =>
  a.kind + ":" + a.stopId + (a.disputed ? ":disputed" : "");

const toneOf = (stop: MpTrip["stops"][number]): TagTone =>
  stop.state === "arrived"
    ? stop.arrivalDisputed
      ? "warn"
      : "info"
    : stop.state === "departed"
      ? "ok"
      : "neutral";

/** Server trip → stop rows. Formatting and action availability only; no money. */
export const stopRows = (
  trip: MpTrip,
  ui: {
    refusal: { stopId: string; refusal: Refusal } | null;
    busyStopId: string | null;
  },
): TripStopRow[] => {
  const ordered = [...trip.stops].sort((a, b) => a.order - b.order);
  const running = !trip.terminatedAt;
  const waitingAt = ordered.find((s) => s.state === "arrived");
  const nextStop = ordered.find((s) => s.state === "pending");
  return ordered.map((s) => {
    const arrived = s.state === "arrived";
    return {
      stopId: s.stopId,
      order: s.order,
      label: s.label,
      purposeLabel: STOP_PURPOSE[s.purpose] ?? "Stop",
      dwellLabel: "expected stop " + clock(s.dwellSec) + " (included)",
      statusText: stopStatusText(s),
      statusTone: toneOf(s),
      disputed:
        arrived && s.arrivalDisputed
          ? {
              distanceLabel:
                s.arrivalDistanceMeters !== undefined
                  ? "server saw you " + s.arrivalDistanceMeters + " m away"
                  : null,
            }
          : null,
      waiting:
        arrived && s.waiting
          ? {
              waitedSec: s.waiting.waitedSec,
              includedSec: s.waiting.includedSec,
              allowanceRemainingSec: s.waiting.allowanceRemainingSec,
              paidSec: s.waiting.paidSec,
              feeMinor: s.waiting.feeMinor,
              accruing: s.waiting.accruing,
              approvalRequired: s.waiting.approvalRequired,
              excessive: s.waiting.excessive,
            }
          : null,
      settlementText:
        !arrived && s.waiting && s.waiting.settlement !== "none"
          ? (SETTLEMENT_TEXT[s.waiting.settlement] ?? null)
          : null,
      arrivalRefusal:
        ui.refusal && ui.refusal.stopId === s.stopId
          ? ui.refusal.refusal
          : null,
      actions: {
        arrive: !running
          ? null
          : arrived && s.arrivalDisputed
            ? "confirm"
            : !waitingAt && s.stopId === nextStop?.stopId
              ? "arrive"
              : null,
        depart: running && arrived,
        // The server lets a driver leave a stop only once its waiting is excessive.
        skip: running && arrived && !!s.waiting?.excessive,
      },
      busy: ui.busyStopId === s.stopId,
    };
  });
};

export function TripStopsContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<RootStackParamList, "MpTrip">>();
  const requestId = params.requestId;
  const queryClient = useQueryClient();
  const gate = useMotionGate();
  const amendmentsOn = useFlag("marketplace_trip_amendments");
  const keys = useIdempotencyKeys("trip");
  const tripKey = ["mp", "trip", requestId];
  const q = useQuery({
    queryKey: tripKey,
    queryFn: () => marketplaceApi.trip(requestId),
    refetchInterval: 5_000,
    retry: false,
  });
  const [banner, setBanner] = useState<
    (Refusal & { tone: "error" | "warn" | "ok" }) | null
  >(null);
  const [refusal, setRefusal] = useState<{
    stopId: string;
    refusal: Refusal;
  } | null>(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const [reason, setReason] = useState<MpTerminationReason | null>(null);
  // A 202 answer to /terminate: the early_termination adjustment is recorded but its
  // money is still converging, so the trip is not marked terminated yet (terminatedAt
  // is set only at commit) and the change shows as open. Until the server resolves it
  // the entry stays closed and the screen says the end is being applied.
  const [terminationSent, setTerminationSent] = useState(false);
  const sentTrip = q.data;
  useEffect(() => {
    if (!terminationSent || !sentTrip) return;
    if (sentTrip.terminatedAt) {
      setTerminationSent(false);
      setBanner(null);
    } else if (!sentTrip.openAmendmentId) {
      // Resolved without ending the trip: the adjustment was refused or released.
      setTerminationSent(false);
      setBanner({
        tone: "error",
        title: "The early end wasn’t applied",
        body: "The server couldn’t apply it, so the trip continues as agreed and nothing changed. You can try again.",
      });
    }
  }, [terminationSent, sentTrip]);

  const adopt = (trip: MpTrip) => queryClient.setQueryData(tripKey, trip);
  const onRefused = (e: unknown) => {
    // The server could not confirm the driver parked: pause fare controls until the
    // driver re-attests (telemetry-style pause — never a grant).
    if (
      e instanceof ApiError &&
      e.code === "driver_ineligible" &&
      errorReason(e) !== "ACCOUNT_NOT_ELIGIBLE"
    )
      reportLocationStale();
    if (e instanceof ApiError && e.code === "version_conflict")
      void q.refetch();
    setBanner({ ...refusalFor(e), tone: isOffline(e) ? "warn" : "error" });
  };

  const stopAction = useMutation({
    mutationFn: (a: StopAction) => {
      const key = keys.keyFor(fingerprintOf(a));
      if (a.kind === "arrive")
        return marketplaceApi.arriveAtStop(
          requestId,
          a.stopId,
          !!a.disputed,
          key,
        );
      if (a.kind === "depart")
        return marketplaceApi.departStop(requestId, a.stopId, key);
      return marketplaceApi.skipStop(
        requestId,
        a.stopId,
        "excessive_waiting",
        key,
      );
    },
    onSuccess: (trip, a) => {
      keys.settle(fingerprintOf(a));
      setBanner(null);
      setRefusal(null);
      adopt(trip);
      track("driver_mp_stop_" + a.kind, {
        requestId,
        stopId: a.stopId,
        disputed: !!a.disputed,
      });
    },
    onError: (e, a) => {
      keys.settle(fingerprintOf(a), e);
      if (
        a.kind === "arrive" &&
        !a.disputed &&
        e instanceof ApiError &&
        e.code === "not_at_pickup"
      ) {
        // The server's geofence evidence, with the disputed-arrival option.
        setBanner(null);
        setRefusal({ stopId: a.stopId, refusal: arrivalRefusal(e) });
        return;
      }
      onRefused(e);
    },
  });

  const terminate = useMutation({
    mutationFn: (v: {
      reason: MpTerminationReason;
      expectedFareRevision: number;
    }) =>
      marketplaceApi.terminateTrip(
        requestId,
        v,
        keys.keyFor("terminate:" + v.reason + ":" + v.expectedFareRevision),
      ),
    onSuccess: (trip, v) => {
      keys.settle("terminate:" + v.reason + ":" + v.expectedFareRevision);
      setTerminateOpen(false);
      if (trip.terminatedAt) setBanner(null);
      else {
        setTerminationSent(true);
        setBanner({
          tone: "ok",
          title: "Ending the trip early",
          body: "The server recorded it and is applying the fare adjustment. This screen updates once it’s committed — then complete the ride as usual.",
        });
      }
      adopt(trip);
      void queryClient.invalidateQueries({
        queryKey: ["mp", "amendments", requestId],
      });
      track("driver_mp_trip_terminated", { requestId, reason: v.reason });
    },
    onError: (e, v) => {
      keys.settle("terminate:" + v.reason + ":" + v.expectedFareRevision, e);
      onRefused(e);
    },
  });

  const trip = q.data;
  if (!trip) {
    const unavailable =
      q.error instanceof ApiError &&
      (q.error.code === "not_found" || q.error.code === "feature_disabled");
    return (
      <Screen title="Trip stops" onBack={nav.goBack} bg="bg2">
        {q.isError ? (
          <LoadFailure
            offline={isOffline(q.error)}
            title={
              unavailable
                ? "This trip isn’t available"
                : "Couldn’t load this trip"
            }
            body={
              unavailable
                ? "It may have ended, or trip stops aren’t offered in your city yet."
                : (q.error as Error).message
            }
            onRetry={() => void q.refetch()}
            testIDs={MP_DRIVER_TID.trip}
          />
        ) : (
          <LoadingBlocks heights={[120, 150, 150]} />
        )}
      </Screen>
    );
  }

  const running = !trip.terminatedAt;
  const terminationPending =
    terminationSent && running && !!trip.openAmendmentId;
  const toAmendments = () => nav.navigate("MpAmendments", { requestId });
  return (
    <TripStopsScreen
      pickupLabel={trip.pickup.label}
      dropoffLabel={trip.dropoff.label}
      fare={{
        originalMinor: trip.originalFareMinor,
        agreedMinor: trip.agreedFareMinor,
        commissionMinor: trip.capturedCommissionMinor ?? null,
        adjustments: trip.committedAdjustments.map((a) => ({
          id: a.amendmentId,
          label: ADJUSTMENT_KIND_TEXT[a.kind] ?? "Adjustment",
          deltaMinor: a.fareDeltaMinor,
        })),
      }}
      terms={{
        perMinMinor: trip.waitingTerms.perMinMinor,
        authorizedCapMinor: trip.waitingTerms.authorizedCapMinor,
        maxAuthorizedMinor: trip.waitingTerms.maxAuthorizedMinor,
        committedMinor: trip.waitingTerms.committedMinor,
      }}
      stops={stopRows(trip, {
        refusal,
        busyStopId: stopAction.isPending
          ? (stopAction.variables?.stopId ?? null)
          : null,
      })}
      onArrive={(stopId, disputed) =>
        stopAction.mutate({ kind: "arrive", stopId, disputed })
      }
      onDepart={(stopId) => stopAction.mutate({ kind: "depart", stopId })}
      onSkip={(stopId) => stopAction.mutate({ kind: "skip", stopId })}
      openAmendment={
        amendmentsOn && trip.openAmendmentId && !terminationPending
          ? { onReview: toAmendments }
          : null
      }
      onChanges={amendmentsOn ? toAmendments : null}
      termination={
        amendmentsOn && running && !terminationPending
          ? {
              motion: gate.motion,
              parked: {
                confirming: gate.confirming,
                error: gate.confirmError,
                onConfirm: () => {
                  void gate.confirmParked();
                },
              },
              open: terminateOpen,
              onOpen: () => {
                setBanner(null);
                setTerminateOpen(true);
              },
              onCancel: () => {
                setTerminateOpen(false);
                setReason(null);
              },
              reason,
              onReason: setReason,
              onConfirm: () => {
                if (!reason) return;
                terminate.mutate({
                  reason,
                  expectedFareRevision: trip.fareRevision,
                });
              },
              busy: terminate.isPending,
            }
          : null
      }
      terminated={!running}
      banner={banner}
      stale={stalenessOf(q.isError ? q.error : null)}
      onBack={nav.goBack}
    />
  );
}
