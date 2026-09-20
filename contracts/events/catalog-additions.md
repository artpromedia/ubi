# Event catalog additions (append to contracts/events/catalog.md)

All events: envelope {id, type, occurredAt, actor, idempotencyKey, seq, version}; published via the transactional outbox.

| Event | Producer | Payload (key fields) | Consumers |
|---|---|---|---|
| ask.thread.opened | ask-service | threadId, source | analytics |
| ask.review.created / confirmed / expired / superseded | ask-service | reviewId, termsVersion, total, items[], assurance | ledger (hold), ops.ai |
| ask.execution.started / item.updated / completed | ask-service | executionId, item{kind, state, orderId, supplierRef}, overall | rider app, ops.travel |
| ask.action.refused | ask-service | threadId, tool, policy | ops.ai, security |
| action_grant.minted / consumed / expired | user-service (auth) | grantId, actor, action, resource, termsVersion, total, expiresAt, assurance | ask-service, travel-service, ops.ai |
| mandate.created / edited / paused / resumed / revoked / expired | user-service | mandateId, action, caps, expiresAt | rider app, ops.ai |
| mandate.run.evaluated / blocked / executed | mandate-runner | mandateId, executionId, reasonCode?, grantId?, amount, resultRef | rider app (receipt), ledger |
| travel.search.completed | travel-service | searchId, supplier, offers, latencyMs | ops.travel health |
| travel.cart.repriced | travel-service | cartId, items[]{prev, new} | rider app |
| travel.order.submitted / supplier_pending / confirmed / ticketed / failed_released / unknown | travel-service | orderId, kind, supplierRefs, held, charged, released | wallet (capture/release), rider app, ops.travel |
| travel.refund.requested / supplier_confirmed / supplier_refund_pending / refunded_to_wallet / rejected | travel-service | refundId, orderId, amount, penalty | wallet, rider app |
| travel.disruption.detected / options_ready / switched / refunded | travel-service | orderId, cause, eligibility{covered, ruleId}, alternativeId, covered | rider app, reservations (linked ride re-time), protection ledger |
| travel.settlement.difference | travel-recon | orderId, charged, invoiced, difference | ops.travel, finance recon |
| travel.webhook.received / duplicate / rejected | travel-service | supplier, ref, signatureOk | ops.travel |
| reservation.requested / reserved / reservation_failed / retimed | reservations | reservationId, linkedOrderId, pickupAt, classId, reason | rider app, driver app |
| promotion.reserved / consumed / released / exhausted | promotions | campaignVersionId, userId, amount, expiresAt, at | ledger, admin |
| promotion.reversed | promotions | adjustmentId, reasonCode, termsRef, amount | ledger, rider app (changes) |
| referral.created / installed / qualified / review_requested / rewarded / reversed / expired | promotions | referralId, stage, reasonCode? | rider app, admin queue |
| referral.review.decided | admin | caseId, decision, reasonCode, actor | promotions |
| attribution.claimed | promotions | userId, source, campaign, kind (referral/campaign/unknown/organic) | analytics |
| incentive.rebate.posted / reversed | promotions + ledger | tripId, ledgerLineId, amount, kind, basisBps, reasonCode? | driver app, statements |
| incentive.window.applied | promotions | tripId, windowId, waived | driver app |
| driver_referral.milestone_reached / paid | promotions | referralId, milestone, amount | driver app |
| campaign.version.created / simulated / submitted / approved / activated / paused / resumed / exhausted / ended | growth | campaignId, version, actor, approvalId | admin, promotions |
| marketing.proposal.created / saved_as_draft | ai-marketing | threadId, draftCampaignId, model, promptVersion | admin, ops.ai |
| ai.action.logged | ask-service / mandate-runner / ai-marketing | actor, action, tool, model, revision, promptVersion, authRef, outcome, reasonCode, tokens, cost | ops.ai (90 d retention) |
| support.case.opened{source: ask} | support-service | caseId, threadId, includeTranscript | support console |

## Negotiated-fare marketplace (M01–M09)

Producer for `mp.request.*`, `mp.bid.*`, `mp.award.*`, `mp.claim.*`, `mp.queue.*` and `mp.rate_profile.*` is the marketplace engine in ride-service; `mp.commission.*` is produced by payment-service in the same transaction as the hold/journal write. Every event goes through the transactional outbox with subject `mp_request.{id}` / `mp_bid.{id}` / `mp_award.{id}` / `mp_claim.{id}` / `mp_hold.{id}` and carries request `revision` alongside aggregate from/to versions. Audiences are enforced at fan-out: bid events reach only the bidding driver and the request owner — never rival bidders. Amounts appear only in events addressed to a party entitled to see them.

| Event | Producer | Payload keys | Consumers |
| --- | --- | --- | --- |
| mp.request.published / revised / reopened | marketplace (ride-service) | requestId, revision, service, cityId, askedMinor, envelope{step, radiusMeters, pickupEtaSec}, expiresAt | eligible driver feeds, rider app, admin monitor |
| mp.request.closed{reason: awarded·cancelled·expired·no_offers} | marketplace | requestId, revision, reason | driver feeds (card invalidation), rider app, admin |
| mp.bid.submitted / revised / withdrawn / expired / invalidated | marketplace | bidId, requestId, requestRevision, bidVersion, driverId, amountMinor, slot, reservationId | request owner (offer inbox), bidding driver only |
| mp.bid.lost | marketplace | bidId, requestId, driverId, releaseState | losing driver only ("Requester chose another driver…") |
| mp.bid.won | marketplace | bidId, requestId, driverId, awardId | winning driver only |
| mp.award.pending / confirmed / failed / cancelled | marketplace | awardId, requestId, bidId, requestVersion, bidVersion, driverId, slot, fareMinor, executionRef?, failReason? | request owner, winning driver, admin reconciliation |
| mp.commission.reserved / adjusted / released / captured / reversed | payment-service | reservationId, bidId, driverId, amountMinor, awardId?, journalEntryId?, receiptId? | driver wallet UI, marketplace engine, finance recon |
| mp.claim.created / promoted / released | marketplace | claimId, driverId, slot, service, awardId?, dependsOnClaimId?, fencingToken | execution services (fenced ownership), driver app jobs timeline |
| mp.queue.eta_updated | marketplace | awardId, requestId, etaVersion, windowSec{earliest, latest}, inWindow | request owner (queued tracker), driver app |
| mp.queue.window_missed | marketplace | awardId, requestId, toleranceSec, options[wait, cancel_free] | request owner, admin queue monitor |
| mp.rate_profile.saved | marketplace | profileId, driverId, version, cityId, service, vehicleClass | driver app (future calculations only — never mutates live bids) |
