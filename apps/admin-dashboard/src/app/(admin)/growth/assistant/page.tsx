'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button, Card, Badge } from '@ubi/ui';
import { growthApi, fmt, type Proposal } from '@/lib/growth-api';
import { LiabilityPanel } from '@/components/growth/LiabilityPanel';

/** Board 23d — the assistant proposes; humans approve. Output is editable and saves as a DRAFT campaign only. */
export default function AssistantPage() {
  const [thread] = useState('mk_' + Date.now().toString(36));
  const [text, setText] = useState('Lapsed Lagos riders dropped again this week. Propose a re-activation campaign we can afford under ₦2.5M, and copy in English, Yoruba and Pidgin.');
  const [p, setP] = useState<Proposal | undefined>();
  const ask = useMutation({ mutationFn: () => growthApi.assistant(thread, text), onSuccess: setP });
  const save = useMutation({ mutationFn: () => growthApi.createDraft({ fromProposal: p, name: p?.name }) });
  const edit = (k: keyof Proposal, v: string) => p && setP({ ...p, [k]: v });
  return (
    <div className="flex h-full">
      <section className="flex w-[380px] shrink-0 flex-col border-r border-border bg-card/40">
        <div className="flex items-center gap-2 border-b border-border p-4"><h1 className="font-heading text-lg font-semibold">Marketing assistant</h1><Badge variant="secondary">DRAFTS ONLY</Badge><Badge variant="secondary">AGGREGATES ≥ 50</Badge></div>
        <div className="flex-1 space-y-3 overflow-auto p-4 text-xs text-muted-foreground">
          <div className="ml-8 rounded-2xl rounded-br-sm bg-muted p-3 text-foreground">{text}</div>
          {p ? (<>
            <p>Here's a brief built from aggregate data. Measured facts and assumptions are separated; everything on the right is editable and saves as a <b className="text-foreground">draft</b>.</p>
            <Card className="p-3"><div className="mb-1 text-[10px] font-semibold tracking-wider">EVIDENCE (QUERIES RUN)</div>{p.evidence.map(e => <div key={e.query}>{e.query}: <b className="text-foreground">{e.value}</b></div>)}</Card>
            <Card className="p-3"><div className="mb-1 text-[10px] font-semibold tracking-wider">ASSUMPTIONS (NOT MEASURED)</div><ul className="list-disc pl-4">{p.assumptions.map(a => <li key={a}>{a}</li>)}</ul></Card>
            <Card className="p-3"><div className="mb-1 text-[10px] font-semibold tracking-wider">BUDGET IMPACT</div>Expected spend {fmt(p.budget.expectedSpend)} · max liability {fmt(p.budget.maxLiability)} · needs approval as a new financial policy.</Card>
          </>) : null}
        </div>
        <form className="flex gap-2 border-t border-border p-3" onSubmit={e => { e.preventDefault(); ask.mutate(); }}><input value={text} onChange={e => setText(e.target.value)} className="flex-1 rounded-full border border-border bg-card px-4 py-2 text-xs" placeholder="Describe the goal…" /><Button size="sm" type="submit" disabled={ask.isPending}>Ask</Button></form>
      </section>
      <section data-testid="growth.assistant.output" className="flex-1 space-y-4 overflow-auto p-5">
        {!p ? <p className="text-sm text-muted-foreground">Ask for a brief. The assistant can propose audiences, copy, channels and experiments from aggregate data; it cannot activate, send or spend.</p> : (<>
          <div className="flex items-center justify-between"><h2 className="font-heading text-sm font-semibold">Proposed draft · "{p.name}"</h2><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setP(undefined)}>Discard</Button><Button data-testid="growth.assistant.saveDraft" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? 'Saved as draft' : 'Save as draft campaign'}</Button></div></div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Field label="Audience · rule-based (editable)"><textarea className="w-full rounded-lg border border-border bg-card p-2 font-mono text-xs" rows={2} value={p.audienceRule} onChange={e => edit('audienceRule', e.target.value)} /></Field>
            <Field label="Benefit · caps"><textarea className="w-full rounded-lg border border-border bg-card p-2 text-xs" rows={2} value={p.benefit} onChange={e => edit('benefit', e.target.value)} /></Field>
            {p.copy.map((c, i) => <Field key={c.locale + c.channel} label={'Copy · ' + c.locale + ' · ' + c.channel + (c.needsNativeReview ? ' · needs native review' : '')}><textarea className="w-full rounded-lg border border-border bg-card p-2 text-xs" rows={3} value={c.text} onChange={e => setP({ ...p, copy: p.copy.map((x, j) => j === i ? { ...x, text: e.target.value } : x) })} /></Field>)}
            <Field label="Channels · frequency caps"><textarea className="w-full rounded-lg border border-border bg-card p-2 text-xs" rows={2} value={p.channels} onChange={e => edit('channels', e.target.value)} /></Field>
            <div className="col-span-2"><Field label="Experiment summary"><textarea className="w-full rounded-lg border border-border bg-card p-2 text-xs" rows={2} value={p.experiment} onChange={e => edit('experiment', e.target.value)} /></Field></div>
            <div className="col-span-2"><LiabilityPanel l={p.budget} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Saving creates a DRAFT owned by you. Activation, sending and budget follow the normal approval workflow. Riders' communication preferences and the frequency cap are enforced by notification-service at send time — the assistant cannot bypass them.</p>
        </>)}
      </section>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1"><div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>{children}</div>; }
