// Design handoff R10 (handoff-marketplace/rn/rider/QueuedTrackerScreen.tsx), adapted only for repo imports and contracts TEST_IDS.
import React from 'react';
import { Screen, Text, Card, Button, Banner, Ladder, Row, StatusPill, MoneyText, type LadderStep } from '@ubi/mobile-ui';
import type { Money } from '@ubi/mobile-core';
import { TEST_IDS } from '@ubi/contracts';

/** R10. Queued job tracker. Never shows the other passenger's route; fare fixed; fee-free exit beyond tolerance. */
export type QueuedTrackerProps = {
  driverFirstName: string;
  steps: LadderStep[]; // selected(done) → finishing current(active, "About N min remaining") → heading to you(pending)
  fareMinor: Money; windowLabel: string;
  eta: { label: string; inWindow: boolean }; // server-computed vs accepted window
  delayed: null | {
    noticeTitle: string; noticeBody: string; // "Now estimated 24 min — you accepted up to 18"
    keepLabel: string; onKeep: () => void; onCancelFree: () => void;
    reversal: { riderHold: 'releasing' | 'released'; driverFee: 'pending' | 'reversed' } | null; // shown after cancel only
  };
  onCancelInWindow: () => void;
};

export function QueuedTrackerScreen(p: QueuedTrackerProps) {
  return (
    <Screen title={p.delayed ? 'Pickup delayed' : p.driverFirstName + ' is on the way soon'}>
      {p.delayed ? (
        <>
          <Banner tone="warn" title={p.delayed.noticeTitle} body={p.delayed.noticeBody} />
          <Button label={p.delayed.keepLabel} kind="secondary" testID={TEST_IDS.mp.rider.queued.keepWaiting} onPress={p.delayed.onKeep} />
          <Button label="Cancel free & search again" testID={TEST_IDS.mp.rider.queued.cancelFree} onPress={p.delayed.onCancelFree} />
          {p.delayed.reversal ? (
            <Card>
              <Row label="Your wallet hold" value={<StatusPill status={p.delayed.reversal.riderHold === 'released' ? 'done' : 'processing'} suffix={p.delayed.reversal.riderHold} />} />
              <Row label="Driver commission" value={<StatusPill status={p.delayed.reversal.driverFee === 'reversed' ? 'reversed' : 'processing'} />} last />
            </Card>
          ) : null}
        </>
      ) : (
        <>
          <Card testID={TEST_IDS.mp.rider.queued.ladder}><Ladder steps={p.steps} /></Card>
          <Card>
            <Row label="Agreed fare" value={<MoneyText money={p.fareMinor} variant="bodySmStrong" />} />
            <Row label="Pickup window accepted" value={p.windowLabel} />
            <Row label="Updated ETA" value={p.eta.label} valueTone={p.eta.inWindow ? 'ok' : 'warnInk'} last />
          </Card>
          <Text variant="caption" tone="text3">{p.driverFirstName}’s current trip details stay private — you only see your pickup estimate.</Text>
          <Button label="Cancel · free while in window" kind="secondary" onPress={p.onCancelInWindow} />
        </>
      )}
    </Screen>
  );
}
