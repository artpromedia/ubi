/**
 * Vehicle Financing Types
 * Type definitions for vehicle marketplace and financing functionality
 */

import type { Currency, VehicleType } from "@prisma/client";

// ===========================================
// ENUMS & STATUS
// ===========================================

export type VehicleFinancingStatus =
  | "AVAILABLE"
  | "RESERVED"
  | "FINANCED"
  | "PAID_OFF"
  | "DEFAULTED"
  | "REPOSSESSED";

export type FinancingApplicationStatus =
  | "PENDING"
  | "REVIEWING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED";

export type FinancingPlanType = "LEASE_TO_OWN" | "RENT_TO_OWN" | "LOAN";

export type VehicleCondition = "NEW" | "USED" | "CERTIFIED";
export type FuelType = "PETROL" | "DIESEL" | "ELECTRIC" | "HYBRID";
export type TransmissionType = "AUTOMATIC" | "MANUAL";
export type SellerType = "UBI" | "DEALER" | "PRIVATE";

export type PaymentStatus =
  | "PENDING"
  | "PARTIAL"
  | "PAID"
  | "OVERDUE"
  | "WAIVED";

// ===========================================
// VEHICLE MARKETPLACE TYPES
// ===========================================

export interface VehicleMarketplaceListing {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  mileage?: number;
  condition: VehicleCondition;
  vehicleType: VehicleType;
  fuelType: FuelType;
  transmission: TransmissionType;
  engineCapacity?: string;
  description?: string;
  images: string[];

  // Pricing
  listPrice: number;
  currency: Currency;

  // Financing options
  financingAvailable: boolean;
  minDownPayment?: number;
  maxFinancingTerm?: number;

  // Location
  location: string;
  latitude?: number;
  longitude?: number;

  // Status
  status: VehicleFinancingStatus;

  // Seller info
  sellerId?: string;
  sellerType: SellerType;
  sellerName?: string;

  viewCount: number;

  createdAt: Date;
  updatedAt: Date;
}

export interface VehicleListingFilters {
  make?: string;
  model?: string;
  yearMin?: number;
  yearMax?: number;
  priceMin?: number;
  priceMax?: number;
  vehicleType?: VehicleType;
  condition?: VehicleCondition;
  fuelType?: FuelType;
  transmission?: TransmissionType;
  financingAvailable?: boolean;
  location?: string;
  radius?: number; // km
  sortBy?: "price_asc" | "price_desc" | "year_desc" | "newest";
  limit?: number;
  offset?: number;
}

export interface VehicleListingResult {
  listings: VehicleMarketplaceListing[];
  total: number;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// ===========================================
// FINANCING APPLICATION TYPES
// ===========================================

export interface FinancingApplicationParams {
  vehicleListingId: string;
  requestedAmount: number;
  downPaymentAmount: number;
  requestedTermMonths: number;
  planType: FinancingPlanType;
  currency: Currency;

  // Applicant info (some may be auto-filled from profile)
  monthlyIncome?: number;
  employmentStatus?: string;
  drivingExperienceYears?: number;

  // Documents
  documents?: DocumentUpload[];

  notes?: string;
}

export interface DocumentUpload {
  type: DocumentType;
  url: string;
  name: string;
  uploadedAt: Date;
}

export type DocumentType =
  | "DRIVERS_LICENSE"
  | "NATIONAL_ID"
  | "PROOF_OF_INCOME"
  | "BANK_STATEMENT"
  | "PROOF_OF_ADDRESS"
  | "INSURANCE_CERTIFICATE";

export interface FinancingApplication {
  id: string;
  applicantUserId: string;
  vehicleListingId: string;
  vehicleListing?: VehicleMarketplaceListing;

  // Application details
  requestedAmount: number;
  downPaymentAmount: number;
  requestedTermMonths: number;
  planType: FinancingPlanType;
  currency: Currency;

  // Applicant info
  monthlyIncome?: number;
  employmentStatus?: string;
  drivingExperienceYears?: number;
  ubiDriverId?: string;

  // Credit assessment
  creditScore?: number;
  creditGrade?: string;
  riskLevel?: string;

  // UBI earning history
  avgMonthlyEarnings?: number;
  totalEarningsLast12Mo?: number;
  onTimePaymentRate?: number;
  platformTenureMonths?: number;

  // Decision
  status: FinancingApplicationStatus;
  approvedAmount?: number;
  approvedTermMonths?: number;
  approvedInterestRate?: number;
  monthlyPaymentAmount?: number;
  rejectionReason?: string;
  reviewedAt?: Date;
  reviewedBy?: string;
  expiresAt?: Date;

  documents?: DocumentUpload[];
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationDecision {
  approved: boolean;
  amount?: number;
  termMonths?: number;
  interestRate?: number;
  monthlyPayment?: number;
  rejectionReason?: string;
  conditions?: string[];
}

// ===========================================
// FINANCING ELIGIBILITY TYPES
// ===========================================

export interface EligibilityCheckParams {
  userId: string;
  vehicleListingId: string;
  requestedAmount: number;
  requestedTermMonths: number;
}

export interface EligibilityResult {
  eligible: boolean;
  maxEligibleAmount: number;
  maxTermMonths: number;
  estimatedInterestRate: number;
  estimatedMonthlyPayment: number;
  creditScore: number;
  creditGrade: string;
  factors: EligibilityFactor[];
  requirements: EligibilityRequirement[];
  recommendations: string[];
}

export interface EligibilityFactor {
  name: string;
  score: number;
  maxScore: number;
  impact: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  description: string;
}

export interface EligibilityRequirement {
  requirement: string;
  met: boolean;
  details?: string;
}

// ===========================================
// ACTIVE FINANCING TYPES
// ===========================================

export interface VehicleFinancing {
  id: string;
  applicationId: string;
  driverUserId: string;
  vehicleId?: string;

  // Financing details
  planType: FinancingPlanType;
  principalAmount: number;
  downPaymentPaid: number;
  interestRate: number;
  termMonths: number;
  monthlyPayment: number;
  totalInterest: number;
  totalPayable: number;
  currency: Currency;

  // Payment tracking
  amountPaid: number;
  amountRemaining: number;
  nextPaymentDue?: Date;
  nextPaymentAmount?: number;
  paymentsCompleted: number;
  paymentsRemaining: number;
  missedPayments: number;
  latePayments: number;

  // Auto-deduction settings
  autoDeductEnabled: boolean;
  autoDeductPercentage?: number;
  autoDeductDay?: number;
  minEarningsThreshold?: number;

  // Status
  status: VehicleFinancingStatus;
  startDate: Date;
  expectedEndDate: Date;
  actualEndDate?: Date;
  defaultedAt?: Date;

  // Related data
  vehicle?: VehicleInfo;
  paymentSchedule?: FinancingPaymentSchedule[];

  createdAt: Date;
  updatedAt: Date;
}

export interface VehicleInfo {
  id: string;
  make: string;
  model: string;
  year: number;
  plateNumber: string;
  vin?: string;
}

export interface FinancingPaymentSchedule {
  paymentNumber: number;
  dueDate: Date;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  status: PaymentStatus;
  paidAt?: Date;
  amountPaid: number;
  balance: number;
}

// ===========================================
// PAYMENT TYPES
// ===========================================

export interface FinancingPaymentParams {
  financingId: string;
  paymentNumber?: number; // If paying specific payment, otherwise pay next due
  amount?: number; // If partial or extra payment
  paymentSource: PaymentSourceType;
  paymentDetails?: Record<string, unknown>;
}

export type PaymentSourceType =
  | "WALLET"
  | "MPESA"
  | "MTN_MOMO"
  | "CARD"
  | "BANK_TRANSFER"
  | "AUTO_DEDUCT"
  | "MANUAL";

export interface FinancingPaymentResult {
  success: boolean;
  paymentId: string;
  paymentNumber: number;
  amountPaid: number;
  principalPaid: number;
  interestPaid: number;
  lateFee: number;
  totalPaid: number;
  balanceRemaining: number;
  nextPaymentDue?: Date;
  nextPaymentAmount?: number;
  financingStatus: VehicleFinancingStatus;
  isFullyPaid: boolean;
}

export interface FinancingPayment {
  id: string;
  financingId: string;
  paymentNumber: number;
  principalAmount: number;
  interestAmount: number;
  lateFee: number;
  totalAmount: number;
  amountPaid: number;
  currency: Currency;
  dueDate: Date;
  paidAt?: Date;
  gracePeriodEnds?: Date;
  paymentSource?: PaymentSourceType;
  transactionId?: string;
  status: PaymentStatus;
  isAutoDeducted: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ===========================================
// AUTO-DEDUCTION TYPES
// ===========================================

export interface AutoDeductSettings {
  enabled: boolean;
  percentage?: number; // Percentage of earnings to auto-deduct
  fixedAmount?: number; // Or fixed amount per period
  day?: number; // Day of month
  minEarningsThreshold?: number; // Don't deduct if earnings below this
  maxDeductionPercentage?: number; // Max percentage of single earning to deduct
}

export interface AutoDeductResult {
  success: boolean;
  deductedAmount: number;
  financingId: string;
  paymentId?: string;
  earningsId: string;
  originalEarnings: number;
  remainingEarnings: number;
  message?: string;
}

// ===========================================
// SUMMARY & DASHBOARD TYPES
// ===========================================

export interface FinancingSummary {
  userId: string;
  activeFinancings: number;
  totalAmountFinanced: number;
  totalAmountPaid: number;
  totalAmountRemaining: number;
  currency: Currency;
  nextPaymentDue?: Date;
  nextPaymentAmount?: number;
  overduePayments: number;
  overdueAmount: number;
  creditScore?: number;
  creditGrade?: string;
}

export interface FinancingDashboard {
  summary: FinancingSummary;
  activeFinancings: VehicleFinancing[];
  upcomingPayments: UpcomingPayment[];
  recentPayments: FinancingPayment[];
  recommendations: VehicleMarketplaceListing[];
}

export interface UpcomingPayment {
  financingId: string;
  vehicleInfo: string;
  dueDate: Date;
  amount: number;
  currency: Currency;
  isOverdue: boolean;
  daysUntilDue: number;
}

// ===========================================
// CONFIGURATION
// ===========================================

export interface FinancingConfig {
  minDownPaymentPercentage: number;
  maxFinancingTermMonths: number;
  minCreditScore: number;
  baseInterestRate: number;
  lateFeePercentage: number;
  gracePeriodDays: number;
  defaultThresholdMissedPayments: number;
  autoDeductMaxPercentage: number;
}

export const DEFAULT_FINANCING_CONFIG: FinancingConfig = {
  minDownPaymentPercentage: 10,
  maxFinancingTermMonths: 48,
  minCreditScore: 500,
  baseInterestRate: 0.15, // 15% per annum
  lateFeePercentage: 0.05, // 5% of amount due
  gracePeriodDays: 7,
  defaultThresholdMissedPayments: 3,
  autoDeductMaxPercentage: 30, // Max 30% of single earning
};

// ===========================================
// CREDIT SCORING FOR FINANCING
// ===========================================

export interface FinancingCreditFactors {
  ubiEarningsHistory: {
    avgMonthlyEarnings: number;
    totalEarningsLast12Mo: number;
    earningsStability: number; // 0-100
    earningsTrend: "UP" | "STABLE" | "DOWN";
  };
  platformHistory: {
    tenureMonths: number;
    totalTrips: number;
    rating: number;
    acceptanceRate: number;
    cancellationRate: number;
  };
  paymentHistory: {
    onTimePaymentRate: number;
    latePayments: number;
    existingLoansCount: number;
    existingLoansBalance: number;
  };
  kycLevel: string;
  documentVerification: {
    driversLicense: boolean;
    nationalId: boolean;
    proofOfAddress: boolean;
  };
}

export interface FinancingCreditResult {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  maxEligibleAmount: number;
  suggestedInterestRate: number;
  suggestedTermMonths: number;
  factors: FinancingCreditFactors;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH";
  recommendations: string[];
}
