import { Card, Badge } from '@ubi/ui';
type Money = { amountMinor: number; currency: string };
const fmt = (m: Money) => '₦' + Math.round(m.amountMinor / 100).toLocaleString('en-NG');
/** /benefits — same server payload as RN BenefitsScreen (22b): credit, offers with status, changes with reason + terms. */
export default async function BenefitsPage() {
  const b = await (await fetch(process.env.UBI_API_BASE + '/v1/benefits', { cache: 'no-store' })).json() as { creditTotal: Money; credits: { amount: Money; expiresAt: string; perRideCap: Money }[]; offers: { id: string; title: string; status: string; description: string }[]; changes: { id: string; kind: string; amount: Money; title: string; explanation: string; termsRef?: { title: string; url?: string } }[] };
  return (
    <div className="mx-auto max-w-2xl space-y-3 p-6">
      <h1 className="font-heading text-2xl font-semibold text-[#191414]">Benefits</h1>
      <Card className="rounded-2xl bg-[#191414] p-4 text-white"><div className="text-[11px] font-semibold uppercase tracking-wider text-[#A3A3A3]">Ride credit</div><div className="font-heading text-3xl font-bold tabular-nums">{fmt(b.creditTotal)}</div><div className="text-xs text-[#A3A3A3]">{b.credits.map(c => fmt(c.amount) + ' expires ' + c.expiresAt).join(' · ')}{b.credits[0] ? ' · use up to ' + fmt(b.credits[0].perRideCap) + ' per ride · rides only' : ''}</div></Card>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#999]">Offers for you</h2>
      {b.offers.map(o => <Card key={o.id} className="rounded-2xl p-4"><div className="flex items-center justify-between"><span className="font-semibold text-[#191414]">{o.title}</span><Badge className="text-[10px] uppercase">{o.status.replace(/_/g, ' ')}</Badge></div><p className="text-xs text-[#666]">{o.description}</p></Card>)}
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#999]">Recent changes</h2>
      <Card className="divide-y divide-[#F0F0F0] rounded-2xl px-4">{b.changes.map(c => <div key={c.id} className="flex gap-3 py-3"><Badge className={'h-fit text-[10px] uppercase ' + (c.kind === 'reversed' ? 'bg-[#FDE8E8] text-[#C53030]' : 'bg-[#E8F8EE] text-[#148F3D]')}>{c.kind}</Badge><div className="flex-1 text-sm"><div className="text-[#191414]">{(c.kind === 'reversed' ? '−' : '+') + fmt(c.amount)} · {c.title}</div><div className="text-xs text-[#666]">{c.explanation}</div>{c.termsRef ? <a className="text-xs font-medium text-[#18A349]" href={c.termsRef.url}>See the terms</a> : null}</div></div>)}</Card>
    </div>
  );
}
