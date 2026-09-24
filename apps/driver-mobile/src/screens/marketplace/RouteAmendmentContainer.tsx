// A02 container — MpAmendments (Root screen). Reads the executing trip (the ORIGINAL,
// in-force route and its revisions) and GET .../amendments (every proposal with its
// server-computed money), polled every 5 s. A decision binds to the amendment's exact
// (routeRevision, fareRevision); a proposal binds to the trip's committed revisions
// (expectedRouteRevision / expectedFareRevision) and carries stops only — the server
// prices the delta. Every POST carries a caller-held Idempotency-Key. The only client
// arithmetic here is time (the expiry countdown) and list order (the stop draft); money
// is rendered from server fields only.
import React, { useEffect, useMemo, useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@ubi/mobile-ui";
import { ApiError, track } from "@ubi/mobile-core";
import type { RootStackParamList } from "../../navigation/routes";
import {
  marketplaceApi,
  type MpAmendment,
  type MpAmendmentList,
  type MpProposeAmendment,
  type MpTrip,
} from "../../api/marketplace";
import { reportLocationStale, useMotionGate } from "../../lib/motion";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { MP_DRIVER_TID } from "./testIds";
import { LoadFailure, LoadingBlocks, type TagTone } from "./TripParts";
import {
  ADJUSTMENT_KIND_TEXT,
  RIDER_FUNDING_TEXT,
  STOP_PURPOSE,
  amendmentOutcome,
  clock,
  errorReason,
  isOffline,
  moneySign,
  proposerText,
  refusalFor,
  signedKm,
  signedMinutes,
  stalenessOf,
  useNow,
  type Refusal,
} from "./tripCopy";
import {
  RouteAmendmentScreen,
  type AmendmentCardView,
  type AmendmentHistoryRow,
} from "./RouteAmendmentScreen";

const OPEN = new Set(["proposed", "awaiting_approvals_and_funding"]);
export const isOpenRouteAmendment = (a: MpAmendment) =>
  a.kind === "route" && OPEN.has(a.state);

const routeLine = (
  pickup: string,
  stops: { order: number; label: string }[],
  dropoff: string,
) =>
  [
    pickup,
    ...[...stops].sort((a, b) => a.order - b.order).map((s) => s.label),
    dropoff,
  ].join(" → ");

const commissionNote = (a: MpAmendment) => {
  const sign = moneySign(a.commissionDeltaMinor);
  return sign > 0
    ? "Only the extra 10% on the increase — captured once if this commits. Your original commission is never charged again."
    : sign < 0
      ? "The commission difference is refunded to you as a linked adjustment if this commits."
      : "Your commission doesn’t change.";
};

const HISTORY_TAG: Record<string, { label: string; tone: TagTone }> = {
  committed: { label: "Committed", tone: "ok" },
  rejected: { label: "Declined", tone: "neutral" },
  expired: { label: "Expired", tone: "neutral" },
  failed: { label: "Not applied", tone: "error" },
  compensated: { label: "Returned", tone: "neutral" },
};

/** Closed amendments → history rows, newest first. Formatting only. */
export const historyRows = (list: MpAmendment[]): AmendmentHistoryRow[] =>
  list
    .filter((a) => !OPEN.has(a.state))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((a) => ({
      amendmentId: a.amendmentId,
      title:
        (ADJUSTMENT_KIND_TEXT[a.kind] ?? "Change") +
        " · " +
        proposerText(a.proposedByRole),
      statusText: HISTORY_TAG[a.state]?.label ?? a.state,
      statusTone: HISTORY_TAG[a.state]?.tone ?? "neutral",
      outcome: amendmentOutcome(a),
      deltaMinor: a.state === "committed" ? a.fareDeltaMinor : null,
    }));

type Decision = { kind: "approve" | "reject"; amendment: MpAmendment };
const decisionPrint = (d: Decision) =>
  d.kind +
  ":" +
  d.amendment.amendmentId +
  ":" +
  d.amendment.routeRevision +
  ":" +
  d.amendment.fareRevision;

export function RouteAmendmentContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<RootStackParamList, "MpAmendments">>();
  const requestId = params.requestId;
  const queryClient = useQueryClient();
  const gate = useMotionGate();
  const keys = useIdempotencyKeys("amend");
  const tripKey = ["mp", "trip", requestId];
  const listKey = ["mp", "amendments", requestId];
  const tripQ = useQuery({
    queryKey: tripKey,
    queryFn: () => marketplaceApi.trip(requestId),
    refetchInterval: 5_000,
    retry: false,
  });
  const listQ = useQuery({
    queryKey: listKey,
    queryFn: () => marketplaceApi.amendments(requestId),
    refetchInterval: 5_000,
    retry: false,
  });
  const [banner, setBanner] = useState<
    (Refusal & { tone: "error" | "warn" | "ok" }) | null
  >(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(null);
  const trip = tripQ.data;
  const list = listQ.data;
  const pendingList = useMemo(
    () => (list?.amendments ?? []).filter(isOpenRouteAmendment),
    [list],
  );
  // Countdown ticks only while there is something to count down to.
  const now = useNow(1_000, pendingList.length > 0);

  // Remaining (not yet reached) stops are the only ones a proposal may reorder/remove.
  const remaining = useMemo(
    () =>
      [...(trip?.stops ?? [])]
        .filter((s) => s.state === "pending")
        .sort((a, b) => a.order - b.order),
    [trip],
  );
  useEffect(() => {
    if (!composerOpen) setDraft(null);
  }, [composerOpen]);
  const draftIds = draft ?? remaining.map((s) => s.stopId);

  const refreshBoth = () => {
    void queryClient.invalidateQueries({ queryKey: tripKey });
    void queryClient.invalidateQueries({ queryKey: listKey });
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
    if (
      e instanceof ApiError &&
      e.code === "driver_ineligible" &&
      errorReason(e) !== "ACCOUNT_NOT_ELIGIBLE"
    )
      reportLocationStale();
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
      // An approval the commit then could not apply answers 200 with a closed
      // amendment (rejected / failed / compensated): say what happened, never "applied".
      const closedAfterApprove =
        d.kind === "approve" && a.state !== "committed" && !OPEN.has(a.state);
      setBanner(
        d.kind === "reject"
          ? {
              tone: "ok",
              title: "Change rejected",
              body: "No penalty. The original agreement stays in force and anything held for the change is released.",
            }
          : closedAfterApprove
            ? {
                tone: "warn",
                title: "The change didn’t go ahead",
                body: amendmentOutcome(a),
              }
            : {
                tone: "ok",
                title: "You approved the change",
                body:
                  a.state === "committed"
                    ? "Both of you approved — the new route and fare are in force."
                    : a.approvals.rider.approved
                      ? "Both of you approved — it’s being applied now. The original agreement stays in force until it commits."
                      : "It commits once the rider approves too. Until then the original agreement stays in force.",
              },
      );
      adoptAmendment(a);
      track("driver_mp_amendment_" + d.kind, {
        requestId,
        amendmentId: a.amendmentId,
      });
    },
    onError: (e, d) => {
      keys.settle(decisionPrint(d), e);
      onRefused(e);
    },
  });

  const propose = useMutation({
    mutationFn: (body: MpProposeAmendment) =>
      marketplaceApi.proposeAmendment(
        requestId,
        body,
        keys.keyFor("propose:" + JSON.stringify(body)),
      ),
    onSuccess: (a, body) => {
      keys.settle("propose:" + JSON.stringify(body));
      setComposerOpen(false);
      setBanner({
        tone: "ok",
        title: "Proposal sent",
        body: "The server priced it and checked your next job. It needs your approval and the rider’s; until then the original agreement stays in force.",
      });
      adoptAmendment(a);
      track("driver_mp_amendment_proposed", {
        requestId,
        amendmentId: a.amendmentId,
      });
    },
    onError: (e, body) => {
      keys.settle("propose:" + JSON.stringify(body), e);
      onRefused(e);
    },
  });

  if (!trip || !list) {
    const error = tripQ.error ?? listQ.error;
    const unavailable =
      error instanceof ApiError &&
      (error.code === "not_found" || error.code === "feature_disabled");
    return (
      <Screen title="Route changes" onBack={nav.goBack} bg="bg2">
        {error ? (
          <LoadFailure
            offline={isOffline(error)}
            title={
              unavailable
                ? "Route changes aren’t available"
                : "Couldn’t load route changes"
            }
            body={
              unavailable
                ? "This trip has ended, or route changes aren’t offered in your city yet."
                : (error as Error).message
            }
            onRetry={() => {
              void tripQ.refetch();
              void listQ.refetch();
            }}
            testIDs={MP_DRIVER_TID.amend}
          />
        ) : (
          <LoadingBlocks heights={[90, 260]} />
        )}
      </Screen>
    );
  }

  const parked = gate.motion === "parked_confirmed";
  const moving = gate.motion === "moving";
  const originalRoute = routeLine(
    trip.pickup.label,
    trip.stops,
    trip.dropoff.label,
  );
  const pending: AmendmentCardView[] = pendingList.map((a) => {
    const expiresIn = Math.floor((Date.parse(a.expiresAt) - now) / 1_000);
    const expired = expiresIn <= 0;
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
      proposerText: proposerText(a.proposedByRole),
      statusText:
        a.state === "proposed"
          ? "Securing funding"
          : bothApproved
            ? "Both approved · committing"
            : a.approvals.driver.approved
              ? "You approved · waiting for the rider"
              : "Awaiting your approval",
      statusTone:
        !a.approvals.driver.approved && awaiting ? "warn" : ("info" as TagTone),
      originalRoute,
      proposedRoute: routeLine(trip.pickup.label, a.stops, a.dropoff.label),
      addedDistance: signedKm(a.addedDistanceMeters),
      addedTime: signedMinutes(a.addedDurationSec),
      priorMinor: a.priorFareMinor,
      revisedMinor: a.revisedFareMinor,
      fareDeltaMinor: a.fareDeltaMinor,
      commissionDeltaMinor: a.commissionDeltaMinor ?? null,
      commissionNote: commissionNote(a),
      netDeltaMinor: a.driverNetDeltaMinor ?? null,
      netTone:
        moneySign(a.driverNetDeltaMinor) > 0
          ? "ok"
          : moneySign(a.driverNetDeltaMinor) < 0
            ? "errorInk"
            : "text",
      riderFundingText:
        RIDER_FUNDING_TEXT[a.riderFunding] ?? "status unavailable",
      riderFundingDeltaMinor: a.riderFundingDeltaMinor,
      approvalsText:
        "Rider: " +
        (a.approvals.rider.approved ? "approved" : "not yet") +
        " · You: " +
        (a.approvals.driver.approved ? "approved" : "not yet"),
      // No countdown while moving (no timer pressure behind the wheel).
      expiryLabel: moving
        ? null
        : expired
          ? "Expired — refreshing…"
          : "Expires in " + clock(expiresIn),
      decision:
        parked && !expired && !bothApproved
          ? {
              canApprove: awaiting && !a.approvals.driver.approved,
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
                  ? "The server is still reserving the funds for this change. You can approve it once that’s done."
                  : a.approvals.driver.approved
                    ? "You approved. It commits when the rider approves too."
                    : null,
            }
          : null,
    };
  });

  const running = !trip.terminatedAt;
  const openElsewhere = pendingList.length > 0 || !!trip.openAmendmentId;
  const byId = new Map(remaining.map((s) => [s.stopId, s]));
  const draftStops = draftIds
    .map((id) => byId.get(id))
    .filter((s): s is MpTrip["stops"][number] => !!s);
  const changed =
    draftIds.length !== remaining.length ||
    draftIds.some((id, i) => id !== remaining[i]?.stopId);
  const move = (key: string, by: -1 | 1) => {
    const ids = [...draftIds];
    const from = ids.indexOf(key);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setDraft(ids);
  };

  return (
    <RouteAmendmentScreen
      motion={gate.motion}
      parked={{
        confirming: gate.confirming,
        error: gate.confirmError,
        onConfirm: () => {
          void gate.confirmParked();
        },
      }}
      agreedFareMinor={list.agreedFareMinor}
      pending={pending}
      history={historyRows(list.amendments)}
      banner={banner}
      composer={
        running && !openElsewhere
          ? {
              open: composerOpen,
              onOpen: () => {
                setBanner(null);
                setComposerOpen(true);
              },
              onCancel: () => setComposerOpen(false),
              stops: draftStops.map((s) => ({
                key: s.stopId,
                label: s.label,
                detail:
                  (STOP_PURPOSE[s.purpose] ?? "Stop") +
                  " · expected stop " +
                  clock(s.dwellSec),
              })),
              onRemove: (key) => setDraft(draftIds.filter((id) => id !== key)),
              onUp: (key) => move(key, -1),
              onDown: (key) => move(key, 1),
              changed,
              busy: propose.isPending,
              onSend: () =>
                propose.mutate({
                  stops: draftStops.map((s) => ({
                    lat: s.lat,
                    lng: s.lng,
                    label: s.label,
                    purpose: s.purpose,
                    dwellSec: s.dwellSec,
                  })),
                  expectedRouteRevision: trip.routeRevision,
                  expectedFareRevision: trip.fareRevision,
                }),
              remainingCount: remaining.length,
            }
          : null
      }
      proposeNote={
        !running
          ? "This trip ended early, so its route can’t change."
          : openElsewhere
            ? "A change is already open on this trip. Resolve it before proposing another."
            : null
      }
      stale={stalenessOf(
        tripQ.isError ? tripQ.error : null,
        listQ.isError ? listQ.error : null,
      )}
      onBack={nav.goBack}
    />
  );
}
