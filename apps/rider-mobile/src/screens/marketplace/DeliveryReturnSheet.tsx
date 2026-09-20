// Design handoff R11b (handoff-marketplace/rn/rider/DeliveryReturnSheet.tsx), adapted only for repo imports and contracts TEST_IDS.
import React from "react";
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
  approving: boolean;
  approveError: string | null;
  onRetryRecipient: () => void;
  onApproveReturn: () => void;
  onHoldAtPoint: () => void;
};

export function DeliveryReturnSheet(p: DeliveryReturnSheetProps) {
  return (
    <Sheet visible={p.visible} onDismiss={p.onDismiss}>
      <Text variant="title">Recipient unreachable</Text>
      <Banner tone="error" body={p.situation} />
      <Button
        testID={TEST_IDS.mp.rider.delivery.retryRecipient}
        label="Try recipient again"
        kind="secondary"
        onPress={p.onRetryRecipient}
      />
      <Card>
        <Row
          label="Return to sender"
          value={<MoneyText money={p.returnFeeMinor} variant="heading" />}
          last
        />
        <Text variant="caption" tone="text2">
          Return fee needs your approval and wallet funding before the courier
          heads back. Custody proof continues either way.
        </Text>
        {p.approveError ? <Banner tone="error" body={p.approveError} /> : null}
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
