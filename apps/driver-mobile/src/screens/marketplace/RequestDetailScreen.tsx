// Design handoff D02 + D03 + D10 (handoff-marketplace/rn/driver/RequestDetailScreen.tsx),
// adapted for repo imports and contracts TEST_IDS. One repo addition, documented on the
// props: `spendableError` (task B) — the exact server-phrased insufficient_spendable
// rejection with a path to WalletHolds. Everything money-shaped on this screen arrives
// phrased from the server; the client renders it verbatim.
import React from "react";
import { View, Pressable } from "react-native";
import {
  Screen,
  Text,
  Card,
  Button,
  Banner,
  Row,
  MoneyText,
  useTheme,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { MpEarningsBreakdown } from "../../api/marketplace";
import { EarningsBreakdownCard } from "./EarningsBreakdownCard";
import { MP_DRIVER_TID } from "./testIds";

/** D02 + D03 + D10. Presets are SERVER-generated (deduplicated, in-bounds, affordability-checked).
 * Client never computes fee/net — labels arrive phrased from the server. */
export type Preset = {
  key: string;
  title: string; // "Offer ₦2,800 · rider's price"
  feeNetLabel: string; // "fee ₦280 · you keep ₦2,520"
  affordable: boolean;
  shortfallLabel: string | null; // "Needs ₦260 spendable — you have ₦190"
  emphasized: boolean;
  // A04.1: the server's breakdown at THIS preset's amount (null from an older server).
  earnings: MpEarningsBreakdown | null;
};
export type EligibilityReason = { code: string; title: string; detail: string }; // from server evaluator
export type RequestDetailProps = {
  kind: "ride" | "delivery";
  pickupArea: string;
  dropoffArea: string;
  meta: string;
  askedMinor: Money;
  profileLine: string | null; // "Your rate profile · ₦300/km → calculates ₦3,000"
  ceilingNotice: string | null; // D09b: "Your calculated offer exceeds this request's limit…"
  // A04.1: the full breakdown at the requester's fare, verbatim from the server.
  earnings: MpEarningsBreakdown | null;
  // A04.2: a saved preference this request cannot meet, server-phrased.
  preferenceNotice: string | null;
  // A03: a future-booking request — its pickup window and the server's notice
  // (a driver is never "secured" before the requester's award).
  booking: null | {
    kind: "scheduled" | "advance";
    windowLabel: string;
    notice: string;
  };
  // A03: what an advance bid commits the wallet to, explained BEFORE bidding
  // (server MpAdvanceCommitment; the commission is the server's figure).
  advanceCommitment: null | {
    commissionMinor: Money;
    holdLabel: string;
    terms: string[];
  };
  presets: Preset[];
  onBid: (key: string) => void;
  stationary: boolean;
  onCustom: () => void;
  onSkip: () => void;
  onTopUp: () => void;
  blocked: EligibilityReason[] | null; // D10: when non-null, offer controls are not rendered
  myBid: null | {
    version: number;
    amountMinor: Money;
    holdLabel: string;
    netLabel: string;
    closesLabel: string;
    revising: boolean;
    onRevise: () => void;
    onWithdraw: () => void;
  };
  // Repo addition (task B): server insufficient_spendable rejection, verbatim, with the WalletHolds path.
  spendableError: null | {
    title: string;
    detail: string;
    walletLabel: string;
    onWallet: () => void;
  };
  // Any other submit/revise rejection, server message verbatim — never a silent refetch.
  bidError: null | { title: string; detail: string };
};

export function RequestDetailScreen(p: RequestDetailProps) {
  const t = useTheme();
  return (
    <Screen
      title={p.kind === "ride" ? "Ride request" : "Delivery request"}
      onBack={p.onSkip}
      bg="bg2"
    >
      <Card>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 40,
          }}
        >
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              backgroundColor: t.colors.primary,
            }}
          />
          <Text variant="body">{p.pickupArea}</Text>
        </View>
        <View
          style={{
            height: 1,
            backgroundColor: t.colors.divider,
            marginLeft: 22,
          }}
        />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 40,
          }}
        >
          <View
            style={{ width: 10, height: 10, backgroundColor: t.colors.text }}
          />
          <Text variant="body">{p.dropoffArea}</Text>
        </View>
        <Text variant="caption" tone="text2">
          {p.meta}
        </Text>
      </Card>
      <Card>
        <Row
          label={p.kind === "ride" ? "Rider asks" : "Sender asks"}
          value={<MoneyText money={p.askedMinor} variant="heading" />}
          last={!p.profileLine}
        />
        {p.profileLine ? (
          <Row label="Your rate profile" value={p.profileLine} last />
        ) : null}
      </Card>
      {p.booking ? (
        <Card testID={MP_DRIVER_TID.detail.bookingWindow}>
          <Text variant="label" tone="text2">
            {p.booking.kind === "advance"
              ? "Advance booking · future pickup"
              : "Scheduled pickup"}
          </Text>
          <Text variant="bodyStrong">{p.booking.windowLabel}</Text>
          <Text variant="caption" tone="text2">
            {p.booking.notice}
          </Text>
        </Card>
      ) : null}
      {p.advanceCommitment ? (
        <Card testID={MP_DRIVER_TID.detail.advanceTerms}>
          <Text variant="label" tone="text2">
            What an advance offer commits
          </Text>
          <Row
            label="Held from your cleared balance"
            value={
              <MoneyText
                money={p.advanceCommitment.commissionMinor}
                variant="bodySmStrong"
              />
            }
          />
          <Row label="Captured" value="once, only if the rider selects you" />
          <Row label="When the trip starts" value="not charged again" />
          <Row label="Hold" value={p.advanceCommitment.holdLabel} last />
          {p.advanceCommitment.terms.map((term, i) => (
            <Text key={i} variant="caption" tone="text2">
              {"• " + term}
            </Text>
          ))}
          <Text variant="caption" tone="text3">
            Shown at the rider’s price; each offer below states its own fee. If
            the booking fails or is cancelled, the commission comes back as a
            linked reversal.
          </Text>
        </Card>
      ) : null}
      {p.earnings ? (
        <Card>
          <Text variant="label" tone="text2">
            Your earnings at the requester’s price
          </Text>
          <EarningsBreakdownCard earnings={p.earnings} variant="full" />
        </Card>
      ) : null}
      {p.preferenceNotice ? (
        <Banner
          testID={MP_DRIVER_TID.detail.preferenceNotice}
          tone="neutral"
          title="Outside your preferences"
          body={p.preferenceNotice}
        />
      ) : null}
      {p.bidError ? (
        <Banner
          tone="error"
          title={p.bidError.title}
          body={p.bidError.detail}
        />
      ) : null}
      {p.spendableError ? (
        <>
          <Banner
            tone="error"
            title={p.spendableError.title}
            body={p.spendableError.detail}
          />
          <Button
            label={p.spendableError.walletLabel}
            kind="secondary"
            size="md"
            onPress={p.spendableError.onWallet}
          />
        </>
      ) : null}
      {p.blocked ? (
        <>
          <Text variant="label" tone="text2">
            Why you can’t bid right now
          </Text>
          {p.blocked.map((r) => (
            <Card
              key={r.code}
              testID={dynamicTestId(TEST_IDS.mp.driver.detail.reason, r.code)}
            >
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Text variant="bodySmStrong" style={{ flex: 1 }}>
                  {r.title}
                </Text>
                <Text variant="mono" tone="text3">
                  {r.code}
                </Text>
              </View>
              <Text variant="caption" tone="text2">
                {r.detail}
              </Text>
            </Card>
          ))}
        </>
      ) : p.myBid ? (
        <>
          <Card testID={TEST_IDS.mp.driver.bid.status}>
            <Row
              label={"Your offer · v" + p.myBid.version}
              value={
                <MoneyText money={p.myBid.amountMinor} variant="heading" />
              }
            />
            <Row
              label="Fee reserved"
              value={p.myBid.holdLabel}
              valueTone="warnInk"
            />
            <Row
              label="If chosen, you keep"
              value={p.myBid.netLabel}
              valueTone="ok"
              last
            />
          </Card>
          <Banner
            tone="neutral"
            body="The requester compares offers and chooses. You stay available for other requests."
          />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button
              testID={TEST_IDS.mp.driver.bid.revise}
              label="Revise offer"
              kind="secondary"
              size="md"
              loading={p.myBid.revising}
              onPress={p.myBid.onRevise}
              style={{ flex: 1 }}
            />
            <Button
              testID={TEST_IDS.mp.driver.bid.withdraw}
              label="Withdraw"
              kind="danger"
              size="md"
              onPress={p.myBid.onWithdraw}
              style={{ flex: 1 }}
            />
          </View>
          <Text variant="caption" tone="text3">
            Raising re-reserves the difference first; lowering releases it. One
            live offer per request. Closes {p.myBid.closesLabel}.
          </Text>
        </>
      ) : (
        <>
          {p.ceilingNotice ? (
            <Banner
              tone="warn"
              title="Your calculated offer exceeds this request’s limit"
              body={p.ceilingNotice}
            />
          ) : null}
          <Text variant="label" tone="text2">
            Make an offer · fee 10%
          </Text>
          {/* Real prop fix vs the handoff: RN `disabled` would swallow onPress, making the
              "Top up" path dead. The preset stays announced as disabled-for-bidding, but the
              tap honestly routes to the wallet instead of doing nothing. */}
          {p.presets.map((c, i) => (
            <Pressable
              key={c.key}
              testID={dynamicTestId(TEST_IDS.mp.driver.detail.preset, i)}
              accessibilityRole="button"
              accessibilityState={{ disabled: !c.affordable }}
              accessibilityLabel={
                c.affordable
                  ? c.title
                  : c.title + " — needs a top-up. Opens wallet."
              }
              onPress={() => (c.affordable ? p.onBid(c.key) : p.onTopUp())}
            >
              <Card
                emphasis={c.emphasized}
                style={{
                  opacity: c.affordable ? 1 : 0.5,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{c.title}</Text>
                  {c.affordable ? (
                    <Text variant="caption" tone="text2" tabular>
                      {c.feeNetLabel}
                    </Text>
                  ) : null}
                  {c.affordable && c.earnings?.estimatedNetPerHour ? (
                    <View
                      style={{ flexDirection: "row", alignItems: "baseline" }}
                    >
                      <Text variant="caption" tone="text3">
                        ≈{" "}
                      </Text>
                      <MoneyText
                        testID={dynamicTestId(
                          MP_DRIVER_TID.detail.presetPerHour,
                          i,
                        )}
                        money={c.earnings.estimatedNetPerHour.amountMinor}
                        variant="caption"
                        tone="text3"
                      />
                      <Text variant="caption" tone="text3">
                        /h estimate
                      </Text>
                    </View>
                  ) : null}
                  {c.affordable ? null : (
                    <Text variant="caption" tone="errorInk">
                      {c.shortfallLabel}
                    </Text>
                  )}
                </View>
                <Text
                  variant="bodySmStrong"
                  tone={
                    c.affordable ? (c.emphasized ? "ok" : "text2") : "text3"
                  }
                >
                  {c.affordable ? "Bid" : "Top up"}
                </Text>
              </Card>
            </Pressable>
          ))}
          <View style={{ flexDirection: "row", gap: 10 }}>
            {p.stationary ? (
              <Button
                testID={TEST_IDS.mp.driver.detail.custom}
                label="Custom amount"
                kind="secondary"
                size="md"
                onPress={p.onCustom}
                style={{ flex: 1 }}
              />
            ) : null}
            <Button
              testID={TEST_IDS.mp.driver.detail.skip}
              label="Skip"
              kind="ghost"
              size="md"
              onPress={p.onSkip}
              style={{ flex: 1 }}
            />
          </View>
          <Text variant="caption" tone="text3" align="center">
            Bidding reserves the fee from your wallet. You’re charged only if
            the requester picks you.
          </Text>
        </>
      )}
    </Screen>
  );
}
