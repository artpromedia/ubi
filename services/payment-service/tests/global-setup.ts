/**
 * Global Test Setup
 * UBI Payment Service
 *
 * Runs once before all tests
 */

export async function setup() {
  console.log("\n🧪 Starting Payment Service Test Suite\n");

  // Set test environment
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "error";

  // Database test config
  process.env.DATABASE_URL =
    "postgresql://test:test@localhost:5432/ubi_payment_test?schema=public";

  // Redis test config. PAYMENT_TEST_REDIS_URL points a run at a dedicated
  // logical database (suites that go through the real app hit the rate
  // limiter, which lives in Redis).
  process.env.REDIS_URL =
    process.env.PAYMENT_TEST_REDIS_URL ?? "redis://localhost:6379/15";

  // Provider test keys
  process.env.MPESA_CONSUMER_KEY = "test-consumer-key";
  process.env.MPESA_CONSUMER_SECRET = "test-consumer-secret";
  process.env.MPESA_SHORTCODE = "174379";
  process.env.MPESA_PASSKEY = "test-passkey";
  process.env.MPESA_CALLBACK_URL = "https://test.ubi.africa/webhooks/mpesa";

  process.env.MTN_MOMO_API_KEY = "test-api-key";
  process.env.MTN_MOMO_API_USER = "test-user";
  process.env.MTN_MOMO_SUBSCRIPTION_KEY = "test-subscription-key";
  process.env.MTN_MOMO_CALLBACK_URL = "https://test.ubi.africa/webhooks/momo";

  process.env.PAYSTACK_SECRET_KEY = "sk_test_xxxxxxxxxxxxx";
  process.env.PAYSTACK_PUBLIC_KEY = "pk_test_xxxxxxxxxxxxx";
  process.env.PAYSTACK_WEBHOOK_SECRET = "test-webhook-secret";

  // Service config
  process.env.PORT = "4003";
  process.env.SERVICE_SECRET = "test-service-secret";
  process.env.JWT_SECRET = "test-jwt-secret";

  console.log("✅ Test environment configured\n");
}

export async function teardown() {
  console.log("\n🧹 Cleaning up test environment\n");
  // Cleanup if needed
}
