/**
 * Settlement Service Unit Tests
 * UBI Payment Service
 */

import { Currency, PaymentProvider } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrismaClient, mockRedisClient, resetMocks } from "../setup";

// Mock dependencies
vi.mock("../../src/lib/prisma", () => ({
  prisma: mockPrismaClient,
}));

vi.mock("../../src/lib/redis", () => ({
  redis: mockRedisClient,
}));

import { SettlementService } from "../../src/services/settlement.service";

describe("SettlementService", () => {
  let settlementService: SettlementService;

  beforeEach(() => {
    resetMocks();
    settlementService = new SettlementService(
      mockPrismaClient,
      mockRedisClient
    );
  });

  // ===========================================
  // COMMISSION CALCULATION TESTS
  // ===========================================

  describe("calculateCommission", () => {
    it("should calculate restaurant commission correctly", () => {
      const grossAmount = 100000; // ₦100,000
      const result = settlementService.calculateCommission(
        grossAmount,
        "RESTAURANT"
      );

      expect(result.grossAmount).toBe(100000);
      expect(result.ubiCommission).toBe(20000); // 20%
      expect(result.ceerionDeduction).toBe(1000); // 1%
      expect(result.settlementFee).toBe(600); // 0.5% + ₦100
      expect(result.netAmount).toBe(78400); // 100000 - 20000 - 1000 - 600
    });

    it("should calculate merchant commission correctly", () => {
      const grossAmount = 50000; // ₦50,000
      const result = settlementService.calculateCommission(
        grossAmount,
        "MERCHANT"
      );

      expect(result.ubiCommission).toBe(1500); // 3%
      expect(result.ceerionDeduction).toBe(75); // 0.15%
      expect(result.settlementFee).toBe(350); // 0.5% + ₦100
      expect(result.netAmount).toBe(48075);
    });

    it("should calculate driver commission correctly", () => {
      const grossAmount = 25000; // ₦25,000
      const result = settlementService.calculateCommission(
        grossAmount,
        "DRIVER"
      );

      expect(result.ubiCommission).toBe(3750); // 15%
      expect(result.ceerionDeduction).toBe(187.5); // 0.75%
      expect(result.settlementFee).toBe(225); // 0.5% + ₦100
      expect(result.netAmount).toBe(20837.5);
    });

    it("should calculate partner commission correctly", () => {
      const grossAmount = 200000; // ₦200,000
      const result = settlementService.calculateCommission(
        grossAmount,
        "PARTNER"
      );

      expect(result.ubiCommission).toBe(20000); // 10%
      expect(result.ceerionDeduction).toBe(1000); // 0.5%
      expect(result.settlementFee).toBe(1100); // 0.5% + ₦100
      expect(result.netAmount).toBe(177900);
    });

    it("should handle minimum settlement fee", () => {
      const grossAmount = 1000; // Small amount
      const result = settlementService.calculateCommission(
        grossAmount,
        "MERCHANT"
      );

      // Fee should be at least ₦100 fixed
      expect(result.settlementFee).toBeGreaterThanOrEqual(100);
    });
  });

  // ===========================================
  // SETTLEMENT CREATION TESTS
  // ===========================================

  describe("createSettlement", () => {
    const baseRequest = {
      recipientId: "restaurant-123",
      recipientType: "RESTAURANT" as const,
      periodStart: new Date("2024-01-01"),
      periodEnd: new Date("2024-01-07"),
      grossAmount: 100000,
      currency: Currency.NGN,
      payoutMethod: "bank_transfer" as const,
      bankDetails: {
        bankCode: "058",
        accountNumber: "0123456789",
        accountName: "Test Restaurant Ltd",
      },
    };

    it("should create settlement with correct commission deduction", async () => {
      (
        mockPrismaClient.$transaction as ReturnType<typeof vi.fn>
      ).mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const mockTx = {
            settlement: {
              create: vi.fn().mockResolvedValue({
                id: "settlement-123",
                recipientId: baseRequest.recipientId,
                recipientType: baseRequest.recipientType,
                grossAmount: "100000.0000",
                ubiCommission: "20000.0000",
                ceerionDeduction: "1000.0000",
                settlementFee: "600.0000",
                netAmount: "78400.0000",
                status: "pending",
              }),
            },
            ledgerEntry: {
              createMany: vi.fn().mockResolvedValue({ count: 4 }),
            },
          };
          return callback(mockTx);
        }
      );

      const result = await settlementService.createSettlement(baseRequest);

      expect(result).toBeDefined();
      expect(result.grossAmount).toBe("100000.0000");
      expect(result.netAmount).toBe("78400.0000");
      expect(result.status).toBe("pending");
    });

    it("should reject settlement below minimum amount", async () => {
      const smallRequest = {
        ...baseRequest,
        grossAmount: 500, // Below minimum
      };

      await expect(
        settlementService.createSettlement(smallRequest)
      ).rejects.toThrow("below minimum");
    });

    it("should validate bank details for bank transfer", async () => {
      const invalidRequest = {
        ...baseRequest,
        bankDetails: {
          bankCode: "", // Missing bank code
          accountNumber: "0123456789",
          accountName: "Test",
        },
      };

      await expect(
        settlementService.createSettlement(invalidRequest)
      ).rejects.toThrow("Bank code required");
    });

    it("should validate phone for mobile money payout", async () => {
      const mobileRequest = {
        ...baseRequest,
        payoutMethod: "mobile_money" as const,
        bankDetails: undefined,
        mobileDetails: {
          provider: PaymentProvider.MPESA,
          phone: "", // Missing phone
        },
      };

      await expect(
        settlementService.createSettlement(mobileRequest)
      ).rejects.toThrow("Phone number required");
    });
  });

  // ===========================================
  // SETTLEMENT PROCESSING TESTS
  // ===========================================

  describe("processSettlement", () => {
    it("should process bank transfer settlement", async () => {
      const mockSettlement = {
        id: "settlement-123",
        recipientType: "RESTAURANT",
        netAmount: "78400.0000",
        currency: Currency.NGN,
        status: "pending",
        payoutMethod: "bank_transfer",
        payoutDestination: {
          bankCode: "058",
          accountNumber: "0123456789",
          accountName: "Test Restaurant",
        },
      };

      (
        mockPrismaClient.settlement.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockSettlement);

      // Mock bank transfer initiation
      vi.spyOn(
        settlementService as any,
        "initiateBankTransfer"
      ).mockResolvedValue({
        success: true,
        reference: "PSTACK-TRF-123",
      });

      (
        mockPrismaClient.settlement.update as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ...mockSettlement,
        status: "processing",
        providerReference: "PSTACK-TRF-123",
      });

      const result =
        await settlementService.processSettlement("settlement-123");

      expect(result.status).toBe("processing");
      expect(result.providerReference).toBe("PSTACK-TRF-123");
    });

    it("should process mobile money settlement", async () => {
      const mockSettlement = {
        id: "settlement-124",
        recipientType: "DRIVER",
        netAmount: "20000.0000",
        currency: Currency.KES,
        status: "pending",
        payoutMethod: "mobile_money",
        payoutDestination: {
          provider: "MPESA",
          phone: "+254712345678",
        },
      };

      (
        mockPrismaClient.settlement.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockSettlement);

      vi.spyOn(
        settlementService as any,
        "initiateMobileMoneyPayout"
      ).mockResolvedValue({
        success: true,
        reference: "MPESA-B2C-123",
      });

      (
        mockPrismaClient.settlement.update as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ...mockSettlement,
        status: "processing",
        providerReference: "MPESA-B2C-123",
      });

      const result =
        await settlementService.processSettlement("settlement-124");

      expect(result.status).toBe("processing");
    });

    it("should handle payout failure", async () => {
      const mockSettlement = {
        id: "settlement-125",
        status: "pending",
        payoutMethod: "bank_transfer",
        payoutDestination: {
          bankCode: "999", // Invalid bank
          accountNumber: "0000000000",
        },
      };

      (
        mockPrismaClient.settlement.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockSettlement);

      vi.spyOn(
        settlementService as any,
        "initiateBankTransfer"
      ).mockRejectedValue(new Error("Invalid bank code"));

      (
        mockPrismaClient.settlement.update as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ...mockSettlement,
        status: "failed",
        failureReason: "Invalid bank code",
        retryCount: 1,
      });

      const result =
        await settlementService.processSettlement("settlement-125");

      expect(result.status).toBe("failed");
      expect(result.failureReason).toContain("Invalid bank");
    });

    it("should not process already completed settlement", async () => {
      (
        mockPrismaClient.settlement.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "settlement-126",
        status: "completed",
      });

      await expect(
        settlementService.processSettlement("settlement-126")
      ).rejects.toThrow("already completed");
    });
  });

  // ===========================================
  // BATCH SETTLEMENT TESTS
  // ===========================================

  describe("processSettlementBatch", () => {
    it("should process multiple settlements", async () => {
      const settlementIds = ["set-1", "set-2", "set-3"];

      vi.spyOn(settlementService, "processSettlement")
        .mockResolvedValueOnce({ id: "set-1", status: "processing" } as any)
        .mockResolvedValueOnce({ id: "set-2", status: "processing" } as any)
        .mockResolvedValueOnce({ id: "set-3", status: "failed" } as any);

      const result =
        await settlementService.processSettlementBatch(settlementIds);

      expect(result.total).toBe(3);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
    });

    it("should continue processing on individual failure", async () => {
      const settlementIds = ["set-1", "set-2", "set-3"];

      vi.spyOn(settlementService, "processSettlement")
        .mockResolvedValueOnce({ id: "set-1", status: "processing" } as any)
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({ id: "set-3", status: "processing" } as any);

      const result =
        await settlementService.processSettlementBatch(settlementIds);

      expect(result.total).toBe(3);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(1);
    });
  });

  // ===========================================
  // DAILY SETTLEMENT TESTS
  // ===========================================

  describe("runDailyRestaurantSettlements", () => {
    it("should create settlements for all restaurants with earnings", async () => {
      const mockRestaurants = [
        { id: "rest-1", userId: "user-1" },
        { id: "rest-2", userId: "user-2" },
      ];

      const mockEarnings = [
        { restaurantId: "rest-1", _sum: { total: 150000 } },
        { restaurantId: "rest-2", _sum: { total: 80000 } },
      ];

      (
        mockPrismaClient.restaurant.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockRestaurants);

      (
        mockPrismaClient.foodOrder.groupBy as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockEarnings);

      vi.spyOn(settlementService, "createSettlement")
        .mockResolvedValueOnce({ id: "set-1" } as any)
        .mockResolvedValueOnce({ id: "set-2" } as any);

      const result = await settlementService.runDailyRestaurantSettlements(
        new Date("2024-01-15"),
        Currency.NGN
      );

      expect(result.settlementsCreated).toBe(2);
      expect(settlementService.createSettlement).toHaveBeenCalledTimes(2);
    });

    it("should skip restaurants below minimum threshold", async () => {
      const mockRestaurants = [{ id: "rest-1", userId: "user-1" }];

      const mockEarnings = [
        { restaurantId: "rest-1", _sum: { total: 500 } }, // Below minimum
      ];

      (
        mockPrismaClient.restaurant.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockRestaurants);

      (
        mockPrismaClient.foodOrder.groupBy as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockEarnings);

      const result = await settlementService.runDailyRestaurantSettlements(
        new Date("2024-01-15"),
        Currency.NGN
      );

      expect(result.settlementsCreated).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  // ===========================================
  // LEDGER ENTRY TESTS
  // ===========================================

  describe("recordCommission", () => {
    it("should create correct ledger entries for UBI commission", async () => {
      const mockTx = {
        ledgerEntry: {
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        walletAccount: {
          update: vi.fn().mockResolvedValue({}),
        },
      };

      await settlementService.recordCommission(mockTx as any, {
        settlementId: "set-123",
        ubiCommission: 20000,
        ceerionDeduction: 1000,
        settlementFee: 600,
        currency: Currency.NGN,
      });

      expect(mockTx.ledgerEntry.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            type: "CREDIT",
            amount: expect.any(Object), // Decimal
          }),
        ]),
      });
    });
  });

  // ===========================================
  // RETRY TESTS
  // ===========================================

  describe("retrySettlement", () => {
    it("should retry failed settlement", async () => {
      const mockSettlement = {
        id: "set-failed",
        status: "failed",
        retryCount: 1,
      };

      (
        mockPrismaClient.settlement.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockSettlement);

      (
        mockPrismaClient.settlement.update as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ...mockSettlement,
        status: "pending",
        retryCount: 2,
      });

      vi.spyOn(settlementService, "processSettlement").mockResolvedValue({
        id: "set-failed",
        status: "processing",
      } as any);

      const result = await settlementService.retrySettlement("set-failed");

      expect(result.status).toBe("processing");
    });

    it("should reject retry for non-failed settlement", async () => {
      (
        mockPrismaClient.settlement.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "set-completed",
        status: "completed",
      });

      await expect(
        settlementService.retrySettlement("set-completed")
      ).rejects.toThrow("Cannot retry");
    });

    it("should reject retry if max retries exceeded", async () => {
      (
        mockPrismaClient.settlement.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "set-max-retry",
        status: "failed",
        retryCount: 3, // Max is usually 3
      });

      await expect(
        settlementService.retrySettlement("set-max-retry")
      ).rejects.toThrow("Maximum retries");
    });
  });

  // ===========================================
  // SUMMARY TESTS
  // ===========================================

  describe("getSettlementSummary", () => {
    it("should return correct summary statistics", async () => {
      (
        mockPrismaClient.settlement.aggregate as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        _sum: {
          grossAmount: 1000000,
          netAmount: 784000,
          ubiCommission: 200000,
          ceerionDeduction: 10000,
          settlementFee: 6000,
        },
        _count: { id: 50 },
      });

      (
        mockPrismaClient.settlement.groupBy as ReturnType<typeof vi.fn>
      ).mockResolvedValue([
        { status: "completed", _count: 45 },
        { status: "failed", _count: 5 },
      ]);

      const summary = await settlementService.getSettlementSummary({
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-01-31"),
        currency: Currency.NGN,
      });

      expect(summary.totalSettlements).toBe(50);
      expect(summary.totalGross).toBe(1000000);
      expect(summary.totalNet).toBe(784000);
      expect(summary.totalCommission).toBe(216000); // UBI + CEERION + Fee
      expect(summary.successRate).toBe(90); // 45/50
    });
  });
});
