// C4 AvailabilityEditor (A05 fleet calendar, handoff C4). Time off is the driver's
// alone ("Only you can set this"): it outranks a fleet shift, and a fleet sees it only
// as unexplained "Unavailable" hours (decisions Q9).
//
// Flow: the form (a local day and times on the city's clock, named by the server's
// zone) → POST /v1/drivers/me/availability:preview, "Checking with UBI…" until it
// answers → the server's list of what the change touches: a signed shift loses hours,
// or one of the driver's own bookings conflicts, each with its explained outcome →
// for every booking the driver chooses to TRIM the time off (and it is checked again)
// or to WITHDRAW (the server's amount returned, no penalty) → PUT
// /v1/drivers/me/availability with the exact windows checked, the chosen withdrawals,
// the preview token and a caller-held Idempotency-Key. A chosen withdrawal is then
// completed by the driver on the booking itself (C3), where the marketplace returns
// the commission; nothing is ever withdrawn on the driver's behalf.
//
// The PUT replaces the driver's saved set. The server offers no read of that set's
// rules yet, so a set saved before this session can't be carried over exactly: when
// the schedule shows one, the driver must explicitly agree to replace it (never a
// silent loss). That check reads HORIZON_DAYS ahead, not C1's default week: this form
// saves up to 16 days out (14 days to pick + a 48 h window), so time off saved in an
// earlier session that is still ahead always shows up here. Windows saved from this
// screen are kept and sent again.
//
// Deciding is locked while moving (C2b). The only arithmetic is on time.
import React, { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Chip,
  MoneyText,
  Screen,
  Text,
  Toggle,
} from "@ubi/mobile-ui";
import { track } from "@ubi/mobile-core";
import { dynamicTestId } from "@ubi/contracts";
import {
  fleetApi,
  type FleetAvailabilityPreview,
  type FleetAvailabilitySaved,
  type FleetWindowInput,
} from "../../api/fleet";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { useMotionGate } from "../../lib/motion";
import { LoadFailure, LoadingBlocks, StateTag } from "../marketplace/TripParts";
import { ActionBanner, FleetUnavailable, MotionLock } from "./FleetParts";
import {
  clockOf,
  dayOfKey,
  fleetRefusal,
  isFleetUnavailable,
  isOffline,
  localDateKey,
  nextLocalDays,
  rangeIn,
  timeIn,
  zoneNote,
  zonedIso,
  type Refusal,
} from "./fleetCopy";
import { SCHEDULE_KEY } from "./FleetScheduleScreen";
import { FLEET_LOAD_TIDS, FLEET_TID } from "./testIds";

type Nav = {
  navigate: (name: string, params?: unknown) => void;
  goBack: () => void;
};
type BannerState = (Refusal & { tone: "error" | "warn" | "ok" }) | null;
type BookingAffect = Extract<
  FleetAvailabilityPreview["affects"][number],
  { kind: "booking" }
>;

/** Windows saved from this screen this session — the only set known exactly. */
export const SAVED_WINDOWS_KEY = ["fleet", "availability", "saved"] as const;

const STEP = 30;
const MAX_END = 48 * 60;
const DAYS_OFFERED = 14;
/** How far ahead earlier-saved windows are looked for (the server allows 31 days). */
const HORIZON_DAYS = 30;

export function FleetAvailabilityScreen() {
  const nav = useNavigation<Nav>();
  const queryClient = useQueryClient();
  const gate = useMotionGate();
  const keys = useIdempotencyKeys("fleettimeoff");
  const horizon = useMemo(() => {
    const now = Date.now();
    return {
      from: new Date(now).toISOString(),
      to: new Date(now + HORIZON_DAYS * 86_400_000).toISOString(),
    };
  }, []);
  // Under SCHEDULE_KEY, so every schedule invalidation refreshes it too.
  const scheduleQ = useQuery({
    queryKey: [...SCHEDULE_KEY, "horizon", horizon.from],
    queryFn: () => fleetApi.scheduleBetween(horizon.from, horizon.to),
    retry: false,
  });
  // Filled only by a successful save (never fetched: there is no read of the set);
  // kept for the app's lifetime so a later edit sends those windows again.
  const knownQ = useQuery<FleetWindowInput[]>({
    queryKey: SAVED_WINDOWS_KEY,
    queryFn: () => Promise.reject(new Error("never fetched")),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const known = knownQ.data;
  const zone = scheduleQ.data?.zone ?? null;
  const days = useMemo(
    () => (zone ? nextLocalDays(Date.now(), zone, DAYS_OFFERED) : []),
    [zone],
  );
  const [day, setDay] = useState<string | null>(null);
  const [start, setStart] = useState(7 * 60);
  const [end, setEnd] = useState(23 * 60);
  const [replace, setReplace] = useState(false);
  const [checked, setChecked] = useState<{
    windows: FleetWindowInput[];
    preview: FleetAvailabilityPreview;
  } | null>(null);
  const [withdrawals, setWithdrawals] = useState<string[]>([]);
  const [banner, setBanner] = useState<BannerState>(null);
  const [saved, setSaved] = useState<FleetAvailabilitySaved | null>(null);

  const selectedDay = day ?? days[0] ?? null;
  const earlierSaved =
    known === undefined &&
    (scheduleQ.data?.items ?? []).some(
      (i) => i.kind === "availability" || i.kind === "time_off",
    );

  const draftWindows = (from = start, to = end): FleetWindowInput[] | null =>
    zone && selectedDay && to > from
      ? [
          ...(known ?? []),
          {
            kind: "time_off",
            startsAt: zonedIso(selectedDay, from, zone),
            endsAt: zonedIso(selectedDay, to, zone),
          },
        ]
      : null;

  const preview = useMutation({
    mutationFn: (windows: FleetWindowInput[]) =>
      fleetApi.previewAvailability(windows),
    onSuccess: (result, windows) => {
      setChecked({ windows, preview: result });
      setWithdrawals([]);
      setBanner(null);
    },
    onError: (e) => {
      setChecked(null);
      setBanner({
        ...fleetRefusal(e, zone),
        tone: isOffline(e) ? "warn" : "error",
      });
    },
  });
  const savePrint = (c: { preview: FleetAvailabilityPreview }, w: string[]) =>
    "save:" + c.preview.previewToken + ":" + [...w].sort().join(",");
  const save = useMutation({
    mutationFn: (v: {
      checked: NonNullable<typeof checked>;
      withdrawals: string[];
    }) =>
      fleetApi.saveAvailability(
        {
          windows: v.checked.windows,
          withdrawals: v.withdrawals,
          previewToken: v.checked.preview.previewToken,
        },
        keys.keyFor(savePrint(v.checked, v.withdrawals)),
      ),
    onSuccess: (result, v) => {
      keys.settle(savePrint(v.checked, v.withdrawals));
      queryClient.setQueryData<FleetWindowInput[]>(
        SAVED_WINDOWS_KEY,
        result.windows.map((w) => ({
          kind: w.kind,
          startsAt: w.startsAt,
          endsAt: w.endsAt,
          ...(w.rrule ? { rrule: w.rrule } : {}),
        })),
      );
      void queryClient.invalidateQueries({ queryKey: SCHEDULE_KEY });
      setSaved(result);
      setBanner(null);
      track("driver_fleet_time_off_saved", {
        withdrawals: result.withdrawals.length,
      });
    },
    onError: (e, v) => {
      keys.settle(savePrint(v.checked, v.withdrawals), e);
      // A stale preview or an unresolved booking: check again from the start.
      if (!isOffline(e)) setChecked(null);
      setBanner({
        ...fleetRefusal(e, zone),
        tone: isOffline(e) ? "warn" : "error",
      });
    },
  });

  if (!scheduleQ.data || !zone || !selectedDay) {
    return (
      <Screen title="Time off" onBack={nav.goBack} bg="bg2">
        {scheduleQ.isError ? (
          isFleetUnavailable(scheduleQ.error) ? (
            <FleetUnavailable />
          ) : (
            <LoadFailure
              offline={isOffline(scheduleQ.error)}
              title="We couldn’t load your schedule"
              body="Time off is checked against it. Try again."
              onRetry={() => void scheduleQ.refetch()}
              testIDs={FLEET_LOAD_TIDS}
            />
          )
        ) : (
          <LoadingBlocks heights={[200, 80]} />
        )}
      </Screen>
    );
  }

  if (saved) {
    return (
      <Screen
        title="Time off"
        subtitle={zoneNote(zone)}
        onBack={nav.goBack}
        bg="bg2"
      >
        <Card testID={FLEET_TID.timeOffSaved} tone="ok" style={{ gap: 6 }}>
          <Text variant="bodyStrong">Time off saved</Text>
          <Text variant="bodySm" tone="text2">
            Your fleet sees these hours only as “Unavailable”, with no reason.
          </Text>
          {saved.withdrawals.length > 0 ? (
            <Text variant="bodySm">
              Confirm each withdrawal on the booking — it isn’t withdrawn until
              you do.
            </Text>
          ) : null}
        </Card>
        {saved.withdrawals.map((w) => (
          <Button
            key={w.bookingId}
            label="Confirm the withdrawal"
            kind="secondary"
            accessibilityLabel={
              "Confirm the withdrawal from booking " + w.bookingId
            }
            onPress={() =>
              nav.navigate("FleetConflict", { conflictId: w.conflictId })
            }
          />
        ))}
        <Button
          label="Back to my schedule"
          kind="ghost"
          onPress={() => nav.navigate("FleetSchedule")}
        />
      </Screen>
    );
  }

  const invalidate = () => {
    setChecked(null);
    setWithdrawals([]);
  };
  const windows = draftWindows();
  const bookings = (checked?.preview.affects ?? []).filter(
    (a): a is BookingAffect => a.kind === "booking",
  );
  const shifts = (checked?.preview.affects ?? []).filter(
    (a) => a.kind === "shift",
  );
  const allChosen = bookings.every((b) => withdrawals.includes(b.bookingId));
  const dayStart = Date.parse(zonedIso(selectedDay, 0, zone));
  // Trimming keeps the larger part of the time off: it starts after the booking
  // (the booking is near its start) or ends before it (near its end).
  const startsAfter = (b: BookingAffect) =>
    Date.parse(zonedIso(selectedDay, end, zone)) - Date.parse(b.endsAt) >=
    Date.parse(b.startsAt) - Date.parse(zonedIso(selectedDay, start, zone));
  const trim = (b: BookingAffect) => {
    const next = startsAfter(b)
      ? { from: Math.ceil((Date.parse(b.endsAt) - dayStart) / 60_000), to: end }
      : {
          from: start,
          to: Math.floor((Date.parse(b.startsAt) - dayStart) / 60_000),
        };
    setStart(next.from);
    setEnd(next.to);
    const nextWindows = draftWindows(next.from, next.to);
    invalidate();
    if (nextWindows) preview.mutate(nextWindows);
    else
      setBanner({
        tone: "warn",
        title: "No time off left",
        body: "Trimming around this booking leaves no time off. Choose other times.",
      });
  };
  const canDecide = gate.motion === "parked_confirmed";

  return (
    <Screen
      title="Time off"
      subtitle={zoneNote(zone)}
      onBack={nav.goBack}
      bg="bg2"
    >
      <ActionBanner banner={banner} />
      <Card testID={FLEET_TID.timeOffForm} style={{ gap: 10 }}>
        <Text variant="caption" tone="text2">
          Only you can set this. Your fleet sees it as “Unavailable”, never why.
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {days.map((key) => (
              <Chip
                key={key}
                testID={dynamicTestId(FLEET_TID.timeOffDay, key)}
                label={dayOfKey(key, zone)}
                selected={key === selectedDay}
                onPress={() => {
                  setDay(key);
                  invalidate();
                }}
              />
            ))}
          </View>
        </ScrollView>
        <Stepper
          label="From"
          value={dayOfKey(selectedDay, zone) + " · " + clockOf(start)}
          earlierID={FLEET_TID.timeOffStartEarlier}
          laterID={FLEET_TID.timeOffStartLater}
          onEarlier={
            start - STEP >= 0
              ? () => {
                  setStart(start - STEP);
                  invalidate();
                }
              : null
          }
          onLater={
            start + STEP < end
              ? () => {
                  setStart(start + STEP);
                  invalidate();
                }
              : null
          }
        />
        <Stepper
          label="To"
          value={
            (end >= 24 * 60
              ? dayOfKey(
                  localDateKey(zonedIso(selectedDay, end, zone), zone),
                  zone,
                )
              : dayOfKey(selectedDay, zone)) +
            " · " +
            clockOf(end)
          }
          earlierID={FLEET_TID.timeOffEndEarlier}
          laterID={FLEET_TID.timeOffEndLater}
          onEarlier={
            end - STEP > start
              ? () => {
                  setEnd(end - STEP);
                  invalidate();
                }
              : null
          }
          onLater={
            end + STEP <= MAX_END
              ? () => {
                  setEnd(end + STEP);
                  invalidate();
                }
              : null
          }
        />
      </Card>
      {earlierSaved ? (
        <Card tone="warn" style={{ gap: 4 }}>
          <Text variant="bodySmStrong">You saved availability before</Text>
          <Text variant="caption" tone="text2">
            This app can’t read those saved rules yet, so saving here replaces
            them with this time off.
          </Text>
          <Toggle
            testID={FLEET_TID.timeOffReplace}
            label="Replace what I saved before"
            value={replace}
            onChange={(v) => {
              setReplace(v);
              invalidate();
            }}
          />
        </Card>
      ) : null}
      {gate.motion !== "parked_confirmed" ? (
        <MotionLock
          gate={gate}
          waiting="Setting time off is a decision."
          deadline={null}
          zone={zone}
        />
      ) : null}
      {gate.motion === "moving" ? null : (
        <>
          <Button
            testID={FLEET_TID.timeOffCheck}
            label={preview.isPending ? "Checking with UBI…" : "Check with UBI"}
            kind="secondary"
            disabled={!windows || (earlierSaved && !replace) || !canDecide}
            loading={preview.isPending}
            onPress={() => windows && preview.mutate(windows)}
          />
          {checked ? (
            <Card testID={FLEET_TID.timeOffPreview} style={{ gap: 8 }}>
              <Text variant="label" tone="text2">
                {"Checked by UBI · " + timeIn(checked.preview.checkedAt, zone)}
              </Text>
              {checked.preview.affects.length === 0 ? (
                <Text variant="bodySm">
                  No clash with your shifts or bookings.
                </Text>
              ) : null}
              {shifts.map((s) =>
                s.kind === "shift" ? (
                  <View key={s.assignmentId} style={{ gap: 4 }}>
                    <Text variant="bodySmStrong">Signed shift</Text>
                    <StateTag
                      label={"Hours reduced · " + s.lostHours + " h"}
                      tone="warn"
                    />
                  </View>
                ) : null,
              )}
              {bookings.map((b) => {
                const chosen = withdrawals.includes(b.bookingId);
                const atStart = startsAfter(b);
                return (
                  <View key={b.bookingId} style={{ gap: 6 }}>
                    <Text variant="bodySmStrong">
                      {"Booking " + rangeIn(b.startsAt, b.endsAt, zone)}
                    </Text>
                    <StateTag label="Conflicts" tone="error" />
                    {canDecide ? (
                      <>
                        <Button
                          testID={dynamicTestId(
                            FLEET_TID.timeOffTrim,
                            b.bookingId,
                          )}
                          label={
                            (atStart
                              ? "Start time off at " + timeIn(b.endsAt, zone)
                              : "End time off at " + timeIn(b.startsAt, zone)) +
                            ". Keep the booking"
                          }
                          kind="secondary"
                          size="md"
                          onPress={() => trim(b)}
                        />
                        <Button
                          testID={dynamicTestId(
                            FLEET_TID.timeOffWithdrawal,
                            b.bookingId,
                          )}
                          label={
                            chosen
                              ? "Withdraw chosen · tap to undo"
                              : "Keep " +
                                clockOf(start) +
                                " and withdraw the booking"
                          }
                          kind={chosen ? "inverse" : "secondary"}
                          size="md"
                          accessibilityLabel={
                            chosen
                              ? "Withdrawal chosen. Tap to undo"
                              : "Keep the time off and withdraw the booking"
                          }
                          onPress={() =>
                            setWithdrawals((w) =>
                              chosen
                                ? w.filter((id) => id !== b.bookingId)
                                : [...w, b.bookingId],
                            )
                          }
                        />
                      </>
                    ) : null}
                    <Text variant="caption" tone="text2">
                      {b.outcome.commissionReturned ? (
                        <>
                          {"If you withdraw: "}
                          <MoneyText
                            money={b.outcome.commissionReturned}
                            variant="caption"
                          />
                          {
                            " returned to your wallet · the rider’s funding is released · no penalty"
                          }
                        </>
                      ) : (
                        "If you withdraw: your commission is returned to your wallet · the rider’s funding is released · no penalty"
                      )}
                    </Text>
                  </View>
                );
              })}
            </Card>
          ) : null}
          <Button
            testID={FLEET_TID.timeOffSave}
            label="Save time off"
            disabled={!checked || !allChosen || !canDecide}
            loading={save.isPending}
            onPress={() =>
              checked && save.mutate({ checked, withdrawals: [...withdrawals] })
            }
          />
          {checked && !allChosen ? (
            <Text variant="caption" tone="text2">
              Choose for each booking first: trim the time off, or withdraw.
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Stepper({
  label,
  value,
  earlierID,
  laterID,
  onEarlier,
  onLater,
}: {
  label: string;
  value: string;
  earlierID: string;
  laterID: string;
  onEarlier: (() => void) | null;
  onLater: (() => void) | null;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Text variant="caption" tone="text2">
          {label}
        </Text>
        <Text variant="bodyStrong" accessibilityLabel={label + " " + value}>
          {value}
        </Text>
      </View>
      <Button
        testID={earlierID}
        label="−"
        accessibilityLabel={label + ": 30 minutes earlier"}
        kind="secondary"
        size="md"
        disabled={!onEarlier}
        onPress={onEarlier ?? undefined}
        style={{ width: 52 }}
      />
      <Button
        testID={laterID}
        label="+"
        accessibilityLabel={label + ": 30 minutes later"}
        kind="secondary"
        size="md"
        disabled={!onLater}
        onPress={onLater ?? undefined}
        style={{ width: 52 }}
      />
    </View>
  );
}
