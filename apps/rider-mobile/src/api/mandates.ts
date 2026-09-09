import { api, type Money } from '@ubi/mobile-core';
export type AllowedAction = 'airport_pickup.reserve' | 'flight.rebook_on_cancel' | 'scheduled_ride.book';
export type Constraint = { key: string; label: string; mode: 'always_ask' | 'ask' | 'allow' };
export type MandateInput = { action: AllowedAction; title: string; passengers: 'self_only' | 'saved_passengers'; categories: string[]; providers?: string[]; perRunCap: Money; periodCap: { amount: Money; runs: number; period: 'month' }; maxPriceVariance?: Money; expiresAt: string; constraints: Constraint[] };
export type Mandate = MandateInput & { id: string; status: 'active' | 'paused' | 'revoked' | 'expired'; usage: { amountUsed: Money; runsUsed: number; periodStart: string }; lastRunAt?: string; summary: string; receiptsCount: number };
export type MandateExecution = { id: string; mandateId: string; at: string; outcome: 'executed' | 'blocked'; reasonCode?: string; grantId?: string; receiptRef?: string; resultRef?: string; amount?: Money; summary: string; title: string; detail?: string; allowance?: { used: Money; cap: Money; runsUsed: number; runs: number } };
export const mandatesApi = {
  list: () => api<Mandate[]>('GET', '/v1/mandates'),
  get: (id: string) => api<Mandate>('GET', '/v1/mandates/' + id),
  create: (input: MandateInput, proof: string) => api<Mandate>('POST', '/v1/mandates', { ...input, assurance: { method: 'pin', proof } }),
  patch: (id: string, op: 'edit' | 'pause' | 'resume' | 'revoke', changes?: Partial<MandateInput>, proof?: string) => api<Mandate>('PATCH', '/v1/mandates/' + id, { op, changes, assurance: proof ? { method: 'pin', proof } : undefined }),
  executions: (id: string) => api<MandateExecution[]>('GET', '/v1/mandates/' + id + '/executions'),
  execution: (executionId: string) => api<MandateExecution>('GET', '/v1/mandates/executions/' + executionId),
};
