'use client';
import { useQuery } from '@tanstack/react-query';
import { growthApi, type Campaign } from '@/lib/growth-api';
/** Board 23b right column. Method labels come from the server (holdout_difference / transaction_confirmed / count). No "lift", no "ROI". */
export function OutcomePanel({ campaign }: { campaign: Campaign }) {
  const q = useQuery({ queryKey: ['outcome', campaign.id], queryFn: () => growthApi.outcome(campaign.id, 1) });
  const o = q.data;
  return (
    <div data-testid="growth.campaign.outcome" className="space-y-3 p-4 text-xs text-muted-foreground">
      <div className="text-[10px] font-semibold tracking-wider">OUTCOME REVIEW · {campaign.name.toUpperCase()}</div>
      {!o ? <div className="animate-pulse space-y-2"><div className="h-16 rounded bg-muted" /><div className="h-16 rounded bg-muted" /></div> : (<>
        <div className="grid grid-cols-2 gap-2">{o.metrics.map(m => <div key={m.key} className="rounded-lg border border-border bg-card p-3"><div className="text-[10px]">{m.label}</div><div className="font-heading text-base font-bold tabular-nums text-foreground">{m.value}</div><div className="text-[10px]">{m.denominator} · {m.window} · n={m.sampleSize.toLocaleString()}{m.ci95 ? ' · 95% CI ' + m.ci95[0] + ' to ' + m.ci95[1] : ''}</div><div className="text-[10px] italic">{m.method === 'holdout_difference' ? 'difference vs stable holdout — not causal' : m.method === 'transaction_confirmed' ? 'transaction-confirmed' : 'count'}</div></div>)}</div>
        <p>Attribution: {o.attribution.taggedPct}% referral/campaign-tagged · {o.attribution.organicPct}% organic · {o.attribution.unknownPct}% unknown. Unknown is not organic.</p>
        <ul className="list-disc space-y-1 pl-4">{o.caveats.map(c => <li key={c}>{c}</li>)}</ul>
      </>)}
    </div>
  );
}
