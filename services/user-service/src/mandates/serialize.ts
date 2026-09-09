/**
 * Mapping mandate rows to the wire shape in contracts/openapi/mandates.yaml.
 *
 * BigInt money columns become integer minor units + currency; usage for the
 * current period comes from the mandate_allowances row (zero when none exists
 * yet); `lastRunAt` is derived from the executions rather than stored.
 */
import type {
  ActionGrant,
  Mandate,
  MandateAllowance,
  MandateExecution,
} from "@prisma/client";

function money(
  amountMinor: bigint,
  currency: string,
): { amountMinor: number; currency: string } {
  return { amountMinor: Number(amountMinor), currency };
}

/** YYYY-MM-DD for a date-only column, in UTC. */
export function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export interface MandateView {
  id: string;
  action: string;
  title: string;
  passengers: string;
  categories: string[];
  providers: string[];
  perRunCap: { amountMinor: number; currency: string };
  periodCap: {
    amount: { amountMinor: number; currency: string };
    runs: number;
    period: "month";
  };
  maxPriceVariance: { amountMinor: number; currency: string } | null;
  expiresAt: string;
  constraints: unknown;
  status: string;
  usage: {
    amountUsed: { amountMinor: number; currency: string };
    runsUsed: number;
    periodStart: string | null;
  };
  lastRunAt: string | null;
}

export function mandateToView(
  mandate: Mandate,
  allowance: MandateAllowance | null,
  lastRunAt: Date | null,
): MandateView {
  return {
    id: mandate.id,
    action: mandate.action,
    title: mandate.title,
    passengers: mandate.passengers,
    categories: mandate.categories,
    providers: mandate.providers,
    perRunCap: money(mandate.perRunCapMinor, mandate.currency),
    periodCap: {
      amount: money(mandate.periodCapMinor, mandate.currency),
      runs: mandate.periodRuns,
      period: "month",
    },
    maxPriceVariance:
      mandate.maxPriceVarianceMinor === null
        ? null
        : money(mandate.maxPriceVarianceMinor, mandate.currency),
    expiresAt: mandate.expiresAt.toISOString(),
    constraints: mandate.constraints,
    status: mandate.status,
    usage: {
      amountUsed: money(
        allowance?.amountUsedMinor ?? 0n,
        mandate.currency,
      ),
      runsUsed: allowance?.runsUsed ?? 0,
      periodStart: allowance === null ? null : isoDate(allowance.periodStart),
    },
    lastRunAt: lastRunAt === null ? null : lastRunAt.toISOString(),
  };
}

export interface ExecutionView {
  id: string;
  mandateId: string;
  at: string;
  outcome: string;
  reasonCode: string | null;
  grantId: string | null;
  receiptRef: string | null;
  resultRef: string | null;
  amount: { amountMinor: number; currency: string } | null;
  summary: string | null;
}

export function executionToView(exec: MandateExecution): ExecutionView {
  return {
    id: exec.id,
    mandateId: exec.mandateId,
    at: exec.at.toISOString(),
    outcome: exec.outcome,
    reasonCode: exec.reasonCode,
    grantId: exec.grantId,
    receiptRef: exec.receiptRef,
    resultRef: exec.resultRef,
    amount:
      exec.amountMinor === null || exec.currency === null
        ? null
        : money(exec.amountMinor, exec.currency),
    summary: exec.summary,
  };
}

export interface RunResultView {
  outcome: "executed" | "blocked";
  execution: ExecutionView;
  reasonCode: string | null;
  grant: {
    id: string;
    total: { amountMinor: number; currency: string };
    expiresAt: string;
  } | null;
  replayed: boolean;
}

export function runResultView(
  exec: MandateExecution,
  grant: ActionGrant | null,
  replayed: boolean,
): RunResultView {
  return {
    outcome: exec.outcome as "executed" | "blocked",
    execution: executionToView(exec),
    reasonCode: exec.reasonCode,
    grant:
      grant === null
        ? null
        : {
            id: grant.id,
            total: money(grant.totalMinor, grant.currency),
            expiresAt: grant.expiresAt.toISOString(),
          },
    replayed,
  };
}
