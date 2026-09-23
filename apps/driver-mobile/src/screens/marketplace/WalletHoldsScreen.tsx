// Design handoff D04 (handoff-marketplace/rn/driver/WalletHoldsScreen.tsx), adapted only
// for repo imports and contracts TEST_IDS. Total / held / spendable are three server
// numbers rendered verbatim — the client never derives one from the others.
import React from "react";
import { View } from "react-native";
import {
  Screen,
  Text,
  Card,
  Button,
  Banner,
  Chip,
  Row,
  StatusPill,
  MoneyText,
  useTheme,
} from "@ubi/mobile-ui";
import { accessibleMoney, type Money } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";

/** D04. Spendable = cleared − active holds (server-computed, single source). UI never marks a top-up complete. */
export type WalletHold = {
  bidId: string;
  title: string;
  amountMinor: Money;
  releaseCondition: string;
};
export type TopupRow = {
  label: string;
  state: "pending" | "cleared" | "failed";
};
export type WalletHoldsProps = {
  totalMinor: Money;
  heldMinor: Money;
  spendableMinor: Money; // server
  holds: WalletHold[];
  shortfall: null | { title: string; detail: string }; // exact amount phrased by server
  topupPresets: string[];
  topups: TopupRow[];
  returnTo: null | { label: string; onPress: () => void }; // "Back to request · still open 3:41" — only if still open
  onTopUp: (preset: string) => void;
  onBack: () => void; // repo addition: WalletHolds is a Root screen (task D), it needs a way back
  // A03 (DriverWallet): the next committed future booking and what the server says the
  // driver keeps from it — separate from spendable and held, never added to either.
  nextBooking: null | {
    windowLabel: string;
    netMinor: Money;
    onOpen: () => void;
  };
};

export function WalletHoldsScreen(p: WalletHoldsProps) {
  const t = useTheme();
  return (
    <Screen title="Wallet" onBack={p.onBack} bg="bg2">
      {p.shortfall ? (
        <Banner
          tone="error"
          title={p.shortfall.title}
          body={p.shortfall.detail}
        />
      ) : null}
      <Card>
        <Text variant="label" tone="text2">
          Total balance
        </Text>
        <MoneyText money={p.totalMinor} variant="money" />
        <View style={{ flexDirection: "row", gap: 16, marginTop: 10 }}>
          <View
            style={{
              flex: 1,
              backgroundColor: t.colors.bg2,
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: t.radius.control,
              padding: 10,
            }}
          >
            <Text variant="caption" tone="warnInk">
              Held for bids
            </Text>
            <MoneyText
              testID={TEST_IDS.mp.driver.wallet.held}
              money={p.heldMinor}
              variant="heading"
            />
          </View>
          <View
            style={{
              flex: 1,
              backgroundColor: t.colors.bg2,
              borderWidth: 1,
              borderColor: t.colors.border,
              borderRadius: t.radius.control,
              padding: 10,
            }}
          >
            <Text variant="caption" tone="ok">
              Spendable
            </Text>
            <MoneyText
              testID={TEST_IDS.mp.driver.wallet.spendable}
              money={p.spendableMinor}
              variant="heading"
            />
          </View>
        </View>
      </Card>
      {p.nextBooking ? (
        <Card testID={TEST_IDS.mp.driver.wallet.nextBooking}>
          <Row
            label={"Next booking · " + p.nextBooking.windowLabel}
            value={
              <MoneyText
                money={p.nextBooking.netMinor}
                variant="bodySmStrong"
                tone="ok"
              />
            }
            onPress={p.nextBooking.onOpen}
            // A pressable row is read by its label alone, so the amount must be in it.
            accessibilityLabel={
              "Next booking, " +
              p.nextBooking.windowLabel +
              ", you keep " +
              accessibleMoney(p.nextBooking.netMinor) +
              ". Open your bookings."
            }
            last
          />
          <Text variant="caption" tone="text3">
            What you keep from it. Its commission was captured once at selection
            and isn’t part of the holds below.
          </Text>
        </Card>
      ) : null}
      <Text variant="label" tone="text2">
        Active holds
      </Text>
      <Card>
        {p.holds.map((h, i) => (
          <Row
            key={h.bidId}
            testID={dynamicTestId(TEST_IDS.mp.driver.wallet.hold, h.bidId)}
            last={i === p.holds.length - 1}
          >
            <View style={{ flex: 1 }}>
              <Text variant="bodySmStrong">{h.title}</Text>
              <Text variant="caption" tone="text3">
                {h.releaseCondition}
              </Text>
            </View>
            <MoneyText
              money={h.amountMinor}
              variant="bodySmStrong"
              tone="warnInk"
            />
          </Row>
        ))}
        {p.holds.length === 0 ? (
          <Text variant="caption" tone="text3">
            No active holds — every released fee is already back in spendable.
          </Text>
        ) : null}
      </Card>
      <Banner
        tone="neutral"
        body="Each live offer reserves its own fee. Pending top-ups and future earnings don’t count as spendable."
      />
      <View style={{ flexDirection: "row", gap: 8 }}>
        {p.topupPresets.map((label, i) => (
          <Chip
            key={label}
            label={label}
            testID={dynamicTestId(TEST_IDS.mp.driver.wallet.topup, i)}
            onPress={() => p.onTopUp(label)}
          />
        ))}
      </View>
      {p.topups.length ? (
        <Card>
          {p.topups.map((tp, i) => (
            <Row
              key={tp.label}
              label={tp.label}
              last={i === p.topups.length - 1}
              value={
                <StatusPill
                  status={
                    tp.state === "cleared"
                      ? "done"
                      : tp.state === "failed"
                        ? "failed"
                        : "processing"
                  }
                  suffix={tp.state}
                />
              }
            />
          ))}
        </Card>
      ) : null}
      {p.returnTo ? (
        <Button
          testID={TEST_IDS.mp.driver.wallet.backToRequest}
          label={p.returnTo.label}
          onPress={p.returnTo.onPress}
        />
      ) : null}
    </Screen>
  );
}
