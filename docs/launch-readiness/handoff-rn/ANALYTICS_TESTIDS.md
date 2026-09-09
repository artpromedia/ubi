# Analytics events + testID additions

## testIDs to add to packages/contracts/src/test-ids.ts (same convention test)
```ts
ask: { home: { entry: "rider.home.askUbi" }, plan: { card: "ask.plan.card", review: "ask.plan.review", editInForm: "ask.plan.editInForm" },
  clarify: { form: "ask.clarify.form", submit: "ask.clarify.submit" }, answer: { sources: "ask.answer.sources" },
  review: { sheet: "ask.review.sheet", confirmPin: "ask.review.confirmPin", dismiss: "ask.review.dismiss" },
  status: { list: "ask.status.list", item: "ask.status.item" }, handoff: { sheet: "ask.handoff.sheet", start: "ask.handoff.start" } },
mandates: { list: { item: "mandates.list.item", new: "mandates.list.new" }, edit: { perRideCap: "mandates.edit.perRideCap", monthlyCap: "mandates.edit.monthlyCap", savePin: "mandates.edit.savePin", revoke: "mandates.edit.revoke" }, receipt: { card: "mandates.receipt.card" } },
flights: { search: { form: "flights.search.form", submit: "flights.search.submit", results: "flights.search.results" }, results: { offer: "flights.results.offer", continue: "flights.results.continue" }, passenger: { givenName: "flights.passenger.givenName", continue: "flights.passenger.continue" }, switch: { confirm: "flights.switch.confirm" } },
stays: { rooms: { rate: "stays.rooms.rate" }, pay: { confirm: "stays.pay.confirm" } },
travel: { checkout: { breakdown: "travel.checkout.breakdown", payPin: "travel.checkout.payPin" }, order: { ladder: "travel.order.ladder" }, itinerary: { item: "travel.itinerary.item" }, refund: { tracker: "travel.refund.tracker" }, disruption: { eligibility: "travel.disruption.eligibility", alternative: "travel.disruption.alternative" }, linked: { flight: "travel.linked.flight", ride: "travel.linked.ride" } },
reservations: { airport: { form: "reservations.airport.form", confirm: "reservations.airport.confirm" } },
benefits: { credit: { card: "benefits.credit.card" }, offer: { card: "benefits.offer.card" }, change: { row: "benefits.change.row" } },
referrals: { share: { card: "referrals.share.card", link: "referrals.share.link" }, status: { list: "referrals.status.list" } },
driver (extend): { home: { incentiveStrip: "driver.home.incentiveStrip" }, incentives: { rebateCard: "driver.incentives.rebateCard", referrals: "driver.incentives.referrals" }, commission: { detail: "driver.commission.detail" } },
rider (extend): { quote: { savings: "rider.quote.savings", savingsChanged: "rider.quote.savingsChanged" } },
growth: { campaign: { form: "growth.campaign.form", liability: "growth.campaign.liability", submit: "growth.campaign.submit", outcome: "growth.campaign.outcome" }, abuse: { case: "growth.abuse.case", decision: "growth.abuse.decision" }, assistant: { output: "growth.assistant.output", saveDraft: "growth.assistant.saveDraft" } },
ops: { travel: { health: "ops.travel.health", exception: "ops.travel.exception" }, ai: { actions: "ops.ai.actions" } },
web: { ask: { panel: "web.ask.panel" }, handoff: { banner: "web.handoff.banner", fallback: "web.handoff.fallback" } }
```

## Analytics events (client → @ubi/analytics; server events remain the truth for money)
| Event | Props | Fired from |
|---|---|---|
| ask_thread_opened | source (home/web/deeplink), flagsOn | AskScreen mount |
| ask_message_sent | threadId, chars, hasAttachedPlan | composer |
| ask_plan_rendered | threadId, liveCards, suggestionCards | PlanCard |
| ask_edit_in_form | threadId, target route | PlanCard |
| ask_review_opened / ask_review_confirmed / ask_review_expired | reviewId, items, totalMinor, termsVersion | TransactionReviewSheet |
| ask_execution_viewed | executionId, outcome (processing/partial/confirmed/failed) | ExecutionStatusScreen |
| ask_handoff_started | threadId, includeTranscript | HandoffSheet |
| mandate_created / mandate_paused / mandate_revoked | mandateId, action, caps | MandateEditor |
| mandate_receipt_viewed | executionId, outcome (done/blocked) | MandateReceiptScreen |
| travel_search | mode, from, to, dates, pax, withStay | FlightSearchScreen |
| travel_results_viewed | searchId, count, soldOut, guaranteedCount | FlightResultsScreen |
| travel_offer_selected | offerId, fareFamily, priceMinor | OfferCard |
| travel_checkout_viewed / travel_checkout_paid / travel_checkout_repriced | cartId, items, totalMinor, diffMinor | TravelCheckoutScreen |
| travel_order_status_viewed | orderId, state | OrderStatusScreen |
| travel_disruption_viewed / travel_switch_confirmed / travel_refund_requested | orderId, covered, ruleId | DisruptionScreen |
| reservation_attached / reservation_failed | orderId, pickupAt, classId, reason | AttachAirportRideScreen |
| quote_savings_shown / quote_savings_changed | quoteId, adjustmentTypes[], reason | SavingsBreakdown |
| benefits_viewed · benefit_change_viewed | credits, offers, changeKind | BenefitsScreen |
| referral_shared · referral_status_viewed | channel, stageCounts | ReferralsScreen |
| driver_incentive_strip_shown · driver_incentives_viewed · driver_commission_detail_viewed · driver_statement_viewed | kind, endsAt, eligibleUsed/cap | driver screens |
| web_handoff_clicked / web_handoff_fallback | tripId, hasApp?, attributionToken | HandoffBanner |
| growth_campaign_saved / simulated / submitted / decision | campaignId, version, state | admin |
| growth_assistant_proposal_saved | threadId, draftCampaignId | admin |
No PII in any property. Server-side events (contracts/events) carry money and outcomes.
