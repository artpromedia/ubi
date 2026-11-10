// Wallet.TopUp (CC-B03 / P0-03): flag-gated standalone wallet top-up against
// POST /v1/wallet/topups. Both `provider_payments` (live PSP rail) and
// `wallet_p2p` (server topups.ts guard) must be enabled for the rider's city;
// otherwise FlagGate shows the honest "not available here yet" screen.
// Amounts are packaged by lib/moneyInput.ts — zero client-side fee or math.
import React, { useEffect, useRef, useState } from "react";
import { View, TextInput, type TextStyle } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  track,
  useCityConfig,
  type CityPaymentMethod,
} from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import {
  Banner,
  Button,
  Card,
  Chip,
  FlagGate,
  MoneyText,
  Row,
  Screen,
  StatusPill,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import { walletApi, type TopupResult } from "../../api/wallet";
import { LoadingState, ErrorState } from "../../components/states";
import { typedDigits, typedMajorToMoney } from "../../lib/moneyInput";

const METHOD_LABELS: Record<string, string> = {
  card: "Card",
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  ussd: "USSD",
};

const labelForMethod = (id: string): string =>
  METHOD_LABELS[id] ??
  id
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");

const newAttemptKey = (): string =>
  "idem_topup_" +
  Date.now().toString(36) +
  "_" +
  Math.random().toString(36).slice(2, 10);

function TopUpBody() {
  const t = useTheme();
  const qc = useQueryClient();
  const nav = useNavigation<{
    goBack: () => void;
    navigate: (n: string) => void;
  }>();
  const { config, status: configStatus } = useCityConfig();
  const walletQ = useQuery({
    queryKey: ["wallet", "overview"],
    queryFn: walletApi.overview,
  });

  const externalMethods: readonly CityPaymentMethod[] = (
    config?.paymentMethods ?? []
  ).filter((m) => m.id !== "cash" && m.id !== "wallet");
  const availableMethods = externalMethods.filter((m) => m.available);
  const unavailableMethods = externalMethods.filter((m) => !m.available);

  const [methodId, setMethodId] = useState<string>("");
  const [amountRaw, setAmountRaw] = useState<string>("");
  const [outcome, setOutcome] = useState<TopupResult | null>(null);
  const attemptKeyRef = useRef<string>(newAttemptKey());

  useEffect(() => {
    if (!methodId && availableMethods.length > 0) {
      setMethodId(availableMethods[0].id);
    }
  }, [methodId, availableMethods]);

  const currency = walletQ.data?.currency ?? config?.currency;
  const packaged = currency ? typedMajorToMoney(amountRaw, currency) : null;

  const topup = useMutation({
    mutationFn: async () => {
      if (!packaged || !methodId) {
        throw new Error("Choose a payment method and enter an amount");
      }
      return walletApi.createTopup(
        { methodId, amountMinor: packaged.amountMinor },
        attemptKeyRef.current,
      );
    },
    onSuccess: (result) => {
      track("rider_wallet_topup_submitted", {
        status: result.status,
        methodId,
      });
      setOutcome(result);
      attemptKeyRef.current = newAttemptKey();
      void qc.invalidateQueries({ queryKey: ["wallet", "overview"] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        attemptKeyRef.current = newAttemptKey();
      }
    },
  });

  if (walletQ.isError) {
    return (
      <Screen title="Top up wallet" onBack={nav.goBack}>
        <ErrorState
          error={walletQ.error}
          onRetry={() => void walletQ.refetch()}
        />
      </Screen>
    );
  }

  if (!walletQ.data || configStatus === "loading" || !currency) {
    return (
      <Screen title="Top up wallet" onBack={nav.goBack}>
        <LoadingState />
      </Screen>
    );
  }

  if (outcome) {
    return (
      <Screen
        title="Top-up status"
        onBack={nav.goBack}
        footer={
          <Button
            testID="wallet.topup.done"
            label="Back to wallet"
            accessibilityLabel="Back to wallet"
            onPress={() => nav.navigate("Home")}
          />
        }
      >
        <Card emphasis testID="wallet.topup.outcome">
          <StatusPill
            status={outcome.status === "captured" ? "done" : "processing"}
            suffix={outcome.status}
          />
          <Row
            label="Amount added"
            value={<MoneyText money={outcome.amount} variant="bodyStrong" />}
          />
          <Row
            label="Updated balance"
            value={
              <MoneyText money={outcome.balanceAfter} variant="bodyStrong" />
            }
            last
          />
        </Card>
      </Screen>
    );
  }

  const walletLocked = walletQ.data.locked;
  const canSubmit =
    !walletLocked &&
    Boolean(methodId) &&
    Boolean(packaged && packaged.amountMinor > 0) &&
    !topup.isPending;

  return (
    <Screen
      title="Top up wallet"
      subtitle="Funds settle in your city currency once captured by the payment provider"
      onBack={nav.goBack}
      footer={
        <Button
          testID={TEST_IDS.wallet.topup.confirm}
          label="Top up wallet"
          accessibilityLabel="Top up wallet"
          disabled={!canSubmit}
          loading={topup.isPending}
          onPress={() => topup.mutate()}
        />
      }
    >
      <Card>
        <Text variant="label" tone="text2">
          Current balance
        </Text>
        <MoneyText money={walletQ.data.balance} variant="heading" />
        {walletQ.data.limits.balanceCap ? (
          <Text variant="caption" tone="text3">
            Tier {walletQ.data.tier} balance cap:{" "}
            <MoneyText
              money={walletQ.data.limits.balanceCap}
              variant="caption"
            />
          </Text>
        ) : null}
      </Card>

      {walletLocked ? (
        <Banner
          tone="error"
          title="Wallet frozen"
          body="This wallet is locked. Contact UBI support to unlock it before adding funds."
        />
      ) : null}

      <Card>
        <Text variant="label" tone="text2">
          Payment method
        </Text>
        {availableMethods.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {availableMethods.map((m) => (
              <Chip
                key={m.id}
                testID={"wallet.topup.method." + m.id}
                label={labelForMethod(m.id)}
                selected={methodId === m.id}
                onPress={() => {
                  setMethodId(m.id);
                  attemptKeyRef.current = newAttemptKey();
                }}
              />
            ))}
          </View>
        ) : (
          <Banner
            tone="warn"
            title="No top-up method available"
            body="Card and bank transfer top-ups aren’t available in your city right now."
          />
        )}
        {unavailableMethods.map((m) => (
          <Text
            key={m.id}
            testID={"wallet.topup.unavailable." + m.id}
            variant="caption"
            tone="text3"
          >
            {labelForMethod(m.id)} unavailable:{" "}
            {m.reason ?? "Not enabled in this city right now."}
          </Text>
        ))}
      </Card>

      <Card>
        <Text variant="label" tone="text2">
          Amount ({currency} whole units)
        </Text>
        <TextInput
          testID="wallet.topup.amount"
          accessibilityLabel={"Amount in " + currency}
          value={amountRaw}
          onChangeText={(raw) => {
            setAmountRaw(typedDigits(raw));
            attemptKeyRef.current = newAttemptKey();
          }}
          keyboardType="number-pad"
          placeholder="5000"
          placeholderTextColor={t.colors.text3}
          style={[
            t.type.heading as TextStyle,
            {
              color: t.colors.text,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.border,
              paddingVertical: 10,
            },
          ]}
        />
        {packaged ? (
          <Row
            label="You’ll add"
            value={<MoneyText money={packaged} variant="bodyStrong" />}
            last
          />
        ) : null}
      </Card>

      {topup.isError ? (
        <Banner
          tone="error"
          title="Top-up didn’t go through"
          body={
            topup.error instanceof ApiError
              ? topup.error.message
              : "Connection lost. Tap Top up wallet again — your request key is saved so retrying won’t charge twice."
          }
        />
      ) : null}
    </Screen>
  );
}

export function TopUpScreen() {
  const nav = useNavigation<{
    goBack: () => void;
    canGoBack?: () => boolean;
    navigate: (n: string) => void;
  }>();
  const dismiss = () => {
    if (nav.canGoBack && nav.canGoBack()) nav.goBack();
    else nav.navigate("Home");
  };
  return (
    <FlagGate
      flag="provider_payments"
      featureName="Wallet top-up"
      onDismiss={dismiss}
    >
      <FlagGate
        flag="wallet_p2p"
        featureName="Wallet top-up"
        onDismiss={dismiss}
      >
        <TopUpBody />
      </FlagGate>
    </FlagGate>
  );
}
