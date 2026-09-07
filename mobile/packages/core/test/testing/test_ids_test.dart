import 'package:flutter_test/flutter_test.dart';
import 'package:ubi_core/ubi_test_ids.dart';

void main() {
  group('testID registry', () {
    test('mirrors the TypeScript registry entry for entry', () {
      // packages/contracts/src/test-ids.ts declares 88 ids.
      expect(TestIds.all.length, 88);
    });

    test('every id follows <app>.<screen>.<element> in camelCase', () {
      for (final String id in TestIds.all) {
        expect(isValidTestId(id), isTrue, reason: id);
      }
    });

    test('no duplicates', () {
      expect(TestIds.all.toSet().length, TestIds.all.length);
    });

    test('carries the ids CLAUDE.md names explicitly', () {
      const List<String> named = <String>[
        'rider.home.whereTo',
        'rider.quote.confirm',
        'rider.match.cancel',
        'rider.pin.display',
        'rider.trip.shareTrip',
        'rider.trip.safetyHub',
        'rider.pay.cashConfirm',
        'rider.rate.submit',
        'driver.home.goOnline',
        'driver.offer.accept',
        'driver.offer.decline',
        'driver.pickup.arrived',
        'driver.pin.input',
        'driver.trip.complete',
        'driver.cash.received',
        'driver.earnings.cashout',
        'common.sos.hold',
        'common.flagOff.screen',
        'wallet.send.confirmPin',
        'wallet.request.pay',
        'bites.cart.checkout',
        'bites.issue.submit',
        'send.create.confirm',
        'send.recipient.deliveryCode',
        'flights.search.results',
        'flights.pay.confirm',
        'flights.switch.confirm',
        'journey.itinerary.view',
        'stays.pay.confirm',
        'stays.checkin.complete',
        'fleet.assign.send',
        'driver.fleet.signPin',
        'desk.scan.qr',
        'ops.case.remedy',
      ];

      for (final String id in named) {
        expect(TestIds.all, contains(id));
      }
    });

    test('rejects ids that break the convention', () {
      expect(isValidTestId('rider.home'), isFalse);
      expect(isValidTestId('Rider.home.whereTo'), isFalse);
      expect(isValidTestId('rider.home.where_to'), isFalse);
      expect(isValidTestId('rider.home.whereTo.extra'), isFalse);
    });
  });
}
