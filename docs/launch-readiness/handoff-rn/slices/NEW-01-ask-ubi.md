# NEW-01 — Ask UBI, transaction review/status, automation (boards 20a–20d)

## Screens & routes (rider-mobile)
`Ask.Thread{threadId?}` AskScreen — composer, streamed answer, PlanCard (QuoteCard LIVE, SuggestionCard), ClarifyForm, AnswerSources, "Edit in form" → Travel.FlightSearch/Ride.Search with params · `Ask.Review{reviewId}` TransactionReviewSheet (modal) · `Ask.Execution{executionId}` ExecutionStatusScreen · HandoffSheet (modal) · `Account.Automation` MandatesScreen · `Account.MandateEditor{mandateId?}` · `Account.MandateReceipt{executionId}`. Home entry `rider.home.askUbi` when `ai_assistant` on. Driver app: Ask entry in Account (read tools: incentives.explain, policy.lookup) — same AskScreen from `@ubi/mobile-ui` variant dark.

## State transitions
Thread: idle → streaming → answered | needs_clarification | error(retry) · Card: suggestion | live(quotedAt) | expired · Review: awaiting → confirming(PIN) → executing | expired | repriced(new review) | cancelled · Execution: processing → per item {submitted → supplier_pending → confirmed | failed_released | unknown_reconciling} → overall {confirmed | partly_booked | failed} · Mandate: draft → active ⇄ paused → revoked | expired · MandateRun: evaluated → blocked(reason) | executed(receipt).

## API (contracts/openapi/ask.yaml, mandates.yaml)
POST /v1/ask/threads · POST /v1/ask/threads/:id/messages (SSE: token, card, clarify, sources, review_ready) · GET /v1/ask/reviews/:id · POST /v1/ask/reviews/:id/confirm {pinProof} → {executionId} (server mints single-use grant bound to terms version/total/currency/expiry/idempotency/assurance) · GET /v1/ask/executions/:id · POST /v1/ask/threads/:id/handoff {includeTranscript} → supportCaseId · GET/POST /v1/mandates · PATCH /v1/mandates/:id · GET /v1/mandates/:id/executions.
Events: ask.thread.opened · ask.review.created/confirmed/expired · ask.execution.started/item.updated/completed · ask.action.refused{policy} · mandate.created/paused/revoked · mandate.run.blocked{reason}/executed{grantId, receiptId} · support.case.opened{source: ask}.

## Backend guidance (ask-service, Hono)
ModelProvider + EmbeddingProvider interfaces; pinned revision; private vLLM/SGLang; timeouts, concurrency, token budgets, per-user limits, cost metrics; fallback = conventional flows. Read tools with strict zod schemas and actor from gateway context; retrieval of versioned policy docs filtered by role/market with citations; tool-loop ≤ 6, search volume caps. Transactional tools only with a valid grant; mandates revalidated + allowance reserved atomically per run; revoke stops future runs only. Out of scope tools (P2P, account admin, campaigns) refused and logged. Redaction: no card/PIN/ID/precise address in prompts or logs; no hidden reasoning logged.

## Reuse
SecureConfirm (PIN/biometric per transaction-risk policy) · support case model (12b) · wallet holds/releases (slice 04) · reservation flow (9a/16a) for mandate airport pickups · FlagGate.

## Analytics / testIDs
See ANALYTICS_TESTIDS.md (ask.*, mandates.*).

## Placement
`rn/apps/rider-mobile/src/screens/ask/{AskScreen,TransactionReviewSheet,ExecutionStatusScreen,HandoffSheet}.tsx` · `src/components/ask/{PlanCard,QuoteCard,SuggestionCard,ClarifyForm,AnswerSources,StatusPill}.tsx` · `src/screens/automation/{MandatesScreen,MandateEditorScreen,MandateReceiptScreen}.tsx` · `src/api/{ask.ts,mandates.ts}` · fixtures `src/dev/fixtures/ask.ts`.

## Acceptance
jest: review sheet invalidates on termsVersion change; status copy never contains "pay again"; refused tool renders deep link. Contract tests: strict schemas, wrong-user access, prompt injection via retrieved docs, expired/replayed grants, changed terms, revoked mandate, concurrent mandate spend. Task suite (versioned) with launch-language prompts, ambiguous dates/currencies, policy questions, live status, supported transactions; thresholds: 0 unauthorised actions, 0 credential leaks. Maestro: ask_plan_review_confirm · ask_partial_outcome · ask_handoff · mandate_create_receipt.

## Claude Code prompt
"Implement NEW-01 from design_handoff_ubi_rn_migration: ask-service (Hono, ModelProvider/EmbeddingProvider, pinned Qwen candidates behind config, private serving), read tools + single-use action grants + standing mandates in the auth domain, per contracts/openapi/{ask,mandates}.yaml and db/migrations/010. Build the RN screens in rn/apps/rider-mobile/src/screens/{ask,automation} with the exact copy from boards 20a–20d, flags ai_assistant/ai_transactions/ai_mandates, tests and Maestro flows listed."
