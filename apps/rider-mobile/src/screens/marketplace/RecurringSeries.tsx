// A03 RecurringSeries — Marketplace.Series. A recurring journey and its occurrences, each
// with its OWN status (driver secured, scheduled, needs approval, skipped…). The series as
// a whole is never labelled confirmed because one occurrence has a driver — the header
// only ever says active / paused / cancelled / ended and repeats the server's series
// note. Skip one occurrence, pause, resume or cancel — each with a caller-held
// Idempotency-Key; commands pin the series `expectedVersion`.
import React, { useState } from "react";
import { Pressable, View } from "react-native";
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
  Sheet,
  Text,
} from "@ubi/mobile-ui";
import { ApiError, track } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import {
  marketplaceApi,
  type MpRecurringTemplate,
  type MpSeriesCommand,
} from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { seriesPattern } from "./LaterHub";
import {
  isOffline,
  refusalFor,
  scheduledStatus,
  seriesStatus,
  stalenessOf,
  type Refusal,
  type Staleness,
} from "./riderCopy";
import {
  LoadFailure,
  LoadingBlocks,
  StaleBanner,
  StateTag,
} from "./riderParts";

const TID = TEST_IDS.mp.rider.series;
const SKIPPABLE = new Set(["scheduled_unassigned", "needs_rider_approval"]);

export type SeriesProps = {
  s: MpRecurringTemplate;
  stale: Staleness;
  banner: (Refusal & { tone: "ok" | "warn" | "error" }) | null;
  onOpenOccurrence: (scheduledRequestId: string) => void;
  onSkip: ((localDate: string) => void) | null;
  skipping: string | null;
  command: {
    busy: MpSeriesCommand | null;
    onPause: (() => void) | null;
    onResume: (() => void) | null;
    cancel: {
      open: boolean;
      onOpen: () => void;
      onClose: () => void;
      onConfirm: () => void;
    } | null;
  };
  onBack: () => void;
};

export function RecurringSeriesView(p: SeriesProps) {
  const { s } = p;
  const status = seriesStatus(s);
  const occurrences = [...s.occurrences].sort((a, b) =>
    (a.occurrenceDate ?? "").localeCompare(b.occurrenceDate ?? ""),
  );
  const secured = occurrences.filter((o) => o.driverSecured).length;
  return (
    <Screen
      title="Recurring journey"
      subtitle={seriesPattern(s)}
      onBack={p.onBack}
    >
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
          <Text variant="bodyStrong">
            {s.pickup.label + " → " + s.dropoff.label}
          </Text>
          <Text testID={TID.note} variant="bodySm" tone="text2">
            {s.seriesNote}
          </Text>
          <Text variant="caption" tone="text2">
            {occurrences.length
              ? secured +
                " of " +
                occurrences.length +
                (occurrences.length === 1 ? " trip has" : " trips have") +
                " a driver secured. The series itself isn’t confirmed — each trip books on its own."
              : "The series itself isn’t confirmed — each trip books on its own."}
          </Text>
        </Card>
        <Card testID={TID.pattern}>
          <Row label="Repeats" value={seriesPattern(s)} />
          <Row
            label="Starts"
            value={
              s.startsOn + (s.endsOn ? " · ends " + s.endsOn : " · no end date")
            }
          />
          <Row
            label="Each trip"
            value={
              s.product === "advance_reservation"
                ? "Drivers offer ahead of time"
                : "Sent to drivers near pickup"
            }
          />
          <Row
            label="Your fare per trip"
            value={
              <MoneyText money={s.requestedFareMinor} variant="bodySmStrong" />
            }
          />
          <Row
            label="The most you approve per trip"
            value={<MoneyText money={s.maxFareMinor} variant="bodySmStrong" />}
            last
          />
        </Card>
        <Text variant="label" tone="text3">
          Upcoming trips
        </Text>
        {occurrences.length === 0 ? (
          <Card testID={TID.empty}>
            <Text variant="bodySm" tone="text2">
              No trips are generated yet. They appear here a few days ahead,
              each with its own status.
            </Text>
          </Card>
        ) : null}
        {occurrences.map((o) => {
          const st = scheduledStatus(o);
          const date = o.occurrenceDate ?? o.schedule.localDate;
          return (
            <Card
              key={o.scheduledRequestId}
              testID={dynamicTestId(TID.occurrence, date)}
              style={{ gap: 6 }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={o.schedule.label + ". " + st.label}
                onPress={() => p.onOpenOccurrence(o.scheduledRequestId)}
                style={{ gap: 4 }}
              >
                <Text variant="bodySmStrong">{o.schedule.label}</Text>
                <StateTag
                  testID={dynamicTestId(TID.occurrenceStatus, date)}
                  label={st.label}
                  tone={st.tone}
                />
                <Text variant="caption" tone="text2">
                  {o.statusLabel}
                </Text>
              </Pressable>
              {p.onSkip && SKIPPABLE.has(o.state) ? (
                <Button
                  testID={dynamicTestId(TID.skip, date)}
                  label="Skip this trip"
                  accessibilityLabel={"Skip the trip on " + o.schedule.label}
                  kind="secondary"
                  size="md"
                  loading={p.skipping === date}
                  onPress={() => p.onSkip!(date)}
                />
              ) : null}
            </Card>
          );
        })}
        {p.command.onPause ? (
          <Button
            testID={TID.pause}
            label="Pause the series"
            kind="secondary"
            loading={p.command.busy === "pause"}
            onPress={p.command.onPause}
          />
        ) : null}
        {p.command.onResume ? (
          <Button
            testID={TID.resume}
            label="Resume the series"
            loading={p.command.busy === "resume"}
            onPress={p.command.onResume}
          />
        ) : null}
        {p.command.cancel ? (
          <Button
            testID={TID.cancel}
            label="Cancel the series"
            kind="danger"
            onPress={p.command.cancel.onOpen}
          />
        ) : null}
      </View>
      {p.command.cancel ? (
        <Sheet
          visible={p.command.cancel.open}
          onDismiss={p.command.cancel.onClose}
        >
          <View style={{ gap: 10 }}>
            <Text variant="title">Cancel the whole series?</Text>
            <Text variant="bodySm" tone="text2">
              No new trips are created and trips not yet sent to drivers are
              cancelled. Trips already sent to drivers (or with a driver) are
              separate bookings and stay as they are — cancel those one by one
              if you need to.
            </Text>
            <Button
              testID={TID.cancelConfirm}
              label="Cancel series"
              kind="danger"
              loading={p.command.busy === "cancel"}
              onPress={p.command.cancel.onConfirm}
            />
            <Button
              label="Keep it"
              kind="secondary"
              onPress={p.command.cancel.onClose}
            />
          </View>
        </Sheet>
      ) : null}
    </Screen>
  );
}

export function RecurringSeriesContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<MarketplaceStackParamList, "Series">>();
  const id = params.templateId;
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("series");
  const key = ["mp", "series", id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => marketplaceApi.series(id),
    retry: false,
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [banner, setBanner] = useState<
    (Refusal & { tone: "ok" | "warn" | "error" }) | null
  >(null);
  const onRefused = (e: unknown) => {
    if (!isOffline(e)) void q.refetch();
    setBanner({ ...refusalFor(e), tone: isOffline(e) ? "warn" : "error" });
  };
  const command = useMutation({
    mutationFn: (v: { command: MpSeriesCommand; version: number }) =>
      marketplaceApi.seriesCommand(
        id,
        v.command,
        v.version,
        keys.keyFor(v.command + ":" + v.version),
      ),
    onSuccess: (s, v) => {
      keys.settle(v.command + ":" + v.version);
      setCancelOpen(false);
      queryClient.setQueryData(key, s);
      void queryClient.invalidateQueries({ queryKey: ["mp", "later"] });
      setBanner({
        tone: "ok",
        title:
          v.command === "pause"
            ? "Series paused"
            : v.command === "resume"
              ? "Series resumed"
              : "Series cancelled",
        body:
          v.command === "pause"
            ? "No new trips are created or sent to drivers until you resume. A waiting trip whose pickup passes lapses at no charge."
            : v.command === "resume"
              ? "Trips are created and sent to drivers again — each still books on its own."
              : "No new trips are created. Trips already with drivers stand on their own.",
      });
      track("mp_series_" + v.command, { templateId: id });
    },
    onError: (e, v) => {
      keys.settle(v.command + ":" + v.version, e);
      setCancelOpen(false);
      if (e instanceof ApiError && e.code === "version_conflict")
        void q.refetch();
      onRefused(e);
    },
  });
  const skip = useMutation({
    mutationFn: (localDate: string) =>
      marketplaceApi.skipOccurrence(
        id,
        localDate,
        keys.keyFor("skip:" + localDate),
      ),
    onSuccess: (_sr, localDate) => {
      keys.settle("skip:" + localDate);
      void q.refetch();
      setBanner({
        tone: "ok",
        title: "Trip skipped",
        body: "Only that trip is skipped — the rest of the series is unchanged.",
      });
    },
    onError: (e, localDate) => {
      keys.settle("skip:" + localDate, e);
      onRefused(e);
    },
  });

  if (!q.data)
    return (
      <Screen title="Recurring journey" onBack={nav.goBack}>
        {q.isError ? (
          <LoadFailure
            offline={isOffline(q.error)}
            title="Couldn’t load this series"
            body={(q.error as Error).message}
            onRetry={() => void q.refetch()}
            testIDs={TID}
          />
        ) : (
          <LoadingBlocks heights={[100, 120, 80, 80]} />
        )}
      </Screen>
    );
  const s = q.data;
  const live = s.state === "active" || s.state === "paused";
  return (
    <RecurringSeriesView
      s={s}
      stale={stalenessOf(q.isError ? q.error : null)}
      banner={banner}
      onOpenOccurrence={(scheduledRequestId) =>
        nav.navigate("Scheduled", { scheduledRequestId })
      }
      onSkip={
        live
          ? (localDate) => {
              setBanner(null);
              skip.mutate(localDate);
            }
          : null
      }
      skipping={skip.isPending ? (skip.variables ?? null) : null}
      command={{
        busy: command.isPending ? (command.variables?.command ?? null) : null,
        onPause:
          s.state === "active"
            ? () => {
                setBanner(null);
                command.mutate({ command: "pause", version: s.version });
              }
            : null,
        onResume:
          s.state === "paused"
            ? () => {
                setBanner(null);
                command.mutate({ command: "resume", version: s.version });
              }
            : null,
        cancel: live
          ? {
              open: cancelOpen,
              onOpen: () => {
                setBanner(null);
                setCancelOpen(true);
              },
              onClose: () => setCancelOpen(false),
              onConfirm: () =>
                command.mutate({ command: "cancel", version: s.version }),
            }
          : null,
      }}
      onBack={nav.goBack}
    />
  );
}
