// A02 rider trip (design handoff flow 7, RouteAmendment + stops) — presentational.
// Shows the COMMITTED agreement (original fare + committed adjustments = agreed fare, as
// the server reconciles it), the stops with server-measured waiting, an open route change
// as a PROPOSAL (original vs proposed route, added distance/time, server-priced revised
// total, top-up funding status, approvals, expiry) with the rule that the original
// agreement stays in force until it commits, extra-waiting approval and a safe early end.
// Every amount is a server Money object rendered through MoneyText.
import React from "react";
import { View } from "react-native";
import {
  Banner,
  Button,
  Card,
  MoneyText,
  Row,
  Screen,
  Sheet,
  Text,
} from "@ubi/mobile-ui";
import { accessibleMoney, type Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { Refusal, Staleness, Tone } from "./riderCopy";
import {
  RouteList,
  StaleBanner,
  StateTag,
  type RoutePoint,
} from "./riderParts";

const TID = TEST_IDS.mp.rider.trip;

export type TripAmendmentCard = {
  amendmentId: string;
  statusLabel: string;
  statusTone: Tone;
  proposer: string;
  originalRoute: string;
  proposedRoute: string;
  addedDistance: string;
  addedTime: string;
  priorMinor: Money;
  revisedMinor: Money;
  fareDeltaMinor: Money;
  deltaSentence: string;
  fundingText: string;
  fundingDeltaMinor: Money;
  approvalsText: string;
  expiryLabel: string | null;
  decision: {
    canApprove: boolean;
    canReject: boolean;
    busy: "approve" | "reject" | null;
    onApprove: () => void;
    onReject: () => void;
    note: string | null;
  } | null;
};

export type TripStopRow = {
  stopId: string;
  point: RoutePoint;
  statusText: string;
  waiting: {
    waited: string;
    waitedSpoken: string;
    included: string;
    feeMinor: Money;
    accruing: boolean;
    settlementText: string;
    approvalRequired: boolean;
    excessive: boolean;
  } | null;
  approveWaiting: {
    busy: boolean;
    onApprove: () => void;
    increaseMinor: Money;
    perMinMinor: Money;
  } | null;
  skip: { busy: boolean; onSkip: () => void } | null;
};

export type TripHistoryRow = {
  amendmentId: string;
  title: string;
  statusLabel: string;
  statusTone: Tone;
  outcome: string;
  deltaMinor: Money | null;
};

export type TripProps = {
  agreedFareMinor: Money;
  originalFareMinor: Money;
  adjustments: { key: string; label: string; deltaMinor: Money }[];
  route: RoutePoint[];
  stops: TripStopRow[];
  waitingTerms: {
    perMinMinor: Money;
    authorizedCapMinor: Money;
    committedMinor: Money;
  } | null;
  pending: TripAmendmentCard[];
  history: TripHistoryRow[];
  banner: (Refusal & { tone: "ok" | "warn" | "error" }) | null;
  terminated: string | null;
  propose: { onPropose: () => void } | null;
  proposeNote: string | null;
  terminate: {
    open: boolean;
    busy: boolean;
    onOpen: () => void;
    onCancel: () => void;
    onConfirm: () => void;
  } | null;
  stale: Staleness;
  /** The completed ride's receipt (the server answers "not yet" until it exists). */
  onReceipt?: (() => void) | null;
  onBack: () => void;
};

export function TripScreen(p: TripProps) {
  return (
    <Screen
      title="Your trip"
      subtitle="Stops, waiting and route changes"
      onBack={p.onBack}
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        <StaleBanner stale={p.stale} testIDs={TID} />
        {p.banner ? (
          <Banner
            testID={TID.banner}
            tone={p.banner.tone}
            title={p.banner.title}
            body={p.banner.body}
          />
        ) : null}
        {p.terminated ? (
          <Banner
            testID={TID.terminated}
            tone="info"
            title="Trip ended early"
            body={p.terminated}
          />
        ) : null}
        <Card>
          <Row
            testID={TID.fare}
            label="Agreed fare now"
            value={<MoneyText money={p.agreedFareMinor} variant="heading" />}
          />
          <Row
            testID={TID.original}
            label="Original agreement"
            value={
              <MoneyText money={p.originalFareMinor} variant="bodySmStrong" />
            }
            last={p.adjustments.length === 0}
          />
          {p.adjustments.map((a, i) => (
            <Row
              key={a.key}
              testID={dynamicTestId(TID.adjustment, a.key)}
              label={a.label}
              value={
                <MoneyText money={a.deltaMinor} signed variant="bodySmStrong" />
              }
              last={i === p.adjustments.length - 1}
            />
          ))}
          <Text variant="caption" tone="text3" style={{ marginTop: 6 }}>
            Only changes you both committed appear here. Your final receipt is
            the original agreement plus these lines.
          </Text>
        </Card>
        {p.pending.map((a) => (
          <Card
            key={a.amendmentId}
            testID={dynamicTestId(TID.amendment, a.amendmentId)}
            tone="warn"
            style={{ gap: 8 }}
          >
            <Text variant="label" tone="text3">
              Route change · proposal
            </Text>
            <StateTag
              testID={dynamicTestId(TID.amendmentState, a.amendmentId)}
              label={a.statusLabel}
              tone={a.statusTone}
            />
            <Text variant="caption" tone="text2">
              {a.proposer}
            </Text>
            <Banner
              testID={TID.inForce}
              tone="info"
              body="Your current agreement stays in force until this change commits. Nothing is charged unless both of you approve."
            />
            <Row label="Original route" value={a.originalRoute} />
            <Row
              testID={TID.proposedRoute}
              label="Proposed route"
              value={a.proposedRoute}
            />
            <Row
              testID={TID.addedDistance}
              label="Added distance"
              value={a.addedDistance}
            />
            <Row
              testID={TID.addedTime}
              label="Added time"
              value={a.addedTime}
            />
            <Row
              label="Current fare"
              value={<MoneyText money={a.priorMinor} variant="bodySmStrong" />}
            />
            <Row
              testID={TID.revisedTotal}
              label="Revised total (priced by UBI)"
              value={<MoneyText money={a.revisedMinor} variant="heading" />}
            />
            <Row
              testID={TID.fareDelta}
              label={a.deltaSentence}
              value={
                <MoneyText
                  money={a.fareDeltaMinor}
                  signed
                  variant="bodySmStrong"
                />
              }
            />
            <View testID={TID.funding} style={{ gap: 2 }}>
              <Row
                label="Extra from your payment"
                value={
                  <MoneyText
                    money={a.fundingDeltaMinor}
                    signed
                    variant="bodySmStrong"
                  />
                }
                last
              />
              <Text variant="caption" tone="text2">
                {a.fundingText}
              </Text>
            </View>
            <Text testID={TID.approvals} variant="caption" tone="text2">
              {a.approvalsText}
            </Text>
            {a.expiryLabel ? (
              <Text testID={TID.expiry} variant="caption" tone="warnInk">
                {a.expiryLabel}
              </Text>
            ) : null}
            {a.decision ? (
              <View style={{ gap: 8 }}>
                {a.decision.note ? (
                  <Text variant="caption" tone="text2">
                    {a.decision.note}
                  </Text>
                ) : null}
                {a.decision.canApprove ? (
                  <Button
                    testID={TID.approve}
                    label="Approve this change"
                    loading={a.decision.busy === "approve"}
                    disabled={a.decision.busy !== null}
                    onPress={a.decision.onApprove}
                  />
                ) : null}
                {a.decision.canReject ? (
                  <Button
                    testID={TID.reject}
                    label="Keep the original"
                    kind="secondary"
                    loading={a.decision.busy === "reject"}
                    disabled={a.decision.busy !== null}
                    onPress={a.decision.onReject}
                  />
                ) : null}
              </View>
            ) : null}
          </Card>
        ))}
        <Card style={{ gap: 10 }}>
          <Text variant="label" tone="text3">
            Your route
          </Text>
          <RouteList testID={TID.route} points={p.route} />
        </Card>
        {p.stops.map((s) => (
          <Card
            key={s.stopId}
            testID={dynamicTestId(TID.stop, s.stopId)}
            style={{ gap: 6 }}
          >
            <Text variant="bodySmStrong">{s.point.label}</Text>
            <Text variant="caption" tone="text2">
              {s.point.detail}
            </Text>
            <Text
              testID={dynamicTestId(TID.stopStatus, s.stopId)}
              variant="bodySm"
            >
              {s.statusText}
            </Text>
            {s.waiting ? (
              <View
                testID={dynamicTestId(TID.waiting, s.stopId)}
                accessible
                // A grouped element is read by its label ONLY: the paid-waiting amount,
                // its settlement and the cap/long-wait notices must all be in it.
                accessibilityLabel={[
                  "Waited " + s.waiting.waitedSpoken,
                  "Included in your fare " + s.waiting.included,
                  (s.waiting.accruing
                    ? "Paid waiting so far "
                    : "Paid waiting ") + accessibleMoney(s.waiting.feeMinor),
                  s.waiting.settlementText,
                  s.waiting.approvalRequired
                    ? "Your approved waiting limit is reached. Nothing more is charged unless you approve more"
                    : "",
                  s.waiting.excessive
                    ? "This has been a long wait — your driver may leave this stop"
                    : "",
                ]
                  .filter(Boolean)
                  .join(". ")}
                style={{ gap: 2 }}
              >
                <Row label="Waited" value={s.waiting.waited} />
                <Row label="Included in your fare" value={s.waiting.included} />
                <Row
                  testID={dynamicTestId(TID.waitingFee, s.stopId)}
                  label={
                    s.waiting.accruing ? "Paid waiting so far" : "Paid waiting"
                  }
                  value={
                    <MoneyText
                      money={s.waiting.feeMinor}
                      variant="bodySmStrong"
                    />
                  }
                  last
                />
                <Text variant="caption" tone="text2">
                  {s.waiting.settlementText}
                </Text>
                {s.waiting.approvalRequired ? (
                  <Text
                    testID={dynamicTestId(TID.waitingCap, s.stopId)}
                    variant="caption"
                    tone="warnInk"
                  >
                    Your approved waiting limit is reached. Nothing more is
                    charged unless you approve more.
                  </Text>
                ) : null}
                {s.waiting.excessive ? (
                  <Text variant="caption" tone="warnInk">
                    This has been a long wait — your driver may leave this stop.
                  </Text>
                ) : null}
              </View>
            ) : null}
            {s.approveWaiting ? (
              <View style={{ gap: 4 }}>
                <View
                  style={{ flexDirection: "row", gap: 6, alignItems: "center" }}
                >
                  <Text variant="caption" tone="text2">
                    Up to
                  </Text>
                  <MoneyText
                    money={s.approveWaiting.increaseMinor}
                    variant="caption"
                  />
                  <Text variant="caption" tone="text2">
                    more at
                  </Text>
                  <MoneyText
                    money={s.approveWaiting.perMinMinor}
                    variant="caption"
                  />
                  <Text variant="caption" tone="text2">
                    per minute
                  </Text>
                </View>
                <Button
                  testID={dynamicTestId(TID.approveWaiting, s.stopId)}
                  label="Approve more waiting"
                  size="md"
                  loading={s.approveWaiting.busy}
                  onPress={s.approveWaiting.onApprove}
                />
              </View>
            ) : null}
            {s.skip ? (
              <Button
                testID={dynamicTestId(TID.skip, s.stopId)}
                label="Skip this stop"
                accessibilityLabel={
                  "Skip " +
                  s.point.label +
                  ". Skipping doesn’t lower your fare."
                }
                kind="secondary"
                size="md"
                loading={s.skip.busy}
                onPress={s.skip.onSkip}
              />
            ) : null}
          </Card>
        ))}
        {p.waitingTerms ? (
          <Card>
            <Text variant="label" tone="text3">
              Waiting at stops
            </Text>
            <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
              The wait you expected at each stop is already in your fare. After
              that, waiting is paid per minute — only up to the limit you’ve
              approved for this trip.
            </Text>
            <Row
              label="Per minute after the included wait"
              value={
                <MoneyText
                  money={p.waitingTerms.perMinMinor}
                  variant="bodySmStrong"
                />
              }
            />
            <Row
              label="Your approved limit"
              value={
                <MoneyText
                  money={p.waitingTerms.authorizedCapMinor}
                  variant="bodySmStrong"
                />
              }
            />
            <Row
              label="Waiting added to your fare"
              value={
                <MoneyText
                  money={p.waitingTerms.committedMinor}
                  variant="bodySmStrong"
                />
              }
              last
            />
          </Card>
        ) : null}
        {p.propose ? (
          <Button
            testID={TID.propose}
            label="Propose a route change"
            kind="secondary"
            onPress={p.propose.onPropose}
          />
        ) : null}
        {p.proposeNote ? (
          <Text variant="caption" tone="text2">
            {p.proposeNote}
          </Text>
        ) : null}
        {p.terminate ? (
          <Button
            testID={TID.terminate}
            label="End the trip here"
            kind="danger"
            onPress={p.terminate.onOpen}
          />
        ) : null}
        {p.history.length ? (
          <Card testID={TID.history} style={{ gap: 8 }}>
            <Text variant="label" tone="text3">
              Earlier changes
            </Text>
            {p.history.map((h) => (
              <View key={h.amendmentId} style={{ gap: 4 }}>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Text variant="bodySmStrong" style={{ flex: 1 }}>
                    {h.title}
                  </Text>
                  {h.deltaMinor ? (
                    <MoneyText
                      money={h.deltaMinor}
                      signed
                      variant="bodySmStrong"
                    />
                  ) : null}
                </View>
                <StateTag label={h.statusLabel} tone={h.statusTone} />
                <Text variant="caption" tone="text2">
                  {h.outcome}
                </Text>
              </View>
            ))}
          </Card>
        ) : null}
        {p.onReceipt ? (
          <Button
            testID={TID.receipt}
            label="Receipt"
            kind="ghost"
            onPress={p.onReceipt}
          />
        ) : null}
      </View>
      {p.terminate ? (
        <Sheet visible={p.terminate.open} onDismiss={p.terminate.onCancel}>
          <View style={{ gap: 10 }}>
            <Text variant="title">End the trip here?</Text>
            <Text variant="bodySm" tone="text2">
              Your driver ends the trip where the car is now. Stops you haven’t
              reached are skipped. Waiting already earned at a stop is kept.
            </Text>
            <Text variant="bodySm" tone="text2">
              Your fare goes down by the part of the route you won’t travel,
              priced by UBI with the same pricing as your agreement — never
              below the minimum for the distance you did travel. You’ll see the
              adjusted fare here once it’s confirmed.
            </Text>
            <Button
              testID={TID.terminateConfirm}
              label="End the trip here"
              kind="danger"
              loading={p.terminate.busy}
              onPress={p.terminate.onConfirm}
            />
            <Button
              testID={TID.terminateCancel}
              label="Keep going"
              kind="secondary"
              onPress={p.terminate.onCancel}
            />
          </View>
        </Sheet>
      ) : null}
    </Screen>
  );
}
