import { ok, NGN, type FixtureInput } from './index';
// Board 20a–20c cast: Adaeze, Fri 12 – Sun 14 Sep 2026, P4 7120, Transcorp Hilton.
export async function askFixtures(i: FixtureInput) {
  if (i.method === 'POST' && i.path === '/v1/ask/threads') return { status: 201, json: { id: 'th_77', createdAt: new Date().toISOString() } };
  if (i.method === 'SSE' && /\/v1\/ask\/threads\/.+\/messages/.test(i.path)) {
    const text = String((i.body as { text?: string })?.text ?? '');
    if (/refund|cancel/i.test(text)) return ok([
      ...'For this Saver fare: if Air Peace cancels, you can take their next available flight or a full refund to your UBI Wallet — the airline is required to offer both. If you cancel, the fare is not refundable; the ₦8,400 taxes are.'.split(' ').map(w => ({ type: 'token', text: w + ' ' })),
      { type: 'sources', sources: [{ title: 'UBI Travel terms v4 · $6 Airline cancellations (Nigeria)', ref: 'policy://travel/v4#6', version: 'v4', updatedAt: '2 Sep 2026' }, { title: 'Air Peace fare rules · Saver · fetched with this quote', ref: 'supplier://airpeace/fare/saver' }] },
      { type: 'token', text: 'This explains the rules; it is not a promise of a specific refund. Any refund appears in Activity with its own status.' }, { type: 'done' }]);
    if (/send|transfer.*money|pay .* friend/i.test(text)) return ok([{ type: 'refused', deepLink: 'ubi://wallet/send', policy: 'p2p_out_of_scope' }, { type: 'done' }]);
    return ok([
      ...'Here\u2019s a plan for Fri 12 – Sun 14 Sep. Flights and the hotel are live prices; the rides are estimates until closer to the day.'.split(' ').map(w => ({ type: 'token', text: w + ' ' })),
      { type: 'card', card: { id: 'c1', kind: 'flight', status: 'live', quotedAt: new Date(Date.now() - 12000).toISOString(), title: '06:45 LOS → 07:55 ABV · 1h 10m · non-stop', subtitle: 'Flight · out', price: NGN(148500), warnings: ['Air Peace P4 7120 · Saver · 20 kg bag included · changes ₦15,000 · no refund · times WAT', 'Price can change until you pay — the airline does not hold seats.'], offerRef: 'off_p4_7120_saver' } },
      { type: 'card', card: { id: 'c2', kind: 'stay', status: 'live', quotedAt: new Date(Date.now() - 12000).toISOString(), title: 'Transcorp Hilton Abuja · King room', subtitle: 'Stay · 2 nights', price: NGN(370000), warnings: ['1.9 km from CBD · 1 guest · pay ₦370,000 now · ₦0 at the hotel · free cancellation until Thu 11 Sep 18:00 WAT'], offerRef: 'rate_hilton_king' } },
      { type: 'card', card: { id: 'c3', kind: 'ride_estimate', status: 'suggestion', title: 'Home → MMA2 at 04:50 (~₦6,200) · ABV → hotel on landing (~₦9,800). Reserve them once the flight is booked — prices are set when a driver is assigned.', subtitle: 'Rides · estimates only' } },
      { type: 'clarify', fields: [{ key: 'return_window', label: 'Sunday return — leave Abuja', kind: 'chips', options: ['Morning', 'Afternoon', 'Evening'], required: true }, { key: 'passenger', label: 'Who is travelling', kind: 'passenger' }] },
      { type: 'review_ready', reviewId: 'rv_1', totals: NGN(518500) }, { type: 'done' }]);
  }
  if (i.method === 'GET' && i.path === '/v1/ask/reviews/rv_1') return ok({ id: 'rv_1', status: 'awaiting_confirmation', termsVersion: '7f3a', expiresAt: new Date(Date.now() + 174000).toISOString(), total: NGN(518500), paymentMethod: { id: 'pm_wallet', label: 'UBI Wallet · ₦612,300' }, assuranceRequired: 'pin', adjustments: [],
    items: [
      { kind: 'flight', title: 'Flight · Air Peace P4 7120', detail: 'Fri 12 Sep 06:45 LOS → 07:55 ABV (WAT) · Adaeze Nwosu · Saver', price: NGN(148500), priceBreakdown: [{ label: 'Fare ₦140,100 + taxes ₦8,400 · 20 kg bag', amount: NGN(148500) }], terms: [{ text: 'Non-refundable if you cancel · change fee ₦15,000 + fare difference', tone: 'warning' }] },
      { kind: 'stay', title: 'Stay · Transcorp Hilton Abuja', detail: 'King room · Fri 12 → Sun 14 Sep · 1 guest · check-in from 14:00', price: NGN(370000), priceBreakdown: [{ label: 'Pay now ₦370,000 (incl. 12.5% tax + service) · at the hotel ₦0', amount: NGN(370000) }], terms: [{ text: 'Free cancellation until Thu 11 Sep 18:00 WAT · then 1 night charged', tone: 'positive' }] }] });
  if (i.method === 'POST' && i.path === '/v1/ask/reviews/rv_1/confirm') return { status: 202, json: { executionId: 'ex_1' } };
  if (i.method === 'GET' && i.path === '/v1/ask/executions/ex_1') return ok({ id: 'ex_1', status: 'partly_booked', startedAt: new Date().toISOString(), items: [
    { kind: 'payment', title: 'Payment authorised', state: 'authorized', detail: '₦518,500 reserved in your wallet · charged per item on confirmation' },
    { kind: 'stay', title: 'Stay confirmed', state: 'confirmed', supplierRef: 'HLT-8Q2M4', orderId: 'trv_ord_9K33', charged: NGN(370000), detail: 'Transcorp Hilton · ref HLT-8Q2M4 · free cancellation until Thu 18:00 WAT' },
    { kind: 'flight', title: 'Flight · P4 7120 Saver', state: 'failed_released', released: NGN(148500), detail: 'Airline: fare class no longer available. Nothing was charged for the flight.', alternatives: [{ id: 'alt1', kind: 'flight', status: 'live', quotedAt: new Date().toISOString(), title: 'Same flight, Flex · refundable −₦10,000', subtitle: 'Flight · out', price: NGN(171200), offerRef: 'off_p4_7120_flex' }, { id: 'alt2', kind: 'flight', status: 'live', quotedAt: new Date().toISOString(), title: '09:20 Ibom Air QI 0316 · Saver', subtitle: 'Flight · out', price: NGN(152000), offerRef: 'off_qi_0316_saver' }] } ] });
  if (i.method === 'POST' && /\/handoff$/.test(i.path)) return { status: 201, json: { supportCaseId: 'case_ask_77', estimatedWaitSec: 240 } };
  return undefined;
}
