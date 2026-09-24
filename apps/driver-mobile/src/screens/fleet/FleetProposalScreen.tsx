// C2 FleetProposalReview + C2b motion lock (A05 fleet calendar, handoff C2/C2b).
//
// GET /v1/drivers/me/fleet-offers lists the fleet's pending proposals with the terms
// diff against the driver's current arrangement and UBI's own check. The driver:
//  - accepts by signing with the wallet PIN — POST /v1/fleet-offers/{id}/sign {pin};
//    fleet-service relays the PIN to user-service's wallet-PIN check and never stores
//    it. Wrong PIN, lockout, no PIN set, an expired offer or a shift clash come back
//    as plain refusals; nothing is signed on any refusal;
//  - declines — POST /v1/fleet-offers/{id}/decline, no body and no reason: no penalty,
//    no score, and the fleet only ever sees "declined".
// Both are decisions: they render only while the server has the driver as parked
// (C2b). Each POST carries a caller-held Idempotency-Key; the PIN is never part of
// the key's fingerprint and is cleared from memory as soon as it is sent.
//
// Money: the weekly remittance is the signed terms' own amount (server Money through
// MoneyText); a percent_of_net share prints the server's percentage. Nothing is
// computed, and the driver's past earnings on the vehicle are "Not enough data" until
// a real source exists (the server says why).
import React, { useMemo, useRef, useState } from "react";
import { View } from "react-native";
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
  MoneyText,
  Row,
  Screen,
  Text,
} from "@ubi/mobile-ui";
import { track } from "@ubi/mobile-core";
import { dynamicTestId } from "@ubi/contracts";
import {
  fleetApi,
  remittanceOf,
  type FleetOffer,
  type FleetSignedOffer,
  type FleetTerms,
} from "../../api/fleet";
import type { RootStackParamList } from "../../navigation/routes";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { useMotionGate } from "../../lib/motion";
import { LoadFailure, LoadingBlocks, StateTag } from "../marketplace/TripParts";
import {
  ActionBanner,
  FleetUnavailable,
  FreshnessBanner,
  MotionLock,
  PinPad,
} from "./FleetParts";
import {
  TERM_FIELD_TEXT,
  dateTimeIn,
  earliest,
  fleetRefusal,
  isFleetUnavailable,
  isOffline,
  offerCheckText,
  percentText,
  shiftText,
  shortfallText,
  waitingLine,
  whoPays,
  zoneNote,
  type Refusal,
} from "./fleetCopy";
import { OFFERS_KEY, SCHEDULE_KEY } from "./FleetScheduleScreen";
import { FLEET_LOAD_TIDS, FLEET_TID } from "./testIds";

type Nav = {
  navigate: (name: string, params?: unknown) => void;
  goBack: () => void;
};
type BannerState = (Refusal & { tone: "error" | "warn" | "ok" }) | null;
type Outcome =
  | { kind: "signed"; fleetName: string; signed: FleetSignedOffer }
  | { kind: "declined"; fleetName: string };

export function FleetProposalScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, "FleetProposal">>();
  const queryClient = useQueryClient();
  const gate = useMotionGate();
  const keys = useIdempotencyKeys("fleetoffer");
  const offersQ = useQuery({
    queryKey: OFFERS_KEY,
    queryFn: fleetApi.offers,
    retry: false,
  });
  // The schedule names the city's zone and the booking deadlines the lock shows.
  const scheduleQ = useQuery({
    queryKey: SCHEDULE_KEY,
    queryFn: fleetApi.schedule,
    retry: false,
  });
  const zone = scheduleQ.data?.zone ?? null;
  const [chosen, setChosen] = useState<string | null>(
    route.params?.offerId ?? null,
  );
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState("");
  // The PIN rides a ref, never the mutation's variables: React Query keeps a
  // mutation's variables in its cache until gcTime, so passing the PIN there would
  // keep it in memory long after it was sent. The ref is emptied as the request is
  // built.
  const pinToSend = useRef("");
  const [banner, setBanner] = useState<BannerState>(null);
  // A refused signature is shown on the PIN pad itself, which stays open.
  const [pinError, setPinError] = useState<BannerState>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const pending = useMemo(
    () =>
      (offersQ.data?.offers ?? [])
        .filter((o) => o.status === "pending_signature")
        .sort(
          (a, b) =>
            Date.parse(a.expiresAt ?? "9999") -
            Date.parse(b.expiresAt ?? "9999"),
        ),
    [offersQ.data],
  );
  const offer =
    pending.find((o) => o.offerId === chosen) ??
    (pending.length === 1 ? pending[0] : undefined);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: OFFERS_KEY });
    void queryClient.invalidateQueries({ queryKey: SCHEDULE_KEY });
    void queryClient.invalidateQueries({ queryKey: ["fleet", "arrangements"] });
  };

  const sign = useMutation({
    mutationFn: (v: { offer: FleetOffer }) => {
      const entered = pinToSend.current;
      pinToSend.current = "";
      return fleetApi.signOffer(
        v.offer.offerId,
        entered,
        keys.keyFor("sign:" + v.offer.offerId),
      );
    },
    onSuccess: (signed, v) => {
      keys.settle("sign:" + v.offer.offerId);
      setPin("");
      setPinOpen(false);
      setPinError(null);
      setOutcome({ kind: "signed", fleetName: v.offer.fleet.name, signed });
      track("driver_fleet_offer_signed", { offerId: v.offer.offerId });
      refreshAll();
    },
    onError: (e, v) => {
      keys.settle("sign:" + v.offer.offerId, e);
      setPin("");
      setPinError({
        ...fleetRefusal(e, zone),
        tone: isOffline(e) ? "warn" : "error",
      });
      if (!isOffline(e)) void offersQ.refetch();
    },
  });
  const decline = useMutation({
    mutationFn: (o: FleetOffer) =>
      fleetApi.declineOffer(o.offerId, keys.keyFor("decline:" + o.offerId)),
    onSuccess: (_, o) => {
      keys.settle("decline:" + o.offerId);
      setBanner(null);
      setOutcome({ kind: "declined", fleetName: o.fleet.name });
      track("driver_fleet_offer_declined", { offerId: o.offerId });
      refreshAll();
    },
    onError: (e, o) => {
      keys.settle("decline:" + o.offerId, e);
      setBanner({
        ...fleetRefusal(e, zone),
        tone: isOffline(e) ? "warn" : "error",
      });
      if (!isOffline(e)) void offersQ.refetch();
    },
  });

  if (outcome) {
    return (
      <Screen title="Fleet proposal" onBack={nav.goBack} bg="bg2">
        <Card testID={FLEET_TID.proposalOutcome} tone="ok" style={{ gap: 6 }}>
          {outcome.kind === "signed" ? (
            <>
              <Text variant="bodyStrong">Signed with your PIN</Text>
              <Text variant="bodySm">
                {"Your arrangement with " +
                  outcome.fleetName +
                  " starts " +
                  outcome.signed.arrangement.validFrom +
                  "."}
              </Text>
              <Text variant="caption" tone="text2">
                {"Terms v" +
                  outcome.signed.signature.termsVersion +
                  " · signed " +
                  dateTimeIn(outcome.signed.signature.signedAt, zone)}
              </Text>
            </>
          ) : (
            <>
              <Text variant="bodyStrong">Declined</Text>
              <Text variant="bodySm">
                {"Nothing changes and there is no penalty. " +
                  outcome.fleetName +
                  " only sees “declined”."}
              </Text>
            </>
          )}
        </Card>
        <Button
          label="Back to my schedule"
          kind="secondary"
          onPress={() => nav.navigate("FleetSchedule")}
        />
      </Screen>
    );
  }

  if (!offersQ.data) {
    return (
      <Screen title="Fleet proposal" onBack={nav.goBack} bg="bg2">
        {offersQ.isError ? (
          isFleetUnavailable(offersQ.error) ? (
            <FleetUnavailable />
          ) : (
            <LoadFailure
              offline={isOffline(offersQ.error)}
              title="We couldn’t load your proposals"
              body="Try again."
              onRetry={() => void offersQ.refetch()}
              testIDs={FLEET_LOAD_TIDS}
            />
          )
        ) : (
          <LoadingBlocks heights={[80, 220]} />
        )}
      </Screen>
    );
  }

  const deadline = earliest(
    ...pending.map((o) => o.expiresAt),
    ...(scheduleQ.data?.alerts ?? []).map((a) => a.deadlineAt),
  );
  const lock = (
    <MotionLock
      gate={gate}
      waiting={waitingLine(scheduleQ.data?.alerts.length ?? 0, pending.length)}
      deadline={deadline}
      zone={zone}
    />
  );

  return (
    <Screen
      title={offer ? "Proposal from " + offer.fleet.name : "Fleet proposals"}
      subtitle={zoneNote(zone)}
      onBack={nav.goBack}
      bg="bg2"
    >
      <FreshnessBanner
        failed={offersQ.isError}
        offline={isOffline(offersQ.error)}
        asOf={null}
        zone={zone}
      />
      <ActionBanner banner={banner} />
      {pending.length === 0 ? (
        <View
          testID={FLEET_TID.proposalEmpty}
          style={{ paddingVertical: 24, gap: 4 }}
        >
          <Text variant="bodyStrong" align="center">
            No proposals waiting
          </Text>
          <Text variant="bodySm" tone="text2" align="center">
            When a fleet sends you one, it appears here. Nothing is signed until
            you sign it.
          </Text>
        </View>
      ) : !offer ? (
        // Several open: the moving driver sees only the lock (C2b), never details.
        gate.motion === "moving" ? (
          lock
        ) : (
          pending.map((o) => (
            <Card
              key={o.offerId}
              testID={dynamicTestId(FLEET_TID.proposalCard, o.offerId)}
              style={{ gap: 6 }}
            >
              <Text variant="bodyStrong">
                {"Proposal from " + o.fleet.name}
              </Text>
              {o.expiresAt ? (
                <Text variant="caption" tone="text2">
                  {"Expires " + dateTimeIn(o.expiresAt, zone)}
                </Text>
              ) : null}
              <Button
                label="Review"
                kind="secondary"
                size="md"
                accessibilityLabel={"Review the proposal from " + o.fleet.name}
                onPress={() => setChosen(o.offerId)}
              />
            </Card>
          ))
        )
      ) : gate.motion === "moving" ? (
        lock
      ) : (
        <>
          <OfferDetail offer={offer} zone={zone} />
          {lock}
          {gate.motion === "parked_confirmed" ? (
            pinOpen ? (
              <Card style={{ gap: 12 }}>
                <Text variant="bodyStrong" accessibilityRole="header">
                  Enter your wallet PIN to sign
                </Text>
                <Text variant="caption" tone="text2">
                  UBI checks it once to record your signature. It’s never stored
                  or shown to your fleet.
                </Text>
                <PinPad
                  length={pin.length}
                  disabled={sign.isPending}
                  onDigit={(d) => setPin((p) => (p.length < 6 ? p + d : p))}
                  onDelete={() => setPin((p) => p.slice(0, -1))}
                />
                {pinError ? (
                  <Banner
                    testID={FLEET_TID.pinError}
                    tone={pinError.tone}
                    title={pinError.title}
                    body={pinError.body}
                  />
                ) : null}
                <Button
                  testID={FLEET_TID.signPin}
                  label="Sign"
                  accessibilityLabel="Sign the proposal with your PIN"
                  disabled={pin.length < 4}
                  loading={sign.isPending}
                  onPress={() => {
                    setPinError(null);
                    pinToSend.current = pin;
                    sign.mutate({ offer });
                  }}
                />
                <Button
                  testID={FLEET_TID.pinCancel}
                  label="Cancel"
                  kind="ghost"
                  size="md"
                  onPress={() => {
                    setPin("");
                    setPinError(null);
                    setPinOpen(false);
                  }}
                />
              </Card>
            ) : (
              <View style={{ gap: 10 }}>
                <Button
                  testID={FLEET_TID.proposalAccept}
                  label="Accept & sign with PIN"
                  disabled={decline.isPending}
                  onPress={() => {
                    setBanner(null);
                    setPinOpen(true);
                  }}
                />
                <Button
                  testID={FLEET_TID.proposalDecline}
                  label="Decline, no penalty"
                  kind="secondary"
                  loading={decline.isPending}
                  onPress={() => {
                    setBanner(null);
                    decline.mutate(offer);
                  }}
                />
              </View>
            )
          ) : null}
        </>
      )}
    </Screen>
  );
}

function RemittanceValue({ terms }: { terms: FleetTerms }) {
  const weekly = remittanceOf(terms);
  return weekly ? (
    <Text variant="bodySmStrong">
      <MoneyText money={weekly} variant="bodySmStrong" />
      {" / week"}
    </Text>
  ) : (
    <Text variant="bodySmStrong">{percentText(terms)}</Text>
  );
}

function OfferDetail({
  offer,
  zone,
}: {
  offer: FleetOffer;
  zone: string | null;
}) {
  const changed = new Map(offer.diff.map((d) => [d.field, d.material]));
  const tag = (field: FleetOffer["diff"][number]["field"]) =>
    changed.has(field) ? (
      <StateTag
        label={changed.get(field) ? "Changes · needs your PIN" : "Changes"}
        tone="warn"
      />
    ) : null;
  const check = offerCheckText(offer.check);
  const current = offer.current;
  return (
    <>
      {offer.expiresAt ? (
        <Text testID={FLEET_TID.proposalExpiry} variant="caption" tone="text2">
          {"Expires " +
            dateTimeIn(offer.expiresAt, zone) +
            " · unanswered, it simply lapses"}
        </Text>
      ) : null}
      <Card testID={FLEET_TID.proposalTerms} style={{ gap: 2 }}>
        <Row
          label={TERM_FIELD_TEXT.vehicle}
          value={
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text variant="bodySmStrong">
                {offer.vehicle.plate +
                  " · " +
                  offer.vehicle.make +
                  " " +
                  offer.vehicle.model}
              </Text>
              {tag("vehicle")}
            </View>
          }
        />
        <Row
          label={TERM_FIELD_TEXT.shift}
          value={
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text variant="bodySmStrong">{shiftText(offer.shift)}</Text>
              {current && changed.has("shift") ? (
                <Text variant="caption" tone="text2">
                  {"Was " + shiftText(current.shift)}
                </Text>
              ) : null}
              {tag("shift")}
            </View>
          }
        />
        <Row
          label={TERM_FIELD_TEXT.validity}
          value={
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text variant="bodySmStrong">
                {"From " +
                  offer.validFrom +
                  (offer.validTo ? " to " + offer.validTo : " · no end date")}
              </Text>
              {tag("validity")}
            </View>
          }
        />
        <Row
          label={TERM_FIELD_TEXT.remittance}
          value={
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <RemittanceValue terms={offer.terms} />
              {current && changed.has("remittance") ? (
                <Text variant="caption" tone="text2">
                  {"Was "}
                  <RemittanceValue terms={current.terms} />
                </Text>
              ) : null}
              {tag("remittance")}
            </View>
          }
        />
        <Row
          label={TERM_FIELD_TEXT.shortfall}
          value={
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text variant="bodySmStrong">{shortfallText(offer.terms)}</Text>
              {tag("shortfall")}
            </View>
          }
        />
        <Row
          label={TERM_FIELD_TEXT.fuelBy}
          value={
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text variant="bodySmStrong">
                {whoPays(offer.terms.fuelBy, "fuel")}
              </Text>
              {tag("fuelBy")}
            </View>
          }
        />
        <Row
          label={TERM_FIELD_TEXT.servicingBy}
          value={
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Text variant="bodySmStrong">
                {whoPays(offer.terms.servicingBy, "servicing")}
              </Text>
              {tag("servicingBy")}
            </View>
          }
        />
        <Row
          label="UBI commission"
          value="10% of each fare, from your wallet"
        />
        <Row
          label="Past earnings on this vehicle"
          value="Not enough data"
          valueTone="text2"
          last
        />
        <Text variant="caption" tone="text2">
          {offer.historicEarningsReason}
        </Text>
      </Card>
      <Banner
        testID={FLEET_TID.proposalCheck}
        tone={check.tone === "ok" ? "ok" : "warn"}
        body={check.text}
      />
      <Text variant="caption" tone="text2">
        If you decline, nothing changes and there is no penalty. Your fleet only
        sees “declined”.
      </Text>
    </>
  );
}
