import { Card } from '@ubi/ui';
import { fmt, type Liability } from '@/lib/growth-api';
/** Board 23a right column. Numbers are simulation output; the panel never computes. */
export function LiabilityPanel({ l, simulatedAt }: { l?: Liability; simulatedAt?: string }) {
  if (!l) return <Card className="p-4 text-sm text-muted-foreground">Run <b>Simulate</b> to preview eligible riders, expected redemption and maximum liability before submitting.</Card>;
  const cell = (label: string, value: string, tone = '') => <div className="rounded-lg border border-border bg-card p-3"><div className="text-[10px] text-muted-foreground">{label}</div><div className={'font-heading text-lg font-bold tabular-nums ' + tone}>{value}</div></div>;
  return (
    <Card className="p-4 space-y-3" data-testid="growth.campaign.liability">
      <div className="text-[10px] font-semibold tracking-wider text-muted-foreground">LIABILITY PREVIEW{simulatedAt ? ' · SIMULATED ' + simulatedAt : ''}</div>
      <div className="grid grid-cols-2 gap-2">
        {cell('Eligible riders', l.eligibleUsers.toLocaleString('en-NG'))}
        {cell('Expected redemption', l.expectedRedemptionPct + '% (' + l.redemptionRange[0] + '–' + l.redemptionRange[1] + '%)')}
        {cell('Max liability', fmt(l.maxLiability), 'text-amber-400')}
        {cell('Expected spend', fmt(l.expectedSpend))}
      </div>
      {l.warnings.map(w => <div key={w} className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-muted-foreground"><span className="font-semibold text-amber-400">Budget below max liability. </span>{w}{l.exhaustionDayAtHighRedemption ? ' Exhausts around day ' + l.exhaustionDayAtHighRedemption + ' at high redemption; riders after that see "used up".' : ''}</div>)}
      {l.overlaps.length ? <div className="text-xs text-muted-foreground"><span className="text-amber-400">!</span> Overlaps {l.overlaps.join(', ')} — stacking allowed, combined cost shown above.</div> : null}
    </Card>
  );
}
