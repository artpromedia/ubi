/**
 * Webhook Routes
 *
 * Handle callbacks from payment providers
 */

import { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { generateId } from "../lib/utils";
import { PaymentStatus, TransactionStatus, TransactionType } from "../types";

const webhookRoutes = new Hono();

// ============================================
// Webhook Signature Verification
// ============================================

function verifyPaystackSignature(body: string, signature: string): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return false;

  const hash = createHmac("sha512", secret).update(body).digest("hex");

  return hash === signature;
}

function verifyFlutterwaveSignature(_body: string, signature: string): boolean {
  // NOTE: Flutterwave uses a secret hash comparison, not body-based signing
  const secret = process.env.FLUTTERWAVE_SECRET_HASH;
  if (!secret) return false;

  return signature === secret;
}

function verifyStripeSignature(body: string, signature: string): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return false;

  // Stripe uses a more complex signature verification
  // This is simplified - in production use Stripe SDK
  const elements = signature.split(",");
  const timestamp = elements.find((e) => e.startsWith("t="))?.slice(2);
  const hash = elements.find((e) => e.startsWith("v1="))?.slice(3);

  if (!timestamp || !hash) return false;

  const payload = `${timestamp}.${body}`;
  const expectedHash = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return hash === expectedHash;
}

// ============================================
// Webhook Event Handlers
// ============================================

interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  timestamp: Date;
  provider: string;
}

async function processWebhookEvent(event: WebhookEvent): Promise<void> {
  // Store event for auditing
  await redis.lpush("webhook:events", JSON.stringify(event));
  await redis.ltrim("webhook:events", 0, 9999); // Keep last 10k events

  // Process based on event type
  switch (event.provider) {
    case "paystack":
      await processPaystackEvent(event);
      break;
    case "flutterwave":
      await processFlutterwaveEvent(event);
      break;
    case "stripe":
      await processStripeEvent(event);
      break;
  }
}

async function processPaystackEvent(event: WebhookEvent): Promise<void> {
  const { data } = event;

  switch (event.type) {
    case "charge.success": {
      const payment = await prisma.payment.findFirst({
        where: { providerReference: data.reference },
      });

      if (payment && payment.status !== PaymentStatus.COMPLETED) {
        await handleSuccessfulPayment(payment.id, data);
      }
      break;
    }

    case "charge.failed": {
      const payment = await prisma.payment.findFirst({
        where: { providerReference: data.reference },
      });

      if (payment && payment.status === PaymentStatus.PROCESSING) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failureReason: data.gateway_response || "Payment failed",
          },
        });
      }
      break;
    }

    case "transfer.success": {
      // Payout completed
      const payout = await prisma.payout.findFirst({
        where: { providerReference: data.reference },
      });

      if (payout) {
        await prisma.payout.update({
          where: { id: payout.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });
      }
      break;
    }

    case "transfer.failed": {
      const payout = await prisma.payout.findFirst({
        where: { providerReference: data.reference },
      });

      if (payout) {
        // Release locked funds
        await prisma.$transaction([
          prisma.wallet.update({
            where: { id: payout.walletId },
            data: { lockedBalance: { decrement: payout.amount } },
          }),
          prisma.payout.update({
            where: { id: payout.id },
            data: {
              status: "FAILED",
              failureReason: data.reason || "Transfer failed",
            },
          }),
        ]);
      }
      break;
    }

    case "refund.processed": {
      const payment = await prisma.payment.findFirst({
        where: { providerReference: data.reference },
      });

      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.REFUNDED,
            refundedAmount: data.amount / 100, // Paystack uses kobo
          },
        });
      }
      break;
    }
  }
}

async function processFlutterwaveEvent(event: WebhookEvent): Promise<void> {
  const { data } = event;

  switch (event.type) {
    case "charge.completed": {
      if (data.status === "successful") {
        const payment = await prisma.payment.findFirst({
          where: { providerReference: data.tx_ref },
        });

        if (payment && payment.status !== PaymentStatus.COMPLETED) {
          await handleSuccessfulPayment(payment.id, data);
        }
      }
      break;
    }

    case "transfer.completed": {
      const payout = await prisma.payout.findFirst({
        where: { providerReference: data.reference },
      });

      if (payout) {
        const success = data.status === "SUCCESSFUL";

        if (success) {
          await prisma.payout.update({
            where: { id: payout.id },
            data: {
              status: "COMPLETED",
              completedAt: new Date(),
            },
          });
        } else {
          // Release locked funds
          await prisma.$transaction([
            prisma.wallet.update({
              where: { id: payout.walletId },
              data: { lockedBalance: { decrement: payout.amount } },
            }),
            prisma.payout.update({
              where: { id: payout.id },
              data: {
                status: "FAILED",
                failureReason: data.complete_message || "Transfer failed",
              },
            }),
          ]);
        }
      }
      break;
    }
  }
}

async function processStripeEvent(event: WebhookEvent): Promise<void> {
  const { data } = event;

  switch (event.type) {
    case "payment_intent.succeeded": {
      const payment = await prisma.payment.findFirst({
        where: { providerReference: data.object.id },
      });

      if (payment && payment.status !== PaymentStatus.COMPLETED) {
        await handleSuccessfulPayment(payment.id, data.object);
      }
      break;
    }

    case "payment_intent.payment_failed": {
      const payment = await prisma.payment.findFirst({
        where: { providerReference: data.object.id },
      });

      if (payment) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failureReason:
              data.object.last_payment_error?.message || "Payment failed",
          },
        });
      }
      break;
    }

    case "payout.paid": {
      const payout = await prisma.payout.findFirst({
        where: { providerReference: data.object.id },
      });

      if (payout) {
        await prisma.payout.update({
          where: { id: payout.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
          },
        });
      }
      break;
    }
  }
}

async function handleSuccessfulPayment(
  paymentId: string,
  providerData: unknown
): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!payment) return;

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Update payment status
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.COMPLETED,
        completedAt: new Date(),
        metadata: {
          ...(payment.metadata as object),
          providerData,
        },
      },
    });

    // Credit user's wallet if this is a top-up
    if (payment.type === "WALLET_TOPUP") {
      const wallet = await tx.wallet.findFirst({
        where: { userId: payment.userId, currency: payment.currency },
      });

      if (wallet) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: payment.amount } },
        });

        await tx.walletTransaction.create({
          data: {
            id: generateId("txn"),
            walletId: wallet.id,
            type: TransactionType.CREDIT,
            amount: payment.amount,
            currency: payment.currency,
            status: TransactionStatus.COMPLETED,
            reference: paymentId,
            description: "Card payment top-up",
          },
        });
      }
    }

    // Publish event for other services
    await redis.publish(
      "payment:completed",
      JSON.stringify({
        paymentId,
        userId: payment.userId,
        amount: payment.amount,
        currency: payment.currency,
        type: payment.type,
        referenceId: payment.referenceId,
      })
    );
  });
}

// ============================================
// Routes
// ============================================

/**
 * POST /webhooks/paystack - Paystack webhook endpoint
 */
webhookRoutes.post("/paystack", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("x-paystack-signature");

  if (!signature || !verifyPaystackSignature(body, signature)) {
    console.error("Invalid Paystack webhook signature");
    return c.json({ success: false }, 400);
  }

  try {
    const payload = JSON.parse(body);

    console.log("[Paystack Webhook]", payload.event, payload.data?.reference);

    await processWebhookEvent({
      id: payload.data?.id || generateId("evt"),
      type: payload.event,
      data: payload.data,
      timestamp: new Date(),
      provider: "paystack",
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("Paystack webhook error:", error);
    return c.json({ success: false }, 500);
  }
});

/**
 * POST /webhooks/flutterwave - Flutterwave webhook endpoint
 */
webhookRoutes.post("/flutterwave", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("verif-hash");

  if (!signature || !verifyFlutterwaveSignature(body, signature)) {
    console.error("Invalid Flutterwave webhook signature");
    return c.json({ success: false }, 400);
  }

  try {
    const payload = JSON.parse(body);

    console.log("[Flutterwave Webhook]", payload.event, payload.data?.tx_ref);

    await processWebhookEvent({
      id: payload.data?.id?.toString() || generateId("evt"),
      type: payload.event,
      data: payload.data,
      timestamp: new Date(),
      provider: "flutterwave",
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("Flutterwave webhook error:", error);
    return c.json({ success: false }, 500);
  }
});

/**
 * POST /webhooks/stripe - Stripe webhook endpoint
 */
webhookRoutes.post("/stripe", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("stripe-signature");

  if (!signature || !verifyStripeSignature(body, signature)) {
    console.error("Invalid Stripe webhook signature");
    return c.json({ success: false }, 400);
  }

  try {
    const payload = JSON.parse(body);

    console.log("[Stripe Webhook]", payload.type, payload.data?.object?.id);

    await processWebhookEvent({
      id: payload.id,
      type: payload.type,
      data: payload.data,
      timestamp: new Date(payload.created * 1000),
      provider: "stripe",
    });

    return c.json({ success: true });
  } catch (error) {
    console.error("Stripe webhook error:", error);
    return c.json({ success: false }, 500);
  }
});

/**
 * GET /webhooks/events - Get recent webhook events (internal/admin)
 */
webhookRoutes.get("/events", async (c) => {
  const serviceKey = c.req.header("X-Service-Key");
  if (serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
    return c.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Internal endpoint" },
      },
      403
    );
  }

  const limit = Number.parseInt(c.req.query("limit") || "100");
  const events = await redis.lrange("webhook:events", 0, limit - 1);

  return c.json({
    success: true,
    data: {
      count: events.length,
      events: events.map((e) => JSON.parse(e)),
    },
  });
});

/**
 * POST /webhooks/replay/:eventId - Replay a webhook event (internal/admin)
 */
webhookRoutes.post("/replay/:eventId", async (c) => {
  const serviceKey = c.req.header("X-Service-Key");
  if (serviceKey !== process.env.INTERNAL_SERVICE_KEY) {
    return c.json(
      {
        success: false,
        error: { code: "UNAUTHORIZED", message: "Internal endpoint" },
      },
      403
    );
  }

  const eventId = c.req.param("eventId");

  // Find event in history
  const events = await redis.lrange("webhook:events", 0, -1);
  const event = events.map((e) => JSON.parse(e)).find((e) => e.id === eventId);

  if (!event) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Event not found" },
      },
      404
    );
  }

  // Replay the event
  await processWebhookEvent(event);

  return c.json({
    success: true,
    data: {
      message: "Event replayed",
      event,
    },
  });
});

export { webhookRoutes };
