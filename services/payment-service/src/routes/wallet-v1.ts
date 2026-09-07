/**
 * `/v1/wallet` — the canonical wallet API (slice 04, contracts/openapi/wallet-p2p.yaml).
 *
 * This module mounts the double-entry ledger in `src/ledger`. It sits beside
 * the older `/wallets` routes while those are retired; the two share no state.
 *
 * Everything that matters is decided by the server: the actor comes from the
 * gateway's authenticated headers, the currency and every limit come from city
 * config, and the body only ever supplies an amount and an intent.
 */
import { Hono, type Context } from "hono";
import { z } from "zod";

import { ContractError, IDEMPOTENCY_HEADER, IdempotencyKeySchema } from "@ubi/contracts";

import {
  applyNipCallback,
  buildStatement,
  createNipTransfer,
  createRequest,
  createTopup,
  disputeTransfer,
  nameEnquiry,
  openReturnRequest,
  payRequest,
  resetPin,
  respondToReturnRequest,
  sendTransfer,
  setInitialPin,
  listRequests,
  setWalletLock,
  verifyWebhookSignature,
  walletOverview,
  type WalletDeps,
} from "../ledger";
import { walletLogger } from "../lib/logger";
import { serviceAuth } from "../middleware";

import type { Actor } from "../ledger/types";

const AmountSchema = z.number().int().positive();

const TransferBody = z.object({
  toUserId: z.string().min(1),
  amountMinor: AmountSchema,
  note: z.string().max(140).optional(),
  pin: z.string().min(4).max(6),
  topup: z
    .object({ methodId: z.string().min(1), amountMinor: AmountSchema })
    .optional(),
});

const RequestBody = z.object({
  fromUserId: z.string().min(1),
  amountMinor: AmountSchema,
  rideId: z.string().min(1).optional(),
});

const PayRequestBody = z.object({ pin: z.string().min(4).max(6) });

const NipBody = z.object({
  bankCode: z.string().min(3).max(10),
  accountNumber: z.string().regex(/^\d{10}$/, "account number must be 10 digits"),
  amountMinor: AmountSchema,
  pin: z.string().min(4).max(6),
});

const TopupBody = z.object({
  methodId: z.string().min(1),
  amountMinor: AmountSchema,
});

const ReturnBody = z.object({ reason: z.string().max(280).optional() });

const RespondBody = z.object({
  consent: z.boolean(),
  reason: z.string().max(280).optional(),
});

const DisputeBody = z.object({
  transferId: z.string().min(1),
  reason: z.string().min(1).max(280),
});

const PinResetBody = z.object({
  newPin: z.string().min(4).max(6),
  stepUpChallengeId: z.string().min(1),
});

const PinEnrolBody = z.object({ pin: z.string().min(4).max(6) });

const LockBody = z.object({
  locked: z.boolean(),
  /** Ops only; a rider's own request may not name anyone else. */
  userId: z.string().min(1).optional(),
  reason: z.string().max(280).optional(),
});

const NipCallbackBody = z.object({
  sessionId: z.string().min(1),
  status: z.enum(["confirmed", "reversed"]),
  reference: z.string().min(1),
  reason: z.string().max(280).optional(),
});

const StatementQuery = z.object({
  from: z.string(),
  to: z.string(),
  format: z.string().default("json"),
});

function actorOf(c: Context): Actor {
  const id = c.get("userId");
  if (typeof id !== "string" || id.length === 0) {
    throw new ContractError("unauthorized", "authentication required");
  }
  return { id, role: c.req.header("X-User-Role") ?? "rider" };
}

/**
 * The city the request belongs to. It arrives as a gateway header but is only
 * ever trusted after the config provider has proved the city exists and is
 * live — an unknown city is refused, not defaulted.
 */
function cityOf(c: Context): string {
  const cityId = c.req.header("X-City-ID");
  if (cityId === undefined || cityId.length === 0) {
    throw new ContractError(
      "city_unsupported",
      "the request does not say which city it belongs to",
    );
  }
  return cityId;
}

function idempotencyKeyOf(c: Context): string {
  const raw = c.req.header(IDEMPOTENCY_HEADER);
  const parsed = IdempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ContractError(
      "validation_failed",
      `a valid ${IDEMPOTENCY_HEADER} header is required for this operation`,
    );
  }
  return parsed.data;
}

async function parse<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ContractError("validation_failed", "the request body is not valid", {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

function fail(c: Context, error: unknown): Response {
  if (error instanceof ContractError) {
    // A risk hold is an outcome, not a failure: 202 with the held transfer.
    return c.json(error.toBody(), error.status as 200);
  }
  walletLogger.error({ err: error }, "unhandled wallet error");
  return c.json(
    { code: "internal_error", message: "something went wrong handling that request" },
    500,
  );
}

export function createWalletV1Routes(deps: WalletDeps): Hono {
  const routes = new Hono();

  // The bank callback authenticates with a signature, not a user session, so it
  // is registered before the session guard.
  routes.post("/nip/callbacks", async (c) => {
    try {
      const raw = await c.req.text();
      verifyWebhookSignature(raw, c.req.header("X-Bank-Signature"));
      const parsed = NipCallbackBody.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        throw new ContractError("validation_failed", "the callback body is not valid");
      }
      const cityId = cityOf(c);
      const result = await applyNipCallback(deps, cityId, parsed.data);
      return c.json(result, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.use("*", serviceAuth);

  routes.get("/", async (c) => {
    try {
      return c.json(await walletOverview(deps, actorOf(c), cityOf(c)), 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/recipients/lookup", async (c) => {
    try {
      const query = c.req.query("q");
      if (query === undefined || query.length === 0) {
        throw new ContractError("validation_failed", "say who you are looking for");
      }
      // Only the display name crosses this boundary — never the phone number
      // that was searched for, and never anything else about the account.
      const match = await deps.directory.lookup(query);
      return c.json({ userId: match.userId, displayName: match.displayName }, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/transfers", async (c) => {
    try {
      const body = await parse(c, TransferBody);
      const result = await sendTransfer(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        toUserId: body.toUserId,
        amountMinor: body.amountMinor,
        note: body.note,
        pin: body.pin,
        topup: body.topup,
        idempotencyKey: idempotencyKeyOf(c),
      });
      return c.json(result, result.status === "held_risk" ? 202 : 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/transfers/:id/return-request", async (c) => {
    try {
      const body = await parse(c, ReturnBody);
      const result = await openReturnRequest(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        transferId: c.req.param("id"),
        reason: body.reason,
      });
      return c.json(result, 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/transfers/:id/return-request/:returnId/respond", async (c) => {
    try {
      const body = await parse(c, RespondBody);
      const result = await respondToReturnRequest(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        transferId: c.req.param("id"),
        returnRequestId: c.req.param("returnId"),
        consent: body.consent,
        reason: body.reason,
      });
      return c.json(result, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/disputes", async (c) => {
    try {
      const body = await parse(c, DisputeBody);
      const result = await disputeTransfer(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        transferId: body.transferId,
        reason: body.reason,
      });
      return c.json(result, 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/requests", async (c) => {
    try {
      return c.json(await listRequests(deps.db, actorOf(c).id), 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/requests", async (c) => {
    try {
      const body = await parse(c, RequestBody);
      const result = await createRequest(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        fromUserId: body.fromUserId,
        amountMinor: body.amountMinor,
        rideId: body.rideId,
        idempotencyKey: idempotencyKeyOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/requests/:id/pay", async (c) => {
    try {
      const body = await parse(c, PayRequestBody);
      const result = await payRequest(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        requestId: c.req.param("id"),
        pin: body.pin,
        idempotencyKey: idempotencyKeyOf(c),
      });
      return c.json(result, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/nip/name-enquiry", async (c) => {
    try {
      const bankCode = c.req.query("bankCode");
      const accountNumber = c.req.query("accountNumber");
      if (bankCode === undefined || accountNumber === undefined) {
        throw new ContractError(
          "validation_failed",
          "a bank code and account number are both needed",
        );
      }
      return c.json(await nameEnquiry(deps, cityOf(c), bankCode, accountNumber), 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/nip", async (c) => {
    try {
      const body = await parse(c, NipBody);
      const result = await createNipTransfer(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        bankCode: body.bankCode,
        accountNumber: body.accountNumber,
        amountMinor: body.amountMinor,
        pin: body.pin,
        idempotencyKey: idempotencyKeyOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/topups", async (c) => {
    try {
      const body = await parse(c, TopupBody);
      const result = await createTopup(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        methodId: body.methodId,
        amountMinor: body.amountMinor,
        idempotencyKey: idempotencyKeyOf(c),
      });
      return c.json(result, 201);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/pin", async (c) => {
    try {
      const body = await parse(c, PinEnrolBody);
      return c.json(
        await setInitialPin(deps, actorOf(c), cityOf(c), body.pin),
        201,
      );
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/pin/reset", async (c) => {
    try {
      const body = await parse(c, PinResetBody);
      const result = await resetPin(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        newPin: body.newPin,
        stepUpChallengeId: body.stepUpChallengeId,
      });
      return c.json(result, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.post("/lock", async (c) => {
    try {
      const body = await parse(c, LockBody);
      const result = await setWalletLock(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        locked: body.locked,
        ownerId: body.userId,
        reason: body.reason,
      });
      return c.json(result, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  routes.get("/statements", async (c) => {
    try {
      const query = StatementQuery.safeParse({
        from: c.req.query("from"),
        to: c.req.query("to"),
        format: c.req.query("format") ?? "json",
      });
      if (!query.success) {
        throw new ContractError("validation_failed", "from and to are both required");
      }
      const statement = await buildStatement(deps, {
        actor: actorOf(c),
        cityId: cityOf(c),
        from: query.data.from,
        to: query.data.to,
        format: query.data.format,
      });
      return c.json(statement, 200);
    } catch (error) {
      return fail(c, error);
    }
  });

  return routes;
}
