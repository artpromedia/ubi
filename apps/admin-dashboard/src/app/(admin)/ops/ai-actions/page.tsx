'use client';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@ubi/ui';
import { growthApi, fmt } from '@/lib/growth-api';

const OUT: Record<string, string> = { done: 'text-emerald-400', partial: 'text-amber-400', blocked: 'text-amber-400', refused: 'text-red-400', error: 'text-red-400' };
/** Board 23e (right) — AI action history: actor, action, tool, model/version, auth ref, outcome, cost, reason. Unauthorised must read 0. */
export default function AiActionsPage() {
  const acts = useQuery({ queryKey: ['aiActions'], queryFn: growthApi.aiActions, refetchInterval: 15_000 });
  const m = useQuery({ queryKey: ['aiMetrics'], queryFn: growthApi.aiMetrics, refetchInterval: 60_000 });
  return (
    <div data-testid="ops.ai.actions" className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-4"><h1 className="font-heading text-lg font-semibold">Ops › AI actions</h1>{m.data ? <><Badge variant="secondary">TASK SUCCESS {m.data.taskSuccessPct}%</Badge><Badge variant="secondary">P95 {(m.data.p95Ms / 1000).toFixed(1)} S</Badge><Badge variant="secondary">COST {fmt(m.data.costPerTask)}/TASK</Badge><Badge className={m.data.unauthorised === 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}>{m.data.unauthorised} UNAUTHORISED</Badge></> : null}</div>
      <div className="flex-1 overflow-auto"><table className="w-full text-xs"><thead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><tr className="border-b border-border">{['When · actor', 'Action · tool', 'Auth', 'Outcome · cost'].map(h => <th key={h} className="px-4 py-2 text-left">{h}</th>)}</tr></thead>
        <tbody>{acts.data?.map((a, i) => <tr key={i} className={'border-b border-border/60 ' + (a.outcome === 'refused' ? 'bg-red-500/5' : a.outcome === 'blocked' ? 'bg-amber-500/5' : '')}>
          <td className="px-4 py-2.5"><div className="text-foreground">{a.at} · {a.actor}</div><div className="text-muted-foreground">{a.actorSub}</div></td>
          <td className="px-4 py-2.5"><div className="text-foreground">{a.action}</div><div className="text-muted-foreground">{a.tool}</div></td>
          <td className="px-4 py-2.5"><div className={a.authKind === 'none' ? 'text-red-400' : a.authKind === 'read_only' ? 'text-muted-foreground' : 'text-emerald-400'}>{a.authKind === 'read_only' ? 'read · no grant needed' : a.authKind === 'none' ? 'no grant' : a.authKind + ' ' + (a.authRef ?? '')}</div>{a.authNote ? <div className="text-muted-foreground">{a.authNote}</div> : null}</td>
          <td className="px-4 py-2.5"><span className={OUT[a.outcome]}>{a.outcome}</span> <span className="text-muted-foreground">{a.outcomeNote}</span>{a.tokens !== undefined ? <div className="text-muted-foreground">{a.tokens.toLocaleString()} tok · {fmt(a.cost)}</div> : null}</td></tr>)}</tbody></table></div>
      <p className="border-t border-border p-3 text-[11px] text-muted-foreground">Logged: actor, action, model/prompt/tool version, redacted inputs, grant/mandate ref, provider refs, timestamps, outcome, cost, reason code. Not logged: hidden reasoning, credentials, documents. Retention 90 d; access audited.</p>
    </div>
  );
}
