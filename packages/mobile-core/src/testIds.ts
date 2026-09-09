// testIDs introduced by this handoff. MERGE into packages/contracts/src/test-ids.ts (closed registry, convention test) in RN-01, then import from @ubi/contracts.
export const TID = {
  rider: { home: { askUbi: 'rider.home.askUbi', benefits: 'rider.home.benefits' }, quote: { savings: 'rider.quote.savings', savingsChanged: 'rider.quote.savingsChanged' } },
  ask: { plan: { card: 'ask.plan.card', review: 'ask.plan.review', editInForm: 'ask.plan.editInForm' }, clarify: { form: 'ask.clarify.form', submit: 'ask.clarify.submit' }, answer: { sources: 'ask.answer.sources' },
    review: { sheet: 'ask.review.sheet', confirmPin: 'ask.review.confirmPin', dismiss: 'ask.review.dismiss' }, status: { list: 'ask.status.list', item: 'ask.status.item' }, handoff: { sheet: 'ask.handoff.sheet', start: 'ask.handoff.start' }, composer: { input: 'ask.composer.input', send: 'ask.composer.send' } },
  mandates: { list: { item: 'mandates.list.item', new: 'mandates.list.new' }, edit: { perRideCap: 'mandates.edit.perRideCap', monthlyCap: 'mandates.edit.monthlyCap', savePin: 'mandates.edit.savePin', revoke: 'mandates.edit.revoke' }, receipt: { card: 'mandates.receipt.card' } },
  flights: { search: { form: 'flights.search.form', submit: 'flights.search.submit', results: 'flights.search.results' }, results: { offer: 'flights.results.offer', continue: 'flights.results.continue' }, passenger: { givenName: 'flights.passenger.givenName', continue: 'flights.passenger.continue' }, switch: { confirm: 'flights.switch.confirm' } },
  stays: { rooms: { rate: 'stays.rooms.rate' }, pay: { confirm: 'stays.pay.confirm' } },
  travel: { checkout: { breakdown: 'travel.checkout.breakdown', payPin: 'travel.checkout.payPin' }, order: { ladder: 'travel.order.ladder' }, itinerary: { item: 'travel.itinerary.item' }, refund: { tracker: 'travel.refund.tracker' }, disruption: { eligibility: 'travel.disruption.eligibility', alternative: 'travel.disruption.alternative' }, linked: { flight: 'travel.linked.flight', ride: 'travel.linked.ride' } },
  reservations: { airport: { form: 'reservations.airport.form', confirm: 'reservations.airport.confirm' } },
  benefits: { credit: { card: 'benefits.credit.card' }, offer: { card: 'benefits.offer.card' }, change: { row: 'benefits.change.row' } },
  referrals: { share: { card: 'referrals.share.card', link: 'referrals.share.link' }, status: { list: 'referrals.status.list' } },
  driver: { home: { incentiveStrip: 'driver.home.incentiveStrip' }, incentives: { rebateCard: 'driver.incentives.rebateCard', referrals: 'driver.incentives.referrals' }, commission: { detail: 'driver.commission.detail' }, earnings: { statement: 'driver.earnings.statement', breakdown: 'driver.earnings.breakdown' } },
  common: { flagOff: { screen: 'common.flagOff.screen' }, offline: { banner: 'common.offline.banner' } },
} as const;
