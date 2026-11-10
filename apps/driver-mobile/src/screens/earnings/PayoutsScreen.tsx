// Earnings.Payouts (CC-B03 / P0-03): flag-gated driver wallet & payout history
// view (`provider_payments`). Shows server-computed cleared/spendable/held
// balances verbatim, recent bank payouts and audited ops credits from
// GET /v1/wallet/statements, and navigates to Cashout when `wallet_nip` is on.
import React from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useCityConfig, useFlag } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import {
  Banner,
  Button,
  Card,
  FlagGate,
  MoneyText,
  Row,
  Screen,
  Text,
} from "@ubi/mobile-ui";
import {
  driverWalletApi,
  statementLineMoney,
  type WalletStatementLine,
} from "../../api/wallet";
import { EmptyState, ErrorState, LoadingState } from "../../components/states";

const PAYOUT_AND_CREDIT_KINDS = new Set([
  "nip_transfer",
  "nip_reversal",
  "ops_driver_credit",
  "ops_driver_credit_reversal",
  "payout",
]);

const KIND_LABELS: Record<string, string> = {
  nip_transfer: "Bank cash-out",
  nip_reversal: "Bank cash-out reversed",
  ops_driver_credit: "UBI ops wallet credit",
  ops_driver_credit_reversal: "UBI ops credit reversal",
  payout: "Payout",
};

const labelForLine = (line: WalletStatementLine): string =>
  line.description ?? KIND_LABELS[line.kind] ?? line.kind;

const recentRange = (): { from: string; to: string } => {
  const now = new Date();
  const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: past.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
};

function PayoutsBody() {
  const nav = useNavigation<{
    goBack: () => void;
    navigate: (n: string) => void;
  }>();
  const { config } = useCityConfig();
  const cityId = config?.cityId;
  const nipEnabled = useFlag("wallet_nip");
  const range = React.useMemo(recentRange, []);

  const walletQ = useQuery({
    queryKey: ["driver", "wallet", "overview"],
    queryFn: driverWalletApi.overview,
  });

  const mpQ = useQuery({
    queryKey: ["driver", "wallet", "mpOverview", cityId ?? null],
    queryFn: () => driverWalletApi.mpOverview(cityId!),
    enabled: Boolean(cityId),
    retry: false,
  });

  const statementQ = useQuery({
    queryKey: ["driver", "wallet", "statement", range.from, range.to],
    queryFn: () => driverWalletApi.statement(range.from, range.to),
    retry: false,
  });

  if (walletQ.isError) {
    return (
      <Screen title="Payouts" onBack={nav.goBack}>
        <ErrorState
          error={walletQ.error}
          onRetry={() => void walletQ.refetch()}
        />
      </Screen>
    );
  }

  const w = walletQ.data;
  if (!w) {
    return (
      <Screen title="Payouts" onBack={nav.goBack}>
        <LoadingState />
      </Screen>
    );
  }

  const relevantLines = (statementQ.data?.lines ?? []).filter((line) =>
    PAYOUT_AND_CREDIT_KINDS.has(line.kind),
  );
  const canCashOut = nipEnabled && !w.locked && !w.safeMode.active;

  return (
    <Screen
      title="Payouts"
      subtitle="Cleared wallet balance, active commission holds, and bank payouts"
      onBack={nav.goBack}
    >
      <Card emphasis testID="driver.payouts.balance">
        <Text variant="label" tone="text2">
          Wallet balance
        </Text>
        <MoneyText money={w.balance} variant="display" />
        <Text variant="caption" tone="text3">
          Tier {w.tier} · {w.currency}
        </Text>
      </Card>

      {mpQ.data ? (
        <Card testID="driver.payouts.mpBalances">
          <Text variant="label" tone="text2">
            Commission &amp; spendable summary
          </Text>
          <Row
            label="Spendable now"
            value={
              <MoneyText
                money={mpQ.data.spendableMinor}
                variant="bodySmStrong"
              />
            }
          />
          <Row
            label="Held on active offers"
            value={
              <MoneyText money={mpQ.data.heldMinor} variant="bodySmStrong" />
            }
          />
          <Row
            label="Remaining daily bank limit"
            value={
              <MoneyText
                money={w.limits.remainingToday}
                variant="bodySmStrong"
              />
            }
            last
          />
        </Card>
      ) : null}

      {w.locked ? (
        <Banner
          tone="error"
          title="Wallet frozen"
          body="This wallet is locked. Contact UBI support to unlock it before requesting a payout."
        />
      ) : null}

      {w.safeMode.active ? (
        <Banner
          tone="warn"
          title="Safe mode active"
          body={
            "Bank cash-outs are paused" +
            (w.safeMode.until
              ? " until " + new Date(w.safeMode.until).toLocaleString()
              : "") +
            " following a security check."
          }
        />
      ) : null}

      {nipEnabled ? (
        <Button
          testID={TEST_IDS.driver.earnings.cashout}
          label="Cash out to bank"
          accessibilityLabel="Cash out to bank"
          disabled={!canCashOut}
          onPress={() => nav.navigate("Cashout")}
        />
      ) : (
        <Banner
          tone="info"
          title="Instant bank cash-out isn’t enabled here yet"
          body="Direct NIP bank payouts aren’t switched on in your city right now."
        />
      )}

      <Text variant="label" tone="text2">
        Last 30 days — payouts &amp; wallet credits
      </Text>
      {statementQ.isLoading ? (
        <LoadingState lines={2} />
      ) : statementQ.isError ? (
        <ErrorState
          error={statementQ.error}
          onRetry={() => void statementQ.refetch()}
          title="Couldn’t load recent payout lines"
        />
      ) : relevantLines.length === 0 ? (
        <Card>
          <EmptyState
            title="No payouts or ops credits yet"
            body="Bank cash-outs and UBI commission credits from the last 30 days will appear here."
          />
        </Card>
      ) : (
        <Card testID="driver.payouts.history" style={{ paddingVertical: 2 }}>
          {relevantLines.map((line, idx) => (
            <Row key={line.lineId} last={idx === relevantLines.length - 1}>
              <View style={{ flex: 1, gap: 2 }}>
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text variant="bodySmStrong">{labelForLine(line)}</Text>
                  <MoneyText
                    money={statementLineMoney(
                      statementQ.data!,
                      line.amountMinor,
                    )}
                    variant="bodySmStrong"
                    signed
                  />
                </View>
                <Text variant="caption" tone="text3">
                  {new Date(line.occurredAt).toLocaleString("en-NG", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    hour12: false,
                  })}
                </Text>
              </View>
            </Row>
          ))}
        </Card>
      )}
    </Screen>
  );
}

export function PayoutsScreen() {
  const nav = useNavigation<{
    goBack: () => void;
    canGoBack?: () => boolean;
    navigate: (n: string) => void;
  }>();
  const dismiss = () => {
    if (nav.canGoBack && nav.canGoBack()) nav.goBack();
    else nav.navigate("Main");
  };
  return (
    <FlagGate
      flag="provider_payments"
      featureName="Payouts"
      onDismiss={dismiss}
    >
      <PayoutsBody />
    </FlagGate>
  );
}
