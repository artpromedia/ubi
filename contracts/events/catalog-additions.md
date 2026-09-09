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
