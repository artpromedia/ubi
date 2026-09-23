// A03 one scheduled request — Marketplace.Scheduled. The server's status label and notice
// are shown verbatim beside a printed status word; "no driver secured yet" stays explicit
// until a published request's offer is selected and confirmed. needs_rider_approval shows
// the REFRESHED terms and asks for a renewed approval (POST .../approve {expectedVersion,
// maxFareMinor[, paymentMethodId]}) — the new maximum is one of the server's own figures.
// Cancel (unpublished only) and approve carry caller-held Idempotency-Keys.
import React, { useState } from "react";
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
  Chip,
  MoneyText,
  Row,
  Screen,
  Sheet,
  Text,
} from "@ubi/mobile-ui";
import { formatMinor, track, type Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import { marketplaceApi, type MpScheduledRequest } from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import {
  STOP_PURPOSE_TEXT,
  isOffline,
  refusalFor,
  scheduledStatus,
  stalenessOf,
  whenLabel,
  type Refusal,
  type Staleness,
} from "./riderCopy";
import {
  LoadFailure,
  LoadingBlocks,
  RouteList,
  StaleBanner,
  StateTag,
  type RoutePoint,
} from "./riderParts";
import { WALLET_PAYMENT_METHOD_ID } from "../../lib/payment";

const TID = TEST_IDS.mp.rider.scheduled;
const PAYMENT_METHOD_ID = WALLET_PAYMENT_METHOD_ID;
const TERMINAL = new Set(["cancelled", "expired", "skipped", "unfulfilled"]);
const UNPUBLISHED = new Set(["scheduled_unassigned", "needs_rider_approval"]);

export type ApprovalChoice = { key: string; label: string; money: Money };

export type ScheduledDetailProps = {
  sr: MpScheduledRequest;
  stale: Staleness;
  route: RoutePoint[];
  approval: {
    message: string;
    refreshed: NonNullable<MpScheduledRequest["approval"]>["refreshedTerms"];
    choices: ApprovalChoice[];
    selected: string | null;
    onSelect: (key: string) => void;
    note: string | null;
    busy: boolean;
    onApprove: () => void;
  } | null;
  cancel: {
    open: boolean;
    busy: boolean;
    onOpen: () => void;
    onClose: () => void;
    onConfirm: () => void;
  } | null;
  onOpenRequest: (() => void) | null;
  onOpenSeries: (() => void) | null;
  banner: (Refusal & { tone: "ok" | "error" | "warn" }) | null;
  onBack: () => void;
};

export function ScheduledDetailView(p: ScheduledDetailProps) {
  const { sr } = p;
  const status = scheduledStatus(sr);
  const s = sr.schedule;
  return (
    <Screen title="Scheduled trip" subtitle={s.label} onBack={p.onBack}>
      <View testID={TID.screen} style={{ gap: 12 }}>
        <StaleBanner stale={p.stale} testIDs={TID} />
        {p.banner ? (
          <Banner
            testID={TID.refusal}
            tone={p.banner.tone}
            title={p.banner.title}
            body={p.banner.body}
          />
        ) : null}
        <Card style={{ gap: 6 }}>
          <StateTag
            testID={TID.status}
            label={status.label}
            tone={status.tone}
          />
          <Text variant="bodyStrong">{sr.statusLabel}</Text>
          <Text testID={TID.notice} variant="bodySm" tone="text2">
            {sr.notice}
          </Text>
        </Card>
        {!sr.driverSecured && !TERMINAL.has(sr.state) ? (
          <Banner
            testID={TID.noDriver}
            tone="warn"
            title="No driver secured yet"
            body={
              sr.state === "published"
                ? "Your request is with drivers now. A driver is secured only when you choose one of their offers."
                : "This trip is stored, not booked. It goes to drivers at the time below, and a driver is secured only when you choose an offer."
            }
          />
        ) : null}
        <Card style={{ gap: 2 }}>
          <Row testID={TID.pickup} label="Pickup" value={s.label} />
          <Row
            label="Pickup window"
            value={
              whenLabel(s.windowStart, s.timeZone) +
              " – " +
              whenLabel(s.windowEnd, s.timeZone)
            }
          />
          {s.dstResolution !== "exact" ? (
            <Text variant="caption" tone="warnInk">
              The time you chose falls in a daylight-saving change, so UBI
              resolved it to {s.localTime} at UTC{s.utcOffset}.
            </Text>
          ) : null}
          {UNPUBLISHED.has(sr.state) ? (
            <Row
              testID={TID.publishAt}
              label="Sent to drivers"
              value={whenLabel(sr.publishAt, s.timeZone)}
              last
            />
          ) : null}
        </Card>
        <Card>
          <RouteList points={p.route} />
        </Card>
        <Card testID={TID.fares}>
          <Row
            label="Your fare"
            value={
              <MoneyText money={sr.requestedFareMinor} variant="bodySmStrong" />
            }
          />
          <Row
            label="The most you approved"
            value={<MoneyText money={sr.maxFareMinor} variant="bodySmStrong" />}
            last
          />
        </Card>
        {p.approval ? (
          <Card testID={TID.approval} tone="warn" style={{ gap: 8 }}>
            <Text variant="bodyStrong">Your approval is needed</Text>
            <Text variant="bodySm" tone="text2">
              {p.approval.message}
            </Text>
            {p.approval.refreshed ? (
              <View testID={TID.refreshed}>
                <Text variant="label" tone="text3">
                  Refreshed fare range (priced by UBI)
                </Text>
                <Row
                  label="Minimum"
                  value={
                    <MoneyText
                      money={p.approval.refreshed.minimumFareMinor}
                      variant="bodySmStrong"
                    />
                  }
                />
                <Row
                  label="Suggested"
                  value={
                    <MoneyText
                      money={p.approval.refreshed.suggestedFareMinor}
                      variant="bodySmStrong"
                    />
                  }
                />
                <Row
                  label="Maximum"
                  value={
                    <MoneyText
                      money={p.approval.refreshed.maximumFareMinor}
                      variant="bodySmStrong"
                    />
                  }
                  last
                />
              </View>
            ) : null}
            {p.approval.choices.map((c) => (
              <Chip
                key={c.key}
                testID={dynamicTestId(TID.approveChoice, c.key)}
                label={c.label}
                selected={p.approval!.selected === c.key}
                onPress={() => p.approval!.onSelect(c.key)}
              />
            ))}
            {p.approval.note ? (
              <Text variant="caption" tone="text2">
                {p.approval.note}
              </Text>
            ) : null}
            <Button
              testID={TID.approve}
              label="Approve and keep it scheduled"
              disabled={!p.approval.selected}
              loading={p.approval.busy}
              onPress={p.approval.onApprove}
            />
          </Card>
        ) : null}
        {p.onOpenRequest ? (
          <Button
            testID={TID.openRequest}
            label={sr.driverSecured ? "Open your trip" : "See drivers’ offers"}
            onPress={p.onOpenRequest}
          />
        ) : null}
        {p.onOpenSeries ? (
          <Button
            label="Part of a recurring journey — open the series"
            kind="ghost"
            onPress={p.onOpenSeries}
          />
        ) : null}
        {p.cancel ? (
          <Button
            testID={TID.cancel}
            label="Cancel this scheduled trip"
            kind="danger"
            onPress={p.cancel.onOpen}
          />
        ) : null}
      </View>
      {p.cancel ? (
        <Sheet visible={p.cancel.open} onDismiss={p.cancel.onClose}>
          <View style={{ gap: 10 }}>
            <Text variant="title">Cancel this scheduled trip?</Text>
            <Text variant="bodySm" tone="text2">
              It hasn’t been sent to drivers, so nothing was reserved or
              charged. Cancelling is free.
            </Text>
            <Button
              testID={TID.cancelConfirm}
              label="Cancel scheduled trip"
              kind="danger"
              loading={p.cancel.busy}
              onPress={p.cancel.onConfirm}
            />
            <Button
              label="Keep it"
              kind="secondary"
              onPress={p.cancel.onClose}
            />
          </View>
        </Sheet>
      ) : null}
    </Screen>
  );
}

export function ScheduledDetailContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } =
    useRoute<RouteProp<MarketplaceStackParamList, "Scheduled">>();
  const id = params.scheduledRequestId;
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("sched");
  const key = ["mp", "scheduled", id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => marketplaceApi.scheduled(id),
    retry: false,
    refetchInterval: (query) =>
      query.state.data && TERMINAL.has(query.state.data.state) ? false : 15_000,
  });
  const [choice, setChoice] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [banner, setBanner] = useState<
    (Refusal & { tone: "ok" | "error" | "warn" }) | null
  >(null);
  const adopt = (sr: MpScheduledRequest) => {
    queryClient.setQueryData(key, sr);
    void queryClient.invalidateQueries({ queryKey: ["mp", "later"] });
  };
  const onRefused = (e: unknown) => {
    if (!isOffline(e)) void q.refetch();
    setBanner({ ...refusalFor(e), tone: isOffline(e) ? "warn" : "error" });
  };

  const approve = useMutation({
    mutationFn: (v: {
      body: Parameters<typeof marketplaceApi.approveScheduled>[1];
      print: string;
    }) => marketplaceApi.approveScheduled(id, v.body, keys.keyFor(v.print)),
    onSuccess: (sr, v) => {
      keys.settle(v.print);
      setChoice(null);
      setBanner({
        tone: "ok",
        title: "Approved",
        body: "Your trip is scheduled again. UBI re-checks the price before sending it to drivers — still no driver is secured until you choose an offer.",
      });
      adopt(sr);
      track("mp_scheduled_approved", { scheduledRequestId: id });
    },
    onError: (e, v) => {
      keys.settle(v.print, e);
      onRefused(e);
    },
  });
  const cancel = useMutation({
    mutationFn: (version: number) =>
      marketplaceApi.cancelScheduled(id, keys.keyFor("cancel:" + version)),
    onSuccess: (sr, version) => {
      keys.settle("cancel:" + version);
      setCancelOpen(false);
      setBanner({
        tone: "ok",
        title: "Cancelled",
        body: "Nothing was reserved or charged.",
      });
      adopt(sr);
    },
    onError: (e, version) => {
      keys.settle("cancel:" + version, e);
      setCancelOpen(false);
      onRefused(e);
    },
  });

  if (!q.data)
    return (
      <Screen title="Scheduled trip" onBack={nav.goBack}>
        {q.isError ? (
          <LoadFailure
            offline={isOffline(q.error)}
            title="Couldn’t load this trip"
            body={(q.error as Error).message}
            onRetry={() => void q.refetch()}
            testIDs={TID}
          />
        ) : (
          <LoadingBlocks heights={[90, 120, 90]} />
        )}
      </Screen>
    );
  const sr = q.data;
  const route: RoutePoint[] = [
    { key: "pickup", kind: "pickup", label: sr.pickup.label },
    ...[...(sr.stops ?? [])]
      .sort((a, b) => a.order - b.order)
      .map(
        (s): RoutePoint => ({
          key: s.stopId,
          kind: "stop",
          label: s.label,
          detail: STOP_PURPOSE_TEXT[s.purpose] ?? "Stop",
        }),
      ),
    { key: "dropoff", kind: "dropoff", label: sr.dropoff.label },
  ];
  const a = sr.approval;
  const choices: ApprovalChoice[] =
    sr.state === "needs_rider_approval" && a
      ? a.refreshedTerms
        ? [
            {
              key: "maximum",
              label:
                "Approve up to " +
                formatMinor(a.refreshedTerms.maximumFareMinor),
              money: a.refreshedTerms.maximumFareMinor,
            },
            {
              key: "suggested",
              label:
                "Approve up to " +
                formatMinor(a.refreshedTerms.suggestedFareMinor),
              money: a.refreshedTerms.suggestedFareMinor,
            },
          ]
        : [
            {
              key: "current",
              label: "Keep my approval · up to " + formatMinor(sr.maxFareMinor),
              money: sr.maxFareMinor,
            },
          ]
      : [];

  return (
    <ScheduledDetailView
      sr={sr}
      stale={stalenessOf(q.isError ? q.error : null)}
      route={route}
      approval={
        sr.state === "needs_rider_approval" && a
          ? {
              message: a.message,
              refreshed: a.refreshedTerms,
              choices,
              selected: choice,
              onSelect: setChoice,
              note:
                a.reason === "payment_method_unavailable"
                  ? "Approving switches this trip to your UBI Wallet."
                  : a.reason === "funding_unavailable"
                    ? "Top up your wallet first — UBI checks your balance again before sending the trip."
                    : null,
              busy: approve.isPending,
              onApprove: () => {
                const c = choices.find((x) => x.key === choice);
                if (!c) return;
                setBanner(null);
                const body = {
                  expectedVersion: sr.version,
                  maxFareMinor: c.money,
                  ...(a.reason === "payment_method_unavailable"
                    ? { paymentMethodId: PAYMENT_METHOD_ID }
                    : {}),
                };
                approve.mutate({
                  body,
                  print: "approve:" + sr.version + ":" + c.key,
                });
              },
            }
          : null
      }
      cancel={
        UNPUBLISHED.has(sr.state)
          ? {
              open: cancelOpen,
              busy: cancel.isPending,
              onOpen: () => {
                setBanner(null);
                setCancelOpen(true);
              },
              onClose: () => setCancelOpen(false),
              onConfirm: () => cancel.mutate(sr.version),
            }
          : null
      }
      onOpenRequest={
        sr.requestId
          ? () =>
              nav.navigate(
                sr.product === "advance_reservation"
                  ? "AdvanceOffers"
                  : "Offers",
                { requestId: sr.requestId },
              )
          : null
      }
      onOpenSeries={
        sr.templateId
          ? () => nav.navigate("Series", { templateId: sr.templateId })
          : null
      }
      banner={banner}
      onBack={nav.goBack}
    />
  );
}
