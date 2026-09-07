/// Stable testIDs, shared by the apps and the Maestro flows.
///
/// Mirror of `packages/contracts/src/test-ids.ts`. The string values must stay
/// identical character for character — a screen and its Maestro flow can only
/// agree if both read the same registry.
///
/// Convention (docs/launch-readiness/handoff/CLAUDE.md):
///   <app>.<screen>.<element> in camelCase.
library;

import 'package:flutter/widgets.dart';

abstract final class TestIds {

  // === rider ===

  // rider.home
  static const String riderHomeWhereTo = 'rider.home.whereTo';
  static const String riderHomeSavedPlaces = 'rider.home.savedPlaces';
  static const String riderHomeServiceSwitcher = 'rider.home.serviceSwitcher';
  static const String riderHomeActiveTrip = 'rider.home.activeTrip';

  // rider.search
  static const String riderSearchInput = 'rider.search.input';
  static const String riderSearchResults = 'rider.search.results';
  static const String riderSearchChooseOnMap = 'rider.search.chooseOnMap';

  // rider.pickup
  static const String riderPickupConfirm = 'rider.pickup.confirm';
  static const String riderPickupNotes = 'rider.pickup.notes';

  // rider.quote
  static const String riderQuoteConfirm = 'rider.quote.confirm';
  static const String riderQuoteClassList = 'rider.quote.classList';
  static const String riderQuotePaymentMethod = 'rider.quote.paymentMethod';
  static const String riderQuoteExpiry = 'rider.quote.expiry';

  // rider.match
  static const String riderMatchCancel = 'rider.match.cancel';
  static const String riderMatchStatus = 'rider.match.status';
  static const String riderMatchSwitchClass = 'rider.match.switchClass';
  static const String riderMatchKeepWaiting = 'rider.match.keepWaiting';

  // rider.assigned
  static const String riderAssignedDriverCard = 'rider.assigned.driverCard';
  static const String riderAssignedCall = 'rider.assigned.call';
  static const String riderAssignedChat = 'rider.assigned.chat';
  static const String riderAssignedCancel = 'rider.assigned.cancel';

  // rider.pin
  static const String riderPinDisplay = 'rider.pin.display';

  // rider.trip
  static const String riderTripShareTrip = 'rider.trip.shareTrip';
  static const String riderTripSafetyHub = 'rider.trip.safetyHub';
  static const String riderTripStatus = 'rider.trip.status';
  static const String riderTripEta = 'rider.trip.eta';

  // rider.pay
  static const String riderPayCashConfirm = 'rider.pay.cashConfirm';
  static const String riderPayBreakdown = 'rider.pay.breakdown';
  static const String riderPayRetry = 'rider.pay.retry';

  // rider.rate
  static const String riderRateSubmit = 'rider.rate.submit';
  static const String riderRateStars = 'rider.rate.stars';
  static const String riderRateTip = 'rider.rate.tip';

  // rider.offline
  static const String riderOfflineBanner = 'rider.offline.banner';
  static const String riderOfflineStaleTimestamp = 'rider.offline.staleTimestamp';

  // === driver ===

  // driver.home
  static const String driverHomeGoOnline = 'driver.home.goOnline';
  static const String driverHomeGoOffline = 'driver.home.goOffline';
  static const String driverHomeFilters = 'driver.home.filters';
  static const String driverHomeEligibility = 'driver.home.eligibility';

  // driver.offer
  static const String driverOfferAccept = 'driver.offer.accept';
  static const String driverOfferDecline = 'driver.offer.decline';
  static const String driverOfferCountdown = 'driver.offer.countdown';
  static const String driverOfferEconomics = 'driver.offer.economics';

  // driver.pickup
  static const String driverPickupArrived = 'driver.pickup.arrived';
  static const String driverPickupNavigate = 'driver.pickup.navigate';
  static const String driverPickupNotes = 'driver.pickup.notes';

  // driver.wait
  static const String driverWaitTimer = 'driver.wait.timer';
  static const String driverWaitNoShow = 'driver.wait.noShow';

  // driver.pin
  static const String driverPinInput = 'driver.pin.input';
  static const String driverPinSubmit = 'driver.pin.submit';

  // driver.trip
  static const String driverTripComplete = 'driver.trip.complete';
  static const String driverTripAddStop = 'driver.trip.addStop';

  // driver.cash
  static const String driverCashReceived = 'driver.cash.received';
  static const String driverCashDispute = 'driver.cash.dispute';

  // driver.earnings
  static const String driverEarningsCashout = 'driver.earnings.cashout';
  static const String driverEarningsBreakdown = 'driver.earnings.breakdown';
  static const String driverEarningsStatement = 'driver.earnings.statement';

  // driver.documents
  static const String driverDocumentsUpload = 'driver.documents.upload';
  static const String driverDocumentsStatus = 'driver.documents.status';

  // driver.fleet
  static const String driverFleetSignPin = 'driver.fleet.signPin';
  static const String driverFleetArrangement = 'driver.fleet.arrangement';

  // === common ===

  // common.sos
  static const String commonSosHold = 'common.sos.hold';
  static const String commonSosConfirm = 'common.sos.confirm';

  // common.flagOff
  static const String commonFlagOffScreen = 'common.flagOff.screen';

  // === wallet ===

  // wallet.send
  static const String walletSendConfirmPin = 'wallet.send.confirmPin';
  static const String walletSendRecipient = 'wallet.send.recipient';
  static const String walletSendAmount = 'wallet.send.amount';

  // wallet.request
  static const String walletRequestPay = 'wallet.request.pay';
  static const String walletRequestCreate = 'wallet.request.create';

  // wallet.nip
  static const String walletNipConfirm = 'wallet.nip.confirm';
  static const String walletNipStatus = 'wallet.nip.status';

  // wallet.topup
  static const String walletTopupConfirm = 'wallet.topup.confirm';

  // wallet.statement
  static const String walletStatementExport = 'wallet.statement.export';

  // === bites ===

  // bites.cart
  static const String bitesCartCheckout = 'bites.cart.checkout';

  // bites.issue
  static const String bitesIssueSubmit = 'bites.issue.submit';

  // bites.merchant
  static const String bitesMerchantAccept = 'bites.merchant.accept';
  static const String bitesMerchantReject = 'bites.merchant.reject';

  // === send ===

  // send.create
  static const String sendCreateConfirm = 'send.create.confirm';

  // send.recipient
  static const String sendRecipientDeliveryCode = 'send.recipient.deliveryCode';

  // send.exception
  static const String sendExceptionDecision = 'send.exception.decision';

  // === flights ===

  // flights.search
  static const String flightsSearchResults = 'flights.search.results';

  // flights.pay
  static const String flightsPayConfirm = 'flights.pay.confirm';

  // flights.switch
  static const String flightsSwitchConfirm = 'flights.switch.confirm';

  // === journey ===

  // journey.itinerary
  static const String journeyItineraryView = 'journey.itinerary.view';

  // === stays ===

  // stays.pay
  static const String staysPayConfirm = 'stays.pay.confirm';

  // stays.checkin
  static const String staysCheckinComplete = 'stays.checkin.complete';

  // === fleet ===

  // fleet.assign
  static const String fleetAssignSend = 'fleet.assign.send';

  // === desk ===

  // desk.scan
  static const String deskScanQr = 'desk.scan.qr';

  // === ops ===

  // ops.case
  static const String opsCaseRemedy = 'ops.case.remedy';

  /// Every declared id, in registry order. Used by the convention test and by
  /// the Maestro flow generator.
  static const List<String> all = <String>[
    riderHomeWhereTo,
    riderHomeSavedPlaces,
    riderHomeServiceSwitcher,
    riderHomeActiveTrip,
    riderSearchInput,
    riderSearchResults,
    riderSearchChooseOnMap,
    riderPickupConfirm,
    riderPickupNotes,
    riderQuoteConfirm,
    riderQuoteClassList,
    riderQuotePaymentMethod,
    riderQuoteExpiry,
    riderMatchCancel,
    riderMatchStatus,
    riderMatchSwitchClass,
    riderMatchKeepWaiting,
    riderAssignedDriverCard,
    riderAssignedCall,
    riderAssignedChat,
    riderAssignedCancel,
    riderPinDisplay,
    riderTripShareTrip,
    riderTripSafetyHub,
    riderTripStatus,
    riderTripEta,
    riderPayCashConfirm,
    riderPayBreakdown,
    riderPayRetry,
    riderRateSubmit,
    riderRateStars,
    riderRateTip,
    riderOfflineBanner,
    riderOfflineStaleTimestamp,
    driverHomeGoOnline,
    driverHomeGoOffline,
    driverHomeFilters,
    driverHomeEligibility,
    driverOfferAccept,
    driverOfferDecline,
    driverOfferCountdown,
    driverOfferEconomics,
    driverPickupArrived,
    driverPickupNavigate,
    driverPickupNotes,
    driverWaitTimer,
    driverWaitNoShow,
    driverPinInput,
    driverPinSubmit,
    driverTripComplete,
    driverTripAddStop,
    driverCashReceived,
    driverCashDispute,
    driverEarningsCashout,
    driverEarningsBreakdown,
    driverEarningsStatement,
    driverDocumentsUpload,
    driverDocumentsStatus,
    driverFleetSignPin,
    driverFleetArrangement,
    commonSosHold,
    commonSosConfirm,
    commonFlagOffScreen,
    walletSendConfirmPin,
    walletSendRecipient,
    walletSendAmount,
    walletRequestPay,
    walletRequestCreate,
    walletNipConfirm,
    walletNipStatus,
    walletTopupConfirm,
    walletStatementExport,
    bitesCartCheckout,
    bitesIssueSubmit,
    bitesMerchantAccept,
    bitesMerchantReject,
    sendCreateConfirm,
    sendRecipientDeliveryCode,
    sendExceptionDecision,
    flightsSearchResults,
    flightsPayConfirm,
    flightsSwitchConfirm,
    journeyItineraryView,
    staysPayConfirm,
    staysCheckinComplete,
    fleetAssignSend,
    deskScanQr,
    opsCaseRemedy,
  ];
}

/// `<app>.<screen>.<element>` in camelCase.
final RegExp testIdPattern =
    RegExp(r'^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$');

bool isValidTestId(String value) => testIdPattern.hasMatch(value);

/// The widget key for a testID.
///
/// Keys are how a Flutter integration test and a Maestro flow driven through
/// the accessibility tree both find an element, so every interactive widget on
/// a board screen carries one.
Key testKey(String id) => ValueKey<String>(id);
