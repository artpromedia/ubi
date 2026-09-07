/**
 * `postEntry` — the single write path into the journal.
 *
 * Nothing else in the service inserts a `journal_entries` or `journal_lines`
 * row. The function checks the double-entry invariant before it writes so a
 * caller gets a precise `unbalanced_journal` error instead of an opaque
 * constraint violation at COMMIT — but the *guarantee* is the database's: a
 * deferred CONSTRAINT TRIGGER re-checks every entry at COMMIT, so an unbalanced
 * entry cannot be committed even if this check were removed or bypassed.
 */
import { ContractError, money, sumMoney } from "@ubi/contracts";

import { isWalletBearing } from "./accounts";
import { toDbMinor } from "./minor-units";
import { generateId } from "../lib/utils";

import type {
  JournalLineInput,
  LedgerTx,
  PostedEntry,
  PostedLine,
  PostEntryInput,
} from "./types";

function assertBalanced(lines: readonly JournalLineInput[]): void {
  if (lines.length < 2) {
    throw new ContractError(
      "unbalanced_journal",
      "a journal entry needs at least two lines",
      { lineCount: lines.length },
    );
  }

  const byCurrency = new Map<string, JournalLineInput[]>();
  for (const line of lines) {
    const bucket = byCurrency.get(line.amount.currency);
    if (bucket === undefined) {
      byCurrency.set(line.amount.currency, [line]);
    } else {
      bucket.push(line);
    }
  }

  const unbalanced: Record<string, number> = {};
  for (const [currency, bucket] of byCurrency) {
    const total = sumMoney(
      bucket.map((line) => line.amount),
      currency,
    );
    if (total.amountMinor !== 0) {
      unbalanced[currency] = total.amountMinor;
    }
  }

  if (Object.keys(unbalanced).length > 0) {
    throw new ContractError(
      "unbalanced_journal",
      "journal entry lines must sum to zero per currency",
      { totals: unbalanced },
    );
  }
}

function assertAccountShape(lines: readonly JournalLineInput[]): void {
  for (const line of lines) {
    const hasWallet = line.walletId !== undefined && line.walletId !== null;
    if (isWalletBearing(line.account) && !hasWallet) {
      throw new ContractError(
        "validation_failed",
        `account "${line.account}" must name the wallet whose balance it moves`,
        { account: line.account },
      );
    }
    if (!isWalletBearing(line.account) && hasWallet) {
      throw new ContractError(
        "validation_failed",
        `account "${line.account}" is not a wallet account and must not carry a walletId`,
        { account: line.account },
      );
    }
    if (line.counterpartRef.length === 0) {
      throw new ContractError(
        "validation_failed",
        "every journal line needs a counterpartRef",
        { account: line.account },
      );
    }
  }
}

export async function postEntry(
  tx: LedgerTx,
  input: PostEntryInput,
): Promise<PostedEntry> {
  assertBalanced(input.lines);
  assertAccountShape(input.lines);

  if (input.kind === "recon_adjustment" && !input.caseRef) {
    throw new ContractError(
      "validation_failed",
      "a reconciliation adjustment must reference the case or bug that explains it",
    );
  }

  const entryId = generateId("je");

  await tx.journalEntry.create({
    data: {
      id: entryId,
      kind: input.kind,
      reference: input.reference,
      description: input.description ?? null,
      occurredAt: input.occurredAt,
      idempotencyKey: input.idempotencyKey ?? null,
      caseRef: input.caseRef ?? null,
    },
  });

  const posted: PostedLine[] = input.lines.map((line) => ({
    id: generateId("jl"),
    account: line.account,
    walletId: line.walletId ?? null,
    amountMinor: line.amount.amountMinor,
    currency: line.amount.currency,
    counterpartRef: line.counterpartRef,
  }));

  await tx.journalLine.createMany({
    data: posted.map((line) => ({
      id: line.id,
      entryId,
      account: line.account,
      walletId: line.walletId,
      amountMinor: toDbMinor(line.amountMinor),
      currency: line.currency,
      counterpartRef: line.counterpartRef,
    })),
  });

  return {
    id: entryId,
    kind: input.kind,
    reference: input.reference,
    occurredAt: input.occurredAt,
    caseRef: input.caseRef ?? null,
    lines: posted,
  };
}

/** Convenience for the common two-line move between two accounts. */
export function movement(
  from: Omit<JournalLineInput, "amount">,
  to: Omit<JournalLineInput, "amount">,
  amountMinor: number,
  currency: string,
): readonly JournalLineInput[] {
  return [
    { ...from, amount: money(-amountMinor, currency) },
    { ...to, amount: money(amountMinor, currency) },
  ];
}
