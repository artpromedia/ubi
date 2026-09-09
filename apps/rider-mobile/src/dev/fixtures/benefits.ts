import { ok, NGN, type FixtureInput } from './index';
export async function benefitsFixtures(i: FixtureInput) {
  if (i.method === 'GET' && i.path === '/v1/benefits') return ok({ creditTotal: NGN(1500), credits: [{ amount: NGN(500), expiresAt: 'Tue 30 Sep', perRideCap: NGN(500), scope: 'rides', restrictions: ['rides only, not travel', "can't be withdrawn"] }, { amount: NGN(1000), expiresAt: '31 Oct', perRideCap: NGN(500), scope: 'rides' }],
    offers: [
      { id: 'o1', type: 'fee_waiver', title: 'Rider fee waived this week', status: 'active', description: 'Service-fee waiver · every ride in Lagos until Sun 14 Sep 23:59 · no minimum · stacks with credit and one fare discount', campaignVersionId: 'cv_fee_w37_v2' },
      { id: 'o2', type: 'credit', title: 'Abuja trip · airport ride credit', status: 'scheduled', statusAt: '2026-09-12', description: '₦2,000 earned credit for rides to or from LOS/ABV on 12–14 Sep · because you booked a flight with UBI · max ₦1,000 per ride · unused amount lapses 15 Sep', campaignVersionId: 'cv_airport_v1' },
      { id: 'o3', type: 'fare_discount', title: 'Welcome back · ₦500 off 2 rides', status: 'used_up', statusAt: '2026-09-09T08:14:00+01:00', description: 'The Lagos budget for this offer ran out on 9 Sep before your second ride · fare discount · minimum ₦2,000 · nothing owed either way', campaignVersionId: 'cv_wb_w1_v1' }],
    changes: [
      { id: 'ch1', kind: 'reversed', amount: NGN(500), at: '2026-09-08', title: 'referral credit · 8 Sep', explanation: "Tunde's first trip was refunded in full, so it no longer counts as a paid trip (Referral terms v3 $4). Nothing else was touched.", reasonCode: 'referee_trip_refunded', termsRef: { title: 'Referral terms v3', section: '$4', url: 'policy://referrals/v3#4' }, disputable: true },
      { id: 'ch2', kind: 'earned', amount: NGN(1000), at: '2026-09-05', title: 'referral credit · 5 Sep', explanation: 'Ngozi completed and paid her first ride' }] });
  if (i.method === 'GET' && i.path === '/v1/referrals') return ok({ code: 'ADAEZE-K7', url: 'ubi.africa/r/ADAEZE-K7', reward: NGN(1000), refereeBenefit: NGN(500), qualifyingEvent: 'first completed and paid ride within 30 days', monthlyCap: 10, earnedTotal: NGN(1000), note: "Sharing a phone or card with someone at home doesn't disqualify a referral by itself — a person reviews unusual patterns.",
    referrals: [
      { id: 'r1', displayName: 'Ngozi E.', initials: 'NE', stage: 'rewarded', detail: 'First paid ride 5 Sep · ₦1,000 credited' },
      { id: 'r2', displayName: 'Funmi A.', initials: 'FA', stage: 'qualifying', detail: 'Signed up 7 Sep · no ride yet · 28 days left', deadline: '2026-10-07' },
      { id: 'r3', displayName: 'Kemi O.', initials: 'KO', stage: 'in_review', detail: "Rode 8 Sep · we're checking this referral (usually within 24 h). You'll see the outcome here." },
      { id: 'r4', displayName: 'Tunde B.', initials: 'TB', stage: 'reversed', detail: 'First ride refunded → reward reversed 8 Sep. Counts again if he completes a paid ride by 2 Oct.' }] });
  if (i.method === 'POST' && i.path === '/v1/referrals/share') return ok({ code: 'ADAEZE-K7', url: 'https://ubi.africa/r/ADAEZE-K7' });
  if (i.method === 'POST' && i.path === '/v1/attribution/claim') return ok({ attributed: true, kind: 'referral' });
  return undefined;
}
