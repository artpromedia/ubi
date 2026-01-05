/**
 * UBI Fintech Types
 * Type definitions for wallet, P2P, bills, savings, lending, cards, remittances
 */

// ===========================================
// WALLET TYPES
// ===========================================

export type WalletTier = "BASIC" | "VERIFIED" | "PREMIUM" | "BUSINESS";
export type WalletStatus = "ACTIVE" | "FROZEN" | "SUSPENDED" | "CLOSED";
export type KYCLevel = "NONE" | "BASIC" | "STANDARD" | "ENHANCED" | "FULL";

export interface WalletTierLimits {
  tier: WalletTier;
  dailyTransactionLimit: number;
  monthlyTransactionLimit: number;
  singleTransactionLimit: number;
  maxBalance: number;
  p2pEnabled: boolean;
  billsEnabled: boolean;
  cardsEnabled: boolean;
  loansEnabled: boolean;
  internationalEnabled: boolean;
  savingsInterestRate: number;
  maxSavingsPockets: number;
  requiredKycLevel: KYCLevel;
}

export interface WalletBalance {
  currency: string;
  available: number;
  pending: number;
  held: number;
  total: number;
}

export interface WalletInfo {
  id: string;
  userId: string;
  status: WalletStatus;
  tier: WalletTier;
  kycLevel: KYCLevel;
  balances: WalletBalance[];
  dailyLimitUsed: number;
  dailyLimitRemaining: number;
  monthlyLimitUsed: number;
  monthlyLimitRemaining: number;
  features: WalletFeatures;
}

export interface WalletFeatures {
  p2p: boolean;
  bills: boolean;
  cards: boolean;
  loans: boolean;
  international: boolean;
  savings: boolean;
}

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  requiredTier?: WalletTier;
}

// ===========================================
// P2P TRANSFER TYPES
// ===========================================

export type TransferStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "REVERSED";

export interface P2PTransferParams {
  senderWalletId: string;
  recipientIdentifier: string; // Phone, email, or UBI username
  amount: number;
  currency: string;
  note?: string;
  pin?: string;
  idempotencyKey: string;
}

export interface P2PTransferResult {
  transferId: string;
  status: TransferStatus;
  senderName: string;
  recipientName: string;
  recipientPhone?: string;
  amount: number;
  fee: number;
  currency: string;
  note?: string;
  isPending: boolean; // True if recipient not on UBI
  expiresAt?: Date;
  createdAt: Date;
}

export interface MoneyRequestParams {
  requestorWalletId: string;
  responderIdentifier: string;
  amount: number;
  currency: string;
  note?: string;
  expiresInHours?: number;
}

export interface MoneyRequestResult {
  requestId: string;
  status: TransferStatus;
  requestorName: string;
  responderPhone?: string;
  amount: number;
  currency: string;
  note?: string;
  expiresAt: Date;
  shareLink: string;
}

export interface Beneficiary {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  bankCode?: string;
  accountNumber?: string;
  accountName?: string;
  type: "p2p" | "bank" | "mobile_money";
  isFavorite: boolean;
  lastUsedAt?: Date;
}

export interface BeneficiaryParams {
  walletId: string;
  name: string;
  identifier: string;
  identifierType: "phone" | "email" | "username";
  isFrequent?: boolean;
}

// ===========================================
// BILL PAYMENT TYPES
// ===========================================

export type BillCategory =
  | "AIRTIME"
  | "DATA"
  | "ELECTRICITY"
  | "WATER"
  | "TV"
  | "INTERNET"
  | "EDUCATION"
  | "GOVERNMENT"
  | "INSURANCE"
  | "OTHER";

export type BillPaymentStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "REFUNDED";

export interface BillProvider {
  id: string;
  code: string;
  name: string;
  shortName: string;
  logo?: string;
  category: BillCategory;
  country: string;
  currency: string;
  inputFields: BillInputField[];
  processingTime: string;
  minAmount?: number;
  maxAmount?: number;
  fee: BillFee;
}

export interface BillInputField {
  name: string;
  label: string;
  type: "text" | "number" | "phone" | "select";
  placeholder?: string;
  required: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  options?: { value: string; label: string }[];
}

export interface BillFee {
  fixed: number;
  percentage: number;
}

export interface BillValidationResult {
  valid: boolean;
  customerName?: string;
  amount?: number; // For postpaid bills
  minimumAmount?: number;
  maximumAmount?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface BillPaymentParams {
  walletId: string;
  providerId: string;
  customerParams: Record<string, string>;
  amount: number;
  pin?: string;
  idempotencyKey: string;
}

export interface BillPaymentResult {
  paymentId: string;
  status: BillPaymentStatus;
  providerName: string;
  customerName?: string;
  amount: number;
  fee: number;
  totalAmount: number;
  currency: string;
  token?: string; // Electricity token, airtime PIN
  reference: string;
  createdAt: Date;
}

export interface ScheduledBillPayment {
  id: string;
  providerId: string;
  providerName: string;
  customerParams: Record<string, string>;
  amount?: number;
  frequency: "weekly" | "monthly" | "custom";
  nextRunDate: Date;
  lastRunDate?: Date;
  lastRunStatus?: string;
  isActive: boolean;
}

// ===========================================
// QR PAYMENT TYPES
// ===========================================

export type QRCodeType = "static" | "dynamic" | "STATIC_FIXED" | "STATIC_VARIABLE" | "DYNAMIC";

export interface MerchantQRCode {
  id: string;
  merchantId: string;
  walletId: string;
  name: string;
  type: QRCodeType;
  qrData: string;
  location?: string;
  defaultCurrency: string;
  fixedAmount?: number;
  isActive: boolean;
  totalTransactions: number;
  totalAmount: number;
  createdAt?: Date;
  lastUsedAt?: Date;
}

export interface QRPayload {
  version: string;
  type: QRCodeType;
  merchantId?: string;
  walletId?: string;
  qrId?: string;
  amount?: number;
  currency?: string;
  description?: string;
  expiresAt?: string;
}

export interface QRPaymentParams {
  payerWalletId: string;
  qrData: string;
  amount?: number; // Required for open-amount QR
  pin?: string;
  note?: string;
}

export interface QRPaymentResult {
  paymentId: string;
  status: TransferStatus;
  amount: number;
  currency: string;
  recipientName?: string;
  note?: string;
  direction?: string;
  createdAt?: Date;
  completedAt?: Date;
}

export interface DynamicQRParams {
  walletId: string;
  amount: number;
  currency: string;
  description?: string;
  expiryMinutes?: number;
}

export interface DynamicQRResult {
  qrId: string;
  qrData: string;
  amount: number;
  currency: string;
  description?: string;
  expiresAt: Date;
}

// ===========================================
// SAVINGS TYPES
// ===========================================

export type SavingsPocketStatus =
  | "ACTIVE"
  | "LOCKED"
  | "MATURED"
  | "WITHDRAWN"
  | "CLOSED";
export type AutoSaveFrequency =
  | "DAILY"
  | "WEEKLY"
  | "BIWEEKLY"
  | "MONTHLY"
  | "PER_TRANSACTION";

export interface SavingsPocket {
  id: string;
  name: string;
  description?: string;
  targetAmount?: number;
  targetDate?: Date;
  currentBalance: number;
  currency: string;
  icon: string;
  color: string;
  interestRate: number;
  accruedInterest: number;
  status: SavingsPocketStatus;
  isLocked: boolean;
  lockPenaltyRate: number;
  progress: number; // Percentage towards target
  autoSave?: AutoSaveConfig;
  roundUp?: RoundUpConfig;
  createdAt: Date;
}

export interface AutoSaveConfig {
  enabled: boolean;
  amount: number;
  frequency: AutoSaveFrequency;
  day?: number;
  nextDate?: Date;
}

export interface RoundUpConfig {
  enabled: boolean;
  multiplier: number; // 1x, 2x, 5x, 10x
}

export interface CreatePocketParams {
  walletId: string;
  name: string;
  description?: string;
  targetAmount?: number;
  targetDate?: Date;
  currency: string;
  icon?: string;
  color?: string;
  isLocked?: boolean;
  autoSave?: AutoSaveConfig;
  roundUp?: RoundUpConfig;
}

export interface SavingsTransaction {
  id: string;
  pocketId: string;
  type: "deposit" | "withdrawal" | "interest" | "bonus" | "penalty";
  amount: number;
  balanceAfter: number;
  source: "manual" | "auto_save" | "round_up" | "interest" | "cashback";
  description?: string;
  createdAt: Date;
}

export interface InterestSummary {
  pocketId: string;
  totalAccrued: number;
  totalPaid: number;
  pendingPayment: number;
  annualRate: number;
  nextPaymentDate?: Date;
}

// ===========================================
// CREDIT & LENDING TYPES
// ===========================================

export type LoanStatus =
  | "APPLIED"
  | "APPROVED"
  | "DISBURSED"
  | "ACTIVE"
  | "PAID"
  | "OVERDUE"
  | "DEFAULTED"
  | "WRITTEN_OFF";

export type LoanProductType =
  | "PERSONAL"
  | "DRIVER_ADVANCE"
  | "MERCHANT_WORKING_CAPITAL"
  | "SALARY_ADVANCE"
  | "EMERGENCY";

export interface CreditScore {
  userId: string;
  score: number; // 300-850
  grade: "A" | "B" | "C" | "D" | "F";
  eligibleAmount: number;
  maxInterestRate: number;
  factors: CreditFactor[];
  calculatedAt: Date;
  expiresAt: Date;
}

export interface CreditFactor {
  name: string;
  weight: number;
  score: number;
  impact: "positive" | "negative" | "neutral";
  details: string;
}

export interface CreditScoreResult {
  userId: string;
  score: number;
  category: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  categoryLabel: string;
  factors: CreditFactor[];
  trend: "UP" | "DOWN" | "STABLE" | "NEW";
  previousScore?: number;
  calculatedAt: Date;
  validUntil: Date;
}

export interface LoanProduct {
  id: string;
  code: string;
  name: string;
  description?: string;
  type: LoanProductType;
  minAmount: number;
  maxAmount: number;
  minTermDays: number;
  maxTermDays: number;
  baseInterestRate: number;
  originationFeeRate: number;
  lateFeeRate: number;
  requiredCreditGrade: string[];
  autoDebitEnabled: boolean;
  earningsDeductionRate?: number;
}

export interface LoanApplication {
  walletId: string;
  productId: string;
  amount: number;
  termDays: number;
  purpose?: string;
  idempotencyKey: string;
}

export interface LoanQuote {
  productId: string;
  principalAmount: number;
  interestRate: number;
  originationFee: number;
  totalInterest: number;
  totalAmount: number;
  disbursedAmount: number;
  termDays: number;
  monthlyPayment: number;
  dueDate: Date;
  schedule: LoanScheduleItem[];
}

export interface LoanScheduleItem {
  installmentNumber: number;
  dueDate: Date;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  status: "PENDING" | "PAID" | "OVERDUE" | "WAIVED" | "PARTIAL";
  paidAmount: number;
}

export interface Loan {
  id: string;
  productName: string;
  principalAmount: number;
  interestRate: number;
  totalAmount: number;
  disbursedAmount: number;
  outstandingBalance: number;
  currency: string;
  termDays: number;
  status: LoanStatus;
  nextPaymentDate?: Date;
  nextPaymentAmount?: number;
  dueDate: Date;
  disbursedAt?: Date;
  paidAt?: Date;
  schedule: LoanScheduleItem[];
}

export interface LoanRepaymentParams {
  loanId: string;
  amount: number;
  source: "manual" | "auto_debit" | "earnings_deduction";
  walletId?: string;
}

// ===========================================
// CARD TYPES
// ===========================================

export type CardType = "VIRTUAL" | "PHYSICAL";
export type CardStatus =
  | "PENDING"
  | "ACTIVE"
  | "FROZEN"
  | "BLOCKED"
  | "EXPIRED"
  | "CANCELLED";
export type CardNetwork = "VISA" | "MASTERCARD" | "VERVE";

export interface Card {
  id: string;
  type: CardType;
  network: CardNetwork;
  status: CardStatus;
  lastFour: string;
  expiryMonth: number;
  expiryYear: number;
  cardholderName: string;
  currency: string;
  limits: CardLimits;
  controls: CardControls;
  deliveryStatus?: string;
  createdAt: Date;
}

export interface CardDetails extends Card {
  cardNumber: string; // Full PAN (only for virtual cards display)
  cvv: string;
  expiryDate: string;
}

export interface CardLimits {
  daily?: number;
  monthly?: number;
  perTransaction?: number;
}

export interface CardControls {
  allowOnline: boolean;
  allowInternational: boolean;
  allowAtm: boolean;
  allowedCategories: string[];
  blockedCategories: string[];
}

export interface CreateCardParams {
  walletId: string;
  type: CardType;
  network?: CardNetwork;
  currency: string;
  cardholderName?: string;
  limits?: CardLimits;
  controls?: CardControls;
  deliveryAddress?: Address; // For physical cards
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface CardTransaction {
  id: string;
  cardId: string;
  type: "purchase" | "atm_withdrawal" | "refund" | "reversal";
  amount: number;
  currency: string;
  merchantName?: string;
  merchantCategory?: string;
  merchantCity?: string;
  merchantCountry?: string;
  status: "pending" | "completed" | "declined" | "reversed";
  declineReason?: string;
  createdAt: Date;
}

export interface CardAuthorizationRequest {
  cardId: string;
  amount: number;
  currency: string;
  merchantName: string;
  merchantCategory: string;
  merchantCity?: string;
  merchantCountry?: string;
  transactionId: string;
}

export interface CardAuthorizationResult {
  approved: boolean;
  authorizationCode?: string;
  declineReason?: string;
  availableBalance?: number;
}

// ===========================================
// REMITTANCE TYPES
// ===========================================

export type RemittanceStatus =
  | "QUOTED"
  | "INITIATED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "REFUNDED"
  | "CANCELLED";

export type RemittanceProvider =
  | "WISE"
  | "WORLDREMIT"
  | "CHIPPER"
  | "FLUTTERWAVE"
  | "INTERNAL";

export interface RemittanceCorridor {
  sourceCountry: string;
  sourceCurrency: string;
  destinationCountry: string;
  destinationCurrency: string;
  providers: RemittanceProvider[];
  minAmount: number;
  maxAmount: number;
}

export interface RemittanceQuoteParams {
  sendAmount: number;
  sendCurrency: string;
  receiveCurrency: string;
  destinationCountry: string;
  deliveryMethod: "bank_transfer" | "mobile_money" | "cash_pickup";
}

export interface RemittanceQuote {
  provider: RemittanceProvider;
  sendAmount: number;
  sendCurrency: string;
  receiveAmount: number;
  receiveCurrency: string;
  exchangeRate: number;
  fee: number;
  totalAmount: number;
  deliveryTime: string;
  deliveryMethod: string;
  expiresAt: Date;
}

export interface RemittanceParams {
  walletId: string;
  provider: RemittanceProvider;
  sendAmount: number;
  sendCurrency: string;
  receiveCurrency: string;
  recipientName: string;
  recipientCountry: string;
  recipientPhone?: string;
  recipientEmail?: string;
  recipientBank?: string;
  recipientAccount?: string;
  deliveryMethod: "bank_transfer" | "mobile_money" | "cash_pickup";
  purposeOfTransfer?: string;
  sourceOfFunds?: string;
  pin?: string;
  idempotencyKey: string;
}

export interface Remittance {
  id: string;
  provider: RemittanceProvider;
  sendAmount: number;
  sendCurrency: string;
  receiveAmount: number;
  receiveCurrency: string;
  exchangeRate: number;
  fee: number;
  totalAmount: number;
  status: RemittanceStatus;
  recipientName: string;
  recipientCountry: string;
  deliveryMethod: string;
  trackingNumber?: string;
  estimatedDelivery?: Date;
  completedAt?: Date;
  createdAt: Date;
}

// ===========================================
// KYC TYPES
// ===========================================

export type KYCStatus =
  | "PENDING"
  | "IN_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED";

export interface KYCRequirements {
  level: KYCLevel;
  requiredDocuments: string[];
  requiredFields: string[];
  description: string;
  benefits: string[];
}

export interface KYCSubmission {
  walletId: string;
  level: KYCLevel;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: Date;
  nationality?: string;
  idType?: "passport" | "national_id" | "drivers_license";
  idNumber?: string;
  idExpiryDate?: Date;
  idFrontUrl?: string;
  idBackUrl?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  addressProofUrl?: string;
  selfieUrl?: string;
  bvn?: string; // Nigeria
  nin?: string; // Nigeria
}

export interface KYCResult {
  recordId: string;
  level: KYCLevel;
  status: KYCStatus;
  submittedAt: Date;
  reviewedAt?: Date;
  rejectionReason?: string;
  expiresAt?: Date;
}
