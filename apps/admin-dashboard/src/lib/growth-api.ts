import { apiClient } from './api-client';
export type Money = { amountMinor: number; currency: string };
export const fmt = (m?: Money) => (m ? '₦' + Math.round(m.amountMinor / 100).toLocaleString('en-NG') : '—');
export type CampaignState = 'draft' | 'simulated' | 'awaiting_approval' | 'scheduled' | 'active' | 'paused' | 'exhausted' | 'ended';
export type Campaign = { id: string; name: string; sub: string; state: CampaignState; stateNote?: string; market: string; window: string; budget: { limit: Money; reserved?: Money; spent?: Money }; redemptions?: string; actions: string[] };
export type Liability = { eligibleUsers: number; expectedRedemptionPct: number; redemptionRange: [number, number]; maxLiability: Money; expectedSpend: Money; exhaustionDayAtHighRedemption?: number; warnings: string[]; overlaps: string[] };
export type Metric = { key: string; label: string; value: string; denominator: string; window: string; sampleSize: number; ci95?: [number, number]; method: 'holdout_difference' | 'transaction_confirmed' | 'count'; note?: string };
export const growthApi = {
  campaigns: () => apiClient.get<Campaign[]>('/v1/growth/campaigns'),
  createDraft: (body: unknown) => apiClient.post<Campaign>('/v1/growth/campaigns', body),
  simulate: (id: string, v: number) => apiClient.post<Liability>('/v1/growth/campaigns/' + id + '/versions/' + v + '/simulate', {}),
  submit: (id: string, v: number) => apiClient.post<void>('/v1/growth/campaigns/' + id + '/versions/' + v + '/submit', {}),
  action: (id: string, action: string, approvalId?: string, reason?: string) => apiClient.post<void>('/v1/growth/campaigns/' + id + '/actions', { action, approvalId, reason }),
  outcome: (id: string, v: number) => apiClient.get<{ metrics: Metric[]; attribution: { taggedPct: number; organicPct: number; unknownPct: number }; caveats: string[] }>('/v1/growth/campaigns/' + id + '/versions/' + v + '/outcome'),
  reviewQueue: () => apiClient.get<ReviewCase[]>('/v1/growth/referrals/review-queue'),
  decide: (caseId: string, decision: 'qualify' | 'hold' | 'deny', reasonCode: string, holdHours?: number) => apiClient.post<void>('/v1/growth/referrals/review-queue/' + caseId + '/decision', { decision, reasonCode, holdHours }),
  assistant: (threadId: string, text: string) => apiClient.post<Proposal>('/v1/ai/marketing/threads/' + threadId + '/messages', { text }),
  travelExceptions: () => apiClient.get<TravelException[]>('/v1/ops/travel/exceptions'),
  travelAction: (id: string, action: string) => apiClient.post<void>('/v1/ops/travel/exceptions/' + id + '/actions', { action }),
  providerHealth: () => apiClient.get<{ label: string; value: string; note: string; tone: 'ok' | 'warn' | 'neutral' }[]>('/v1/ops/travel/providers/health'),
  aiActions: () => apiClient.get<AiAction[]>('/v1/ops/ai/actions'),
  aiMetrics: () => apiClient.get<{ taskSuccessPct: number; p95Ms: number; costPerTask: Money; unauthorised: number }>('/v1/ops/ai/metrics'),
};
export type ReviewCase = { id: string; referral: string; sub: string; kind: 'rider' | 'driver_milestone'; qualifyingEvent: string; signals: { rule: string; severity: 'info' | 'warn' | 'high'; text: string }[]; waitingHours: number; heldReward: Money; why: string; maskedView: string; reward: string };
export type Proposal = { brief: string; audienceRule: string; benefit: string; copy: { locale: string; channel: string; text: string; needsNativeReview?: boolean }[]; channels: string; experiment: string; evidence: { query: string; value: string }[]; assumptions: string[]; budget: Liability; name: string };
export type TravelException = { id: string; orderId: string; supplierRef: string; traveller: string; item: string; sub: string; kind: 'pending_ticketing' | 'unknown_result' | 'refund_due' | 'settlement_difference'; state: string; since: string; money: string; moneyNote?: string; nextAction: { action: string; label: string }[] };
export type AiAction = { at: string; actor: string; actorSub: string; action: string; tool: string; authKind: 'grant' | 'mandate' | 'read_only' | 'none'; authRef?: string; authNote?: string; outcome: 'done' | 'partial' | 'blocked' | 'refused' | 'error'; outcomeNote?: string; tokens?: number; cost?: Money };
