/**
 * Reconciliation Service Unit Tests
 * UBI Payment Service
 */

import { Currency, PaymentProvider, PaymentStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrismaClient, mockRedisClient, resetMocks } from "../setup";

// Mock dependencies
vi.mock("../../src/lib/prisma", () => ({
  prisma: mockPrismaClient,
}));

vi.mock("../../src/lib/redis", () => ({
  redis: mockRedisClient,
}));

import { ReconciliationService } from "../../src/services/reconciliation.service";

describe("ReconciliationService", () => {
  let reconciliationService: ReconciliationService;

  beforeEach(() => {
    resetMocks();
    reconciliationService = new ReconciliationService(
      mockPrismaClient,
      mockRedisClient,
    );
  });

  // ===========================================
  // DAILY RECONCILIATION TESTS
  // ===========================================

  describe("runDailyReconciliation", () => {
    const testDate = new Date("2024-01-15");

    it("should complete reconciliation with no discrepancies", async () => {
      const ubiTransactions = [
        {
          id: "txn-1",
          providerReference: "PROV-001",
          amount: "1000.0000",
          status: PaymentStatus.COMPLETED,
        },
        {
          id: "txn-2",
          providerReference: "PROV-002",
          amount: "2000.0000",
          status: PaymentStatus.COMPLETED,
        },
      ];

      const providerTransactions = [
        { reference: "PROV-001", amount: 1000, status: "success" },
        { reference: "PROV-002", amount: 2000, status: "success" },
      ];

      // Mock UBI transactions
      (
        mockPrismaClient.paymentTransaction.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue(ubiTransactions);

      // Mock provider data fetch
      vi.spyOn(
        reconciliationService as any,
        "getProviderTransactions",
      ).mockResolvedValue(providerTransactions);

      // Mock report creation
      (
        mockPrismaClient.reconciliationReport.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "recon-123",
        date: testDate,
        provider: PaymentProvider.PAYSTACK,
        currency: Currency.NGN,
        totalInternal: 2,
        totalProvider: 2,
        matched: 2,
        discrepancies: 0,
        status: "completed",
      });

      const result = await reconciliationService.runDailyReconciliation(
        PaymentProvider.PAYSTACK,
        testDate,
        Currency.NGN,
      );

      expect(result).toBeDefined();
      expect(result.matched).toBe(2);
      expect(result.discrepancies).toBe(0);
      expect(result.status).toBe("completed");
    });

    it("should detect missing transaction in UBI", async () => {
      const ubiTransactions = [
        {
          id: "txn-1",
          providerReference: "PROV-001",
          amount: "1000.0000",
          status: PaymentStatus.COMPLETED,
        },
      ];

      const providerTransactions = [
        { reference: "PROV-001", amount: 1000, status: "success" },
        { reference: "PROV-002", amount: 2000, status: "success" }, // Missing in UBI
      ];

      (
        mockPrismaClient.paymentTransaction.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue(ubiTransactions);

      vi.spyOn(
        reconciliationService as any,
        "getProviderTransactions",
      ).mockResolvedValue(providerTransactions);

      (
        mockPrismaClient.reconciliationReport.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "recon-124",
        discrepancies: 1,
        unmatchedProvider: 1,
      });

      (
        mockPrismaClient.reconciliationDiscrepancy.create as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        id: "disc-1",
        type: "MISSING_IN_UBI",
        providerReference: "PROV-002",
      });

      const result = await reconciliationService.runDailyReconciliation(
        PaymentProvider.PAYSTACK,
        testDate,
        Currency.NGN,
      );

      expect(result.discrepancies).toBe(1);
      expect(
        mockPrismaClient.reconciliationDiscrepancy.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "MISSING_IN_UBI",
            providerReference: "PROV-002",
          }),
        }),
      );
    });

    it("should detect missing transaction in provider", async () => {
      const ubiTransactions = [
        {
          id: "txn-1",
          providerReference: "PROV-001",
          amount: "1000.0000",
          status: PaymentStatus.COMPLETED,
        },
        {
          id: "txn-2",
          providerReference: "PROV-002",
          amount: "2000.0000",
          status: PaymentStatus.COMPLETED, // Missing in provider
        },
      ];

      const providerTransactions = [
        { reference: "PROV-001", amount: 1000, status: "success" },
      ];

      (
        mockPrismaClient.paymentTransaction.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue(ubiTransactions);

      vi.spyOn(
        reconciliationService as any,
        "getProviderTransactions",
      ).mockResolvedValue(providerTransactions);

      (
        mockPrismaClient.reconciliationReport.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "recon-125",
        discrepancies: 1,
        unmatchedInternal: 1,
      });

      (
        mockPrismaClient.reconciliationDiscrepancy.create as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        id: "disc-2",
        type: "MISSING_IN_PROVIDER",
        transactionId: "txn-2",
      });

      const result = await reconciliationService.runDailyReconciliation(
        PaymentProvider.PAYSTACK,
        testDate,
        Currency.NGN,
      );

      expect(result.discrepancies).toBe(1);
      expect(
        mockPrismaClient.reconciliationDiscrepancy.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "MISSING_IN_PROVIDER",
          }),
        }),
      );
    });

    it("should detect amount mismatch", async () => {
      const ubiTransactions = [
        {
          id: "txn-1",
          providerReference: "PROV-001",
          amount: "1000.0000",
          status: PaymentStatus.COMPLETED,
        },
      ];

      const providerTransactions = [
        { reference: "PROV-001", amount: 1050, status: "success" }, // Different amount
      ];

      (
        mockPrismaClient.paymentTransaction.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue(ubiTransactions);

      vi.spyOn(
        reconciliationService as any,
        "getProviderTransactions",
      ).mockResolvedValue(providerTransactions);

      (
        mockPrismaClient.reconciliationReport.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "recon-126",
        discrepancies: 1,
      });

      (
        mockPrismaClient.reconciliationDiscrepancy.create as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        id: "disc-3",
        type: "AMOUNT_MISMATCH",
        ubiAmount: "1000.0000",
        providerAmount: "1050.0000",
        difference: "50.0000",
      });

      const result = await reconciliationService.runDailyReconciliation(
        PaymentProvider.PAYSTACK,
        testDate,
        Currency.NGN,
      );

      expect(result.discrepancies).toBe(1);
      expect(
        mockPrismaClient.reconciliationDiscrepancy.create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "AMOUNT_MISMATCH",
          }),
        }),
      );
    });
  });

  // ===========================================
  // DISCREPANCY SEVERITY TESTS
  // ===========================================

  describe("calculateDiscrepancySeverity", () => {
    it("should return LOW for small discrepancies", () => {
      const severity = reconciliationService.calculateSeverity(
        500,
        Currency.NGN,
      );
      expect(severity).toBe("LOW");
    });

    it("should return MEDIUM for moderate discrepancies", () => {
      const severity = reconciliationService.calculateSeverity(
        5000,
        Currency.NGN,
      );
      expect(severity).toBe("MEDIUM");
    });

    it("should return HIGH for large discrepancies", () => {
      const severity = reconciliationService.calculateSeverity(
        25000,
        Currency.NGN,
      );
      expect(severity).toBe("HIGH");
    });

    it("should return CRITICAL for very large discrepancies", () => {
      const severity = reconciliationService.calculateSeverity(
        100000,
        Currency.NGN,
      );
      expect(severity).toBe("CRITICAL");
    });
  });

  // ===========================================
  // DISCREPANCY RESOLUTION TESTS
  // ===========================================

  describe("resolveDiscrepancy", () => {
    it("should resolve discrepancy with notes", async () => {
      const mockDiscrepancy = {
        id: "disc-1",
        status: "pending",
        reconciliationReportId: "recon-1",
      };

      (
        mockPrismaClient.reconciliationDiscrepancy.findFirst as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(mockDiscrepancy);

      (
        mockPrismaClient.reconciliationDiscrepancy.update as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        ...mockDiscrepancy,
        status: "resolved",
        resolution: "Manual adjustment made",
        resolvedAt: new Date(),
        resolvedBy: "admin-123",
      });

      const result = await reconciliationService.resolveDiscrepancy(
        "disc-1",
        "Manual adjustment made",
        "admin-123",
      );

      expect(result.status).toBe("resolved");
      expect(result.resolution).toBe("Manual adjustment made");
    });

    it("should throw error for non-existent discrepancy", async () => {
      (
        mockPrismaClient.reconciliationDiscrepancy.findFirst as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(null);

      await expect(
        reconciliationService.resolveDiscrepancy(
          "invalid-id",
          "Notes",
          "admin",
        ),
      ).rejects.toThrow("Discrepancy not found");
    });

    it("should throw error for already resolved discrepancy", async () => {
      (
        mockPrismaClient.reconciliationDiscrepancy.findFirst as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        id: "disc-1",
        status: "resolved",
      });

      await expect(
        reconciliationService.resolveDiscrepancy("disc-1", "Notes", "admin"),
      ).rejects.toThrow("already resolved");
    });
  });

  // ===========================================
  // BALANCE RECONCILIATION TESTS
  // ===========================================

  describe("runBalanceReconciliation", () => {
    it("should record matching balances", async () => {
      // Mock UBI balance
      (
        mockPrismaClient.walletAccount.aggregate as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ _sum: { balance: 1000000 } });

      // Mock provider balance
      vi.spyOn(
        reconciliationService as any,
        "getProviderBalance",
      ).mockResolvedValue(1000000);

      (
        mockPrismaClient.balanceReconciliation.create as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        id: "bal-recon-1",
        ubiBalance: "1000000.0000",
        providerBalance: "1000000.0000",
        difference: "0.0000",
        status: "matched",
      });

      const result = await reconciliationService.runBalanceReconciliation(
        PaymentProvider.PAYSTACK,
        new Date(),
        Currency.NGN,
      );

      expect(result.status).toBe("matched");
      expect(Number.parseFloat(result.difference)).toBe(0);
    });

    it("should flag significant balance discrepancy", async () => {
      (
        mockPrismaClient.walletAccount.aggregate as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ _sum: { balance: 1000000 } });

      vi.spyOn(
        reconciliationService as any,
        "getProviderBalance",
      ).mockResolvedValue(950000); // 5% difference

      (
        mockPrismaClient.balanceReconciliation.create as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        id: "bal-recon-2",
        ubiBalance: "1000000.0000",
        providerBalance: "950000.0000",
        difference: "50000.0000",
        percentageDiff: 5,
        status: "discrepancy",
      });

      (
        mockPrismaClient.alert.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({});

      const result = await reconciliationService.runBalanceReconciliation(
        PaymentProvider.PAYSTACK,
        new Date(),
        Currency.NGN,
      );

      expect(result.status).toBe("discrepancy");
      expect(mockPrismaClient.alert.create).toHaveBeenCalled();
    });
  });

  // ===========================================
  // AUTO-RESOLUTION TESTS
  // ===========================================

  describe("autoResolveSmallDiscrepancies", () => {
    it("should auto-resolve discrepancies below threshold", async () => {
      const smallDiscrepancies = [
        { id: "disc-1", difference: "50.0000", currency: Currency.NGN },
        { id: "disc-2", difference: "80.0000", currency: Currency.NGN },
      ];

      (
        mockPrismaClient.reconciliationDiscrepancy.findMany as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(smallDiscrepancies);

      (
        mockPrismaClient.reconciliationDiscrepancy.updateMany as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({ count: 2 });

      const result =
        await reconciliationService.autoResolveSmallDiscrepancies();

      expect(result.resolved).toBe(2);
    });

    it("should not auto-resolve discrepancies above threshold", async () => {
      const largeDiscrepancy = [
        { id: "disc-1", difference: "500.0000", currency: Currency.NGN },
      ];

      (
        mockPrismaClient.reconciliationDiscrepancy.findMany as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(largeDiscrepancy);

      (
        mockPrismaClient.reconciliationDiscrepancy.updateMany as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({ count: 0 });

      const result =
        await reconciliationService.autoResolveSmallDiscrepancies();

      expect(result.resolved).toBe(0);
    });
  });

  // ===========================================
  // REPORTING TESTS
  // ===========================================

  describe("getReconciliationSummary", () => {
    it("should return summary for date range", async () => {
      const mockReports = [
        {
          id: "recon-1",
          date: new Date("2024-01-15"),
          totalInternal: 100,
          totalProvider: 100,
          matched: 98,
          discrepancies: 2,
        },
        {
          id: "recon-2",
          date: new Date("2024-01-16"),
          totalInternal: 150,
          totalProvider: 150,
          matched: 148,
          discrepancies: 2,
        },
      ];

      (
        mockPrismaClient.reconciliationReport.findMany as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(mockReports);

      const summary = await reconciliationService.getReconciliationSummary({
        startDate: new Date("2024-01-15"),
        endDate: new Date("2024-01-16"),
        provider: PaymentProvider.PAYSTACK,
      });

      expect(summary.totalReports).toBe(2);
      expect(summary.totalTransactions).toBe(250);
      expect(summary.totalDiscrepancies).toBe(4);
      expect(summary.matchRate).toBeCloseTo(98.4, 1);
    });
  });

  describe("getPendingDiscrepancies", () => {
    it("should return paginated pending discrepancies", async () => {
      const mockDiscrepancies = new Array(10).fill({
        id: "disc-x",
        type: "AMOUNT_MISMATCH",
        status: "pending",
        createdAt: new Date(),
      });

      (
        mockPrismaClient.reconciliationDiscrepancy.findMany as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(mockDiscrepancies);

      (
        mockPrismaClient.reconciliationDiscrepancy.count as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(25);

      const result = await reconciliationService.getPendingDiscrepancies({
        page: 1,
        pageSize: 10,
      });

      expect(result.items).toHaveLength(10);
      expect(result.total).toBe(25);
      expect(result.pages).toBe(3);
    });

    it("should filter by severity", async () => {
      (
        mockPrismaClient.reconciliationDiscrepancy.findMany as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue([
        { id: "disc-1", severity: "HIGH" },
        { id: "disc-2", severity: "HIGH" },
      ]);

      (
        mockPrismaClient.reconciliationDiscrepancy.count as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue(2);

      const result = await reconciliationService.getPendingDiscrepancies({
        severity: "HIGH",
        page: 1,
        pageSize: 10,
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].severity).toBe("HIGH");
    });
  });

  // ===========================================
  // NEW PROVIDER BALANCE TESTS (Sprint 2)
  // ===========================================

  describe("getProviderBalance - New Providers", () => {
    it("should fetch Telebirr balance successfully", async () => {
      vi.spyOn(
        reconciliationService as any,
        "getTelebirrBalance",
      ).mockResolvedValue(500000);

      (
        mockPrismaClient.providerBalance.upsert as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        provider: PaymentProvider.TELEBIRR,
        currency: Currency.ETB,
        balance: 500000,
      });

      const balance = await (reconciliationService as any).getProviderBalance(
        PaymentProvider.TELEBIRR,
        Currency.ETB,
      );

      expect(balance).toBe(500000);
    });

    it("should fetch Orange Money CI balance successfully", async () => {
      vi.spyOn(
        reconciliationService as any,
        "getOrangeMoneyBalance",
      ).mockResolvedValue(1000000);

      (
        mockPrismaClient.providerBalance.upsert as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        provider: PaymentProvider.ORANGE_MONEY_CI,
        currency: Currency.XOF,
        balance: 1000000,
      });

      const balance = await (reconciliationService as any).getProviderBalance(
        PaymentProvider.ORANGE_MONEY_CI,
        Currency.XOF,
      );

      expect(balance).toBe(1000000);
    });

    it("should fetch Orange Money SN balance successfully", async () => {
      vi.spyOn(
        reconciliationService as any,
        "getOrangeMoneyBalance",
      ).mockResolvedValue(750000);

      const balance = await (reconciliationService as any).getProviderBalance(
        PaymentProvider.ORANGE_MONEY_SN,
        Currency.XOF,
      );

      expect(balance).toBe(750000);
    });

    it("should fetch Orange Money CM balance successfully", async () => {
      vi.spyOn(
        reconciliationService as any,
        "getOrangeMoneyBalance",
      ).mockResolvedValue(250000);

      const balance = await (reconciliationService as any).getProviderBalance(
        PaymentProvider.ORANGE_MONEY_CM,
        Currency.XOF,
      );

      expect(balance).toBe(250000);
    });

    it("should fetch Orange Money ML balance successfully", async () => {
      vi.spyOn(
        reconciliationService as any,
        "getOrangeMoneyBalance",
      ).mockResolvedValue(300000);

      const balance = await (reconciliationService as any).getProviderBalance(
        PaymentProvider.ORANGE_MONEY_ML,
        Currency.XOF,
      );

      expect(balance).toBe(300000);
    });
  });

  describe("runBalanceReconciliation - New Providers", () => {
    it("should reconcile Telebirr balance with no discrepancy", async () => {
      (
        mockPrismaClient.walletAccount.aggregate as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ _sum: { balance: 500000 } });

      vi.spyOn(
        reconciliationService as any,
        "getProviderBalance",
      ).mockResolvedValue(500000);

      (
        mockPrismaClient.balanceReconciliation.create as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        id: "bal-recon-telebirr",
        ubiBalance: "500000.0000",
        providerBalance: "500000.0000",
        difference: "0.0000",
        status: "matched",
      });

      const result = await reconciliationService.runBalanceReconciliation(
        PaymentProvider.TELEBIRR,
        new Date(),
        Currency.ETB,
      );

      expect(result.status).toBe("matched");
    });

    it("should detect Orange Money balance discrepancy", async () => {
      (
        mockPrismaClient.walletAccount.aggregate as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ _sum: { balance: 1000000 } });

      vi.spyOn(
        reconciliationService as any,
        "getProviderBalance",
      ).mockResolvedValue(900000); // 10% difference

      (
        mockPrismaClient.balanceReconciliation.create as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({
        id: "bal-recon-orange",
        ubiBalance: "1000000.0000",
        providerBalance: "900000.0000",
        difference: "100000.0000",
        percentageDiff: 10,
        status: "discrepancy",
      });

      (
        mockPrismaClient.alert.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({});

      const result = await reconciliationService.runBalanceReconciliation(
        PaymentProvider.ORANGE_MONEY_CI,
        new Date(),
        Currency.XOF,
      );

      expect(result.status).toBe("discrepancy");
      expect(mockPrismaClient.alert.create).toHaveBeenCalled();
    });
  });
});
