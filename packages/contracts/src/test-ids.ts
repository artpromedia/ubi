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
    home: {
      whereTo: "rider.home.whereTo",
      savedPlaces: "rider.home.savedPlaces",
      serviceSwitcher: "rider.home.serviceSwitcher",
      activeTrip: "rider.home.activeTrip",
      // Ask UBI entry point extends the existing rider.home screen group.
      askUbi: "rider.home.askUbi",
    },
    search: {
      input: "rider.search.input",
      results: "rider.search.results",
      chooseOnMap: "rider.search.chooseOnMap",
    },
    pickup: { confirm: "rider.pickup.confirm", notes: "rider.pickup.notes" },
    quote: {
      confirm: "rider.quote.confirm",
      classList: "rider.quote.classList",
      paymentMethod: "rider.quote.paymentMethod",
      expiry: "rider.quote.expiry",
      savings: "rider.quote.savings",
      savingsChanged: "rider.quote.savingsChanged",
    },
    match: {
      cancel: "rider.match.cancel",
      status: "rider.match.status",
      switchClass: "rider.match.switchClass",
      keepWaiting: "rider.match.keepWaiting",
    },
    assigned: {
      driverCard: "rider.assigned.driverCard",
      call: "rider.assigned.call",
      chat: "rider.assigned.chat",
      cancel: "rider.assigned.cancel",
    },
    pin: { display: "rider.pin.display" },
    trip: {
      shareTrip: "rider.trip.shareTrip",
      safetyHub: "rider.trip.safetyHub",
      status: "rider.trip.status",
      eta: "rider.trip.eta",
    },
    pay: {
      cashConfirm: "rider.pay.cashConfirm",
      breakdown: "rider.pay.breakdown",
      retry: "rider.pay.retry",
    },
    rate: {
      submit: "rider.rate.submit",
      stars: "rider.rate.stars",
      tip: "rider.rate.tip",
    },
    offline: {
      banner: "rider.offline.banner",
      staleTimestamp: "rider.offline.staleTimestamp",
    },
    /**
     * Fleet calendar (A05) — the rider's two moments on an advance booking:
     * D1 BookingChangeConsent (a revalidated vehicle change: confirm, or
     * cancel the booking for free) and D2 BookingDriverLost (no reason
     * shown: rematch at the same fare only when the server offers it, or
     * cancel and release). The handoff's `rider.booking.vehicleUpdatedAck`
     * ("Got it" on a notify-only vehicle swap) is deliberately absent: that
     * path was overridden (docs/design/FLEET_CALENDAR_DECISIONS.md Q3 — every
     * vehicle change needs the rider's consent), so D1 is always the consent
     * variant.
     */
    booking: {
      vehicleChange: "rider.booking.vehicleChange",
      vehicleChangeConfirm: "rider.booking.vehicleChangeConfirm",
      vehicleChangeCancel: "rider.booking.vehicleChangeCancel",
      driverLost: "rider.booking.driverLost",
      rematchSameFare: "rider.booking.rematchSameFare",
      cancelRelease: "rider.booking.cancelRelease",
    },
  },
  driver: {
    home: {
      goOnline: "driver.home.goOnline",
      goOffline: "driver.home.goOffline",
      filters: "driver.home.filters",
      eligibility: "driver.home.eligibility",
      // Incentive strip extends the existing driver.home screen group.
      incentiveStrip: "driver.home.incentiveStrip",
    },
    incentives: {
      rebateCard: "driver.incentives.rebateCard",
      referrals: "driver.incentives.referrals",
    },
    commission: { detail: "driver.commission.detail" },
    offer: {
      accept: "driver.offer.accept",
      decline: "driver.offer.decline",
      countdown: "driver.offer.countdown",
      economics: "driver.offer.economics",
    },
    pickup: {
      arrived: "driver.pickup.arrived",
      navigate: "driver.pickup.navigate",
      notes: "driver.pickup.notes",
    },
    wait: { timer: "driver.wait.timer", noShow: "driver.wait.noShow" },
    pin: { input: "driver.pin.input", submit: "driver.pin.submit" },
    trip: { complete: "driver.trip.complete", addStop: "driver.trip.addStop" },
    cash: { received: "driver.cash.received", dispute: "driver.cash.dispute" },
    earnings: {
      cashout: "driver.earnings.cashout",
      breakdown: "driver.earnings.breakdown",
      statement: "driver.earnings.statement",
    },
    documents: {
      upload: "driver.documents.upload",
      status: "driver.documents.status",
    },
    /**
     * Fleet calendar (A05) driver screens — handoff C1 DriverSchedule, C2
     * FleetProposalReview (+ C2b motion lock), C3 BookingImpact, C4
     * AvailabilityEditor, C5 ReportVehicleIssue. The handoff's list is kept
     * verbatim; the rest are each screen's states and sub-controls. Row-level
     * ids append a server id or option code (`dynamicTestId`).
     */
    fleet: {
      signPin: "driver.fleet.signPin",
      arrangement: "driver.fleet.arrangement",
      // C1
      scheduleView: "driver.fleet.scheduleView",
      scheduleDay: "driver.fleet.scheduleDay",
      scheduleItem: "driver.fleet.scheduleItem",
      scheduleEmpty: "driver.fleet.scheduleEmpty",
      decisionBanner: "driver.fleet.decisionBanner",
      proposalEntry: "driver.fleet.proposalEntry",
      timeOffEntry: "driver.fleet.timeOffEntry",
      reportEntry: "driver.fleet.reportEntry",
      // C2
      proposalCard: "driver.fleet.proposalCard",
      proposalTerms: "driver.fleet.proposalTerms",
      proposalCheck: "driver.fleet.proposalCheck",
      proposalExpiry: "driver.fleet.proposalExpiry",
      proposalAccept: "driver.fleet.proposalAccept",
      proposalDecline: "driver.fleet.proposalDecline",
      proposalOutcome: "driver.fleet.proposalOutcome",
      proposalEmpty: "driver.fleet.proposalEmpty",
      pinPad: "driver.fleet.pinPad",
      pinKey: "driver.fleet.pinKey",
      pinDelete: "driver.fleet.pinDelete",
      pinCancel: "driver.fleet.pinCancel",
      pinError: "driver.fleet.pinError",
      // C2b
      motionLock: "driver.fleet.motionLock",
      motionDeadline: "driver.fleet.motionDeadline",
      motionParked: "driver.fleet.motionParked",
      // C3
      impactOption: "driver.fleet.impactOption",
      impactDeadline: "driver.fleet.impactDeadline",
      impactSwapAccept: "driver.fleet.impactSwapAccept",
      impactSwapDecline: "driver.fleet.impactSwapDecline",
      impactWithdraw: "driver.fleet.impactWithdraw",
      impactWithdrawConfirm: "driver.fleet.impactWithdrawConfirm",
      impactWithdrawCancel: "driver.fleet.impactWithdrawCancel",
      impactOutcome: "driver.fleet.impactOutcome",
      // C4
      timeOffForm: "driver.fleet.timeOffForm",
      timeOffDay: "driver.fleet.timeOffDay",
      timeOffStartEarlier: "driver.fleet.timeOffStartEarlier",
      timeOffStartLater: "driver.fleet.timeOffStartLater",
      timeOffEndEarlier: "driver.fleet.timeOffEndEarlier",
      timeOffEndLater: "driver.fleet.timeOffEndLater",
      timeOffReplace: "driver.fleet.timeOffReplace",
      timeOffCheck: "driver.fleet.timeOffCheck",
      timeOffPreview: "driver.fleet.timeOffPreview",
      timeOffTrim: "driver.fleet.timeOffTrim",
      timeOffWithdrawal: "driver.fleet.timeOffWithdrawal",
      timeOffSave: "driver.fleet.timeOffSave",
      timeOffSaved: "driver.fleet.timeOffSaved",
      // C5
      reportIssue: "driver.fleet.reportIssue",
      reportVehicle: "driver.fleet.reportVehicle",
      reportCannotDrive: "driver.fleet.reportCannotDrive",
      reportServiceSoon: "driver.fleet.reportServiceSoon",
      reportNote: "driver.fleet.reportNote",
      reportSos: "driver.fleet.reportSos",
      reportOutcome: "driver.fleet.reportOutcome",
      reportDecision: "driver.fleet.reportDecision",
      // Every fleet screen
      refusal: "driver.fleet.refusal",
      unavailable: "driver.fleet.unavailable",
      error: "driver.fleet.error",
      offline: "driver.fleet.offline",
      retry: "driver.fleet.retry",
    },
  },
  common: {
    sos: { hold: "common.sos.hold", confirm: "common.sos.confirm" },
    flagOff: { screen: "common.flagOff.screen" },
  },
  wallet: {
    send: {
      confirmPin: "wallet.send.confirmPin",
      recipient: "wallet.send.recipient",
      amount: "wallet.send.amount",
    },
    request: { pay: "wallet.request.pay", create: "wallet.request.create" },
    nip: { confirm: "wallet.nip.confirm", status: "wallet.nip.status" },
    topup: { confirm: "wallet.topup.confirm" },
    statement: { export: "wallet.statement.export" },
  },
  bites: {
    cart: { checkout: "bites.cart.checkout" },
    issue: { submit: "bites.issue.submit" },
    merchant: {
      accept: "bites.merchant.accept",
      reject: "bites.merchant.reject",
    },
  },
  send: {
    create: { confirm: "send.create.confirm" },
    recipient: { deliveryCode: "send.recipient.deliveryCode" },
    exception: { decision: "send.exception.decision" },
  },
  flights: {
    search: {
      form: "flights.search.form",
      submit: "flights.search.submit",
      results: "flights.search.results",
    },
    results: {
      offer: "flights.results.offer",
      continue: "flights.results.continue",
    },
    passenger: {
      givenName: "flights.passenger.givenName",
      continue: "flights.passenger.continue",
    },
    pay: { confirm: "flights.pay.confirm" },
    switch: { confirm: "flights.switch.confirm" },
  },
  journey: { itinerary: { view: "journey.itinerary.view" } },
  stays: {
    rooms: { rate: "stays.rooms.rate" },
    pay: { confirm: "stays.pay.confirm" },
    checkin: { complete: "stays.checkin.complete" },
  },
  ask: {
    plan: {
      card: "ask.plan.card",
      review: "ask.plan.review",
      editInForm: "ask.plan.editInForm",
    },
    clarify: { form: "ask.clarify.form", submit: "ask.clarify.submit" },
    answer: { sources: "ask.answer.sources" },
    review: {
      sheet: "ask.review.sheet",
      confirmPin: "ask.review.confirmPin",
      dismiss: "ask.review.dismiss",
      handoff: "ask.review.handoff",
      notice: "ask.review.notice",
    },
    // Structured marketplace review + execution status (P6).
    mpReview: {
      body: "ask.mpReview.body",
      statement: "ask.mpReview.statement",
      price: "ask.mpReview.price",
      commission: "ask.mpReview.commission",
      noAward: "ask.mpReview.noAward",
      approve: "ask.mpReview.approve",
    },
    mpStatus: {
      view: "ask.mpStatus.view",
      item: "ask.mpStatus.item",
      itemState: "ask.mpStatus.itemState",
      checkAgain: "ask.mpStatus.checkAgain",
      cancel: "ask.mpStatus.cancel",
      openRequest: "ask.mpStatus.openRequest",
    },
    composer: { conventional: "ask.composer.conventional" },
    status: { list: "ask.status.list", item: "ask.status.item" },
    handoff: { sheet: "ask.handoff.sheet", start: "ask.handoff.start" },
  },
  mandates: {
    list: { item: "mandates.list.item", new: "mandates.list.new" },
    edit: {
      perRideCap: "mandates.edit.perRideCap",
      monthlyCap: "mandates.edit.monthlyCap",
      savePin: "mandates.edit.savePin",
      revoke: "mandates.edit.revoke",
      // Dynamic bases: dynamicTestId(base, action | vehicleClassId).
      action: "mandates.edit.action",
      class: "mandates.edit.class",
      timeWindow: "mandates.edit.timeWindow",
    },
    receipt: { card: "mandates.receipt.card" },
  },
  travel: {
    checkout: {
      breakdown: "travel.checkout.breakdown",
      payPin: "travel.checkout.payPin",
    },
    order: { ladder: "travel.order.ladder" },
    itinerary: { item: "travel.itinerary.item" },
    refund: { tracker: "travel.refund.tracker" },
    disruption: {
      eligibility: "travel.disruption.eligibility",
      alternative: "travel.disruption.alternative",
    },
    linked: { flight: "travel.linked.flight", ride: "travel.linked.ride" },
    /**
     * Airport transfer (round-5/6 contract): the intent form (flight leg,
     * airport point, place, class, approved spend limit) and the transfer's
     * own status screen — pending with no driver, requested, driver secured,
     * the traveller's labelled choices and the honest outcome. Choice ids
     * append the server's choice key (`dynamicTestId(choice, "cancel")`).
     */
    transfer: {
      form: "travel.transfer.form",
      direction: "travel.transfer.direction",
      airportPoint: "travel.transfer.airportPoint",
      place: "travel.transfer.place",
      vehicleClass: "travel.transfer.vehicleClass",
      limit: "travel.transfer.limit",
      limitHint: "travel.transfer.limitHint",
      publishNote: "travel.transfer.publishNote",
      submit: "travel.transfer.submit",
      fieldError: "travel.transfer.fieldError",
      refusal: "travel.transfer.refusal",
      unavailable: "travel.transfer.unavailable",
      screen: "travel.transfer.screen",
      status: "travel.transfer.status",
      notice: "travel.transfer.notice",
      noDriver: "travel.transfer.noDriver",
      driverSecured: "travel.transfer.driverSecured",
      window: "travel.transfer.window",
      limitApproved: "travel.transfer.limitApproved",
      action: "travel.transfer.action",
      choice: "travel.transfer.choice",
      outcome: "travel.transfer.outcome",
      openRide: "travel.transfer.openRide",
      terms: "travel.transfer.terms",
      linkedItem: "travel.transfer.linkedItem",
      error: "travel.transfer.error",
      offline: "travel.transfer.offline",
      retry: "travel.transfer.retry",
    },
    /** Checkout of a cart the app never received (travel-service serves no cart GET). */
    cart: { missing: "travel.cart.missing" },
  },
  reservations: {
    airport: {
      form: "reservations.airport.form",
      confirm: "reservations.airport.confirm",
    },
  },
  benefits: {
    credit: { card: "benefits.credit.card" },
    offer: { card: "benefits.offer.card" },
    change: { row: "benefits.change.row" },
  },
  referrals: {
    share: { card: "referrals.share.card", link: "referrals.share.link" },
    status: { list: "referrals.status.list" },
  },
  growth: {
    campaign: {
      form: "growth.campaign.form",
      liability: "growth.campaign.liability",
      submit: "growth.campaign.submit",
      outcome: "growth.campaign.outcome",
    },
    abuse: { case: "growth.abuse.case", decision: "growth.abuse.decision" },
    assistant: {
      output: "growth.assistant.output",
      saveDraft: "growth.assistant.saveDraft",
    },
  },
  web: {
    ask: { panel: "web.ask.panel" },
    handoff: { banner: "web.handoff.banner", fallback: "web.handoff.fallback" },
    /**
     * The guest passenger's trip link (A06 part B): token read from the URL
     * fragment only, the trip view, the pickup PIN, support and the free
     * decline before pickup, and every refusal (expired / revoked / invalid).
     */
    tripLink: {
      screen: "web.tripLink.screen",
      loading: "web.tripLink.loading",
      status: "web.tripLink.status",
      eta: "web.tripLink.eta",
      route: "web.tripLink.route",
      driver: "web.tripLink.driver",
      noDriver: "web.tripLink.noDriver",
      pin: "web.tripLink.pin",
      pinReveal: "web.tripLink.pinReveal",
      pinUnavailable: "web.tripLink.pinUnavailable",
      verification: "web.tripLink.verification",
      support: "web.tripLink.support",
      decline: "web.tripLink.decline",
      declineConfirm: "web.tripLink.declineConfirm",
      declineCancel: "web.tripLink.declineCancel",
      declined: "web.tripLink.declined",
      refusal: "web.tripLink.refusal",
      expired: "web.tripLink.expired",
      revoked: "web.tripLink.revoked",
      invalid: "web.tripLink.invalid",
      missing: "web.tripLink.missing",
      error: "web.tripLink.error",
      retry: "web.tripLink.retry",
    },
  },
  fleet: { assign: { send: "fleet.assign.send" } },
  desk: { scan: { qr: "desk.scan.qr" } },
  ops: {
    case: { remedy: "ops.case.remedy" },
    travel: { health: "ops.travel.health", exception: "ops.travel.exception" },
    ai: { actions: "ops.ai.actions" },
  },
  /**
   * Negotiated-fare marketplace (design handoff `contracts/testids.marketplace.ts`).
   * Namespaced `mp.<app>.<screen>.<element>` — one segment deeper than the
   * legacy pattern so marketplace ids can never collide with an existing
   * screen id. List-item ids append a server id at the call site
   * (`dynamicTestId(TEST_IDS.mp.rider.offers.card, bidId)`).
   */
  mp: {
    rider: {
      fare: {
        amountInput: "mp.rider.fare.amount",
        minMaxHint: "mp.rider.fare.bounds",
        presetChip: "mp.rider.fare.preset",
        breakdown: "mp.rider.fare.breakdown",
        refreshQuote: "mp.rider.fare.refresh",
        review: "mp.rider.fare.review",
      },
      review: { send: "mp.rider.review.send", edit: "mp.rider.review.edit" },
      offers: {
        list: "mp.rider.offers.list",
        card: "mp.rider.offers.card",
        sortPrice: "mp.rider.offers.sortPrice",
        sortEta: "mp.rider.offers.sortEta",
        cancelRequest: "mp.rider.offers.cancel",
        repost: "mp.rider.offers.repost",
        /** A06 part A: the SERVER sort chips (append the sort key) and the order the list is in. */
        sort: "mp.rider.offers.sort",
        order: "mp.rider.offers.order",
        /** The preferred-driver window on this request and its honest outcome. */
        preferred: "mp.rider.offers.preferred",
        preferredOutcome: "mp.rider.offers.preferredOutcome",
      },
      /**
       * One offer's server-computed comparison (A06 part A): the total you
       * pay, the verified driver card (or "details unavailable"), the rating
       * with its count as served, defined reliability, service fit, reasoned
       * badges, the vehicle and the pickup ESTIMATE. Ids append the bidId.
       */
      offerCard: {
        total: "mp.rider.offerCard.total",
        driverStatus: "mp.rider.offerCard.driverStatus",
        rating: "mp.rider.offerCard.rating",
        trips: "mp.rider.offerCard.trips",
        reliability: "mp.rider.offerCard.reliability",
        fit: "mp.rider.offerCard.fit",
        badge: "mp.rider.offerCard.badge",
        vehicle: "mp.rider.offerCard.vehicle",
        pickup: "mp.rider.offerCard.pickup",
      },
      /** Saved drivers (A04 item 3): list, remove, whether each can be asked first. */
      favourites: {
        entry: "mp.rider.favourites.entry",
        screen: "mp.rider.favourites.screen",
        item: "mp.rider.favourites.item",
        canRequest: "mp.rider.favourites.canRequest",
        remove: "mp.rider.favourites.remove",
        book: "mp.rider.favourites.book",
        empty: "mp.rider.favourites.empty",
        note: "mp.rider.favourites.note",
        refusal: "mp.rider.favourites.refusal",
        error: "mp.rider.favourites.error",
        offline: "mp.rider.favourites.offline",
        retry: "mp.rider.favourites.retry",
      },
      /** Ask a saved driver first, with the rider's explicit open-market fallback choice. */
      preferred: {
        section: "mp.rider.preferred.section",
        driver: "mp.rider.preferred.driver",
        none: "mp.rider.preferred.none",
        fallbackOpen: "mp.rider.preferred.fallbackOpen",
        fallbackExpire: "mp.rider.preferred.fallbackExpire",
        note: "mp.rider.preferred.note",
        unavailable: "mp.rider.preferred.unavailable",
      },
      /** A06 part D: hard requirements (verified capability only) vs soft preferences. */
      needs: {
        section: "mp.rider.needs.section",
        requirement: "mp.rider.needs.requirement",
        preference: "mp.rider.needs.preference",
        unavailable: "mp.rider.needs.unavailable",
        fallback: "mp.rider.needs.fallback",
        disclosure: "mp.rider.needs.disclosure",
        refusal: "mp.rider.needs.refusal",
        error: "mp.rider.needs.error",
      },
      /** A06 part B: book for another ADULT — details, attestations, the trip link. */
      guest: {
        section: "mp.rider.guest.section",
        forMe: "mp.rider.guest.forMe",
        forOther: "mp.rider.guest.forOther",
        firstName: "mp.rider.guest.firstName",
        lastName: "mp.rider.guest.lastName",
        phone: "mp.rider.guest.phone",
        adult: "mp.rider.guest.adult",
        consent: "mp.rider.guest.consent",
        minors: "mp.rider.guest.minors",
        fieldError: "mp.rider.guest.fieldError",
        link: "mp.rider.guest.link",
        linkStatus: "mp.rider.guest.linkStatus",
        reissue: "mp.rider.guest.reissue",
        revoke: "mp.rider.guest.revoke",
        refusal: "mp.rider.guest.refusal",
      },
      /** A06 part C: bill an organization's budget, under its policy. */
      business: {
        section: "mp.rider.business.section",
        personal: "mp.rider.business.personal",
        organization: "mp.rider.business.organization",
        costCentre: "mp.rider.business.costCentre",
        category: "mp.rider.business.category",
        traveller: "mp.rider.business.traveller",
        roleNote: "mp.rider.business.roleNote",
        verdict: "mp.rider.business.verdict",
        refusal: "mp.rider.business.refusal",
        error: "mp.rider.business.error",
      },
      /** A completed ride's receipt: itemised committed lines, taxes, business fields. */
      receipt: {
        screen: "mp.rider.receipt.screen",
        line: "mp.rider.receipt.line",
        total: "mp.rider.receipt.total",
        taxes: "mp.rider.receipt.taxes",
        payment: "mp.rider.receipt.payment",
        trip: "mp.rider.receipt.trip",
        business: "mp.rider.receipt.business",
        settlement: "mp.rider.receipt.settlement",
        reconciliation: "mp.rider.receipt.reconciliation",
        saveDriver: "mp.rider.receipt.saveDriver",
        saved: "mp.rider.receipt.saved",
        settling: "mp.rider.receipt.settling",
        notCompleted: "mp.rider.receipt.notCompleted",
        refusal: "mp.rider.receipt.refusal",
        error: "mp.rider.receipt.error",
        offline: "mp.rider.receipt.offline",
        retry: "mp.rider.receipt.retry",
      },
      bid: {
        choose: "mp.rider.bid.choose",
        back: "mp.rider.bid.back",
        windowConsent: "mp.rider.bid.windowConsent",
        whyRecommended: "mp.rider.bid.why",
      },
      queued: {
        ladder: "mp.rider.queued.ladder",
        keepWaiting: "mp.rider.queued.wait",
        cancelFree: "mp.rider.queued.cancelFree",
      },
      delivery: {
        approveReturn: "mp.rider.delivery.approveReturn",
        retryRecipient: "mp.rider.delivery.retry",
        holdAtPoint: "mp.rider.delivery.hold",
      },
      /** R01 details: entry points into the route builder and Book for Later. */
      details: {
        addStops: "mp.rider.details.addStops",
        later: "mp.rider.details.later",
        favourites: "mp.rider.details.favourites",
      },
      /** Offer inbox additions: the route the offers are for, and the pre-award edit. */
      offersRoute: {
        context: "mp.rider.offersRoute.context",
        editRoute: "mp.rider.offersRoute.editRoute",
      },
      /**
       * A02 route builder (before publishing, and the pre-award route edit):
       * ordered stops with label / purpose / expected wait, the server's
       * full-route quote and the "drivers must re-offer" consequence. Row ids
       * append the local row key (`dynamicTestId(stop, key)`).
       */
      route: {
        screen: "mp.rider.route.screen",
        pickup: "mp.rider.route.pickup",
        dropoff: "mp.rider.route.dropoff",
        editPickup: "mp.rider.route.editPickup",
        editDropoff: "mp.rider.route.editDropoff",
        stop: "mp.rider.route.stop",
        stopLabel: "mp.rider.route.stopLabel",
        stopPurpose: "mp.rider.route.stopPurpose",
        stopDwell: "mp.rider.route.stopDwell",
        stopUp: "mp.rider.route.stopUp",
        stopDown: "mp.rider.route.stopDown",
        stopRemove: "mp.rider.route.stopRemove",
        addStop: "mp.rider.route.addStop",
        stopLimit: "mp.rider.route.stopLimit",
        getQuote: "mp.rider.route.getQuote",
        summary: "mp.rider.route.summary",
        distance: "mp.rider.route.distance",
        duration: "mp.rider.route.duration",
        stopWaiting: "mp.rider.route.stopWaiting",
        bounds: "mp.rider.route.bounds",
        breakdown: "mp.rider.route.breakdown",
        outdated: "mp.rider.route.outdated",
        reoffer: "mp.rider.route.reoffer",
        fareChoice: "mp.rider.route.fareChoice",
        revise: "mp.rider.route.revise",
        continue: "mp.rider.route.continue",
        later: "mp.rider.route.later",
        direct: "mp.rider.route.direct",
        unavailable: "mp.rider.route.unavailable",
        refusal: "mp.rider.route.refusal",
        error: "mp.rider.route.error",
        offline: "mp.rider.route.offline",
        retry: "mp.rider.route.retry",
      },
      /** Map pin picker for a stop or destination (no geocoder; the server labels an unnamed pin). */
      place: {
        sheet: "mp.rider.place.sheet",
        map: "mp.rider.place.map",
        pin: "mp.rider.place.pin",
        label: "mp.rider.place.label",
        confirm: "mp.rider.place.confirm",
        cancel: "mp.rider.place.cancel",
        /** Place search (GET /v1/locations/*) when Maps is configured; the pin is the fallback. */
        search: "mp.rider.place.search",
        result: "mp.rider.place.result",
        searchUnavailable: "mp.rider.place.searchUnavailable",
      },
      /**
       * A02 rider trip: committed terms and receipt lines, stops with waiting,
       * extra-waiting approval, route changes (approve / reject / watch) and
       * safe early termination. Row ids append the server stopId / amendmentId.
       */
      trip: {
        entry: "mp.rider.trip.entry",
        screen: "mp.rider.trip.screen",
        fare: "mp.rider.trip.fare",
        original: "mp.rider.trip.original",
        adjustment: "mp.rider.trip.adjustment",
        route: "mp.rider.trip.route",
        stop: "mp.rider.trip.stop",
        stopStatus: "mp.rider.trip.stopStatus",
        waiting: "mp.rider.trip.waiting",
        waitingFee: "mp.rider.trip.waitingFee",
        waitingCap: "mp.rider.trip.waitingCap",
        approveWaiting: "mp.rider.trip.approveWaiting",
        skip: "mp.rider.trip.skip",
        amendment: "mp.rider.trip.amendment",
        amendmentState: "mp.rider.trip.amendmentState",
        inForce: "mp.rider.trip.inForce",
        proposedRoute: "mp.rider.trip.proposedRoute",
        addedDistance: "mp.rider.trip.addedDistance",
        addedTime: "mp.rider.trip.addedTime",
        revisedTotal: "mp.rider.trip.revisedTotal",
        fareDelta: "mp.rider.trip.fareDelta",
        funding: "mp.rider.trip.funding",
        approvals: "mp.rider.trip.approvals",
        expiry: "mp.rider.trip.expiry",
        approve: "mp.rider.trip.approve",
        reject: "mp.rider.trip.reject",
        history: "mp.rider.trip.history",
        propose: "mp.rider.trip.propose",
        terminate: "mp.rider.trip.terminate",
        terminateConfirm: "mp.rider.trip.terminateConfirm",
        terminateCancel: "mp.rider.trip.terminateCancel",
        terminated: "mp.rider.trip.terminated",
        banner: "mp.rider.trip.banner",
        unavailable: "mp.rider.trip.unavailable",
        error: "mp.rider.trip.error",
        offline: "mp.rider.trip.offline",
        retry: "mp.rider.trip.retry",
        receipt: "mp.rider.trip.receipt",
      },
      /** A02 rider route-change proposal composer (remaining stops + destination). */
      change: {
        screen: "mp.rider.change.screen",
        stop: "mp.rider.change.stop",
        up: "mp.rider.change.up",
        down: "mp.rider.change.down",
        remove: "mp.rider.change.remove",
        add: "mp.rider.change.add",
        dropoff: "mp.rider.change.dropoff",
        editDropoff: "mp.rider.change.editDropoff",
        inForce: "mp.rider.change.inForce",
        send: "mp.rider.change.send",
        cancel: "mp.rider.change.cancel",
        refusal: "mp.rider.change.refusal",
        unavailable: "mp.rider.change.unavailable",
      },
      /** A03 ScheduleRide: product, local date/time + timezone, window, approved fares. */
      schedule: {
        screen: "mp.rider.schedule.screen",
        product: "mp.rider.schedule.product",
        date: "mp.rider.schedule.date",
        dateChip: "mp.rider.schedule.dateChip",
        time: "mp.rider.schedule.time",
        timeZone: "mp.rider.schedule.timeZone",
        window: "mp.rider.schedule.window",
        day: "mp.rider.schedule.day",
        endsOn: "mp.rider.schedule.endsOn",
        bounds: "mp.rider.schedule.bounds",
        fare: "mp.rider.schedule.fare",
        fareChip: "mp.rider.schedule.fareChip",
        maxFare: "mp.rider.schedule.maxFare",
        maxFareChip: "mp.rider.schedule.maxFareChip",
        stops: "mp.rider.schedule.stops",
        noDriver: "mp.rider.schedule.noDriver",
        terms: "mp.rider.schedule.terms",
        submit: "mp.rider.schedule.submit",
        fieldError: "mp.rider.schedule.fieldError",
        refusal: "mp.rider.schedule.refusal",
        unavailable: "mp.rider.schedule.unavailable",
        error: "mp.rider.schedule.error",
        offline: "mp.rider.schedule.offline",
        retry: "mp.rider.schedule.retry",
      },
      /** A03 Book for Later hub: one-off scheduled requests, reserved drivers, series. */
      later: {
        entry: "mp.rider.later.entry",
        screen: "mp.rider.later.screen",
        scheduled: "mp.rider.later.scheduled",
        booking: "mp.rider.later.booking",
        series: "mp.rider.later.series",
        book: "mp.rider.later.book",
        empty: "mp.rider.later.empty",
        error: "mp.rider.later.error",
        offline: "mp.rider.later.offline",
        retry: "mp.rider.later.retry",
        /** One list that never loaded (append the section key) — an error, never "last update". */
        sectionError: "mp.rider.later.sectionError",
      },
      /** A03 one scheduled request, incl. needs_rider_approval with refreshed terms. */
      scheduled: {
        screen: "mp.rider.scheduled.screen",
        status: "mp.rider.scheduled.status",
        noDriver: "mp.rider.scheduled.noDriver",
        notice: "mp.rider.scheduled.notice",
        pickup: "mp.rider.scheduled.pickup",
        publishAt: "mp.rider.scheduled.publishAt",
        fares: "mp.rider.scheduled.fares",
        approval: "mp.rider.scheduled.approval",
        refreshed: "mp.rider.scheduled.refreshed",
        approveChoice: "mp.rider.scheduled.approveChoice",
        approve: "mp.rider.scheduled.approve",
        cancel: "mp.rider.scheduled.cancel",
        cancelConfirm: "mp.rider.scheduled.cancelConfirm",
        openRequest: "mp.rider.scheduled.openRequest",
        refusal: "mp.rider.scheduled.refusal",
        error: "mp.rider.scheduled.error",
        offline: "mp.rider.scheduled.offline",
        retry: "mp.rider.scheduled.retry",
      },
      /** A03 advance-offer inbox: drivers offering on a FUTURE pickup window. */
      advance: {
        screen: "mp.rider.advance.screen",
        noDriver: "mp.rider.advance.noDriver",
        window: "mp.rider.advance.window",
        card: "mp.rider.advance.card",
        choose: "mp.rider.advance.choose",
        pending: "mp.rider.advance.pending",
        closed: "mp.rider.advance.closed",
        cancel: "mp.rider.advance.cancel",
        refusal: "mp.rider.advance.refusal",
        error: "mp.rider.advance.error",
        offline: "mp.rider.advance.offline",
        retry: "mp.rider.advance.retry",
      },
      /** A03 ReservationDetail: driver reserved vs fully secured, failure + rematch. */
      booking: {
        screen: "mp.rider.booking.screen",
        status: "mp.rider.booking.status",
        driver: "mp.rider.booking.driver",
        fare: "mp.rider.booking.fare",
        window: "mp.rider.booking.window",
        funding: "mp.rider.booking.funding",
        reconfirm: "mp.rider.booking.reconfirm",
        notices: "mp.rider.booking.notices",
        terms: "mp.rider.booking.terms",
        cancel: "mp.rider.booking.cancel",
        cancelConfirm: "mp.rider.booking.cancelConfirm",
        failure: "mp.rider.booking.failure",
        outcome: "mp.rider.booking.outcome",
        rematch: "mp.rider.booking.rematch",
        rematchConfirm: "mp.rider.booking.rematchConfirm",
        openTrip: "mp.rider.booking.openTrip",
        refusal: "mp.rider.booking.refusal",
        error: "mp.rider.booking.error",
        offline: "mp.rider.booking.offline",
        retry: "mp.rider.booking.retry",
      },
      /** A03 RecurringSeries: per-occurrence status, skip one, pause/resume/cancel. */
      series: {
        screen: "mp.rider.series.screen",
        status: "mp.rider.series.status",
        note: "mp.rider.series.note",
        pattern: "mp.rider.series.pattern",
        occurrence: "mp.rider.series.occurrence",
        occurrenceStatus: "mp.rider.series.occurrenceStatus",
        skip: "mp.rider.series.skip",
        pause: "mp.rider.series.pause",
        resume: "mp.rider.series.resume",
        cancel: "mp.rider.series.cancel",
        cancelConfirm: "mp.rider.series.cancelConfirm",
        empty: "mp.rider.series.empty",
        refusal: "mp.rider.series.refusal",
        error: "mp.rider.series.error",
        offline: "mp.rider.series.offline",
        retry: "mp.rider.series.retry",
      },
    },
    driver: {
      feed: {
        list: "mp.driver.feed.list",
        card: "mp.driver.feed.card",
        myBids: "mp.driver.feed.myBids",
        movingBanner: "mp.driver.feed.movingBanner",
        prefsBanner: "mp.driver.feed.prefsBanner",
        prefsToggle: "mp.driver.feed.prefsToggle",
        homewardTag: "mp.driver.feed.homewardTag",
      },
      detail: {
        preset: "mp.driver.detail.preset",
        custom: "mp.driver.detail.custom",
        skip: "mp.driver.detail.skip",
        reason: "mp.driver.detail.reason",
        preferenceNotice: "mp.driver.detail.preferenceNotice",
        presetPerHour: "mp.driver.detail.presetPerHour",
        // A03: the advance-booking window and the wallet commitment an
        // advance bid takes on, explained BEFORE the driver bids.
        bookingWindow: "mp.driver.detail.bookingWindow",
        advanceTerms: "mp.driver.detail.advanceTerms",
      },
      earnings: {
        card: "mp.driver.earnings.card",
        gross: "mp.driver.earnings.gross",
        commission: "mp.driver.earnings.commission",
        fleet: "mp.driver.earnings.fleet",
        net: "mp.driver.earnings.net",
        pickup: "mp.driver.earnings.pickup",
        route: "mp.driver.earnings.route",
        waiting: "mp.driver.earnings.waiting",
        perHour: "mp.driver.earnings.perHour",
        costs: "mp.driver.earnings.costs",
      },
      prefs: {
        screen: "mp.driver.prefs.screen",
        rates: "mp.driver.prefs.rates",
        minTrip: "mp.driver.prefs.minTrip",
        pickup: "mp.driver.prefs.pickup",
        deliveries: "mp.driver.prefs.deliveries",
        stops: "mp.driver.prefs.stops",
        maxStops: "mp.driver.prefs.maxStops",
        homeward: "mp.driver.prefs.homeward",
        homewardSet: "mp.driver.prefs.homewardSet",
        homewardClear: "mp.driver.prefs.homewardClear",
        homewardRadius: "mp.driver.prefs.homewardRadius",
        homewardOnly: "mp.driver.prefs.homewardOnly",
        windowDay: "mp.driver.prefs.windowDay",
        windowStart: "mp.driver.prefs.windowStart",
        windowEnd: "mp.driver.prefs.windowEnd",
        windowAdd: "mp.driver.prefs.windowAdd",
        windowRemove: "mp.driver.prefs.windowRemove",
        save: "mp.driver.prefs.save",
        error: "mp.driver.prefs.error",
        offline: "mp.driver.prefs.offline",
        conflict: "mp.driver.prefs.conflict",
        retry: "mp.driver.prefs.retry",
      },
      bid: {
        revise: "mp.driver.bid.revise",
        withdraw: "mp.driver.bid.withdraw",
        status: "mp.driver.bid.status",
      },
      wallet: {
        spendable: "mp.driver.wallet.spendable",
        held: "mp.driver.wallet.held",
        hold: "mp.driver.wallet.hold",
        topup: "mp.driver.wallet.topup",
        backToRequest: "mp.driver.wallet.back",
        // A03: the next committed booking's net, shown apart from the holds.
        nextBooking: "mp.driver.wallet.nextBooking",
      },
      rates: {
        rateInput: "mp.driver.rates.rate",
        minInput: "mp.driver.rates.min",
        preview: "mp.driver.rates.preview",
        save: "mp.driver.rates.save",
      },
      jobs: {
        current: "mp.driver.jobs.current",
        next: "mp.driver.jobs.next",
        feeReceipt: "mp.driver.jobs.fee",
        stops: "mp.driver.jobs.stops",
        changes: "mp.driver.jobs.changes",
        calendar: "mp.driver.jobs.calendar",
      },
      /**
       * A02 per-stop execution on the executing trip (server-authoritative
       * arrive / depart / skip, waiting, safe early termination). Row-level
       * ids append the server stopId / amendmentId / reason code.
       */
      trip: {
        screen: "mp.driver.trip.screen",
        fare: "mp.driver.trip.fare",
        adjustment: "mp.driver.trip.adjustment",
        stop: "mp.driver.trip.stop",
        stopStatus: "mp.driver.trip.stopStatus",
        arrive: "mp.driver.trip.arrive",
        notAtStop: "mp.driver.trip.notAtStop",
        arriveDisputed: "mp.driver.trip.arriveDisputed",
        disputed: "mp.driver.trip.disputed",
        depart: "mp.driver.trip.depart",
        skip: "mp.driver.trip.skip",
        waiting: "mp.driver.trip.waiting",
        waited: "mp.driver.trip.waited",
        allowance: "mp.driver.trip.allowance",
        paidWaiting: "mp.driver.trip.paidWaiting",
        waitingCap: "mp.driver.trip.waitingCap",
        approvalNeeded: "mp.driver.trip.approvalNeeded",
        excessive: "mp.driver.trip.excessive",
        amendmentBanner: "mp.driver.trip.amendmentBanner",
        changes: "mp.driver.trip.changes",
        terminate: "mp.driver.trip.terminate",
        terminateReason: "mp.driver.trip.terminateReason",
        terminateConfirm: "mp.driver.trip.terminateConfirm",
        terminateCancel: "mp.driver.trip.terminateCancel",
        terminated: "mp.driver.trip.terminated",
        stopSafely: "mp.driver.trip.stopSafely",
        parked: "mp.driver.trip.parked",
        actionError: "mp.driver.trip.actionError",
        empty: "mp.driver.trip.empty",
        error: "mp.driver.trip.error",
        offline: "mp.driver.trip.offline",
        retry: "mp.driver.trip.retry",
      },
      /**
       * A02 post-award route amendments: review (original vs proposed,
       * money deltas, rider funding, expiry) and decide — parked only.
       */
      amend: {
        screen: "mp.driver.amend.screen",
        card: "mp.driver.amend.card",
        original: "mp.driver.amend.original",
        proposed: "mp.driver.amend.proposed",
        addedDistance: "mp.driver.amend.addedDistance",
        addedTime: "mp.driver.amend.addedTime",
        revisedTotal: "mp.driver.amend.revisedTotal",
        fareDelta: "mp.driver.amend.fareDelta",
        commissionDelta: "mp.driver.amend.commissionDelta",
        netChange: "mp.driver.amend.netChange",
        riderFunding: "mp.driver.amend.riderFunding",
        expiry: "mp.driver.amend.expiry",
        approve: "mp.driver.amend.approve",
        reject: "mp.driver.amend.reject",
        noPenalty: "mp.driver.amend.noPenalty",
        stopSafely: "mp.driver.amend.stopSafely",
        parked: "mp.driver.amend.parked",
        refusal: "mp.driver.amend.refusal",
        outcome: "mp.driver.amend.outcome",
        propose: "mp.driver.amend.propose",
        proposeStop: "mp.driver.amend.proposeStop",
        proposeRemove: "mp.driver.amend.proposeRemove",
        proposeUp: "mp.driver.amend.proposeUp",
        proposeDown: "mp.driver.amend.proposeDown",
        proposeSend: "mp.driver.amend.proposeSend",
        proposeCancel: "mp.driver.amend.proposeCancel",
        empty: "mp.driver.amend.empty",
        error: "mp.driver.amend.error",
        offline: "mp.driver.amend.offline",
        retry: "mp.driver.amend.retry",
      },
      /**
       * A03 driver booking calendar (GET /v1/mp/driver/calendar): committed
       * future bookings, reconfirmation and withdrawal. No acceptance-rate
       * metric exists to carry an id.
       */
      calendar: {
        screen: "mp.driver.calendar.screen",
        note: "mp.driver.calendar.note",
        booking: "mp.driver.calendar.booking",
        window: "mp.driver.calendar.window",
        route: "mp.driver.calendar.route",
        net: "mp.driver.calendar.net",
        status: "mp.driver.calendar.status",
        reconfirm: "mp.driver.calendar.reconfirm",
        reconfirmState: "mp.driver.calendar.reconfirmState",
        withdraw: "mp.driver.calendar.withdraw",
        withdrawReason: "mp.driver.calendar.withdrawReason",
        withdrawConfirm: "mp.driver.calendar.withdrawConfirm",
        withdrawCancel: "mp.driver.calendar.withdrawCancel",
        outcome: "mp.driver.calendar.outcome",
        conflict: "mp.driver.calendar.conflict",
        openTrip: "mp.driver.calendar.openTrip",
        actionError: "mp.driver.calendar.actionError",
        empty: "mp.driver.calendar.empty",
        error: "mp.driver.calendar.error",
        offline: "mp.driver.calendar.offline",
        retry: "mp.driver.calendar.retry",
      },
    },
    admin: {
      monitor: {
        table: "mp.admin.monitor.table",
        timeline: "mp.admin.monitor.timeline",
      },
      policy: {
        publish: "mp.admin.policy.publish",
        stopAwards: "mp.admin.policy.stopAwards",
        audit: "mp.admin.policy.audit",
      },
      recon: { case: "mp.admin.recon.case", sweep: "mp.admin.recon.sweep" },
    },
  },
} as const;

/**
 * `<app>.<screen>.<element>`, with one optional extra namespace segment for
 * the marketplace (`mp.<app>.<screen>.<element>`).
 */
const TEST_ID_PATTERN =
  /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)?$/;

/**
 * List-item ids: a registry base plus a server identifier suffix
 * (`mp.rider.offers.card.bid_123`). The base must be a registered id; the
 * suffix is data and deliberately exempt from the camelCase rule.
 */
export function dynamicTestId(base: string, suffix: string | number): string {
  return `${base}.${suffix}`;
}

export function isValidTestId(value: string): boolean {
  return TEST_ID_PATTERN.test(value);
}

function collect(node: unknown, out: string[]): void {
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const value of Object.values(node)) {
      collect(value, out);
    }
  }
}

/** Flat list of every declared testID — used by the convention test and by Maestro. */
export function allTestIds(): readonly string[] {
  const out: string[] = [];
  collect(TEST_IDS, out);
  return out;
}
