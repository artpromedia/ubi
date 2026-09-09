'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Card } from '@ubi/ui';
import { growthApi } from '@/lib/growth-api';

const KIND: Record<string, { label: string; cls: string }> = { pending_ticketing: { label: 'PNR · NOT TICKETED', cls: 'bg-red-500/15 text-red-400' }, unknown_result: { label: 'UNKNOWN · RECONCILING', cls: 'bg-amber-500/15 text-amber-400' }, refund_due: { label: 'REFUND DUE', cls: 'bg-sky-500/15 text-sky-400' }, settlement_difference: { label: 'SETTLEMENT DIFF', cls: 'bg-amber-500/15 text-amber-400' } };
/** Board 23e (left) — travel exceptions + provider health inside the existing ops console. Unknown results: lookup by UBI ref only; never re-book. */
export default function TravelOpsPage() {
  const qc = useQueryClient();
  const ex = useQuery({ queryKey: ['travelExceptions'], queryFn: growthApi.travelExceptions, refetchInterval: 30_000 });
  const health = useQuery({ queryKey: ['providerHealth'], queryFn: growthApi.providerHealth, refetchInterval: 30_000 });
  const act = useMutation({ mutationFn: ({ id, action }: { id: string; action: string }) => growthApi.travelAction(id, action), onSuccess: () => void qc.invalidateQueries({ queryKey: ['travelExceptions'] }) });
  const count = (k: string) => ex.data?.filter(e => e.kind === k).length ?? 0;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4"><h1 className="font-heading text-lg font-semibold">Ops › Travel</h1><Badge className={KIND.pending_ticketing.cls}>{count('pending_ticketing')} PENDING TICKETING &gt; 30 MIN</Badge><Badge className={KIND.unknown_result.cls}>{count('unknown_result')} PROVIDER UNCERTAIN</Badge><Badge className={KIND.refund_due.cls}>{count('refund_due')} REFUNDS DUE</Badge></div>
      <div data-testid="ops.travel.health" className="flex gap-2 border-b border-border p-3">{health.data?.map(h => <Card key={h.label} className={'flex-1 p-3 ' + (h.tone === 'warn' ? 'border-amber-500/50' : '')}><div className="text-[10px] text-muted-foreground">{h.label}</div><div className={'font-heading text-base font-bold ' + (h.tone === 'warn' ? 'text-amber-400' : '')}>{h.value} <span className={'text-[11px] font-normal ' + (h.tone === 'ok' ? 'text-emerald-400' : 'text-muted-foreground')}>{h.note}</span></div></Card>)}</div>
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs"><thead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><tr className="border-b border-border">{['Order · UBI id', 'Traveller · item', 'State · since', 'Money', 'Next action'].map(h => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr></thead>
          <tbody>{ex.data?.map(e => <tr key={e.id} data-testid="ops.travel.exception" className="border-b border-border/60">
            <td className="px-4 py-2.5"><div className="font-mono font-semibold text-foreground">{e.orderId}</div><div className="text-muted-foreground">{e.supplierRef}</div></td>
            <td className="px-4 py-2.5"><div className="text-foreground">{e.traveller} · {e.item}</div><div className="text-muted-foreground">{e.sub}</div></td>
            <td className="px-4 py-2.5"><Badge className={KIND[e.kind].cls}>{e.state || KIND[e.kind].label}</Badge><div className="text-muted-foreground">{e.since}</div></td>
            <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{e.money}{e.moneyNote ? <div>{e.moneyNote}</div> : null}</td>
            <td className="px-4 py-2.5">{e.nextAction.map(a => <button key={a.action} disabled={act.isPending} onClick={() => act.mutate({ id: e.id, action: a.action })} className="mr-2 text-sky-400 hover:underline">{a.label}</button>)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
