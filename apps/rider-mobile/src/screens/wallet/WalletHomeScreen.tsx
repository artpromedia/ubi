// Wallet.Home (C05 / G12): a read view of GET /v1/wallet. Balance, limits and
// safety states are server Money/flags rendered verbatim. Transfers, top-ups
// and PIN management exist server-side but are money-moving flows outside this
// slice — their rows say "not in this app yet" instead of implying them.
import React from "react";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
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
          <Button
            testID="rider.wallet.statement"
            label="View statement"
            kind="secondary"
            accessibilityLabel="View statement"
            onPress={() => nav.navigate("Statement")}
          />
          <Text variant="caption" tone="text3" align="center">
            Sending money, top-ups and PIN changes aren’t in this app yet.
          </Text>
        </>
      )}
    </Screen>
  );
}
