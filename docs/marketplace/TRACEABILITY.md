# Traceability — boards and business rules → contract · route · schema · test

Route paths are gateway paths (`/v1/...`); the gateway strips `/v1` and
proxies `/mp/*`, `/admin/mp/*` to ride-service and `/wallet/*` to
payment-service. Contracts: `MP*` types in `packages/contracts/src/marketplace.ts`,
paths in `contracts/openapi/marketplace.yaml`, machines in
`contracts/state-machines.json`.

## Rider boards

| Board | Screen (apps/rider-mobile) | Route(s) | Contract | Server | Tests |
| --- | --- | --- | --- | --- | --- |
| R01 details | `marketplace/RequestDetailsScreen` | — (client form; `marketplace_delivery` flag) | `MpDeliveryDetails` | — | typecheck + fixtures |
| R02 fare editor | `FareEditorScreen`+Container | `GET /v1/mp/quote` | `MpQuoteEnvelope` | `marketplace/quote.go` (bounds = max of 3 floors / bps ceiling; 503 fail-closed) | Go `requests_http_test` (bounds/boundaries); jest below-floor smoke |
| R03 publish review | ReviewSheet in FareEditor | `POST /v1/mp/requests` | `MpPublishRequest`, `MpRequest` | `requests.go` (stored-quote validation, caps, revision 1) | Go publish/caps tests |
| R04 offer inbox | `OfferInboxScreen`+Container | `GET /v1/mp/requests/:id` | `MpOffer` (private view) | `views.go` | jest stable-order/withdrawn; Go snapshot test |
| R05 selection | `BidDetailScreen`+Container | `POST /v1/mp/requests/:id/select`, `GET .../award` | `MpSelectBid`, `MpAward` | `award.go` saga | Go `award_saga_test` (double-select race → one winner/one debit; stale versions never awarded) |
| R06 assigned | existing Ride stack (RN-01 placeholder — residual) | — | — | execution ride via move machinery | Go saga execution tests |
| R07 empty/error | states in OfferInbox | `request.closed` reasons | `MP_REQUEST_CLOSE_REASONS` | `sweep.go` (no_offers), `requests.go` (cancel) | Go sweep tests; jest no-offers fixture |
| R08 history/receipts | existing Activity (annotation-only per MANIFEST) | — | `MpCommissionReceipt` | payment ledger | ledger tests |
| R09 finishing-trip compare | BidDetail `slot="next"` variant | select w/ `pickupWindowConsent` | `MpSelectBid.pickupWindowConsent` | `award.go` (etaVersion match; worsened window → reconfirm) | Go worsened-window test |
| R10 queued tracker | `QueuedTrackerScreen`+Container | queue projection (PROPOSED endpoint — fixture-backed, see ROLLOUT residuals) | `mp.queue.*` events | `promotion.go`/`sweep.go` (eta_updated, window_missed, fee-free cancel + reversal) | Go queued-lifecycle tests |
| R11 delivery return | `DeliveryReturnSheet`+Container | return-consent (PROPOSED — fixture-backed) | — | not yet server-implemented (residual) | jest render |

## Driver boards

| Board | Screen (apps/driver-mobile) | Route(s) | Contract | Server | Tests |
| --- | --- | --- | --- | --- | --- |
| D01 feed | `RequestFeedScreen`+Container | `GET /v1/mp/feed` | `MpFeedPage` | `feed.go` (privacy-limited, envelope-filtered, availability never consumed) | Go feed tests |
| D02 request detail/presets | `RequestDetailScreen`+Container | `GET /v1/mp/requests/:id/driver-view` | `MpPreset`, `MpEligibility` | `views.go`/`bids.go` (server presets, dedupe, affordability, shortfall) | Go preset/affordability tests |
| D03 bid lifecycle | states in RequestDetail | `POST /v1/mp/bids`, `POST .../revise`, `POST .../withdraw`, `GET /v1/mp/bids/mine` | `MpSubmitBid`, `MpBid`, `mpBid` machine | `bids.go` (reserve-before-live, cooldown, raise-adjust-first, single release) | Go bid tests incl. concurrency; never labelled "accepted" (UI copy + tests) |
| D04 wallet holds | `WalletHoldsScreen`+Container | `GET /v1/wallet/mp/overview` | `MpWalletOverview` | payment `mp-holds.ts` | ledger worked-example test (1000/500/500) |
| D05 winner card | `JobsTimelineScreen` winnerToast | `award.confirmed` + fee receipt | `MpAward`, `MpCommissionReceipt` | `award.go` + `captureHold` | Go saga + ledger capture-once tests |
| D06 lost/released | MyBids tab | `mp.bid.lost`, `mp.commission.released` | events | `award.go` loser resolution | Go one-release-per-loser test; realtime audience test |
| D07 motion gate | MovingGate in feed | none rendered while moving | — | `eligibility.go` NOT_STATIONARY | jest moving-mode test (no bid affordances); Go parked-vs-motion test |
| D08 completion/earnings | existing Statement pattern (annotation-only) | — | `mp_ride_completion*` kinds | `postMarketplaceCompletion` | ledger cash/digital worked example |
| D09 rate profiles | `RateProfileScreen`+Container | `GET/PUT /v1/mp/rate-profiles`, `POST .../preview` | `MpRateProfile`, `MpRatePreview` | `profiles.go` (routed metres, half-up, visible floor, unclamped ceiling, future-only versions) | Go formula tests (fractional km, min binding, rounding) |
| D10 eligibility reasons | blocked state in RequestDetail | evaluator `reasons[]` | `MP_ELIGIBILITY_REASONS` | `eligibility.go` (one evaluator for feed/bid/award/promotion) | Go per-reason tests (all six board codes + finishing-trip pass) |
| D11 current+next timeline | `JobsTimelineScreen` | jobs projection (PROPOSED endpoint — fixture-backed) | `MpDriverClaim`, `mpClaim` machine | `promotion.go` (promote once, no second fee, no early navigation) | Go promotion race tests |
| D12 standing/appeals | annotation-only per MANIFEST | — | — | not in this slice (residual) | — |

## Admin boards

| Board | Page (apps/admin-dashboard) | Route(s) | Server | Tests |
| --- | --- | --- | --- | --- |
| A01+A02 monitor/timeline | `(admin)/marketplace/page.tsx` | `GET /v1/admin/mp/requests`, `GET .../timeline` | `admin.go` (append-only from outbox/audit) | vitest (rows, tones, no mutation controls) |
| A03+A07 policy editor | `(admin)/marketplace/policies/page.tsx` | city config + change-requests + `PUT /v1/flags/*` | config-service (two-person flow) | vitest (10% read-only, fail-closed publish gate, kill-switch testid) |
| A04/A05/A08, A06/A09 | annotation-only per MANIFEST (same table/case/stat patterns) | — | `mp.award_attempts` data exists for the sweep views | — (residual: pages not built) |

## Financial/business rules → enforcement → test

| Rule (pack §3/§5) | Enforcement | Test |
| --- | --- | --- |
| Requester and driver cannot go below the floor via UI/API/preset/stale quote | stored-quote bounds validation in `requests.go`/`bids.go`; presets generated in-bounds; stale quote → `quote_expired`/`version_conflict` | Go boundary tests both sides |
| Reserve each live bid's commission separately; wallet 1000 / hold 600 → bid needing 500 rejected shortfall 100 | `reserveHold` full-amount per bid | `mp-holds.test.ts` independent-holds case |
| Exactly-funded passes; one-minor-unit short fails | `spendableOf` compare | ledger boundary test |
| Raise reserves the delta or old bid intact; lower releases difference | `adjustHold` + `bids.go` revise ordering | ledger + Go revise tests |
| Two rider devices select different bids → one winner, one debit | `awards_one_live_per_request` + capture keyed by award id | Go double-select race; ledger capture-once |
| Two requesters select the same driver → one slot winner; legit current+next allowed | `claims_one_current/next_per_driver` incl. award_pending | Go same-driver race + dependency test |
| Promotion exactly once, no second fee, races resolved | `promotion.go` fencing + uniques | Go promotion vs fresh-award race |
| Unknown capture outcome stays pending, never reopened by timeout | `mpRequest`/`mpAward` machines (no timeout edge) + reconciliation sweep | Go unknown-outcome both-ways test; contracts machine test |
| Lost/withdrawn/expired release funds exactly once | single-release guards + recovery sweep | Go + ledger release-once tests |
| Cash and digital completion collect exactly one 10% fee; journal balances to zero | `postMarketplaceCompletion` | `mp-settlement.test.ts` worked example |
| Old direct accept paths cannot bypass selection | `AcceptOffer` guard (`marketplace_award_id`), `AcceptDelivery` guard (`MARKETPLACE_MANAGED`) | Go guard tests both services |
| Private bids don't leak rival prices | rider-only offer view; audience-scoped fan-out with stripped recipient lists | realtime audience tests |
| Rate changes never mutate published bids/awards | versioned append-only `mp.rate_profiles` | Go future-only test |
| Rider funding must cover the SELECTED amount | `authorizeMarketplaceFunding` (spendable check, re-evaluated per call) | `mp-funding.test.ts` |
