/**
 * Web App Consumer Contract Tests - Payment Service
 *
 * Tests the contract between the Web App (consumer) and Payment Service (provider).
 */

import { MatchersV3, PactV3 } from "@pact-foundation/pact";
import { CONSUMERS, PACTS_DIR, PROVIDER_STATES, PROVIDERS } from "../../config";

const { like, eachLike, string, integer, boolean, decimal, regex, datetime } =
  MatchersV3;

const provider = new PactV3({
  consumer: CONSUMERS.WEB_APP,
  provider: PROVIDERS.PAYMENT_SERVICE,
  dir: PACTS_DIR,
  logLevel: "warn",
});

describe("Web App - Payment Service Contract", () => {
  describe("GET /api/v1/wallets/me", () => {
    it("returns user wallet balance", async () => {
      await provider
        .given(
          PROVIDER_STATES.WALLET_HAS_BALANCE.replace(
            "%s %s %s",
            "user_123 5000 NGN",
          ),
        )
        .uponReceiving("a request for wallet balance")
        .withRequest({
          method: "GET",
          path: "/api/v1/wallets/me",
          headers: {
            Authorization: like("Bearer valid_token"),
            Accept: "application/json",
          },
        })
        .willRespondWith({
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              wallet: {
                id: string("wallet_123"),
                balance: decimal(5000.0),
                currency: string("NGN"),
                pendingBalance: decimal(0),
                lastUpdated: datetime(
                  "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                  "2024-01-15T10:30:00.000Z",
                ),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/wallets/me`, {
          headers: {
            Authorization: "Bearer valid_token",
            Accept: "application/json",
          },
        });

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.wallet.balance).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("POST /api/v1/wallets/topup", () => {
    it("initiates wallet top-up", async () => {
      await provider
        .given(PROVIDER_STATES.WALLET_EXISTS.replace("%s", "user_123"))
        .uponReceiving("a request to top up wallet")
        .withRequest({
          method: "POST",
          path: "/api/v1/wallets/topup",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            amount: 5000,
            paymentMethodId: "pm_001",
          },
        })
        .willRespondWith({
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              transaction: {
                id: string("txn_topup_123"),
                type: string("credit"),
                amount: decimal(5000),
                currency: string("NGN"),
                status: regex(/^(pending|completed)$/, "pending"),
                createdAt: datetime(
                  "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                  "2024-01-15T10:30:00.000Z",
                ),
              },
              // For mobile money, might include STK push info
              paymentInfo: like({
                provider: "mpesa",
                message: "Please enter your M-Pesa PIN",
              }),
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(`${mockServer.url}/api/v1/wallets/topup`, {
          method: "POST",
          headers: {
            Authorization: "Bearer valid_token",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            amount: 5000,
            paymentMethodId: "pm_001",
          }),
        });

        const body = await response.json();
        expect(response.status).toBe(201);
        expect(body.data.transaction.id).toBeDefined();
      });
    });
  });

  describe("GET /api/v1/users/me/payment-methods", () => {
    it("returns user payment methods", async () => {
      await provider
        .given("user has payment methods")
        .uponReceiving("a request for payment methods")
        .withRequest({
          method: "GET",
          path: "/api/v1/users/me/payment-methods",
          headers: {
            Authorization: like("Bearer valid_token"),
            Accept: "application/json",
          },
        })
        .willRespondWith({
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              paymentMethods: eachLike({
                id: string("pm_001"),
                type: regex(
                  /^(card|mobile_money|wallet|bank_transfer)$/,
                  "mobile_money",
                ),
                provider: string("mpesa"),
                lastFour: regex(/^\d{4}$/, "5678"),
                isDefault: boolean(true),
                createdAt: datetime(
                  "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                  "2024-01-15T10:30:00.000Z",
                ),
              }),
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/users/me/payment-methods`,
          {
            headers: {
              Authorization: "Bearer valid_token",
              Accept: "application/json",
            },
          },
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.paymentMethods).toBeInstanceOf(Array);
      });
    });
  });

  describe("POST /api/v1/users/me/payment-methods", () => {
    it("adds a mobile money account", async () => {
      await provider
        .given("user is authenticated")
        .uponReceiving("a request to add mobile money payment method")
        .withRequest({
          method: "POST",
          path: "/api/v1/users/me/payment-methods",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            type: "mobile_money",
            provider: "mpesa",
            phoneNumber: "+254712345678",
          },
        })
        .willRespondWith({
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              paymentMethod: {
                id: string("pm_new_001"),
                type: string("mobile_money"),
                provider: string("mpesa"),
                lastFour: string("5678"),
                isDefault: boolean(false),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/users/me/payment-methods`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer valid_token",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              type: "mobile_money",
              provider: "mpesa",
              phoneNumber: "+254712345678",
            }),
          },
        );

        expect(response.status).toBe(201);
      });
    });

    it("adds a card payment method", async () => {
      await provider
        .given("user is authenticated")
        .uponReceiving("a request to add card payment method")
        .withRequest({
          method: "POST",
          path: "/api/v1/users/me/payment-methods",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            type: "card",
            token: "tok_visa_4242", // Tokenized card from client-side
          },
        })
        .willRespondWith({
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              paymentMethod: {
                id: string("pm_card_001"),
                type: string("card"),
                brand: regex(/^(visa|mastercard|verve)$/, "visa"),
                lastFour: string("4242"),
                expiryMonth: integer(12),
                expiryYear: integer(2026),
                isDefault: boolean(false),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/users/me/payment-methods`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer valid_token",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              type: "card",
              token: "tok_visa_4242",
            }),
          },
        );

        expect(response.status).toBe(201);
      });
    });
  });

  describe("POST /api/v1/payments/initiate", () => {
    it("initiates a payment", async () => {
      await provider
        .given("payment method exists")
        .uponReceiving("a request to initiate payment")
        .withRequest({
          method: "POST",
          path: "/api/v1/payments/initiate",
          headers: {
            Authorization: like("Bearer valid_token"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: {
            amount: 2500,
            currency: "NGN",
            paymentMethodId: "pm_001",
            reference: "ride_abc123",
            metadata: {
              type: "ride_payment",
              rideId: "ride_abc123",
            },
          },
        })
        .willRespondWith({
          status: 201,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              transactionId: string("txn_pay_123"),
              status: regex(/^(pending|requires_action|completed)$/, "pending"),
              amount: decimal(2500),
              currency: string("NGN"),
              // For 3DS or mobile money
              nextAction: like({
                type: "redirect",
                url: "https://payment.provider.com/verify",
              }),
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/payments/initiate`,
          {
            method: "POST",
            headers: {
              Authorization: "Bearer valid_token",
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              amount: 2500,
              currency: "NGN",
              paymentMethodId: "pm_001",
              reference: "ride_abc123",
              metadata: {
                type: "ride_payment",
                rideId: "ride_abc123",
              },
            }),
          },
        );

        const body = await response.json();
        expect(response.status).toBe(201);
        expect(body.data.transactionId).toBeDefined();
      });
    });
  });

  describe("GET /api/v1/payments/:id/verify", () => {
    it("verifies a completed payment", async () => {
      await provider
        .given(PROVIDER_STATES.TRANSACTION_EXISTS.replace("%s", "txn_123"))
        .uponReceiving("a request to verify payment")
        .withRequest({
          method: "GET",
          path: "/api/v1/payments/txn_123/verify",
          headers: {
            Authorization: like("Bearer valid_token"),
            Accept: "application/json",
          },
        })
        .willRespondWith({
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              transactionId: string("txn_123"),
              status: string("completed"),
              amount: decimal(2500),
              currency: string("NGN"),
              paidAt: datetime(
                "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                "2024-01-15T10:30:00.000Z",
              ),
              receipt: {
                id: string("rcpt_001"),
                url: like("https://receipts.ubi.com/rcpt_001"),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/payments/txn_123/verify`,
          {
            headers: {
              Authorization: "Bearer valid_token",
              Accept: "application/json",
            },
          },
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.status).toBe("completed");
      });
    });
  });

  describe("GET /api/v1/wallets/me/transactions", () => {
    it("returns transaction history", async () => {
      await provider
        .given(PROVIDER_STATES.WALLET_EXISTS.replace("%s", "user_123"))
        .uponReceiving("a request for transaction history")
        .withRequest({
          method: "GET",
          path: "/api/v1/wallets/me/transactions",
          query: {
            page: "1",
            limit: "20",
          },
          headers: {
            Authorization: like("Bearer valid_token"),
            Accept: "application/json",
          },
        })
        .willRespondWith({
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
          body: {
            success: boolean(true),
            data: {
              transactions: eachLike({
                id: string("txn_001"),
                type: regex(/^(credit|debit)$/, "debit"),
                amount: decimal(2500),
                currency: string("NGN"),
                status: regex(/^(pending|completed|failed)$/, "completed"),
                description: string("Ride payment"),
                createdAt: datetime(
                  "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
                  "2024-01-15T10:30:00.000Z",
                ),
              }),
              pagination: {
                page: integer(1),
                limit: integer(20),
                total: integer(50),
                totalPages: integer(3),
              },
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const response = await fetch(
          `${mockServer.url}/api/v1/wallets/me/transactions?page=1&limit=20`,
          {
            headers: {
              Authorization: "Bearer valid_token",
              Accept: "application/json",
            },
          },
        );

        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body.data.transactions).toBeInstanceOf(Array);
        expect(body.data.pagination).toBeDefined();
      });
    });
  });
});
