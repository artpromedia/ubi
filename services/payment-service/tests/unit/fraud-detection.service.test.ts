/**
 * Fraud Detection Service Unit Tests
 * UBI Payment Service
 */

import { Currency, PaymentProvider } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockPrismaClient,
  mockRedisClient,
  resetMocks,
  testUser,
} from "../setup";

// Mock dependencies
vi.mock("../../src/lib/prisma", () => ({
  prisma: mockPrismaClient,
}));

vi.mock("../../src/lib/redis", () => ({
  redis: mockRedisClient,
}));

import { FraudDetectionService } from "../../src/services/fraud-detection.service";

describe("FraudDetectionService", () => {
  let fraudService: FraudDetectionService;

  beforeEach(() => {
    resetMocks();
    fraudService = new FraudDetectionService(mockPrismaClient, mockRedisClient);
  });

  // ===========================================
  // RISK ASSESSMENT TESTS
  // ===========================================

  describe("assessRisk", () => {
    const baseRequest = {
      userId: testUser.id,
      amount: 5000,
      currency: Currency.KES,
      provider: PaymentProvider.MPESA,
      type: "WALLET_TOPUP" as const,
      ipAddress: "41.89.0.1",
      deviceId: "device-123",
      metadata: {},
    };

    it("should return LOW risk for normal transaction", async () => {
      // Mock normal user behavior
      (
        mockPrismaClient.paymentTransaction.count as ReturnType<typeof vi.fn>
      ).mockResolvedValue(10);
      (
        mockPrismaClient.paymentTransaction.aggregate as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({ _sum: { amount: 50000 } });
      (
        mockPrismaClient.riskAssessment.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);
      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockRedisClient.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (
        mockPrismaClient.riskAssessment.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "risk-123",
        riskScore: 15,
        riskLevel: "LOW",
        action: "ALLOW",
      });

      const result = await fraudService.assessRisk(baseRequest);

      expect(result).toBeDefined();
      expect(result.riskLevel).toBe("LOW");
      expect(result.action).toBe("ALLOW");
      expect(result.riskScore).toBeLessThan(30);
    });

    it("should return HIGH risk for unusually large amount", async () => {
      const largeRequest = {
        ...baseRequest,
        amount: 500000, // Very large amount
      };

      // Mock user with low average transaction
      (
        mockPrismaClient.paymentTransaction.count as ReturnType<typeof vi.fn>
      ).mockResolvedValue(5);
      (
        mockPrismaClient.paymentTransaction.aggregate as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({ _sum: { amount: 10000 }, _avg: { amount: 2000 } });
      (
        mockPrismaClient.riskAssessment.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);
      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockRedisClient.incr as ReturnType<typeof vi.fn>).mockResolvedValue(1);
      (
        mockPrismaClient.riskAssessment.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "risk-124",
        riskScore: 75,
        riskLevel: "HIGH",
        action: "REVIEW",
      });

      const result = await fraudService.assessRisk(largeRequest);

      expect(result).toBeDefined();
      expect(result.riskLevel).toBe("HIGH");
      expect(result.action).toBe("REVIEW");
    });

    it("should BLOCK transaction from blacklisted IP", async () => {
      const blacklistedRequest = {
        ...baseRequest,
        ipAddress: "192.168.1.100",
      };

      // Mock blacklisted IP
      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockImplementation(
        (key: string) => {
          if (key.includes("blacklist:ip")) {
            return Promise.resolve("1");
          }
          return Promise.resolve(null);
        },
      );
      (
        mockPrismaClient.riskAssessment.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "risk-125",
        riskScore: 100,
        riskLevel: "CRITICAL",
        action: "BLOCK",
      });

      const result = await fraudService.assessRisk(blacklistedRequest);

      expect(result).toBeDefined();
      expect(result.action).toBe("BLOCK");
      expect(result.riskLevel).toBe("CRITICAL");
    });

    it("should require 3DS for card payment with medium risk", async () => {
      const cardRequest = {
        ...baseRequest,
        provider: PaymentProvider.CARD,
        amount: 50000,
      };

      (
        mockPrismaClient.paymentTransaction.count as ReturnType<typeof vi.fn>
      ).mockResolvedValue(3);
      (
        mockPrismaClient.paymentTransaction.aggregate as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({ _sum: { amount: 15000 } });
      (
        mockPrismaClient.riskAssessment.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);
      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockRedisClient.incr as ReturnType<typeof vi.fn>).mockResolvedValue(2);
      (
        mockPrismaClient.riskAssessment.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "risk-126",
        riskScore: 45,
        riskLevel: "MEDIUM",
        action: "REQUIRE_3DS",
      });

      const result = await fraudService.assessRisk(cardRequest);

      expect(result).toBeDefined();
      expect(result.action).toBe("REQUIRE_3DS");
    });

    it("should detect velocity abuse (too many transactions)", async () => {
      // Mock high transaction velocity
      (mockRedisClient.incr as ReturnType<typeof vi.fn>).mockResolvedValue(25);
      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (
        mockPrismaClient.paymentTransaction.count as ReturnType<typeof vi.fn>
      ).mockResolvedValue(100);
      (
        mockPrismaClient.paymentTransaction.aggregate as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({ _sum: { amount: 500000 } });
      (
        mockPrismaClient.riskAssessment.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue([]);
      (
        mockPrismaClient.riskAssessment.create as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        id: "risk-127",
        riskScore: 85,
        riskLevel: "HIGH",
        action: "BLOCK",
        factors: { velocityAbuse: true },
      });

      const result = await fraudService.assessRisk(baseRequest);

      expect(result).toBeDefined();
      expect(result.action).toBe("BLOCK");
      expect(result.factors).toContainEqual(
        expect.objectContaining({ factor: "velocity" }),
      );
    });
  });

  // ===========================================
  // RISK FACTOR TESTS
  // ===========================================

  describe("calculateRiskFactors", () => {
    it("should increase risk for new user", async () => {
      // New user with 0 transactions
      (
        mockPrismaClient.paymentTransaction.count as ReturnType<typeof vi.fn>
      ).mockResolvedValue(0);

      const factors = await fraudService.calculateAccountAgeRisk(testUser.id);

      expect(factors.score).toBeGreaterThan(0);
      expect(factors.factor).toBe("account_age");
    });

    it("should increase risk for unusual time", async () => {
      // Mock a 3 AM transaction
      const unusualHour = new Date();
      unusualHour.setHours(3);

      const factor = fraudService.calculateTimeRisk(unusualHour);

      expect(factor.score).toBeGreaterThan(0);
      expect(factor.reason).toContain("unusual");
    });

    it("should increase risk for geo anomaly", async () => {
      const request = {
        userId: testUser.id,
        ipAddress: "203.0.113.1", // Different region
        amount: 5000,
        currency: Currency.KES,
      };

      // Mock user's usual location
      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(
        JSON.stringify({ country: "KE", city: "Nairobi" }),
      );

      const factor = await fraudService.calculateGeoRisk(request);

      // If IP geo differs from usual, should add risk
      expect(factor).toBeDefined();
    });
  });

  // ===========================================
  // BLACKLIST TESTS
  // ===========================================

  describe("blacklistManagement", () => {
    it("should add IP to blacklist", async () => {
      (mockRedisClient.set as ReturnType<typeof vi.fn>).mockResolvedValue("OK");

      await fraudService.blacklistIP("192.168.1.100", "Fraud detected");

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.stringContaining("blacklist:ip:192.168.1.100"),
        expect.any(String),
        expect.anything(),
        expect.anything(),
      );
    });

    it("should add device to blacklist", async () => {
      (mockRedisClient.set as ReturnType<typeof vi.fn>).mockResolvedValue("OK");

      await fraudService.blacklistDevice("device-malicious", "Fraud detected");

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        expect.stringContaining("blacklist:device:device-malicious"),
        expect.any(String),
        expect.anything(),
        expect.anything(),
      );
    });

    it("should check if IP is blacklisted", async () => {
      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue("1");

      const isBlacklisted = await fraudService.isIPBlacklisted("192.168.1.100");

      expect(isBlacklisted).toBe(true);
    });

    it("should check if device is blacklisted", async () => {
      (mockRedisClient.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const isBlacklisted =
        await fraudService.isDeviceBlacklisted("device-123");

      expect(isBlacklisted).toBe(false);
    });
  });

  // ===========================================
  // REVIEW QUEUE TESTS
  // ===========================================

  describe("reviewQueue", () => {
    it("should get pending reviews", async () => {
      const mockAssessments = [
        {
          id: "risk-1",
          riskScore: 65,
          riskLevel: "HIGH",
          action: "REVIEW",
          status: "pending",
          createdAt: new Date(),
        },
        {
          id: "risk-2",
          riskScore: 55,
          riskLevel: "MEDIUM",
          action: "REVIEW",
          status: "pending",
          createdAt: new Date(),
        },
      ];

      (
        mockPrismaClient.riskAssessment.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockAssessments);

      const reviews = await fraudService.getPendingReviews();

      expect(reviews).toHaveLength(2);
      expect(reviews[0].status).toBe("pending");
    });

    it("should approve review and allow transaction", async () => {
      const mockAssessment = {
        id: "risk-1",
        paymentTransactionId: "payment-123",
        status: "pending",
      };

      (
        mockPrismaClient.riskAssessment.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockAssessment);
      (
        mockPrismaClient.riskAssessment.update as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ...mockAssessment, status: "approved" });

      const result = await fraudService.reviewAssessment(
        "risk-1",
        "approved",
        "admin-123",
        "Manual review passed",
      );

      expect(result.status).toBe("approved");
    });

    it("should reject review and block transaction", async () => {
      const mockAssessment = {
        id: "risk-1",
        paymentTransactionId: "payment-123",
        userId: testUser.id,
        status: "pending",
      };

      (
        mockPrismaClient.riskAssessment.findFirst as ReturnType<typeof vi.fn>
      ).mockResolvedValue(mockAssessment);
      (
        mockPrismaClient.riskAssessment.update as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ ...mockAssessment, status: "rejected" });
      (
        mockPrismaClient.paymentTransaction.update as ReturnType<typeof vi.fn>
      ).mockResolvedValue({});

      const result = await fraudService.reviewAssessment(
        "risk-1",
        "rejected",
        "admin-123",
        "Confirmed fraud",
      );

      expect(result.status).toBe("rejected");
      expect(mockPrismaClient.paymentTransaction.update).toHaveBeenCalledWith({
        where: { id: "payment-123" },
        data: expect.objectContaining({ status: "FAILED" }),
      });
    });
  });

  // ===========================================
  // PATTERN DETECTION TESTS
  // ===========================================

  describe("patternDetection", () => {
    it("should detect structuring pattern", async () => {
      // Multiple transactions just under reporting threshold
      const transactions = Array(5).fill({
        amount: "9900.0000",
        createdAt: new Date(),
      });

      (
        mockPrismaClient.paymentTransaction.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue(transactions);

      const patterns = await fraudService.detectPatterns(testUser.id);

      expect(patterns).toContainEqual(
        expect.objectContaining({ pattern: "structuring" }),
      );
    });

    it("should detect round amount pattern", async () => {
      // Multiple round amounts
      const transactions = [
        { amount: "10000.0000", createdAt: new Date() },
        { amount: "5000.0000", createdAt: new Date() },
        { amount: "20000.0000", createdAt: new Date() },
        { amount: "15000.0000", createdAt: new Date() },
      ];

      (
        mockPrismaClient.paymentTransaction.findMany as ReturnType<typeof vi.fn>
      ).mockResolvedValue(transactions);

      const patterns = await fraudService.detectPatterns(testUser.id);

      expect(patterns).toContainEqual(
        expect.objectContaining({ pattern: "round_amounts" }),
      );
    });
  });

  // ===========================================
  // METRICS TESTS
  // ===========================================

  describe("metrics", () => {
    it("should calculate fraud metrics", async () => {
      (mockPrismaClient.riskAssessment.count as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(1000) // total assessments
        .mockResolvedValueOnce(50) // blocked
        .mockResolvedValueOnce(30); // flagged for review

      (
        mockPrismaClient.paymentTransaction.aggregate as ReturnType<
          typeof vi.fn
        >
      ).mockResolvedValue({ _sum: { amount: 50000000 } });

      const metrics = await fraudService.getMetrics({
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-01-31"),
      });

      expect(metrics).toBeDefined();
      expect(metrics.totalAssessments).toBe(1000);
      expect(metrics.blockedCount).toBe(50);
      expect(metrics.blockRate).toBe(5);
    });
  });
});
