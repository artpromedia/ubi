/**
 * Loan Management Service
 * Micro-lending with automated underwriting and repayment
 */

import type { Currency } from "@prisma/client";
import { nanoid } from "nanoid";
import { loanLogger } from "../lib/logger";
import {
  notificationClient,
  NotificationPriority,
  NotificationType,
} from "../lib/notification-client";
import { prisma } from "../lib/prisma";
import type {
  Loan,
  LoanApplication,
  LoanProduct,
  LoanProductType,
  LoanQuote,
  LoanRepaymentParams,
  LoanScheduleItem,
  LoanStatus,
} from "../types/fintech.types";
import { creditScoringService } from "./credit-scoring.service";
import { enhancedWalletService } from "./enhanced-wallet.service";

// Define LoanRepaymentResult locally as it's not in fintech.types
export interface LoanRepaymentResult {
  repaymentId: string;
  amountPaid: number;
  lateFee: number;
  totalPaid: number;
  newOutstanding: number;
  status: LoanStatus;
}

// ===========================================
// CONSTANTS
// ===========================================

const LATE_PAYMENT_PENALTY_RATE = 0.05; // 5% of amount due
const GRACE_PERIOD_DAYS = 3; // Days before late fees apply

// ===========================================
// LOAN SERVICE
// ===========================================

export class LoanService {
  /**
   * Get available loan products
   */
  async getLoanProducts(currency: Currency): Promise<LoanProduct[]> {
    const products = await prisma.loanProduct.findMany({
      where: {
        currency,
        isActive: true,
      },
      orderBy: { maxAmount: "asc" },
    });

    return products.map(
      (p: {
        id: string;
        name: string;
        type: string;
        minAmount: unknown;
        maxAmount: unknown;
        minTenureMonths: number;
        maxTenureMonths: number;
        interestRate: unknown;
        processingFeeRate: unknown;
        minCreditScore: number;
        currency: string;
        description: string | null;
        features: unknown;
      }) => ({
        id: p.id,
        code: p.id,
        name: p.name,
        type: p.type as LoanProductType,
        minAmount: Number(p.minAmount),
        maxAmount: Number(p.maxAmount),
        minTermDays: p.minTenureMonths * 30,
        maxTermDays: p.maxTenureMonths * 30,
        baseInterestRate: Number(p.interestRate),
        originationFeeRate: Number(p.processingFeeRate),
        lateFeeRate: LATE_PAYMENT_PENALTY_RATE,
        requiredCreditGrade: ["A", "B", "C"],
        autoDebitEnabled: true,
        description: p.description || undefined,
      }),
    );
  }

  /**
   * Get loan quote
   */
  async getLoanQuote(params: {
    productId: string;
    amount: number;
    tenureMonths: number;
    userId: string;
  }): Promise<LoanQuote> {
    const { productId, amount, tenureMonths, userId } = params;

    // Get product
    const product = await prisma.loanProduct.findUnique({
      where: { id: productId },
    });

    if (!product || !product.isActive) {
      throw new Error("Loan product not found");
    }

    // Validate amount
    if (
      amount < Number(product.minAmount) ||
      amount > Number(product.maxAmount)
    ) {
      throw new Error(
        `Amount must be between ${product.minAmount} and ${product.maxAmount}`,
      );
    }

    // Validate tenure
    if (
      tenureMonths < product.minTenureMonths ||
      tenureMonths > product.maxTenureMonths
    ) {
      throw new Error(
        `Tenure must be between ${product.minTenureMonths} and ${product.maxTenureMonths} months`,
      );
    }

    // Check eligibility
    const eligibility = await creditScoringService.checkLoanEligibility(userId);
    if (!eligibility.eligible) {
      throw new Error(eligibility.reasons.join(". "));
    }

    if (eligibility.score < product.minCreditScore) {
      throw new Error(
        `Minimum credit score of ${product.minCreditScore} required`,
      );
    }

    // Calculate loan details
    const interestRate = Number(product.interestRate);
    const processingFee = amount * Number(product.processingFeeRate);
    const totalInterest = this.calculateTotalInterest(
      amount,
      interestRate,
      tenureMonths,
    );
    const totalAmount = amount + totalInterest;
    const monthlyPayment = totalAmount / tenureMonths;

    // Generate schedule
    const schedule = this.generateRepaymentSchedule(
      amount,
      interestRate,
      tenureMonths,
      new Date(),
    );

    return {
      productId,
      principalAmount: amount,
      interestRate,
      originationFee: processingFee,
      totalInterest,
      totalAmount,
      disbursedAmount: amount - processingFee,
      termDays: tenureMonths * 30,
      monthlyPayment: Math.ceil(monthlyPayment),
      dueDate: new Date(Date.now() + tenureMonths * 30 * 24 * 60 * 60 * 1000),
      schedule,
    };
  }

  /**
   * Apply for a loan
   */
  async applyForLoan(
    params: LoanApplication & { userId: string; pin?: string },
  ): Promise<Loan> {
    const { userId, walletId, productId, amount, termDays, purpose, pin } =
      params;

    // Verify PIN if provided
    if (pin) {
      const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
      if (!pinValid) {
        throw new Error("Invalid PIN");
      }
    }

    // Check for existing active loans
    const existingLoan = await prisma.loan.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "OVERDUE"] },
      },
    });

    if (existingLoan) {
      throw new Error(
        "You already have an active loan. Please repay it first.",
      );
    }

    // Get quote (validates eligibility)
    const tenureMonths = Math.ceil(termDays / 30);
    const quote = await this.getLoanQuote({
      productId,
      amount,
      tenureMonths,
      userId,
    });

    const loanId = `loan_${nanoid(16)}`;

    // Create loan in pending state
    await prisma.loan.create({
      data: {
        id: loanId,
        userId,
        walletId,
        productId,
        principalAmount: amount,
        interestRate: quote.interestRate,
        tenureMonths,
        processingFee: quote.originationFee,
        totalInterest: quote.totalInterest,
        totalAmount: quote.totalAmount,
        monthlyPayment: quote.monthlyPayment,
        outstandingAmount: quote.totalAmount,
        purpose,
        status: "PENDING",
        applicationDate: new Date(),
      },
    });

    // Auto-approve (in production, may have manual review)
    const approved = await this.autoApprove(loanId);

    if (approved) {
      // Disburse loan
      await this.disburseLoan(loanId);

      // Create repayment schedule
      await this.createRepaymentSchedule(loanId, quote.schedule);
    }

    // Fetch updated loan
    const updatedLoan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: { schedule: true },
    });

    return this.formatLoan(updatedLoan!);
  }

  /**
   * Get user's loans
   */
  async getLoans(
    userId: string,
    options: { status?: LoanStatus; limit?: number; offset?: number } = {},
  ): Promise<{ loans: Loan[]; total: number }> {
    const { status, limit = 20, offset = 0 } = options;

    const where: Record<string, unknown> = { userId };
    if (status) where.status = status;

    const [loans, total] = await Promise.all([
      prisma.loan.findMany({
        where,
        include: { schedule: true },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.loan.count({ where }),
    ]);

    return {
      loans: loans.map(
        (l: {
          id: string;
          userId: string;
          walletId: string;
          productId: string;
          principalAmount: unknown;
          interestRate: unknown;
          tenureMonths: number;
          processingFee: unknown;
          totalInterest: unknown;
          totalAmount: unknown;
          monthlyPayment: unknown;
          outstandingAmount: unknown;
          totalRepaid: unknown;
          purpose: string | null;
          status: string;
          currency: string;
          applicationDate: Date | null;
          approvedDate: Date | null;
          disbursementDate: Date | null;
          firstPaymentDate: Date | null;
          paidOffDate: Date | null;
          schedule: Array<{
            installmentNumber: number;
            dueDate: Date;
            principalAmount: unknown;
            interestAmount: unknown;
            amountDue: unknown;
            amountPaid: unknown;
            status: string;
          }>;
        }) => this.formatLoan(l),
      ),
      total,
    };
  }

  /**
   * Get loan by ID
   */
  async getLoan(loanId: string): Promise<Loan | null> {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: { schedule: true },
    });

    if (!loan) return null;

    return this.formatLoan(loan);
  }

  /**
   * Make loan repayment
   */
  async makeRepayment(
    params: LoanRepaymentParams & { pin?: string; payOffRemaining?: boolean },
  ): Promise<LoanRepaymentResult> {
    const {
      loanId,
      amount,
      source: _source,
      walletId,
      pin,
      payOffRemaining = false,
    } = params;

    // Verify PIN if provided and manual payment
    if (pin && walletId) {
      const pinValid = await enhancedWalletService.verifyPin(walletId, pin);
      if (!pinValid) {
        throw new Error("Invalid PIN");
      }
    }

    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        schedule: { where: { status: "PENDING" }, orderBy: { dueDate: "asc" } },
      },
    });

    if (!loan) {
      throw new Error("Loan not found");
    }

    // Use loan's walletId if not provided
    const effectiveWalletId = walletId || loan.walletId;

    if (loan.walletId !== effectiveWalletId) {
      throw new Error("Not authorized to repay this loan");
    }

    if (loan.status === "PAID" || loan.status === "WRITTEN_OFF") {
      throw new Error(`Loan is ${loan.status.toLowerCase()}`);
    }

    // Calculate payment amount
    const outstanding = Number(loan.outstandingAmount);
    const paymentAmount = payOffRemaining
      ? outstanding
      : Math.min(amount, outstanding);

    // Check wallet balance
    const wallet = await enhancedWalletService.getWalletById(effectiveWalletId);
    if (!wallet) {
      throw new Error("Wallet not found");
    }

    const balance = await enhancedWalletService.getBalance(
      effectiveWalletId,
      loan.currency,
    );
    if (balance.available < paymentAmount) {
      throw new Error("Insufficient balance");
    }

    const repaymentId = `rep_${nanoid(16)}`;
    const now = new Date();

    // Calculate late fee if applicable
    let lateFee = 0;
    const pendingSchedules = loan.schedule;
    if (pendingSchedules.length > 0) {
      const oldestDue = pendingSchedules[0];
      const gracePeriodEnd = new Date(oldestDue.dueDate);
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

      if (now > gracePeriodEnd) {
        lateFee = Math.round(
          Number(oldestDue.amountDue) * LATE_PAYMENT_PENALTY_RATE,
        );
      }
    }

    const totalPayment = paymentAmount + lateFee;

    // Process repayment
    await prisma.$transaction(async (tx) => {
      // Debit wallet
      await enhancedWalletService.debit({
        walletId: effectiveWalletId,
        amount: totalPayment,
        currency: loan.currency,
        description: `Loan repayment - ${loanId}`,
        reference: repaymentId,
      });

      // Create repayment record
      await tx.loanRepayment.create({
        data: {
          id: repaymentId,
          loanId,
          amount: paymentAmount,
          lateFee,
          totalPaid: totalPayment,
          paymentMethod: "WALLET",
        },
      });

      // Update loan outstanding
      const newOutstanding = outstanding - paymentAmount;
      const newStatus: LoanStatus =
        newOutstanding <= 0 ? "PAID" : (loan.status as LoanStatus);

      await tx.loan.update({
        where: { id: loanId },
        data: {
          outstandingAmount: Math.max(0, newOutstanding),
          totalRepaid: { increment: paymentAmount },
          status: newStatus,
          ...(newStatus === "PAID" ? { paidOffDate: now } : {}),
        },
      });

      // Update schedule items
      let remainingPayment = paymentAmount;
      for (const scheduleItem of pendingSchedules) {
        if (remainingPayment <= 0) break;

        const amountDue = Number(scheduleItem.amountDue);
        const amountPaid = Number(scheduleItem.amountPaid);
        const remaining = amountDue - amountPaid;

        if (remaining <= 0) continue;

        const payForThis = Math.min(remainingPayment, remaining);
        const newPaid = amountPaid + payForThis;
        const isFullyPaid = newPaid >= amountDue;

        await tx.loanSchedule.update({
          where: { id: scheduleItem.id },
          data: {
            amountPaid: newPaid,
            status: isFullyPaid ? "PAID" : "PARTIAL",
            paidDate: isFullyPaid ? now : null,
          },
        });

        remainingPayment -= payForThis;
      }
    });

    const newOutstanding = Math.max(0, outstanding - paymentAmount);

    return {
      repaymentId,
      amountPaid: paymentAmount,
      lateFee,
      totalPaid: totalPayment,
      newOutstanding,
      status: newOutstanding <= 0 ? "PAID" : "ACTIVE",
    };
  }

  /**
   * Get repayment history
   */
  async getRepaymentHistory(loanId: string): Promise<
    Array<{
      id: string;
      amount: number;
      lateFee: number;
      totalPaid: number;
      paidAt: Date;
    }>
  > {
    const repayments = await prisma.loanRepayment.findMany({
      where: { loanId },
      orderBy: { createdAt: "desc" },
    });

    return repayments.map(
      (r: {
        id: string;
        amount: unknown;
        lateFee: unknown;
        totalPaid: unknown;
        createdAt: Date;
      }) => ({
        id: r.id,
        amount: Number(r.amount),
        lateFee: Number(r.lateFee),
        totalPaid: Number(r.totalPaid),
        paidAt: r.createdAt,
      }),
    );
  }

  /**
   * Get next payment due
   */
  async getNextPaymentDue(userId: string): Promise<{
    loanId: string;
    dueDate: Date;
    amountDue: number;
    isOverdue: boolean;
  } | null> {
    const loan = await prisma.loan.findFirst({
      where: {
        userId,
        status: { in: ["ACTIVE", "OVERDUE"] },
      },
      include: {
        schedule: {
          where: { status: { in: ["PENDING", "PARTIAL"] } },
          orderBy: { dueDate: "asc" },
          take: 1,
        },
      },
    });

    if (!loan || loan.schedule.length === 0) {
      return null;
    }

    const nextSchedule = loan.schedule[0];
    const now = new Date();

    return {
      loanId: loan.id,
      dueDate: nextSchedule.dueDate,
      amountDue:
        Number(nextSchedule.amountDue) - Number(nextSchedule.amountPaid),
      isOverdue: nextSchedule.dueDate < now,
    };
  }

  // ===========================================
  // SCHEDULED JOBS
  // ===========================================

  /**
   * Check for overdue loans
   */
  async checkOverdueLoans(): Promise<{ updated: number }> {
    const now = new Date();

    // Find active loans with overdue payments
    const overdueSchedules = await prisma.loanSchedule.findMany({
      where: {
        status: "PENDING",
        dueDate: { lt: now },
        loan: { status: "ACTIVE" },
      },
      select: { loanId: true },
      distinct: ["loanId"],
    });

    const loanIds = overdueSchedules.map((s: { loanId: string }) => s.loanId);

    if (loanIds.length === 0) {
      return { updated: 0 };
    }

    await prisma.loan.updateMany({
      where: { id: { in: loanIds } },
      data: { status: "OVERDUE" },
    });

    // TODO: Send overdue notifications
    for (const loanId of loanIds) {
      await this.sendOverdueNotification(loanId);
    }

    return { updated: loanIds.length };
  }

  /**
   * Process auto-debit for due payments
   */
  async processAutoDebit(): Promise<{ processed: number; failed: number }> {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find schedules due today or earlier
    const dueSchedules = await prisma.loanSchedule.findMany({
      where: {
        status: { in: ["PENDING", "PARTIAL"] },
        dueDate: { lte: tomorrow },
        loan: {
          status: { in: ["ACTIVE", "OVERDUE"] },
          autoDebitEnabled: true,
        },
      },
      include: { loan: true },
    });

    let processed = 0;
    let failed = 0;

    for (const schedule of dueSchedules) {
      const amountDue =
        Number(schedule.amountDue) - Number(schedule.amountPaid);

      try {
        // Check balance
        const balance = await enhancedWalletService.getBalance(
          schedule.loan.walletId,
          schedule.loan.currency,
        );

        if (balance.available >= amountDue) {
          // Process auto-debit (no PIN for automated payments)
          await this.processAutoDebitPayment(
            schedule.loan.id,
            schedule.loan.walletId,
            amountDue,
            schedule.loan.currency,
          );
          processed++;
        } else {
          failed++;
        }
      } catch (error) {
        loanLogger.error(
          { err: error, loanId: schedule.loanId },
          "Auto-debit failed for loan",
        );
        failed++;
      }
    }

    return { processed, failed };
  }

  // ===========================================
  // PRIVATE HELPERS
  // ===========================================

  private calculateTotalInterest(
    principal: number,
    annualRate: number,
    tenureMonths: number,
  ): number {
    // Simple interest calculation
    const monthlyRate = annualRate / 12;
    return Math.round(principal * monthlyRate * tenureMonths * 100) / 100;
  }

  private generateRepaymentSchedule(
    principal: number,
    annualRate: number,
    tenureMonths: number,
    startDate: Date,
  ): LoanScheduleItem[] {
    const monthlyPayment = Math.ceil(
      (principal +
        this.calculateTotalInterest(principal, annualRate, tenureMonths)) /
        tenureMonths,
    );

    const schedule: LoanScheduleItem[] = [];
    let remainingPrincipal = principal;
    const monthlyRate = annualRate / 12;

    for (let i = 1; i <= tenureMonths; i++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + i);

      const interestPortion =
        Math.round(remainingPrincipal * monthlyRate * 100) / 100;
      const principalPortion =
        i === tenureMonths
          ? remainingPrincipal
          : monthlyPayment - interestPortion;

      remainingPrincipal -= principalPortion;

      schedule.push({
        installmentNumber: i,
        dueDate,
        principalAmount: Math.round(principalPortion * 100) / 100,
        interestAmount: interestPortion,
        totalAmount: monthlyPayment,
        status: "PENDING",
        paidAmount: 0,
      });
    }

    return schedule;
  }

  private async autoApprove(loanId: string): Promise<boolean> {
    // In production, implement more sophisticated approval logic
    await prisma.loan.update({
      where: { id: loanId },
      data: {
        status: "APPROVED",
        approvedDate: new Date(),
      },
    });

    return true;
  }

  private async disburseLoan(loanId: string): Promise<void> {
    const loan = await prisma.loan.findUnique({
      where: { id: loanId },
    });

    if (!loan) {
      throw new Error("Loan not found");
    }

    const disbursementAmount =
      Number(loan.principalAmount) - Number(loan.processingFee);

    // Credit loan amount to wallet
    await enhancedWalletService.credit({
      walletId: loan.walletId,
      amount: disbursementAmount,
      currency: loan.currency,
      description: `Loan disbursement - ${loanId}`,
      reference: `disb_${loanId}`,
    });

    await prisma.loan.update({
      where: { id: loanId },
      data: {
        status: "ACTIVE",
        disbursedAmount: disbursementAmount,
        disbursementDate: new Date(),
        firstPaymentDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
  }

  private async createRepaymentSchedule(
    loanId: string,
    schedule: LoanScheduleItem[],
  ): Promise<void> {
    const scheduleData = schedule.map((item) => ({
      id: `sched_${nanoid(12)}`,
      loanId,
      installmentNumber: item.installmentNumber,
      dueDate: item.dueDate,
      principalAmount: item.principalAmount,
      interestAmount: item.interestAmount,
      amountDue: item.totalAmount,
      amountPaid: 0,
      status: "PENDING" as const,
    }));

    await prisma.loanSchedule.createMany({
      data: scheduleData,
    });
  }

  private async processAutoDebitPayment(
    loanId: string,
    walletId: string,
    amount: number,
    currency: Currency,
  ): Promise<void> {
    const repaymentId = `rep_${nanoid(16)}`;

    await prisma.$transaction(async (tx) => {
      // Debit wallet
      await enhancedWalletService.debit({
        walletId,
        amount,
        currency,
        description: `Loan auto-debit - ${loanId}`,
        reference: repaymentId,
      });

      // Create repayment record
      await tx.loanRepayment.create({
        data: {
          id: repaymentId,
          loanId,
          amount,
          lateFee: 0,
          totalPaid: amount,
          paymentMethod: "AUTO_DEBIT",
        },
      });

      // Update loan
      const loan = await tx.loan.findUnique({ where: { id: loanId } });
      if (!loan) return;

      const newOutstanding = Number(loan.outstandingAmount) - amount;

      await tx.loan.update({
        where: { id: loanId },
        data: {
          outstandingAmount: Math.max(0, newOutstanding),
          totalRepaid: { increment: amount },
          status: newOutstanding <= 0 ? "PAID" : "ACTIVE",
        },
      });

      // Update schedule
      const pendingSchedule = await tx.loanSchedule.findFirst({
        where: { loanId, status: { in: ["PENDING", "PARTIAL"] } },
        orderBy: { dueDate: "asc" },
      });

      if (pendingSchedule) {
        const amountDue = Number(pendingSchedule.amountDue);
        await tx.loanSchedule.update({
          where: { id: pendingSchedule.id },
          data: {
            amountPaid: amount,
            status: amount >= amountDue ? "PAID" : "PARTIAL",
            paidDate: amount >= amountDue ? new Date() : null,
          },
        });
      }
    });
  }

  private formatLoan(loan: {
    id: string;
    userId: string;
    walletId: string;
    productId: string;
    principalAmount: unknown;
    interestRate: unknown;
    tenureMonths: number;
    processingFee: unknown;
    totalInterest: unknown;
    totalAmount: unknown;
    monthlyPayment: unknown;
    outstandingAmount: unknown;
    totalRepaid: unknown;
    purpose: string | null;
    status: string;
    currency: string;
    applicationDate: Date | null;
    approvedDate: Date | null;
    disbursementDate: Date | null;
    firstPaymentDate: Date | null;
    paidOffDate: Date | null;
    schedule: Array<{
      installmentNumber: number;
      dueDate: Date;
      principalAmount: unknown;
      interestAmount: unknown;
      amountDue: unknown;
      amountPaid: unknown;
      status: string;
    }>;
  }): Loan {
    const disbursedAmount =
      Number(loan.principalAmount) - Number(loan.processingFee);
    return {
      id: loan.id,
      productName: "Loan Product",
      principalAmount: Number(loan.principalAmount),
      interestRate: Number(loan.interestRate),
      totalAmount: Number(loan.totalAmount),
      disbursedAmount,
      outstandingBalance: Number(loan.outstandingAmount),
      currency: loan.currency,
      termDays: loan.tenureMonths * 30,
      status: loan.status as LoanStatus,
      nextPaymentDate: loan.firstPaymentDate || undefined,
      nextPaymentAmount:
        loan.schedule.length > 0 && loan.schedule[0]
          ? Number(loan.schedule[0].amountDue)
          : undefined,
      dueDate: loan.firstPaymentDate
        ? new Date(
            loan.firstPaymentDate.getTime() +
              loan.tenureMonths * 30 * 24 * 60 * 60 * 1000,
          )
        : new Date(),
      disbursedAt: loan.disbursementDate || undefined,
      paidAt: loan.paidOffDate || undefined,
      schedule: loan.schedule.map((s) => ({
        installmentNumber: s.installmentNumber,
        dueDate: s.dueDate,
        principalAmount: Number(s.principalAmount),
        interestAmount: Number(s.interestAmount),
        totalAmount: Number(s.amountDue),
        status: s.status as
          | "PENDING"
          | "PAID"
          | "OVERDUE"
          | "WAIVED"
          | "PARTIAL",
        paidAmount: Number(s.amountPaid),
      })),
    };
  }

  private async sendOverdueNotification(loanId: string): Promise<void> {
    try {
      // Get loan with user details
      const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        include: {
          user: true,
          product: true,
          schedule: {
            where: { status: "OVERDUE" },
            orderBy: { dueDate: "asc" },
          },
        },
      });

      if (!loan) {
        loanLogger.error({ loanId }, "Loan not found for overdue notification");
        return;
      }

      // Calculate total overdue amount
      const overdueAmount = loan.schedule.reduce(
        (sum: number, s: { amountDue: unknown; amountPaid: unknown }) =>
          sum + (Number(s.amountDue) - Number(s.amountPaid)),
        0,
      );

      // Get oldest overdue date
      const oldestOverdue = loan.schedule[0]?.dueDate;
      const daysOverdue = oldestOverdue
        ? Math.floor(
            (Date.now() - oldestOverdue.getTime()) / (1000 * 60 * 60 * 24),
          )
        : 0;

      // Send notification
      await notificationClient.send({
        userId: loan.userId,
        title: "Loan Payment Overdue",
        body: `Your ${loan.product.name} loan payment of ${loan.currency} ${overdueAmount.toLocaleString()} is ${daysOverdue} days overdue. Please make a payment to avoid late fees and impact on your credit score.`,
        type: NotificationType.LOAN_OVERDUE,
        priority: NotificationPriority.URGENT,
        data: {
          loanId,
          overdueAmount,
          daysOverdue,
          currency: loan.currency,
          productName: loan.product.name,
        },
      });

      loanLogger.info(
        { loanId, overdueAmount, daysOverdue },
        "Overdue notification sent",
      );
    } catch (error) {
      loanLogger.error(
        { err: error, loanId },
        "Failed to send overdue notification",
      );
    }
  }
}

// Export singleton instance
export const loanService = new LoanService();
