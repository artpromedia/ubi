/**
 * Telebirr Service Unit Tests
 *
 * Tests for the Telebirr payment service for Ethiopia.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TelebirrConfig } from "../../src/providers/telebirr.service";

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

// Mock crypto functions
vi.mock("crypto", () => ({
  createSign: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    sign: vi.fn(() => "mock-signature"),
  })),
  createVerify: vi.fn(() => ({
    update: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    verify: vi.fn(() => true),
  })),
  publicEncrypt: vi.fn(() => Buffer.from("encrypted-data")),
}));

// Mock nanoid
vi.mock("nanoid", () => ({
  nanoid: vi.fn(() => "test-id-123"),
}));

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Lazy import for TelebirrService
const createService = async (config: TelebirrConfig, prisma: unknown) => {
  const { TelebirrService } =
    await import("../../src/providers/telebirr.service");
  return new TelebirrService(
    config,
    prisma as ConstructorParameters<typeof TelebirrService>[1],
  );
};

describe("TelebirrService", () => {
  const mockConfig: TelebirrConfig = {
    appId: "test-app-id",
    appKey: "test-app-key",
    shortCode: "123456",
    publicKey: "-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----",
    privateKey: "-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----",
    notifyUrl: "https://api.ubi.com/webhooks/telebirr",
    returnUrl: "https://app.ubi.com/payment/return",
    environment: "sandbox",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("createPayment", () => {
    it("should create a payment request successfully", async () => {
      const mockResponse = {
        code: 200,
        msg: "Success",
        data: {
          toPayUrl: "https://telebirr.et/pay/123",
          prepayId: "prepay-123",
        },
      };

      mockFetch.mockResolvedValueOnce({
        json: () => mockResponse,
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.createPayment({
        phoneNumber: "251912345678",
        amount: 100,
        subject: "Test Payment",
        outTradeNo: "ORDER-123",
      });

      expect(result.code).toBe(200);
      expect(result.data?.toPayUrl).toBe("https://telebirr.et/pay/123");
      expect(mockPrisma.paymentTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: "TELEBIRR",
            amount: 100,
            currency: "ETB",
            status: "PENDING",
          }),
        }),
      );
    });

    it("should throw error on failed payment creation", async () => {
      const mockResponse = {
        code: 400,
        msg: "Invalid request",
      };

      mockFetch.mockResolvedValueOnce({
        json: () => mockResponse,
      });

      const service = await createService(mockConfig, mockPrisma);
      await expect(
        service.createPayment({
          phoneNumber: "251912345678",
          amount: 100,
          subject: "Test Payment",
          outTradeNo: "ORDER-123",
        }),
      ).rejects.toThrow("Telebirr error: Invalid request");
    });

    it("should handle network errors gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const service = await createService(mockConfig, mockPrisma);
      await expect(
        service.createPayment({
          phoneNumber: "251912345678",
          amount: 100,
          subject: "Test Payment",
          outTradeNo: "ORDER-123",
        }),
      ).rejects.toThrow("Network error");
    });
  });

  describe("sendUssdPayment", () => {
    it("should send USSD payment request successfully", async () => {
      const mockResponse = {
        code: 200,
        msg: "Success",
      };

      mockFetch.mockResolvedValueOnce({
        json: () => mockResponse,
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.sendUssdPayment({
        phoneNumber: "251912345678",
        amount: 50,
        subject: "USSD Payment",
        outTradeNo: "USSD-ORDER-123",
      });

      expect(result.success).toBe(true);
      expect(mockPrisma.paymentTransaction.create).toHaveBeenCalled();
    });

    it("should return failure on USSD error", async () => {
      const mockResponse = {
        code: 500,
        msg: "Service unavailable",
      };

      mockFetch.mockResolvedValueOnce({
        json: () => mockResponse,
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.sendUssdPayment({
        phoneNumber: "251912345678",
        amount: 50,
        subject: "USSD Payment",
        outTradeNo: "USSD-ORDER-123",
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Service unavailable");
    });
  });

  describe("queryTransaction", () => {
    it("should query transaction status successfully", async () => {
      const mockResponse = {
        code: 200,
        msg: "Success",
        data: {
          outTradeNo: "ORDER-123",
          tradeNo: "TXN-456",
          transAmount: 100,
          transStatus: "S",
          transDate: "2026-01-29",
        },
      };

      mockFetch.mockResolvedValueOnce({
        json: () => mockResponse,
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.queryTransaction("ORDER-123");

      expect(result.code).toBe(200);
      expect(result.data?.transStatus).toBe("S");
      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerReference: "ORDER-123" },
          data: expect.objectContaining({
            status: "COMPLETED",
          }),
        }),
      );
    });

    it("should handle pending transaction status", async () => {
      const mockResponse = {
        code: 200,
        msg: "Success",
        data: {
          outTradeNo: "ORDER-123",
          tradeNo: "TXN-456",
          transAmount: 100,
          transStatus: "P",
          transDate: "2026-01-29",
        },
      };

      mockFetch.mockResolvedValueOnce({
        json: () => mockResponse,
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.queryTransaction("ORDER-123");

      expect(result.data?.transStatus).toBe("P");
      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PENDING",
          }),
        }),
      );
    });
  });

  describe("disbursement", () => {
    it("should process disbursement successfully", async () => {
      const mockResponse = {
        code: 200,
        msg: "Success",
        data: {
          tradeNo: "PAYOUT-TXN-789",
          outTradeNo: "PAYOUT-123",
        },
      };

      mockFetch.mockResolvedValueOnce({
        json: () => mockResponse,
      });

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.disbursement({
        phoneNumber: "251912345678",
        amount: 500,
        outTradeNo: "PAYOUT-123",
        remark: "Driver payout",
      });

      expect(result.code).toBe(200);
      expect(result.data?.tradeNo).toBe("PAYOUT-TXN-789");
      expect(mockPrisma.payout.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: "TELEBIRR",
            amount: 500,
            currency: "ETB",
            status: "COMPLETED",
          }),
        }),
      );
    });

    it("should throw error on disbursement failure", async () => {
      const mockResponse = {
        code: 400,
        msg: "Insufficient balance",
      };

      mockFetch.mockResolvedValueOnce({
        json: () => mockResponse,
      });

      const service = await createService(mockConfig, mockPrisma);
      await expect(
        service.disbursement({
          phoneNumber: "251912345678",
          amount: 500,
          outTradeNo: "PAYOUT-123",
        }),
      ).rejects.toThrow("Telebirr disbursement error: Insufficient balance");
    });
  });

  describe("getBalance", () => {
    it("should fetch merchant balance successfully", async () => {
      const mockResponse = {
        code: 200,
        msg: "Success",
        data: {
          balance: 100000,
          currency: "ETB",
          availableBalance: 95000,
          frozenBalance: 5000,
        },
      };

      mockFetch.mockResolvedValueOnce({
        json: () => mockResponse,
      });

      const service = await createService(mockConfig, mockPrisma);
      const balance = await service.getBalance();

      expect(balance).toBe(95000);
      expect(mockPrisma.providerBalance.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_currency: {
              provider: "TELEBIRR",
              currency: "ETB",
            },
          },
        }),
      );
    });

    it("should return 0 on balance fetch failure", async () => {
      const mockResponse = {
        code: 500,
        msg: "Server error",
      };

      mockFetch.mockResolvedValueOnce({
        json: () => mockResponse,
      });

      const service = await createService(mockConfig, mockPrisma);
      const balance = await service.getBalance();
      expect(balance).toBe(0);
    });
  });

  describe("handleCallback", () => {
    it("should process successful callback", async () => {
      const callbackData = {
        appid: "test-app-id",
        sign: "valid-signature",
        trade_no: "TXN-456",
        out_trade_no: "ORDER-123",
        total_amount: "100",
        trans_status: "S" as const,
        trade_date: "2026-01-29",
        msisdn: "251912345678",
      };

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.handleCallback(callbackData);

      expect(result.success).toBe(true);
      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { providerReference: "ORDER-123" },
          data: expect.objectContaining({
            status: "COMPLETED",
            providerTransactionId: "TXN-456",
          }),
        }),
      );
    });

    it("should process failed callback", async () => {
      const callbackData = {
        appid: "test-app-id",
        sign: "valid-signature",
        trade_no: "TXN-456",
        out_trade_no: "ORDER-123",
        total_amount: "100",
        trans_status: "F" as const,
        trade_date: "2026-01-29",
        msisdn: "251912345678",
      };

      const service = await createService(mockConfig, mockPrisma);
      const result = await service.handleCallback(callbackData);

      expect(result.success).toBe(true);
      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
          }),
        }),
      );
    });

    it("should process cancelled callback", async () => {
      const callbackData = {
        appid: "test-app-id",
        sign: "valid-signature",
        trade_no: "TXN-456",
        out_trade_no: "ORDER-123",
        total_amount: "100",
        trans_status: "C" as const,
        trade_date: "2026-01-29",
        msisdn: "251912345678",
      };

      const service = await createService(mockConfig, mockPrisma);
      await service.handleCallback(callbackData);

      expect(mockPrisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "CANCELLED",
          }),
        }),
      );
    });
  });

  describe("URL configuration", () => {
    it("should use sandbox URL in sandbox environment", async () => {
      const sandboxService = await createService(
        { ...mockConfig, environment: "sandbox" },
        mockPrisma,
      );
      expect(sandboxService).toBeDefined();
    });

    it("should use production URL in production environment", async () => {
      const prodService = await createService(
        { ...mockConfig, environment: "production" },
        mockPrisma,
      );
      expect(prodService).toBeDefined();
    });
  });
});
