// A02 container — Marketplace.Trip (rider). Reads the executing trip (GET .../trip: the
// committed terms, stops and server-measured waiting) and, when post-award changes are
// on, every proposed change (GET .../amendments), both polled every 5 s. A decision binds
// to the amendment's exact (routeRevision, fareRevision); extra waiting binds to the cap
// revision the rider saw; an early end binds to the committed fare revision. Every POST
// carries a caller-held Idempotency-Key. The only client arithmetic is time (countdowns);
// money is rendered from server fields only.
import React, { useMemo, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@ubi/mobile-ui";
import { track, useFlag, useFlags } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import {
  marketplaceApi,
  type MpAmendment,
  type MpAmendmentList,
  type MpTrip,
} from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import {
  TripScreen,
  type TripAmendmentCard,
  type TripHistoryRow,
  type TripStopRow,
} from "./TripScreen";
import {
  ADJUSTMENT_KIND_TEXT,
  RIDER_FUNDING_TEXT,
  SETTLEMENT_TEXT,
  STOP_PURPOSE_TEXT,
  amendmentOutcome,
  amendmentStatus,
  clock,
  isOffline,
  isOpenAmendment,
  isUnavailable,
  minutes,
  moneySign,
  proposerText,
  refusalFor,
  signedKm,
  signedMinutes,
  stalenessOf,
  stopStatusText,
  useNow,
  type Refusal,
} from "./riderCopy";
import {
  LoadFailure,
  LoadingBlocks,
  UnavailableCard,
  type RoutePoint,
} from "./riderParts";

const TID = TEST_IDS.mp.rider.trip;

/** "Pickup → Stop → … → Destination" as one line (history of a route, words only). */
export const routeLine = (
  pickup: string,
  stops: { order: number; label: string; state?: string }[],
  dropoff: string,
) =>
  [
    pickup,
    ...[...stops]
      .filter((s) => s.state !== "skipped")
      .sort((a, b) => a.order - b.order)
      .map((s) => s.label),
    dropoff,
  ].join(" → ");

/** Closed changes → history rows, newest first. Formatting only. */
export const historyRows = (list: MpAmendment[]): TripHistoryRow[] =>
  list
    .filter((a) => !isOpenAmendment(a))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((a) => {
      const status = amendmentStatus(a);
      return {
        amendmentId: a.amendmentId,
        title:
          (ADJUSTMENT_KIND_TEXT[a.kind] ?? "Change") +
          " · " +
          proposerText(a.proposedByRole),
        statusLabel: status.label,
        statusTone: status.tone,
        outcome: amendmentOutcome(a),
        deltaMinor: a.state === "committed" ? a.fareDeltaMinor : null,
      };
    });

const deltaSentence = (a: MpAmendment) => {
  const sign = moneySign(a.fareDeltaMinor);
  return sign > 0
    ? "Your fare goes up by"
    : sign < 0
      ? "Your fare goes down by"
      : "Your fare doesn’t change";
};

type Decision = { kind: "approve" | "reject"; amendment: MpAmendment };
const decisionPrint = (d: Decision) =>
  d.kind +
  ":" +
  d.amendment.amendmentId +
  ":" +
  d.amendment.routeRevision +
  ":" +
  d.amendment.fareRevision;

export function TripContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<MarketplaceStackParamList, "Trip">>();
  const requestId = params.requestId;
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("trip");
  const { status: flagStatus } = useFlags();
  const amendmentsOn = useFlag("marketplace_trip_amendments");
  const multiStopOn = useFlag("marketplace_multi_stop");
  const anyOn = amendmentsOn || multiStopOn;
  const tripKey = ["mp", "trip", requestId];
  const listKey = ["mp", "amendments", requestId];
  const tripQ = useQuery({
    queryKey: tripKey,
    queryFn: () => marketplaceApi.trip(requestId),
    enabled: anyOn,
    refetchInterval: 5_000,
    retry: false,
  });
  const listQ = useQuery({
    queryKey: listKey,
    queryFn: () => marketplaceApi.amendments(requestId),
    enabled: amendmentsOn,
    refetchInterval: 5_000,
    retry: false,
  });
  const [banner, setBanner] = useState<
    (Refusal & { tone: "ok" | "warn" | "error" }) | null
  >(null);
  const [terminateOpen, setTerminateOpen] = useState(false);
  const trip = tripQ.data;
  const list = listQ.data;
  // Only a ROUTE change asks for approvals; paid waiting and an early end are
  // server-recorded and settle on their own (they appear once committed).
  const pendingList = useMemo(
    () =>
      (list?.amendments ?? []).filter(
        (a) => a.kind === "route" && isOpenAmendment(a),
      ),
    [list],
  );
  const waitingNow = (trip?.stops ?? []).some((s) => s.state === "arrived");
  // The clock ticks only while there is a countdown or a live wait to show.
  const now = useNow(1_000, pendingList.length > 0 || waitingNow);

  const refreshBoth = () => {
    void queryClient.invalidateQueries({ queryKey: tripKey });
    if (amendmentsOn) void queryClient.invalidateQueries({ queryKey: listKey });
  };
  const adoptTrip = (t: MpTrip) => {
    queryClient.setQueryData(tripKey, t);
    refreshBoth();
  };
  const adoptAmendment = (a: MpAmendment) => {
    queryClient.setQueryData<MpAmendmentList>(listKey, (old) =>
      old
        ? {
            ...old,
            amendments: old.amendments.some(
              (x) => x.amendmentId === a.amendmentId,
            )
              ? old.amendments.map((x) =>
                  x.amendmentId === a.amendmentId ? a : x,
                )
              : [a, ...old.amendments],
          }
        : old,
    );
    refreshBoth();
  };
  const onRefused = (e: unknown) => {
    if (!isOffline(e)) refreshBoth();
    setBanner({ ...refusalFor(e), tone: isOffline(e) ? "warn" : "error" });
  };

  const decide = useMutation({
    mutationFn: (d: Decision) => {
      const body = {
        routeRevision: d.amendment.routeRevision,
        fareRevision: d.amendment.fareRevision,
      };
      const key = keys.keyFor(decisionPrint(d));
      return d.kind === "approve"
        ? marketplaceApi.approveAmendment(
            requestId,
            d.amendment.amendmentId,
            body,
            key,
          )
        : marketplaceApi.rejectAmendment(
            requestId,
            d.amendment.amendmentId,
            body,
            key,
          );
    },
    onSuccess: (a, d) => {
      keys.settle(decisionPrint(d));
      // An approval the commit then could not apply answers 200 with a CLOSED amendment
      // (rejected / failed / compensated): say what happened, never "applied".
      const closedAfterApprove =
        d.kind === "approve" && a.state !== "committed" && !isOpenAmendment(a);
      setBanner(
        d.kind === "reject"
          ? {
              tone: "ok",
              title: "Change declined",
              body: "Your original agreement stays in force. Anything reserved for the change is released.",
            }
          : closedAfterApprove
            ? {
                tone: "warn",
                title: "The change didn’t go ahead",
                body: amendmentOutcome(a),
              }
            : a.state === "committed"
              ? {
                  tone: "ok",
                  title: "Change committed",
                  body: "Both of you approved — the new route and fare are now your agreement.",
                }
              : {
                  tone: "ok",
                  title: "You approved the change",
                  body: a.approvals.driver.approved
                    ? "Both of you approved — it’s being applied now. Your original agreement stays in force until it commits."
                    : "It commits once your driver approves too. Until then your original agreement stays in force.",
                },
      );
      adoptAmendment(a);
      track("mp_amendment_" + d.kind, {
        requestId,
        amendmentId: a.amendmentId,
      });
    },
    onError: (e, d) => {
      keys.settle(decisionPrint(d), e);
      onRefused(e);
    },
  });

  const waiting = useMutation({
    mutationFn: (v: { stopId: string; capRevision: number }) =>
      marketplaceApi.approveWaiting(
        requestId,
        v.stopId,
        v.capRevision,
        keys.keyFor("waiting:" + v.stopId + ":" + v.capRevision),
      ),
    onSuccess: (t, v) => {
      keys.settle("waiting:" + v.stopId + ":" + v.capRevision);
      setBanner({
        tone: "ok",
        title: "More waiting approved",
        body: "Your driver can keep waiting. You pay only for the minutes actually waited.",
      });
      adoptTrip(t);
    },
    onError: (e, v) => {
      keys.settle("waiting:" + v.stopId + ":" + v.capRevision, e);
      onRefused(e);
    },
  });

  const skip = useMutation({
    mutationFn: (stopId: string) =>
      marketplaceApi.skipStop(
        requestId,
        stopId,
        undefined,
        keys.keyFor("skip:" + stopId),
      ),
    onSuccess: (t, stopId) => {
      keys.settle("skip:" + stopId);
      setBanner({
        tone: "ok",
        title: "Stop skipped",
        body: "Skipping doesn’t lower your agreed fare. Waiting already earned there is kept.",
      });
      adoptTrip(t);
    },
    onError: (e, stopId) => {
      keys.settle("skip:" + stopId, e);
      onRefused(e);
    },
  });

  const terminate = useMutation({
    mutationFn: (fareRevision: number) =>
      marketplaceApi.terminate(
        requestId,
        { expectedFareRevision: fareRevision },
        keys.keyFor("terminate:" + fareRevision),
      ),
    onSuccess: (t, fareRevision) => {
      keys.settle("terminate:" + fareRevision);
      setTerminateOpen(false);
      setBanner({
        tone: "ok",
        title: "Ending your trip here",
        body: "Stops not reached were skipped. The fare adjustment is shown below once it’s confirmed.",
      });
      adoptTrip(t);
      track("mp_trip_terminated", { requestId });
    },
    onError: (e, fareRevision) => {
      keys.settle("terminate:" + fareRevision, e);
      setTerminateOpen(false);
      onRefused(e);
    },
  });

  if (flagStatus === "loading")
    return (
      <Screen title="Your trip" onBack={nav.goBack}>
        <LoadingBlocks heights={[90, 200]} />
      </Screen>
    );
  if (!anyOn)
    return (
      <Screen title="Your trip" onBack={nav.goBack}>
        <UnavailableCard
          testID={TID.unavailable}
          title="Trip changes aren’t available here yet"
          body="Stops and route changes during a trip aren’t offered in your city right now. Your trip continues exactly as agreed."
          action={{ label: "Back to your ride", onPress: nav.goBack }}
        />
      </Screen>
    );
  if (!trip || (amendmentsOn && !list)) {
    const error = tripQ.error ?? listQ.error;
    return (
      <Screen title="Your trip" onBack={nav.goBack}>
        {error && isUnavailable(error) ? (
          <UnavailableCard
            testID={TID.unavailable}
            title="Nothing to change on this trip"
            body="This trip has ended, or stops and route changes aren’t offered for it. It continues exactly as agreed."
            action={{ label: "Back to your ride", onPress: nav.goBack }}
          />
        ) : error ? (
          <LoadFailure
            offline={isOffline(error)}
            title="Couldn’t load your trip"
            body={(error as Error).message}
            onRetry={() => {
              void tripQ.refetch();
              if (amendmentsOn) void listQ.refetch();
            }}
            testIDs={TID}
          />
        ) : (
          <LoadingBlocks heights={[90, 200]} />
        )}
      </Screen>
    );
  }

  const running = !trip.terminatedAt;
  const orderedStops = [...trip.stops].sort((a, b) => a.order - b.order);
  const originalRoute = routeLine(
    trip.pickup.label,
    orderedStops,
    trip.dropoff.label,
  );
  const pending: TripAmendmentCard[] = pendingList.map((a) => {
    const expiresIn = Math.floor((Date.parse(a.expiresAt) - now) / 1_000);
    const expired = expiresIn <= 0;
    const status = amendmentStatus(a);
    const awaiting = a.state === "awaiting_approvals_and_funding";
    const bothApproved =
      a.approvals.rider.approved && a.approvals.driver.approved;
    const busy =
      decide.isPending &&
      decide.variables?.amendment.amendmentId === a.amendmentId
        ? decide.variables.kind
        : null;
    return {
      amendmentId: a.amendmentId,
      statusLabel: status.label,
      statusTone: status.tone,
      proposer: proposerText(a.proposedByRole),
      originalRoute,
      proposedRoute: routeLine(trip.pickup.label, a.stops, a.dropoff.label),
      addedDistance: signedKm(a.addedDistanceMeters),
      addedTime: signedMinutes(a.addedDurationSec),
      priorMinor: a.priorFareMinor,
      revisedMinor: a.revisedFareMinor,
      fareDeltaMinor: a.fareDeltaMinor,
      deltaSentence: deltaSentence(a),
      fundingText: RIDER_FUNDING_TEXT[a.riderFunding] ?? "Status unavailable",
      fundingDeltaMinor: a.riderFundingDeltaMinor,
      approvalsText:
        "You: " +
        (a.approvals.rider.approved ? "approved" : "not yet") +
        " · Driver: " +
        (a.approvals.driver.approved ? "approved" : "not yet"),
      expiryLabel: expired
        ? "Expired — refreshing…"
        : "Expires in " + clock(expiresIn),
      decision:
        amendmentsOn && !expired && !bothApproved
          ? {
              canApprove: awaiting && !a.approvals.rider.approved,
              canReject: true,
              busy,
              onApprove: () => {
                setBanner(null);
                decide.mutate({ kind: "approve", amendment: a });
              },
              onReject: () => {
                setBanner(null);
                decide.mutate({ kind: "reject", amendment: a });
              },
              note:
                a.state === "proposed"
                  ? "UBI is still reserving the funds for this change. You can approve it once that’s done."
                  : a.approvals.rider.approved
                    ? "You approved. It commits when your driver approves too."
                    : null,
            }
          : null,
    };
  });

  const terms = trip.waitingTerms;
  const stopRows: TripStopRow[] = orderedStops.map((s) => {
    const w = s.waiting;
    const point: RoutePoint = {
      key: s.stopId,
      kind: "stop",
      label: s.label,
      detail:
        (STOP_PURPOSE_TEXT[s.purpose] ?? "Stop") +
        " · expected wait " +
        minutes(s.dwellSec),
    };
    const skippable =
      running && (s.state === "pending" || s.state === "arrived");
    return {
      stopId: s.stopId,
      point,
      statusText: stopStatusText(s),
      waiting:
        w && s.state === "arrived"
          ? {
              waited: clock(w.waitedSec),
              waitedSpoken: minutes(w.waitedSec),
              included: minutes(w.includedSec),
              feeMinor: w.feeMinor,
              accruing: w.accruing,
              settlementText: SETTLEMENT_TEXT[w.settlement] ?? "",
              approvalRequired: w.approvalRequired,
              excessive: w.excessive,
            }
          : w && s.state === "departed" && w.paidSec > 0
            ? {
                waited: clock(w.waitedSec),
                waitedSpoken: minutes(w.waitedSec),
                included: minutes(w.includedSec),
                feeMinor: w.feeMinor,
                accruing: false,
                settlementText: SETTLEMENT_TEXT[w.settlement] ?? "",
                approvalRequired: false,
                excessive: false,
              }
            : null,
      approveWaiting:
        w && s.state === "arrived" && w.approvalRequired && running
          ? {
              busy: waiting.isPending && waiting.variables?.stopId === s.stopId,
              onApprove: () => {
                setBanner(null);
                waiting.mutate({
                  stopId: s.stopId,
                  capRevision: terms.capRevision,
                });
              },
              increaseMinor: terms.maxAuthorizedMinor,
              perMinMinor: terms.perMinMinor,
            }
          : null,
      skip:
        skippable && multiStopOn
          ? {
              busy: skip.isPending && skip.variables === s.stopId,
              onSkip: () => {
                setBanner(null);
                skip.mutate(s.stopId);
              },
            }
          : null,
    };
  });
  const route: RoutePoint[] = [
    { key: "pickup", kind: "pickup", label: trip.pickup.label },
    ...orderedStops.map(
      (s): RoutePoint => ({
        key: s.stopId,
        kind: "stop",
        label: s.label,
        status: s.state === "pending" ? undefined : stopStatusText(s),
        muted: s.state === "skipped",
      }),
    ),
    { key: "dropoff", kind: "dropoff", label: trip.dropoff.label },
  ];
  const openElsewhere = pendingList.length > 0 || !!trip.openAmendmentId;
  const termination = trip.committedAdjustments.find(
    (a) => a.kind === "early_termination",
  );

  return (
    <TripScreen
      agreedFareMinor={trip.agreedFareMinor}
      originalFareMinor={trip.originalFareMinor}
      adjustments={trip.committedAdjustments.map((a) => ({
        key: a.amendmentId,
        label: ADJUSTMENT_KIND_TEXT[a.kind] ?? "Adjustment",
        deltaMinor: a.fareDeltaMinor,
      }))}
      route={route}
      stops={stopRows}
      waitingTerms={
        orderedStops.length
          ? {
              perMinMinor: terms.perMinMinor,
              authorizedCapMinor: terms.authorizedCapMinor,
              committedMinor: terms.committedMinor,
            }
          : null
      }
      pending={pending}
      history={list ? historyRows(list.amendments) : []}
      banner={banner}
      terminated={
        trip.terminatedAt
          ? termination
            ? "Stops you didn’t reach were skipped and your fare was adjusted for the part of the route you didn’t travel."
            : "Stops you didn’t reach were skipped. The fare adjustment is still being confirmed — it appears above once it is."
          : null
      }
      propose={
        amendmentsOn && running && !openElsewhere
          ? { onPropose: () => nav.navigate("ProposeChange", { requestId }) }
          : null
      }
      proposeNote={
        !amendmentsOn
          ? null
          : !running
            ? "This trip ended early, so its route can’t change."
            : openElsewhere
              ? "A change is already open on this trip. Resolve it before proposing another."
              : null
      }
      terminate={
        amendmentsOn && running
          ? {
              open: terminateOpen,
              busy: terminate.isPending,
              onOpen: () => {
                setBanner(null);
                setTerminateOpen(true);
              },
              onCancel: () => setTerminateOpen(false),
              onConfirm: () => terminate.mutate(trip.fareRevision),
            }
          : null
      }
      stale={stalenessOf(
        tripQ.isError ? tripQ.error : null,
        listQ.isError ? listQ.error : null,
      )}
      onReceipt={() => nav.navigate("Receipt", { requestId })}
      onBack={nav.goBack}
    />
  );
}
