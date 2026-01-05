/**
 * Payment Services Index
 * UBI Payment System
 *
 * Exports all payment services for use across the application.
 */

// Core Services
export {
  PaymentGateway,
  createPaymentGateway,
  getPaymentGateway,
} from "./payment-gateway.service";
export {
  WalletService,
  createWalletService,
  getWalletService,
} from "./wallet.service";

// Provider Services
export { MomoService, createMomoService, getMomoService } from "./momo.service";
export {
  MpesaService,
  createMpesaService,
  getMpesaService,
} from "./mpesa.service";
export {
  PaystackService,
  createPaystackService,
  getPaystackService,
} from "./paystack.service";

// Payout & Settlement Services
export {
  PayoutService,
  createPayoutService,
  getPayoutService,
} from "./payout.service";
export {
  SettlementService,
  createSettlementService,
  getSettlementService,
} from "./settlement.service";

// Risk & Compliance Services
export {
  FraudDetectionService,
  createFraudDetectionService,
  getFraudDetectionService,
} from "./fraud-detection.service";

// Operations Services
export {
  ReconciliationService,
  createReconciliationService,
  getReconciliationService,
} from "./reconciliation.service";
export {
  ScheduledJobsService,
  createScheduledJobsService,
  getScheduledJobsService,
} from "./scheduled-jobs.service";

// ===========================================
// FINTECH SERVICES (Neo-Bank Features)
// ===========================================

// Enhanced Wallet (Multi-currency, Tiers, Limits)
export {
  EnhancedWalletService,
  enhancedWalletService,
} from "./enhanced-wallet.service";

// P2P Transfers
export { P2PService, p2pService } from "./p2p.service";

// Bill Payments
export { BillsService, billsService } from "./bills.service";

// QR Payments
export { QRPaymentService, qrPaymentService } from "./qr-payment.service";

// Savings Pockets
export { SavingsService, savingsService } from "./savings.service";

// Credit Scoring
export {
  CreditScoringService,
  creditScoringService,
} from "./credit-scoring.service";

// Loan Management
export { LoanService, loanService } from "./loans.service";

// Card Issuance
export { CardService, cardService } from "./cards.service";

// International Remittances
export { RemittanceService, remittanceService } from "./remittance.service";

// ===========================================
// LOYALTY & GAMIFICATION SERVICES
// ===========================================

// Points Management
export { PointsService, pointsService } from "./points.service";

// Tier Management
export { TierService, tierService } from "./tier.service";

// UBI+ Subscriptions
export {
  SubscriptionService,
  subscriptionService,
} from "./subscription.service";

// Achievements & Badges
export {
  AchievementsService,
  achievementsService,
} from "./achievements.service";

// Streaks & Milestones
export { StreaksService, streaksService } from "./streaks.service";

// Referral Program
export { ReferralsService, referralsService } from "./referrals.service";

// Challenges (Daily/Weekly/Monthly)
export { ChallengesService, challengesService } from "./challenges.service";

// Leaderboards
export {
  LeaderboardsService,
  leaderboardsService,
} from "./leaderboards.service";

// Types
export type {
  TopupRequest,
  TransferRequest,
  // Wallet types
  WalletCreation,
  WithdrawalRequest,
} from "./wallet.service";

export type {
  PaymentCallback,
  // Payment gateway types
  PaymentRequest,
  PaymentResult,
} from "./payment-gateway.service";

export type {
  B2CRequest,
  B2CResult,
  // M-Pesa types
  STKPushRequest,
  STKPushResult,
} from "./mpesa.service";

export type {
  DisbursementRequest,
  DisbursementResult,
  // MoMo types
  RequestToPayRequest,
  RequestToPayResult,
} from "./momo.service";

export type {
  CardTokenizationRequest,
  // Paystack types
  PaystackChargeRequest,
  PaystackChargeResult,
  TransferRequest as PaystackTransferRequest,
} from "./paystack.service";

export type {
  // Payout types
  CashoutRequest,
  PayoutResult,
} from "./payout.service";

export type {
  CommissionBreakdown,
  // Settlement types
  SettlementRequest,
} from "./settlement.service";

export type {
  // Fraud detection types
  FraudCheckResult,
  RiskFactor,
} from "./fraud-detection.service";

export type {
  DiscrepancyDetails,
  // Reconciliation types
  ReconciliationResult,
} from "./reconciliation.service";
