// A06 part B — the requester's view of the passenger they booked for, on THIS request only:
// who rides, who pays, the attestation they made, and where the passenger's trip link stands
// (sent / expired / withdrawn / declined). Never the link or its token. Two controls:
// withdraw the link (always allowed — a safety control) and send a fresh one (bounded by the
// server at 5 links per booking; 429 trip_link_limit says so). Both carry caller-held
// Idempotency-Keys, so a retry after a dropped answer replays instead of texting twice.
import React, { useState } from "react";
import { View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banner, Button, Card, Text } from "@ubi/mobile-ui";
import { track } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import {
  marketplaceApi,
  type MpRequestPassenger,
  type MpRequestSnapshot,
} from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { guestRefusal, passengerLinkStatus } from "./confidenceCopy";
import { inLabel, refusalFor, useNow, whenLabel } from "./riderCopy";
import { StateTag } from "./riderParts";

const TID = TEST_IDS.mp.rider.guest;

export type PassengerLinkCardProps = {
  requestId: string;
  passenger: MpRequestPassenger;
  /** Reissue only while the trip is still ahead (the server re-checks). */
  requestOpen: boolean;
};

export function PassengerLinkCard({
  requestId,
  passenger,
  requestOpen,
}: PassengerLinkCardProps) {
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("guest");
  const now = useNow(30_000);
  // The answer to the rider's own command shows until the next server snapshot arrives
  // (a new passenger object); the snapshot is the authority after that.
  const [local, setLocal] = useState<{
    base: MpRequestPassenger;
    value: MpRequestPassenger;
  } | null>(null);
  const [refusal, setRefusal] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const p = local && local.base === passenger ? local.value : passenger;
  const apply = (next: MpRequestPassenger) => {
    setLocal({ base: passenger, value: next });
    queryClient.setQueryData<MpRequestSnapshot>(
      ["mp", "request", requestId],
      (old) =>
        old ? { ...old, request: { ...old.request, passenger: next } } : old,
    );
  };
  // One key per command; the fingerprint includes the link it acts on.
  const print = (op: string) => op + ":" + (p.accessSentAt ?? "none");
  const reissue = useMutation({
    mutationFn: (fp: string) =>
      marketplaceApi.reissuePassengerAccess(requestId, keys.keyFor(fp)),
    onSuccess: (next, fp) => {
      keys.settle(fp);
      track("mp_passenger_link_reissued", { requestId });
      setRefusal(null);
      setSent("A fresh trip link is on its way to " + next.firstName + ".");
      apply(next);
    },
    onError: (e, fp) => {
      keys.settle(fp, e);
      setSent(null);
      setRefusal(guestRefusal(e) ?? refusalFor(e));
    },
  });
  const revoke = useMutation({
    mutationFn: (fp: string) =>
      marketplaceApi.revokePassengerAccess(requestId, keys.keyFor(fp)),
    onSuccess: (next, fp) => {
      keys.settle(fp);
      track("mp_passenger_link_revoked", { requestId });
      setRefusal(null);
      setSent("The trip link no longer opens this trip.");
      apply(next);
    },
    onError: (e, fp) => {
      keys.settle(fp, e);
      setSent(null);
      setRefusal(refusalFor(e));
    },
  });
  const status = passengerLinkStatus(p);
  const expires = p.accessExpiresAt ? inLabel(p.accessExpiresAt, now) : null;
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
  return (
    <Card testID={TID.link} style={{ gap: 8 }}>
      <Text variant="label" tone="text3">
        Booked for someone else
      </Text>
      <Text variant="bodyStrong">{name}</Text>
      <Text variant="caption" tone="text2">
        {p.phone +
          " · " +
          (p.payerRole === "organization"
            ? "Paid by your organization"
            : "You pay")}
      </Text>
      <StateTag
        testID={TID.linkStatus}
        label={status.label}
        tone={status.tone}
      />
      <Text variant="caption" tone="text2">
        {p.accessStatus === "active"
          ? (p.accessSentAt ? "Sent " + whenLabel(p.accessSentAt) + ". " : "") +
            (expires ? "The link expires " + expires + "." : "")
          : p.accessStatus === "declined"
            ? "They declined before pickup" +
              (p.declinedAt ? " (" + whenLabel(p.declinedAt) + ")" : "") +
              ". Nothing was charged."
            : "Their link doesn’t open the trip any more."}
      </Text>
      <Text variant="caption" tone="text3">
        {p.attestation}
      </Text>
      <Text variant="caption" tone="text3">
        They see the driver, live status and the pickup PIN — nothing about you,
        the fare or your other trips.
      </Text>
      {sent ? <Banner tone="ok" body={sent} /> : null}
      {refusal ? (
        <Banner
          testID={TID.refusal}
          tone="error"
          title={refusal.title}
          body={refusal.body}
        />
      ) : null}
      <View style={{ gap: 8 }}>
        {requestOpen && p.accessStatus !== "declined" ? (
          <Button
            testID={TID.reissue}
            label="Send a fresh link"
            kind="secondary"
            size="md"
            loading={reissue.isPending}
            onPress={() => reissue.mutate(print("reissue"))}
          />
        ) : null}
        {p.accessStatus === "active" ? (
          <Button
            testID={TID.revoke}
            label="Withdraw the link"
            kind="ghost"
            size="md"
            loading={revoke.isPending}
            onPress={() => revoke.mutate(print("revoke"))}
          />
        ) : null}
      </View>
    </Card>
  );
}

/**
 * The requester's passenger panel for a marketplace request, wherever the requester follows
 * the trip (e.g. the post-award ride screen): reads the owner snapshot and shows the card only
 * when this request was booked for another adult. Renders nothing otherwise, or while the
 * snapshot is unavailable — the trip screen never depends on it.
 */
export function RequestPassengerPanel({ requestId }: { requestId: string }) {
  const q = useQuery({
    queryKey: ["mp", "request", requestId],
    queryFn: () => marketplaceApi.request(requestId),
    retry: false,
    refetchInterval: 30_000,
  });
  const r = q.data?.request;
  if (!r?.passenger) return null;
  return (
    <PassengerLinkCard
      requestId={requestId}
      passenger={r.passenger}
      requestOpen={!["cancelled", "expired", "no_offers"].includes(r.state)}
    />
  );
}
