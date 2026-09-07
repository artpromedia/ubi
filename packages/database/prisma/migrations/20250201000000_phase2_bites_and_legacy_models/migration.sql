-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('WELCOME', 'OTP', 'EMAIL_VERIFICATION', 'PASSWORD_RESET', 'SECURITY_ALERT', 'ACCOUNT_LOCKED', 'MARKETING', 'PROMO_CODE', 'RIDE_REQUESTED', 'RIDE_ACCEPTED', 'RIDE_STARTED', 'RIDE_COMPLETED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'ORDER_PLACED', 'ORDER_CONFIRMED', 'ORDER_PREPARING', 'ORDER_DELIVERED', 'FOOD_ORDER_CONFIRMED', 'FOOD_PREPARING', 'FOOD_READY_FOR_PICKUP', 'FOOD_OUT_FOR_DELIVERY', 'FOOD_DELIVERED', 'DELIVERY_CREATED', 'DELIVERY_PICKED_UP', 'DELIVERY_IN_TRANSIT', 'DELIVERY_COMPLETED', 'DELIVERY_DELIVERED', 'PAYMENT_RECEIVED', 'PAYMENT_SUCCESSFUL', 'PAYMENT_FAILED', 'REFUND_PROCESSED', 'SOS_ALERT', 'GENERAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'READY_FOR_PICKUP';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUNDED';

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "driver_id" UUID,
    "type" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "items" JSONB NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "service_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tip" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "delivery_address" JSONB,
    "delivery_instructions" TEXT,
    "estimated_prep_time" INTEGER,
    "customer_note" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "preparing_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "driver_id" UUID,
    "restaurant_rating" INTEGER NOT NULL,
    "food_rating" INTEGER,
    "delivery_rating" INTEGER,
    "overall_rating" DECIMAL(3,2) NOT NULL,
    "comment" TEXT,
    "images" TEXT[],
    "tags" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_review_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_receipts" BOOLEAN NOT NULL DEFAULT true,
    "email_promotions" BOOLEAN NOT NULL DEFAULT false,
    "email_newsletter" BOOLEAN NOT NULL DEFAULT false,
    "email_security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_otp" BOOLEAN NOT NULL DEFAULT true,
    "sms_critical_alerts" BOOLEAN NOT NULL DEFAULT true,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "push_ride_updates" BOOLEAN NOT NULL DEFAULT true,
    "push_food_updates" BOOLEAN NOT NULL DEFAULT true,
    "push_delivery_updates" BOOLEAN NOT NULL DEFAULT true,
    "push_payment_updates" BOOLEAN NOT NULL DEFAULT true,
    "push_promotions" BOOLEAN NOT NULL DEFAULT false,
    "push_news" BOOLEAN NOT NULL DEFAULT false,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "quiet_hours_timezone" TEXT,
    "max_daily_email" INTEGER,
    "max_daily_push" INTEGER,
    "max_daily_sms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT,
    "body" TEXT,
    "recipient" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "external_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "type" "NotificationType" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT,
    "body" TEXT,
    "html_body" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "in_app_notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "action_url" TEXT,
    "image_url" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "in_app_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bites_merchants" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT,
    "trade_name" TEXT,
    "cac_rc" TEXT,
    "tin" TEXT,
    "status" TEXT NOT NULL,
    "approved_at" TIMESTAMP(3),
    "rank_score" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bites_merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_kyb" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "checks" JSONB NOT NULL,
    "permit_file" TEXT,
    "permit_expiry" DATE,
    "reviewed_by" TEXT,
    "decision" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_kyb_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlets" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "address" TEXT,
    "lat" DECIMAL(10,7),
    "lng" DECIMAL(10,7),
    "hours" JSONB,
    "paused_until" TIMESTAMP(3),
    "open" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outlets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bites_menu_items" (
    "id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "category" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "allergens" TEXT[],
    "sold_out_until" TIMESTAMP(3),
    "photo_ref" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bites_menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_groups" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "options" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "subtotal_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "outlet_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "currency" TEXT NOT NULL,
    "payment_intent_id" TEXT,
    "auth_captured" BOOLEAN NOT NULL DEFAULT false,
    "handover_code" TEXT,
    "delivery_code" TEXT,
    "courier_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_issues" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "type" TEXT NOT NULL,
    "photo_ref" TEXT,
    "requested_minor" BIGINT,
    "status" TEXT NOT NULL,
    "merchant_response" TEXT,
    "respond_by" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_payouts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "gross_minor" BIGINT NOT NULL,
    "fees_minor" BIGINT NOT NULL,
    "refunds_minor" BIGINT NOT NULL,
    "net_minor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "entry_id" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menu_categories_restaurant_id_is_active_idx" ON "menu_categories"("restaurant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_order_number_key" ON "restaurant_orders"("order_number");

-- CreateIndex
CREATE INDEX "restaurant_orders_customer_id_created_at_idx" ON "restaurant_orders"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "restaurant_orders_restaurant_id_status_idx" ON "restaurant_orders"("restaurant_id", "status");

-- CreateIndex
CREATE INDEX "restaurant_orders_status_created_at_idx" ON "restaurant_orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_reviews_order_id_key" ON "restaurant_reviews"("order_id");

-- CreateIndex
CREATE INDEX "restaurant_reviews_restaurant_id_created_at_idx" ON "restaurant_reviews"("restaurant_id", "created_at");

-- CreateIndex
CREATE INDEX "restaurant_reviews_customer_id_idx" ON "restaurant_reviews"("customer_id");

-- CreateIndex
CREATE INDEX "restaurant_review_reports_review_id_idx" ON "restaurant_review_reports"("review_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE INDEX "notification_logs_user_id_created_at_idx" ON "notification_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_logs_channel_status_idx" ON "notification_logs"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_name_key" ON "notification_templates"("name");

-- CreateIndex
CREATE INDEX "in_app_notifications_user_id_read_at_idx" ON "in_app_notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "bites_merchants_status_idx" ON "bites_merchants"("status");

-- CreateIndex
CREATE INDEX "merchant_kyb_merchant_id_idx" ON "merchant_kyb"("merchant_id");

-- CreateIndex
CREATE INDEX "outlets_merchant_id_open_idx" ON "outlets"("merchant_id", "open");

-- CreateIndex
CREATE INDEX "bites_menu_items_outlet_id_active_idx" ON "bites_menu_items"("outlet_id", "active");

-- CreateIndex
CREATE INDEX "option_groups_item_id_idx" ON "option_groups"("item_id");

-- CreateIndex
CREATE INDEX "options_group_id_idx" ON "options"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_user_id_outlet_id_key" ON "carts"("user_id", "outlet_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_outlet_id_status_idx" ON "orders"("outlet_id", "status");

-- CreateIndex
CREATE INDEX "orders_courier_id_idx" ON "orders"("courier_id");

-- CreateIndex
CREATE INDEX "order_issues_order_id_idx" ON "order_issues"("order_id");

-- CreateIndex
CREATE INDEX "order_issues_status_respond_by_idx" ON "order_issues"("status", "respond_by");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_payouts_merchant_id_week_start_key" ON "merchant_payouts"("merchant_id", "week_start");

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_reviews" ADD CONSTRAINT "restaurant_reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "restaurant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_reviews" ADD CONSTRAINT "restaurant_reviews_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_reviews" ADD CONSTRAINT "restaurant_reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_review_reports" ADD CONSTRAINT "restaurant_review_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "restaurant_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_kyb" ADD CONSTRAINT "merchant_kyb_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "bites_merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "bites_merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bites_menu_items" ADD CONSTRAINT "bites_menu_items_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "bites_menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "options" ADD CONSTRAINT "options_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "option_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_issues" ADD CONSTRAINT "order_issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_payouts" ADD CONSTRAINT "merchant_payouts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "bites_merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

