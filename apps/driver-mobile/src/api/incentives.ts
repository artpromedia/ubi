import { api, type Money } from '@ubi/mobile-core';
export type Rebate = { id: string; title: string; baseBps: number; reductionBps: number; kind: 'percentage_points' | 'percent_of_commission'; effectiveBps: number; endsAt: string; eligible: { used: number; cap: number; rebatedSoFar: Money }; fundedBy: string; appliesTo: string; example: { tripRef: string; fare: Money; commissionBefore: Money; commissionAfter: Money; rebate: Money; ifPercentOfCommission: Money } };
export type Window = { id: string; title: string; startsAt: string; endsAt: string; zones: string[]; tripCap: number; moneyCap: Money; used: { trips: number; saved: Money }; live: boolean; rule: string };
export type Milestone = { label: string; done: boolean; paid?: Money; progress?: number; target?: number; deadline?: string };
export type Overview = { strip?: { headline: string; detail: string; badge: string } | null; rebates: Rebate[]; windows: Window[]; referral: { code: string; reward: Money; referees: { name: string; milestones: Milestone[] }[] }; quests: { title: string; progress: number; target: number; bonus: Money; paysOn: string }[]; footnote: string };
export type RebateDetail = Rebate & { periodLabel: string; intro: string; rules: { label: string; value: string }[]; note: { title: string; body: string } };
export type StatementLine = { ledgerLineId: string; kind: string; label: string; amount: Money; tone: 'neutral' | 'positive' | 'negative' | 'warning' };
export type StatementTrip = { tripId: string; title: string; fare: Money; paymentMethod: string; commission: Money; rebate?: Money; windowWaiver?: boolean; windowNote?: string; owedToUbi: Money; refunded?: boolean; reversal?: { amount: Money; reason: string } };
export type Statement = { periodId: string; title: string; status: 'draft' | 'finalised' | 'paid'; paysAt: string; tripCount: number; lines: StatementLine[]; trips: StatementTrip[]; payout: Money };
export const incentivesApi = {
  overview: () => api<Overview>('GET', '/v1/driver/incentives'),
  detail: (id: string) => api<RebateDetail>('GET', '/v1/driver/incentives/' + id),
  statement: (periodId: string) => api<Statement>('GET', '/v1/driver/statements/' + periodId),
};
