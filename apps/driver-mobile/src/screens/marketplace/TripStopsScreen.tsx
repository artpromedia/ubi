// A02 "Driver waiting" (design handoff A01 flow 7): the executing trip's ordered stops
// with server-authoritative arrive / depart / skip, the waiting clock against the
// included allowance, paid waiting and the rider-authorized cap — every figure from
// GET /v1/mp/requests/:id/trip, rendered verbatim — plus the safe early-termination
// entry point. Fare decisions (ending early) render only once the server acknowledged
// the driver as parked; arrivals stay geofenced by the server whatever the client shows.
import React from "react";
import { View } from "react-native";
import {
  Banner,
  Button,
  Card,
  Chip,
  MoneyText,
  Row,
  Screen,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { dynamicTestId } from "@ubi/contracts";
import type { MotionState } from "../../lib/motion";
import type { MpTerminationReason } from "../../api/marketplace";
import { MP_DRIVER_TID } from "./testIds";
import { StateTag, StopSafelyGate, type TagTone } from "./TripParts";
import {
  TERMINATION_REASONS,
  clock,
  moneySign,
  spokenDuration,
  type Refusal,
  type Staleness,
} from "./tripCopy";

const TID = MP_DRIVER_TID.trip;

export type StopWaitingView = {
  waitedSec: number;
  includedSec: number;
  allowanceRemainingSec: number;
  paidSec: number;
  feeMinor: Money;
  accruing: boolean;
  approvalRequired: boolean;
  excessive: boolean;
};
export type TripStopRow = {
  stopId: string;
  order: number;
  label: string;
  purposeLabel: string;
  dwellLabel: string;
  statusText: string;
  statusTone: TagTone;
  /** The server recorded the arrival outside its geofence (never starts paid waiting). */
  disputed: null | { distanceLabel: string | null };
  /** Live waiting (arrived) — server figures as of the last read. */
  waiting: StopWaitingView | null;
  /** After departure: how the stop's waiting settled. */
  settlementText: string | null;
  /** The last arrival attempt the server refused, with its evidence. */
  arrivalRefusal: Refusal | null;
  actions: {
    arrive: "arrive" | "confirm" | null;
    depart: boolean;
    skip: boolean;
  };
  busy: boolean;
};
export type TripStopsProps = {
  pickupLabel: string;
  dropoffLabel: string;
  fare: {
    originalMinor: Money;
    agreedMinor: Money;
    commissionMinor: Money | null;
    adjustments: { id: string; label: string; deltaMinor: Money }[];
  };
  terms: {
    perMinMinor: Money;
    authorizedCapMinor: Money;
    maxAuthorizedMinor: Money;
    committedMinor: Money;
  };
  stops: TripStopRow[];
  onArrive: (stopId: string, disputed: boolean) => void;
  onDepart: (stopId: string) => void;
  onSkip: (stopId: string) => void;
  openAmendment: null | { onReview: () => void };
  onChanges: null | (() => void);
  termination: null | {
    motion: MotionState;
    parked: {
      confirming: boolean;
      error: string | null;
      onConfirm: () => void;
    };
    open: boolean;
    onOpen: () => void;
    onCancel: () => void;
    reason: MpTerminationReason | null;
    onReason: (code: MpTerminationReason) => void;
    onConfirm: () => void;
    busy: boolean;
  };
  terminated: boolean;
  banner: null | (Refusal & { tone: "error" | "warn" | "ok" });
  /** A refetch failed while this copy is on screen: say it may be old. */
  stale: Staleness;
  onBack: () => void;
};

function WaitingPanel({
  stopId,
  waiting,
  capMinor,
}: {
  stopId: string;
  waiting: StopWaitingView;
  capMinor: Money;
}) {
  return (
    <View testID={dynamicTestId(TID.waiting, stopId)} style={{ gap: 2 }}>
      <Text
        testID={dynamicTestId(TID.waited, stopId)}
        variant="heading"
        tabular
        accessibilityLabel={"Waiting " + spokenDuration(waiting.waitedSec)}
      >
        {"Waiting · " + clock(waiting.waitedSec)}
      </Text>
      <Row
        testID={dynamicTestId(TID.allowance, stopId)}
        label="Included allowance"
        value={
          clock(waiting.includedSec) +
          " · " +
          clock(waiting.allowanceRemainingSec) +
          " left"
        }
        accessibilityLabel={
          "Included allowance " +
          spokenDuration(waiting.includedSec) +
          ", " +
          spokenDuration(waiting.allowanceRemainingSec) +
          " left"
        }
      />
      <Row
        testID={dynamicTestId(TID.paidWaiting, stopId)}
        label={
          waiting.paidSec > 0
            ? "Paid waiting · " +
              clock(waiting.paidSec) +
              (waiting.accruing ? " · accruing" : "")
            : "Paid waiting"
        }
        value={
          waiting.paidSec > 0 ? (
            <MoneyText money={waiting.feeMinor} variant="bodySmStrong" />
          ) : (
            "starts after the allowance"
          )
        }
      />
      <Row
        testID={dynamicTestId(TID.waitingCap, stopId)}
        label="Rider-authorized cap"
        value={<MoneyText money={capMinor} variant="bodySmStrong" />}
        last
      />
      {waiting.approvalRequired ? (
        <Banner
          testID={dynamicTestId(TID.approvalNeeded, stopId)}
          tone="warn"
          title="Rider approval needed"
          body="The authorized waiting cap is reached. Nothing more accrues unless the rider approves more waiting."
        />
      ) : null}
      {waiting.excessive ? (
        <Banner
          testID={dynamicTestId(TID.excessive, stopId)}
          tone="neutral"
          title="Waiting is now excessive"
          body="You may leave this stop. Waiting you’ve earned still settles."
        />
      ) : null}
    </View>
  );
}

function StopCard({
  row,
  capMinor,
  onArrive,
  onDepart,
  onSkip,
}: {
  row: TripStopRow;
  capMinor: Money;
  onArrive: (stopId: string, disputed: boolean) => void;
  onDepart: (stopId: string) => void;
  onSkip: (stopId: string) => void;
}) {
  return (
    <Card testID={dynamicTestId(TID.stop, row.stopId)} style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {"Stop " + row.order + " · " + row.label}
        </Text>
        <StateTag
          testID={dynamicTestId(TID.stopStatus, row.stopId)}
          label={row.statusText}
          tone={row.statusTone}
        />
      </View>
      <Text variant="caption" tone="text2">
        {row.purposeLabel + " · " + row.dwellLabel}
      </Text>
      {row.disputed ? (
        <Banner
          testID={dynamicTestId(TID.disputed, row.stopId)}
          tone="warn"
          title="Arrival disputed"
          body={
            "The server couldn’t place you inside the stop area" +
            (row.disputed.distanceLabel
              ? " (" + row.disputed.distanceLabel + ")"
              : "") +
            ", so paid waiting hasn’t started. Move closer and confirm your arrival."
          }
        />
      ) : null}
      {row.arrivalRefusal ? (
        <>
          <Banner
            testID={dynamicTestId(TID.notAtStop, row.stopId)}
            tone="error"
            title={row.arrivalRefusal.title}
            body={row.arrivalRefusal.body}
          />
          <Button
            testID={dynamicTestId(TID.arriveDisputed, row.stopId)}
            label="Record arrival as disputed"
            kind="secondary"
            size="md"
            loading={row.busy}
            onPress={() => onArrive(row.stopId, true)}
          />
          <Text variant="caption" tone="text3">
            A disputed arrival is recorded, but paid waiting doesn’t start until
            the server confirms you at the stop.
          </Text>
        </>
      ) : null}
      {row.waiting ? (
        <WaitingPanel
          stopId={row.stopId}
          waiting={row.waiting}
          capMinor={capMinor}
        />
      ) : null}
      {row.settlementText ? (
        <Text variant="caption" tone="text2">
          {row.settlementText}
        </Text>
      ) : null}
      {row.actions.arrive || row.actions.depart || row.actions.skip ? (
        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          {row.actions.arrive ? (
            <Button
              testID={dynamicTestId(TID.arrive, row.stopId)}
              label={
                row.actions.arrive === "confirm"
                  ? "Confirm arrival"
                  : "Arrived at stop"
              }
              size="md"
              loading={row.busy}
              onPress={() => onArrive(row.stopId, false)}
              style={{ flex: 1 }}
            />
          ) : null}
          {row.actions.depart ? (
            <Button
              testID={dynamicTestId(TID.depart, row.stopId)}
              label="Depart stop"
              size="md"
              kind={row.actions.arrive ? "secondary" : "primary"}
              loading={row.busy}
              onPress={() => onDepart(row.stopId)}
              style={{ flex: 1 }}
            />
          ) : null}
          {row.actions.skip ? (
            <Button
              testID={dynamicTestId(TID.skip, row.stopId)}
              label="Leave stop (skip)"
              kind="secondary"
              size="md"
              loading={row.busy}
              onPress={() => onSkip(row.stopId)}
              style={{ flex: 1 }}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export function TripStopsScreen(p: TripStopsProps) {
  const t = useTheme();
  const paidWaitingOffered = moneySign(p.terms.maxAuthorizedMinor) !== 0;
  return (
    <Screen
      title="Trip stops"
      subtitle="Arrivals and waiting are measured by the server"
      onBack={p.onBack}
      bg="bg2"
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        {p.banner ? (
          <Banner
            testID={TID.actionError}
            tone={p.banner.tone}
            title={p.banner.title}
            body={p.banner.body}
          />
        ) : null}
        {p.stale === "error" ? (
          <Banner
            testID={TID.error}
            tone="warn"
            title="Couldn’t refresh"
            body="Showing the last trip the server sent. We’ll keep trying."
          />
        ) : null}
        {p.stale === "offline" ? (
          <Banner
            testID={TID.offline}
            tone="warn"
            title="You’re offline"
            body="Showing the last trip the server sent. Anything you tap is sent when you reconnect — retrying is safe."
          />
        ) : null}
        {p.openAmendment ? (
          <Card testID={TID.amendmentBanner} tone="warn" style={{ gap: 8 }}>
            {/* The trip names only the open change's id — it may be a route proposal
                awaiting approvals or a server adjustment (paid waiting, early end)
                still settling — so the copy stays true for every kind. */}
            <Text variant="bodyStrong">A change to this trip is open</Text>
            <Text variant="caption" tone="text2">
              It’s still being resolved. Your agreed fare stays in force until a
              change commits.
            </Text>
            <Button
              label="Review changes"
              kind="secondary"
              size="md"
              onPress={p.openAmendment.onReview}
            />
          </Card>
        ) : null}

        <Card testID={TID.fare}>
          <Row
            label="Agreed fare"
            value={<MoneyText money={p.fare.agreedMinor} variant="heading" />}
          />
          <Row
            label="Original fare"
            value={
              <MoneyText money={p.fare.originalMinor} variant="bodySmStrong" />
            }
            last={!p.fare.adjustments.length && !p.fare.commissionMinor}
          />
          {p.fare.adjustments.map((a, i) => (
            <Row
              key={a.id}
              testID={dynamicTestId(TID.adjustment, a.id)}
              label={a.label}
              value={
                <MoneyText money={a.deltaMinor} signed variant="bodySmStrong" />
              }
              last={
                i === p.fare.adjustments.length - 1 && !p.fare.commissionMinor
              }
            />
          ))}
          {p.fare.commissionMinor ? (
            <Row
              label="Commission captured (10%, once)"
              value={
                <MoneyText
                  money={p.fare.commissionMinor}
                  variant="bodySmStrong"
                />
              }
              last
            />
          ) : null}
          <Text variant="caption" tone="text3">
            Only committed changes appear here. A proposal never changes your
            fare until both of you approve it.
          </Text>
        </Card>

        <Text variant="label" tone="text2">
          {"Route · " + p.pickupLabel + " → " + p.dropoffLabel}
        </Text>
        {p.stops.length === 0 ? (
          <Card testID={TID.empty}>
            <Text variant="bodyStrong">No stops on this trip</Text>
            <Text variant="caption" tone="text2">
              It goes straight from pickup to dropoff. Waiting at pickup follows
              the usual rules.
            </Text>
          </Card>
        ) : (
          p.stops.map((row) => (
            <StopCard
              key={row.stopId}
              row={row}
              capMinor={p.terms.authorizedCapMinor}
              onArrive={p.onArrive}
              onDepart={p.onDepart}
              onSkip={p.onSkip}
            />
          ))
        )}

        {p.stops.length ? (
          <Card>
            <Text variant="label" tone="text2">
              Paid waiting terms
            </Text>
            {paidWaitingOffered ? (
              <>
                <Row
                  label="After the allowance, per minute"
                  value={
                    <MoneyText
                      money={p.terms.perMinMinor}
                      variant="bodySmStrong"
                    />
                  }
                />
                <Row
                  label="Rider-authorized cap"
                  value={
                    <MoneyText
                      money={p.terms.authorizedCapMinor}
                      variant="bodySmStrong"
                    />
                  }
                />
                <Row
                  label="Waiting committed so far"
                  value={
                    <MoneyText
                      money={p.terms.committedMinor}
                      variant="bodySmStrong"
                    />
                  }
                  last
                />
                <Text variant="caption" tone="text3">
                  Each stop’s included allowance is its expected stop time,
                  already in your fare. Past it, paid waiting accrues up to the
                  cap the rider authorized; beyond that the rider must approve.
                </Text>
              </>
            ) : (
              <Text variant="caption" tone="text2">
                This market has no paid stop waiting: waiting past the included
                allowance isn’t charged.
              </Text>
            )}
          </Card>
        ) : null}

        {p.onChanges ? (
          <Button
            testID={TID.changes}
            label="Route changes"
            kind="secondary"
            onPress={p.onChanges}
          />
        ) : null}

        {p.terminated ? (
          <Card testID={TID.terminated} tone="warn" style={{ gap: 4 }}>
            <Text variant="bodyStrong">Trip ended early</Text>
            <Text variant="caption" tone="text2">
              Stops not reached were skipped. The fare adjustment shows under
              the fare once it’s committed. Complete the ride as usual —
              completion settles exactly the committed fare.
            </Text>
          </Card>
        ) : p.termination ? (
          <Card testID={TID.terminate} style={{ gap: 8 }}>
            <Text variant="bodyStrong">End the trip early</Text>
            {p.termination.motion !== "parked_confirmed" ? (
              <StopSafelyGate
                motion={p.termination.motion}
                title="Stop safely to end the trip early"
                body="Ending a trip changes the fare, so it’s never done while you’re driving."
                confirming={p.termination.parked.confirming}
                error={p.termination.parked.error}
                onConfirm={p.termination.parked.onConfirm}
                testID={TID.stopSafely}
                parkedTestID={TID.parked}
              />
            ) : p.termination.open ? (
              <>
                <Text variant="caption" tone="text2">
                  Ends the trip where you are now. Stops you haven’t reached are
                  skipped and a stop you’re waiting at closes with the waiting
                  you’ve earned. The server lowers the fare by the unvisited
                  remainder under your award’s terms (never below the travelled
                  route’s floor) as one linked adjustment: the matching part of
                  your 10% commission is refunded to you — it’s never charged
                  again. Then complete the ride as usual.
                </Text>
                <Text variant="label" tone="text2">
                  Reason
                </Text>
                <View
                  style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}
                >
                  {TERMINATION_REASONS.map((r) => (
                    <Chip
                      key={r.code}
                      testID={dynamicTestId(TID.terminateReason, r.code)}
                      label={r.label}
                      selected={p.termination?.reason === r.code}
                      onPress={() => p.termination?.onReason(r.code)}
                    />
                  ))}
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Button
                    testID={TID.terminateCancel}
                    label="Keep going"
                    kind="secondary"
                    size="md"
                    onPress={p.termination.onCancel}
                    style={{ flex: 1 }}
                  />
                  <Button
                    testID={TID.terminateConfirm}
                    label="End trip here"
                    kind="danger"
                    size="md"
                    disabled={!p.termination.reason}
                    loading={p.termination.busy}
                    onPress={p.termination.onConfirm}
                    style={{ flex: 1 }}
                  />
                </View>
              </>
            ) : (
              <>
                <Text variant="caption" tone="text2">
                  For a rider who wants to stop here, excessive waiting, a
                  safety concern or a vehicle issue. You’ll see exactly what
                  happens before anything changes.
                </Text>
                <Button
                  label="End trip early…"
                  kind="secondary"
                  size="md"
                  onPress={p.termination.onOpen}
                />
              </>
            )}
          </Card>
        ) : null}
        <View style={{ height: 1, backgroundColor: t.colors.divider }} />
        <Text variant="caption" tone="text3" align="center">
          Fare changes are never decided while you’re driving.
        </Text>
      </View>
    </Screen>
  );
}
