/**
 * Audited operations driver wallet credits API client & pure policy helpers
 * (CC-B03, DEC-6 = C).
 *
 * Calls cross `/api/gateway` -> `api-gateway` -> `payment-service`
 * (`/v1/ops/wallet-credits*`, gated by `finance:ops`). Every mutating POST
 * attaches an `Idempotency-Key` header.
 */
import { apiClient, newIdempotencyKey } from "./api-client";

import type { Money } from "./growth-api";
import type { PublicAdminSession } from "./session";

export const OPS_CREDIT_STATUSES = [
  "pending_approval",
  "approved",
  "rejected",
  "reversed",
] as const;

export type OpsCreditStatus = (typeof OPS_CREDIT_STATUSES)[number];

export const OPS_CREDIT_OPERATOR_ROLES = [
  "finance_ops",
  "ops_admin",
  "admin",
  "super_admin",
] as const;

const OPS_CREDIT_ROLE_SET: ReadonlySet<string> = new Set(
  OPS_CREDIT_OPERATOR_ROLES,
);

export function canManageOpsCredits(role: string | null | undefined): boolean {
  if (typeof role !== "string" || role.trim().length === 0) {
    return false;
  }
  return OPS_CREDIT_ROLE_SET.has(role.trim().toLowerCase());
}

export interface OpsCreditPolicyView {
  maxPerCreditMinor: number;
  maxDriverDailyMinor: number;
  maxCityDailyMinor: number;
  reasonCodes: string[];
}

export interface CityOpsCreditConfigView {
  cityId: string;
  version: number;
  currency: string;
  currencyFractionDigits: number;
  opsCreditPolicy?: OpsCreditPolicyView;
}

export interface OpsCreditView {
  id: string;
  cityId: string;
  driverUserId: string;
  walletId: string;
  amount: Money;
  reasonCode: string;
  note: string | null;
  reference: string | null;
  status: OpsCreditStatus;
  createdBy: string;
  createdByRole: string;
  approvedBy: string | null;
  approvedByRole: string | null;
  approvalNote: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedByRole: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  reversedBy: string | null;
  reversedByRole: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  entryId: string | null;
  reversalEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpsCreditMutationResult {
  credit: OpsCreditView;
  balanceAfter: Money;
  replayed: boolean;
}

export interface CreateOpsCreditInput {
  cityId: string;
  driverUserId: string;
  amountMinor: number;
  reasonCode: string;
  note?: string;
  reference?: string;
}

/**
 * Packages integer major-unit digits typed by an operator into integer minor
 * units using the city's server-supplied `currencyFractionDigits`. Performs
 * input packaging only — never fee, cap, or balance arithmetic.
 */
export function majorUnitsToMinor(
  rawMajorDigits: string,
  currencyFractionDigits: number,
): number | null {
  const digits = rawMajorDigits.replace(/\D/g, "");
  if (digits.length === 0) {
    return null;
  }
  const major = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(major) || major <= 0) {
    return null;
  }
  const scale = 10 ** Math.max(0, Math.min(4, currencyFractionDigits));
  const minor = major * scale;
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

export interface ApprovalEligibility {
  readonly allowed: boolean;
  readonly selfAuthor: boolean;
  readonly reason: string | null;
}

/**
 * Evaluates whether the signed-in operator can approve a pending credit in the
 * UI. `payment-service` and the Postgres `CHECK (approved_by <> created_by)`
 * constraint enforce the exact same two-person rule server-side.
 */
export function evaluateApproveEligibility(
  credit: Pick<OpsCreditView, "status" | "createdBy">,
  session: PublicAdminSession | null | undefined,
  flagEnabled: boolean,
): ApprovalEligibility {
  if (!session) {
    return {
      allowed: false,
      selfAuthor: false,
      reason: "Sign in with an operations finance account to approve credits.",
    };
  }
  if (session.mode === "limited") {
    return {
      allowed: false,
      selfAuthor: false,
      reason:
        "Complete device step-up verification before approving money movement.",
    };
  }
  if (!canManageOpsCredits(session.user.role)) {
    return {
      allowed: false,
      selfAuthor: false,
      reason: "Your role does not hold finance:ops permission.",
    };
  }
  if (!flagEnabled) {
    return {
      allowed: false,
      selfAuthor: false,
      reason: "Flag ops_driver_wallet_credit is disabled for this city.",
    };
  }
  if (credit.status !== "pending_approval") {
    return {
      allowed: false,
      selfAuthor: false,
      reason: "Only pending_approval credits can be approved.",
    };
  }
  if (credit.createdBy === session.user.id) {
    return {
      allowed: false,
      selfAuthor: true,
      reason:
        "Two-person rule: you requested this credit, so a second operator must approve it.",
    };
  }
  return { allowed: true, selfAuthor: false, reason: null };
}

export const opsCreditsApi = {
  cityConfig: (cityId: string): Promise<CityOpsCreditConfigView> =>
    apiClient.get<CityOpsCreditConfigView>(
      `/v1/config/cities/${encodeURIComponent(cityId)}`,
    ),

  cityFlags: async (cityId: string): Promise<Record<string, boolean>> => {
    const raw = await apiClient.get<
      Record<string, boolean> | { flags?: Record<string, boolean> }
    >(`/v1/config/flags?cityId=${encodeURIComponent(cityId)}`);
    if (
      raw !== null &&
      typeof raw === "object" &&
      "flags" in raw &&
      raw.flags !== undefined &&
      typeof raw.flags === "object"
    ) {
      return raw.flags;
    }
    return raw as Record<string, boolean>;
  },

  list: async (params: {
    cityId?: string;
    status?: OpsCreditStatus;
    driverUserId?: string;
    limit?: number;
  }): Promise<OpsCreditView[]> => {
    const search = new URLSearchParams();
    if (params.cityId) {
      search.set("cityId", params.cityId);
    }
    if (params.status) {
      search.set("status", params.status);
    }
    if (params.driverUserId) {
      search.set("driverUserId", params.driverUserId);
    }
    if (params.limit !== undefined) {
      search.set("limit", String(params.limit));
    }
    const qs = search.toString();
    const res = await apiClient.get<{ credits: OpsCreditView[] }>(
      `/v1/ops/wallet-credits${qs ? `?${qs}` : ""}`,
    );
    return res.credits;
  },

  get: async (creditId: string): Promise<OpsCreditView> => {
    const res = await apiClient.get<{ credit: OpsCreditView }>(
      `/v1/ops/wallet-credits/${encodeURIComponent(creditId)}`,
    );
    return res.credit;
  },

  create: (
    body: CreateOpsCreditInput,
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<OpsCreditMutationResult> =>
    apiClient.post<OpsCreditMutationResult>("/v1/ops/wallet-credits", body, {
      idempotencyKey,
    }),

  approve: (
    creditId: string,
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<OpsCreditMutationResult> =>
    apiClient.post<OpsCreditMutationResult>(
      `/v1/ops/wallet-credits/${encodeURIComponent(creditId)}/approve`,
      {},
      { idempotencyKey },
    ),

  reject: (
    creditId: string,
    reason: string,
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<{ credit: OpsCreditView; replayed: boolean }> =>
    apiClient.post<{ credit: OpsCreditView; replayed: boolean }>(
      `/v1/ops/wallet-credits/${encodeURIComponent(creditId)}/reject`,
      { reason },
      { idempotencyKey },
    ),

  reverse: (
    creditId: string,
    reason: string,
    idempotencyKey: string = newIdempotencyKey(),
  ): Promise<OpsCreditMutationResult> =>
    apiClient.post<OpsCreditMutationResult>(
      `/v1/ops/wallet-credits/${encodeURIComponent(creditId)}/reverse`,
      { reason },
      { idempotencyKey },
    ),
};
