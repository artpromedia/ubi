/**
 * Fraud Detection Service Unit Tests
 * UBI Payment Service
 *
 * Tests the REAL FraudDetectionService surface:
 *   assessRisk / getPendingReviews / approveTransaction / rejectTransaction
 *
 * assessRisk computes five weighted factors (velocity 40%, amount 25%,
 * geography 15%, device 10%, history 10%) through these Prisma calls, in
 * order:
 *   1. paymentTransaction.count      (last hour)
 *   2. paymentTransaction.count      (last day)
 *   3. paymentTransaction.aggregate  ({ _sum }) (last hour)
 *   4. paymentTransaction.aggregate  ({ _sum }) (last day)
 *   5. paymentTransaction.aggregate  ({ _avg, _max, _count }) (amount anomaly)
 *   6. paymentTransaction.findMany   (geo history — only when location given)
 *   7. paymentTransaction.findMany   (device history — only when device/IP given)
 *      riskAssessment.findFirst      (blacklist — only when device/IP is known)
 *   8. riskAssessment.count / dispute.count / user.findUnique (user history)
 *   9. riskAssessment.create + riskFactor.create x5 (only when
 *      paymentTransactionId ties the assessment to a payment)
 */

import { RiskAction, RiskLevel } from "@prisma/client";
import { beforeEach, describe, expect, it, type Mock } from "vitest";

import {
  FraudDetectionService,
  type RiskAssessmentResult,
} from "../../src/services/fraud-detection.service";
import { mockPrismaClient, resetMocks, testUser } from "../setup";

import type { ExtendedPrismaClient } from "../../src/lib/prisma";

const prismaMock = mockPrismaClient as unknown as {
  paymentTransaction: { count: Mock; aggregate: Mock; findMany: Mock };
  riskAssessment: {
    findFirst: Mock;
    findMany: Mock;
    create: Mock;
    update: Mock;
    count: Mock;
  };
  riskFactor: { create: Mock };
  dispute: { count: Mock };
  user: { findUnique: Mock };
};

function factor(result: RiskAssessmentResult, name: string) {
  return result.factors.find((f) => f.name === name);
}

/**
 * Mock the velocity queries (2 counts + 2 {_sum} aggregates) followed by the
 * amount-anomaly aggregate ({_avg,_max,_count}) — the shapes the real service
 * reads.
 */
function mockVelocityAndAmount(params: {
  hourCount: number;
  dayCount: number;
  hourAmount: number;
  dayAmount: number;
  avgAmount: number | null;
  maxAmount: number | null;
  completedCount: number;
}) {
  prismaMock.paymentTransaction.count
    .mockResolvedValueOnce(params.hourCount)
    .mockResolvedValueOnce(params.dayCount);
  prismaMock.paymentTransaction.aggregate
    .mockResolvedValueOnce({ _sum: { amount: params.hourAmount } })
    .mockResolvedValueOnce({ _sum: { amount: params.dayAmount } })
    .mockResolvedValueOnce({
      _avg: { amount: params.avgAmount },
      _max: { amount: params.maxAmount },
      _count: params.completedCount,
    });
}

/** Clean user history: no risky assessments, no disputes, old account. */
function mockCleanHistory(accountAgeDays = 90) {
  prismaMock.riskAssessment.count.mockResolvedValue(0);
  prismaMock.dispute.count.mockResolvedValue(0);
  prismaMock.user.findUnique.mockResolvedValue({
    id: testUser.id,
    createdAt: new Date(Date.now() - accountAgeDays * 24 * 60 * 60 * 1000),
  });
}

describe("FraudDetectionService", () => {
  let fraudService: FraudDetectionService;

  beforeEach(() => {
    resetMocks();
    fraudService = new FraudDetectionService(
      mockPrismaClient as unknown as ExtendedPrismaClient,
    );
  });

  // ===========================================
  // RISK ASSESSMENT — assessRisk
  // ===========================================

  describe("assessRisk", () => {
    const baseRequest = {
      userId: testUser.id,
      amount: 2000,
      currency: "KES",
      ipAddress: "41.89.0.1",
      deviceId: "device-123",
    };

    it("should return LOW risk / ALLOW for a normal transaction on a known device", async () => {
      // velocity: freq max(10, 4) * 0.5 + amount max(4, 2.5) * 0.5 = 7
      mockVelocityAndAmount({
        hourCount: 1,
        dayCount: 2,
        hourAmount: 2000,
        dayAmount: 5000,
        avgAmount: 2000, // request amount == average → no anomaly (10)
        maxAmount: 3000,
        completedCount: 25,
      });
      // device: known (has prior tx), not blacklisted → 10
      prismaMock.paymentTransaction.findMany.mockResolvedValue([
        { id: "ptx-1" },
      ]);
      prismaMock.riskAssessment.findFirst.mockResolvedValue(null);
      mockCleanHistory();

      const result = await fraudService.assessRisk(baseRequest);

      expect(factor(result, "velocity")?.score).toBe(7);
      expect(factor(result, "amount")?.score).toBe(10);
      expect(factor(result, "geography")?.score).toBe(0); // no location data
      expect(factor(result, "device")?.score).toBe(10);
      expect(factor(result, "history")?.score).toBe(5);

      // 7*0.4 + 10*0.25 + 0 + 10*0.1 + 5*0.1 = 6.8 → 7
      expect(result.riskScore).toBe(7);
      expect(result.riskLevel).toBe(RiskLevel.LOW);
      expect(result.action).toBe(RiskAction.ALLOW);
      expect(result.requiresReview).toBe(false);
      expect(result.requires3DS).toBe(false);
      expect(result.reasons).toEqual(["No specific risk factors identified"]);

      // No paymentTransactionId → the assessment is NOT persisted
      expect(prismaMock.riskAssessment.create).not.toHaveBeenCalled();
      expect(prismaMock.riskFactor.create).not.toHaveBeenCalled();
    });

    it("should return HIGH risk / REVIEW for a large amount from a new country, and persist when tied to a payment", async () => {
      // velocity: freq max(50, 40)*0.5 + amount max(60, 50)*0.5 = 55
      mockVelocityAndAmount({
        hourCount: 5,
        dayCount: 20,
        hourAmount: 30000,
        dayAmount: 100000,
        avgAmount: 2000, // 500000 is 249x deviation → 80
        maxAmount: 4000,
        completedCount: 25,
      });
      prismaMock.paymentTransaction.findMany
        // geo history: previous COMPLETED tx from a different country → 70
        .mockResolvedValueOnce([
          {
            metadata: {
              location: { country: "KE", lat: -1.286389, lng: 36.817223 },
            },
          },
        ])
        // device history: device known → blacklist check
        .mockResolvedValueOnce([{ id: "ptx-1" }]);
      prismaMock.riskAssessment.findFirst.mockResolvedValue(null); // not blacklisted → 10
      prismaMock.riskAssessment.count.mockResolvedValue(1); // 1 prior HIGH/CRITICAL assessment → 25
      prismaMock.riskAssessment.create.mockResolvedValue({
        id: "assessment-1",
      });
      prismaMock.riskFactor.create.mockResolvedValue({});

      const result = await fraudService.assessRisk({
        ...baseRequest,
        amount: 500000,
        paymentTransactionId: "ptx-500",
        location: { latitude: 6.5244, longitude: 3.3792, country: "NG" },
      });

      expect(factor(result, "velocity")?.score).toBe(55);
      expect(factor(result, "amount")?.score).toBe(80);
      expect(factor(result, "geography")?.score).toBe(70);
      expect(factor(result, "device")?.score).toBe(10);
      expect(factor(result, "history")?.score).toBe(25);

      // 55*0.4 + 80*0.25 + 70*0.15 + 10*0.1 + 25*0.1 = 56
      expect(result.riskScore).toBe(56);
      expect(result.riskLevel).toBe(RiskLevel.HIGH);
      expect(result.action).toBe(RiskAction.REVIEW);
      expect(result.requiresReview).toBe(true);
      expect(result.requires3DS).toBe(true);
      expect(result.reasons).toContain(
        "Transaction requires manual review before processing",
      );
      expect(result.reasons).toContain(
        "Transaction amount significantly higher than usual",
      );
      expect(result.reasons).toContain("Transaction from unusual location");

      // Tied to a payment → persisted with the real column names
      expect(prismaMock.riskAssessment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          paymentTransactionId: "ptx-500",
          userId: testUser.id,
          score: 56,
          level: RiskLevel.HIGH,
          action: RiskAction.REVIEW,
          deviceFingerprint: "device-123",
          ipAddress: "41.89.0.1",
        }),
      });
      expect(result.assessmentId).toBe("assessment-1");
      expect(prismaMock.riskFactor.create).toHaveBeenCalledTimes(5);
      expect(prismaMock.riskFactor.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          riskAssessmentId: "assessment-1",
          name: "velocity",
          score: 55,
        }),
      });
    });

    it("should BLOCK as CRITICAL on velocity abuse combined with other anomalies", async () => {
      // velocity: freq max(100, 100)*0.5 + amount max(100, 100)*0.5 = 100
      mockVelocityAndAmount({
        hourCount: 100,
        dayCount: 200,
        hourAmount: 500000,
        dayAmount: 1000000,
        avgAmount: 1000, // 50000 is 49x deviation → 80
        maxAmount: 2000,
        completedCount: 50,
      });
      prismaMock.paymentTransaction.findMany
        // geo history: different country → 70
        .mockResolvedValueOnce([
          {
            metadata: {
              location: { country: "KE", lat: -1.286389, lng: 36.817223 },
            },
          },
        ])
        // device history: never seen → new device → 50 (no blacklist lookup)
        .mockResolvedValueOnce([]);
      prismaMock.riskAssessment.count.mockResolvedValue(2); // → 50

      const result = await fraudService.assessRisk({
        ...baseRequest,
        amount: 50000,
        deviceId: "device-fresh",
        location: { latitude: 6.5244, longitude: 3.3792, country: "NG" },
      });

      expect(factor(result, "velocity")?.score).toBe(100);
      expect(factor(result, "device")?.score).toBe(50);
      // 100*0.4 + 80*0.25 + 70*0.15 + 50*0.1 + 50*0.1 ≈ 80.5
      expect(result.riskScore).toBeGreaterThan(75);
      expect(result.riskLevel).toBe(RiskLevel.CRITICAL);
      expect(result.action).toBe(RiskAction.BLOCK);
      expect(result.requiresReview).toBe(true);
      expect(result.reasons).toContain(
        "Transaction flagged as high risk - requires immediate review",
      );
    });

    it("should require 3DS for a MEDIUM-risk card payment (and ALLOW it)", async () => {
      // velocity: freq max(30, 20)*0.5 + amount max(20, 20)*0.5 = 25
      mockVelocityAndAmount({
        hourCount: 3,
        dayCount: 10,
        hourAmount: 10000,
        dayAmount: 40000,
        avgAmount: 2000, // 4000 = 2x average → 60
        maxAmount: 3000,
        completedCount: 10,
      });
      // device: never seen before → 50
      prismaMock.paymentTransaction.findMany.mockResolvedValue([]);
      mockCleanHistory(30);

      const result = await fraudService.assessRisk({
        ...baseRequest,
        amount: 4000,
        paymentMethod: "card",
      });

      expect(factor(result, "velocity")?.score).toBe(25);
      expect(factor(result, "amount")?.score).toBe(60);
      expect(factor(result, "device")?.score).toBe(50);
      // 25*0.4 + 60*0.25 + 0 + 50*0.1 + 5*0.1 ≈ 30.5 → MEDIUM
      expect(result.riskLevel).toBe(RiskLevel.MEDIUM);
      expect(result.action).toBe(RiskAction.ALLOW);
      expect(result.requires3DS).toBe(true); // card at MEDIUM risk forces 3DS
      expect(result.requiresReview).toBe(false);
    });

    it("should score a large first transaction from a brand-new user as an amount anomaly", async () => {
      mockVelocityAndAmount({
        hourCount: 0,
        dayCount: 0,
        hourAmount: 0,
        dayAmount: 0,
        avgAmount: null, // no completed history
        maxAmount: null,
        completedCount: 0,
      });
      prismaMock.riskAssessment.count.mockResolvedValue(0);
      prismaMock.dispute.count.mockResolvedValue(0);
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await fraudService.assessRisk({
        userId: testUser.id,
        amount: 5000, // above the 1000 high-amount threshold for new users
        currency: "KES",
        // no device/IP → device factor 30, no findMany calls
      });

      expect(factor(result, "velocity")?.score).toBe(0);
      expect(factor(result, "amount")?.score).toBe(75);
      expect(factor(result, "device")?.score).toBe(30); // missing device data is suspicious
      expect(prismaMock.paymentTransaction.findMany).not.toHaveBeenCalled();
      expect(result.riskLevel).toBe(RiskLevel.LOW); // 22 — amount is only 25% of the weight
      expect(result.action).toBe(RiskAction.ALLOW);
    });

    it("should max out the device factor when the device was used in a blocked assessment", async () => {
      mockVelocityAndAmount({
        hourCount: 0,
        dayCount: 0,
        hourAmount: 0,
        dayAmount: 0,
        avgAmount: 1000,
        maxAmount: 1000,
        completedCount: 5,
      });
      // device known for this user...
      prismaMock.paymentTransaction.findMany.mockResolvedValue([
        { id: "ptx-1" },
      ]);
      // ...but it appears on a BLOCK assessment (device blacklist) → 100
      prismaMock.riskAssessment.findFirst.mockResolvedValue({ id: "blk-1" });
      mockCleanHistory();

      const result = await fraudService.assessRisk({
        userId: testUser.id,
        amount: 1000,
        currency: "KES",
        deviceId: "device-burned",
      });

      expect(prismaMock.riskAssessment.findFirst).toHaveBeenCalledWith({
        where: {
          action: RiskAction.BLOCK,
          deviceFingerprint: "device-burned",
        },
      });
      expect(factor(result, "device")?.score).toBe(100);
      expect(result.reasons).toContain("New or suspicious device detected");
    });

    it("should raise the history factor for users with open disputes", async () => {
      mockVelocityAndAmount({
        hourCount: 0,
        dayCount: 0,
        hourAmount: 0,
        dayAmount: 0,
        avgAmount: 1000,
        maxAmount: 1000,
        completedCount: 5,
      });
      prismaMock.paymentTransaction.findMany.mockResolvedValue([
        { id: "ptx-1" },
      ]);
      prismaMock.riskAssessment.findFirst.mockResolvedValue(null);
      prismaMock.riskAssessment.count.mockResolvedValue(0);
      prismaMock.dispute.count.mockResolvedValue(2); // 2 unresolved disputes → 60

      const result = await fraudService.assessRisk({
        userId: testUser.id,
        amount: 1000,
        currency: "KES",
        deviceId: "device-123",
      });

      expect(prismaMock.dispute.count).toHaveBeenCalledWith({
        where: { userId: testUser.id, status: { not: "won" } },
      });
      expect(factor(result, "history")?.score).toBe(60);
      expect(result.reasons).toContain(
        "User has previous fraud flags or disputes",
      );
      // Disputes found → the account-age lookup is skipped
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });
  });

  // ===========================================
  // REVIEW QUEUE — getPendingReviews / approve / reject
  // ===========================================

  describe("review queue", () => {
    it("should list pending reviews mapped from the persisted assessment rows", async () => {
      const rows = [
        {
          id: "risk-1",
          userId: testUser.id,
          score: 88,
          level: RiskLevel.CRITICAL,
          action: RiskAction.BLOCK,
          factors: [{ name: "velocity", score: 100 }],
          createdAt: new Date("2026-01-01T00:00:00Z"),
          ipLocation: { country: "KE" },
          paymentTransaction: {
            user: { id: testUser.id, email: testUser.email },
          },
        },
        {
          id: "risk-2",
          userId: "user-456",
          score: 60,
          level: RiskLevel.HIGH,
          action: RiskAction.REVIEW,
          factors: [],
          createdAt: new Date("2026-01-02T00:00:00Z"),
          ipLocation: null,
          paymentTransaction: null,
        },
      ];
      prismaMock.riskAssessment.findMany.mockResolvedValue(rows);

      const reviews = await fraudService.getPendingReviews();

      expect(prismaMock.riskAssessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            action: { in: [RiskAction.REVIEW, RiskAction.BLOCK] },
            score: { gte: 50 },
            reviewedAt: null,
          },
          orderBy: { score: "desc" },
          take: 20,
          skip: 0,
        }),
      );
      expect(reviews).toHaveLength(2);
      expect(reviews[0]).toMatchObject({
        id: "risk-1",
        userId: testUser.id,
        riskScore: 88,
        riskLevel: RiskLevel.CRITICAL,
        action: RiskAction.BLOCK,
        user: { id: testUser.id, email: testUser.email },
      });
      expect(reviews[1].user).toBeUndefined(); // no linked payment → no user
    });

    it("should pass pagination and minimum-score options through to the query", async () => {
      prismaMock.riskAssessment.findMany.mockResolvedValue([]);

      await fraudService.getPendingReviews({
        limit: 5,
        offset: 10,
        minRiskScore: 80,
      });

      expect(prismaMock.riskAssessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ score: { gte: 80 } }),
          take: 5,
          skip: 10,
        }),
      );
    });

    it("should approve a transaction by setting ALLOW with review metadata", async () => {
      prismaMock.riskAssessment.update.mockResolvedValue({});

      await fraudService.approveTransaction("risk-1", "admin-123");

      expect(prismaMock.riskAssessment.update).toHaveBeenCalledWith({
        where: { id: "risk-1" },
        data: {
          action: RiskAction.ALLOW,
          reviewedAt: expect.any(Date),
          reviewedBy: "admin-123",
          reviewNotes: "Manually approved",
        },
      });
    });

    it("should reject a transaction by setting BLOCK with the given reason", async () => {
      prismaMock.riskAssessment.update.mockResolvedValue({});

      await fraudService.rejectTransaction(
        "risk-1",
        "admin-123",
        "Confirmed fraud",
      );

      expect(prismaMock.riskAssessment.update).toHaveBeenCalledWith({
        where: { id: "risk-1" },
        data: {
          action: RiskAction.BLOCK,
          reviewedAt: expect.any(Date),
          reviewedBy: "admin-123",
          reviewNotes: "Confirmed fraud",
        },
      });
    });
  });
});
