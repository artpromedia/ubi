/**
 * Stable testIDs, shared by the apps and the Maestro flows.
 *
 * Convention (docs/launch-readiness/handoff/CLAUDE.md):
 *   <app>.<screen>.<element> in camelCase.
 *
 * Every id the handoff names is listed here so a screen and its flow can never
 * disagree about a selector.
 */
export const TEST_IDS = {
  rider: {
    home: { whereTo: "rider.home.whereTo", savedPlaces: "rider.home.savedPlaces", serviceSwitcher: "rider.home.serviceSwitcher", activeTrip: "rider.home.activeTrip" },
    search: { input: "rider.search.input", results: "rider.search.results", chooseOnMap: "rider.search.chooseOnMap" },
    pickup: { confirm: "rider.pickup.confirm", notes: "rider.pickup.notes" },
    quote: { confirm: "rider.quote.confirm", classList: "rider.quote.classList", paymentMethod: "rider.quote.paymentMethod", expiry: "rider.quote.expiry" },
    match: { cancel: "rider.match.cancel", status: "rider.match.status", switchClass: "rider.match.switchClass", keepWaiting: "rider.match.keepWaiting" },
    assigned: { driverCard: "rider.assigned.driverCard", call: "rider.assigned.call", chat: "rider.assigned.chat", cancel: "rider.assigned.cancel" },
    pin: { display: "rider.pin.display" },
    trip: { shareTrip: "rider.trip.shareTrip", safetyHub: "rider.trip.safetyHub", status: "rider.trip.status", eta: "rider.trip.eta" },
    pay: { cashConfirm: "rider.pay.cashConfirm", breakdown: "rider.pay.breakdown", retry: "rider.pay.retry" },
    rate: { submit: "rider.rate.submit", stars: "rider.rate.stars", tip: "rider.rate.tip" },
    offline: { banner: "rider.offline.banner", staleTimestamp: "rider.offline.staleTimestamp" },
  },
  driver: {
    home: { goOnline: "driver.home.goOnline", goOffline: "driver.home.goOffline", filters: "driver.home.filters", eligibility: "driver.home.eligibility" },
    offer: { accept: "driver.offer.accept", decline: "driver.offer.decline", countdown: "driver.offer.countdown", economics: "driver.offer.economics" },
    pickup: { arrived: "driver.pickup.arrived", navigate: "driver.pickup.navigate", notes: "driver.pickup.notes" },
    wait: { timer: "driver.wait.timer", noShow: "driver.wait.noShow" },
    pin: { input: "driver.pin.input", submit: "driver.pin.submit" },
    trip: { complete: "driver.trip.complete", addStop: "driver.trip.addStop" },
    cash: { received: "driver.cash.received", dispute: "driver.cash.dispute" },
    earnings: { cashout: "driver.earnings.cashout", breakdown: "driver.earnings.breakdown", statement: "driver.earnings.statement" },
    documents: { upload: "driver.documents.upload", status: "driver.documents.status" },
    fleet: { signPin: "driver.fleet.signPin", arrangement: "driver.fleet.arrangement" },
  },
  common: {
    sos: { hold: "common.sos.hold", confirm: "common.sos.confirm" },
    flagOff: { screen: "common.flagOff.screen" },
  },
  wallet: {
    send: { confirmPin: "wallet.send.confirmPin", recipient: "wallet.send.recipient", amount: "wallet.send.amount" },
    request: { pay: "wallet.request.pay", create: "wallet.request.create" },
    nip: { confirm: "wallet.nip.confirm", status: "wallet.nip.status" },
    topup: { confirm: "wallet.topup.confirm" },
    statement: { export: "wallet.statement.export" },
  },
  bites: {
    cart: { checkout: "bites.cart.checkout" },
    issue: { submit: "bites.issue.submit" },
    merchant: { accept: "bites.merchant.accept", reject: "bites.merchant.reject" },
  },
  send: {
    create: { confirm: "send.create.confirm" },
    recipient: { deliveryCode: "send.recipient.deliveryCode" },
    exception: { decision: "send.exception.decision" },
  },
  flights: {
    search: { results: "flights.search.results" },
    pay: { confirm: "flights.pay.confirm" },
    switch: { confirm: "flights.switch.confirm" },
  },
  journey: { itinerary: { view: "journey.itinerary.view" } },
  stays: {
    pay: { confirm: "stays.pay.confirm" },
    checkin: { complete: "stays.checkin.complete" },
  },
  fleet: { assign: { send: "fleet.assign.send" } },
  desk: { scan: { qr: "desk.scan.qr" } },
  ops: { case: { remedy: "ops.case.remedy" } },
} as const;

const TEST_ID_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;

export function isValidTestId(value: string): boolean {
  return TEST_ID_PATTERN.test(value);
}

function collect(node: unknown, out: string[]): void {
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const value of Object.values(node)) collect(value, out);
  }
}

/** Flat list of every declared testID — used by the convention test and by Maestro. */
export function allTestIds(): readonly string[] {
  const out: string[] = [];
  collect(TEST_IDS, out);
  return out;
}
