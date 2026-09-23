// A03 container — Calendar (Root screen). GET /v1/mp/driver/calendar is the driver's
// committed future bookings, each rendered from the server's MpAdvanceBooking (window,
// coarse route, fare / commission / net, funding, notices, reconfirmation, failure).
// Reconfirm and withdraw are state POSTs with caller-held Idempotency-Keys; the answer
// (the refreshed booking) replaces the cached row. The overlap warning compares the
// server's own window timestamps (time only) as a defensive check — the server's
// calendar constraint should make it impossible, so if it ever shows, it is flagged
// rather than hidden. Nothing here computes money or tracks an acceptance rate.
import React, { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Screen } from "@ubi/mobile-ui";
import { ApiError, track, useFlag } from "@ubi/mobile-core";
import {
  marketplaceApi,
  type MpAdvanceBooking,
  type MpDriverCalendar,
} from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { MP_DRIVER_TID } from "./testIds";
import { LoadFailure, LoadingBlocks, type TagTone } from "./TripParts";
import {
  inLabel,
  isOffline,
  refusalFor,
  stalenessOf,
  useNow,
  type Refusal,
} from "./tripCopy";
import {
  DriverCalendarScreen,
  type BookingCardView,
} from "./DriverCalendarScreen";

const QUERY_KEY = ["mp", "calendar"] as const;
const LIVE = new Set(["held", "payment_pending", "confirmed", "reconfirmed"]);
const WITHDRAWABLE = new Set(["payment_pending", "confirmed", "reconfirmed"]);

const FAILURE_TITLE: Record<string, string> = {
  driver_withdrew: "You withdrew from this booking",
  driver_ineligible:
    "Your account couldn’t take marketplace work at activation",
  reconfirmation_missed: "The reconfirmation deadline passed",
  funding_not_secured: "The rider’s payment couldn’t be secured in time",
  driver_unavailable: "You weren’t available when it activated",
  driver_on_running_trip:
    "You were still on a trip that wouldn’t end in time for this pickup",
  execution_blocked: "The trip couldn’t be started",
  award_cancelled: "The award was cancelled",
  trip_cancelled: "The trip was cancelled",
  rider_cancelled: "The rider cancelled before pickup",
};

const toneOf = (b: MpAdvanceBooking): TagTone =>
  b.state === "failed" || b.state === "released"
    ? "error"
    : b.state === "cancelled"
      ? "neutral"
      : b.fullySecured || b.state === "completed"
        ? "ok"
        : b.driverReserved
          ? "warn"
          : "info";

/** The financial outcome of an ended booking, from the server's flags. */
export const outcomeLines = (
  failure: NonNullable<MpAdvanceBooking["failure"]>,
): string[] => [
  failure.financialOutcome.commissionReversed
    ? "Your commission was returned to your wallet (linked reversal)."
    : "Your commission return isn’t confirmed yet — it’s tracked until it completes.",
  failure.financialOutcome.riderFundingReleased
    ? "The rider’s payment hold was released."
    : "The rider’s payment hold is being released.",
  "The rider was not charged.",
  ...(failure.rematchAvailable
    ? [
        "The rider may choose a rematch — no one is substituted for you automatically.",
      ]
    : []),
];

/** Overlapping live bookings, by the server's window timestamps (time only). */
export const overlaps = (bookings: MpAdvanceBooking[]): string[] => {
  const live = bookings
    .filter((b) => LIVE.has(b.state))
    .sort(
      (a, b) =>
        Date.parse(a.schedule.windowStart) - Date.parse(b.schedule.windowStart),
    );
  const out: string[] = [];
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++)
      if (
        Date.parse(live[j].schedule.windowStart) <
        Date.parse(live[i].schedule.windowEnd)
      )
        out.push(
          "Pickup windows overlap: " +
            live[i].schedule.label +
            " and " +
            live[j].schedule.label +
            ". If you can’t do both, withdraw one — its commission is returned to you.",
        );
  return out;
};

export function DriverCalendarContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const queryClient = useQueryClient();
  // Both hooks always run (never short-circuit a hook call).
  const multiStopOn = useFlag("marketplace_multi_stop");
  const amendmentsOn = useFlag("marketplace_trip_amendments");
  const tripsOn = multiStopOn || amendmentsOn;
  const keys = useIdempotencyKeys("booking");
  const now = useNow(30_000);
  const q = useQuery({
    queryKey: QUERY_KEY,
    queryFn: marketplaceApi.calendar,
    refetchInterval: 30_000,
    retry: false,
  });
  const [banner, setBanner] = useState<
    (Refusal & { tone: "error" | "warn" | "ok" }) | null
  >(null);
  const [withdrawing, setWithdrawing] = useState<{
    bookingId: string;
    reason: string;
  } | null>(null);

  const adopt = (b: MpAdvanceBooking) =>
    queryClient.setQueryData<MpDriverCalendar>(QUERY_KEY, (old) =>
      old
        ? {
            ...old,
            bookings: old.bookings.map((x) =>
              x.bookingId === b.bookingId ? b : x,
            ),
          }
        : old,
    );
  const onRefused = (e: unknown) => {
    if (!isOffline(e)) void q.refetch();
    setBanner({ ...refusalFor(e), tone: isOffline(e) ? "warn" : "error" });
  };

  const reconfirmPrint = (b: MpAdvanceBooking) =>
    "reconfirm:" + b.bookingId + ":" + b.version;
  const reconfirm = useMutation({
    mutationFn: (b: MpAdvanceBooking) =>
      marketplaceApi.reconfirmBooking(
        b.bookingId,
        keys.keyFor(reconfirmPrint(b)),
      ),
    onSuccess: (saved, b) => {
      keys.settle(reconfirmPrint(b));
      setBanner({
        tone: "ok",
        title: "Reconfirmed",
        body: "Thanks — the rider sees you’re still coming. Your commission was captured once at selection and won’t be charged again at pickup.",
      });
      adopt(saved);
      track("driver_mp_booking_reconfirmed", { bookingId: b.bookingId });
    },
    onError: (e, b) => {
      keys.settle(reconfirmPrint(b), e);
      onRefused(e);
    },
  });

  const withdrawPrint = (v: { bookingId: string; reason: string }) =>
    "withdraw:" + v.bookingId + ":" + v.reason;
  const withdraw = useMutation({
    mutationFn: (v: { bookingId: string; reason: string }) =>
      marketplaceApi.withdrawBooking(
        v.bookingId,
        v.reason,
        keys.keyFor(withdrawPrint(v)),
      ),
    onSuccess: (saved, v) => {
      keys.settle(withdrawPrint(v));
      setWithdrawing(null);
      setBanner({
        tone: "ok",
        title: "Booking withdrawn",
        body: saved.failure
          ? outcomeLines(saved.failure).join(" ")
          : "The booking has ended.",
      });
      adopt(saved);
      track("driver_mp_booking_withdrawn", { bookingId: v.bookingId });
    },
    onError: (e, v) => {
      keys.settle(withdrawPrint(v), e);
      onRefused(e);
    },
  });

  const cal = q.data;
  if (!cal) {
    const unavailable =
      q.error instanceof ApiError &&
      (q.error.code === "not_found" ||
        q.error.code === "feature_disabled" ||
        q.error.code === "market_not_configured");
    return (
      <Screen title="Your bookings" onBack={nav.goBack} bg="bg2">
        {q.isError ? (
          <LoadFailure
            offline={isOffline(q.error)}
            title={
              unavailable
                ? "Bookings aren’t available here yet"
                : "Couldn’t load your bookings"
            }
            body={
              unavailable
                ? "Advance bookings aren’t offered in your city right now."
                : (q.error as Error).message
            }
            onRetry={() => void q.refetch()}
            testIDs={MP_DRIVER_TID.calendar}
          />
        ) : (
          <LoadingBlocks heights={[40, 180, 180]} />
        )}
      </Screen>
    );
  }

  const cards: BookingCardView[] = cal.bookings.map((b) => {
    const r = b.reconfirmation;
    const opensIn = inLabel(r.opensAt, now);
    const closesIn = inLabel(r.deadline, now);
    const reconfirmView: BookingCardView["reconfirm"] =
      b.state === "reconfirmed"
        ? { text: "Reconfirmed", tone: "ok", onReconfirm: null, busy: false }
        : b.state !== "confirmed"
          ? null
          : opensIn
            ? {
                text: "Reconfirmation opens " + opensIn,
                tone: "neutral",
                onReconfirm: null,
                busy: false,
              }
            : closesIn
              ? {
                  text:
                    "Reconfirmation needed — closes " +
                    closesIn +
                    ". If it’s missed the booking is released and your commission returned.",
                  tone: "warn",
                  onReconfirm: () => {
                    setBanner(null);
                    reconfirm.mutate(b);
                  },
                  busy:
                    reconfirm.isPending &&
                    reconfirm.variables?.bookingId === b.bookingId,
                }
              : {
                  text: "The reconfirmation deadline passed — the booking is being released and your commission returned.",
                  tone: "error",
                  onReconfirm: null,
                  busy: false,
                };
    const mine = withdrawing?.bookingId === b.bookingId ? withdrawing : null;
    return {
      bookingId: b.bookingId,
      windowLabel: b.schedule.label,
      routeLabel: b.pickup.label + " → " + b.dropoff.label,
      statusLabel: b.statusLabel,
      statusTone: toneOf(b),
      fareMinor: b.fareMinor,
      commissionMinor: b.commissionMinor ?? null,
      netMinor: b.netMinor ?? null,
      fundingLabel: b.funding.label,
      notices: b.notices,
      reconfirm: reconfirmView,
      withdraw: WITHDRAWABLE.has(b.state)
        ? {
            open: !!mine,
            reason: mine?.reason ?? "",
            onReason: (reason) =>
              setWithdrawing({ bookingId: b.bookingId, reason }),
            onOpen: () => {
              setBanner(null);
              setWithdrawing({ bookingId: b.bookingId, reason: "" });
            },
            onCancel: () => setWithdrawing(null),
            onConfirm: () => {
              const reason = (mine?.reason ?? "").trim();
              if (!reason) return;
              withdraw.mutate({ bookingId: b.bookingId, reason });
            },
            busy:
              withdraw.isPending &&
              withdraw.variables?.bookingId === b.bookingId,
          }
        : null,
      failure: b.failure
        ? {
            title: FAILURE_TITLE[b.failure.reason] ?? b.failure.message,
            outcomes: outcomeLines(b.failure),
          }
        : null,
      onOpenTrip:
        tripsOn && b.state === "activated"
          ? () => nav.navigate("MpTrip", { requestId: b.requestId })
          : null,
    };
  });

  return (
    <DriverCalendarScreen
      note={cal.note}
      bookings={cards}
      conflicts={overlaps(cal.bookings)}
      banner={banner}
      stale={stalenessOf(q.isError ? q.error : null)}
      onBack={nav.goBack}
    />
  );
}
