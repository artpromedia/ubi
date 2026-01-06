/// Payment Use Cases
///
/// Business logic for payment and wallet operations.
library;

import '../../core/result/result.dart';
import '../entities/payment.dart';
import '../repositories/payment_repository.dart';
import 'use_case.dart';

/// Process a payment
class ProcessPaymentUseCase implements UseCase<Payment, ProcessPaymentParams> {
  const ProcessPaymentUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<Payment>> call(ProcessPaymentParams params) {
    return repository.processPayment(
      amount: params.amount,
      currency: params.currency,
      methodType: params.methodType,
      paymentMethodId: params.paymentMethodId,
      transactionType: params.transactionType,
      transactionId: params.transactionId,
      metadata: params.metadata,
    );
  }
}

class ProcessPaymentParams {
  const ProcessPaymentParams({
    required this.amount,
    required this.currency,
    required this.methodType,
    this.paymentMethodId,
    required this.transactionType,
    required this.transactionId,
    this.metadata,
  });

  final double amount;
  final String currency;
  final PaymentMethodType methodType;
  final String? paymentMethodId;
  final String transactionType;
  final String transactionId;
  final Map<String, dynamic>? metadata;
}

/// Get payment status
class GetPaymentStatusUseCase implements UseCase<Payment, String> {
  const GetPaymentStatusUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<Payment>> call(String paymentId) {
    return repository.getPaymentStatus(paymentId);
  }
}

/// Initiate M-Pesa payment (Kenya)
class InitiateMpesaPaymentUseCase implements UseCase<Payment, InitiateMpesaParams> {
  const InitiateMpesaPaymentUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<Payment>> call(InitiateMpesaParams params) {
    return repository.initiateMpesaPayment(
      phoneNumber: params.phoneNumber,
      amount: params.amount,
      transactionType: params.transactionType,
      transactionId: params.transactionId,
      description: params.description,
    );
  }
}

class InitiateMpesaParams {
  const InitiateMpesaParams({
    required this.phoneNumber,
    required this.amount,
    required this.transactionType,
    required this.transactionId,
    this.description,
  });

  final String phoneNumber;
  final double amount;
  final String transactionType;
  final String transactionId;
  final String? description;
}

/// Check M-Pesa payment status
class CheckMpesaStatusUseCase implements UseCase<Payment, String> {
  const CheckMpesaStatusUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<Payment>> call(String checkoutRequestId) {
    return repository.checkMpesaStatus(checkoutRequestId);
  }
}

/// Initiate MTN Mobile Money payment
class InitiateMtnPaymentUseCase implements UseCase<Payment, InitiateMtnParams> {
  const InitiateMtnPaymentUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<Payment>> call(InitiateMtnParams params) {
    return repository.initiateMtnPayment(
      phoneNumber: params.phoneNumber,
      amount: params.amount,
      currency: params.currency,
      transactionType: params.transactionType,
      transactionId: params.transactionId,
      description: params.description,
    );
  }
}

class InitiateMtnParams {
  const InitiateMtnParams({
    required this.phoneNumber,
    required this.amount,
    required this.currency,
    required this.transactionType,
    required this.transactionId,
    this.description,
  });

  final String phoneNumber;
  final double amount;
  final String currency;
  final String transactionType;
  final String transactionId;
  final String? description;
}

/// Check MTN MoMo payment status
class CheckMtnStatusUseCase implements UseCase<Payment, String> {
  const CheckMtnStatusUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<Payment>> call(String referenceId) {
    return repository.checkMtnStatus(referenceId);
  }
}

/// Create Stripe payment intent
class CreateStripePaymentIntentUseCase implements UseCase<Map<String, dynamic>, CreateStripeIntentParams> {
  const CreateStripePaymentIntentUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<Map<String, dynamic>>> call(CreateStripeIntentParams params) {
    return repository.createStripePaymentIntent(
      amount: params.amount,
      currency: params.currency,
      customerId: params.customerId,
      paymentMethodId: params.paymentMethodId,
      metadata: params.metadata,
    );
  }
}

class CreateStripeIntentParams {
  const CreateStripeIntentParams({
    required this.amount,
    required this.currency,
    this.customerId,
    this.paymentMethodId,
    this.metadata,
  });

  final double amount;
  final String currency;
  final String? customerId;
  final String? paymentMethodId;
  final Map<String, dynamic>? metadata;
}

/// Confirm Stripe payment
class ConfirmStripePaymentUseCase implements UseCase<Payment, String> {
  const ConfirmStripePaymentUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<Payment>> call(String paymentIntentId) {
    return repository.confirmStripePayment(paymentIntentId);
  }
}

/// Get wallet balance
class GetWalletBalanceUseCase implements UseCase<Wallet, NoParams> {
  const GetWalletBalanceUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<Wallet>> call(NoParams params) {
    return repository.getWalletBalance();
  }
}

/// Top up wallet
class TopUpWalletUseCase implements UseCase<WalletTransaction, TopUpWalletParams> {
  const TopUpWalletUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<WalletTransaction>> call(TopUpWalletParams params) {
    return repository.topUpWallet(
      amount: params.amount,
      sourceType: params.sourceType,
      paymentMethodId: params.paymentMethodId,
    );
  }
}

class TopUpWalletParams {
  const TopUpWalletParams({
    required this.amount,
    required this.sourceType,
    this.paymentMethodId,
  });

  final double amount;
  final PaymentMethodType sourceType;
  final String? paymentMethodId;
}

/// Withdraw from wallet
class WithdrawFromWalletUseCase implements UseCase<WalletTransaction, WithdrawParams> {
  const WithdrawFromWalletUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<WalletTransaction>> call(WithdrawParams params) {
    return repository.withdrawFromWallet(
      amount: params.amount,
      destinationType: params.destinationType,
      destinationAccount: params.destinationAccount,
    );
  }
}

class WithdrawParams {
  const WithdrawParams({
    required this.amount,
    required this.destinationType,
    required this.destinationAccount,
  });

  final double amount;
  final String destinationType;
  final String destinationAccount;
}

/// Get wallet transactions
class GetWalletTransactionsUseCase implements UseCase<List<WalletTransaction>, GetTransactionsParams> {
  const GetWalletTransactionsUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<List<WalletTransaction>>> call(GetTransactionsParams params) {
    return repository.getWalletTransactions(
      page: params.page,
      perPage: params.perPage,
      type: params.type,
      startDate: params.startDate,
      endDate: params.endDate,
    );
  }
}

class GetTransactionsParams {
  const GetTransactionsParams({
    this.page = 1,
    this.perPage = 20,
    this.type,
    this.startDate,
    this.endDate,
  });

  final int page;
  final int perPage;
  final WalletTransactionType? type;
  final DateTime? startDate;
  final DateTime? endDate;
}

/// Validate promo code
class ValidatePromoCodeUseCase implements UseCase<PromoCode, ValidatePromoParams> {
  const ValidatePromoCodeUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<PromoCode>> call(ValidatePromoParams params) {
    return repository.validatePromoCode(
      code: params.code,
      transactionType: params.transactionType,
      orderAmount: params.orderAmount,
    );
  }
}

class ValidatePromoParams {
  const ValidatePromoParams({
    required this.code,
    this.transactionType,
    this.orderAmount,
  });

  final String code;
  final String? transactionType;
  final double? orderAmount;
}

/// Apply promo code to transaction
class ApplyPromoCodeUseCase implements UseCase<double, ApplyPromoParams> {
  const ApplyPromoCodeUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<double>> call(ApplyPromoParams params) {
    return repository.applyPromoCode(
      code: params.code,
      transactionType: params.transactionType,
      transactionId: params.transactionId,
    );
  }
}

class ApplyPromoParams {
  const ApplyPromoParams({
    required this.code,
    required this.transactionType,
    required this.transactionId,
  });

  final String code;
  final String transactionType;
  final String transactionId;
}

/// Request refund
class RequestRefundUseCase implements UseCase<Payment, RequestRefundParams> {
  const RequestRefundUseCase(this.repository);

  final PaymentRepository repository;

  @override
  Future<Result<Payment>> call(RequestRefundParams params) {
    return repository.requestRefund(
      paymentId: params.paymentId,
      amount: params.amount,
      reason: params.reason,
    );
  }
}

class RequestRefundParams {
  const RequestRefundParams({
    required this.paymentId,
    this.amount,
    this.reason,
  });

  final String paymentId;
  final double? amount;
  final String? reason;
}

