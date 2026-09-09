import React, { useState } from 'react';
import { View } from 'react-native';
import { Sheet, Text, Card, Toggle, Button } from '@ubi/mobile-ui';
import { track, TID, useCityConfig } from '@ubi/mobile-core';
import { askApi } from '../../api/ask';

/** Board 20c — hand off to a person. States what will be shared; PIN/card/ID are never in the thread so never shared. */
export function HandoffSheet({ visible, threadId, onDismiss, onOpened }: { visible: boolean; threadId?: string; onDismiss: () => void; onOpened: (caseId: string) => void }) {
  const [include, setInclude] = useState(true); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | undefined>();
  const { config } = useCityConfig();
  const start = async () => { if (!threadId) return; setBusy(true); try { const r = await askApi.handoff(threadId, include); track('ask_handoff_started', { threadId, includeTranscript: include }); onOpened(r.supportCaseId); } catch { setErr('Could not reach support chat. You can call instead.'); } finally { setBusy(false); } };
  return (
    <Sheet visible={visible} onDismiss={onDismiss} testID={TID.ask.handoff.sheet}>
      <View style={{ gap: 12 }}>
        <Text variant="title">Talk to UBI Support</Text>
        <Text variant="bodySm" tone="text2">A person picks up where the assistant stopped. Support is open 24/7.</Text>
        <Card style={{ gap: 6 }}>
          <Text variant="label" tone="text2">What we'll share with the agent</Text>
          <Text variant="bodySm">Your recent messages and plan cards, and any bookings or attempts made from this conversation.</Text>
          <Toggle label="Include the conversation" value={include} onChange={setInclude} />
        </Card>
        <Text variant="caption" tone="text2">Your PIN, card and ID documents are never part of the conversation, so they're never shared.</Text>
        {err ? <Text variant="caption" tone="errorInk">{err}</Text> : null}
        <Button testID={TID.ask.handoff.start} label="Start chat with support" kind="inverse" loading={busy} onPress={start} />
        <Button label={'Call ' + (config?.supportPhone ?? 'support') + ' instead'} kind="ghost" size="md" onPress={onDismiss} />
      </View>
    </Sheet>
  );
}
