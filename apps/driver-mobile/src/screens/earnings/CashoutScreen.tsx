// Earnings.Cashout (CC-B03 / P0-03): flag-gated two-step NIP bank payout flow
// (`provider_payments` + `wallet_nip`).
// Step 1 verifies the bank account holder via GET /v1/wallet/nip/name-enquiry
// and displays the verified accountName before any money or PIN can be sent.
// Step 2 packages whole-currency digits via lib/moneyInput.ts and submits
// POST /v1/wallet/nip with a stable Idempotency-Key across network retries.
import React, { useRef, useState } from "react";
import { TextInput, type TextStyle } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, track, useCityConfig } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";
import {
  Banner,
  Button,
  Card,
  FlagGate,
  MoneyText,
  Row,
  Screen,
  StatusPill,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import {
  driverWalletApi,
  type NipEnquiryResult,
  type NipResult,
} from "../../api/wallet";
import { ErrorState, LoadingState, errorText } from "../../components/states";
import { typedDigits, typedMajorToMoney } from "../../lib/moneyInput";

const newAttemptKey = (): string =>
  "idem_nip_" +
  Date.now().toString(36) +
  "_" +
  Math.random().toString(36).slice(2, 10);

function CashoutBody() {
  const t = useTheme();
  const qc = useQueryClient();
  const nav = useNavigation<{
    goBack: () => void;
    navigate: (n: string) => void;
  }>();
  const { config } = useCityConfig();

  const walletQ = useQuery({
    queryKey: ["driver", "wallet", "overview"],
    queryFn: driverWalletApi.overview,
  });

  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [verified, setVerified] = useState<NipEnquiryResult | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [pin, setPin] = useState("");
  const [outcome, setOutcome] = useState<NipResult | null>(null);
  const attemptKeyRef = useRef<string>(newAttemptKey());

  const cleanBankCode = bankCode.replace(/\D/g, "").slice(0, 10);
  const cleanAccount = accountNumber.replace(/\D/g, "").slice(0, 10);
  const canVerifyAccount =
    cleanBankCode.length >= 3 && cleanAccount.length === 10;

  const currency = walletQ.data?.currency ?? config?.currency;
  const fractionDigits = config?.currencyFractionDigits ?? 2;
  const packaged = currency
    ? typedMajorToMoney(amountRaw, currency, fractionDigits)
    : null;

  const enquiry = useMutation({
    mutationFn: () => driverWalletApi.nameEnquiry(cleanBankCode, cleanAccount),
    onSuccess: (res) => {
      setVerified(res);
      attemptKeyRef.current = newAttemptKey();
    },
  });

  const payout = useMutation({
    mutationFn: async () => {
      if (!verified || !packaged) {
        throw new Error("Verify the bank account and enter an amount first");
      }
      return driverWalletApi.createNipPayout(
        {
          bankCode: cleanBankCode,
          accountNumber: cleanAccount,
          amountMinor: packaged.amountMinor,
          pin,
        },
        attemptKeyRef.current,
      );
    },
    onSuccess: (res) => {
      track("driver_nip_payout_submitted", { status: res.status });
      setOutcome(res);
      setPin("");
      attemptKeyRef.current = newAttemptKey();
      void qc.invalidateQueries({ queryKey: ["driver", "wallet"] });
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        attemptKeyRef.current = newAttemptKey();
      }
    },
  });

  if (walletQ.isError) {
    return (
      <Screen title="Cash out to bank" onBack={nav.goBack}>
        <ErrorState
          error={walletQ.error}
          onRetry={() => void walletQ.refetch()}
        />
      </Screen>
    );
  }

  const w = walletQ.data;
  if (!w || !currency) {
    return (
      <Screen title="Cash out to bank" onBack={nav.goBack}>
        <LoadingState />
      </Screen>
    );
  }

  if (outcome) {
    return (
      <Screen
        title="Bank payout status"
        onBack={nav.goBack}
        footer={
          <Button
            testID="wallet.nip.done"
            label="Back to payouts"
            accessibilityLabel="Back to payouts"
            onPress={() => nav.navigate("Payouts")}
          />
        }
      >
        <Card emphasis testID={TEST_IDS.wallet.nip.status}>
          <StatusPill
            status={
              outcome.status === "confirmed"
                ? "done"
                : outcome.status === "reversed"
                  ? "failed"
                  : "processing"
            }
            suffix={outcome.status}
          />
          <Row label="Recipient" value={outcome.accountName} />
          <Row
            label="Amount sent"
            value={<MoneyText money={outcome.amount} variant="bodyStrong" />}
          />
          <Row
            label="Updated wallet balance"
            value={
              <MoneyText money={outcome.balanceAfter} variant="bodyStrong" />
            }
            last
          />
        </Card>
      </Screen>
    );
  }

  const pinValid = /^\d{4,6}$/.test(pin);
  const blocked = w.locked || w.safeMode.active || !w.pinSet;
  const canSubmit =
    !blocked &&
    Boolean(verified) &&
    Boolean(packaged && packaged.amountMinor > 0) &&
    pinValid &&
    !payout.isPending;

  const inputStyle: TextStyle = {
    ...(t.type.heading as TextStyle),
    color: t.colors.text,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border,
    paddingVertical: 10,
  };

  return (
    <Screen
      title="Cash out to bank"
      subtitle="Verify the bank account holder first, then confirm with your wallet PIN"
      onBack={nav.goBack}
      footer={
        <Button
          testID={TEST_IDS.wallet.nip.confirm}
          label="Send to bank"
          accessibilityLabel="Send to bank"
          disabled={!canSubmit}
          loading={payout.isPending}
          onPress={() => payout.mutate()}
        />
      }
    >
      <Card>
        <Row
          label="Wallet balance"
          value={<MoneyText money={w.balance} variant="bodyStrong" />}
        />
        <Row
          label="Remaining today"
          value={
            <MoneyText money={w.limits.remainingToday} variant="bodySmStrong" />
          }
        />
        <Row
          label="Max per transfer"
          value={
            <MoneyText money={w.limits.singleTransfer} variant="bodySmStrong" />
          }
          last
        />
      </Card>

      {!w.pinSet ? (
        <Banner
          tone="warn"
          title="Wallet PIN required"
          body="Set a wallet PIN before sending money to a bank account."
        />
      ) : null}

      <Card>
        <Text variant="label" tone="text2">
          Step 1 — Destination bank account
        </Text>
        <Text variant="caption" tone="text3">
          Bank code (CBN 3–6 digit code)
        </Text>
        <TextInput
          testID="wallet.nip.bankCode"
          accessibilityLabel="Bank code"
          value={cleanBankCode}
          onChangeText={(raw) => {
            setBankCode(raw.replace(/\D/g, "").slice(0, 10));
            setVerified(null);
            attemptKeyRef.current = newAttemptKey();
          }}
          keyboardType="number-pad"
          placeholder="058"
          placeholderTextColor={t.colors.text3}
          style={inputStyle}
        />
        <Text variant="caption" tone="text3">
          10-digit NUBAN account number
        </Text>
        <TextInput
          testID="wallet.nip.accountNumber"
          accessibilityLabel="Account number"
          value={cleanAccount}
          onChangeText={(raw) => {
            setAccountNumber(raw.replace(/\D/g, "").slice(0, 10));
            setVerified(null);
            attemptKeyRef.current = newAttemptKey();
          }}
          keyboardType="number-pad"
          placeholder="0123456789"
          placeholderTextColor={t.colors.text3}
          style={inputStyle}
        />
        <Button
          testID="wallet.nip.verifyAccount"
          label={verified ? "Re-verify account" : "Verify account"}
          kind="secondary"
          accessibilityLabel="Verify bank account"
          disabled={!canVerifyAccount || enquiry.isPending}
          loading={enquiry.isPending}
          onPress={() => enquiry.mutate()}
        />
        {enquiry.isError ? (
          <Banner
            tone="error"
            title="Account check failed"
            body={errorText(enquiry.error)}
          />
        ) : null}
        {verified ? (
          <Card emphasis testID="wallet.nip.verifiedAccount">
            <Text variant="caption" tone="text2">
              Verified account holder
            </Text>
            <Text variant="bodyStrong">{verified.accountName}</Text>
          </Card>
        ) : null}
      </Card>

      {verified ? (
        <Card>
          <Text variant="label" tone="text2">
            Step 2 — Amount &amp; wallet PIN
          </Text>
          <Text variant="caption" tone="text3">
            Amount ({currency} whole units)
          </Text>
          <TextInput
            testID="wallet.nip.amount"
            accessibilityLabel={"Payout amount in " + currency}
            value={amountRaw}
            onChangeText={(raw) => {
              setAmountRaw(typedDigits(raw));
              attemptKeyRef.current = newAttemptKey();
            }}
            keyboardType="number-pad"
            placeholder="15000"
            placeholderTextColor={t.colors.text3}
            style={inputStyle}
          />
          {packaged ? (
            <Row
              label="You’ll send"
              value={<MoneyText money={packaged} variant="bodyStrong" />}
            />
          ) : null}
          <Text variant="caption" tone="text3">
            Wallet PIN (4–6 digits)
          </Text>
          <TextInput
            testID="wallet.nip.pin"
            accessibilityLabel="Wallet PIN"
            value={pin}
            onChangeText={(raw) => setPin(raw.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="••••"
            placeholderTextColor={t.colors.text3}
            style={inputStyle}
          />
        </Card>
      ) : null}

      {payout.isError ? (
        <Banner
          tone="error"
          title="Bank payout didn’t go through"
          body={
            payout.error instanceof ApiError
              ? errorText(payout.error)
              : "Connection lost. Tap Send to bank again — your payout key is saved so retrying won’t debit twice."
          }
        />
      ) : null}
    </Screen>
  );
}

export function CashoutScreen() {
  const nav = useNavigation<{
    goBack: () => void;
    canGoBack?: () => boolean;
    navigate: (n: string) => void;
  }>();
  const dismiss = () => {
    if (nav.canGoBack && nav.canGoBack()) nav.goBack();
    else nav.navigate("Payouts");
  };
  return (
    <FlagGate
      flag="provider_payments"
      featureName="Bank cash-out"
      onDismiss={dismiss}
    >
      <FlagGate
        flag="wallet_nip"
        featureName="Bank cash-out"
        onDismiss={dismiss}
      >
        <CashoutBody />
      </FlagGate>
    </FlagGate>
  );
}
