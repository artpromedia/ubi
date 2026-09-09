import { Badge } from '@ubi/ui';
import type { CampaignState } from '@/lib/growth-api';
const LABEL: Record<CampaignState, string> = { draft: 'Draft', simulated: 'Simulated', awaiting_approval: 'Awaiting approval', scheduled: 'Scheduled', active: 'Active', paused: 'Paused', exhausted: 'Exhausted', ended: 'Ended' };
const CLASS: Record<CampaignState, string> = { draft: 'bg-muted text-muted-foreground', simulated: 'bg-blue-500/15 text-blue-400', awaiting_approval: 'bg-amber-500/15 text-amber-400', scheduled: 'bg-blue-500/15 text-blue-400', active: 'bg-emerald-500/15 text-emerald-400', paused: 'bg-amber-500/15 text-amber-400', exhausted: 'bg-red-500/15 text-red-400', ended: 'bg-muted text-muted-foreground' };
/** Campaign lifecycle badge — the word is always printed (board 23 header). */
export function StateBadge({ state, note }: { state: CampaignState; note?: string }) {
  return <Badge className={'uppercase tracking-wide text-[10px] font-semibold ' + CLASS[state]}>{LABEL[state]}{note ? ' · ' + note : ''}</Badge>;
}
