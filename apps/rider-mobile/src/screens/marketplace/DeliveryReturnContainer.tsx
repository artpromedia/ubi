// R11 container — Marketplace.DeliveryReturn (extended for CC-C04 / P1-07).
// Full rider delivery custody timeline, package & route summary, on-demand ephemeral
// proof viewer, sender-initiated return proposal at `recipient_unreachable`, return
// consent sheet with 402 wallet top-up handoff, and terminal outcome banner.
import React, { useState } from "react";
import { TextInput, View } from "react-native";
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
  Row,
  MoneyText,
  StatusPill,
  Skeleton,
  Text,
  useTheme,
} from "@ubi/mobile-ui";
import { ApiError, track, useFlag } from "@ubi/mobile-core";
import { TEST_IDS, dynamicTestId } from "@ubi/contracts";
import type { MarketplaceStackParamList } from "../../navigation/routes";
import {
  marketplaceApi,
  type MpDeliveryReturnAction,
} from "../../api/marketplace";
import { DeliveryReturnSheet } from "./DeliveryReturnSheet";

const TID = TEST_IDS.mp.rider.delivery;

const ACTIVE_CUSTODY_STATES: ReadonlySet<string> = new Set([
  "courier_assigned",
  "picked_up",
  "in_transit",
  "delivery_attempted",
  "delivery_retry",
  "recipient_unreachable",
  "return_proposed",
  "return_consented",
  "returning",
]);

function proofLabel(type: "pickup" | "delivery" | "return"): string {
  switch (type) {
    case "pickup":
      return "Pickup photo proof";
    case "delivery":
      return "Delivery photo proof";
    case "return":
      return "Return hand-back photo proof";
  }
}

export function DeliveryReturnContainer() {
  const nav = useNavigation<{
    navigate: (n: string, p?: unknown) => void;
    goBack: () => void;
  }>();
  const { params } =
    useRoute<RouteProp<MarketplaceStackParamList, "DeliveryReturn">>();
  const qc = useQueryClient();
  const t = useTheme();
  const providerPaymentsOn = useFlag("provider_payments");
  const walletP2pOn = useFlag("wallet_p2p");
  const canTopUpWallet = Boolean(providerPaymentsOn && walletP2pOn);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [insufficientFunds, setInsufficientFunds] = useState(false);
  const [proposeReason, setProposeReason] = useState("");
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [viewingProof, setViewingProof] = useState<{
    proofId: string;
    type: "pickup" | "delivery" | "return";
    url: string;
    expiresAt: string;
  } | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [loadingProofId, setLoadingProofId] = useState<string | null>(null);

  const queryKey = ["mp", "deliveryReturn", params.deliveryId];
  const q = useQuery({
    queryKey,
    queryFn: () => marketplaceApi.deliveryReturnState(params.deliveryId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      if (data.custodyState) {
        return ACTIVE_CUSTODY_STATES.has(data.custodyState) ? 5_000 : false;
      }
      return data.state === "unreachable" || data.state === "retrying"
        ? 5_000
        : false;
    },
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
      setInsufficientFunds(false);
      qc.setQueryData(queryKey, next);
      if (action === "approve_return" || action === "hold_at_point")
        setSheetOpen(false);
    },
    onError: (e) => {
      const is402 =
        e instanceof ApiError &&
        (e.status === 402 || e.code === "RETURN_FEE_INSUFFICIENT_FUNDS");
      setInsufficientFunds(is402);
      setApproveError(
        e instanceof ApiError
          ? e.message
          : "That didn’t reach the server. Nothing changed.",
      );
    },
  });

  const proposeReturn = useMutation({
    mutationFn: () =>
      marketplaceApi.deliveryProposeReturn(
        params.deliveryId,
        proposeReason.trim(),
      ),
    onSuccess: (next) => {
      track("mp_delivery_return_proposed", {
        deliveryId: params.deliveryId,
        state: next.custodyState ?? next.state,
      });
      setProposeReason("");
      setProposeError(null);
      qc.setQueryData(queryKey, next);
    },
    onError: (e) => {
      setProposeError(
        e instanceof ApiError
          ? e.message
          : "Could not submit your return request. Please try again.",
      );
    },
  });

  const openProof = async (proofId: string) => {
    setLoadingProofId(proofId);
    setProofError(null);
    try {
      const signed = await marketplaceApi.deliveryProofUrl(
        params.deliveryId,
        proofId,
      );
      setViewingProof({
        proofId: signed.proofId,
        type: signed.type,
        url: signed.url,
        expiresAt: signed.expiresAt,
      });
    } catch (e) {
      setProofError(
        e instanceof ApiError
          ? e.message
          : "Could not load the photo proof URL. Please try again.",
      );
    } finally {
      setLoadingProofId(null);
    }
  };

  const v = q.data;
  if (!v) {
    if (q.isError) {
      return (
        <Screen title="Delivery" onBack={nav.goBack}>
          <Card testID={TID.error}>
            <Text variant="bodyStrong">Couldn’t load delivery custody</Text>
            <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
              {q.error instanceof ApiError
                ? q.error.message
                : "Check your connection and try again."}
            </Text>
            <Button
              testID={TID.retryLoad}
              label="Try again"
              kind="secondary"
              onPress={() => void q.refetch()}
              style={{ marginTop: 10 }}
            />
          </Card>
        </Screen>
      );
    }
    return (
      <Screen title="Delivery" onBack={nav.goBack}>
        <Skeleton height={200} />
      </Screen>
    );
  }

  const showResolveFooter =
    v.state === "unreachable" &&
    (!v.custodyState ||
      v.custodyState === "recipient_unreachable" ||
      v.custodyState === "return_proposed");

  return (
    <Screen
      title="Delivery"
      subtitle={
        v.delivery?.trackingNumber
          ? "Tracking " + v.delivery.trackingNumber
          : "Custody is tracked step by step"
      }
      onBack={nav.goBack}
      footer={
        showResolveFooter ? (
          <Button
            label="Resolve · recipient unreachable"
            kind="danger"
            onPress={() => {
              setApproveError(null);
              setInsufficientFunds(false);
              setSheetOpen(true);
            }}
          />
        ) : undefined
      }
    >
      <View testID={TID.screen} style={{ gap: 12 }}>
        <View
          testID={TID.state}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <StatusPill
            status={
              v.custodyState === "delivered" ||
              v.custodyState === "return_to_sender" ||
              v.custodyState === "collected"
                ? "completed"
                : v.state === "retrying"
                  ? "processing"
                  : "active"
            }
            suffix={v.custodyStateLabel ?? v.state}
          />
        </View>

        {v.finalOutcomeBanner ? (
          <View testID={TID.outcomeBanner}>
            <Banner
              tone={v.finalOutcomeBanner.tone}
              title={v.finalOutcomeBanner.title}
              body={v.finalOutcomeBanner.body}
            />
          </View>
        ) : (
          <>
            {v.state === "return_approved" ? (
              <Banner
                tone="ok"
                title="Return approved"
                body={v.approvedNotice}
              />
            ) : null}
            {v.state === "held_at_point" ? (
              <Banner
                tone="info"
                title="Held at partner pickup point"
                body="The package waits at the pickup point. Collection details are in your messages."
              />
            ) : null}
          </>
        )}

        {showResolveFooter ? <Banner tone="error" body={v.situation} /> : null}

        {v.delivery ? (
          <Card testID={TID.packageCard}>
            <Text variant="bodyStrong">Package & route</Text>
            <Row label="Pickup" value={v.delivery.pickupLocation.address} />
            <Row label="Drop-off" value={v.delivery.dropoffLocation.address} />
            <Row
              label="Package"
              value={
                v.delivery.package.size +
                (v.delivery.package.description
                  ? " · " + v.delivery.package.description
                  : "")
              }
              last={!v.agreedFareMinor}
            />
            {v.agreedFareMinor ? (
              <Row
                label="Agreed fare"
                value={
                  <View testID={TID.fare}>
                    <MoneyText money={v.agreedFareMinor} variant="heading" />
                  </View>
                }
                last
              />
            ) : null}
          </Card>
        ) : null}

        {v.custodyState === "recipient_unreachable" && !v.openReturn ? (
          <Card testID={TID.proposeReturn}>
            <Text variant="bodyStrong">Request return to you</Text>
            <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
              Ask the courier to bring the package back to your pickup address,
              or open the resolution options below to hold it at a partner
              pickup point.
            </Text>
            <TextInput
              testID={TID.proposeReason}
              placeholder="Reason for return (e.g. Bring back to office)"
              placeholderTextColor={t.colors.text3}
              value={proposeReason}
              onChangeText={setProposeReason}
              style={{
                marginTop: 10,
                backgroundColor: t.colors.bg,
                borderColor: t.colors.border,
                borderWidth: 1,
                borderRadius: t.radius.card,
                color: t.colors.text,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontSize: 14,
              }}
            />
            {proposeError ? (
              <View style={{ marginTop: 8 }}>
                <Banner tone="error" body={proposeError} />
              </View>
            ) : null}
            <Button
              testID={TID.proposeSubmit}
              label="Request return"
              kind="secondary"
              loading={proposeReturn.isPending}
              disabled={!proposeReason.trim()}
              onPress={() => proposeReturn.mutate()}
              style={{ marginTop: 10 }}
            />
          </Card>
        ) : null}

        {v.proofs && v.proofs.length > 0 ? (
          <Card>
            <Text variant="bodyStrong">Verified photo proofs</Text>
            <Text variant="caption" tone="text2" style={{ marginTop: 4 }}>
              Each proof is verified by SHA-256 digest and opened with a
              short-lived signed link.
            </Text>
            {proofError ? (
              <View style={{ marginTop: 8 }}>
                <Banner tone="error" body={proofError} />
              </View>
            ) : null}
            <View style={{ gap: 8, marginTop: 10 }}>
              {v.proofs.map((proof) => (
                <Button
                  key={proof.proofId}
                  testID={dynamicTestId(TID.proofItem, proof.proofId)}
                  label={"View " + proofLabel(proof.type)}
                  kind="secondary"
                  size="md"
                  loading={loadingProofId === proof.proofId}
                  onPress={() => void openProof(proof.proofId)}
                />
              ))}
            </View>
            {viewingProof ? (
              <Card testID={TID.proofViewer} style={{ marginTop: 10 }}>
                <Text variant="bodyStrong">
                  {proofLabel(viewingProof.type)}
                </Text>
                <Row label="Proof ID" value={viewingProof.proofId} />
                <Row label="Signed URL" value={viewingProof.url} />
                <Row label="Link expires" value={viewingProof.expiresAt} last />
                <Button
                  label="Close photo viewer"
                  kind="secondary"
                  size="md"
                  onPress={() => setViewingProof(null)}
                  style={{ marginTop: 8 }}
                />
              </Card>
            ) : null}
          </Card>
        ) : null}

        <Card testID={TID.timeline}>
          <Ladder steps={v.custody} />
        </Card>
      </View>

      <DeliveryReturnSheet
        visible={sheetOpen}
        onDismiss={() => setSheetOpen(false)}
        situation={v.situation}
        returnFeeMinor={v.returnFeeMinor}
        hasFee={
          v.openReturn !== undefined && v.openReturn !== null
            ? v.openReturn.hasFee
            : undefined
        }
        returnReason={v.openReturn?.reason}
        proposedByRole={v.openReturn?.proposedByRole}
        consentExpiresAt={v.openReturn?.consentExpiresAt}
        approving={act.isPending && act.variables === "approve_return"}
        approveError={approveError}
        insufficientFunds={insufficientFunds}
        canTopUpWallet={canTopUpWallet}
        onTopUpWallet={() => {
          setSheetOpen(false);
          nav.navigate("Main", {
            screen: "Pay",
            params: { screen: "TopUp" },
          });
        }}
        onApproveReturn={() => act.mutate("approve_return")}
        onHoldAtPoint={() => act.mutate("hold_at_point")}
      />
    </Screen>
  );
}
