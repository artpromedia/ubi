'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Badge } from '@ubi/ui';
import { growthApi, fmt, type ReviewCase } from '@/lib/growth-api';

const SEV: Record<string, string> = { info: 'text-muted-foreground', warn: 'text-amber-400', high: 'text-red-400' };
/** Board 23c — referral review queue + case panel. Shared device/payment never auto-denies; every decision needs a reason code the rider will see. */
export default function ReferralsReviewPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['reviewQueue'], queryFn: growthApi.reviewQueue });
  const [sel, setSel] = useState<ReviewCase | undefined>();
  const [reason, setReason] = useState('household_shared_device_ok');
  const decide = useMutation({ mutationFn: (d: 'qualify' | 'hold' | 'deny') => growthApi.decide(sel!.id, d, reason, d === 'hold' ? 48 : undefined), onSuccess: () => { setSel(undefined); void qc.invalidateQueries({ queryKey: ['reviewQueue'] }); } });
  const over = q.data?.filter(c => c.waitingHours > 24).length ?? 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4"><h1 className="font-heading text-lg font-semibold">Growth › Referrals & abuse</h1><Badge className="bg-amber-500/15 text-amber-400">{q.data?.length ?? 0} IN REVIEW · SLA 24H</Badge>{over ? <Badge className="bg-red-500/15 text-red-400">{over} OVER SLA</Badge> : null}</div>
      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs"><thead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><tr className="border-b border-border">{['Referral', 'Qualifying event', 'Signals', 'Waiting', 'Reward'].map(h => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr></thead>
            <tbody>{q.data?.map(c => <tr key={c.id} onClick={() => setSel(c)} className={'cursor-pointer border-b border-border/60 hover:bg-muted/40 ' + (c.signals.some(s => s.severity === 'high') ? 'bg-red-500/5' : c.waitingHours > 20 ? 'bg-amber-500/5' : '')}>
              <td className="px-4 py-2.5"><div className="font-semibold text-foreground">{c.referral}</div><div className="text-muted-foreground">{c.sub}</div></td>
              <td className="px-4 py-2.5 text-muted-foreground">{c.qualifyingEvent}</td>
              <td className="px-4 py-2.5">{c.signals.map(s => <span key={s.rule} className={'mr-2 ' + SEV[s.severity]}>{s.text}</span>)}</td>
              <td className={'px-4 py-2.5 tabular-nums ' + (c.waitingHours > 24 ? 'text-red-400' : c.waitingHours > 20 ? 'text-amber-400' : 'text-muted-foreground')}>{Math.round(c.waitingHours)} h</td>
              <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmt(c.heldReward)} held</td></tr>)}</tbody></table>
        </div>
        <aside data-testid="growth.abuse.case" className="w-[440px] shrink-0 space-y-3 border-l border-border bg-card/40 p-4 text-xs text-muted-foreground">
          {!sel ? <p>Select a case. Reviewers see masked phones and ride facts only — no documents, no messages.</p> : (<>
            <div className="flex items-center justify-between"><div className="font-heading text-sm font-semibold text-foreground">{sel.id} · {sel.referral}</div><Badge className="bg-amber-500/15 text-amber-400">IN REVIEW · {Math.round(sel.waitingHours)} H</Badge></div>
            <p>{sel.reward}</p>
            <Card className="p-3"><div className="mb-1 text-[10px] font-semibold tracking-wider">WHY IT'S HERE</div><p>{sel.why}</p></Card>
            <Card className="p-3"><div className="mb-1 text-[10px] font-semibold tracking-wider">WHAT THE REVIEWER SEES</div><p>{sel.maskedView}</p></Card>
            <div className="space-y-2"><div className="text-[10px] font-semibold tracking-wider">DECISION · RECORDED WITH REASON</div>
              <select value={reason} onChange={e => setReason(e.target.value)} className="w-full rounded-lg border border-border bg-card p-2">{['household_shared_device_ok', 'identity_pending', 'ring_pattern_same_card', 'velocity_anomaly', 'legitimate_after_review'].map(r => <option key={r} value={r}>{r}</option>)}</select>
              <div className="flex flex-wrap gap-2"><Button data-testid="growth.abuse.decision" size="sm" disabled={decide.isPending} onClick={() => decide.mutate('qualify')}>Qualify · release {fmt(sel.heldReward)}</Button><Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate('hold')}>Hold 48 h · ask for ID</Button><Button size="sm" variant="outline" className="text-red-400" disabled={decide.isPending} onClick={() => decide.mutate('deny')}>Deny · reverse</Button></div>
              <p>Deny requires a reason code the rider will see in Benefits › Recent changes. Reversals post as compensating entries; the referee's discount is reclaimed only where the terms allow.</p></div>
          </>)}
        </aside>
      </div>
    </div>
  );
}
