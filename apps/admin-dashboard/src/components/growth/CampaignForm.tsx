'use client';
import { useState } from 'react';
import { Button, Card, Input, Label, Badge } from '@ubi/ui';
import { growthApi, type Liability } from '@/lib/growth-api';
import { LiabilityPanel } from './LiabilityPanel';

const BENEFITS = [['fare_discount', 'Fare discount'], ['fee_waiver', 'Fee waiver'], ['credit', 'Earned credit'], ['driver_rebate', 'Driver rebate']] as const;
/** Board 23a — every rule a rider later sees on 22a/22b. Save → DRAFT; Simulate → liability; Submit → approval (author ≠ approver, enforced server-side). */
export function CampaignForm({ author }: { author: string }) {
  const [v, setV] = useState({ name: 'Welcome back · Lagos · Sep wave 2', benefitType: 'fare_discount', audienceRule: 'paid_trips >= 1 AND days_since_last_trip >= 30 AND home_city = LOS AND NOT in_holdout(GRW-042)', market: 'LOS', windowStart: '2026-09-15T00:00', windowEnd: '2026-09-28T23:59', timezone: 'Africa/Lagos', value: '500', perUser: '2', minSpend: '2000', qualificationEvent: 'ride.completed_and_paid', stacking: 'credit, fee_waiver', priority: '20', funding: 'UBI marketing · GRW-LOS-2026', budgetLimit: '2500000', holdoutPct: '10', experimentId: 'GRW-042', measurementDays: '28', copy: 'Welcome back — ₦500 off your next 2 rides in Lagos until 28 Sep. Fares ₦2,000+. Drivers are paid in full.' });
  const [id, setId] = useState<string | undefined>(); const [liab, setLiab] = useState<Liability | undefined>(); const [at, setAt] = useState<string | undefined>(); const [busy, setBusy] = useState<string | undefined>();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const body = () => ({ name: v.name, benefitType: v.benefitType, audienceRule: v.audienceRule, market: v.market, window: { start: v.windowStart, end: v.windowEnd, timezone: v.timezone }, value: { amountMinor: Number(v.value) * 100, currency: 'NGN' }, caps: { perUser: Number(v.perUser), minSpend: { amountMinor: Number(v.minSpend) * 100, currency: 'NGN' } }, qualificationEvent: v.qualificationEvent, stacking: { stacksWith: v.stacking.split(',').map(s => s.trim()), priority: Number(v.priority) }, funding: { party: 'ubi_marketing', costCentre: v.funding }, budgetLimit: { amountMinor: Number(v.budgetLimit) * 100, currency: 'NGN' }, experiment: { id: v.experimentId, holdoutPct: Number(v.holdoutPct), assignment: 'stable_by_user_id', measurementDays: Number(v.measurementDays) }, copy: v.copy });
  const save = async () => { setBusy('save'); const c = await growthApi.createDraft(body()); setId(c.id); setBusy(undefined); return c.id; };
  const simulate = async () => { setBusy('sim'); const cid = id ?? await save(); const l = await growthApi.simulate(cid, 1); setLiab(l); setAt(new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })); setBusy(undefined); };
  const submit = async () => { setBusy('submit'); const cid = id ?? await save(); await growthApi.submit(cid, 1); setBusy(undefined); };
  const F = ({ label, k, wide, textarea }: { label: string; k: keyof typeof v; wide?: boolean; textarea?: boolean }) => (
    <div className={wide ? 'col-span-2 space-y-1' : 'space-y-1'}><Label className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</Label>{textarea ? <textarea className="w-full rounded-lg border border-border bg-card p-2 text-sm" rows={2} value={v[k]} onChange={set(k)} /> : <Input value={v[k]} onChange={set(k)} />}</div>
  );
  return (
    <div className="flex gap-5">
      <form data-testid="growth.campaign.form" className="grid flex-1 grid-cols-2 gap-x-5 gap-y-3" onSubmit={e => e.preventDefault()}>
        <F label="Name" k="name" />
        <div className="space-y-1"><Label className="text-[10px] tracking-wider text-muted-foreground uppercase">Benefit type</Label><div className="flex flex-wrap gap-1.5">{BENEFITS.map(([id, label]) => <button key={id} type="button" onClick={() => setV({ ...v, benefitType: id })} className={'rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide ' + (v.benefitType === id ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground')}>{label}</button>)}</div></div>
        <F label="Audience · rule-based segment" k="audienceRule" wide textarea />
        <F label="Market" k="market" /><F label="Time zone" k="timezone" />
        <F label="Window start" k="windowStart" /><F label="Window end" k="windowEnd" />
        <F label="Value (₦ off the fare)" k="value" /><F label="Max uses per rider" k="perUser" />
        <F label="Minimum fare (₦)" k="minSpend" /><F label="Qualification event" k="qualificationEvent" />
        <F label="Stacks with" k="stacking" /><F label="Priority" k="priority" />
        <F label="Funding · cost centre" k="funding" /><F label="Budget limit (₦, hard)" k="budgetLimit" />
        <F label="Experiment id" k="experimentId" /><F label="Holdout %" k="holdoutPct" />
        <F label="Copy shown to riders (validated against the rules)" k="copy" wide textarea />
        <div className="col-span-2 flex gap-2 pt-2"><Button type="button" variant="outline" disabled={!!busy} onClick={save}>Save draft</Button><Button type="button" variant="outline" disabled={!!busy} onClick={simulate}>Simulate</Button><Button type="button" data-testid="growth.campaign.submit" disabled={!!busy} onClick={submit}>Submit for approval</Button></div>
      </form>
      <aside className="w-[340px] shrink-0 space-y-3">
        <LiabilityPanel l={liab} simulatedAt={at} />
        <Card className="p-4 space-y-2 text-xs text-muted-foreground"><div className="text-[10px] font-semibold tracking-wider">APPROVAL REQUIRED</div><p>New financial policy in {v.market} → <b className="text-foreground">independent approver</b> (not the author) · funding owner sign-off · activation is a separate approved action, so scheduling does not spend.</p><div className="flex gap-1.5"><Badge variant="secondary">AUTHOR: {author}</Badge><Badge variant="secondary">APPROVER: —</Badge></div></Card>
      </aside>
    </div>
  );
}
