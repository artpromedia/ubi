-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('RIDER', 'DRIVER', 'RESTAURANT', 'MERCHANT', 'FLEET_MANAGER', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('PENDING', 'SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RideType" AS ENUM ('ECONOMY', 'COMFORT', 'PREMIUM', 'XL', 'MOTO');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'WALLET', 'MPESA', 'MTN_MOMO', 'AIRTEL_MONEY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'PICKED_UP', 'DELIVERING', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('SEDAN', 'SUV', 'VAN', 'MOTORCYCLE', 'ELECTRIC');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('NGN', 'KES', 'ZAR', 'GHS', 'RWF', 'ETB', 'USD');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('USER_WALLET', 'DRIVER_WALLET', 'RESTAURANT_WALLET', 'UBI_COMMISSION', 'UBI_FLOAT', 'CEERION_ESCROW', 'PROMOTIONAL', 'REFUND_RESERVE');

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('WALLET_TOPUP', 'WALLET_WITHDRAWAL', 'RIDE_PAYMENT', 'RIDE_REFUND', 'FOOD_PAYMENT', 'FOOD_REFUND', 'DELIVERY_PAYMENT', 'DRIVER_EARNING', 'COMMISSION_DEDUCTION', 'CEERION_DEDUCTION', 'INCENTIVE_BONUS', 'PROMOTIONAL_CREDIT', 'TIP', 'SETTLEMENT_PAYOUT', 'INTERNAL_TRANSFER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CARD', 'MOBILE_MONEY', 'BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK', 'FLUTTERWAVE', 'MPESA', 'MTN_MOMO_GH', 'MTN_MOMO_RW', 'MTN_MOMO_UG', 'AIRTEL_MONEY', 'TELEBIRR', 'ORANGE_MONEY');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskAction" AS ENUM ('ALLOW', 'REVIEW', 'REQUIRE_3DS', 'BLOCK');

-- CreateEnum
CREATE TYPE "FareSplitStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'PARTIALLY_PAID', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FareSplitParticipantStatus" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED', 'PAID', 'FAILED', 'REFUNDED', 'PENDING_FALLBACK');

-- CreateEnum
CREATE TYPE "SplitType" AS ENUM ('EQUAL', 'CUSTOM', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "VehicleFinancingStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'FINANCED', 'PAID_OFF', 'DEFAULTED', 'REPOSSESSED');

-- CreateEnum
CREATE TYPE "FinancingApplicationStatus" AS ENUM ('PENDING', 'REVIEWING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FinancingPlanType" AS ENUM ('LEASE_TO_OWN', 'RENT_TO_OWN', 'LOAN');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'RIDER',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "avatar_url" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "country" CHAR(2) NOT NULL,
    "language" VARCHAR(5) NOT NULL DEFAULT 'en',
    "currency" "Currency" NOT NULL DEFAULT 'NGN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "device_type" TEXT,
    "device_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "default_payment" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "total_rides" INTEGER NOT NULL DEFAULT 0,
    "total_spent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "referral_code" TEXT NOT NULL,
    "referred_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_places" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rider_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "place_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'other',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "license_number" TEXT NOT NULL,
    "license_expiry" TIMESTAMP(3) NOT NULL,
    "vehicle_id" UUID,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "is_available" BOOLEAN NOT NULL DEFAULT false,
    "current_latitude" DOUBLE PRECISION,
    "current_longitude" DOUBLE PRECISION,
    "last_location_update" TIMESTAMP(3),
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "total_rides" INTEGER NOT NULL DEFAULT 0,
    "total_earnings" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "acceptance_rate" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "cancellation_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "plate_number" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "is_electric" BOOLEAN NOT NULL DEFAULT false,
    "insurance_expiry" TIMESTAMP(3),
    "inspection_expiry" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_earnings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driver_id" UUID NOT NULL,
    "ride_id" UUID,
    "order_id" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rider_id" UUID NOT NULL,
    "driver_id" UUID,
    "status" "RideStatus" NOT NULL DEFAULT 'PENDING',
    "ride_type" "RideType" NOT NULL,
    "pickup_address" TEXT NOT NULL,
    "pickup_latitude" DOUBLE PRECISION NOT NULL,
    "pickup_longitude" DOUBLE PRECISION NOT NULL,
    "dropoff_address" TEXT NOT NULL,
    "dropoff_latitude" DOUBLE PRECISION NOT NULL,
    "dropoff_longitude" DOUBLE PRECISION NOT NULL,
    "estimated_fare" DECIMAL(12,2) NOT NULL,
    "actual_fare" DECIMAL(12,2),
    "currency" "Currency" NOT NULL,
    "surge_multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "estimated_distance" DOUBLE PRECISION NOT NULL,
    "estimated_duration" INTEGER NOT NULL,
    "actual_distance" DOUBLE PRECISION,
    "actual_duration" INTEGER,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "payment_method" "PaymentMethod" NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "rider_rating" DOUBLE PRECISION,
    "driver_rating" DOUBLE PRECISION,
    "cancellation_reason" TEXT,
    "cancelled_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "account_type" "AccountType" NOT NULL,
    "currency" "Currency" NOT NULL,
    "balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "available_balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "held_balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "entry_type" "EntryType" NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "balance_after" DECIMAL(19,4) NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idempotency_key" TEXT NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "fee" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "token" TEXT NOT NULL,
    "last_four" TEXT,
    "brand" TEXT,
    "phone_number" TEXT,
    "bank_code" TEXT,
    "account_number" TEXT,
    "account_name" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "payment_method_id" UUID,
    "transaction_id" UUID,
    "provider" "PaymentProvider" NOT NULL,
    "provider_reference" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "provider_response" JSONB,
    "webhook_received" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_holds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "reason" TEXT NOT NULL,
    "reference" TEXT,
    "is_released" BOOLEAN NOT NULL DEFAULT false,
    "released_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balance_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "driver_id" UUID NOT NULL,
    "transaction_id" UUID,
    "amount" DECIMAL(19,4) NOT NULL,
    "fee" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "provider" "PaymentProvider" NOT NULL,
    "provider_reference" TEXT,
    "payout_method" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT,
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_transaction_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "action" "RiskAction" NOT NULL,
    "device_fingerprint" TEXT,
    "ip_address" TEXT,
    "ip_location" JSONB,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "review_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_factors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "risk_assessment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "details" TEXT,
    "metadata" JSONB,

    CONSTRAINT "risk_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "date" TIMESTAMP(3) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "currency" "Currency" NOT NULL,
    "total_internal" INTEGER NOT NULL,
    "total_provider" INTEGER NOT NULL,
    "matched" INTEGER NOT NULL,
    "unmatched_internal" INTEGER NOT NULL,
    "unmatched_provider" INTEGER NOT NULL,
    "discrepancies" INTEGER NOT NULL,
    "internal_amount" DECIMAL(19,4) NOT NULL,
    "provider_amount" DECIMAL(19,4) NOT NULL,
    "amount_difference" DECIMAL(19,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "notes" TEXT,
    "report_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_discrepancies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reconciliation_report_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "transaction_id" UUID,
    "provider_reference" TEXT,
    "ubi_amount" DECIMAL(19,4),
    "provider_amount" DECIMAL(19,4),
    "difference" DECIMAL(19,4),
    "currency" "Currency" NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_discrepancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_reconciliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "date" TIMESTAMP(3) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "currency" "Currency" NOT NULL,
    "ubi_balance" DECIMAL(19,4) NOT NULL,
    "provider_balance" DECIMAL(19,4) NOT NULL,
    "difference" DECIMAL(19,4) NOT NULL,
    "percentage_diff" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_id" UUID NOT NULL,
    "recipient_type" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "gross_amount" DECIMAL(19,4) NOT NULL,
    "ubi_commission" DECIMAL(19,4) NOT NULL,
    "ceerion_deduction" DECIMAL(19,4) NOT NULL,
    "settlement_fee" DECIMAL(19,4) NOT NULL,
    "net_amount" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payout_method" TEXT NOT NULL,
    "payout_destination" JSONB NOT NULL,
    "provider_reference" TEXT,
    "processed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "initiated_by" UUID NOT NULL,
    "processed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" UUID,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "PaymentProvider" NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_retry_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_transaction_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "provider_reference" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_health" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" "PaymentProvider" NOT NULL,
    "is_healthy" BOOLEAN NOT NULL DEFAULT true,
    "last_check_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "avg_response_time" INTEGER,
    "success_rate" DOUBLE PRECISION,
    "last_incident_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_health_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "image_url" TEXT,
    "cover_url" TEXT,
    "cuisine_types" TEXT[],
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "is_open" BOOLEAN NOT NULL DEFAULT false,
    "opening_hours" JSONB,
    "minimum_order" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimated_delivery_time" INTEGER NOT NULL DEFAULT 30,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "image_url" TEXT,
    "category" TEXT NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rider_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "delivery_fee" DECIMAL(12,2) NOT NULL,
    "service_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tip" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "delivery_address" TEXT NOT NULL,
    "delivery_latitude" DOUBLE PRECISION NOT NULL,
    "delivery_longitude" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "payment_method" "PaymentMethod" NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "estimated_delivery" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "food_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "options" JSONB,
    "notes" TEXT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "total_shipments" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sender_id" UUID NOT NULL,
    "merchant_id" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "pickup_address" TEXT NOT NULL,
    "pickup_latitude" DOUBLE PRECISION NOT NULL,
    "pickup_longitude" DOUBLE PRECISION NOT NULL,
    "pickup_contact" TEXT NOT NULL,
    "pickup_phone" TEXT NOT NULL,
    "dropoff_address" TEXT NOT NULL,
    "dropoff_latitude" DOUBLE PRECISION NOT NULL,
    "dropoff_longitude" DOUBLE PRECISION NOT NULL,
    "dropoff_contact" TEXT NOT NULL,
    "dropoff_phone" TEXT NOT NULL,
    "package_size" TEXT NOT NULL,
    "package_weight" DOUBLE PRECISION,
    "package_description" TEXT NOT NULL,
    "is_fragile" BOOLEAN NOT NULL DEFAULT false,
    "requires_signature" BOOLEAN NOT NULL DEFAULT false,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "estimated_pickup" TIMESTAMP(3),
    "estimated_delivery" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "payment_method" "PaymentMethod" NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "tracking_number" TEXT NOT NULL,
    "proof_of_delivery" TEXT,
    "signature" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceerion_vehicles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "vehicle_id" UUID NOT NULL,
    "financing_status" TEXT NOT NULL DEFAULT 'active',
    "total_amount" DECIMAL(12,2) NOT NULL,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount_remaining" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL,
    "weekly_payment" DECIMAL(12,2) NOT NULL,
    "payment_day" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ceerion_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceerion_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ceerion_vehicle_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ceerion_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fare_splits" (
    "id" TEXT NOT NULL,
    "ride_id" TEXT NOT NULL,
    "order_id" TEXT,
    "initiator_user_id" UUID NOT NULL,
    "total_amount" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "split_type" "SplitType" NOT NULL DEFAULT 'EQUAL',
    "status" "FareSplitStatus" NOT NULL DEFAULT 'PENDING',
    "participant_count" INTEGER NOT NULL,
    "paid_count" INTEGER NOT NULL DEFAULT 0,
    "amount_collected" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "amount_pending" DECIMAL(19,4) NOT NULL,
    "primary_payer_fallback_enabled" BOOLEAN NOT NULL DEFAULT true,
    "fallback_amount" DECIMAL(19,4),
    "invitation_expires_at" TIMESTAMP(3) NOT NULL,
    "payment_deadline" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fare_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fare_split_participants" (
    "id" TEXT NOT NULL,
    "fare_split_id" TEXT NOT NULL,
    "user_id" UUID,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "percentage" DECIMAL(5,2),
    "status" "FareSplitParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "invitation_token" TEXT NOT NULL,
    "invitation_sent_at" TIMESTAMP(3),
    "invitation_accepted_at" TIMESTAMP(3),
    "payment_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "notification_channel" VARCHAR(20) NOT NULL,
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "last_reminder_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fare_split_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_marketplace_listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "mileage" INTEGER,
    "condition" VARCHAR(20) NOT NULL,
    "vehicle_type" "VehicleType" NOT NULL,
    "fuel_type" VARCHAR(20) NOT NULL,
    "transmission" VARCHAR(20) NOT NULL,
    "engine_capacity" VARCHAR(20),
    "description" TEXT,
    "images" TEXT[],
    "list_price" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "financing_available" BOOLEAN NOT NULL DEFAULT true,
    "min_down_payment" DECIMAL(19,4),
    "max_financing_term" INTEGER,
    "location" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "status" "VehicleFinancingStatus" NOT NULL DEFAULT 'AVAILABLE',
    "seller_id" UUID,
    "seller_type" VARCHAR(20) NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_financing_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "applicant_user_id" UUID NOT NULL,
    "vehicle_listing_id" UUID NOT NULL,
    "requested_amount" DECIMAL(19,4) NOT NULL,
    "down_payment_amount" DECIMAL(19,4) NOT NULL,
    "requested_term_months" INTEGER NOT NULL,
    "plan_type" "FinancingPlanType" NOT NULL,
    "currency" "Currency" NOT NULL,
    "monthly_income" DECIMAL(19,4),
    "employment_status" VARCHAR(50),
    "driving_experience_years" INTEGER,
    "ubi_driver_id" UUID,
    "credit_score" INTEGER,
    "credit_grade" VARCHAR(10),
    "risk_level" VARCHAR(20),
    "avg_monthly_earnings" DECIMAL(19,4),
    "total_earnings_last_12mo" DECIMAL(19,4),
    "on_time_payment_rate" DECIMAL(5,2),
    "platform_tenure_months" INTEGER,
    "status" "FinancingApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "approved_amount" DECIMAL(19,4),
    "approved_term_months" INTEGER,
    "approved_interest_rate" DECIMAL(5,4),
    "monthly_payment_amount" DECIMAL(19,4),
    "rejection_reason" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "expires_at" TIMESTAMP(3),
    "documents" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_financing_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_financings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "driver_user_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "plan_type" "FinancingPlanType" NOT NULL,
    "principal_amount" DECIMAL(19,4) NOT NULL,
    "down_payment_paid" DECIMAL(19,4) NOT NULL,
    "interest_rate" DECIMAL(5,4) NOT NULL,
    "term_months" INTEGER NOT NULL,
    "monthly_payment" DECIMAL(19,4) NOT NULL,
    "total_interest" DECIMAL(19,4) NOT NULL,
    "total_payable" DECIMAL(19,4) NOT NULL,
    "currency" "Currency" NOT NULL,
    "amount_paid" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "amount_remaining" DECIMAL(19,4) NOT NULL,
    "next_payment_due" TIMESTAMP(3),
    "next_payment_amount" DECIMAL(19,4),
    "payments_completed" INTEGER NOT NULL DEFAULT 0,
    "payments_remaining" INTEGER NOT NULL,
    "missed_payments" INTEGER NOT NULL DEFAULT 0,
    "late_payments" INTEGER NOT NULL DEFAULT 0,
    "auto_deduct_enabled" BOOLEAN NOT NULL DEFAULT true,
    "auto_deduct_percentage" DECIMAL(5,2),
    "auto_deduct_day" INTEGER,
    "min_earnings_threshold" DECIMAL(19,4),
    "status" "VehicleFinancingStatus" NOT NULL DEFAULT 'FINANCED',
    "start_date" TIMESTAMP(3) NOT NULL,
    "expected_end_date" TIMESTAMP(3) NOT NULL,
    "actual_end_date" TIMESTAMP(3),
    "defaulted_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_financings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_financing_payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "financing_id" UUID NOT NULL,
    "payment_number" INTEGER NOT NULL,
    "principal_amount" DECIMAL(19,4) NOT NULL,
    "interest_amount" DECIMAL(19,4) NOT NULL,
    "late_fee" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(19,4) NOT NULL,
    "amount_paid" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "currency" "Currency" NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "grace_period_ends" TIMESTAMP(3),
    "payment_source" VARCHAR(50),
    "transaction_id" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "is_auto_deducted" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_financing_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "platform" VARCHAR(20) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "timezone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "city_config_versions" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "activated_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "approved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "city_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_change_requests" (
    "id" TEXT NOT NULL,
    "city_id" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "config_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_approvals" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "config_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "description" TEXT,
    "default_on" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "flag_rules" (
    "id" TEXT NOT NULL,
    "flag_key" TEXT NOT NULL,
    "city_id" TEXT,
    "segment" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flag_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "from_version" INTEGER,
    "to_version" INTEGER NOT NULL,
    "sequence" BIGINT,
    "city_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "correlation_id" TEXT,
    "causation_id" TEXT,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "safe_mode_until" TIMESTAMP(3),
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "pin_hash" TEXT,
    "pin_failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_until" TIMESTAMP(3),
    "cooling_until" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "description" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT,
    "case_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "wallet_id" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "counterpart_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "from_wallet" TEXT,
    "to_wallet" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL,
    "risk_hold_reason" TEXT,
    "entry_id" TEXT,
    "idempotency_key" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_requests" (
    "id" TEXT NOT NULL,
    "from_user" TEXT NOT NULL,
    "to_user" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "ride_id" TEXT,
    "status" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nip_transfers" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "account_name" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "session_id" TEXT,
    "entry_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "reversed_at" TIMESTAMP(3),
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nip_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topups" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "method_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "psp_ref" TEXT,
    "entry_id" TEXT,
    "saga_transfer_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statements" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "opening_minor" BIGINT NOT NULL,
    "in_minor" BIGINT NOT NULL,
    "out_minor" BIGINT NOT NULL,
    "closing_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "file_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "split_rules" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "fleet_id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount_minor" BIGINT,
    "currency" TEXT NOT NULL,
    "percent" DECIMAL(5,2),
    "shortfall_policy" TEXT NOT NULL,
    "shortfall_max_weeks" INTEGER,
    "terms_hash" TEXT NOT NULL,
    "signed_at" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "split_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remittances" (
    "id" TEXT NOT NULL,
    "split_rule_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "due_minor" BIGINT NOT NULL,
    "covered_minor" BIGINT NOT NULL DEFAULT 0,
    "carried_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "entry_id" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remittances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" TEXT,
    "model" TEXT,
    "trusted" BOOLEAN NOT NULL DEFAULT false,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_up_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" DECIMAL(5,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "step_up_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sim_swap_signals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sim_swap_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "file_ref" TEXT NOT NULL,
    "expires_at" DATE,
    "status" TEXT NOT NULL,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_cases" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "signals" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "decision" TEXT,
    "decided_by" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "identity_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "face_checks" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "device_id" TEXT,
    "score" DECIMAL(5,4),
    "passed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "face_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_cases" (
    "id" TEXT NOT NULL,
    "user_type" TEXT,
    "user_id" TEXT,
    "subject_type" TEXT,
    "subject_id" TEXT,
    "category" TEXT,
    "status" TEXT NOT NULL,
    "sla_due" TIMESTAMP(3),
    "assignee" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_events" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "actor" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "remedies" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount_minor" BIGINT,
    "currency" TEXT,
    "reason" TEXT,
    "entry_id" TEXT,
    "by_user" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remedies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recon_runs" (
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "unexplained_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "closed_by" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recon_runs_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "recon_rails" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "rail" TEXT NOT NULL,
    "ledger_minor" BIGINT NOT NULL,
    "external_minor" BIGINT NOT NULL,
    "diff_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recon_rails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recon_breaks" (
    "id" TEXT NOT NULL,
    "rail_id" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner" TEXT,
    "deadline" TIMESTAMP(3),
    "resolution_ref" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recon_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_cases" (
    "id" TEXT NOT NULL,
    "ride_id" TEXT,
    "raised_by" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sla_due" TIMESTAMP(3),
    "responder" TEXT,
    "timeline" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safety_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_decisions" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "checks" JSONB,
    "decision" TEXT NOT NULL,
    "reviewers" TEXT[],
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_phone_idx" ON "users"("phone");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "riders_user_id_key" ON "riders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "riders_referral_code_key" ON "riders"("referral_code");

-- CreateIndex
CREATE INDEX "saved_places_rider_id_idx" ON "saved_places"("rider_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_license_number_key" ON "drivers"("license_number");

-- CreateIndex
CREATE INDEX "drivers_is_online_is_available_idx" ON "drivers"("is_online", "is_available");

-- CreateIndex
CREATE INDEX "drivers_current_latitude_current_longitude_idx" ON "drivers"("current_latitude", "current_longitude");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_number_key" ON "vehicles"("plate_number");

-- CreateIndex
CREATE INDEX "driver_earnings_driver_id_created_at_idx" ON "driver_earnings"("driver_id", "created_at");

-- CreateIndex
CREATE INDEX "rides_rider_id_status_idx" ON "rides"("rider_id", "status");

-- CreateIndex
CREATE INDEX "rides_driver_id_status_idx" ON "rides"("driver_id", "status");

-- CreateIndex
CREATE INDEX "rides_status_created_at_idx" ON "rides"("status", "created_at");

-- CreateIndex
CREATE INDEX "wallet_accounts_user_id_idx" ON "wallet_accounts"("user_id");

-- CreateIndex
CREATE INDEX "wallet_accounts_account_type_idx" ON "wallet_accounts"("account_type");

-- CreateIndex
CREATE INDEX "wallet_accounts_currency_idx" ON "wallet_accounts"("currency");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_accounts_user_id_account_type_currency_key" ON "wallet_accounts"("user_id", "account_type", "currency");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_created_at_idx" ON "ledger_entries"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_idempotency_key_key" ON "transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "transactions_status_created_at_idx" ON "transactions"("status", "created_at");

-- CreateIndex
CREATE INDEX "transactions_transaction_type_idx" ON "transactions"("transaction_type");

-- CreateIndex
CREATE INDEX "transactions_idempotency_key_idx" ON "transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at");

-- CreateIndex
CREATE INDEX "payment_methods_user_id_idx" ON "payment_methods"("user_id");

-- CreateIndex
CREATE INDEX "payment_methods_user_id_is_default_idx" ON "payment_methods"("user_id", "is_default");

-- CreateIndex
CREATE INDEX "payment_methods_type_provider_idx" ON "payment_methods"("type", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_transaction_id_key" ON "payment_transactions"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_provider_reference_key" ON "payment_transactions"("provider_reference");

-- CreateIndex
CREATE INDEX "payment_transactions_user_id_status_idx" ON "payment_transactions"("user_id", "status");

-- CreateIndex
CREATE INDEX "payment_transactions_status_created_at_idx" ON "payment_transactions"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_transactions_provider_provider_reference_idx" ON "payment_transactions"("provider", "provider_reference");

-- CreateIndex
CREATE INDEX "payment_transactions_created_at_idx" ON "payment_transactions"("created_at");

-- CreateIndex
CREATE INDEX "balance_holds_account_id_is_released_idx" ON "balance_holds"("account_id", "is_released");

-- CreateIndex
CREATE INDEX "balance_holds_expires_at_idx" ON "balance_holds"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_transaction_id_key" ON "payouts"("transaction_id");

-- CreateIndex
CREATE INDEX "payouts_driver_id_status_idx" ON "payouts"("driver_id", "status");

-- CreateIndex
CREATE INDEX "payouts_status_created_at_idx" ON "payouts"("status", "created_at");

-- CreateIndex
CREATE INDEX "payouts_provider_provider_reference_idx" ON "payouts"("provider", "provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "risk_assessments_payment_transaction_id_key" ON "risk_assessments"("payment_transaction_id");

-- CreateIndex
CREATE INDEX "risk_assessments_user_id_level_idx" ON "risk_assessments"("user_id", "level");

-- CreateIndex
CREATE INDEX "risk_assessments_level_action_idx" ON "risk_assessments"("level", "action");

-- CreateIndex
CREATE INDEX "risk_assessments_created_at_idx" ON "risk_assessments"("created_at");

-- CreateIndex
CREATE INDEX "risk_factors_risk_assessment_id_idx" ON "risk_factors"("risk_assessment_id");

-- CreateIndex
CREATE INDEX "reconciliation_reports_date_provider_idx" ON "reconciliation_reports"("date", "provider");

-- CreateIndex
CREATE INDEX "reconciliation_reports_status_idx" ON "reconciliation_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_reports_date_provider_currency_key" ON "reconciliation_reports"("date", "provider", "currency");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_reconciliation_report_id_statu_idx" ON "reconciliation_discrepancies"("reconciliation_report_id", "status");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_type_severity_idx" ON "reconciliation_discrepancies"("type", "severity");

-- CreateIndex
CREATE INDEX "reconciliation_discrepancies_status_created_at_idx" ON "reconciliation_discrepancies"("status", "created_at");

-- CreateIndex
CREATE INDEX "balance_reconciliations_provider_date_idx" ON "balance_reconciliations"("provider", "date");

-- CreateIndex
CREATE UNIQUE INDEX "balance_reconciliations_date_provider_currency_key" ON "balance_reconciliations"("date", "provider", "currency");

-- CreateIndex
CREATE INDEX "settlements_recipient_id_recipient_type_idx" ON "settlements"("recipient_id", "recipient_type");

-- CreateIndex
CREATE INDEX "settlements_status_created_at_idx" ON "settlements"("status", "created_at");

-- CreateIndex
CREATE INDEX "settlements_period_start_period_end_idx" ON "settlements"("period_start", "period_end");

-- CreateIndex
CREATE INDEX "refunds_transaction_id_idx" ON "refunds"("transaction_id");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE INDEX "alerts_type_severity_idx" ON "alerts"("type", "severity");

-- CreateIndex
CREATE INDEX "alerts_acknowledged_resolved_idx" ON "alerts"("acknowledged", "resolved");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- CreateIndex
CREATE INDEX "webhook_events_processed_created_at_idx" ON "webhook_events"("processed", "created_at");

-- CreateIndex
CREATE INDEX "webhook_events_provider_event_type_idx" ON "webhook_events"("provider", "event_type");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "disputes_user_id_status_idx" ON "disputes"("user_id", "status");

-- CreateIndex
CREATE INDEX "disputes_status_opened_at_idx" ON "disputes"("status", "opened_at");

-- CreateIndex
CREATE INDEX "disputes_provider_reference_idx" ON "disputes"("provider_reference");

-- CreateIndex
CREATE UNIQUE INDEX "provider_health_provider_key" ON "provider_health"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "restaurants_user_id_key" ON "restaurants"("user_id");

-- CreateIndex
CREATE INDEX "restaurants_latitude_longitude_idx" ON "restaurants"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "restaurants_is_open_rating_idx" ON "restaurants"("is_open", "rating");

-- CreateIndex
CREATE INDEX "menu_items_restaurant_id_category_idx" ON "menu_items"("restaurant_id", "category");

-- CreateIndex
CREATE INDEX "food_orders_rider_id_status_idx" ON "food_orders"("rider_id", "status");

-- CreateIndex
CREATE INDEX "food_orders_restaurant_id_status_idx" ON "food_orders"("restaurant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_user_id_key" ON "merchants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_tracking_number_key" ON "deliveries"("tracking_number");

-- CreateIndex
CREATE INDEX "deliveries_sender_id_status_idx" ON "deliveries"("sender_id", "status");

-- CreateIndex
CREATE INDEX "deliveries_tracking_number_idx" ON "deliveries"("tracking_number");

-- CreateIndex
CREATE UNIQUE INDEX "ceerion_vehicles_vehicle_id_key" ON "ceerion_vehicles"("vehicle_id");

-- CreateIndex
CREATE INDEX "ceerion_payments_ceerion_vehicle_id_status_idx" ON "ceerion_payments"("ceerion_vehicle_id", "status");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_created_at_idx" ON "notifications"("user_id", "read", "created_at");

-- CreateIndex
CREATE INDEX "fare_splits_ride_id_idx" ON "fare_splits"("ride_id");

-- CreateIndex
CREATE INDEX "fare_splits_initiator_user_id_idx" ON "fare_splits"("initiator_user_id");

-- CreateIndex
CREATE INDEX "fare_splits_status_created_at_idx" ON "fare_splits"("status", "created_at");

-- CreateIndex
CREATE INDEX "fare_splits_invitation_expires_at_idx" ON "fare_splits"("invitation_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "fare_split_participants_invitation_token_key" ON "fare_split_participants"("invitation_token");

-- CreateIndex
CREATE INDEX "fare_split_participants_fare_split_id_idx" ON "fare_split_participants"("fare_split_id");

-- CreateIndex
CREATE INDEX "fare_split_participants_user_id_idx" ON "fare_split_participants"("user_id");

-- CreateIndex
CREATE INDEX "fare_split_participants_phone_idx" ON "fare_split_participants"("phone");

-- CreateIndex
CREATE INDEX "fare_split_participants_invitation_token_idx" ON "fare_split_participants"("invitation_token");

-- CreateIndex
CREATE INDEX "fare_split_participants_status_idx" ON "fare_split_participants"("status");

-- CreateIndex
CREATE INDEX "vehicle_marketplace_listings_status_idx" ON "vehicle_marketplace_listings"("status");

-- CreateIndex
CREATE INDEX "vehicle_marketplace_listings_make_model_idx" ON "vehicle_marketplace_listings"("make", "model");

-- CreateIndex
CREATE INDEX "vehicle_marketplace_listings_vehicle_type_idx" ON "vehicle_marketplace_listings"("vehicle_type");

-- CreateIndex
CREATE INDEX "vehicle_marketplace_listings_list_price_idx" ON "vehicle_marketplace_listings"("list_price");

-- CreateIndex
CREATE INDEX "vehicle_marketplace_listings_location_idx" ON "vehicle_marketplace_listings"("location");

-- CreateIndex
CREATE INDEX "vehicle_financing_applications_applicant_user_id_idx" ON "vehicle_financing_applications"("applicant_user_id");

-- CreateIndex
CREATE INDEX "vehicle_financing_applications_vehicle_listing_id_idx" ON "vehicle_financing_applications"("vehicle_listing_id");

-- CreateIndex
CREATE INDEX "vehicle_financing_applications_status_idx" ON "vehicle_financing_applications"("status");

-- CreateIndex
CREATE INDEX "vehicle_financing_applications_created_at_idx" ON "vehicle_financing_applications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_financings_application_id_key" ON "vehicle_financings"("application_id");

-- CreateIndex
CREATE INDEX "vehicle_financings_driver_user_id_idx" ON "vehicle_financings"("driver_user_id");

-- CreateIndex
CREATE INDEX "vehicle_financings_status_idx" ON "vehicle_financings"("status");

-- CreateIndex
CREATE INDEX "vehicle_financings_next_payment_due_idx" ON "vehicle_financings"("next_payment_due");

-- CreateIndex
CREATE INDEX "vehicle_financing_payments_financing_id_idx" ON "vehicle_financing_payments"("financing_id");

-- CreateIndex
CREATE INDEX "vehicle_financing_payments_due_date_idx" ON "vehicle_financing_payments"("due_date");

-- CreateIndex
CREATE INDEX "vehicle_financing_payments_status_idx" ON "vehicle_financing_payments"("status");

-- CreateIndex
CREATE INDEX "device_tokens_user_id_is_active_idx" ON "device_tokens"("user_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_user_id_token_key" ON "device_tokens"("user_id", "token");

-- CreateIndex
CREATE INDEX "cities_active_idx" ON "cities"("active");

-- CreateIndex
CREATE INDEX "city_config_versions_city_id_activated_at_idx" ON "city_config_versions"("city_id", "activated_at");

-- CreateIndex
CREATE UNIQUE INDEX "city_config_versions_city_id_version_key" ON "city_config_versions"("city_id", "version");

-- CreateIndex
CREATE INDEX "config_change_requests_city_id_status_idx" ON "config_change_requests"("city_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "config_approvals_request_id_approver_id_key" ON "config_approvals"("request_id", "approver_id");

-- CreateIndex
CREATE INDEX "flag_rules_city_id_idx" ON "flag_rules"("city_id");

-- CreateIndex
CREATE UNIQUE INDEX "flag_rules_flag_key_city_id_key" ON "flag_rules"("flag_key", "city_id");

-- CreateIndex
CREATE INDEX "audit_subject" ON "audit_log"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_idempotency_key_key" ON "outbox_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbox_unpublished" ON "outbox_events"("published_at", "occurred_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_to_version_idx" ON "outbox_events"("aggregate_type", "aggregate_id", "to_version");

-- CreateIndex
CREATE INDEX "wallets_owner_id_idx" ON "wallets"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_owner_type_owner_id_currency_key" ON "wallets"("owner_type", "owner_id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_idempotency_key_key" ON "journal_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "journal_entries_kind_occurred_at_idx" ON "journal_entries"("kind", "occurred_at");

-- CreateIndex
CREATE INDEX "journal_entries_reference_idx" ON "journal_entries"("reference");

-- CreateIndex
CREATE INDEX "journal_entries_case_ref_idx" ON "journal_entries"("case_ref");

-- CreateIndex
CREATE INDEX "journal_lines_wallet" ON "journal_lines"("wallet_id");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_created_at_idx" ON "journal_lines"("account", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_idempotency_key_key" ON "transfers"("idempotency_key");

-- CreateIndex
CREATE INDEX "transfers_from_wallet_created_at_idx" ON "transfers"("from_wallet", "created_at");

-- CreateIndex
CREATE INDEX "transfers_to_wallet_created_at_idx" ON "transfers"("to_wallet", "created_at");

-- CreateIndex
CREATE INDEX "transfers_status_idx" ON "transfers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_requests_idempotency_key_key" ON "transfer_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "transfer_requests_from_user_status_idx" ON "transfer_requests"("from_user", "status");

-- CreateIndex
CREATE INDEX "transfer_requests_to_user_status_idx" ON "transfer_requests"("to_user", "status");

-- CreateIndex
CREATE INDEX "transfer_requests_ride_id_idx" ON "transfer_requests"("ride_id");

-- CreateIndex
CREATE INDEX "return_requests_transfer_id_idx" ON "return_requests"("transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "nip_transfers_idempotency_key_key" ON "nip_transfers"("idempotency_key");

-- CreateIndex
CREATE INDEX "nip_transfers_wallet_id_created_at_idx" ON "nip_transfers"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "nip_transfers_status_idx" ON "nip_transfers"("status");

-- CreateIndex
CREATE INDEX "nip_transfers_session_id_idx" ON "nip_transfers"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "topups_idempotency_key_key" ON "topups"("idempotency_key");

-- CreateIndex
CREATE INDEX "topups_wallet_id_created_at_idx" ON "topups"("wallet_id", "created_at");

-- CreateIndex
CREATE INDEX "topups_status_idx" ON "topups"("status");

-- CreateIndex
CREATE UNIQUE INDEX "statements_wallet_id_period_start_period_end_key" ON "statements"("wallet_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "split_rules_driver_id_active_idx" ON "split_rules"("driver_id", "active");

-- CreateIndex
CREATE INDEX "split_rules_fleet_id_idx" ON "split_rules"("fleet_id");

-- CreateIndex
CREATE INDEX "remittances_status_idx" ON "remittances"("status");

-- CreateIndex
CREATE UNIQUE INDEX "remittances_split_rule_id_week_start_key" ON "remittances"("split_rule_id", "week_start");

-- CreateIndex
CREATE INDEX "devices_user_id_trusted_idx" ON "devices"("user_id", "trusted");

-- CreateIndex
CREATE INDEX "step_up_challenges_user_id_status_idx" ON "step_up_challenges"("user_id", "status");

-- CreateIndex
CREATE INDEX "sim_swap_signals_user_id_handled_idx" ON "sim_swap_signals"("user_id", "handled");

-- CreateIndex
CREATE INDEX "sim_swap_signals_phone_idx" ON "sim_swap_signals"("phone");

-- CreateIndex
CREATE INDEX "documents_expiry" ON "documents"("expires_at");

-- CreateIndex
CREATE INDEX "documents_owner_type_owner_id_status_idx" ON "documents"("owner_type", "owner_id", "status");

-- CreateIndex
CREATE INDEX "identity_cases_driver_id_status_idx" ON "identity_cases"("driver_id", "status");

-- CreateIndex
CREATE INDEX "face_checks_driver_id_created_at_idx" ON "face_checks"("driver_id", "created_at");

-- CreateIndex
CREATE INDEX "support_cases_status_sla_due_idx" ON "support_cases"("status", "sla_due");

-- CreateIndex
CREATE INDEX "support_cases_user_id_idx" ON "support_cases"("user_id");

-- CreateIndex
CREATE INDEX "support_cases_subject_type_subject_id_idx" ON "support_cases"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "case_events_case_id_created_at_idx" ON "case_events"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "remedies_case_id_idx" ON "remedies"("case_id");

-- CreateIndex
CREATE INDEX "remedies_entry_id_idx" ON "remedies"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "recon_rails_date_rail_key" ON "recon_rails"("date", "rail");

-- CreateIndex
CREATE INDEX "recon_breaks_rail_id_idx" ON "recon_breaks"("rail_id");

-- CreateIndex
CREATE INDEX "recon_breaks_resolved_at_idx" ON "recon_breaks"("resolved_at");

-- CreateIndex
CREATE INDEX "safety_cases_status_sla_due_idx" ON "safety_cases"("status", "sla_due");

-- CreateIndex
CREATE INDEX "safety_cases_ride_id_idx" ON "safety_cases"("ride_id");

-- CreateIndex
CREATE INDEX "review_decisions_queue_created_at_idx" ON "review_decisions"("queue", "created_at");

-- CreateIndex
CREATE INDEX "review_decisions_subject_type_subject_id_idx" ON "review_decisions"("subject_type", "subject_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_accounts" ADD CONSTRAINT "wallet_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_holds" ADD CONSTRAINT "balance_holds_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "wallet_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_factors" ADD CONSTRAINT "risk_factors_risk_assessment_id_fkey" FOREIGN KEY ("risk_assessment_id") REFERENCES "risk_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_discrepancies" ADD CONSTRAINT "reconciliation_discrepancies_reconciliation_report_id_fkey" FOREIGN KEY ("reconciliation_report_id") REFERENCES "reconciliation_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurants" ADD CONSTRAINT "restaurants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_orders" ADD CONSTRAINT "food_orders_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_orders" ADD CONSTRAINT "food_orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "food_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceerion_vehicles" ADD CONSTRAINT "ceerion_vehicles_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceerion_payments" ADD CONSTRAINT "ceerion_payments_ceerion_vehicle_id_fkey" FOREIGN KEY ("ceerion_vehicle_id") REFERENCES "ceerion_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fare_split_participants" ADD CONSTRAINT "fare_split_participants_fare_split_id_fkey" FOREIGN KEY ("fare_split_id") REFERENCES "fare_splits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_financing_applications" ADD CONSTRAINT "vehicle_financing_applications_vehicle_listing_id_fkey" FOREIGN KEY ("vehicle_listing_id") REFERENCES "vehicle_marketplace_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_financings" ADD CONSTRAINT "vehicle_financings_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "vehicle_financing_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_financing_payments" ADD CONSTRAINT "vehicle_financing_payments_financing_id_fkey" FOREIGN KEY ("financing_id") REFERENCES "vehicle_financings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "city_config_versions" ADD CONSTRAINT "city_config_versions_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_change_requests" ADD CONSTRAINT "config_change_requests_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_approvals" ADD CONSTRAINT "config_approvals_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "config_change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flag_rules" ADD CONSTRAINT "flag_rules_flag_key_fkey" FOREIGN KEY ("flag_key") REFERENCES "feature_flags"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flag_rules" ADD CONSTRAINT "flag_rules_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_wallet_fkey" FOREIGN KEY ("from_wallet") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_wallet_fkey" FOREIGN KEY ("to_wallet") REFERENCES "wallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nip_transfers" ADD CONSTRAINT "nip_transfers_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topups" ADD CONSTRAINT "topups_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topups" ADD CONSTRAINT "topups_saga_transfer_id_fkey" FOREIGN KEY ("saga_transfer_id") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statements" ADD CONSTRAINT "statements_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_split_rule_id_fkey" FOREIGN KEY ("split_rule_id") REFERENCES "split_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_up_challenges" ADD CONSTRAINT "step_up_challenges_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remedies" ADD CONSTRAINT "remedies_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recon_rails" ADD CONSTRAINT "recon_rails_date_fkey" FOREIGN KEY ("date") REFERENCES "recon_runs"("date") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recon_breaks" ADD CONSTRAINT "recon_breaks_rail_id_fkey" FOREIGN KEY ("rail_id") REFERENCES "recon_rails"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

