import { Card, Badge } from '@ubi/ui';
import { HandoffBanner, HandoffFallbackNote } from '@/components/travel/HandoffBanner';
type Item = { kind: string; dateLabel: string; title: string; subtitle?: string; refs?: string; status: string; policy?: string; actions: { key: string; label: string }[] };
const PILL: Record<string, string> = { ticketed: 'bg-[#E8F8EE] text-[#148F3D]', confirmed: 'bg-[#E8F8EE] text-[#148F3D]', supplier_pending: 'bg-[#FEF6E8] text-[#B8860B]', not_reserved: 'bg-[#FDE8E8] text-[#C53030]', not_booked: 'bg-[#F5F5F5] text-[#666]' };
/** Board 23f (mobile web) — booking management from an SMS link; rides need the app (live tracking) and say so; everything else works here. */
export default async function TripPage({ params, searchParams }: { params: { tripId: string }; searchParams: { ref?: string; c?: string } }) {
  const trip = await (await fetch(process.env.UBI_API_BASE + '/v1/travel/trips/' + params.tripId, { headers: { cookie: '' }, cache: 'no-store' })).json() as { title: string; dates: string; traveller: string; items: Item[] };
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-[#F5F5F5]">
      <HandoffBanner tripId={params.tripId} referralCode={searchParams.ref} campaign={searchParams.c} />
      <main className="flex-1 space-y-2.5 p-4">
        <h1 className="font-heading text-xl font-semibold text-[#191414]">{trip.title} · {trip.dates}</h1>
        <p className="text-[12.5px] text-[#666]">{trip.traveller} · all times WAT · you're on the web version</p>
        {trip.items.map(it => (
          <Card key={it.title} className="space-y-1.5 rounded-2xl p-4">
            <div className="flex items-center justify-between"><span className="text-[11px] font-semibold uppercase tracking-wide text-[#2B6CB0]">{it.dateLabel}</span><Badge className={'text-[10px] uppercase ' + (PILL[it.status] ?? PILL.not_booked)}>{it.status.replace(/_/g, ' ')}</Badge></div>
            <div className="text-[15px] font-semibold text-[#191414]">{it.title}</div>
            {it.subtitle ? <div className="text-xs text-[#666]">{it.subtitle}</div> : null}
            {it.refs ? <div className="text-xs text-[#666]">{it.refs}</div> : null}
            {it.kind === 'ride_reservation' ? <p className="text-xs text-[#666]">Rides are booked in the app (live driver tracking needs it). We'll remind you on landing. <a className="font-semibold text-[#18A349]" href={'https://links.ubi.africa/trips/' + params.tripId}>Get the app</a> · or continue on web without it.</p> : <div className="flex flex-wrap gap-2 pt-1">{it.actions.map(a => <a key={a.key} href={'/trips/' + params.tripId + '/' + a.key} className="rounded-full border border-[#E5E5E5] px-3 py-2 text-xs font-semibold text-[#191414]">{a.label}</a>)}</div>}
          </Card>
        ))}
      </main>
      <HandoffFallbackNote referralCode={searchParams.ref} campaign={searchParams.c} />
    </div>
  );
}
