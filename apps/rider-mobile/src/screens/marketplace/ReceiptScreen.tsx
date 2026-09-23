// Marketplace.Receipt — a COMPLETED ride's receipt, the rider's view
// (GET /v1/mp/requests/:id/receipt). Everything is the server's: the agreed fare and each
// COMMITTED adjustment as its own line (route change, paid stop waiting, early end), the taxes
// already included at the market's configured rates, the total (which equals the settled fare),
// how it was paid, the trip facts and, for a business ride, the organization's billing identity,
// cost centre and expense category. The rider's receipt never carries the driver's commission.
// While money is still settling (409 settling) or before completion (409 trip_not_completed)
// the screen says so honestly instead of showing a figure. From here the rider may save the
// driver (marketplace_preferred_drivers) — caller-held Idempotency-Key.
import React, { useState } from "react";
import { View } from "react-native";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Banner,
  Button,
  Card,
  MoneyText,
  Row,
  Screen,
  Text,
} from "@ubi/mobile-ui";
import { ApiError, track, useFlag } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import { marketplaceApi, type MpReceipt } from "../../api/marketplace";
import { useIdempotencyKeys } from "../../lib/idempotency";
import {
  errorReason,
  isOffline,
  km,
  refusalFor,
  whenLabel,
  type Refusal,
} from "./riderCopy";
import { LoadFailure, LoadingBlocks, StateTag } from "./riderParts";

const TID = TEST_IDS.mp.rider.receipt;

const FUNDING_TEXT: Record<string, string> = {
  reserving: "Budget being reserved",
  reserved: "Budget reserved — not yet charged",
  committed: "Charged to the organization’s budget",
  refused: "Budget refused",
  released: "Budget released — nothing charged",
};

export type ReceiptViewProps = {
  receipt: MpReceipt;
  save: {
    busy: boolean;
    onSave: () => void;
    saved: string | null;
    refusal: Refusal | null;
  } | null;
  onBack: () => void;
};

export function ReceiptView({ receipt: r, save, onBack }: ReceiptViewProps) {
  const b = r.business;
  const driverName =
    r.trip.driver.profileStatus === "verified"
      ? r.trip.driver.displayName
      : "Driver details unavailable";
  return (
    <Screen
      title="Receipt"
      subtitle={whenLabel(r.trip.completedAt)}
      onBack={onBack}
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        <Card>
          {r.lines.map((line, i) => (
            <Row
              key={line.code + (line.amendmentId ?? i)}
              testID={dynamicTestId(TID.line, line.amendmentId ?? line.code)}
              label={line.label}
              value={
                <MoneyText
                  money={line.amountMinor}
                  signed={line.code !== "agreed_fare"}
                  variant="bodySmStrong"
                />
              }
            />
          ))}
          <Row
            testID={TID.total}
            label="Total"
            value={<MoneyText money={r.totalMinor} variant="heading" />}
            last
          />
        </Card>
        {r.taxes ? (
          <Card testID={TID.taxes} style={{ gap: 4 }}>
            {r.taxes.lines.map((t) => (
              <Row
                key={t.code}
                label={t.label + " (included)"}
                value={
                  <MoneyText money={t.amountMinor} variant="bodySmStrong" />
                }
              />
            ))}
            <Text variant="caption" tone="text2">
              {r.taxes.note}
            </Text>
          </Card>
        ) : null}
        <Card testID={TID.payment} style={{ gap: 4 }}>
          <Row label="Paid with" value={r.payment.label} last />
        </Card>
        <Card testID={TID.trip} style={{ gap: 4 }}>
          <Text variant="bodySmStrong">
            {r.trip.pickup + " → " + r.trip.dropoff}
          </Text>
          <Text variant="caption" tone="text2">
            {[
              r.trip.vehicleClass,
              km(r.trip.routedDistanceMeters),
              r.trip.stopCount
                ? r.trip.stopsVisited +
                  " of " +
                  r.trip.stopCount +
                  " stops visited" +
                  (r.trip.stopsSkipped
                    ? " · " + r.trip.stopsSkipped + " skipped"
                    : "")
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Text variant="caption" tone="text2">
            {driverName +
              (r.trip.startedAt
                ? " · started " + whenLabel(r.trip.startedAt)
                : "") +
              " · completed " +
              whenLabel(r.trip.completedAt)}
          </Text>
          {r.trip.terminatedEarly ? (
            <StateTag label="Ended early" tone="warn" />
          ) : null}
        </Card>
        {b ? (
          <Card testID={TID.business} style={{ gap: 4 }}>
            <Text variant="label" tone="text3">
              Business receipt
            </Text>
            <Row
              label="Organization"
              value={b.legalName || b.organizationName || "—"}
            />
            <Row label="Tax ID" value={b.taxId ?? "—"} />
            <Row
              label="Cost centre"
              value={
                b.costCentre
                  ? [b.costCentre.code, b.costCentre.name]
                      .filter(Boolean)
                      .join(" · ") || b.costCentre.id
                  : "—"
              }
            />
            <Row label="Expense category" value={b.expenseCategory ?? "—"} />
            <Row label="Booking reference" value={b.bookingRef} />
            <Row
              label="Budget"
              value={
                b.committedMinor ? (
                  <MoneyText money={b.committedMinor} variant="bodySmStrong" />
                ) : (
                  (FUNDING_TEXT[b.fundingState] ?? b.fundingState)
                )
              }
              last
            />
            <StateTag
              label={FUNDING_TEXT[b.fundingState] ?? b.fundingState}
              tone={b.fundingState === "committed" ? "ok" : "neutral"}
            />
            <Text variant="caption" tone="text2">
              {b.note}
            </Text>
            <Text variant="caption" tone="text3">
              PDF and email copies aren’t available in the app yet — this
              receipt is your record.
            </Text>
          </Card>
        ) : null}
        <Card testID={TID.settlement} style={{ gap: 4 }}>
          <StateTag
            label={
              r.settlement.status === "posted"
                ? "Settled"
                : "Settlement pending"
            }
            tone={r.settlement.status === "posted" ? "ok" : "info"}
          />
          <Text variant="caption" tone="text2">
            {r.settlement.note}
          </Text>
          <Text testID={TID.reconciliation} variant="caption" tone="text3">
            {r.reconciliation.rule}
          </Text>
        </Card>
        {save ? (
          <View style={{ gap: 8 }}>
            {save.saved ? (
              <Banner testID={TID.saved} tone="ok" body={save.saved} />
            ) : null}
            {save.refusal ? (
              <Banner
                testID={TID.refusal}
                tone="error"
                title={save.refusal.title}
                body={save.refusal.body}
              />
            ) : null}
            {!save.saved ? (
              <Button
                testID={TID.saveDriver}
                label="Save this driver"
                kind="secondary"
                loading={save.busy}
                onPress={save.onSave}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

export function ReceiptContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } =
    useRoute<RouteProp<MarketplaceStackParamList, "Receipt">>();
  const requestId = params.requestId;
  const saveOn = useFlag("marketplace_preferred_drivers");
  const keys = useIdempotencyKeys("favsave");
  const q = useQuery({
    queryKey: ["mp", "receipt", requestId],
    queryFn: () => marketplaceApi.receipt(requestId),
    retry: false,
  });
  const [saved, setSaved] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const save = useMutation({
    mutationFn: () =>
      marketplaceApi.saveFavourite(requestId, keys.keyFor("save:" + requestId)),
    onSuccess: (f) => {
      keys.settle("save:" + requestId);
      track("mp_favourite_saved", {});
      setRefusal(null);
      setSaved(
        (f.driverProfile.displayName ?? f.driver.displayName) +
          " is saved. When you set a fare you can ask them first — they may not always be available.",
      );
    },
    onError: (e) => {
      keys.settle("save:" + requestId, e);
      setRefusal(refusalFor(e));
    },
  });
  if (q.data)
    return (
      <ReceiptView
        receipt={q.data}
        save={
          saveOn
            ? {
                busy: save.isPending,
                onSave: () => save.mutate(),
                saved,
                refusal,
              }
            : null
        }
        onBack={nav.goBack}
      />
    );
  const reason = errorReason(q.error);
  const pendingState =
    q.error instanceof ApiError && q.error.status === 409
      ? reason === "settling"
        ? {
            testID: TID.settling,
            title: "Your receipt is being finalised",
            body: "A change to this trip is still settling. The receipt appears once every amount is final — nothing is estimated in the meantime.",
          }
        : {
            testID: TID.notCompleted,
            title: "No receipt yet",
            body: "A receipt is issued when the trip is completed.",
          }
      : null;
  return (
    <Screen title="Receipt" onBack={nav.goBack}>
      <View testID={TID.screen} style={{ gap: 12 }}>
        {q.isPending ? (
          <LoadingBlocks heights={[160, 90, 90]} />
        ) : pendingState ? (
          <View style={{ gap: 12 }}>
            <Banner
              testID={pendingState.testID}
              tone="info"
              title={pendingState.title}
              body={pendingState.body}
            />
            <Button
              testID={TID.retry}
              label="Check again"
              kind="secondary"
              onPress={() => void q.refetch()}
            />
          </View>
        ) : (
          <LoadFailure
            offline={isOffline(q.error)}
            title="Couldn’t load this receipt"
            body={
              q.error instanceof ApiError && q.error.status === 404
                ? "There’s no receipt for this trip on your account."
                : ((q.error as Error)?.message ?? "")
            }
            onRetry={() => void q.refetch()}
            testIDs={TID}
          />
        )}
      </View>
    </Screen>
  );
}
