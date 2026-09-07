/**
 * Payment Services Index
 * UBI Payment System
 *
 * Exports the LAUNCH payment services. Deferred neo-bank fintech, loyalty,
 * B2B, ML, offline and driver-experience services are quarantined out of the
 * build (see ../../tsconfig.json "exclude" and ../../QUARANTINE.md) and are
 * intentionally NOT re-exported here.
 */

// Core Services
export { PaymentGateway } from "../gateway/payment-gateway";
export {
  WalletService,
  createWalletService,
  getWalletService,
} from "./wallet.service";

// Provider Services (from providers folder)
export { MoMoService as MomoService } from "../providers/momo.service";
export { MpesaService } from "../providers/mpesa.service";
export { PaystackService } from "../providers/paystack.service";

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

// Types
export type {
  TopupRequest,
  TransferRequest,
  // Wallet types
  WalletCreation,
  WithdrawalRequest,
} from "./wallet.service";

export type {
  // Payment gateway types
  InitiatePaymentRequest as PaymentRequest,
  InitiatePaymentResponse as PaymentResult,
} from "../gateway/payment-gateway";

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
