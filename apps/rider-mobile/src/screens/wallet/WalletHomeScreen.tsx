// Wallet.Home (C05 / G12, CC-B03): a read view of GET /v1/wallet, plus a
// flag-gated entry to Wallet.TopUp when both `provider_payments` and
// `wallet_p2p` are enabled for the rider's city. Balance, limits and safety
// states are server Money/flags rendered verbatim.
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useFlag } from "@ubi/mobile-core";
import {
  Screen,
  Text,
  Card,
  Row,
  Banner,
  Button,
  MoneyText,
} from "@ubi/mobile-ui";
import { walletApi } from "../../api/wallet";
import { LoadingState, ErrorState } from "../../components/states";

export function WalletHomeScreen() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
  }>();
  const providerPaymentsOn = useFlag("provider_payments");
  const walletP2pOn = useFlag("wallet_p2p");
  const canTopUp = providerPaymentsOn && walletP2pOn;
  const q = useQuery({
    queryKey: ["wallet", "overview"],
    queryFn: walletApi.overview,
    refetchInterval: 30_000,
  });
  const w = q.data;
  return (
    <Screen title="Wallet">
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !w ? (
        <LoadingState />
      ) : (
        <>
          <Card emphasis testID="rider.wallet.balance">
            <Text variant="label" tone="text2">
              Balance
            </Text>
            <MoneyText money={w.balance} variant="display" />
            <Text variant="caption" tone="text3">
              Tier {w.tier} · {w.currency}
            </Text>
          </Card>
          {w.locked ? (
            <Banner
              tone="error"
              title="Wallet frozen"
              body="This wallet is locked. Unlocking is done by UBI support, not in the app."
            />
          ) : null}
          {w.safeMode.active ? (
            <Banner
              tone="warn"
              title="Safe mode"
              body={
                "Money movement is held" +
                (w.safeMode.until
                  ? " until " + new Date(w.safeMode.until).toLocaleString()
                  : "") +
                " after a security signal."
              }
            />
          ) : null}
          <Card>
            <Text variant="label" tone="text2">
              Today’s limits — set by your tier
            </Text>
            <Row
              label="Sent today"
              value={
                <MoneyText money={w.limits.usedToday} variant="bodySmStrong" />
              }
            />
            <Row
              label="Remaining today"
              value={
                <MoneyText
                  money={w.limits.remainingToday}
                  variant="bodySmStrong"
                />
              }
            />
            <Row
              label="Per transfer"
              value={
                <MoneyText
                  money={w.limits.singleTransfer}
                  variant="bodySmStrong"
                />
              }
              last
            />
          </Card>
          {canTopUp && !w.locked ? (
            <Button
              testID="rider.wallet.topup"
              label="Top up wallet"
              accessibilityLabel="Top up wallet"
              onPress={() => nav.navigate("TopUp")}
            />
          ) : null}
          <Button
            testID="rider.wallet.statement"
            label="View statement"
            kind="secondary"
            accessibilityLabel="View statement"
            onPress={() => nav.navigate("Statement")}
          />
          <Text variant="caption" tone="text3" align="center">
            {canTopUp
              ? "Sending money and PIN changes aren’t in this app yet."
              : "Sending money, top-ups and PIN changes aren’t in this app yet."}
          </Text>
        </>
      )}
    </Screen>
  );
}
