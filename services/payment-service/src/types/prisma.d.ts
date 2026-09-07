/**
 * ⚠️  DEPRECATED — THIS FILE DEFEATS TYPE CHECKING ON THE MONEY PATH.
 *
 * `declare module "@prisma/client"` is an ambient declaration, so it REPLACES
 * the generated Prisma client's types for this whole service rather than adding
 * to them. Two consequences:
 *
 *   1. The `PrismaClient` class below ends with
 *          [key: string]: ModelDelegate | ((...args: any[]) => any) | any;
 *      so ANY property access on the client type-checks and returns `any`. A
 *      call to a method that does not exist compiles cleanly — verified:
 *      `prisma.thisMethodDoesNotExist().andNeitherDoesThis()` raises no error
 *      here, while the same line in food-service (which has no such shim) is
 *      correctly rejected. Every query, every `where`, every `data` payload in
 *      this service is unchecked.
 *
 *   2. The model list is hand-maintained and already stale. It names 33 models
 *      and knows nothing about `wallet`, `journalEntry`, `journalLine`,
 *      `transfer`, `reconRun` or any other model added since it was written.
 *
 * MEASURED IMPACT: deleting this file takes `tsc --noEmit` in this service from
 * 350 errors to 1020. The extra 670 are real type errors this shim has been
 * hiding, not new ones. It is restored here only so that removing it is a
 * deliberate, scheduled piece of work rather than a side effect of another
 * change — see docs/launch-readiness/current-state.md.
 *
 * The handoff is explicit that generated clients must not be shadowed by
 * hand-written duplicates. This must be deleted and the 670 errors fixed before
 * payment-service can be considered launch-ready.
 *
 * New code MUST NOT rely on these types. `src/ledger/` imports from
 * "@prisma/client/index" precisely to get the real generated types instead.
 *
 * ---- original header follows ----
 *
 * Prisma Client Type Declarations
 *
 * This file provides type declarations for Prisma enums and types
 * that are used throughout the payment service. These mirror the
 * enums defined in the Prisma schema.
 */

declare module "@prisma/client" {
  // ============================================
  // Enums from Prisma Schema
  // ============================================

  export enum Currency {
    NGN = "NGN",
    KES = "KES",
    ZAR = "ZAR",
    GHS = "GHS",
    RWF = "RWF",
    ETB = "ETB",
    USD = "USD",
    XOF = "XOF", // West African CFA Franc
    XAF = "XAF", // Central African CFA Franc
  }

  export enum AccountType {
    USER_WALLET = "USER_WALLET",
    DRIVER_WALLET = "DRIVER_WALLET",
    RESTAURANT_WALLET = "RESTAURANT_WALLET",
    UBI_COMMISSION = "UBI_COMMISSION",
    UBI_FLOAT = "UBI_FLOAT",
    CEERION_ESCROW = "CEERION_ESCROW",
    PROMOTIONAL = "PROMOTIONAL",
    REFUND_RESERVE = "REFUND_RESERVE",
  }

  export enum PaymentProvider {
    PAYSTACK = "PAYSTACK",
    FLUTTERWAVE = "FLUTTERWAVE",
    MPESA = "MPESA",
    MTN_MOMO_GH = "MTN_MOMO_GH",
    MTN_MOMO_RW = "MTN_MOMO_RW",
    MTN_MOMO_UG = "MTN_MOMO_UG",
    AIRTEL_MONEY = "AIRTEL_MONEY",
    TELEBIRR = "TELEBIRR",
    ORANGE_MONEY = "ORANGE_MONEY",
  }

  export enum PaymentStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
    REFUNDED = "REFUNDED",
    CANCELLED = "CANCELLED",
  }

  export enum PayoutStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
    CANCELLED = "CANCELLED",
  }

  export enum RiskLevel {
    LOW = "LOW",
    MEDIUM = "MEDIUM",
    HIGH = "HIGH",
    CRITICAL = "CRITICAL",
  }

  export enum RiskAction {
    ALLOW = "ALLOW",
    REVIEW = "REVIEW",
    REQUIRE_3DS = "REQUIRE_3DS",
    BLOCK = "BLOCK",
  }

  export enum UserRole {
    RIDER = "RIDER",
    DRIVER = "DRIVER",
    RESTAURANT = "RESTAURANT",
    MERCHANT = "MERCHANT",
    FLEET_MANAGER = "FLEET_MANAGER",
    ADMIN = "ADMIN",
    SUPER_ADMIN = "SUPER_ADMIN",
  }

  export enum UserStatus {
    PENDING = "PENDING",
    ACTIVE = "ACTIVE",
    SUSPENDED = "SUSPENDED",
    DEACTIVATED = "DEACTIVATED",
  }

  export enum TransactionType {
    WALLET_TOPUP = "WALLET_TOPUP",
    WALLET_WITHDRAWAL = "WALLET_WITHDRAWAL",
    RIDE_PAYMENT = "RIDE_PAYMENT",
    RIDE_REFUND = "RIDE_REFUND",
    FOOD_PAYMENT = "FOOD_PAYMENT",
    FOOD_REFUND = "FOOD_REFUND",
    DELIVERY_PAYMENT = "DELIVERY_PAYMENT",
    DRIVER_EARNING = "DRIVER_EARNING",
    COMMISSION_DEDUCTION = "COMMISSION_DEDUCTION",
    CEERION_DEDUCTION = "CEERION_DEDUCTION",
    INCENTIVE_BONUS = "INCENTIVE_BONUS",
    PROMOTIONAL_CREDIT = "PROMOTIONAL_CREDIT",
    TIP = "TIP",
    SETTLEMENT_PAYOUT = "SETTLEMENT_PAYOUT",
    INTERNAL_TRANSFER = "INTERNAL_TRANSFER",
  }

  export enum TransactionStatus {
    PENDING = "PENDING",
    PROCESSING = "PROCESSING",
    COMPLETED = "COMPLETED",
    FAILED = "FAILED",
    REVERSED = "REVERSED",
    CANCELLED = "CANCELLED",
  }

  export enum EntryType {
    DEBIT = "DEBIT",
    CREDIT = "CREDIT",
  }

  export enum PaymentMethod {
    CASH = "CASH",
    CARD = "CARD",
    WALLET = "WALLET",
    MPESA = "MPESA",
    MTN_MOMO = "MTN_MOMO",
    AIRTEL_MONEY = "AIRTEL_MONEY",
  }

  export enum PaymentMethodType {
    CARD = "CARD",
    MOBILE_MONEY = "MOBILE_MONEY",
    BANK_ACCOUNT = "BANK_ACCOUNT",
  }

  // ============================================
  // Prisma Namespace Types
  // ============================================

  export namespace Prisma {
    export type InputJsonValue =
      | string
      | number
      | boolean
      | null
      | JsonObject
      | JsonArray;
    export type JsonValue =
      | string
      | number
      | boolean
      | null
      | JsonObject
      | JsonArray;

    interface JsonObject {
      [key: string]: JsonValue;
    }

    interface JsonArray extends Array<JsonValue> {}

    export type Decimal = {
      toString(): string;
      toNumber(): number;
      valueOf(): number;
    };
  }

  // ============================================
  // Generic Model Delegate
  // ============================================

  interface ModelDelegate<T = any> {
    findUnique(args: any): Promise<T | null>;
    findUniqueOrThrow(args: any): Promise<T>;
    findFirst(args?: any): Promise<T | null>;
    findFirstOrThrow(args?: any): Promise<T>;
    findMany(args?: any): Promise<T[]>;
    create(args: any): Promise<T>;
    createMany(args: any): Promise<{ count: number }>;
    update(args: any): Promise<T>;
    updateMany(args: any): Promise<{ count: number }>;
    upsert(args: any): Promise<T>;
    delete(args: any): Promise<T>;
    deleteMany(args?: any): Promise<{ count: number }>;
    count(args?: any): Promise<number>;
    aggregate(args: any): Promise<any>;
    groupBy(args: any): Promise<any[]>;
  }

  // ============================================
  // PrismaClient Options
  // ============================================

  interface PrismaClientOptions {
    log?: Array<
      | "query"
      | "info"
      | "warn"
      | "error"
      | { emit: "event" | "stdout"; level: "query" | "info" | "warn" | "error" }
    >;
    datasources?: {
      db?: { url?: string };
    };
  }

  // ============================================
  // PrismaClient
  // ============================================

  export class PrismaClient {
    constructor(options?: PrismaClientOptions);

    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    $executeRaw(
      query: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<number>;
    $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
    $queryRaw<T = any>(
      query: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<T>;
    $queryRawUnsafe<T = any>(query: string, ...values: unknown[]): Promise<T>;
    $transaction<T>(
      fn: (
        prisma: Omit<PrismaClient, "$connect" | "$disconnect" | "$transaction">,
      ) => Promise<T>,
    ): Promise<T>;
    $transaction<T>(operations: Promise<T>[]): Promise<T[]>;

    // Model delegates
    user: ModelDelegate;
    session: ModelDelegate;
    rider: ModelDelegate;
    savedPlace: ModelDelegate;
    driver: ModelDelegate;
    vehicle: ModelDelegate;
    driverEarning: ModelDelegate;
    ride: ModelDelegate;
    walletAccount: ModelDelegate;
    ledgerEntry: ModelDelegate;
    transaction: ModelDelegate;
    paymentMethodRecord: ModelDelegate;
    paymentTransaction: ModelDelegate;
    balanceHold: ModelDelegate;
    payout: ModelDelegate;
    riskAssessment: ModelDelegate;
    riskFactor: ModelDelegate;
    reconciliationReport: ModelDelegate;
    reconciliationDiscrepancy: ModelDelegate;
    balanceReconciliation: ModelDelegate;
    settlement: ModelDelegate;
    refund: ModelDelegate;
    alert: ModelDelegate;
    webhookEvent: ModelDelegate;
    dispute: ModelDelegate;
    providerHealth: ModelDelegate;
    restaurant: ModelDelegate;
    menuItem: ModelDelegate;
    foodOrder: ModelDelegate;
    orderItem: ModelDelegate;
    merchant: ModelDelegate;
    delivery: ModelDelegate;
    ceerionVehicle: ModelDelegate;
    ceerionPayment: ModelDelegate;
    notification: ModelDelegate;

    // Allow dynamic model access
    [key: string]: ModelDelegate | ((...args: any[]) => any) | any;
  }

  export default PrismaClient;
}
