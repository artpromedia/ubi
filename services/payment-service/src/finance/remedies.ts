/**
 * `POST /v1/finance/remedies` — the ledger side of a support remedy (slice 11).
 *
 * support-service decides *whether* a case deserves a remedy and of what typed
 * kind. It never decides which accounts move: that belongs here, with the chart
 * of accounts and the double-entry invariant.
 *
 * The rule this endpoint exists to keep is that a remedy NEVER edits a fare and
 * never touches a historical entry. It posts a NEW entry of counter-lines that
 * references the case, so the original ride, order or transfer stays exactly as
 * it was posted and the correction is visible beside it.
 */
import { ContractError, IDEMPOTENCY_HEADER, money } from "@ubi/contracts";
import { Hono } from "hono";
import { z } from "zod";

import { postEntry } from "../ledger/post-entry";
import { ensureWallet, type WalletOwnerType } from "../ledger/wallets";
import { logger } from "../lib/logger";
import { internalServiceAuth } from "../middleware";

import type { WalletDeps } from "../ledger/context";
import type { LedgerAccount } from "../ledger/accounts";
import type { Context } from "hono";

/**
 * The typed remedies, and the account each one draws from.
 *
 * Every remedy credits the beneficiary's wallet. What differs is where the
 * money comes from, and that distinction is what makes the ledger answerable
 * afterwards — "how much did we give away in goodwill this month" is a query
 * over `ubi_float`, not a guess.
 */
const REMEDY_SOURCE: Readonly<Record<string, LedgerAccount>> = {
  /** A fee we should not have charged: reverse our own revenue. */
  fee_reversal: "ubi_commission",
  /** Money the customer paid and is getting back: drawn against the reserve. */
  refund: "refund_reserve",
  /** Goodwill we chose to give: UBI's own float, never a customer's money. */
  credit: "ubi_float",
  /** Re-running a delivery at our cost. */
  redelivery: "ubi_float",
  /** A disputed cash collection: settles against what the driver owes. */
  cash_dispute_resolution: "cash_owed",
};

const OWNER_TYPES: readonly WalletOwnerType[] = ["user", "driver", "merchant", "fleet"];

const RemedyBody = z.object({
  caseId: z.string().min(1).max(120),
  remedyId: z.string().min(1).max(120),
  type: z.enum([
    "fee_reversal",
    "refund",
    "credit",
    "redelivery",
    "cash_dispute_resolution",
  ]),
  amountMinor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  cityId: z.string().min(1),
  beneficiary: z.object({
    userType: z.string().min(1),
    userId: z.string().min(1),
  }),
  subject: z
    .object({ type: z.string().min(1), id: z.string().min(1) })
    .nullable()
    .optional(),
  reason: z.string().min(1).max(500),
});

export function createRemedyRoutes(deps: WalletDeps): Hono {
  const app = new Hono();

  // Only another UBI service may post a remedy; it is never a customer action,
  // so this uses the internal service key rather than a forwarded user context.
  app.use("*", internalServiceAuth);

  // Map ContractError to its canonical status here rather than relying on the
  // parent app's handler, so the module answers the same way whether it is
  // mounted in the service or exercised on its own.
  app.onError((error, ctx) => {
    if (error instanceof ContractError) {
      return ctx.json(error.toBody(), error.status as 400);
    }
    if (error instanceof z.ZodError) {
      return ctx.json(
        { code: "validation_failed", message: "invalid remedy", details: { issues: error.issues } },
        422,
      );
    }
    logger.error({ err: error }, "remedy failed");
    return ctx.json({ code: "internal_error", message: "remedy could not be posted" }, 500);
  });

  app.post("/", async (c: Context) => {
    const idempotencyKey = c.req.header(IDEMPOTENCY_HEADER);
    if (idempotencyKey === undefined || idempotencyKey.length === 0) {
      throw new ContractError(
        "validation_failed",
        "a remedy must carry an Idempotency-Key so a retry cannot pay twice",
      );
    }

    const body = RemedyBody.parse(await c.req.json());

    const ownerType = body.beneficiary.userType as WalletOwnerType;
    if (!OWNER_TYPES.includes(ownerType)) {
      throw new ContractError("validation_failed", "unknown beneficiary type", {
        userType: body.beneficiary.userType,
      });
    }

    const { city: config } = await deps.config.load(body.cityId);
    if (config.currency !== body.currency) {
      throw new ContractError(
        "validation_failed",
        "a remedy must be denominated in the city's own currency",
        { cityCurrency: config.currency, requested: body.currency },
      );
    }

    const source = REMEDY_SOURCE[body.type];
    if (source === undefined) {
      // Unreachable through the schema; kept so adding a remedy type without
      // choosing its account fails loudly rather than defaulting to float.
      throw new ContractError("validation_failed", "that remedy has no ledger account", {
        type: body.type,
      });
    }

    // Replay returns the entry the first attempt posted, never a second one.
    const existing = await deps.db.journalEntry.findUnique({
      where: { idempotencyKey },
      include: { lines: true },
    });
    if (existing !== null) {
      return c.json(viewOf(existing, true));
    }

    const amount = money(body.amountMinor, config.currency);

    try {
      const posted = await deps.db.$transaction(async (tx) => {
        const wallet = await ensureWallet(tx, ownerType, body.beneficiary.userId, config);
        const counterpartRef = `case:${body.caseId}`;

        return postEntry(tx, {
          kind: "remedy",
          reference: `remedy:${body.remedyId}`,
          description: body.reason,
          occurredAt: deps.now(),
          idempotencyKey,
          caseRef: body.caseId,
          lines: [
            {
              account: "wallet",
              walletId: wallet.id,
              amount,
              counterpartRef,
            },
            {
              account: source,
              walletId: null,
              amount: money(-body.amountMinor, config.currency),
              counterpartRef,
            },
          ],
        });
      });

      logger.info(
        { caseId: body.caseId, remedyId: body.remedyId, type: body.type, entryId: posted.id },
        "remedy posted",
      );
      return c.json(viewOf(posted, false), 201);
    } catch (error) {
      // Two concurrent attempts with the same key: the unique index decides and
      // the loser reads back the winner's entry.
      const replay = await deps.db.journalEntry.findUnique({
        where: { idempotencyKey },
        include: { lines: true },
      });
      if (replay !== null) {
        return c.json(viewOf(replay, true));
      }
      throw error;
    }
  });

  return app;
}

interface EntryShape {
  readonly id: string;
  readonly caseRef: string | null;
  readonly lines: ReadonlyArray<{
    readonly account: string;
    readonly amountMinor: bigint | number;
    readonly currency: string;
    readonly counterpartRef: string | null;
  }>;
}

function viewOf(entry: EntryShape, replayed: boolean) {
  return {
    entryId: entry.id,
    caseRef: entry.caseRef,
    lines: entry.lines.map((line) => ({
      account: line.account,
      amountMinor: Number(line.amountMinor),
      currency: line.currency,
      counterpartRef: line.counterpartRef,
    })),
    replayed,
  };
}
