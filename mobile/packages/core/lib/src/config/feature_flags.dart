/// Feature flags, deny-by-default (CLAUDE.md rule 5).
///
/// Mirrors `packages/contracts/src/flags.ts`. The key strings must stay
/// identical to that list — they are what the server evaluates.
///
/// There is no way to read a flag that is not in [UbiFlag], and an absent key
/// reads as off, so a client can never fail open into a half-built vertical.
library;

import 'package:equatable/equatable.dart';

/// The closed set of flag keys. Adding one here without adding it to
/// `packages/contracts/src/flags.ts` is a bug.
enum UbiFlag {
  move('move'),
  bites('bites'),
  send('send'),
  travel('travel'),
  stays('stays'),
  journeys('journeys'),
  reservations('reservations'),
  fleet('fleet'),
  walletP2p('wallet_p2p'),
  walletNip('wallet_nip'),
  tips('tips'),
  scheduledRides('scheduled_rides'),
  recording('recording'),
  driverOnline('driver_online'),
  rideRequest('ride_request'),
  providerPayments('provider_payments');

  const UbiFlag(this.key);

  /// The wire key the server evaluates.
  final String key;

  /// The flag for a wire key, or null when the server sends one we do not
  /// know. Unknown keys are ignored rather than trusted.
  static UbiFlag? fromKey(String key) {
    for (final UbiFlag flag in UbiFlag.values) {
      if (flag.key == key) {
        return flag;
      }
    }
    return null;
  }
}

/// An evaluated set of flags.
class FlagSet extends Equatable {
  const FlagSet._(this._values);

  /// Parses `GET /v1/flags`. Non-boolean and unknown keys are dropped: a flag
  /// we cannot read is a flag that is off.
  factory FlagSet.fromJson(Map<String, dynamic> json) {
    final Map<String, bool> values = <String, bool>{};
    json.forEach((String key, Object? value) {
      if (value is bool && UbiFlag.fromKey(key) != null) {
        values[key] = value;
      }
    });
    return FlagSet._(Map<String, bool>.unmodifiable(values));
  }

  /// Every flag off. This is the value used whenever the config service is
  /// unreachable, the response is malformed, or no city is known.
  static const FlagSet denyAll = FlagSet._(<String, bool>{});

  final Map<String, bool> _values;

  /// The only correct way to read a flag.
  bool isEnabled(UbiFlag flag) => _values[flag.key] == true;

  /// True when nothing at all is on — used to render the honest "nothing is
  /// available yet" state rather than an empty home screen.
  bool get isDenyAll => !_values.containsValue(true);

  /// The flags that are on, for diagnostics. Keys only; never user data.
  Iterable<UbiFlag> get enabled =>
      UbiFlag.values.where((UbiFlag flag) => isEnabled(flag));

  @override
  List<Object?> get props => <Object?>[_values];
}
