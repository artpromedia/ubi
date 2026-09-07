/// City configuration — the single source for every number, currency, policy
/// and emergency number the apps display (CLAUDE.md rule 1 and rule 6).
///
/// Mirrors `packages/contracts/src/city-config.ts` (`CityConfigSchema`), which
/// is the shared contract the config service is built from. Every field is
/// required: there is no default anywhere in this file, because a default would
/// be a hard-coded market.
library;

import 'package:equatable/equatable.dart';

import 'json_read.dart';

class FareTable extends Equatable {
  const FareTable({
    required this.baseMinor,
    required this.perKmMinor,
    required this.perMinMinor,
    required this.bookingFeeMinor,
    required this.minFareMinor,
  });

  factory FareTable.fromJson(Map<String, dynamic> json) {
    return FareTable(
      baseMinor: readInt(json, 'baseMinor'),
      perKmMinor: readInt(json, 'perKmMinor'),
      perMinMinor: readInt(json, 'perMinMinor'),
      bookingFeeMinor: readInt(json, 'bookingFeeMinor'),
      minFareMinor: readInt(json, 'minFareMinor'),
    );
  }

  final int baseMinor;
  final int perKmMinor;
  final int perMinMinor;
  final int bookingFeeMinor;
  final int minFareMinor;

  @override
  List<Object?> get props => <Object?>[
        baseMinor,
        perKmMinor,
        perMinMinor,
        bookingFeeMinor,
        minFareMinor,
      ];
}

class WaitPolicy extends Equatable {
  const WaitPolicy({required this.freeSec, required this.perMinMinor});

  factory WaitPolicy.fromJson(Map<String, dynamic> json) => WaitPolicy(
        freeSec: readInt(json, 'freeSec'),
        perMinMinor: readInt(json, 'perMinMinor'),
      );

  /// Free waiting time before the per-minute fee starts.
  final int freeSec;
  final int perMinMinor;

  @override
  List<Object?> get props => <Object?>[freeSec, perMinMinor];
}

class CancelPolicy extends Equatable {
  const CancelPolicy({
    required this.riderFeeAfterAssignMinor,
    required this.driverFeeMinor,
    required this.freeWindowSec,
  });

  factory CancelPolicy.fromJson(Map<String, dynamic> json) => CancelPolicy(
        riderFeeAfterAssignMinor: readInt(json, 'riderFeeAfterAssignMinor'),
        driverFeeMinor: readInt(json, 'driverFeeMinor'),
        freeWindowSec: readInt(json, 'freeWindowSec'),
      );

  /// Charged only once a driver has been assigned.
  final int riderFeeAfterAssignMinor;

  /// A driver-initiated cancellation never charges the rider.
  final int driverFeeMinor;
  final int freeWindowSec;

  @override
  List<Object?> get props =>
      <Object?>[riderFeeAfterAssignMinor, driverFeeMinor, freeWindowSec];
}

class PaymentMethodConfig extends Equatable {
  const PaymentMethodConfig({
    required this.id,
    required this.available,
    this.reason,
  });

  factory PaymentMethodConfig.fromJson(Map<String, dynamic> json) {
    final bool available = readBool(json, 'available');
    final Object? reason = json['reason'];
    return PaymentMethodConfig(
      id: readString(json, 'id'),
      available: available,
      reason: reason is String && reason.isNotEmpty ? reason : null,
    );
  }

  final String id;
  final bool available;

  /// Why it cannot be used. Unsupported methods are shown as unavailable with
  /// this reason, never hidden (CLAUDE.md rule 8).
  final String? reason;

  @override
  List<Object?> get props => <Object?>[id, available, reason];
}

class KycTier extends Equatable {
  const KycTier({
    required this.tier,
    required this.dailyOutMinor,
    required this.singleTransferMinor,
    required this.balanceCapMinor,
  });

  factory KycTier.fromJson(Map<String, dynamic> json) {
    final Object? cap = json['balanceCapMinor'];
    return KycTier(
      tier: readString(json, 'tier'),
      dailyOutMinor: readInt(json, 'dailyOutMinor'),
      singleTransferMinor: readInt(json, 'singleTransferMinor'),
      balanceCapMinor: cap == null ? null : readInt(json, 'balanceCapMinor'),
    );
  }

  final String tier;
  final int dailyOutMinor;
  final int singleTransferMinor;

  /// Null means uncapped.
  final int? balanceCapMinor;

  @override
  List<Object?> get props =>
      <Object?>[tier, dailyOutMinor, singleTransferMinor, balanceCapMinor];
}

class MatchingRing extends Equatable {
  const MatchingRing({required this.radiusMeters, required this.maxCandidates});

  factory MatchingRing.fromJson(Map<String, dynamic> json) => MatchingRing(
        radiusMeters: readInt(json, 'radiusMeters'),
        maxCandidates: readInt(json, 'maxCandidates'),
      );

  final int radiusMeters;
  final int maxCandidates;

  @override
  List<Object?> get props => <Object?>[radiusMeters, maxCandidates];
}

class AirportConfig extends Equatable {
  const AirportConfig({
    required this.codes,
    required this.arrivalBufferMin,
    required this.checkInCutoffMin,
    required this.trafficBufferMin,
    required this.doors,
  });

  factory AirportConfig.fromJson(Map<String, dynamic> json) {
    return AirportConfig(
      codes: readStringArray(json, 'codes'),
      arrivalBufferMin: readInt(json, 'arrivalBufferMin'),
      checkInCutoffMin: readInt(json, 'checkInCutoffMin'),
      trafficBufferMin: readInt(json, 'trafficBufferMin'),
      doors: readObjectMap<String>(json, 'doors', (String key, Object? value) {
        if (value is String && value.isNotEmpty) {
          return value;
        }
        throw ConfigFormatException('doors.$key', 'a non-empty string');
      }),
    );
  }

  final List<String> codes;
  final int arrivalBufferMin;
  final int checkInCutoffMin;
  final int trafficBufferMin;

  /// Terminal -> pickup door label.
  final Map<String, String> doors;

  @override
  List<Object?> get props => <Object?>[
        codes,
        arrivalBufferMin,
        checkInCutoffMin,
        trafficBufferMin,
        doors,
      ];
}

class CityConfig extends Equatable {
  const CityConfig({
    required this.cityId,
    required this.version,
    required this.currency,
    required this.currencyFractionDigits,
    required this.locale,
    required this.timezone,
    required this.emergencyNumber,
    required this.vehicleClasses,
    required this.fares,
    required this.waitPolicy,
    required this.cancelPolicy,
    required this.pinRequired,
    required this.quoteTtlSec,
    required this.offerTtlSec,
    required this.matchingRings,
    required this.arrivedGeofenceMeters,
    required this.maxPinAttempts,
    required this.paymentMethods,
    required this.kycTiers,
    required this.serviceFeePct,
    required this.remittanceCapMinor,
    required this.reservationFreeReleaseSec,
    required this.airport,
    required this.taxes,
  });

  factory CityConfig.fromJson(Map<String, dynamic> json) {
    return CityConfig(
      cityId: readString(json, 'cityId'),
      version: readInt(json, 'version'),
      currency: readString(json, 'currency'),
      currencyFractionDigits: readInt(json, 'currencyFractionDigits'),
      locale: readString(json, 'locale'),
      timezone: readString(json, 'timezone'),
      emergencyNumber: readString(json, 'emergencyNumber'),
      vehicleClasses: readStringArray(json, 'vehicleClasses'),
      fares: readObjectMap<FareTable>(json, 'fares',
          (String key, Object? value) {
        if (value is Map<String, dynamic>) {
          return FareTable.fromJson(value);
        }
        throw ConfigFormatException('fares.$key', 'an object');
      }),
      waitPolicy: WaitPolicy.fromJson(readObject(json, 'waitPolicy')),
      cancelPolicy: CancelPolicy.fromJson(readObject(json, 'cancelPolicy')),
      pinRequired: readBool(json, 'pinRequired'),
      quoteTtlSec: readInt(json, 'quoteTtlSec'),
      offerTtlSec: readInt(json, 'offerTtlSec'),
      matchingRings:
          readObjectArray<MatchingRing>(json, 'matchingRings', MatchingRing.fromJson),
      arrivedGeofenceMeters: readInt(json, 'arrivedGeofenceMeters'),
      maxPinAttempts: readInt(json, 'maxPinAttempts'),
      paymentMethods: readObjectArray<PaymentMethodConfig>(
        json,
        'paymentMethods',
        PaymentMethodConfig.fromJson,
      ),
      kycTiers: readObjectArray<KycTier>(json, 'kycTiers', KycTier.fromJson),
      serviceFeePct: readDouble(json, 'serviceFeePct'),
      remittanceCapMinor: readInt(json, 'remittanceCapMinor'),
      reservationFreeReleaseSec: readInt(json, 'reservationFreeReleaseSec'),
      airport: AirportConfig.fromJson(readObject(json, 'airport')),
      taxes: readObjectMap<double>(json, 'taxes', (String key, Object? value) {
        if (value is num) {
          return value.toDouble();
        }
        throw ConfigFormatException('taxes.$key', 'a number');
      }),
    );
  }

  final String cityId;

  /// Monotonic version of the active config. A ride pins the version it was
  /// requested under, so the client shows it and never guesses.
  final int version;

  /// ISO-4217 code. The apps have no fallback currency.
  final String currency;

  /// Minor-unit exponent — kobo is 2. Formatters read this, never assume it.
  final int currencyFractionDigits;

  /// BCP-47 locale for number and date formatting.
  final String locale;

  /// IANA timezone id of the city.
  final String timezone;

  /// Emergency number for this city. Lagos is 112; nothing in the apps may
  /// hard-code it (CLAUDE.md rule 9).
  final String emergencyNumber;

  final List<String> vehicleClasses;
  final Map<String, FareTable> fares;
  final WaitPolicy waitPolicy;
  final CancelPolicy cancelPolicy;
  final bool pinRequired;
  final int quoteTtlSec;
  final int offerTtlSec;
  final List<MatchingRing> matchingRings;
  final int arrivedGeofenceMeters;
  final int maxPinAttempts;
  final List<PaymentMethodConfig> paymentMethods;
  final List<KycTier> kycTiers;
  final double serviceFeePct;
  final int remittanceCapMinor;
  final int reservationFreeReleaseSec;
  final AirportConfig airport;
  final Map<String, double> taxes;

  /// The fare table for a class, or null when the city does not run it.
  ///
  /// Returning null rather than a zeroed table keeps "this class is not
  /// available here" honest instead of showing a free ride.
  FareTable? fareTableFor(String vehicleClass) => fares[vehicleClass];

  /// Whether a payment method may be offered. Absent means unavailable.
  bool paymentMethodAvailable(String methodId) {
    for (final PaymentMethodConfig method in paymentMethods) {
      if (method.id == methodId) {
        return method.available;
      }
    }
    return false;
  }

  /// The configured method entry, so a screen can show the honest reason a
  /// method is greyed out.
  PaymentMethodConfig? paymentMethod(String methodId) {
    for (final PaymentMethodConfig method in paymentMethods) {
      if (method.id == methodId) {
        return method;
      }
    }
    return null;
  }

  KycTier? kycTier(String tier) {
    for (final KycTier candidate in kycTiers) {
      if (candidate.tier == tier) {
        return candidate;
      }
    }
    return null;
  }

  @override
  List<Object?> get props => <Object?>[
        cityId,
        version,
        currency,
        currencyFractionDigits,
        locale,
        timezone,
        emergencyNumber,
        vehicleClasses,
        fares,
        waitPolicy,
        cancelPolicy,
        pinRequired,
        quoteTtlSec,
        offerTtlSec,
        matchingRings,
        arrivedGeofenceMeters,
        maxPinAttempts,
        paymentMethods,
        kycTiers,
        serviceFeePct,
        remittanceCapMinor,
        reservationFreeReleaseSec,
        airport,
        taxes,
      ];
}
