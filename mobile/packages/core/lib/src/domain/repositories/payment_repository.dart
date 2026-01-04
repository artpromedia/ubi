/// Payment Repository Interface
///
/// Contract for payment and wallet data operations.
library;

import '../../../core.dart';

/// Repository for payment operations
abstract class PaymentRepository {
  /// Process a payment
  Future<Result<Payment>> processPayment({
    required double amount,
    required String currency,
    required PaymentMethodType methodType,
    String? paymentMethodId,
    required String transactionType, // ride, food_order, delivery
    required String transactionId,
    Map<String, dynamic>? metadata,
  });

  /// Get payment status
  Future<Result<Payment>> getPaymentStatus(String paymentId);

  /// Initiate M-Pesa payment
  Future<Result<Payment>> initiateMpesaPayment({
    required String phoneNumber,
    required double amount,
    required String transactionType,
    required String transactionId,
    String? description,
  });

  /// Check M-Pesa payment status
  Future<Result<Payment>> checkMpesaStatus(String checkoutRequestId);

  /// Initiate MTN Mobile Money payment
  Future<Result<Payment>> initiateMtnPayment({
    required String phoneNumber,
    required double amount,
    required String currency,
    required String transactionType,
    required String transactionId,
    String? description,
  });

  /// Check MTN Mobile Money payment status
  Future<Result<Payment>> checkMtnStatus(String referenceId);

  /// Create Stripe payment intent
  Future<Result<Map<String, dynamic>>> createStripePaymentIntent({
    required double amount,
    required String currency,
    String? customerId,
    String? paymentMethodId,
    Map<String, dynamic>? metadata,
  });

  /// Confirm Stripe payment
  Future<Result<Payment>> confirmStripePayment(String paymentIntentId);

  /// Get wallet balance
  Future<Result<Wallet>> getWalletBalance();

  /// Top up wallet
  Future<Result<WalletTransaction>> topUpWallet({
    required double amount,
    required PaymentMethodType sourceType,
    String? paymentMethodId,
  });

  /// Withdraw from wallet
  Future<Result<WalletTransaction>> withdrawFromWallet({
    required double amount,
    required String destinationType, // mpesa, mtn, bank
    required String destinationAccount,
  });

  /// Get wallet transactions
  Future<Result<List<WalletTransaction>>> getWalletTransactions({
    int page = 1,
    int perPage = 20,
    WalletTransactionType? type,
    DateTime? startDate,
    DateTime? endDate,
  });

  /// Validate promo code
  Future<Result<PromoCode>> validatePromoCode({
    required String code,
    String? transactionType,
    double? orderAmount,
  });

  /// Apply promo code to transaction
  Future<Result<double>> applyPromoCode({
    required String code,
    required String transactionType,
    required String transactionId,
  });

  /// Request refund
  Future<Result<Payment>> requestRefund({
    required String paymentId,
    double? amount, // null for full refund
    String? reason,
  });
}
