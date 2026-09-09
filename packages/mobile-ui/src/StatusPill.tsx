import React from 'react';
import { View } from 'react-native';
import { useTheme } from './theme';
import { Text } from './Text';

/** The status vocabulary from board 20. The WORD is always printed; colour never carries meaning alone. */
export type StatusKey = 'suggestion' | 'live' | 'awaiting_confirmation' | 'processing' | 'supplier_pending' | 'confirmed' | 'ticketed' | 'failed' | 'expired' | 'partly_booked' | 'blocked' | 'done' | 'active' | 'paused' | 'revoked' | 'reversed' | 'earned' | 'used_up' | 'scheduled' | 'not_reserved' | 'not_booked' | 'in_review' | 'qualifying' | 'rewarded' | 'refund_in_progress' | 'cancelled';
const LABEL: Record<StatusKey, string> = {
  suggestion: 'Suggestion', live: 'Live price', awaiting_confirmation: 'Awaiting your confirmation', processing: 'Processing', supplier_pending: 'Supplier pending', confirmed: 'Confirmed', ticketed: 'Ticketed', failed: 'Failed', expired: 'Expired', partly_booked: 'Partly booked', blocked: 'Blocked', done: 'Done', active: 'Active', paused: 'Paused', revoked: 'Revoked', reversed: 'Reversed', earned: 'Earned', used_up: 'Used up', scheduled: 'Scheduled', not_reserved: 'Not reserved', not_booked: 'Not booked', in_review: 'In review', qualifying: 'Qualifying', rewarded: 'Rewarded', refund_in_progress: 'Refund in progress', cancelled: 'Cancelled',
};
export function StatusPill({ status, suffix, testID }: { status: StatusKey; suffix?: string; testID?: string }) {
  const t = useTheme();
  const tone = (): { bg: string; fg: string; dashed?: boolean } => {
    switch (status) {
      case 'suggestion': return { bg: t.colors.bg2, fg: t.colors.text2, dashed: true };
      case 'live': case 'scheduled': return { bg: t.colors.travelTint, fg: t.colors.travelInk };
      case 'awaiting_confirmation': case 'processing': case 'supplier_pending': case 'partly_booked': case 'blocked': case 'in_review': case 'qualifying': case 'refund_in_progress': case 'paused': return { bg: t.colors.warnTint, fg: t.colors.warnInk };
      case 'confirmed': case 'ticketed': case 'done': case 'active': case 'earned': case 'rewarded': return { bg: t.colors.okTint, fg: t.colors.ok };
      case 'failed': case 'reversed': case 'not_reserved': case 'revoked': case 'cancelled': return { bg: t.colors.errorTint, fg: t.colors.errorInk };
      default: return { bg: t.colors.bg2, fg: t.colors.text2 };
    }
  };
  const c = tone();
  const label = LABEL[status] + (suffix ? ' · ' + suffix : '');
  return (
    <View testID={testID} accessibilityRole="text" accessibilityLabel={'Status: ' + label} style={{ alignSelf: 'flex-start', backgroundColor: c.bg, borderRadius: t.radius.chip, paddingHorizontal: 9, paddingVertical: 4, borderWidth: c.dashed ? 1 : 0, borderStyle: c.dashed ? 'dashed' : 'solid', borderColor: t.colors.text3 }}>
      <Text variant="label" style={{ color: c.fg }}>{label}</Text>
    </View>
  );
}
