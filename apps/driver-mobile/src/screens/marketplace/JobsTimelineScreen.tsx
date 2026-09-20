// Design handoff D05 + D11 (handoff-marketplace/rn/driver/JobsTimelineScreen.tsx), adapted
// only for repo imports and contracts TEST_IDS. The winner card renders ONLY when the
// server has a durable award.confirmed — never from a local guess.
import React from "react";
import { View } from "react-native";
import {
  Screen,
  Text,
  Card,
  Button,
  Banner,
  Row,
  StatusPill,
  MoneyText,
  useTheme,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";

/** D05 + D11. Winner card renders ONLY on durable award.confirmed (assignment + fee debit atomic).
 * Queued job: no pickup navigation until claim promotion after the current job truly completes. */
export type JobCard = {
  claimId: string;
  slot: "current" | "next";
  statusSuffix: string; // "in trip" | "queued"
  title: string;
  fareMinor: Money;
  feeLine: string;
  feeReceiptId: string; // "Fee ₦280 · debited at selection"
  detail: string; // "Pickup commitment 12–18 min · rider sees live updates"
  remainingLabel: string | null; // current only
};
export type JobsTimelineProps = {
  winnerToast: null | {
    title: string;
    fareMinor: Money;
    feeLine: string;
    receiptLine: string;
    addressesLine: string;
    onNavigate: () => void;
  };
  current: JobCard | null;
  next: JobCard | null;
  promotion: null | "pending" | "failed_revalidating"; // after current completes
  onContinueCurrent: () => void;
  onBack: () => void; // repo addition: Jobs is a Root screen (task D), it needs a way back
};

export function JobsTimelineScreen(p: JobsTimelineProps) {
  const t = useTheme();
  return (
    <Screen title="Your jobs" onBack={p.onBack} bg="bg2">
      {p.winnerToast ? (
        <Card emphasis testID={TEST_IDS.mp.driver.jobs.current}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text variant="heading" style={{ flex: 1 }}>
              {p.winnerToast.title}
            </Text>
            <StatusPill status="assigned" />
          </View>
          <Row
            label="Agreed fare · fixed"
            value={
              <MoneyText money={p.winnerToast.fareMinor} variant="heading" />
            }
          />
          <Row
            label="Service fee 10% · debited now"
            value={p.winnerToast.feeLine}
            valueTone="errorInk"
          />
          <Row
            label="Receipt"
            value={
              <Text variant="mono" tone="text2">
                {p.winnerToast.receiptLine}
              </Text>
            }
            last
          />
          <Text variant="caption" tone="text2">
            {p.winnerToast.addressesLine}
          </Text>
          <Banner
            tone="neutral"
            body="No second fee at completion — cash or wallet, you keep the full fare when the trip ends."
          />
          <Button
            label="Navigate to pickup"
            onPress={p.winnerToast.onNavigate}
            style={{ marginTop: 10 }}
          />
        </Card>
      ) : null}
      {p.current ? (
        <Card emphasis testID={TEST_IDS.mp.driver.jobs.current}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <StatusPill status="active" suffix={p.current.statusSuffix} />
            {p.current.remainingLabel ? (
              <Text
                variant="caption"
                tone="text2"
                style={{ marginLeft: "auto" }}
              >
                {p.current.remainingLabel}
              </Text>
            ) : null}
          </View>
          <Text variant="bodyStrong" style={{ marginTop: 8 }}>
            {p.current.title}
          </Text>
          <Text variant="caption" tone="text2">
            {p.current.feeLine} · finish normally, no rush
          </Text>
        </Card>
      ) : null}
      {p.current && p.next ? (
        <View style={{ alignItems: "center" }}>
          <View
            style={{ width: 2, height: 18, backgroundColor: t.colors.border }}
          />
        </View>
      ) : null}
      {p.next ? (
        <Card testID={TEST_IDS.mp.driver.jobs.next}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <StatusPill status="scheduled" suffix="next · queued" />
            <Text variant="caption" tone="text2" style={{ marginLeft: "auto" }}>
              starts after current
            </Text>
          </View>
          <Text variant="bodyStrong" style={{ marginTop: 8 }}>
            {p.next.title}
          </Text>
          <Row
            label={p.next.feeLine}
            value={
              <Text
                testID={dynamicTestId(
                  TEST_IDS.mp.driver.jobs.feeReceipt,
                  p.next.claimId,
                )}
                variant="mono"
                tone="text3"
              >
                {p.next.feeReceiptId}
              </Text>
            }
            last
          />
          <Text variant="caption" tone="text2">
            {p.next.detail}
          </Text>
        </Card>
      ) : null}
      {p.promotion === "pending" ? (
        <Banner
          tone="warn"
          body="Finishing up — your next job unlocks when this one completes and eligibility re-checks."
        />
      ) : null}
      {p.promotion === "failed_revalidating" ? (
        <Banner
          tone="warn"
          body="Current trip ended early — re-checking pickup estimate from your actual location before starting the next job."
        />
      ) : null}
      <Banner
        tone="neutral"
        body="Navigation to your next pickup unlocks only when the current job completes. A third job can’t be taken — bids for either slot are blocked until one frees."
      />
      {p.current ? (
        <Button label="Continue current trip" onPress={p.onContinueCurrent} />
      ) : null}
    </Screen>
  );
}
