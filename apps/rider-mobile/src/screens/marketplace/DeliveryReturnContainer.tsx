// R11 container — Marketplace.DeliveryReturn. Minimal Send-adjacent surface: MATRIX maps
// DeliveryReturnSheet onto Send.Active, which is still an RN-01 placeholder, so for now the
// sheet hangs off this thin custody screen inside the Marketplace stack (see followups).
// Return fee is consented + funded BEFORE the courier returns; failed delivery is its own
// state with evidence — nothing auto-completes.
import React, { useState } from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Screen,
  Card,
  Ladder,
  Banner,
  Button,
  StatusPill,
  Skeleton,
} from "@ubi/mobile-ui";
import { ApiError, track } from "@ubi/mobile-core";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import {
  marketplaceApi,
  type MpDeliveryReturnAction,
} from "../../api/marketplace";
import { DeliveryReturnSheet } from "./DeliveryReturnSheet";

export function DeliveryReturnContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } =
    useRoute<RouteProp<MarketplaceStackParamList, "DeliveryReturn">>();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["mp", "deliveryReturn", params.deliveryId],
    queryFn: () => marketplaceApi.deliveryReturnState(params.deliveryId),
    refetchInterval: (query) =>
      query.state.data?.state === "unreachable" ||
      query.state.data?.state === "retrying"
        ? 5_000
        : false,
  });
  const act = useMutation({
    mutationFn: (action: MpDeliveryReturnAction) =>
      marketplaceApi.deliveryReturnConsent(params.deliveryId, action),
    onSuccess: (next, action) => {
      track("mp_delivery_return_action", {
        deliveryId: params.deliveryId,
        action,
        state: next.state,
      });
      setApproveError(null);
      qc.setQueryData(["mp", "deliveryReturn", params.deliveryId], next);
      if (action === "approve_return" || action === "hold_at_point")
        setSheetOpen(false);
    },
    onError: (e) =>
      setApproveError(
        e instanceof ApiError
          ? e.message
          : "That didn’t reach the server. Nothing changed.",
      ),
  });
  const v = q.data;
  if (!v)
    return (
      <Screen title="Delivery" onBack={nav.goBack}>
        <Skeleton height={200} />
      </Screen>
    );
  return (
    <Screen
      title="Delivery"
      subtitle="Custody is tracked step by step"
      onBack={nav.goBack}
      footer={
        v.state === "unreachable" ? (
          <Button
            label="Resolve · recipient unreachable"
            kind="danger"
            onPress={() => {
              setApproveError(null);
              setSheetOpen(true);
            }}
          />
        ) : undefined
      }
    >
      {v.state === "return_approved" ? (
        <Banner
          tone="ok"
          title="Return approved"
          body="The courier brings the package back to you. The return fee was funded from your wallet."
        />
      ) : null}
      {v.state === "held_at_point" ? (
        <Banner
          tone="info"
          title="Held at partner pickup point"
          body="The package waits at the pickup point. Collection details are in your messages."
        />
      ) : null}
      {v.state === "unreachable" ? (
        <Banner tone="error" body={v.situation} />
      ) : null}
      {v.state === "retrying" ? (
        <StatusPill status="processing" suffix="contacting recipient" />
      ) : null}
      <Card>
        <Ladder steps={v.custody} />
      </Card>
      <DeliveryReturnSheet
        visible={sheetOpen}
        onDismiss={() => setSheetOpen(false)}
        situation={v.situation}
        returnFeeMinor={v.returnFeeMinor}
        approving={act.isPending && act.variables === "approve_return"}
        approveError={approveError}
        onRetryRecipient={() => act.mutate("retry_recipient")}
        onApproveReturn={() => act.mutate("approve_return")}
        onHoldAtPoint={() => act.mutate("hold_at_point")}
      />
    </Screen>
  );
}
