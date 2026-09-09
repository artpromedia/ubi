'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button, Card } from '@ubi/ui';
import { growthApi, fmt, type Campaign } from '@/lib/growth-api';
import { StateBadge } from '@/components/growth/StateBadge';
import { OutcomePanel } from '@/components/growth/OutcomePanel';

/** Board 23b — states, exposure, honest outcomes. Actions post to /actions; approval id required for activate/raise_budget. */
export default function CampaignsPage() {
  const q = useQuery({ queryKey: ['campaigns'], queryFn: growthApi.campaigns });
  const [sel, setSel] = useState<Campaign | undefined>();
  const counts = (s: Campaign['state']) => q.data?.filter(c => c.state === s).length ?? 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">Growth › Campaigns</h1>
        <StateBadge state="active" note={String(counts('active'))} /><StateBadge state="awaiting_approval" note={String(counts('awaiting_approval'))} /><StateBadge state="exhausted" note={String(counts('exhausted'))} />
        <div className="ml-auto flex gap-2"><Button variant="outline" size="sm">Export</Button><Button size="sm" asChild><Link href="/growth/campaigns/new">+ New campaign</Link></Button></div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><tr className="border-b border-border">{['Campaign · version', 'State', 'Market · window', 'Budget · reserved · spent', 'Redemptions', 'Actions'].map(h => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{q.data?.map(c => (
              <tr key={c.id} onClick={() => setSel(c)} className={'cursor-pointer border-b border-border/60 hover:bg-muted/40 ' + (sel?.id === c.id ? 'bg-muted/40' : '')}>
                <td className="px-4 py-2.5"><div className="font-semibold text-foreground">{c.name}</div><div className="text-muted-foreground">{c.sub}</div></td>
                <td className="px-4 py-2.5"><StateBadge state={c.state} note={c.stateNote} /></td>
                <td className="px-4 py-2.5 text-muted-foreground">{c.market} · {c.window}</td>
                <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmt(c.budget.limit)} · {fmt(c.budget.reserved)} · <b className="text-foreground">{fmt(c.budget.spent)}</b></td>
                <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{c.redemptions ?? '—'}</td>
                <td className="px-4 py-2.5">{c.actions.map(a => <button key={a} onClick={(e) => { e.stopPropagation(); void growthApi.action(c.id, a); }} className="mr-2 text-sky-400 hover:underline">{a}</button>)}</td>
              </tr>))}</tbody>
          </table>
        </div>
        <aside className="w-[420px] shrink-0 border-l border-border bg-card/40">{sel ? <OutcomePanel campaign={sel} /> : <Card className="m-4 p-4 text-sm text-muted-foreground">Select a campaign to review its outcome. Every metric shows its denominator, window and sample size; differences against holdout are not causal claims.</Card>}</aside>
      </div>
    </div>
  );
}
