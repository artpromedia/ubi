// C5 ReportVehicleIssue (A05 fleet calendar, handoff C5; decisions Q5 and Q8). The
// driver on a fleet vehicle reports, while stationary:
//  - "Can't drive: breakdown" → POST /v1/drivers/me/vehicle-issues {cannot_drive}: the
//    vehicle is marked off-road at once, the fleet is alerted, and each of the driver's
//    upcoming bookings on it asks for a decision (C3) — they're put at risk, never
//    cancelled. Lost hours follow the shortfall rule in the signed terms; a breakdown
//    is NOT pro-rated (Q8 overrides the handoff's "pro-rated" line).
//  - "Can drive, needs service soon" → {service_soon}: the fleet is alerted to plan a
//    service; the vehicle stays on the road and no booking changes.
// Only the driver the fleet's signed arrangement assigns to the vehicle today may
// report (the server checks). For personal safety the screen points to SOS — this
// form only reports the vehicle. Neutral copy; a caller-held Idempotency-Key.
import React, { useMemo, useState } from "react";
import { TextInput, View, type TextStyle } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Banner,
  Button,
  Card,
  Chip,
  Screen,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import { track } from "@ubi/mobile-core";
import { dynamicTestId } from "@ubi/contracts";
import {
  fleetApi,
  type FleetArrangement,
  type VehicleIssueSeverity,
  type VehicleIssueView,
} from "../../api/fleet";
import type { RootStackParamList } from "../../navigation/routes";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { useMotionGate } from "../../lib/motion";
import { LoadFailure, LoadingBlocks } from "../marketplace/TripParts";
import { ActionBanner, FleetUnavailable, MotionLock } from "./FleetParts";
import {
  dateTimeIn,
  fleetRefusal,
  isFleetUnavailable,
  isOffline,
  shiftText,
  timeIn,
  type Refusal,
} from "./fleetCopy";
import { SCHEDULE_KEY } from "./FleetScheduleScreen";
import { FLEET_LOAD_TIDS, FLEET_TID } from "./testIds";

type Nav = {
  navigate: (name: string, params?: unknown) => void;
  goBack: () => void;
};
type BannerState = (Refusal & { tone: "error" | "warn" | "ok" }) | null;

export const ARRANGEMENTS_KEY = ["fleet", "arrangements"] as const;
const LIVE = new Set(["active", "notice"]);

const WHAT_HAPPENS: Record<VehicleIssueSeverity, string[]> = {
  cannot_drive: [
    "Your fleet is alerted right away, and the vehicle is marked off-road.",
    "Upcoming bookings on this vehicle will ask you to choose: another vehicle, or withdraw with no penalty.",
    "Lost hours count under the shortfall rule in your signed terms.",
  ],
  service_soon: [
    "Your fleet is alerted to plan a service.",
    "The vehicle stays on the road and your bookings don’t change.",
  ],
};

export function FleetReportIssueScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, "FleetReportIssue">>();
  const t = useTheme();
  const queryClient = useQueryClient();
  const gate = useMotionGate();
  const keys = useIdempotencyKeys("fleetissue");
  const arrangementsQ = useQuery({
    queryKey: ARRANGEMENTS_KEY,
    queryFn: fleetApi.arrangements,
    retry: false,
  });
  const scheduleQ = useQuery({
    queryKey: SCHEDULE_KEY,
    queryFn: fleetApi.schedule,
    retry: false,
  });
  const zone = scheduleQ.data?.zone ?? null;
  const vehicles = useMemo(() => {
    const seen = new Map<string, FleetArrangement>();
    for (const a of arrangementsQ.data?.arrangements ?? [])
      if (LIVE.has(a.status) && !seen.has(a.vehicleId))
        seen.set(a.vehicleId, a);
    return [...seen.values()];
  }, [arrangementsQ.data]);
  const [picked, setPicked] = useState<string | null>(
    route.params?.vehicleId ?? null,
  );
  const [severity, setSeverity] = useState<VehicleIssueSeverity | null>(null);
  const [note, setNote] = useState("");
  const [banner, setBanner] = useState<BannerState>(null);
  const [result, setResult] = useState<VehicleIssueView | null>(null);

  const vehicleId =
    picked ?? (vehicles.length === 1 ? vehicles[0].vehicleId : null);
  const print = (v: { vehicleId: string; severity: string; note: string }) =>
    "issue:" + v.vehicleId + ":" + v.severity + ":" + v.note;
  const report = useMutation({
    mutationFn: (v: {
      vehicleId: string;
      severity: VehicleIssueSeverity;
      note: string;
    }) =>
      fleetApi.reportVehicleIssue(
        {
          vehicleId: v.vehicleId,
          severity: v.severity,
          ...(v.note ? { note: v.note } : {}),
        },
        keys.keyFor(print(v)),
      ),
    onSuccess: (view, v) => {
      keys.settle(print(v));
      setResult(view);
      setBanner(null);
      void queryClient.invalidateQueries({ queryKey: SCHEDULE_KEY });
      track("driver_fleet_vehicle_issue_reported", { severity: v.severity });
    },
    onError: (e, v) => {
      keys.settle(print(v), e);
      setBanner({
        ...fleetRefusal(e, zone),
        tone: isOffline(e) ? "warn" : "error",
      });
    },
  });

  const sos = (
    <Card style={{ gap: 8 }}>
      <Text variant="bodySm">
        If you’re unsafe, use the SOS button. This form only reports the
        vehicle.
      </Text>
      <Button
        testID={FLEET_TID.reportSos}
        label="SOS"
        kind="danger"
        size="md"
        accessibilityLabel="Open SOS for personal safety"
        onPress={() => nav.navigate("Sos")}
      />
    </Card>
  );

  if (result) {
    const breakdown = result.severity === "cannot_drive";
    return (
      <Screen title="Report a vehicle problem" onBack={nav.goBack} bg="bg2">
        <Card testID={FLEET_TID.reportOutcome} tone="ok" style={{ gap: 6 }}>
          <Text variant="bodyStrong">
            {breakdown ? "Breakdown reported" : "Sent to your fleet"}
          </Text>
          <Text variant="bodySm">
            {breakdown
              ? "Your fleet has been alerted and the vehicle is marked off-road."
              : "Your fleet has been asked to plan a service. The vehicle stays on the road."}
          </Text>
          <Text variant="caption" tone="text2">
            {"Reported " + dateTimeIn(result.reportedAt, zone)}
          </Text>
          {breakdown ? (
            <Text variant="caption" tone="text2">
              Lost hours count under the shortfall rule in your signed terms.
            </Text>
          ) : null}
        </Card>
        {result.decisions.map((d) => (
          <Card
            key={d.conflictId}
            testID={dynamicTestId(FLEET_TID.reportDecision, d.conflictId)}
            tone="warn"
            style={{ gap: 6 }}
          >
            <Text variant="bodySmStrong">A booking needs your decision</Text>
            {d.deadlineAt ? (
              <Text variant="caption" tone="warnInk">
                {"Decide by " + timeIn(d.deadlineAt, zone)}
              </Text>
            ) : null}
            <Button
              label="Decide"
              kind="secondary"
              size="md"
              onPress={() =>
                nav.navigate("FleetConflict", { conflictId: d.conflictId })
              }
            />
          </Card>
        ))}
        {sos}
      </Screen>
    );
  }

  if (!arrangementsQ.data) {
    return (
      <Screen title="Report a vehicle problem" onBack={nav.goBack} bg="bg2">
        {arrangementsQ.isError ? (
          isFleetUnavailable(arrangementsQ.error) ? (
            <FleetUnavailable />
          ) : (
            <LoadFailure
              offline={isOffline(arrangementsQ.error)}
              title="We couldn’t load your vehicle"
              body="Try again."
              onRetry={() => void arrangementsQ.refetch()}
              testIDs={FLEET_LOAD_TIDS}
            />
          )
        ) : (
          <LoadingBlocks heights={[80, 160]} />
        )}
        {sos}
      </Screen>
    );
  }

  const ready = vehicleId !== null && severity !== null;
  return (
    <Screen title="Report a vehicle problem" onBack={nav.goBack} bg="bg2">
      <ActionBanner banner={banner} />
      <View testID={FLEET_TID.reportVehicle} style={{ gap: 8 }}>
        {vehicles.length === 0 ? (
          <Card>
            <Text variant="bodyStrong">No fleet vehicle assigned to you</Text>
            <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
              You can report a problem with a fleet vehicle while you’re
              assigned to it.
            </Text>
          </Card>
        ) : vehicles.length === 1 ? (
          <Text variant="bodySm" tone="text2">
            {"Your " +
              vehicles[0].fleetName +
              " vehicle · " +
              shiftText(vehicles[0].shift)}
          </Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {vehicles.map((a) => (
              <Chip
                key={a.vehicleId}
                testID={dynamicTestId(FLEET_TID.reportVehicle, a.vehicleId)}
                label={a.fleetName + " · " + shiftText(a.shift)}
                selected={a.vehicleId === vehicleId}
                onPress={() => setPicked(a.vehicleId)}
              />
            ))}
          </View>
        )}
      </View>
      {vehicles.length > 0 ? (
        gate.motion !== "parked_confirmed" ? (
          <MotionLock
            gate={gate}
            waiting="Report a vehicle problem once you’re stopped."
            deadline={null}
            zone={zone}
          />
        ) : (
          <>
            <View style={{ gap: 8 }} accessibilityRole="radiogroup">
              <SeverityCard
                testID={FLEET_TID.reportCannotDrive}
                title="Can’t drive: breakdown"
                selected={severity === "cannot_drive"}
                onPress={() => setSeverity("cannot_drive")}
              />
              <SeverityCard
                testID={FLEET_TID.reportServiceSoon}
                title="Can drive, needs service soon"
                selected={severity === "service_soon"}
                onPress={() => setSeverity("service_soon")}
              />
            </View>
            {severity ? (
              <Card style={{ gap: 4 }}>
                <Text variant="label" tone="text2">
                  What happens
                </Text>
                {WHAT_HAPPENS[severity].map((line) => (
                  <Text key={line} variant="bodySm">
                    {"• " + line}
                  </Text>
                ))}
              </Card>
            ) : null}
            <View style={{ gap: 4 }}>
              <Text variant="caption" tone="text2">
                Note for your fleet (optional)
              </Text>
              <TextInput
                testID={FLEET_TID.reportNote}
                accessibilityLabel="Note for your fleet, optional"
                value={note}
                onChangeText={(v) => setNote(v.slice(0, 280))}
                maxLength={280}
                multiline
                placeholder="What’s wrong with the vehicle?"
                placeholderTextColor={t.colors.text3}
                style={[
                  t.type.bodySm as TextStyle,
                  {
                    color: t.colors.text,
                    minHeight: 64,
                    borderWidth: 1,
                    borderColor: t.colors.border,
                    borderRadius: t.radius.control,
                    padding: 10,
                  },
                ]}
              />
            </View>
            <Button
              testID={FLEET_TID.reportIssue}
              label={
                severity === "service_soon"
                  ? "Tell my fleet"
                  : "Report breakdown"
              }
              kind={severity === "service_soon" ? "primary" : "danger"}
              disabled={!ready}
              loading={report.isPending}
              onPress={() =>
                vehicleId &&
                severity &&
                report.mutate({ vehicleId, severity, note: note.trim() })
              }
            />
            {!ready ? (
              <Banner
                tone="neutral"
                body={
                  vehicleId === null
                    ? "Choose the vehicle, then what’s wrong."
                    : "Choose what’s wrong with the vehicle."
                }
              />
            ) : null}
          </>
        )
      ) : null}
      {sos}
    </Screen>
  );
}

function SeverityCard({
  testID,
  title,
  selected,
  onPress,
}: {
  testID: string;
  title: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      testID={testID}
      label={(selected ? "● " : "○ ") + title}
      accessibilityLabel={title + (selected ? ", selected" : "")}
      kind={selected ? "inverse" : "secondary"}
      onPress={onPress}
    />
  );
}
