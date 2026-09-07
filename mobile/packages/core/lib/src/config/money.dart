/// Money as the contract defines it: integer minor units plus an explicit
/// currency (`contracts/openapi/support-config.yaml` -> `Money`,
/// `packages/contracts/src/money.ts`).
///
/// The client never does money arithmetic (CLAUDE.md rule 1). There is
/// deliberately no `+`, `-` or `*` on this type; it exists to carry a
/// server-computed amount to a formatter.
library;

import 'package:equatable/equatable.dart';

import 'json_read.dart';

class Money extends Equatable {
  const Money({required this.amountMinor, required this.currency});

  factory Money.fromJson(Map<String, dynamic> json) {
    return Money(
      amountMinor: readInt(json, 'amountMinor'),
      currency: readString(json, 'currency'),
    );
  }

  /// Whole minor units — kobo, cents. Never a decimal.
  final int amountMinor;

  /// ISO-4217 code supplied by the server. There is no default: a caller that
  /// does not know the currency does not know the amount.
  final String currency;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'amountMinor': amountMinor,
        'currency': currency,
      };

  @override
  List<Object?> get props => <Object?>[amountMinor, currency];
}
