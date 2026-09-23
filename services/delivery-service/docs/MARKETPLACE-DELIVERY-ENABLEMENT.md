# Marketplace delivery — what is done, and what still blocks `marketplace_delivery`

`marketplace_delivery` stays **OFF** (deny-by-default city flag,
`packages/contracts/src/flags.ts`). Nothing in delivery-service or
payment-service turns it on, and nothing here should be read as permission to.
This page is the precise list of what the flag still waits for, as of P17
(recheck R02).

## Status

| Piece                                                  | Implemented | Tested                                                                 | Deployed | Enabled |
| ------------------------------------------------------ | :---------: | ---------------------------------------------------------------------- | :------: | :-----: |
| Production fail-closed gateway identity (round 1)      |     yes     | `identity_production_test.go`                                          |    no    |   n/a   |
| Sender = requester's rider profile (P17)               |     yes     | `marketplace_integration_test.go` (real FKs)                           |    no    |   off   |
| Delivery + custody committed atomically (P17)          |     yes     | same                                                                   |    no    |   off   |
| Verified proof object storage (P17)                    |     yes     | `proof_storage_test.go`, MinIO + in-process S3                         |    no    |   off   |
| Charged returns, delivery side (P17)                   |     yes     | `charged_returns_test.go` (contract stub)                              |    no    |   off   |
| Charged returns, payment side (P17)                    |     yes     | `payment-service tests/finance/delivery-returns.test.ts` (real ledger) |    no    |   off   |
| **Award-saga producer for marketplace-assign**         |   **no**    | —                                                                      |    no    |   off   |
| **Gateway path + scopes for the custody/proof routes** |   **no**    | —                                                                      |    no    |   off   |
| OpenAPI / rider-mobile for the new routes              |   **no**    | —                                                                      |    no    |   off   |

## 1. Sender identity

The award carries the requester's **user** id (`customerId`, the gateway's
`x-auth-user-id`). `deliveries.sender_id` is a foreign key to **`riders.id`**
(a rider profile). `MarketplaceAssign` now resolves the profile read-only
(`SELECT id FROM riders WHERE user_id = $1`) and writes it; with no profile it
answers **422 `SENDER_PROFILE_NOT_FOUND`** and writes nothing.
`delivery_custody.sender_id` keeps the **user** id, because the custody access
matrix compares it with the gateway-verified actor. The delivery row, its
custody row and the first custody event commit in one transaction.

The delivery tests run against the real Prisma migrations: the harness
(`internal/testutil/migrations.go`) checks the database against
`packages/database/prisma/migrations`, runs `prisma migrate deploy` for
anything pending, and fails unless `deliveries.sender_id → riders` exists.
`TestSenderColumnRefusesARawUserID` proves the pre-P17 insert now violates
`deliveries_sender_id_fkey`.

## 2. Proofs are verified objects

Flow (all under `/api/v1/deliveries/{id}/custody`, gateway identity):

1. `POST /proof-uploads` `{type: pickup|delivery|return, contentType, sizeBytes, sha256}`
   — assigned driver only, only for a proof the current custody state can
   accept, at most 6 open uploads per delivery. The server makes the key
   `proofs/<delivery>/<type>/<driver>/<upload>` and answers a presigned PUT
   (default 5 min, `PROOF_UPLOAD_URL_TTL`, max 15 min) with `Content-Type` and
   `X-Amz-Checksum-Sha256` as **signed** headers. Asking again for the same
   image re-signs the same slot.
2. The app PUTs the bytes straight to the bucket. MinIO refuses bytes whose
   SHA-256 differs from the signed checksum.
3. `POST /pickup-proof` | `/delivery-proof` | `/return/complete` `{uploadId}` —
   refused unless the caller is the actor the upload was issued to
   (`403 PROOF_UPLOAD_NOT_YOURS`), for this delivery (`404`) and this type
   (`409 PROOF_UPLOAD_TYPE_MISMATCH`). The stored object is re-measured,
   re-hashed and sniffed: `PROOF_OBJECT_MISSING` (409),
   `PROOF_OBJECT_TOO_LARGE` / `PROOF_SIZE_MISMATCH` /
   `PROOF_CHECKSUM_MISMATCH` / `PROOF_CONTENT_TYPE_MISMATCH` (422, the object
   is deleted and the upload marked rejected). Only then do the proof row
   (`upload_id`, `verified_at`) and the custody transition commit, together.
   The pre-P17 body `{objectKey, sha256, …}` is refused
   (`400 PROOF_UPLOAD_REQUIRED`).
4. `GET /proofs/{proofId}/url` — sender, assigned driver or ops only; a
   presigned GET living 60 s by default (`PROOF_DOWNLOAD_URL_TTL`, capped at
   5 min), `Cache-Control: no-store`. The bucket is private: an unsigned
   object URL is refused by storage. A pre-P17 (never verified) proof gets
   `409 PROOF_NOT_VERIFIED`.

Configuration: `PROOF_STORAGE_ENDPOINT` (internal, e.g. `http://minio:9000`),
`PROOF_STORAGE_PUBLIC_ENDPOINT` (the host phones reach; URLs are signed for
it), `PROOF_STORAGE_BUCKET`, `PROOF_STORAGE_ACCESS_KEY`,
`PROOF_STORAGE_SECRET_KEY`, `PROOF_STORAGE_REGION` (default `us-east-1`).
**Fail closed:** without them every proof route answers
`503 PROOF_STORAGE_NOT_CONFIGURED`; in production `/health/ready` is 503
(`checks.proofStorage`); a malformed configuration refuses to boot in
production; readiness also fails for a missing, unreachable or public bucket.

## 3. Charged returns

Deny-by-default switch **`DELIVERY_CHARGED_RETURNS_ENABLED`** (only `"true"`
enables). Off: a fee-bearing proposal is refused with
`409 CHARGED_RETURNS_NOT_OFFERED` and the timeline says
`returnPolicy.feeFreeOnly: true` — fee-free returns only, explicitly. On:

- propose: `0 < feeMinor ≤ agreedFareMinor`, in the delivery's currency
  (`400 RETURN_FEE_OUT_OF_BOUNDS`), recorded `authorization_required`;
- sender consent: `reserving` (write-ahead) → payment-service **reserve** →
  `reserved`, custody `return_proposed → return_consented → returning`.
  Insufficient funds: `402 RETURN_FEE_INSUFFICIENT_FUNDS`, nothing changes.
  Unknown outcome: `503 RETURN_FEE_PENDING`, retry replays;
- reject / expiry / hold point while `reserving`: **release first**, then
  resolve (a release that finds nothing leaves a payment-side tombstone). A
  reject or expiry that finds the row `reserving`/`reserved` at commit time
  (an approval started reserving after its release check) is refused with a
  conflict instead of resolving underneath the hold; the retry releases first;
- an approval whose custody transition loses the race is compensated by a
  release — unless a concurrent approval of the same return committed (a
  double tap: both replay the one reservation), in which case the fee stays
  held for the capture;
- the switch alone does not offer fees: with no usable payment-service
  (no `PAYMENT_SERVICE_URL`, or only the committed-default internal key) the
  return policy is fee-free only;
- driver `POST /return/complete` with a verified `return` proof:
  `returning → return_to_sender` + `capture_pending` in one transaction, then
  payment-service **capture** (`captured`), retried on replay or the next
  timeline read (`202` while pending);
- ops `POST /return/cancel-charge`: **release**; the return completes fee-free;
- the switch (or payment-service's city gate on `marketplace_delivery`) stops
  NEW charges only — a reserved fee is always captured or released.

payment-service contract: `POST /v1/finance/delivery-returns/{reserve,capture,release}`,
`X-Service-Key`, `Idempotency-Key: delivery-return:<returnId>:<op>`,
`X-City-ID`, body `{returnId, deliveryId, awardId, senderId, driverId,
feeMinor, currency, reason?}`; `GET /v1/finance/delivery-returns/returns/:returnId`.
Reserve holds the fee on the sender's wallet (companion rider reservation,
award key `delivery_return:<returnId>`); capture posts one
`delivery_return_fee` entry, sender wallet → the award's driver wallet, whole
fee; the award's 10% commission hold is only read (payee binding), never
adjusted or re-captured.

## 4. What still blocks enabling `marketplace_delivery`

### 4a. The award-saga producer (ride-service — not in this slice)

No code calls `marketplace-assign` today. ride-service must add, behind
`marketplace_delivery` for the request's city and only for `service =
delivery` requests:

```
POST {DELIVERY_SERVICE_URL}/api/v1/webhooks/marketplace-assign
X-Service-Key: <INTERNAL_SERVICE_KEY, the value delivery-service has; never the committed default>
Content-Type: application/json

{
  "awardId":      "awd_…",            // idempotency key — one delivery per award, ever
  "requestId":    "mpr_…",
  "customerId":   "<requester users.id, UUID>",   // NOT a rider profile id
  "driverId":     "<winning driver users.id, UUID>",
  "fareMinor":    125000,             // the awarded fare, integer minor units
  "currency":     "NGN",              // NGN|KES|ZAR|GHS|RWF|ETB|USD (deliveries.currency enum)
  "fencingToken": 3,                  // the award's fencing token, >= 0
  "pickup":  { "latitude": 6.43, "longitude": 3.42, "address": "…" },
  "dropoff": { "latitude": 6.46, "longitude": 3.59, "address": "…" },
  "packageDetails": { "description": "…", "size": "SMALL", "weight": 1.2, "fragile": false, "requiresPod": true }
}
```

- **When:** after the award saga has captured the ONE 10% commission and
  authorized rider funding, from ride-service's transactional outbox (not
  inline in the request), so a crash between award commit and hand-off is
  retried.
- **Answers:** `201` created; `200` replay (same award, same parties);
  `409 ASSIGN_IN_PROGRESS` → retry with backoff; `5xx` → retry;
  `409 AWARD_REPLAY_MISMATCH`, `400 VALIDATION_ERROR`,
  `422 SENDER_PROFILE_NOT_FOUND` → **permanent**: compensate the award
  (`POST /v1/wallet/mp/holds/:id/reverse` + `/v1/wallet/mp/funding/release`)
  and alarm; `503 SERVICE_KEY_NOT_CONFIGURED` / `403` → deployment
  misconfiguration, alarm.
- **Never** promise transport before the `201`/`200`; the delivery exists only
  then.

### 4b. Gateway (api-gateway — not in this slice)

- Path: the gateway forwards `/v1/delivery/*` as `/delivery/*`
  (`downstreamPath` strips only `/v1`), but delivery-service serves
  `/api/v1/*`. Map `/v1/delivery/<rest>` → `/api/v1/<rest>` for this service.
- Scopes: add the new custody routes to the scope matrix
  (`proof-uploads`, `proofs/:proofId/url`, `return/complete` for drivers and
  senders as documented above; `return/cancel-charge` for ops/admin only).

### 4c. Contracts and clients (not in this slice)

- `contracts/openapi/marketplace.yaml`: the proof body is now `{uploadId}`;
  add `proof-uploads`, `proofs/{proofId}/url`, `return/complete`,
  `return/cancel-charge`, the new error codes, `returnPolicy`/`proofs` on the
  timeline, `senderProfileId` on the marketplace-assign answer; add
  `/v1/finance/delivery-returns` to a finance contract.
- `docs/marketplace/DELIVERY_CUSTODY.md`: its "object storage", "return-leg
  charge" and "sender FK" sections describe the pre-P17 state.
- rider-mobile / driver-mobile: capture + upload a proof image (driver),
  show `returnPolicy`, the fee approval (402 handling) and proof viewing.

### 4d. Operations

- Provision the private MinIO bucket and credentials scoped to it; set
  `PROOF_STORAGE_PUBLIC_ENDPOINT` to the TLS host phones reach; add a
  lifecycle rule expiring unattached objects (`proofs/` objects whose upload
  was never attached) and a proof retention policy (PII-adjacent images).
- The legacy open-market CRUD handlers (`handlers.go`/`driver.go`) still
  reference columns the Prisma schema does not have (`customer_id`,
  `package`, `type`); they are outside the marketplace path and unchanged.
