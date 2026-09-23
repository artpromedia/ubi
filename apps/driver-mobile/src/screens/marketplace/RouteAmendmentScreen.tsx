// A02 "RouteAmendment" (design handoff A01 flow 7): a post-award route change is a
// PROPOSAL — the original agreement stays in force until both parties approve the exact
// revision. The card shows original vs proposed route, the server's added distance/time,
// revised total, fare change, the incremental commission (captured once on an increase,
// refunded as a linked adjustment on a decrease), the driver's net change, the rider's
// funding status and the approval expiry. Approve / reject / propose render ONLY while
// the server acknowledges the driver as parked; while moving the details and countdown
// are replaced by "Stop safely to review" (no controls, no timer pressure). Rejecting
// carries no penalty.
import React from "react";
import { View } from "react-native";
import {
  Banner,
  Button,
  Card,
  MoneyText,
  Row,
  Screen,
  Text,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { dynamicTestId } from "@ubi/contracts";
import type { MotionState } from "../../lib/motion";
import { MP_DRIVER_TID } from "./testIds";
import { StateTag, StopSafelyGate, type TagTone } from "./TripParts";
import type { Refusal, Staleness } from "./tripCopy";

const TID = MP_DRIVER_TID.amend;

export type AmendmentDecision = {
  canApprove: boolean;
  canReject: boolean;
  busy: "approve" | "reject" | null;
  onApprove: () => void;
  onReject: () => void;
  note: string | null;
};
export type AmendmentCardView = {
  amendmentId: string;
  proposerText: string;
  statusText: string;
  statusTone: TagTone;
  originalRoute: string;
  proposedRoute: string;
  addedDistance: string;
  addedTime: string;
  priorMinor: Money;
  revisedMinor: Money;
  fareDeltaMinor: Money;
  commissionDeltaMinor: Money | null;
  commissionNote: string;
  netDeltaMinor: Money | null;
  /** Colour follows the server figure's sign (the sign is also printed). */
  netTone: "ok" | "errorInk" | "text";
  riderFundingText: string;
  riderFundingDeltaMinor: Money;
  approvalsText: string;
  expiryLabel: string | null;
  decision: AmendmentDecision | null;
};
export type AmendmentHistoryRow = {
  amendmentId: string;
  title: string;
  statusText: string;
  statusTone: TagTone;
  outcome: string;
  /** Committed changes only: the fare delta that is now in force. */
  deltaMinor: Money | null;
};
export type ProposeComposer = {
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  stops: { key: string; label: string; detail: string }[];
  onRemove: (key: string) => void;
  onUp: (key: string) => void;
  onDown: (key: string) => void;
  changed: boolean;
  busy: boolean;
  onSend: () => void;
  remainingCount: number;
};
export type RouteAmendmentProps = {
  motion: MotionState;
  parked: { confirming: boolean; error: string | null; onConfirm: () => void };
  agreedFareMinor: Money;
  pending: AmendmentCardView[];
  history: AmendmentHistoryRow[];
  banner: null | (Refusal & { tone: "error" | "warn" | "ok" });
  composer: ProposeComposer | null;
  /** Why proposing is not offered right now (e.g. a change is already open). */
  proposeNote: string | null;
  stale: Staleness;
  onBack: () => void;
};

function AmendmentCard({ a }: { a: AmendmentCardView }) {
  return (
    <Card
      testID={dynamicTestId(TID.card, a.amendmentId)}
      emphasis
      style={{ gap: 6 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          Route change · proposal
        </Text>
        <StateTag label={a.statusText} tone={a.statusTone} />
      </View>
      <Text variant="caption" tone="text2">
        {a.proposerText +
          ". Your agreed trip stays in force until both of you approve."}
      </Text>
      <View testID={TID.original} style={{ gap: 2 }}>
        <Text variant="label" tone="text2">
          Original route (in force)
        </Text>
        <Text variant="bodySm">{a.originalRoute}</Text>
      </View>
      <View testID={TID.proposed} style={{ gap: 2 }}>
        <Text variant="label" tone="text2">
          Proposed route
        </Text>
        <Text variant="bodySm">{a.proposedRoute}</Text>
      </View>
      <Row
        testID={TID.addedDistance}
        label="Distance"
        value={a.addedDistance}
      />
      <Row testID={TID.addedTime} label="Time" value={a.addedTime} />
      <Row
        label="Current total"
        value={<MoneyText money={a.priorMinor} variant="bodySmStrong" />}
      />
      <Row
        testID={TID.revisedTotal}
        label="Revised total"
        value={<MoneyText money={a.revisedMinor} variant="heading" />}
      />
      <Row
        testID={TID.fareDelta}
        label="Fare change"
        value={
          <MoneyText money={a.fareDeltaMinor} signed variant="bodySmStrong" />
        }
      />
      {a.commissionDeltaMinor ? (
        <Row
          testID={TID.commissionDelta}
          label="Commission change (10%)"
          value={
            <MoneyText
              money={a.commissionDeltaMinor}
              signed
              variant="bodySmStrong"
            />
          }
        />
      ) : null}
      <Text variant="caption" tone="text3">
        {a.commissionNote}
      </Text>
      {a.netDeltaMinor ? (
        <Row
          testID={TID.netChange}
          label="Your net change"
          value={
            <MoneyText
              money={a.netDeltaMinor}
              signed
              variant="bodySmStrong"
              tone={a.netTone}
            />
          }
        />
      ) : null}
      <Row
        testID={TID.riderFunding}
        label={"Rider funding · " + a.riderFundingText}
        value={
          <MoneyText
            money={a.riderFundingDeltaMinor}
            signed
            variant="bodySmStrong"
          />
        }
      />
      <Text variant="caption" tone="text2">
        {a.approvalsText}
      </Text>
      {a.expiryLabel ? (
        <Text testID={TID.expiry} variant="caption" tone="warnInk" tabular>
          {a.expiryLabel}
        </Text>
      ) : null}
      {a.decision ? (
        <>
          {a.decision.note ? (
            <Text variant="caption" tone="text2">
              {a.decision.note}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            {a.decision.canReject ? (
              <Button
                testID={TID.reject}
                label="Reject"
                kind="secondary"
                size="md"
                loading={a.decision.busy === "reject"}
                disabled={a.decision.busy === "approve"}
                onPress={a.decision.onReject}
                style={{ flex: 1 }}
              />
            ) : null}
            {a.decision.canApprove ? (
              <Button
                testID={TID.approve}
                label="Approve change"
                size="md"
                loading={a.decision.busy === "approve"}
                disabled={a.decision.busy === "reject"}
                onPress={a.decision.onApprove}
                style={{ flex: 1 }}
              />
            ) : null}
          </View>
          {a.decision.canReject ? (
            <Text testID={TID.noPenalty} variant="caption" tone="text2">
              Rejecting carries no penalty. The original agreement stays in
              force.
            </Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

function Composer({ c }: { c: ProposeComposer }) {
  if (!c.open)
    return (
      <Button
        testID={TID.propose}
        label="Propose a route change"
        kind="secondary"
        onPress={c.onOpen}
      />
    );
  return (
    <Card style={{ gap: 8 }}>
      <Text variant="bodyStrong">Propose a route change</Text>
      {c.remainingCount === 0 ? (
        <Text variant="caption" tone="text2">
          There are no remaining stops to change. The rider can change the
          destination from their app.
        </Text>
      ) : (
        <>
          <Text variant="caption" tone="text2">
            Reorder or remove the stops not reached yet. The server prices the
            change and checks your next job before anything is held; the rider
            must approve it too. Until then your agreed trip stays as it is.
          </Text>
          {c.stops.map((s, i) => (
            <View
              key={s.key}
              testID={dynamicTestId(TID.proposeStop, s.key)}
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              <View style={{ flex: 1 }}>
                <Text variant="bodySmStrong">{i + 1 + ". " + s.label}</Text>
                <Text variant="caption" tone="text3">
                  {s.detail}
                </Text>
              </View>
              <Button
                testID={dynamicTestId(TID.proposeUp, s.key)}
                label="Up"
                accessibilityLabel={"Move " + s.label + " earlier"}
                kind="ghost"
                size="md"
                disabled={i === 0}
                onPress={() => c.onUp(s.key)}
              />
              <Button
                testID={dynamicTestId(TID.proposeDown, s.key)}
                label="Down"
                accessibilityLabel={"Move " + s.label + " later"}
                kind="ghost"
                size="md"
                disabled={i === c.stops.length - 1}
                onPress={() => c.onDown(s.key)}
              />
              <Button
                testID={dynamicTestId(TID.proposeRemove, s.key)}
                label="Remove"
                accessibilityLabel={"Remove " + s.label}
                kind="ghost"
                size="md"
                onPress={() => c.onRemove(s.key)}
              />
            </View>
          ))}
          {c.stops.length === 0 ? (
            <Text variant="caption" tone="text2">
              All remaining stops removed — the trip would go straight to the
              dropoff.
            </Text>
          ) : null}
        </>
      )}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button
          testID={TID.proposeCancel}
          label="Cancel"
          kind="secondary"
          size="md"
          onPress={c.onCancel}
          style={{ flex: 1 }}
        />
        {c.remainingCount > 0 ? (
          <Button
            testID={TID.proposeSend}
            label="Send proposal"
            size="md"
            disabled={!c.changed}
            loading={c.busy}
            onPress={c.onSend}
            style={{ flex: 1 }}
          />
        ) : null}
      </View>
    </Card>
  );
}

export function RouteAmendmentScreen(p: RouteAmendmentProps) {
  const parked = p.motion === "parked_confirmed";
  const moving = p.motion === "moving";
  return (
    <Screen
      title="Route changes"
      subtitle="Proposals only — nothing changes until both of you approve"
      onBack={p.onBack}
      bg="bg2"
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        {p.banner ? (
          <Banner
            testID={TID.refusal}
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
            body="Showing the last changes the server sent. We’ll keep trying."
          />
        ) : null}
        {p.stale === "offline" ? (
          <Banner
            testID={TID.offline}
            tone="warn"
            title="You’re offline"
            body="Showing the last changes the server sent. Decisions are sent when you reconnect — retrying is safe."
          />
        ) : null}
        <Card>
          <Row
            label="Agreed fare (in force)"
            value={<MoneyText money={p.agreedFareMinor} variant="heading" />}
            last
          />
        </Card>
        {!parked ? (
          <StopSafelyGate
            motion={p.motion}
            title="Stop safely to review"
            body={
              p.pending.length
                ? "A change to this trip is waiting. Fare changes are never decided while you’re driving — an unanswered proposal simply expires, with no penalty."
                : "Proposing a change affects the fare, so it’s only possible while you’re parked."
            }
            confirming={p.parked.confirming}
            error={p.parked.error}
            onConfirm={p.parked.onConfirm}
            testID={TID.stopSafely}
            parkedTestID={TID.parked}
          />
        ) : null}
        {moving
          ? null
          : p.pending.map((a) => <AmendmentCard key={a.amendmentId} a={a} />)}
        {parked && p.composer ? <Composer c={p.composer} /> : null}
        {parked && !p.composer && p.proposeNote ? (
          <Text variant="caption" tone="text2">
            {p.proposeNote}
          </Text>
        ) : null}
        {!p.pending.length && !p.history.length ? (
          <Card testID={TID.empty}>
            <Text variant="bodyStrong">No changes proposed</Text>
            <Text variant="caption" tone="text2">
              If the rider proposes a route change it appears here for you to
              review once you’re parked. Your agreed trip stays as it is.
            </Text>
          </Card>
        ) : null}
        {p.history.length ? (
          <>
            <Text variant="label" tone="text2">
              Earlier changes
            </Text>
            {p.history.map((h) => (
              <Card
                key={h.amendmentId}
                testID={dynamicTestId(TID.outcome, h.amendmentId)}
                style={{ gap: 4 }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <Text variant="bodySmStrong" style={{ flex: 1 }}>
                    {h.title}
                  </Text>
                  <StateTag label={h.statusText} tone={h.statusTone} />
                </View>
                <Text variant="caption" tone="text2">
                  {h.outcome}
                </Text>
                {h.deltaMinor ? (
                  <Row
                    label="Fare change in force"
                    value={
                      <MoneyText
                        money={h.deltaMinor}
                        signed
                        variant="bodySmStrong"
                      />
                    }
                    last
                  />
                ) : null}
              </Card>
            ))}
          </>
        ) : null}
      </View>
    </Screen>
  );
}
