import { api, type Money } from '@ubi/mobile-core';
export type Credit = { amount: Money; expiresAt: string; perRideCap: Money; scope: 'rides' | 'airport_rides'; restrictions?: string[] };
export type Offer = { id: string; type: 'fare_discount' | 'fee_waiver' | 'credit'; title: string; status: 'active' | 'scheduled' | 'used_up' | 'expired' | 'ineligible'; statusAt?: string; description: string; campaignVersionId: string };
export type BenefitChange = { id: string; kind: 'earned' | 'reversed' | 'expired'; amount: Money; at: string; title: string; explanation: string; reasonCode?: string; termsRef?: { title: string; section?: string; url?: string }; disputable?: boolean };
export type Benefits = { credits: Credit[]; creditTotal: Money; offers: Offer[]; changes: BenefitChange[] };
export type Referral = { id: string; displayName: string; initials: string; stage: 'invited' | 'installed' | 'qualifying' | 'in_review' | 'rewarded' | 'reversed' | 'expired'; detail: string; deadline?: string };
export type ReferralProgram = { code: string; url: string; reward: Money; refereeBenefit: Money; qualifyingEvent: string; monthlyCap: number; earnedTotal: Money; referrals: Referral[]; note: string };
export const benefitsApi = {
  get: () => api<Benefits>('GET', '/v1/benefits'),
  referrals: () => api<ReferralProgram>('GET', '/v1/referrals'),
  share: () => api<{ code: string; url: string }>('POST', '/v1/referrals/share'),
  claim: (input: { code?: string; token?: string; campaign?: string; source: 'deferred_link' | 'web_handoff' | 'manual' }) => api<{ attributed: boolean; kind: string }>('POST', '/v1/attribution/claim', input),
};
