/// Payment Entity
///
/// Domain entities for payments and wallet.
library;

import 'package:equatable/equatable.dart';

/// Type of payment method
enum PaymentMethodType {
  card('card', 'Card'),
  mpesa('mpesa', 'M-Pesa'),
  mtn('mtn', 'MTN MoMo'),
  wallet('wallet', 'UBI Wallet'),
  cash('cash', 'Cash');

  const PaymentMethodType(this.value, this.displayName);

  final String value;
  final String displayName;

  bool get isMobileMoney => this == mpesa || this == mtn;
  bool get isDigital => this != cash;
}

/// Payment status
enum PaymentStatus {
  pending('pending', 'Pending'),
  processing('processing', 'Processing'),
  success('success', 'Successful'),
  failed('failed', 'Failed'),
  refunded('refunded', 'Refunded'),
  cancelled('cancelled', 'Cancelled');

  const PaymentStatus(this.value, this.displayName);

  final String value;
  final String displayName;

  bool get isComplete => this == success || this == refunded;
  bool get isFailed => this == failed || this == cancelled;
}

/// Payment method entity
class PaymentMethod extends Equatable {
  const PaymentMethod({
    required this.id,
    required this.type,
    required this.displayName,
    this.last4,
    this.brand,
    this.expiryMonth,
    this.expiryYear,
    this.isDefault = false,
    this.phoneNumber,
    this.provider,
    this.createdAt,
  });

  final String id;
  final PaymentMethodType type;
  final String displayName;
  final String? last4;
  final String? brand;
  final int? expiryMonth;
  final int? expiryYear;
  final bool isDefault;
  final String? phoneNumber;
  final String? provider;
  final DateTime? createdAt;

  /// Card expiry display (e.g., "12/25")
  String? get expiryDisplay {
    if (expiryMonth == null || expiryYear == null) return null;
    final month = expiryMonth.toString().padLeft(2, '0');
    final year = (expiryYear! % 100).toString().padLeft(2, '0');
    return '$month/$year';
  }

  /// Whether the card is expired
  bool get isExpired {
    if (expiryMonth == null || expiryYear == null) return false;
    final now = DateTime.now();
    final expiry = DateTime(expiryYear!, expiryMonth! + 1, 0);
    return now.isAfter(expiry);
  }

  /// Icon name based on type/brand
  String get iconName {
    switch (type) {
      case PaymentMethodType.card:
        switch (brand?.toLowerCase()) {
          case 'visa':
            return 'visa';
          case 'mastercard':
            return 'mastercard';
          case 'amex':
            return 'amex';
          default:
            return 'credit_card';
        }
      case PaymentMethodType.mpesa:
        return 'mpesa';
      case PaymentMethodType.mtn:
        return 'mtn';
      case PaymentMethodType.wallet:
        return 'wallet';
      case PaymentMethodType.cash:
        return 'cash';
    }
  }

  @override
  List<Object?> get props => [id, type, displayName];
}

/// Payment entity
class Payment extends Equatable {
  const Payment({
    required this.id,
    required this.status,
    required this.amount,
    required this.currency,
    required this.paymentMethod,
    required this.createdAt,
    this.orderId,
    this.orderType,
    this.transactionId,
    this.receiptUrl,
    this.errorMessage,
    this.paidAt,
    this.refundedAt,
    this.metadata,
  });

  final String id;
  final PaymentStatus status;
  final double amount;
  final String currency;
  final PaymentMethodType paymentMethod;
  final DateTime createdAt;
  final String? orderId;
  final String? orderType;
  final String? transactionId;
  final String? receiptUrl;
  final String? errorMessage;
  final DateTime? paidAt;
  final DateTime? refundedAt;
  final Map<String, dynamic>? metadata;

  bool get isPending => status == PaymentStatus.pending || status == PaymentStatus.processing;
  bool get isSuccessful => status == PaymentStatus.success;
  bool get canRetry => status == PaymentStatus.failed;

  @override
  List<Object?> get props => [id, status, amount, currency, paymentMethod];
}

/// Wallet entity
class Wallet extends Equatable {
  const Wallet({
    required this.balance,
    required this.currency,
    this.pendingBalance,
    this.availableBalance,
    this.lastUpdated,
  });

  final double balance;
  final String currency;
  final double? pendingBalance;
  final double? availableBalance;
  final DateTime? lastUpdated;

  /// Effective available balance
  double get effectiveBalance => availableBalance ?? balance;

  /// Has pending transactions
  bool get hasPendingBalance => (pendingBalance ?? 0) > 0;

  @override
  List<Object?> get props => [balance, currency];
}

/// Wallet transaction type
enum WalletTransactionType {
  credit('credit', 'Credit'),
  debit('debit', 'Debit'),
  refund('refund', 'Refund'),
  topUp('topup', 'Top Up'),
  withdrawal('withdrawal', 'Withdrawal'),
  earning('earning', 'Earning'),
  bonus('bonus', 'Bonus');

  const WalletTransactionType(this.value, this.displayName);

  final String value;
  final String displayName;

  bool get isPositive => this == credit || this == refund || this == topUp || this == earning || this == bonus;
}

/// Wallet transaction entity
class WalletTransaction extends Equatable {
  const WalletTransaction({
    required this.id,
    required this.type,
    required this.amount,
    required this.currency,
    required this.status,
    required this.createdAt,
    this.description,
    this.referenceId,
    this.referenceType,
    this.balanceAfter,
  });

  final String id;
  final WalletTransactionType type;
  final double amount;
  final String currency;
  final String status;
  final DateTime createdAt;
  final String? description;
  final String? referenceId;
  final String? referenceType;
  final double? balanceAfter;

  /// Display amount with sign
  String get displayAmount {
    final sign = type.isPositive ? '+' : '-';
    return '$sign$currency ${amount.toStringAsFixed(2)}';
  }

  @override
  List<Object?> get props => [id, type, amount, currency, createdAt];
}

/// Promo code entity
class PromoCode extends Equatable {
  const PromoCode({
    required this.code,
    required this.type,
    required this.value,
    this.description,
    this.minOrderAmount,
    this.maxDiscount,
    this.validUntil,
    this.usesRemaining,
    this.applicableServices,
  });

  final String code;
  final PromoType type;
  final double value;
  final String? description;
  final double? minOrderAmount;
  final double? maxDiscount;
  final DateTime? validUntil;
  final int? usesRemaining;
  final List<String>? applicableServices;

  /// Calculate discount for amount
  double calculateDiscount(double amount) {
    if (minOrderAmount != null && amount < minOrderAmount!) {
      return 0;
    }

    double discount;
    if (type == PromoType.percentage) {
      discount = amount * (value / 100);
    } else {
      discount = value;
    }

    if (maxDiscount != null && discount > maxDiscount!) {
      discount = maxDiscount!;
    }

    return discount;
  }

  /// Whether the promo is expired
  bool get isExpired => validUntil != null && DateTime.now().isAfter(validUntil!);

  /// Whether the promo has uses remaining
  bool get hasUsesRemaining => usesRemaining == null || usesRemaining! > 0;

  /// Whether the promo is valid
  bool get isValid => !isExpired && hasUsesRemaining;

  @override
  List<Object?> get props => [code, type, value];
}

/// Type of promo code
enum PromoType {
  percentage('percentage', '%'),
  fixed('fixed', 'off');

  const PromoType(this.value, this.suffix);

  final String value;
  final String suffix;
}
