// Travel.Transfer — one airport transfer's status (GET /v1/reservations/:transferId). Each state
// says what is true and nothing more: pending with no driver yet, sent to drivers with no
// driver yet, DRIVER CONFIRMED only when the traveller's own selected award exists, the
// traveller's labelled choices when a flight change needs a decision, and the honest outcome of
// a failed or cancelled transfer. Choosing a driver happens in the ride app (the scheduled
// request / offers inbox this transfer made). Every POST carries a caller-held Idempotency-Key.
import React, { useState } from "react";
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
  MoneyText,
  Row,
  Screen,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import { ApiError, track, useFlag } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { TravelStackParamList } from "../../navigation/routes";
import {
  travelApi,
  type AirportTransfer,
  type TransferChoiceKey,
} from "../../api/travel";
import { useIdempotencyKeys } from "../../lib/idempotency";
import { typedDigits, typedMajorToMoney } from "../../lib/moneyInput";
import {
  LoadFailure,
  LoadingBlocks,
  StateTag,
  UnavailableCard,
} from "../marketplace/riderParts";
import { isOffline } from "../marketplace/riderCopy";
import {
  DIRECTION_TEXT,
  LIVE_TRANSFER,
  TRANSFER_STATUS,
  flightNoteOf,
  transferRefusal,
  windowLineOf,
} from "./transferCopy";

const TID = TEST_IDS.travel.transfer;

export type TransferStatusProps = {
  transfer: AirportTransfer;
  busy: TransferChoiceKey | null;
  refusal: { title: string; body: string } | null;
  confirmingCancel: boolean;
  limitRaw: string;
  onLimitChange: (raw: string) => void;
  onChoice: (key: TransferChoiceKey) => void;
  onCancel: () => void;
  onCancelConfirm: () => void;
  onCancelAbort: () => void;
  onOpenRide: (() => void) | null;
  onBack: () => void;
};

export function TransferStatusView(p: TransferStatusProps) {
  const t = useTheme();
  const tr = p.transfer;
  const word = TRANSFER_STATUS[tr.status];
  const live = LIVE_TRANSFER.has(tr.status);
  const windowLine = windowLineOf(tr);
  const flightNote = flightNoteOf(tr);
  const action = tr.actionRequired;
  const choices = action?.choices ?? [];
  const cancelOffered = choices.some((c) => c.key === "cancel");
  return (
    <Screen
      title={DIRECTION_TEXT[tr.direction]}
      subtitle={
        [tr.flightNumber, tr.airportCode].filter(Boolean).join(" · ") ||
        undefined
      }
      onBack={p.onBack}
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        <Card style={{ gap: 6 }}>
          <StateTag testID={TID.status} label={word.label} tone={word.tone} />
          <Text variant="bodySmStrong">{tr.statusLabel}</Text>
          <Text testID={TID.notice} variant="bodySm" tone="text2">
            {tr.notice}
          </Text>
        </Card>
        {tr.status === "pending_unassigned" || tr.status === "requested" ? (
          <Banner
            testID={TID.noDriver}
            tone="warn"
            title="No driver yet"
            body="Nothing is secured and nothing is charged for this ride until you choose a driver’s offer."
          />
        ) : null}
        {tr.status === "awarded" && tr.driverSecured ? (
          <Banner
            testID={TID.driverSecured}
            tone="ok"
            title="Driver confirmed"
            body="A driver is committed to the offer you chose. Follow the ride in the ride app."
          />
        ) : null}
        {action ? (
          <Card testID={TID.action} tone="warn" style={{ gap: 8 }}>
            <Text variant="bodyStrong">Your decision is needed</Text>
            {action.message ? (
              <Text variant="bodySm" tone="text2">
                {action.message}
              </Text>
            ) : null}
            {choices.some((c) => c.key === "approve_limit") ? (
              <View style={{ gap: 2 }}>
                {action.minimumFareMinor ? (
                  <Text variant="caption" tone="text2">
                    {"Drivers’ minimum for this ride now: "}
                    <MoneyText
                      money={action.minimumFareMinor}
                      variant="caption"
                      tone="text2"
                    />
                  </Text>
                ) : null}
                <TextInput
                  testID={TID.limit}
                  value={p.limitRaw}
                  onChangeText={p.onLimitChange}
                  keyboardType="number-pad"
                  accessibilityLabel="New most you approve, in whole units"
                  placeholderTextColor={t.colors.text3}
                  style={[
                    t.type.body as TextStyle,
                    {
                      color: t.colors.text,
                      borderBottomWidth: 1,
                      borderBottomColor: t.colors.border,
                      paddingVertical: 8,
                    },
                  ]}
                />
              </View>
            ) : null}
            {choices.map((c) => (
              <Button
                key={c.key}
                testID={dynamicTestId(TID.choice, c.key)}
                label={c.label}
                kind={
                  c.key === "keep"
                    ? "secondary"
                    : c.key === "cancel"
                      ? "danger"
                      : "primary"
                }
                size="md"
                loading={p.busy === c.key}
                disabled={!!p.busy}
                onPress={
                  c.key === "cancel" ? p.onCancel : () => p.onChoice(c.key)
                }
              />
            ))}
          </Card>
        ) : null}
        {p.refusal ? (
          <Banner
            testID={TID.refusal}
            tone="error"
            title={p.refusal.title}
            body={p.refusal.body}
          />
        ) : null}
        {tr.outcome?.message && !live ? (
          <Banner
            testID={TID.outcome}
            tone={tr.status === "failed" ? "error" : "neutral"}
            title={tr.status === "failed" ? "Not booked" : "Cancelled"}
            body={tr.outcome.message}
          />
        ) : null}
        <Card style={{ gap: 2 }}>
          {windowLine ? (
            <Row testID={TID.window} label="When" value={windowLine} />
          ) : null}
          <Row label="From" value={tr.pickup?.label ?? "—"} />
          <Row label="To" value={tr.dropoff?.label ?? "—"} />
          {tr.vehicleClass ? (
            <Row label="Class" value={tr.vehicleClass} />
          ) : null}
          {tr.approvedMaxFareMinor ? (
            <Row
              testID={TID.limitApproved}
              label="Most you approved"
              value={
                <MoneyText
                  money={tr.approvedMaxFareMinor}
                  variant="bodySmStrong"
                />
              }
              last
            />
          ) : null}
        </Card>
        {flightNote ? <Banner tone="info" body={flightNote} /> : null}
        {p.onOpenRide ? (
          <Button
            testID={TID.openRide}
            label={
              tr.status === "awarded"
                ? "Open the ride"
                : "See drivers’ offers in the ride app"
            }
            kind="secondary"
            onPress={p.onOpenRide}
          />
        ) : null}
        {live ? (
          p.confirmingCancel ? (
            <Card style={{ gap: 8 }}>
              <Text variant="bodySmStrong">Cancel this airport ride?</Text>
              <Text variant="caption" tone="text2">
                {tr.driverSecured
                  ? "A driver is already secured, so the ride’s own cancellation rules apply. Any fee shows on the ride receipt, never on your flight."
                  : "No driver is secured yet, so cancelling is free."}
              </Text>
              <Button
                testID={dynamicTestId(TID.choice, "cancelConfirm")}
                label="Yes, cancel the ride"
                kind="danger"
                size="md"
                loading={p.busy === "cancel"}
                onPress={p.onCancelConfirm}
              />
              <Button
                label="Keep it"
                kind="ghost"
                size="md"
                onPress={p.onCancelAbort}
              />
            </Card>
          ) : cancelOffered ? null : (
            <Button
              testID={dynamicTestId(TID.choice, "cancel")}
              label="Cancel this airport ride"
              kind="ghost"
              onPress={p.onCancel}
            />
          )
        ) : null}
        <Card testID={TID.terms} style={{ gap: 4 }}>
          <Text variant="label" tone="text3">
            This ride’s own terms
          </Text>
          {tr.terms.map((line) => (
            <Text key={line} variant="caption" tone="text2">
              {line}
            </Text>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

export function TransferStatusContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } = useRoute<RouteProp<TravelStackParamList, "Transfer">>();
  const flagOn = useFlag("reservations");
  const queryClient = useQueryClient();
  const keys = useIdempotencyKeys("xfer");
  const key = ["travel", "transfer", params.transferId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => travelApi.transfer(params.transferId),
    retry: false,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === "pending_unassigned" || s === "requested") return 15_000;
      if (s === "awarded") return 30_000;
      return false;
    },
  });
  const [refusal, setRefusal] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [limitRaw, setLimitRaw] = useState("");
  const decide = useMutation({
    mutationFn: (v: { choice: TransferChoiceKey; print: string }) => {
      const tr = q.data as AirportTransfer;
      if (v.choice === "cancel")
        return travelApi.cancelTransfer(
          params.transferId,
          keys.keyFor(v.print),
        );
      const currency =
        tr.approvedMaxFareMinor?.currency ??
        tr.actionRequired?.minimumFareMinor?.currency;
      const limit =
        v.choice === "approve_limit" && currency
          ? typedMajorToMoney(limitRaw, currency)
          : null;
      return travelApi.decideTransfer(
        params.transferId,
        v.choice,
        keys.keyFor(v.print),
        limit ?? undefined,
      );
    },
    onSuccess: (next, v) => {
      keys.settle(v.print);
      track("airport_transfer_decision", { choice: v.choice });
      setRefusal(null);
      setConfirmingCancel(false);
      queryClient.setQueryData(key, next);
    },
    onError: (e, v) => {
      keys.settle(v.print, e);
      setRefusal(transferRefusal(e));
      if (e instanceof ApiError && e.status === 409) void q.refetch();
    },
  });
  if (
    !flagOn ||
    (q.error instanceof ApiError && q.error.code === "feature_disabled")
  )
    return (
      <Screen title="Airport ride" onBack={nav.goBack}>
        <UnavailableCard
          testID={TID.unavailable}
          title="Airport rides aren’t available here"
          body="UBI isn’t arranging airport rides in your city right now. A ride you already requested keeps its own status in the ride app."
          action={{
            label: "Open Book for Later",
            onPress: () => nav.navigate("Marketplace", { screen: "Later" }),
          }}
        />
      </Screen>
    );
  const tr = q.data;
  if (!tr)
    return (
      <Screen title="Airport ride" onBack={nav.goBack}>
        {q.isError ? (
          <LoadFailure
            offline={isOffline(q.error)}
            title="Couldn’t load this airport ride"
            body={(q.error as Error).message}
            onRetry={() => void q.refetch()}
            testIDs={TID}
          />
        ) : (
          <LoadingBlocks heights={[110, 160]} />
        )}
      </Screen>
    );
  // One key per choice on THIS state of the transfer (a new server state is a new command).
  const print = (choice: TransferChoiceKey) =>
    choice +
    ":" +
    (tr.updatedAt ?? "") +
    ":" +
    (choice === "approve_limit" ? limitRaw : "");
  const ride = tr.ride;
  return (
    <TransferStatusView
      transfer={tr}
      busy={decide.isPending ? (decide.variables?.choice ?? null) : null}
      refusal={refusal}
      confirmingCancel={confirmingCancel}
      limitRaw={limitRaw}
      onLimitChange={(raw) => setLimitRaw(typedDigits(raw))}
      onChoice={(choice) => {
        if (choice === "approve_limit" && !limitRaw) {
          setRefusal({
            title: "Enter your new limit",
            body: "Type the most you approve for this ride, then choose again.",
          });
          return;
        }
        decide.mutate({ choice, print: print(choice) });
      }}
      onCancel={() => setConfirmingCancel(true)}
      onCancelConfirm={() =>
        decide.mutate({ choice: "cancel", print: print("cancel") })
      }
      onCancelAbort={() => setConfirmingCancel(false)}
      onOpenRide={
        ride?.requestId
          ? () =>
              nav.navigate("Marketplace", {
                screen: "Offers",
                params: { requestId: ride.requestId },
              })
          : ride?.scheduledRequestId
            ? () =>
                nav.navigate("Marketplace", {
                  screen: "Scheduled",
                  params: { scheduledRequestId: ride.scheduledRequestId },
                })
            : null
      }
      onBack={nav.goBack}
    />
  );
}
