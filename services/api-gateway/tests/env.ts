/**
 * Test environment. Imported FIRST by every gateway test file, before any
 * module that reads these variables at import time.
 *
 * The two secrets are deliberately different: `context.ts` refuses to sign when
 * the internal key equals the client-facing key, and that refusal is itself
 * under test.
 */
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.JWT_SECRET = "gateway-test-client-facing-secret-value-01";
process.env.UBI_IDENTITY_SECRET = "gateway-test-internal-identity-secret-01";
process.env.UBI_IDENTITY_KEY_ID = "test-k1";
delete process.env.UBI_IDENTITY_SECRET_PREVIOUS;
delete process.env.REDIS_URL;

export const CLIENT_JWT_SECRET = process.env.JWT_SECRET;
export const INTERNAL_IDENTITY_SECRET = process.env.UBI_IDENTITY_SECRET;
