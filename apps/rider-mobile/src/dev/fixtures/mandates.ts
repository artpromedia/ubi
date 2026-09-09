import { ok, NGN, type FixtureInput } from './index';
const m1 = { id: 'mnd_3K', action: 'airport_pickup.reserve', title: 'Airport ride when my flight lands', passengers: 'self_only', categories: ['UBI Go', 'Comfort'], perRunCap: NGN(15000), periodCap: { amount: NGN(60000), runs: 4, period: 'month' }, expiresAt: '2026-12-31T23:59:59+01:00', constraints: [{ key: 'price_above_cap', label: 'Price is above my per-ride limit', mode: 'always_ask' }, { key: 'lands_after_23_00', label: 'Flight lands after 23:00', mode: 'ask' }, { key: 'pickup_not_airport', label: 'Pickup is not the arrival airport', mode: 'always_ask' }], status: 'active', usage: { amountUsed: NGN(19400), runsUsed: 2, periodStart: '2026-09-01' }, summary: 'Reserve a UBI Go/Comfort pickup at the arrival airport for flights in my itinerary · up to ₦15,000 per ride · max 4 rides/month · until 31 Dec 2026', receiptsCount: 3 };
const m2 = { ...m1, id: 'mnd_4L', action: 'flight.rebook_on_cancel', title: 'Rebook if the airline cancels', categories: ['Saver', 'Flex'], perRunCap: NGN(25000), summary: 'Same route, same day, any partner airline · pay up to ₦25,000 more than the original fare · only me as passenger · same or better bag allowance', usage: { amountUsed: NGN(0), runsUsed: 0, periodStart: '2026-09-01' }, receiptsCount: 0 };
const m3 = { ...m1, id: 'mnd_5M', action: 'scheduled_ride.book', title: 'Weekday 07:30 ride to the office', status: 'paused', summary: 'Paused by you on 1 Sep · resumes when you say so · nothing runs while paused', receiptsCount: 12 };
const runs = [
  { id: 'run_1', mandateId: 'mnd_3K', at: '2026-09-09T08:21:00+01:00', outcome: 'executed', grantId: 'ag_4R', receiptRef: 'AUT-3K9F2', resultRef: 'res_88', amount: NGN(9800), title: 'Pickup reserved at ABV', summary: 'Because your flight P4 7120 is due 07:55 Fri, UBI reserved a Comfort pickup at Door 3 for 08:20 under "Airport ride when my flight lands".', allowance: { used: NGN(29200), cap: NGN(60000), runsUsed: 3, runs: 4 } },
  { id: 'run_0', mandateId: 'mnd_3K', at: '2026-08-31T20:58:00+01:00', outcome: 'blocked', reasonCode: 'price_above_cap', amount: NGN(16900), title: 'Sun 31 Aug · LOS arrival', summary: 'Lowest fare ₦16,900 was above your ₦15,000 limit — we asked you instead; you booked it yourself at 21:04', detail: 'Lowest fare ₦16,900 was above your ₦15,000 limit' },
  { id: 'run_m1', mandateId: 'mnd_3K', at: '2026-08-21T10:02:00+01:00', outcome: 'executed', receiptRef: 'AUT-2H7D1', amount: NGN(9600), title: 'Thu 21 Aug · ABV arrival', summary: 'Go · ₦9,600 · completed' },
];
export async function mandateFixtures(i: FixtureInput) {
  if (i.method === 'GET' && i.path === '/v1/mandates') return ok([m1, m2, m3]);
  if (i.method === 'GET' && /^\/v1\/mandates\/mnd_/.test(i.path) && !/executions/.test(i.path)) return ok([m1, m2, m3].find(m => i.path.endsWith(m.id)) ?? m1);
  if (i.method === 'GET' && /\/v1\/mandates\/mnd_3K\/executions/.test(i.path)) return ok(runs);
  if (i.method === 'GET' && /\/v1\/mandates\/executions\//.test(i.path)) return ok(runs.find(r => i.path.endsWith(r.id)) ?? runs[0]);
  if (i.method === 'POST' && i.path === '/v1/mandates') return { status: 201, json: { ...m1, id: 'mnd_new', ...(i.body as object) } };
  if (i.method === 'PATCH' && /^\/v1\/mandates\//.test(i.path)) return ok({ ...m1, status: (i.body as { op: string }).op === 'pause' ? 'paused' : (i.body as { op: string }).op === 'revoke' ? 'revoked' : 'active' });
  return undefined;
}
