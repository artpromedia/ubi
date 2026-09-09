import { api, openEventStream, type Money, type SseEvent } from '@ubi/mobile-core';
export type CardStatus = 'suggestion' | 'live' | 'expired';
export type Card = { id: string; kind: 'flight' | 'stay' | 'ride_estimate' | 'ride_quote' | 'policy'; status: CardStatus; quotedAt?: string; title: string; subtitle?: string; price?: Money; warnings?: string[]; offerRef?: string; editInForm?: { route: string; params: Record<string, unknown> } };
export type ClarifyField = { key: string; label: string; kind: 'chips' | 'passenger' | 'date' | 'text'; options?: string[]; required?: boolean };
export type Source = { title: string; ref: string; version?: string; updatedAt?: string };
export type AskEvent = SseEvent & ({ type: 'token'; text: string } | { type: 'card'; card: Card } | { type: 'clarify'; fields: ClarifyField[] } | { type: 'sources'; sources: Source[] } | { type: 'review_ready'; reviewId: string; totals: Money } | { type: 'refused'; deepLink: string; policy: string } | { type: 'done' });
export type ReviewItem = { kind: 'flight' | 'stay' | 'ride_reservation'; title: string; detail?: string; price: Money; priceBreakdown?: { label: string; amount: Money }[]; terms: { text: string; tone: 'neutral' | 'positive' | 'warning' }[] };
export type Adjustment = { type: 'fare_discount' | 'fee_waiver' | 'credit' | 'referral_reward'; label: string; amount: Money; fundedBy?: string; capNote?: string; reasonCode?: string };
export type Review = { id: string; status: 'awaiting_confirmation' | 'expired' | 'superseded'; termsVersion: string; expiresAt: string; items: ReviewItem[]; adjustments?: Adjustment[]; total: Money; paymentMethod: { id: string; label: string }; assuranceRequired?: 'pin' | 'biometric'; notes?: string[] };
export type ExecutionItemState = 'authorized' | 'submitted' | 'supplier_pending' | 'confirmed' | 'ticketed' | 'failed_released' | 'unknown_reconciling' | 'reserved' | 'reservation_failed';
export type ExecutionItem = { kind: 'payment' | 'flight' | 'stay' | 'ride_reservation'; title: string; state: ExecutionItemState; supplierRef?: string; orderId?: string; charged?: Money; released?: Money; detail?: string; alternatives?: Card[] };
export type Execution = { id: string; status: 'processing' | 'confirmed' | 'partly_booked' | 'failed'; startedAt: string; items: ExecutionItem[] };

export const askApi = {
  openThread: (source: string) => api<{ id: string }>('POST', '/v1/ask/threads', { source }),
  stream: (threadId: string, text: string, clarifications: Record<string, unknown> | undefined, onEvent: (e: AskEvent) => void, onDone: (err?: Error) => void) =>
    openEventStream('/v1/ask/threads/' + threadId + '/messages', { text, clarifications }, onEvent as (e: SseEvent) => void, onDone),
  getReview: (reviewId: string) => api<Review>('GET', '/v1/ask/reviews/' + reviewId),
  confirmReview: (reviewId: string, termsVersion: string, proof: string) => api<{ executionId: string }>('POST', '/v1/ask/reviews/' + reviewId + '/confirm', { termsVersion, assurance: { method: 'pin', proof } }),
  getExecution: (executionId: string) => api<Execution>('GET', '/v1/ask/executions/' + executionId),
  handoff: (threadId: string, includeTranscript: boolean) => api<{ supportCaseId: string; estimatedWaitSec: number }>('POST', '/v1/ask/threads/' + threadId + '/handoff', { includeTranscript }),
};
