/**
 * Payment Flow Integration Tests
 * UBI Payment Service
 *
 * Tests end-to-end payment flows
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

// Test app setup
const app = new Hono();

// Mock the actual app routes for testing

describe("Payment Flow Integration Tests", () => {
  // ===========================================
  // WALLET TOP-UP FLOW
  // ===========================================

  describe("Wallet Top-up Flow", () => {
    it("should complete M-Pesa STK Push top-up flow", async () => {
      // Step 1: Initiate STK Push
      const initiateResponse = await app.request(
        "/mobile-money/mpesa/stk-push",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-ID": "test-user-123",
            Authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            phone: "+254712345678",
            amount: 1000,
            currency: "KES",
          }),
        }
      );

      // Verify initiation was successful
      expect(initiateResponse.status).toBe(200);
      const initiateData = await initiateResponse.json();
      expect(initiateData.success).toBe(true);
      expect(initiateData.data.checkoutRequestId).toBeDefined();

      // Step 2: Simulate M-Pesa callback (successful payment)
      const callbackResponse = await app.request("/webhooks/mpesa/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Body: {
            stkCallback: {
              MerchantRequestID: initiateData.data.merchantRequestId,
              CheckoutRequestID: initiateData.data.checkoutRequestId,
              ResultCode: 0,
              ResultDesc: "The service request is processed successfully.",
              CallbackMetadata: {
                Item: [
                  { Name: "Amount", Value: 1000 },
                  { Name: "MpesaReceiptNumber", Value: "PBK123456" },
                  { Name: "TransactionDate", Value: "20240115120000" },
                  { Name: "PhoneNumber", Value: "254712345678" },
                ],
              },
            },
          },
        }),
      });

      expect(callbackResponse.status).toBe(200);

      // Step 3: Verify wallet balance updated
      const balanceResponse = await app.request(
        "/wallets/balance?currency=KES",
        {
          headers: {
            "X-User-ID": "test-user-123",
            Authorization: "Bearer test-token",
          },
        }
      );

      expect(balanceResponse.status).toBe(200);
      const balanceData = await balanceResponse.json();
      expect(Number.parseFloat(balanceData.data.balance)).toBeGreaterThanOrEqual(1000);
    });

    it("should handle failed M-Pesa payment", async () => {
      // Initiate STK Push
      const initiateResponse = await app.request(
        "/mobile-money/mpesa/stk-push",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-ID": "test-user-456",
            Authorization: "Bearer test-token",
          },
          body: JSON.stringify({
            phone: "+254712345678",
            amount: 500,
            currency: "KES",
          }),
        }
      );

      const initiateData = await initiateResponse.json();

      // Simulate failed callback
      const callbackResponse = await app.request("/webhooks/mpesa/callback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Body: {
            stkCallback: {
              MerchantRequestID: initiateData.data.merchantRequestId,
              CheckoutRequestID: initiateData.data.checkoutRequestId,
              ResultCode: 1032, // User cancelled
              ResultDesc: "Request cancelled by user",
            },
          },
        }),
      });

      expect(callbackResponse.status).toBe(200);

      // Verify payment is marked as failed
      const transactionResponse = await app.request(
        `/payments/transactions?reference=${initiateData.data.checkoutRequestId}`,
        {
          headers: {
            "X-User-ID": "test-user-456",
            Authorization: "Bearer test-token",
          },
        }
      );

      const txnData = await transactionResponse.json();
      expect(txnData.data.status).toBe("FAILED");
    });

    it("should complete Paystack card payment flow", async () => {
      // Step 1: Initialize payment
      const initResponse = await app.request("/payments/card/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": "test-user-789",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          amount: 5000,
          currency: "NGN",
          email: "test@ubi.africa",
        }),
      });

      expect(initResponse.status).toBe(200);
      const initData = await initResponse.json();
      expect(initData.data.authorization_url).toBeDefined();
      expect(initData.data.reference).toBeDefined();

      // Step 2: Simulate Paystack webhook (successful charge)
      const webhookResponse = await app.request("/webhooks/paystack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Paystack-Signature": "test-signature", // Would be verified in prod
        },
        body: JSON.stringify({
          event: "charge.success",
          data: {
            reference: initData.data.reference,
            amount: 500000, // Paystack uses kobo
            currency: "NGN",
            status: "success",
            customer: {
              email: "test@ubi.africa",
            },
            metadata: {
              userId: "test-user-789",
            },
          },
        }),
      });

      expect(webhookResponse.status).toBe(200);
    });
  });

  // ===========================================
  // RIDE PAYMENT FLOW
  // ===========================================

  describe("Ride Payment Flow", () => {
    it("should complete wallet ride payment with hold/capture", async () => {
      const userId = "rider-123";
      const driverId = "driver-456";

      // Step 1: Create hold for estimated fare
      const holdResponse = await app.request("/wallets/hold", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": userId,
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          amount: 2000,
          currency: "KES",
          reason: "Ride payment hold",
          reference: "ride-001",
          expiresInMinutes: 60,
        }),
      });

      expect(holdResponse.status).toBe(200);
      const holdData = await holdResponse.json();
      expect(holdData.data.holdId).toBeDefined();

      // Step 2: Complete ride and capture payment
      const captureResponse = await app.request("/payments/ride/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer service-token",
        },
        body: JSON.stringify({
          rideId: "ride-001",
          holdId: holdData.data.holdId,
          riderId: userId,
          driverId: driverId,
          finalAmount: 1800, // Actual fare
          tip: 200,
          currency: "KES",
        }),
      });

      expect(captureResponse.status).toBe(200);
      const captureData = await captureResponse.json();
      expect(captureData.data.riderDebited).toBe(2000);
      expect(captureData.data.driverCredited).toBeDefined();
    });

    it("should release hold on cancelled ride", async () => {
      const userId = "rider-124";

      // Create hold
      const holdResponse = await app.request("/wallets/hold", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": userId,
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          amount: 1500,
          currency: "KES",
          reason: "Ride payment hold",
          reference: "ride-002",
          expiresInMinutes: 60,
        }),
      });

      const holdData = await holdResponse.json();

      // Release hold (ride cancelled)
      const releaseResponse = await app.request(
        `/wallets/hold/${holdData.data.holdId}/release`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer service-token",
          },
          body: JSON.stringify({
            reason: "Ride cancelled by rider",
          }),
        }
      );

      expect(releaseResponse.status).toBe(200);
      const releaseData = await releaseResponse.json();
      expect(releaseData.data.released).toBe(true);
    });
  });

  // ===========================================
  // FOOD ORDER PAYMENT FLOW
  // ===========================================

  describe("Food Order Payment Flow", () => {
    it("should process food order with restaurant settlement", async () => {
      const riderId = "rider-food-001";
      const restaurantId = "restaurant-001";

      // Step 1: Create order and process payment
      const orderPaymentResponse = await app.request("/payments/food-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer service-token",
        },
        body: JSON.stringify({
          orderId: "order-001",
          riderId: riderId,
          restaurantId: restaurantId,
          subtotal: 3500,
          deliveryFee: 500,
          serviceFee: 200,
          total: 4200,
          currency: "NGN",
          paymentMethod: "WALLET",
        }),
      });

      expect(orderPaymentResponse.status).toBe(200);
      const paymentData = await orderPaymentResponse.json();
      expect(paymentData.data.status).toBe("COMPLETED");

      // Verify ledger entries created
      expect(paymentData.data.ledgerEntries).toHaveLength(4); // Rider debit, Restaurant credit, UBI commission, Delivery fee
    });
  });

  // ===========================================
  // DRIVER PAYOUT FLOW
  // ===========================================

  describe("Driver Payout Flow", () => {
    it("should process instant cashout via M-Pesa B2C", async () => {
      const driverId = "driver-payout-001";

      // Request instant cashout
      const cashoutResponse = await app.request("/payouts/instant-cashout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": driverId,
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          amount: 5000,
          currency: "KES",
          phone: "+254712345678",
          provider: "MPESA",
        }),
      });

      expect(cashoutResponse.status).toBe(200);
      const cashoutData = await cashoutResponse.json();
      expect(cashoutData.data.status).toBe("PROCESSING");
      expect(cashoutData.data.payoutId).toBeDefined();

      // Simulate B2C result callback
      const callbackResponse = await app.request("/webhooks/mpesa/b2c/result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Result: {
            ResultType: 0,
            ResultCode: 0,
            ResultDesc: "The service request is processed successfully.",
            OriginatorConversationID: cashoutData.data.conversationId,
            ConversationID: "AG_20240115_123456",
            TransactionID: "PBK789012",
            ResultParameters: {
              ResultParameter: [
                { Key: "TransactionReceipt", Value: "PBK789012" },
                { Key: "TransactionAmount", Value: 5000 },
                {
                  Key: "ReceiverPartyPublicName",
                  Value: "254712345678 - John Doe",
                },
              ],
            },
          },
        }),
      });

      expect(callbackResponse.status).toBe(200);

      // Verify payout completed
      const payoutStatusResponse = await app.request(
        `/payouts/${cashoutData.data.payoutId}`,
        {
          headers: {
            "X-User-ID": driverId,
            Authorization: "Bearer test-token",
          },
        }
      );

      const statusData = await payoutStatusResponse.json();
      expect(statusData.data.status).toBe("COMPLETED");
    });
  });

  // ===========================================
  // FRAUD DETECTION FLOW
  // ===========================================

  describe("Fraud Detection Flow", () => {
    it("should block suspicious transaction", async () => {
      // Transaction from blacklisted IP
      const paymentResponse = await app.request("/payments/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": "suspicious-user",
          "X-Forwarded-For": "192.168.1.100", // Blacklisted IP
          "X-Device-ID": "device-malicious",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          amount: 100000,
          currency: "NGN",
          type: "WALLET_TOPUP",
        }),
      });

      expect(paymentResponse.status).toBe(403);
      const data = await paymentResponse.json();
      expect(data.error.code).toBe("TRANSACTION_BLOCKED");
      expect(data.error.riskLevel).toBe("CRITICAL");
    });

    it("should require 3DS for medium-risk card transaction", async () => {
      const paymentResponse = await app.request("/payments/card/initialize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": "new-user-001",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          amount: 50000,
          currency: "NGN",
          email: "new@user.com",
        }),
      });

      expect(paymentResponse.status).toBe(200);
      const data = await paymentResponse.json();
      expect(data.data.requires3DS).toBe(true);
    });
  });

  // ===========================================
  // RECONCILIATION FLOW
  // ===========================================

  describe("Reconciliation Flow", () => {
    it("should run daily reconciliation and detect discrepancies", async () => {
      // Trigger manual reconciliation (admin action)
      const reconResponse = await app.request("/admin/reconciliations/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer admin-token",
        },
        body: JSON.stringify({
          provider: "PAYSTACK",
          date: "2024-01-14",
          currency: "NGN",
        }),
      });

      expect(reconResponse.status).toBe(200);
      const reconData = await reconResponse.json();
      expect(reconData.data.reportId).toBeDefined();
      expect(reconData.data.status).toBeDefined();
    });

    it("should resolve discrepancy with notes", async () => {
      // Assume discrepancy exists
      const resolveResponse = await app.request(
        "/admin/reconciliations/discrepancies/disc-001/resolve",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer admin-token",
          },
          body: JSON.stringify({
            resolution:
              "Verified with Paystack - timing issue, transaction confirmed",
          }),
        }
      );

      expect(resolveResponse.status).toBe(200);
      const resolveData = await resolveResponse.json();
      expect(resolveData.data.status).toBe("resolved");
    });
  });

  // ===========================================
  // SETTLEMENT FLOW
  // ===========================================

  describe("Settlement Flow", () => {
    it("should create and process restaurant settlement", async () => {
      // Create settlement
      const createResponse = await app.request("/admin/settlements", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer admin-token",
        },
        body: JSON.stringify({
          recipientId: "restaurant-001",
          recipientType: "RESTAURANT",
          periodStart: "2024-01-08",
          periodEnd: "2024-01-14",
          grossAmount: 500000,
          currency: "NGN",
          payoutMethod: "bank_transfer",
          bankDetails: {
            bankCode: "058",
            accountNumber: "0123456789",
            accountName: "Restaurant Business Ltd",
          },
        }),
      });

      expect(createResponse.status).toBe(201);
      const createData = await createResponse.json();
      expect(createData.data.id).toBeDefined();
      expect(createData.data.netAmount).toBeDefined();
      expect(Number.parseFloat(createData.data.netAmount)).toBeLessThan(500000); // After commission

      // Process settlement
      const processResponse = await app.request(
        `/admin/settlements/${createData.data.id}/process`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer admin-token",
          },
        }
      );

      expect(processResponse.status).toBe(200);
      const processData = await processResponse.json();
      expect(processData.data.status).toBe("processing");
    });
  });

  // ===========================================
  // IDEMPOTENCY TESTS
  // ===========================================

  describe("Idempotency", () => {
    it("should return same result for duplicate payment request", async () => {
      const idempotencyKey = "idem-" + Date.now();

      // First request
      const response1 = await app.request("/payments/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": "test-user",
          "X-Idempotency-Key": idempotencyKey,
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          amount: 1000,
          currency: "NGN",
          type: "WALLET_TOPUP",
          provider: "PAYSTACK",
        }),
      });

      const data1 = await response1.json();

      // Duplicate request with same idempotency key
      const response2 = await app.request("/payments/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": "test-user",
          "X-Idempotency-Key": idempotencyKey,
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          amount: 1000,
          currency: "NGN",
          type: "WALLET_TOPUP",
          provider: "PAYSTACK",
        }),
      });

      const data2 = await response2.json();

      // Should return same transaction ID
      expect(data1.data.transactionId).toBe(data2.data.transactionId);
    });
  });
});
