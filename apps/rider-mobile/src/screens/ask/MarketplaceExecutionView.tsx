import React, { useState } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import {
  Text,
  Card,
  StatusPill,
  MoneyText,
  Button,
  Banner,
  Row,
  useTheme,
} from "@ubi/mobile-ui";
import { track } from "@ubi/mobile-core";
import {
  askApi,
  conventionalMarketplaceTarget,
  type Execution,
  type ExecutionItem,
} from "../../api/ask";

/** Distinct copy per fact: "request published" is never "driver confirmed". */
const STATE_LABEL: Partial<Record<ExecutionItem["state"], string>> = {
  submitted: "Sending",
  published: "Request published",
  cancelled: "Request cancelled",
  award_pending: "Confirming your driver",
  unknown_reconciling: "Checking the result",
  driver_confirmed: "Driver confirmed",
  award_failed: "Award did not complete",
  failed: "Not done",
};

function pillFor(state: ExecutionItem["state"]) {
  switch (state) {
    case "driver_confirmed":
      return "confirmed" as const;
    case "published":
      return "done" as const;
    case "cancelled":
      return "cancelled" as const;
    case "failed":
    case "award_failed":
      return "failed" as const;
    default:
      return "processing" as const;
  }
}

function headlineFor(execution: Execution): { title: string; intro: string } {
  const item = execution.items[0];
  const stage = execution.marketplace?.stage;
  if (stage === "publish") {
    if (item?.state === "published") {
      return {
        title: "Request published",
        intro:
          "Drivers can now send offers. No driver is booked and nothing is charged until you approve one.",
      };
    }
    if (item?.state === "cancelled") {
      return {
        title: "Request cancelled",
        intro: "Drivers' offers were released. Nothing was charged.",
      };
    }
  }
  if (item?.state === "driver_confirmed") {
    return {
      title: "Driver confirmed",
      intro:
        "Your driver is booked. The driver's commission comes out of their fare — it is not added to yours.",
    };
  }
  if (execution.status === "processing") {
    return {
      title: "Confirming your driver",
      intro:
        "We are settling this selection. Check again any time — it is never selected or charged twice.",
    };
  }
  return {
    title: "Not selected",
    intro: "Nothing was charged. You can pick an offer on the request screen.",
  };
}

/**
 * D01 AskExecution for a marketplace order: per-order outcome from the server
 * (state, awarded fare, the driver's commission on its own line), a "Check
 * again" that reconciles an ambiguous outcome through the SAME execution, and
 * the conventional request screen as the way forward when the assistant
 * cannot finish.
 */
export function MarketplaceExecutionView({
  execution,
}: {
  execution: Execution;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void }>();
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const mp = execution.marketplace;
  const { title, intro } = headlineFor(execution);

  const checkAgain = async () => {
    setChecking(true);
    setNotice(undefined);
    try {
      const next = await askApi.reconcileExecution(execution.id);
      qc.setQueryData(["execution", execution.id], next);
      track("ask_execution_reconciled", {
        executionId: execution.id,
        outcome: next.status,
      });
    } catch {
      setNotice(
        "We couldn't check right now. Nothing was charged twice — try again, or open the request screen.",
      );
    } finally {
      setChecking(false);
    }
  };

  const cancelRequest = (requestId: string) =>
    nav.navigate("SecureConfirm", {
      purpose: "Cancel this request",
      onProof: async (proof: string) => {
        try {
          await askApi.cancelMarketplaceRequest(requestId, proof);
          await qc.invalidateQueries({ queryKey: ["execution", execution.id] });
        } catch {
          setNotice(
            "The request could not be cancelled here. Cancel it from the request screen.",
          );
        }
      },
    });

  const openRequest = () =>
    nav.navigate(
      "Marketplace",
      conventionalMarketplaceTarget(mp?.conventionalFlow),
    );

  return (
    <View style={{ gap: 12 }} testID="ask.mpStatus.view">
      <Text variant="display" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="bodySm" tone="text2">
        {intro}
      </Text>
      {notice ? <Banner tone="warn" body={notice} /> : null}
      <Card style={{ paddingVertical: 2 }}>
        {execution.items.map((item, index) => (
          <View
            key={item.title + index}
            testID="ask.mpStatus.item"
            style={{
              paddingVertical: 12,
              gap: 2,
              borderBottomWidth: index === execution.items.length - 1 ? 0 : 1,
              borderBottomColor: t.colors.divider,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Text variant="bodySmStrong" style={{ flex: 1 }}>
                {item.title}
              </Text>
              <StatusPill status={pillFor(item.state)} />
            </View>
            <Text
              variant="caption"
              tone="text2"
              testID="ask.mpStatus.itemState"
            >
              {STATE_LABEL[item.state] ?? item.state}
            </Text>
            {item.detail ? (
              <Text variant="caption" tone="text2">
                {item.detail}
              </Text>
            ) : null}
            {item.fare ? (
              <Row
                label="Agreed fare"
                value={<MoneyText money={item.fare} variant="bodySmStrong" />}
              />
            ) : null}
            {item.commission ? (
              <Row
                label="Driver's commission (paid by the driver)"
                value={<MoneyText money={item.commission} variant="bodySm" />}
                last
              />
            ) : null}
          </View>
        ))}
      </Card>
      {mp?.reconcilable ? (
        <Button
          testID="ask.mpStatus.checkAgain"
          label="Check again"
          kind="inverse"
          loading={checking}
          onPress={checkAgain}
        />
      ) : null}
      {mp?.stage === "publish" &&
      execution.items[0]?.state === "published" &&
      mp.requestId ? (
        <Button
          testID="ask.mpStatus.cancel"
          label="Cancel request"
          kind="danger"
          size="md"
          onPress={() => cancelRequest(mp.requestId as string)}
        />
      ) : null}
      <Button
        testID="ask.mpStatus.openRequest"
        label={
          mp?.stage === "publish" ? "See offers" : "Open the request screen"
        }
        kind="secondary"
        onPress={openRequest}
      />
    </View>
  );
}
