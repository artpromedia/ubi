// C1 DriverSchedule (A05 fleet calendar, handoff C1). One agenda per local day from
// GET /v1/drivers/me/schedule — the driver's own availability and time off, the signed
// shift, maintenance on the vehicle that shift uses, and the driver's own bookings —
// composed by fleet-service (decisions correction 7), never merged here. A decision
// banner leads to what needs the driver: booking conflicts (the server's alerts, each
// with its deadline) and pending fleet proposals. While the driver is moving the
// banner becomes the C2b lock: what is waiting and the earliest deadline, no entry.
//
// Every block and badge prints its word (colour is never the only signal); times are
// the city's wall clock with the zone named. No money on this screen.
import React, { useMemo } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Screen, Text } from "@ubi/mobile-ui";
import { dynamicTestId } from "@ubi/contracts";
import { fleetApi, type FleetScheduleItem } from "../../api/fleet";
import { useMotionGate } from "../../lib/motion";
import {
  LoadFailure,
  LoadingBlocks,
  StateTag,
  type TagTone,
} from "../marketplace/TripParts";
import { FleetUnavailable, FreshnessBanner, MotionLock } from "./FleetParts";
import {
  SCHEDULE_KIND_TEXT,
  dayIn,
  decisionTitle,
  earliest,
  isFleetUnavailable,
  isOffline,
  localDateKey,
  rangeIn,
  spokenRange,
  timeIn,
  waitingLine,
  zoneNote,
} from "./fleetCopy";
import { FLEET_LOAD_TIDS, FLEET_TID } from "./testIds";

export const SCHEDULE_KEY = ["fleet", "schedule"] as const;
export const OFFERS_KEY = ["fleet", "offers"] as const;

const KIND_TONE: Record<FleetScheduleItem["kind"], TagTone> = {
  availability: "neutral",
  time_off: "neutral",
  shift: "ok",
  maintenance: "warn",
  booking: "info",
};

type Nav = {
  navigate: (name: string, params?: unknown) => void;
  goBack: () => void;
};

export function FleetScheduleScreen() {
  const nav = useNavigation<Nav>();
  const gate = useMotionGate();
  const scheduleQ = useQuery({
    queryKey: SCHEDULE_KEY,
    queryFn: fleetApi.schedule,
    refetchInterval: 60_000,
    retry: false,
  });
  const offersQ = useQuery({
    queryKey: OFFERS_KEY,
    queryFn: fleetApi.offers,
    refetchInterval: 60_000,
    retry: false,
  });
  const schedule = scheduleQ.data;
  const zone = schedule?.zone ?? null;
  const pending = useMemo(
    () =>
      (offersQ.data?.offers ?? []).filter(
        (o) => o.status === "pending_signature",
      ),
    [offersQ.data],
  );
  const days = useMemo(() => {
    const groups = new Map<string, FleetScheduleItem[]>();
    for (const item of schedule?.items ?? []) {
      const key = localDateKey(item.startsAt, zone);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [schedule, zone]);

  if (!schedule) {
    return (
      <Screen title="My schedule" onBack={nav.goBack} bg="bg2">
        {scheduleQ.isError ? (
          isFleetUnavailable(scheduleQ.error) ? (
            <FleetUnavailable />
          ) : (
            <LoadFailure
              offline={isOffline(scheduleQ.error)}
              title="We couldn’t load your schedule"
              body="Try again."
              onRetry={() => void scheduleQ.refetch()}
              testIDs={FLEET_LOAD_TIDS}
            />
          )
        ) : (
          <LoadingBlocks heights={[56, 120, 120]} />
        )}
      </Screen>
    );
  }

  const bookingDecisions = schedule.alerts.length;
  const deadline = earliest(
    ...schedule.alerts.map((a) => a.deadlineAt),
    ...pending.map((o) => o.expiresAt),
  );
  const firstAlert = schedule.alerts[0];
  const openFirst = () => {
    if (firstAlert)
      nav.navigate("FleetConflict", { conflictId: firstAlert.conflictId });
    else if (pending[0])
      nav.navigate("FleetProposal", { offerId: pending[0].offerId });
  };
  const waiting = bookingDecisions + pending.length;

  return (
    <Screen
      title="My schedule"
      subtitle={zoneNote(zone)}
      onBack={nav.goBack}
      bg="bg2"
      footer={
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button
            testID={FLEET_TID.timeOffEntry}
            label="Set time off"
            kind="secondary"
            size="md"
            style={{ flex: 1 }}
            onPress={() => nav.navigate("FleetAvailability")}
          />
          <Button
            testID={FLEET_TID.reportEntry}
            label="Report a problem"
            kind="secondary"
            size="md"
            accessibilityLabel="Report a vehicle problem"
            style={{ flex: 1 }}
            onPress={() => nav.navigate("FleetReportIssue")}
          />
        </View>
      }
    >
      <FreshnessBanner
        failed={scheduleQ.isError}
        offline={isOffline(scheduleQ.error)}
        asOf={schedule.asOf}
        zone={zone}
      />
      {waiting > 0 ? (
        gate.motion === "moving" ? (
          <MotionLock
            gate={gate}
            waiting={waitingLine(bookingDecisions, pending.length)}
            deadline={deadline}
            zone={zone}
          />
        ) : (
          <Card
            testID={FLEET_TID.decisionBanner}
            tone="warn"
            style={{ gap: 4 }}
          >
            <Text variant="bodyStrong" accessibilityRole="header">
              {decisionTitle(bookingDecisions, pending.length)}
            </Text>
            {deadline ? (
              <Text variant="caption" tone="warnInk">
                {"Decide by " +
                  timeIn(deadline, zone) +
                  " · " +
                  dayIn(deadline, zone)}
              </Text>
            ) : null}
            <Button
              label={firstAlert ? "Review booking" : "Review proposal"}
              accessibilityLabel={
                (firstAlert ? "Review booking" : "Review proposal") +
                (deadline ? ", decide by " + timeIn(deadline, zone) : "")
              }
              kind="secondary"
              size="md"
              onPress={openFirst}
            />
          </Card>
        )
      ) : null}
      {pending.length > 0 && firstAlert && gate.motion !== "moving" ? (
        <Button
          testID={FLEET_TID.proposalEntry}
          label={
            pending.length === 1
              ? "Review the proposal from " + pending[0].fleet.name
              : "Review " + pending.length + " proposals"
          }
          kind="secondary"
          size="md"
          onPress={() => nav.navigate("FleetProposal")}
        />
      ) : null}
      <View testID={FLEET_TID.scheduleView} style={{ gap: 14 }}>
        {days.length === 0 ? (
          <View
            testID={FLEET_TID.scheduleEmpty}
            style={{ paddingVertical: 24, gap: 4 }}
          >
            <Text variant="bodyStrong" align="center">
              Nothing scheduled this week
            </Text>
            <Text variant="bodySm" tone="text2" align="center">
              Your shifts, bookings and time off will show here.
            </Text>
          </View>
        ) : (
          days.map(([key, items]) => (
            <View
              key={key}
              testID={dynamicTestId(FLEET_TID.scheduleDay, key)}
              style={{ gap: 8 }}
            >
              <Text variant="label" tone="text2" accessibilityRole="header">
                {dayIn(items[0].startsAt, zone)}
              </Text>
              {items.map((item) => (
                <ScheduleRow
                  key={item.itemId}
                  item={item}
                  zone={zone}
                  onOpen={
                    item.conflictId && gate.motion !== "moving"
                      ? () =>
                          nav.navigate("FleetConflict", {
                            conflictId: item.conflictId,
                          })
                      : null
                  }
                />
              ))}
            </View>
          ))
        )}
      </View>
    </Screen>
  );
}

function ScheduleRow({
  item,
  zone,
  onOpen,
}: {
  item: FleetScheduleItem;
  zone: string | null;
  onOpen: (() => void) | null;
}) {
  const atRisk = item.risk === "at_risk";
  const kind = SCHEDULE_KIND_TEXT[item.kind];
  const spoken =
    kind +
    ", " +
    item.label +
    ", " +
    spokenRange(item.startsAt, item.endsAt, zone) +
    (atRisk
      ? ", at risk" +
        (item.decisionDeadline
          ? ", decide by " + timeIn(item.decisionDeadline, zone)
          : "")
      : "");
  return (
    <Card
      testID={dynamicTestId(FLEET_TID.scheduleItem, item.itemId)}
      tone={atRisk ? "error" : "default"}
      style={{ gap: 6 }}
    >
      <View accessible accessibilityLabel={spoken} style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text variant="mono" style={{ flex: 1 }}>
            {rangeIn(item.startsAt, item.endsAt, zone)}
          </Text>
          <StateTag label={kind} tone={KIND_TONE[item.kind]} />
        </View>
        <Text variant="bodySm">{item.label}</Text>
      </View>
      {atRisk ? (
        <View style={{ gap: 6 }}>
          <StateTag
            label={
              "At risk" +
              (item.decisionDeadline
                ? " · decide by " + timeIn(item.decisionDeadline, zone)
                : "")
            }
            tone="error"
          />
          {onOpen ? (
            <Button
              label="Decide"
              kind="secondary"
              size="md"
              accessibilityLabel={"Decide about the booking " + item.label}
              onPress={onOpen}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
