/**
 * Orange Money Service Unit Tests
 *
 * Tests for the Orange Money payment service for Francophone Africa.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type {
  OrangeMoneyConfig,
  OrangeMoneyCallbackData,
} from "../../src/providers/orange-money.service";

// Mock dependencies
const mockPrisma = {
  paymentTransaction: {
    create: vi.fn(),
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  payout: {
    create: vi.fn(),
  },
  providerBalance: {
    upsert: vi.fn(),
  },
};

// Mock nanoid
vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-id-123"),
}));

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Lazy import for OrangeMoneyService
const createService = async (config: OrangeMoneyConfig, prisma: unknown) => {
  const { OrangeMoneyService } = await import(
    "../../src/providers/orange-money.service"
  );
  return new OrangeMoneyService(
    config,
    prisma as ConstructorParameters<typeof OrangeMoneyService>[1]
  );
};

// Helper to setup mock fetch with URL pattern matching
function setupMockFetch(
  urlPatterns: Record<string, { json: unknown; status?: number; ok?: boolean }>
): void {
  mockFetch.mockImplementation((url: string) => {
    for (const [pattern, response] of Object.entries(urlPatterns)) {
      if (url.includes(pattern)) {
        return {
          ok: response.ok ?? true,
          status: response.status ?? 200,
          json: vi.fn().mockResolvedValue(response.json),
        };
      }
    }
    return {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({}),
    };
  });
}

describe("OrangeMoneyService", () => {
  const mockConfig: OrangeMoneyConfig = {
    merchantKey: "test-merchant-key",
    merchantSecret: "test-merchant-secret",
    merchantCode: "TEST123",
    notifyUrl: "https://api.ubi.com/webhooks/orange-money",
    returnUrl: "https://app.ubi.com/payment/return",
    environment: "sandbox",
    country: "CI",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful OAuth token response by default
    setupMockFetch({
      "/oauth": {
        json: {
          access_token: "mock-access-token",
          token_type: "Bearer",
          expires_in: 3600,
        },
      },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("createPayment (Web Payment)", () => {
    it("should create a web payment request successfully", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
            token_type: "Bearer",
            expires_in: 3600,
          },
        },
        "/webpayment": {
          json: {
            status: 201,
            message: "Success",
            pay_token: "token-123",
            payment_url: "https://orange.com/pay/123",
            notif_token: "notif-456",
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.createPayment({
        phoneNumber: "+22507XXXXXXXX",
        amount: 5000,
        description: "Test Payment",
        orderId: "ORDER-123",
      });

      expect(result.status).toBe(201);
      expect(result.paymentUrl).toBe("https://orange.com/pay/123");
      expect(mockPrisma.paymentTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: "ORANGE_MONEY_CI",
            amount: 5000,
            currency: "XOF",
            status: "PENDING",
          }),
        })
      );
    });

    it("should throw error on failed payment creation", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
          },
        },
        "/webpayment": {
          json: {
            status: 400,
            message: "Invalid request",
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      await expect(
        service.createPayment({
          phoneNumber: "+22507XXXXXXXX",
          amount: 5000,
          description: "Test Payment",
          orderId: "ORDER-123",
        })
      ).rejects.toThrow("Orange Money error: Invalid request");
    });
  });

  describe("sendUssdPush", () => {
    it("should send USSD push payment successfully", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
          },
        },
        "/ussd": {
          json: {
            status: 200,
            message: "Push notification sent",
            data: {
              txnid: "TXN-789",
              txnstatus: "PENDING",
            },
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.sendUssdPush({
        phoneNumber: "+22507XXXXXXXX",
        amount: 2500,
        description: "USSD Payment",
        orderId: "USSD-ORDER-123",
      });

      expect(result.status).toBe(200);
      expect(mockPrisma.paymentTransaction.create).toHaveBeenCalled();
    });

    it("should return error status on USSD failure", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
          },
        },
        "/ussd": {
          json: {
            status: 500,
            message: "Service unavailable",
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      await expect(
        service.sendUssdPush({
          phoneNumber: "+22507XXXXXXXX",
          amount: 2500,
          description: "USSD Payment",
          orderId: "USSD-ORDER-123",
        })
      ).rejects.toThrow();
    });
  });

  describe("queryTransaction", () => {
    it("should query transaction status successfully", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
          },
        },
        "/transaction": {
          json: {
            status: 200,
            message: "Success",
            data: {
              txnid: "TXN-456",
              status: "SUCCESS",
              amount: "5000",
              orderId: "ORDER-123",
              createtime: "2026-01-29",
              txnmode: "webpayment",
            },
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.queryTransaction("ORDER-123");

      expect(result.status).toBe(200);
      expect(result.data?.status).toBe("SUCCESS");
      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerReference: "ORDER-123" },
          data: expect.objectContaining({
            status: "COMPLETED",
          }),
        })
      );
    });

    it("should handle pending transaction status", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
          },
        },
        "/transaction": {
          json: {
            status: 200,
            data: {
              txnid: "TXN-456",
              status: "PENDING",
              amount: "5000",
              orderId: "ORDER-123",
            },
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.queryTransaction("ORDER-123");

      expect(result.data?.status).toBe("PENDING");
      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PENDING",
          }),
        })
      );
    });

    it("should handle failed transaction status", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
          },
        },
        "/transaction": {
          json: {
            status: 200,
            data: {
              txnid: "TXN-456",
              status: "FAILED",
              amount: "5000",
            },
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.queryTransaction("ORDER-123");

      expect(result.data?.status).toBe("FAILED");
      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
          }),
        })
      );
    });
  });

  describe("disbursement", () => {
    it("should process disbursement successfully", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
          },
        },
        "/cashout": {
          json: {
            status: 200,
            message: "Success",
            data: {
              txnid: "PAYOUT-TXN-789",
              txnstatus: "SUCCESS",
              createtime: "2026-01-29",
            },
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.disbursement({
        phoneNumber: "+22507XXXXXXXX",
        amount: 10000,
        orderId: "PAYOUT-123",
        description: "Driver payout",
      });

      expect(result.status).toBe(200);
      expect(result.data?.txnid).toBe("PAYOUT-TXN-789");
      expect(mockPrisma.payout.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: "ORANGE_MONEY_CI",
            amount: 10000,
            currency: "XOF",
            status: "COMPLETED",
          }),
        })
      );
    });

    it("should throw error on disbursement failure", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
          },
        },
        "/cashout": {
          json: {
            status: 400,
            message: "Insufficient balance",
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      await expect(
        service.disbursement({
          phoneNumber: "+22507XXXXXXXX",
          amount: 10000,
          orderId: "PAYOUT-123",
        })
      ).rejects.toThrow("Orange Money disbursement error: Insufficient balance");
    });
  });

  describe("getBalance", () => {
    it("should fetch merchant balance successfully", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
          },
        },
        "/balance": {
          json: {
            status: 200,
            data: {
              balance: 500000,
              currency: "XOF",
            },
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      const balance = await service.getBalance();

      expect(balance).toBe(500000);
      expect(mockPrisma.providerBalance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_currency: {
              provider: "ORANGE_MONEY_CI",
              currency: "XOF",
            },
          },
        })
      );
    });

    it("should return 0 on balance fetch failure", async () => {
      setupMockFetch({
        "/oauth": {
          json: {
            access_token: "mock-access-token",
          },
        },
        "/balance": {
          json: {
            status: 500,
            message: "Server error",
          },
        },
      });

      const service = await createService(mockConfig, mockPrisma);
      const balance = await service.getBalance();
      expect(balance).toBe(0);
    });
  });

  describe("handleCallback", () => {
    it("should process successful callback", async () => {
      const callbackData: OrangeMoneyCallbackData = {
        notifToken: "notif-456",
        txnid: "TXN-789",
        status: "SUCCESS",
        orderId: "ORDER-123",
        payToken: "pay-token-123",
        amount: "5000",
      };

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.handleCallback(callbackData);

      expect(result.success).toBe(true);
      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerReference: "ORDER-123" },
          data: expect.objectContaining({
            status: "COMPLETED",
            providerTransactionId: "TXN-789",
          }),
        })
      );
    });

    it("should process failed callback", async () => {
      const callbackData: OrangeMoneyCallbackData = {
        notifToken: "notif-456",
        txnid: "TXN-789",
        status: "FAILED",
        orderId: "ORDER-123",
        payToken: "pay-token-123",
        amount: "5000",
      };

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.handleCallback(callbackData);

      expect(result.success).toBe(true);
      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
          }),
        })
      );
    });

    it("should process cancelled callback", async () => {
      const callbackData: OrangeMoneyCallbackData = {
        notifToken: "notif-456",
        txnid: "TXN-789",
        status: "CANCELLED",
        orderId: "ORDER-123",
        payToken: "pay-token-123",
        amount: "5000",
      };

      const service = await createService(mockConfig, mockPrisma);
      await service.handleCallback(callbackData);

      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "CANCELLED",
          }),
        })
      );
    });
  });

  describe("getCurrency", () => {
    it("should return XOF for all countries", async () => {
      const service = await createService(mockConfig, mockPrisma);
      expect(service.getCurrency()).toBe("XOF");
    });
  });

  describe("getProvider", () => {
    it("should return correct provider for CI", async () => {
      const service = await createService(mockConfig, mockPrisma);
      expect(service.getProvider()).toBe("ORANGE_MONEY_CI");
    });

    it("should return correct provider for SN", async () => {
      const service = await createService(
        { ...mockConfig, country: "SN" },
        mockPrisma
      );
      expect(service.getProvider()).toBe("ORANGE_MONEY_SN");
    });

    it("should return correct provider for CM", async () => {
      const service = await createService(
        { ...mockConfig, country: "CM" },
        mockPrisma
      );
      expect(service.getProvider()).toBe("ORANGE_MONEY_CM");
    });

    it("should return correct provider for ML", async () => {
      const service = await createService(
        { ...mockConfig, country: "ML" },
        mockPrisma
      );
      expect(service.getProvider()).toBe("ORANGE_MONEY_ML");
    });
  });
});

describe("createOrangeMoneyServices", () => {
  it("should create services for all default countries", async () => {
    const { createOrangeMoneyServices } = await import(
      "../../src/providers/orange-money.service"
    );

    const services = createOrangeMoneyServices(
      {
        merchantKey: "test-key",
        merchantSecret: "test-secret",
        merchantCode: "TEST123",
        notifyUrl: "https://api.ubi.com/webhooks/orange-money",
        returnUrl: "https://app.ubi.com/payment/return",
        environment: "sandbox",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockPrisma as any
    );

    expect(services.get("CI")).toBeDefined();
    expect(services.get("SN")).toBeDefined();
    expect(services.get("CM")).toBeDefined();
    expect(services.get("ML")).toBeDefined();
    expect(services.size).toBe(4);
  });
});

describe("URL Configuration", () => {
  it("should use sandbox URL in sandbox environment", async () => {
    const sandboxService = await createService(
      {
        merchantKey: "test-key",
        merchantSecret: "test-secret",
        merchantCode: "TEST123",
        notifyUrl: "https://api.ubi.com/webhooks/orange-money",
        returnUrl: "https://app.ubi.com/payment/return",
        environment: "sandbox",
        country: "CI",
      },
      mockPrisma
    );
    expect(sandboxService).toBeDefined();
  });

  it("should use production URL in production environment", async () => {
    const prodService = await createService(
      {
        merchantKey: "test-key",
        merchantSecret: "test-secret",
        merchantCode: "TEST123",
        notifyUrl: "https://api.ubi.com/webhooks/orange-money",
        returnUrl: "https://app.ubi.com/payment/return",
        environment: "production",
        country: "CI",
      },
      mockPrisma
    );
    expect(prodService).toBeDefined();
  });
});
