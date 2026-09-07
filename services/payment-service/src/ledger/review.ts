/**
 * A held transfer becomes a queue item a human works, not a silently dropped
 * request. It is written as a support case with an SLA, in the same
 * transaction that records the hold, so the queue can never disagree with the
 * transfer's state.
 */
import { initialState } from "@ubi/contracts";

import { generateId } from "../lib/utils";

import type { Actor, LedgerTx } from "./types";

export interface RiskReviewInput {
  readonly actor: Actor;
  readonly userId: string;
  readonly transferId: string;
  readonly reason: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly slaMinutes: number;
  readonly now: Date;
}

export interface RiskReviewCase {
  readonly caseId: string;
  readonly slaDue: Date;
}

export async function openRiskReviewCase(
  tx: LedgerTx,
  input: RiskReviewInput,
): Promise<RiskReviewCase> {
  const caseId = generateId("case");
  const slaDue = new Date(input.now.getTime() + input.slaMinutes * 60_000);

  await tx.supportCase.create({
    data: {
      id: caseId,
      userType: "rider",
      userId: input.userId,
      subjectType: "transfer",
      subjectId: input.transferId,
      category: "wallet_risk_hold",
      status: initialState("supportCase"),
      slaDue,
    },
  });

  await tx.caseEvent.create({
    data: {
      id: generateId("cev"),
      caseId,
      kind: "wallet.transfer_held",
      // Ids and amounts only — no name, phone or note (CLAUDE.md #12).
      payload: {
        transferId: input.transferId,
        reason: input.reason,
        amountMinor: input.amountMinor,
        currency: input.currency,
      },
      actor: input.actor.id,
    },
  });

  return { caseId, slaDue };
}
