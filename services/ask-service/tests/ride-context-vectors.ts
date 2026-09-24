/**
 * The cross-language delegated-identity vectors.
 *
 * The SAME literals live in services/ride-service/internal/handler/
 * ask_delegation_test.go, where ride-service's real verifier and RequireIdentity
 * middleware accept each of them (and refuse tampered, skewed and wrong-key
 * variants). Here tests/ride-context.test.ts proves the assistant's signer
 * produces them and tests/marketplace-port.test.ts proves the marketplace port
 * puts exactly these headers on the wire. Keep both files in sync.
 */
export const ASK_VECTORS = [
  {
    name: "rider in Lagos, single key",
    secret: "ask-delegation-vector-secret-0001",
    userId: "3f6c1a52-8d0e-4b7a-9c21-5e4f0a9b7d13",
    role: "rider",
    cityId: "LOS",
    issuedAt: 1758400123,
    signature: "6wUOqkL0K4rh5FV02DcIlaNvkx1QyELUouzwXHJjWMc",
  },
  {
    name: "driver in Accra, rotated key list (first key signs)",
    secret:
      "ask-delegation-vector-new-key-0002,ask-delegation-vector-old-key-0001",
    userId: "b2e4d6f8-1a3c-4e5f-8a9b-0c1d2e3f4a5b",
    role: "driver",
    cityId: "ACC",
    issuedAt: 1758400456,
    signature: "sO6FEHob8dR2xu7m3ErEK1l12QmdcWLgpuNUOgKa_ZY",
  },
] as const;

/** Vector 2 signed with its rotation's OLD key (accepted while listed). */
export const ASK_OLD_KEY_SIGNATURE =
  "hWZeXalAF2293bRqjpA95XXC5QTwYXs9Xo9vA49oRpg";
