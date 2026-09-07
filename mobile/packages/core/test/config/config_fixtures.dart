/// Fixtures for the config tests. Test-only — nothing here is reachable from
/// app code.
library;

import 'package:ubi_core/ubi_config.dart';

/// A complete, contract-shaped city config document.
Map<String, dynamic> cityConfigJson({
  String cityId = 'TESTCITY',
  int version = 7,
  String currency = 'XTS',
  int currencyFractionDigits = 2,
  String locale = 'en_GB',
}) {
  return <String, dynamic>{
    'cityId': cityId,
    'version': version,
    'currency': currency,
    'currencyFractionDigits': currencyFractionDigits,
    'locale': locale,
    'timezone': 'Etc/UTC',
    'emergencyNumber': '112',
    'vehicleClasses': <String>['go', 'comfort', 'xl'],
    'fares': <String, dynamic>{
      'go': <String, dynamic>{
        'baseMinor': 50000,
        'perKmMinor': 12000,
        'perMinMinor': 3000,
        'bookingFeeMinor': 10000,
        'minFareMinor': 80000,
      },
    },
    'waitPolicy': <String, dynamic>{'freeSec': 300, 'perMinMinor': 5000},
    'cancelPolicy': <String, dynamic>{
      'riderFeeAfterAssignMinor': 30000,
      'driverFeeMinor': 0,
      'freeWindowSec': 120,
    },
    'pinRequired': true,
    'quoteTtlSec': 300,
    'offerTtlSec': 12,
    'matchingRings': <dynamic>[
      <String, dynamic>{'radiusMeters': 1500, 'maxCandidates': 5},
    ],
    'arrivedGeofenceMeters': 120,
    'maxPinAttempts': 3,
    'paymentMethods': <dynamic>[
      <String, dynamic>{'id': 'cash', 'available': true},
      <String, dynamic>{
        'id': 'card',
        'available': false,
        'reason': 'Cards are not enabled in this city yet',
      },
    ],
    'kycTiers': <dynamic>[
      <String, dynamic>{
        'tier': 'tier1',
        'dailyOutMinor': 5000000,
        'singleTransferMinor': 2000000,
        'balanceCapMinor': null,
      },
    ],
    'serviceFeePct': 20,
    'remittanceCapMinor': 100000000,
    'reservationFreeReleaseSec': 900,
    'airport': <String, dynamic>{
      'codes': <String>['TST'],
      'arrivalBufferMin': 20,
      'checkInCutoffMin': 60,
      'trafficBufferMin': 30,
      'doors': <String, dynamic>{'T1': 'Door 3'},
    },
    'taxes': <String, dynamic>{'vat': 7.5},
  };
}

/// A [ConfigSource] whose answers the test dictates, one call at a time.
class ScriptedConfigSource implements ConfigSource {
  ScriptedConfigSource({
    required this.cityResponses,
    required this.flagResponses,
  });

  final List<ConfigResponse<CityConfig>> cityResponses;
  final List<ConfigResponse<FlagSet>> flagResponses;

  /// ETags the repository sent, in order. Lets a test prove the conditional
  /// request actually carried one.
  final List<String?> cityEtagsSeen = <String?>[];
  final List<String?> flagEtagsSeen = <String?>[];

  int _cityCall = 0;
  int _flagCall = 0;

  @override
  Future<ConfigResponse<CityConfig>> fetchCityConfig({
    required String cityId,
    String? etag,
  }) async {
    cityEtagsSeen.add(etag);
    return cityResponses[_cityCall++];
  }

  @override
  Future<ConfigResponse<FlagSet>> fetchFlags({
    required String cityId,
    String? etag,
  }) async {
    flagEtagsSeen.add(etag);
    return flagResponses[_flagCall++];
  }
}
