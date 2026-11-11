// Design handoff R11b (handoff-marketplace/rn/rider/DeliveryReturnSheet.tsx), extended for CC-C04 (P1-07).
// Return fee is consented + funded BEFORE the courier returns; 402 RETURN_FEE_INSUFFICIENT_FUNDS
// offers a direct wallet top-up handoff when provider_payments + wallet_p2p are enabled, or an
// honest fallback to a partner hold point when off.
import React from "react";
import { View } from "react-native";
import {
  Text,
  Card,
  Button,
  Banner,
  Sheet,
  Row,
  MoneyText,
} from "@ubi/mobile-ui";
import type { Money } from "@ubi/mobile-core";
import { TEST_IDS } from "@ubi/contracts";

/** R11b. Recipient-unreachable resolution. Return fee is consented + funded BEFORE the courier returns. */
export type DeliveryReturnSheetProps = {
  visible: boolean;
  onDismiss: () => void;
  situation: string; // server copy: attempts, courier waiting state
  returnFeeMinor: Money;
  hasFee?: boolean;
  returnReason?: string;
  proposedByRole?: string;
  consentExpiresAt?: string;
  approving: boolean;
  approveError: string | null;
  insufficientFunds?: boolean;
  canTopUpWallet?: boolean;
  onTopUpWallet?: () => void;
  onApproveReturn: () => void;
  onHoldAtPoint: () => void;
};

export function DeliveryReturnSheet(p: DeliveryReturnSheetProps) {
  return (
    <Sheet visible={p.visible} onDismiss={p.onDismiss}>
      <Text variant="title">Recipient unreachable</Text>
      <Banner tone="error" body={p.situation} />
      <Card>
        <Row
          label="Return to sender"
          value={<MoneyText money={p.returnFeeMinor} variant="heading" />}
          last={!p.returnReason && !p.consentExpiresAt}
        />
        {p.returnReason ? (
          <Row
            label={
              p.proposedByRole === "sender" ? "Your reason" : "Courier’s reason"
            }
            value={p.returnReason}
            last={!p.consentExpiresAt}
          />
        ) : null}
        {p.consentExpiresAt ? (
          <Row
            label="Decision deadline (24h)"
            value={p.consentExpiresAt}
            last
          />
        ) : null}
        <Text variant="caption" tone="text2" style={{ marginTop: 6 }}>
          {p.hasFee === false
            ? "This return is fee-free. Approving sends the courier back to your pickup address with photo custody proof."
            : "Return fee needs your approval and wallet funding before the courier heads back. Custody proof continues either way."}
        </Text>
        {p.approveError ? (
          <View style={{ marginTop: 8 }}>
            <Banner tone="error" body={p.approveError} />
          </View>
        ) : null}
        {p.insufficientFunds ? (
          p.canTopUpWallet && p.onTopUpWallet ? (
            <Button
              testID={TEST_IDS.mp.rider.delivery.topUpWallet}
              label="Top up wallet"
              kind="secondary"
              onPress={p.onTopUpWallet}
              style={{ marginTop: 8 }}
            />
          ) : (
            <View
              testID={TEST_IDS.mp.rider.delivery.topUpUnavailable}
              style={{ marginTop: 8 }}
            >
              <Banner
                tone="warn"
                title="Wallet top-up isn’t available here yet"
                body="You can hold the package at a partner pickup point below without a return fee."
              />
            </View>
          )
        ) : null}
        <Button
          testID={TEST_IDS.mp.rider.delivery.approveReturn}
          label="Approve return"
          loading={p.approving}
          onPress={p.onApproveReturn}
          style={{ marginTop: 10 }}
        />
      </Card>
      <Button
        testID={TEST_IDS.mp.rider.delivery.holdAtPoint}
        label="Hold at partner pickup point"
        kind="secondary"
        onPress={p.onHoldAtPoint}
      />
      <Text variant="caption" tone="text3" align="center">
        No automatic “delivered” — failed delivery is its own state with
        evidence.
      </Text>
    </Sheet>
  );
}
