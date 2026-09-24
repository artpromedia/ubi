// C3 BookingImpact (A05 fleet calendar, handoff C3; decisions Q3, Q4 and corrections
// 1–2). One of the driver's OWN bookings is at risk — the vehicle is off the road or
// booked in for service, a document expires, the arrangement ends, or the driver's own
// time off overlaps it. GET /v1/drivers/me/conflicts/{id} names the choices and their
// server-explained outcomes; the booking itself (its window, the server's risk message
// and any vehicle the fleet has proposed) comes from the driver's own marketplace
// calendar, GET /v1/mp/driver/calendar.
//
// Choices, each a decision taken only while parked (C2b):
//  - keep it on another vehicle: when the fleet has proposed one, accept or decline it —
//    POST /v1/mp/advance-bookings/{id}/vehicle-swaps/{swapId}/accept|decline. Accepting
//    only starts it: ride-service revalidates and the RIDER must confirm the new
//    vehicle (Q3 — always); the fare and the once-captured commission never change.
//    Disabled, with the server's reason, when no vehicle is eligible;
//  - keep it and let the fleet move the service (planned maintenance only) — nothing to
//    send, the fleet already sees the conflict;
//  - trim the time off (a time-off conflict) — the AvailabilityEditor;
//  - withdraw — POST /v1/mp/advance-bookings/{id}/withdraw. Before: "Your {amount}
//    commission is returned to your wallet" with the SERVER's amount; the rider's
//    funding is released; no penalty. After: the marketplace's own outcome, and a
//    rematch is mentioned only when it says one is available (never promised here).
import React, { useState } from "react";
import { View } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, MoneyText, Screen, Text } from "@ubi/mobile-ui";
import { ApiError, track } from "@ubi/mobile-core";
import { dynamicTestId } from "@ubi/contracts";
import {
  fleetApi,
  type FleetConflict,
  type FleetConflictOption,
} from "../../api/fleet";
import { marketplaceApi, type MpAdvanceBooking } from "../../api/marketplace";
import type { RootStackParamList } from "../../navigation/routes";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { reportLocationStale, useMotionGate } from "../../lib/motion";
import { LoadFailure, LoadingBlocks, StateTag } from "../marketplace/TripParts";
import { errorReason, refusalFor, type Refusal } from "../marketplace/tripCopy";
import {
  ActionBanner,
  FleetUnavailable,
  FreshnessBanner,
  MotionLock,
} from "./FleetParts";
import {
  CONFLICT_TITLE,
  WITHDRAW_REASON,
  dateTimeIn,
  fleetRefusal,
  isFleetUnavailable,
  isOffline,
  timeIn,
  zoneNote,
} from "./fleetCopy";
import { SCHEDULE_KEY } from "./FleetScheduleScreen";
import { FLEET_LOAD_TIDS, FLEET_TID } from "./testIds";

type Nav = {
  navigate: (name: string, params?: unknown) => void;
  goBack: () => void;
};
type BannerState = (Refusal & { tone: "error" | "warn" | "ok" }) | null;

const CALENDAR_KEY = ["mp", "calendar"] as const;
const SWAP_OPEN = new Set(["proposed"]);
const SWAP_WAITING_RIDER = new Set([
  "driver_accepted",
  "revalidating",
  "rider_consent_pending",
]);

const OPTION_TITLE: Record<FleetConflictOption["id"], string> = {
  keep_on_swapped_vehicle: "Keep it on another vehicle",
  ask_fleet_to_move: "Keep it, and ask the fleet to move the service",
  trim_time_off: "Keep it, and trim your time off",
  withdraw: "Withdraw from this booking",
};

export function FleetConflictScreen() {
  const nav = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<RootStackParamList, "FleetConflict">>();
  const conflictId = params.conflictId;
  const queryClient = useQueryClient();
  const gate = useMotionGate();
  const keys = useIdempotencyKeys("fleetimpact");
  const conflictKey = ["fleet", "conflict", conflictId];
  const conflictQ = useQuery({
    queryKey: conflictKey,
    queryFn: () => fleetApi.conflict(conflictId),
    refetchInterval: 30_000,
    retry: false,
  });
  const calendarQ = useQuery({
    queryKey: CALENDAR_KEY,
    queryFn: marketplaceApi.calendar,
    refetchInterval: 30_000,
    retry: false,
  });
  const scheduleQ = useQuery({
    queryKey: SCHEDULE_KEY,
    queryFn: fleetApi.schedule,
    retry: false,
  });
  const zone = scheduleQ.data?.zone ?? null;
  const [banner, setBanner] = useState<BannerState>(null);
  const [confirming, setConfirming] = useState(false);
  const [ended, setEnded] = useState<MpAdvanceBooking | null>(null);

  const conflict = conflictQ.data;
  const booking =
    ended ??
    (conflict?.bookingId
      ? calendarQ.data?.bookings.find((b) => b.bookingId === conflict.bookingId)
      : undefined);

  const adopt = (saved: MpAdvanceBooking) => {
    queryClient.setQueryData<{ bookings: MpAdvanceBooking[]; note: string }>(
      CALENDAR_KEY,
      (old) =>
        old
          ? {
              ...old,
              bookings: old.bookings.map((b) =>
                b.bookingId === saved.bookingId ? saved : b,
              ),
            }
          : old,
    );
    void queryClient.invalidateQueries({ queryKey: conflictKey });
    void queryClient.invalidateQueries({ queryKey: SCHEDULE_KEY });
  };
  const onRefused = (e: unknown) => {
    // The marketplace refuses a decision it can't see as parked: drop back to
    // the stale state so the lock asks for the attestation again.
    if (
      e instanceof ApiError &&
      e.code === "driver_ineligible" &&
      errorReason(e) !== "ACCOUNT_NOT_ELIGIBLE"
    )
      reportLocationStale();
    if (!isOffline(e)) void calendarQ.refetch();
    setBanner({ ...refusalFor(e), tone: isOffline(e) ? "warn" : "error" });
  };

  const swapPrint = (v: { swapId: string; decision: string }) =>
    "swap:" + v.swapId + ":" + v.decision;
  const decideSwap = useMutation({
    mutationFn: (v: {
      bookingId: string;
      swapId: string;
      decision: "accept" | "decline";
    }) =>
      marketplaceApi.decideVehicleSwap(
        v.bookingId,
        v.swapId,
        v.decision,
        keys.keyFor(swapPrint(v)),
      ),
    onSuccess: (saved, v) => {
      keys.settle(swapPrint(v));
      setBanner(
        v.decision === "accept"
          ? {
              tone: "ok",
              title: "You accepted the other vehicle",
              body: "UBI checks it, then the rider is asked to confirm it. Nothing changes until they do — the fare stays the same and your commission isn’t charged again.",
            }
          : {
              tone: "ok",
              title: "You declined the other vehicle",
              body: "The booking keeps its vehicle. You can still withdraw, with no penalty.",
            },
      );
      adopt(saved);
      track("driver_fleet_swap_" + v.decision, { bookingId: v.bookingId });
    },
    onError: (e, v) => {
      keys.settle(swapPrint(v), e);
      onRefused(e);
    },
  });
  const withdrawPrint = (bookingId: string) => "withdraw:" + bookingId;
  const withdraw = useMutation({
    mutationFn: (v: { bookingId: string; type: FleetConflict["type"] }) =>
      marketplaceApi.withdrawBooking(
        v.bookingId,
        WITHDRAW_REASON[v.type],
        keys.keyFor(withdrawPrint(v.bookingId)),
      ),
    onSuccess: (saved, v) => {
      keys.settle(withdrawPrint(v.bookingId));
      setConfirming(false);
      setBanner(null);
      setEnded(saved);
      adopt(saved);
      track("driver_fleet_booking_withdrawn", { bookingId: v.bookingId });
    },
    onError: (e, v) => {
      keys.settle(withdrawPrint(v.bookingId), e);
      onRefused(e);
    },
  });

  if (!conflict) {
    return (
      <Screen title="Booking decision" onBack={nav.goBack} bg="bg2">
        {conflictQ.isError ? (
          isFleetUnavailable(conflictQ.error) ? (
            <FleetUnavailable />
          ) : (
            <LoadFailure
              offline={isOffline(conflictQ.error)}
              title="We couldn’t load this decision"
              body={fleetRefusal(conflictQ.error).body}
              onRetry={() => void conflictQ.refetch()}
              testIDs={FLEET_LOAD_TIDS}
            />
          )
        ) : (
          <LoadingBlocks heights={[80, 120, 120]} />
        )}
      </Screen>
    );
  }

  const closed = conflict.status === "resolved" || conflict.status === "lapsed";
  const title = booking
    ? "Booking " + booking.schedule.label
    : "Booking decision";

  return (
    <Screen
      title={title}
      subtitle={zoneNote(zone)}
      onBack={nav.goBack}
      bg="bg2"
    >
      <FreshnessBanner
        failed={conflictQ.isError}
        offline={isOffline(conflictQ.error)}
        asOf={null}
        zone={zone}
      />
      <ActionBanner banner={banner} />
      <Card style={{ gap: 6 }}>
        <Text variant="bodyStrong">{CONFLICT_TITLE[conflict.type]}</Text>
        {booking?.risk?.message ? (
          <Text variant="bodySm" tone="text2">
            {booking.risk.message}
          </Text>
        ) : null}
        {conflict.deadlineAt && !closed ? (
          <View testID={FLEET_TID.impactDeadline}>
            <StateTag
              label={"Decide by " + timeIn(conflict.deadlineAt, zone)}
              tone="error"
            />
            <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
              {dateTimeIn(conflict.deadlineAt, zone) +
                ". If nothing is decided by then, the booking ends with the outcome below and the rider is told."}
            </Text>
          </View>
        ) : null}
      </Card>
      {ended ? (
        <WithdrawnOutcome booking={ended} />
      ) : closed ? (
        <Card testID={FLEET_TID.impactOutcome} style={{ gap: 4 }}>
          <Text variant="bodyStrong">
            {conflict.status === "resolved"
              ? "This is resolved"
              : "The decision deadline passed"}
          </Text>
          <Text variant="bodySm" tone="text2">
            {conflict.status === "resolved"
              ? "Nothing more to do here."
              : "The booking followed its explained outcome. Your calendar shows where it stands."}
          </Text>
        </Card>
      ) : gate.motion === "moving" ? (
        <MotionLock
          gate={gate}
          waiting="You have 1 booking decision."
          deadline={conflict.deadlineAt}
          zone={zone}
        />
      ) : (
        <>
          <MotionLock
            gate={gate}
            waiting="You have 1 booking decision."
            deadline={conflict.deadlineAt}
            zone={zone}
          />
          {conflict.options.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              booking={booking}
              zone={zone}
              parked={gate.motion === "parked_confirmed"}
              confirming={confirming}
              busySwap={decideSwap.isPending}
              busyWithdraw={withdraw.isPending}
              onSwap={(swapId, decision) =>
                conflict.bookingId &&
                decideSwap.mutate({
                  bookingId: conflict.bookingId,
                  swapId,
                  decision,
                })
              }
              onTrim={() => nav.navigate("FleetAvailability")}
              onWithdrawOpen={() => {
                setBanner(null);
                setConfirming(true);
              }}
              onWithdrawCancel={() => setConfirming(false)}
              onWithdrawConfirm={() =>
                conflict.bookingId &&
                withdraw.mutate({
                  bookingId: conflict.bookingId,
                  type: conflict.type,
                })
              }
            />
          ))}
          <Text variant="caption" tone="text2">
            Amounts are from UBI. Nothing changes until you confirm.
          </Text>
        </>
      )}
    </Screen>
  );
}

function OptionCard({
  option,
  booking,
  zone,
  parked,
  confirming,
  busySwap,
  busyWithdraw,
  onSwap,
  onTrim,
  onWithdrawOpen,
  onWithdrawCancel,
  onWithdrawConfirm,
}: {
  option: FleetConflictOption;
  booking: MpAdvanceBooking | undefined;
  zone: string | null;
  parked: boolean;
  confirming: boolean;
  busySwap: boolean;
  busyWithdraw: boolean;
  onSwap: (swapId: string, decision: "accept" | "decline") => void;
  onTrim: () => void;
  onWithdrawOpen: () => void;
  onWithdrawCancel: () => void;
  onWithdrawConfirm: () => void;
}) {
  const swap = booking?.vehicleSwap ?? null;
  return (
    <Card
      testID={dynamicTestId(FLEET_TID.impactOption, option.id)}
      style={{ gap: 6, opacity: option.enabled ? 1 : 0.7 }}
    >
      <Text variant="bodyStrong">{OPTION_TITLE[option.id]}</Text>
      {!option.enabled ? (
        <Text variant="bodySm" tone="text2">
          {"Not available: " + (option.reason ?? "not for this booking.")}
        </Text>
      ) : option.id === "keep_on_swapped_vehicle" ? (
        swap && SWAP_OPEN.has(swap.state) ? (
          <View style={{ gap: 6 }}>
            <Text variant="bodySm">
              {"Your fleet proposes " +
                swap.to.label +
                (swap.from ? " instead of " + swap.from.label : "") +
                "."}
            </Text>
            <Text variant="caption" tone="text2">
              {swap.notice +
                " Answer by " +
                dateTimeIn(swap.expiresAt, zone) +
                "."}
            </Text>
            {parked ? (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Button
                  testID={FLEET_TID.impactSwapAccept}
                  label="Accept vehicle"
                  size="md"
                  style={{ flex: 1 }}
                  loading={busySwap}
                  onPress={() => onSwap(swap.swapId, "accept")}
                />
                <Button
                  testID={FLEET_TID.impactSwapDecline}
                  label="Decline"
                  kind="secondary"
                  size="md"
                  style={{ flex: 1 }}
                  disabled={busySwap}
                  onPress={() => onSwap(swap.swapId, "decline")}
                />
              </View>
            ) : null}
          </View>
        ) : swap && SWAP_WAITING_RIDER.has(swap.state) ? (
          <Text variant="bodySm" tone="text2">
            {"You accepted " +
              swap.to.label +
              ". The rider is asked to confirm it; nothing changes until they do."}
          </Text>
        ) : swap?.state === "applied" ? (
          <Text variant="bodySm" tone="text2">
            {"The rider confirmed " +
              swap.to.label +
              ". The booking keeps its fare and your commission isn’t charged again."}
          </Text>
        ) : (
          <Text variant="bodySm" tone="text2">
            {(option.reason ?? "") +
              " No vehicle has been proposed yet — your fleet already sees this booking."}
          </Text>
        )
      ) : option.id === "ask_fleet_to_move" ? (
        <Text variant="bodySm" tone="text2">
          Your booking stays as it is. Your fleet has already been shown the
          conflict — there’s nothing to send.
        </Text>
      ) : option.id === "trim_time_off" ? (
        <View style={{ gap: 6 }}>
          <Text variant="bodySm" tone="text2">
            Shorten your time off so it no longer covers this booking.
          </Text>
          {parked ? (
            <Button
              label="Edit time off"
              kind="secondary"
              size="md"
              onPress={onTrim}
            />
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <Text variant="bodySm">
            {option.outcome?.commissionReturned ? (
              <>
                {"Your "}
                <MoneyText
                  money={option.outcome.commissionReturned}
                  variant="bodySmStrong"
                />
                {" commission is returned to your wallet."}
              </>
            ) : (
              "Your commission is returned to your wallet."
            )}
          </Text>
          <Text variant="bodySm" tone="text2">
            The rider’s funding is released and they aren’t charged. No penalty
            and no score.
          </Text>
          {parked ? (
            confirming ? (
              <View style={{ gap: 8 }}>
                <Text variant="bodySmStrong" accessibilityRole="header">
                  Withdraw from this booking?
                </Text>
                <Button
                  testID={FLEET_TID.impactWithdrawConfirm}
                  label="Confirm withdrawal"
                  kind="danger"
                  size="md"
                  loading={busyWithdraw}
                  onPress={onWithdrawConfirm}
                />
                <Button
                  testID={FLEET_TID.impactWithdrawCancel}
                  label="Keep the booking"
                  kind="ghost"
                  size="md"
                  disabled={busyWithdraw}
                  onPress={onWithdrawCancel}
                />
              </View>
            ) : (
              <Button
                testID={FLEET_TID.impactWithdraw}
                label="Withdraw"
                kind="secondary"
                size="md"
                onPress={onWithdrawOpen}
              />
            )
          ) : null}
        </View>
      )}
    </Card>
  );
}

/** The marketplace's own outcome of the withdrawal — rematch only when it says so. */
function WithdrawnOutcome({ booking }: { booking: MpAdvanceBooking }) {
  const outcome = booking.failure?.financialOutcome;
  return (
    <Card testID={FLEET_TID.impactOutcome} tone="ok" style={{ gap: 4 }}>
      <Text variant="bodyStrong">You withdrew from this booking</Text>
      {outcome ? (
        <>
          <Text variant="bodySm">
            {outcome.commissionReversed ? (
              booking.commissionMinor ? (
                <>
                  {"Your "}
                  <MoneyText
                    money={booking.commissionMinor}
                    variant="bodySmStrong"
                  />
                  {" commission is returned to your wallet."}
                </>
              ) : (
                "Your commission is returned to your wallet."
              )
            ) : (
              "Your commission return is being processed — it’s tracked until it completes."
            )}
          </Text>
          <Text variant="bodySm" tone="text2">
            {outcome.riderFundingReleased
              ? "The rider’s funding was released. They weren’t charged."
              : "The rider’s funding is being released. They weren’t charged."}
          </Text>
          {booking.failure?.rematchAvailable ? (
            <Text variant="bodySm" tone="text2">
              The rider can choose a rematch at the same fare.
            </Text>
          ) : null}
          <Text variant="bodySm" tone="text2">
            No penalty and no score.
          </Text>
        </>
      ) : (
        <Text variant="bodySm" tone="text2">
          The booking has ended.
        </Text>
      )}
    </Card>
  );
}
