/**
 * UBI B2B Billing System Service
 *
 * Comprehensive billing and invoicing for B2B customers:
 * - Usage tracking (rides, deliveries, API calls)
 * - Invoice generation
 * - Payment processing
 * - Credit management
 * - Subscription billing
 * - Custom pricing tiers
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import type {
  BillingCycle,
  CreditBalance,
  CreditTransaction,
  Invoice,
  InvoiceStatus,
  PaginatedResponse,
  PaginationParams,
  PricingTier,
  UsageRecord,
  UsageType,
} from "../types/b2b.types";

// =============================================================================
// INTERFACES
// =============================================================================

interface BillingPlan {
  id: string;
  name: string;
  description: string;
  billingCycle: BillingCycle;
  basePrice: number;
  currency: string;
  includedUsage: {
    rides?: number;
    deliveries?: number;
    apiCalls?: number;
    schoolTransports?: number;
    medicalTransports?: number;
  };
  overageRates: Record<UsageType, number>;
  features: string[];
  isActive: boolean;
}

interface Subscription {
  id: string;
  organizationId: string;
  planId: string;
  status: "active" | "paused" | "cancelled" | "past_due";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: Date;
  createdAt: Date;
}

interface PaymentMethod {
  id: string;
  organizationId: string;
  type: "card" | "bank_account" | "wallet";
  isDefault: boolean;
  lastFour?: string;
  expiryMonth?: number;
  expiryYear?: number;
  bankName?: string;
  createdAt: Date;
}

interface PaymentAttempt {
  id: string;
  invoiceId: string;
  paymentMethodId: string;
  amount: number;
  currency: string;
  status: "pending" | "succeeded" | "failed";
  failureReason?: string;
  createdAt: Date;
  processedAt?: Date;
}

interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  usageType?: UsageType;
  periodStart?: Date;
  periodEnd?: Date;
}

interface BillingStats {
  totalRevenue: number;
  totalInvoiced: number;
  totalPaid: number;
  totalOutstanding: number;
  totalOverdue: number;
  invoiceCount: number;
  averageInvoiceValue: number;
  collectionRate: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PRICING: Record<UsageType, number> = {
  ride: 1000, // Base ride cost (in kobo/cents)
  delivery: 500,
  api_call: 1,
  school_transport: 2000,
  medical_transport: 3000,
  subscription: 0,
  platform_fee: 0,
  other: 0,
};

const DEFAULT_PLANS: BillingPlan[] = [
  {
    id: "starter",
    name: "Starter",
    description: "For small businesses getting started",
    billingCycle: "MONTHLY",
    basePrice: 0,
    currency: "NGN",
    includedUsage: { deliveries: 100, apiCalls: 10000 },
    overageRates: { ...DEFAULT_PRICING },
    features: ["Basic API access", "Email support", "Dashboard access"],
    isActive: true,
  },
  {
    id: "growth",
    name: "Growth",
    description: "For growing businesses",
    billingCycle: "MONTHLY",
    basePrice: 50000,
    currency: "NGN",
    includedUsage: { deliveries: 500, apiCalls: 100000 },
    overageRates: {
      ...DEFAULT_PRICING,
      delivery: 400,
      api_call: 0.5,
    },
    features: [
      "Priority API access",
      "Priority support",
      "Advanced analytics",
      "Webhooks",
    ],
    isActive: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "For large organizations",
    billingCycle: "MONTHLY",
    basePrice: 200000,
    currency: "NGN",
    includedUsage: { deliveries: 5000, apiCalls: 1000000 },
    overageRates: {
      ...DEFAULT_PRICING,
      delivery: 300,
      api_call: 0.1,
    },
    features: [
      "Unlimited API calls",
      "24/7 support",
      "SLA guarantee",
      "Custom integrations",
      "Dedicated account manager",
    ],
    isActive: true,
  },
];

// =============================================================================
// BILLING SERVICE
// =============================================================================

export class BillingService extends EventEmitter {
  private plans: Map<string, BillingPlan> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();
  private pricingTiers: Map<string, PricingTier[]> = new Map();
  private usageRecords: Map<string, UsageRecord[]> = new Map();
  private invoices: Map<string, Invoice> = new Map();
  private creditBalances: Map<string, CreditBalance> = new Map();
  private creditTransactions: Map<string, CreditTransaction[]> = new Map();
  private paymentMethods: Map<string, PaymentMethod[]> = new Map();
  private paymentAttempts: Map<string, PaymentAttempt[]> = new Map();

  constructor() {
    super();
    this.setMaxListeners(100);
    this.initializeDefaultPlans();
  }

  private initializeDefaultPlans(): void {
    for (const plan of DEFAULT_PLANS) {
      this.plans.set(plan.id, plan);
    }
  }

  // ===========================================================================
  // SUBSCRIPTION MANAGEMENT
  // ===========================================================================

  /**
   * Create a subscription
   */
  async createSubscription(
    organizationId: string,
    planId: string
  ): Promise<Subscription> {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error("Plan not found");
    }

    const now = new Date();
    const periodEnd = this.calculatePeriodEnd(now, plan.billingCycle);

    const subscription: Subscription = {
      id: uuidv4(),
      organizationId,
      planId,
      status: "active",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      createdAt: now,
    };

    this.subscriptions.set(subscription.id, subscription);

    // Initialize credit balance
    this.initializeCreditBalance(organizationId);

    // Create initial invoice if base price > 0
    if (plan.basePrice > 0) {
      await this.createInvoice(organizationId, {
        lineItems: [
          {
            description: `${plan.name} Plan - Subscription`,
            quantity: 1,
            unitPrice: plan.basePrice,
          },
        ],
        dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // Due in 7 days
      });
    }

    this.emit("subscription:created", subscription);

    return subscription;
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(
    subscriptionId: string,
    cancelImmediately: boolean = false
  ): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error("Subscription not found");
    }

    if (cancelImmediately) {
      subscription.status = "cancelled";
      subscription.cancelledAt = new Date();
    } else {
      subscription.cancelAtPeriodEnd = true;
    }

    this.subscriptions.set(subscriptionId, subscription);

    this.emit("subscription:cancelled", subscription);

    return subscription;
  }

  /**
   * Change subscription plan
   */
  async changePlan(
    subscriptionId: string,
    newPlanId: string
  ): Promise<Subscription> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error("Subscription not found");
    }

    const newPlan = this.plans.get(newPlanId);
    if (!newPlan) {
      throw new Error("Plan not found");
    }

    const oldPlanId = subscription.planId;
    subscription.planId = newPlanId;

    this.subscriptions.set(subscriptionId, subscription);

    // Prorate if upgrading
    const oldPlan = this.plans.get(oldPlanId);
    if (oldPlan && newPlan.basePrice > oldPlan.basePrice) {
      const remainingDays = this.calculateRemainingDays(subscription);
      const proratedAmount = this.calculateProration(
        newPlan.basePrice - oldPlan.basePrice,
        remainingDays,
        subscription.currentPeriodEnd
      );

      if (proratedAmount > 0) {
        await this.createInvoice(subscription.organizationId, {
          lineItems: [
            {
              description: `Plan upgrade proration: ${oldPlan.name} → ${newPlan.name}`,
              quantity: 1,
              unitPrice: proratedAmount,
            },
          ],
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }
    }

    this.emit("subscription:plan_changed", {
      subscription,
      oldPlanId,
      newPlanId,
    });

    return subscription;
  }

  /**
   * Get subscription for organization
   */
  async getSubscription(organizationId: string): Promise<Subscription | null> {
    return (
      Array.from(this.subscriptions.values()).find(
        (s) => s.organizationId === organizationId && s.status === "active"
      ) || null
    );
  }

  // ===========================================================================
  // PRICING TIERS
  // ===========================================================================

  /**
   * Set custom pricing for an organization
   */
  async setCustomPricing(
    organizationId: string,
    tiers: PricingTier[]
  ): Promise<void> {
    this.pricingTiers.set(organizationId, tiers);

    this.emit("pricing:updated", { organizationId, tiers });
  }

  /**
   * Get pricing for an organization
   */
  async getPricing(
    organizationId: string,
    usageType: UsageType
  ): Promise<number> {
    const tiers = this.pricingTiers.get(organizationId);

    if (tiers) {
      const tier = tiers.find((t) => t.usageType === usageType);
      if (tier) {
        return tier.unitPrice;
      }
    }

    // Fall back to subscription plan pricing
    const subscription = await this.getSubscription(organizationId);
    if (subscription) {
      const plan = this.plans.get(subscription.planId);
      if (plan && plan.overageRates[usageType]) {
        return plan.overageRates[usageType];
      }
    }

    // Fall back to default pricing
    return DEFAULT_PRICING[usageType] || 0;
  }

  // ===========================================================================
  // USAGE TRACKING
  // ===========================================================================

  /**
   * Record usage
   */
  async recordUsage(
    organizationId: string,
    usage: {
      type: UsageType;
      quantity: number;
      unitPrice?: number;
      referenceId?: string;
      referenceType?: string;
      description?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<UsageRecord> {
    const unitPrice =
      usage.unitPrice ?? (await this.getPricing(organizationId, usage.type));
    const totalAmount = usage.quantity * unitPrice;

    const record: UsageRecord = {
      id: uuidv4(),
      organizationId,
      type: usage.type,
      quantity: usage.quantity,
      unitPrice,
      totalAmount,
      referenceId: usage.referenceId,
      referenceType: usage.referenceType,
      description: usage.description,
      timestamp: new Date(),
      invoiced: false,
      metadata: usage.metadata || {},
    };

    const records = this.usageRecords.get(organizationId) || [];
    records.push(record);
    this.usageRecords.set(organizationId, records);

    this.emit("usage:recorded", record);

    return record;
  }

  /**
   * Get usage for a period
   */
  async getUsage(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date,
    usageType?: UsageType
  ): Promise<UsageRecord[]> {
    let records = this.usageRecords.get(organizationId) || [];

    records = records.filter(
      (r) => r.timestamp >= periodStart && r.timestamp <= periodEnd
    );

    if (usageType) {
      records = records.filter((r) => r.type === usageType);
    }

    return records;
  }

  /**
   * Get usage summary
   */
  async getUsageSummary(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<{
    byType: Record<UsageType, { count: number; amount: number }>;
    total: number;
    includedUsage: Record<string, number>;
    overageUsage: Record<string, number>;
  }> {
    const records = await this.getUsage(organizationId, periodStart, periodEnd);

    const byType: Record<string, { count: number; amount: number }> = {};
    let total = 0;

    for (const record of records) {
      if (!byType[record.type]) {
        byType[record.type] = { count: 0, amount: 0 };
      }
      byType[record.type].count += record.quantity;
      byType[record.type].amount += record.totalAmount;
      total += record.totalAmount;
    }

    // Calculate included vs overage
    const subscription = await this.getSubscription(organizationId);
    const includedUsage: Record<string, number> = {};
    const overageUsage: Record<string, number> = {};

    if (subscription) {
      const plan = this.plans.get(subscription.planId);
      if (plan) {
        const usageTypes: (keyof typeof plan.includedUsage)[] = [
          "rides",
          "deliveries",
          "apiCalls",
          "schoolTransports",
          "medicalTransports",
        ];
        const typeMapping: Record<string, UsageType> = {
          rides: "ride",
          deliveries: "delivery",
          apiCalls: "api_call",
          schoolTransports: "school_transport",
          medicalTransports: "medical_transport",
        };

        for (const key of usageTypes) {
          const included = plan.includedUsage[key] || 0;
          const usageType = typeMapping[key];
          const used = byType[usageType]?.count || 0;

          includedUsage[usageType] = Math.min(used, included);
          overageUsage[usageType] = Math.max(0, used - included);
        }
      }
    }

    return {
      byType: byType as Record<UsageType, { count: number; amount: number }>,
      total,
      includedUsage,
      overageUsage,
    };
  }

  // ===========================================================================
  // INVOICE MANAGEMENT
  // ===========================================================================

  /**
   * Create an invoice
   */
  async createInvoice(
    organizationId: string,
    invoiceData: {
      lineItems: {
        description: string;
        quantity: number;
        unitPrice: number;
        usageType?: UsageType;
      }[];
      dueDate: Date;
      notes?: string;
    }
  ): Promise<Invoice> {
    const lineItems: InvoiceLineItem[] = invoiceData.lineItems.map((item) => ({
      id: uuidv4(),
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.quantity * item.unitPrice,
      usageType: item.usageType,
    }));

    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
    const taxRate = 0.075; // 7.5% VAT
    const taxAmount = Math.round(subtotal * taxRate);
    const total = subtotal + taxAmount;

    const invoice: Invoice = {
      id: uuidv4(),
      invoiceNumber: this.generateInvoiceNumber(),
      organizationId,
      status: "draft",
      periodStart: new Date(),
      periodEnd: new Date(),
      subtotal,
      taxAmount,
      taxRate,
      total,
      currency: "NGN",
      lineItems,
      dueDate: invoiceData.dueDate,
      notes: invoiceData.notes,
      createdAt: new Date(),
    };

    this.invoices.set(invoice.id, invoice);

    this.emit("invoice:created", invoice);

    return invoice;
  }

  /**
   * Generate invoice from usage
   */
  async generateInvoiceFromUsage(
    organizationId: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<Invoice> {
    const summary = await this.getUsageSummary(
      organizationId,
      periodStart,
      periodEnd
    );
    const subscription = await this.getSubscription(organizationId);

    const lineItems: {
      description: string;
      quantity: number;
      unitPrice: number;
      usageType?: UsageType;
    }[] = [];

    // Add subscription base price
    if (subscription) {
      const plan = this.plans.get(subscription.planId);
      if (plan && plan.basePrice > 0) {
        lineItems.push({
          description: `${plan.name} Plan - Monthly subscription`,
          quantity: 1,
          unitPrice: plan.basePrice,
        });
      }
    }

    // Add overage charges
    for (const [usageType, quantity] of Object.entries(summary.overageUsage)) {
      if (quantity > 0) {
        const unitPrice = await this.getPricing(
          organizationId,
          usageType as UsageType
        );
        lineItems.push({
          description: `${this.formatUsageType(usageType as UsageType)} overage`,
          quantity,
          unitPrice,
          usageType: usageType as UsageType,
        });
      }
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 14); // Due in 14 days

    const invoice = await this.createInvoice(organizationId, {
      lineItems,
      dueDate,
      notes: `Usage period: ${periodStart.toISOString().split("T")[0]} to ${periodEnd.toISOString().split("T")[0]}`,
    });

    // Mark usage as invoiced
    const records = this.usageRecords.get(organizationId) || [];
    for (const record of records) {
      if (record.timestamp >= periodStart && record.timestamp <= periodEnd) {
        record.invoiced = true;
        record.invoiceId = invoice.id;
      }
    }

    return invoice;
  }

  /**
   * Finalize invoice
   */
  async finalizeInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    if (invoice.status !== "draft") {
      throw new Error("Only draft invoices can be finalized");
    }

    invoice.status = "sent";
    invoice.sentAt = new Date();

    this.invoices.set(invoiceId, invoice);

    this.emit("invoice:finalized", invoice);

    return invoice;
  }

  /**
   * Mark invoice as paid
   */
  async markInvoicePaid(
    invoiceId: string,
    paymentReference?: string
  ): Promise<Invoice> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    invoice.status = "paid";
    invoice.paidAt = new Date();
    invoice.paymentReference = paymentReference;

    this.invoices.set(invoiceId, invoice);

    this.emit("invoice:paid", invoice);

    return invoice;
  }

  /**
   * Void an invoice
   */
  async voidInvoice(invoiceId: string): Promise<Invoice> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    if (invoice.status === "paid") {
      throw new Error("Cannot void a paid invoice");
    }

    invoice.status = "void";

    this.invoices.set(invoiceId, invoice);

    this.emit("invoice:voided", invoice);

    return invoice;
  }

  /**
   * Get invoice by ID
   */
  async getInvoice(invoiceId: string): Promise<Invoice | null> {
    return this.invoices.get(invoiceId) || null;
  }

  /**
   * List invoices for an organization
   */
  async listInvoices(
    organizationId: string,
    status?: InvoiceStatus,
    pagination?: PaginationParams
  ): Promise<PaginatedResponse<Invoice>> {
    let invoices = Array.from(this.invoices.values()).filter(
      (i) => i.organizationId === organizationId
    );

    if (status) {
      invoices = invoices.filter((i) => i.status === status);
    }

    invoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return this.paginate(invoices, pagination || { page: 1, limit: 20 });
  }

  /**
   * Get overdue invoices
   */
  async getOverdueInvoices(organizationId?: string): Promise<Invoice[]> {
    const now = new Date();
    let invoices = Array.from(this.invoices.values()).filter(
      (i) => i.status === "sent" && i.dueDate < now
    );

    if (organizationId) {
      invoices = invoices.filter((i) => i.organizationId === organizationId);
    }

    // Update status to overdue
    for (const invoice of invoices) {
      invoice.status = "overdue";
      this.invoices.set(invoice.id, invoice);
    }

    return invoices;
  }

  // ===========================================================================
  // CREDIT MANAGEMENT
  // ===========================================================================

  /**
   * Initialize credit balance
   */
  private initializeCreditBalance(organizationId: string): void {
    if (this.creditBalances.has(organizationId)) return;

    const balance: CreditBalance = {
      organizationId,
      balance: 0,
      currency: "NGN",
      updatedAt: new Date(),
    };

    this.creditBalances.set(organizationId, balance);
    this.creditTransactions.set(organizationId, []);
  }

  /**
   * Add credit to account
   */
  async addCredit(
    organizationId: string,
    amount: number,
    description: string,
    expiresAt?: Date
  ): Promise<CreditTransaction> {
    this.initializeCreditBalance(organizationId);

    const balance = this.creditBalances.get(organizationId)!;
    balance.balance += amount;
    balance.updatedAt = new Date();

    const transaction: CreditTransaction = {
      id: uuidv4(),
      organizationId,
      type: "credit",
      amount,
      balance: balance.balance,
      description,
      expiresAt,
      createdAt: new Date(),
    };

    const transactions = this.creditTransactions.get(organizationId) || [];
    transactions.push(transaction);
    this.creditTransactions.set(organizationId, transactions);

    this.emit("credit:added", transaction);

    return transaction;
  }

  /**
   * Deduct credit from account
   */
  async deductCredit(
    organizationId: string,
    amount: number,
    description: string,
    referenceId?: string
  ): Promise<CreditTransaction> {
    const balance = this.creditBalances.get(organizationId);
    if (!balance) {
      throw new Error("Credit balance not found");
    }

    if (balance.balance < amount) {
      throw new Error("Insufficient credit balance");
    }

    balance.balance -= amount;
    balance.updatedAt = new Date();

    const transaction: CreditTransaction = {
      id: uuidv4(),
      organizationId,
      type: "debit",
      amount,
      balance: balance.balance,
      description,
      referenceId,
      createdAt: new Date(),
    };

    const transactions = this.creditTransactions.get(organizationId) || [];
    transactions.push(transaction);
    this.creditTransactions.set(organizationId, transactions);

    this.emit("credit:deducted", transaction);

    return transaction;
  }

  /**
   * Get credit balance
   */
  async getCreditBalance(
    organizationId: string
  ): Promise<CreditBalance | null> {
    return this.creditBalances.get(organizationId) || null;
  }

  /**
   * Get credit transactions
   */
  async getCreditTransactions(
    organizationId: string,
    pagination: PaginationParams
  ): Promise<PaginatedResponse<CreditTransaction>> {
    const transactions = this.creditTransactions.get(organizationId) || [];
    transactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return this.paginate(transactions, pagination);
  }

  /**
   * Apply credit to invoice
   */
  async applyCreditToInvoice(
    organizationId: string,
    invoiceId: string,
    amount?: number
  ): Promise<{ invoice: Invoice; creditUsed: number }> {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice) {
      throw new Error("Invoice not found");
    }

    if (invoice.status === "paid" || invoice.status === "void") {
      throw new Error("Cannot apply credit to this invoice");
    }

    const balance = this.creditBalances.get(organizationId);
    if (!balance || balance.balance === 0) {
      throw new Error("No credit available");
    }

    const amountToApply = Math.min(
      amount || invoice.total,
      invoice.total,
      balance.balance
    );

    // Deduct credit
    await this.deductCredit(
      organizationId,
      amountToApply,
      `Applied to invoice ${invoice.invoiceNumber}`,
      invoice.id
    );

    // Update invoice
    invoice.creditApplied = (invoice.creditApplied || 0) + amountToApply;

    if (invoice.creditApplied >= invoice.total) {
      invoice.status = "paid";
      invoice.paidAt = new Date();
    }

    this.invoices.set(invoiceId, invoice);

    return { invoice, creditUsed: amountToApply };
  }

  // ===========================================================================
  // PAYMENT METHODS
  // ===========================================================================

  /**
   * Add payment method
   */
  async addPaymentMethod(
    organizationId: string,
    method: Omit<PaymentMethod, "id" | "organizationId" | "createdAt">
  ): Promise<PaymentMethod> {
    const paymentMethod: PaymentMethod = {
      id: uuidv4(),
      organizationId,
      ...method,
      createdAt: new Date(),
    };

    const methods = this.paymentMethods.get(organizationId) || [];

    // If this is the first method, make it default
    if (methods.length === 0) {
      paymentMethod.isDefault = true;
    }

    // If marked as default, unset other defaults
    if (paymentMethod.isDefault) {
      for (const m of methods) {
        m.isDefault = false;
      }
    }

    methods.push(paymentMethod);
    this.paymentMethods.set(organizationId, methods);

    return paymentMethod;
  }

  /**
   * Remove payment method
   */
  async removePaymentMethod(
    organizationId: string,
    paymentMethodId: string
  ): Promise<void> {
    const methods = this.paymentMethods.get(organizationId) || [];
    const index = methods.findIndex((m) => m.id === paymentMethodId);

    if (index === -1) {
      throw new Error("Payment method not found");
    }

    const wasDefault = methods[index].isDefault;
    methods.splice(index, 1);

    // If we removed the default, set a new default
    if (wasDefault && methods.length > 0) {
      methods[0].isDefault = true;
    }

    this.paymentMethods.set(organizationId, methods);
  }

  /**
   * Set default payment method
   */
  async setDefaultPaymentMethod(
    organizationId: string,
    paymentMethodId: string
  ): Promise<PaymentMethod> {
    const methods = this.paymentMethods.get(organizationId) || [];

    let targetMethod: PaymentMethod | undefined;

    for (const method of methods) {
      if (method.id === paymentMethodId) {
        method.isDefault = true;
        targetMethod = method;
      } else {
        method.isDefault = false;
      }
    }

    if (!targetMethod) {
      throw new Error("Payment method not found");
    }

    this.paymentMethods.set(organizationId, methods);

    return targetMethod;
  }

  /**
   * List payment methods
   */
  async listPaymentMethods(organizationId: string): Promise<PaymentMethod[]> {
    return this.paymentMethods.get(organizationId) || [];
  }

  // ===========================================================================
  // BILLING STATISTICS
  // ===========================================================================

  /**
   * Get billing statistics
   */
  async getBillingStats(
    organizationId?: string,
    dateFrom?: Date,
    dateTo?: Date
  ): Promise<BillingStats> {
    let invoices = Array.from(this.invoices.values());

    if (organizationId) {
      invoices = invoices.filter((i) => i.organizationId === organizationId);
    }

    if (dateFrom) {
      invoices = invoices.filter((i) => i.createdAt >= dateFrom);
    }

    if (dateTo) {
      invoices = invoices.filter((i) => i.createdAt <= dateTo);
    }

    const paidInvoices = invoices.filter((i) => i.status === "paid");
    const overdueInvoices = invoices.filter((i) => i.status === "overdue");
    const outstandingInvoices = invoices.filter(
      (i) => i.status === "sent" || i.status === "overdue"
    );

    const totalRevenue = paidInvoices.reduce((sum, i) => sum + i.total, 0);
    const totalInvoiced = invoices
      .filter((i) => i.status !== "void" && i.status !== "draft")
      .reduce((sum, i) => sum + i.total, 0);
    const totalPaid = totalRevenue;
    const totalOutstanding = outstandingInvoices.reduce(
      (sum, i) => sum + i.total,
      0
    );
    const totalOverdue = overdueInvoices.reduce((sum, i) => sum + i.total, 0);

    return {
      totalRevenue,
      totalInvoiced,
      totalPaid,
      totalOutstanding,
      totalOverdue,
      invoiceCount: invoices.length,
      averageInvoiceValue:
        invoices.length > 0 ? Math.round(totalInvoiced / invoices.length) : 0,
      collectionRate:
        totalInvoiced > 0 ? Math.round((totalPaid / totalInvoiced) * 100) : 0,
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private generateInvoiceNumber(): string {
    const prefix = "INV";
    const year = new Date().getFullYear();
    const sequence = Array.from(this.invoices.values()).length + 1;
    return `${prefix}-${year}-${String(sequence).padStart(6, "0")}`;
  }

  private calculatePeriodEnd(start: Date, cycle: BillingCycle): Date {
    const end = new Date(start);

    switch (cycle) {
      case "WEEKLY":
        end.setDate(end.getDate() + 7);
        break;
      case "BIWEEKLY":
        end.setDate(end.getDate() + 14);
        break;
      case "MONTHLY":
        end.setMonth(end.getMonth() + 1);
        break;
      case "QUARTERLY":
        end.setMonth(end.getMonth() + 3);
        break;
      case "ANNUAL":
        end.setFullYear(end.getFullYear() + 1);
        break;
      default:
        end.setMonth(end.getMonth() + 1);
    }

    return end;
  }

  private calculateRemainingDays(subscription: Subscription): number {
    const now = new Date();
    const end = subscription.currentPeriodEnd;
    return Math.max(
      0,
      Math.ceil((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
    );
  }

  private calculateProration(
    priceDifference: number,
    remainingDays: number,
    periodEnd: Date
  ): number {
    const totalDays = 30; // Approximate month
    return Math.round((priceDifference / totalDays) * remainingDays);
  }

  private formatUsageType(type: UsageType): string {
    const formats: Record<UsageType, string> = {
      ride: "Ride",
      delivery: "Delivery",
      api_call: "API Call",
      school_transport: "School Transport",
      medical_transport: "Medical Transport",
      subscription: "Subscription",
      platform_fee: "Platform Fee",
      other: "Other",
    };
    return formats[type] || type;
  }

  private paginate<T>(
    items: T[],
    params: PaginationParams
  ): PaginatedResponse<T> {
    const page = params.page || 1;
    const limit = params.limit || 20;
    const total = items.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const end = start + limit;

    return {
      data: items.slice(start, end),
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const billingService = new BillingService();
