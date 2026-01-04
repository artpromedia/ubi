/// Payment Service
///
/// API service for payment endpoints.
library;

import 'package:dio/dio.dart';
import 'package:json_annotation/json_annotation.dart';
import 'package:retrofit/retrofit.dart';

import 'user_service.dart';

part 'payment_service.g.dart';

/// Payment API Service
///
/// Handles all payment-related API calls including:
/// - Payment processing
/// - Mobile money (M-Pesa, MTN MoMo)
/// - Wallet operations
@RestApi()
abstract class PaymentService {
  factory PaymentService(Dio dio, {String baseUrl}) = _PaymentService;

  // === Payment Processing ===

  /// Process payment for a ride/order
  @POST('/payments/process')
  Future<PaymentResultDto> processPayment(@Body() ProcessPaymentDto request);

  /// Get payment status
  @GET('/payments/{id}/status')
  Future<PaymentStatusDto> getPaymentStatus(@Path('id') String id);

  // === M-Pesa ===

  /// Initiate M-Pesa STK push
  @POST('/payments/mpesa/stk-push')
  Future<MpesaInitResponseDto> initiateMpesaPayment(
    @Body() MpesaPaymentRequestDto request,
  );

  /// Query M-Pesa payment status
  @GET('/payments/mpesa/{transactionId}/status')
  Future<MpesaStatusDto> getMpesaStatus(@Path('transactionId') String transactionId);

  // === MTN Mobile Money ===

  /// Initiate MTN MoMo payment
  @POST('/payments/mtn/request-to-pay')
  Future<MtnInitResponseDto> initiateMtnPayment(
    @Body() MtnPaymentRequestDto request,
  );

  /// Query MTN MoMo payment status
  @GET('/payments/mtn/{referenceId}/status')
  Future<MtnStatusDto> getMtnStatus(@Path('referenceId') String referenceId);

  // === Stripe ===

  /// Create Stripe payment intent
  @POST('/payments/stripe/create-payment-intent')
  Future<StripePaymentIntentDto> createStripePaymentIntent(
    @Body() CreatePaymentIntentDto request,
  );

  /// Confirm Stripe payment
  @POST('/payments/stripe/confirm')
  Future<PaymentResultDto> confirmStripePayment(
    @Body() ConfirmStripePaymentDto request,
  );

  /// Create Stripe setup intent (for saving cards)
  @POST('/payments/stripe/create-setup-intent')
  Future<StripeSetupIntentDto> createStripeSetupIntent();

  // === Wallet ===

  /// Get wallet balance
  @GET('/payments/wallet')
  Future<WalletBalanceDto> getWalletBalance();

  /// Top up wallet
  @POST('/payments/wallet/top-up')
  Future<TopUpResultDto> topUpWallet(@Body() TopUpWalletDto request);

  /// Withdraw from wallet (for drivers)
  @POST('/payments/wallet/withdraw')
  Future<WithdrawalResultDto> withdrawFromWallet(@Body() WithdrawDto request);

  /// Get wallet transactions
  @GET('/payments/wallet/transactions')
  Future<PaginatedResponseDto<WalletTransactionDetailDto>> getWalletTransactions(
    @Query('page') int page,
    @Query('limit') int limit,
    @Query('type') String? type,
  );

  // === Promo Codes ===

  /// Validate promo code
  @POST('/payments/promo/validate')
  Future<PromoCodeDto> validatePromoCode(@Body() ValidatePromoCodeDto request);

  /// Apply promo code
  @POST('/payments/promo/apply')
  Future<AppliedPromoDto> applyPromoCode(@Body() ApplyPromoCodeDto request);

  /// Get available promo codes
  @GET('/payments/promo/available')
  Future<List<PromoCodeDto>> getAvailablePromoCodes();
}

// === Payment Processing DTOs ===

@JsonSerializable()
class ProcessPaymentDto {
  const ProcessPaymentDto({
    required this.orderId,
    required this.orderType,
    required this.paymentMethodId,
    required this.amount,
    required this.currency,
    this.promoCode,
  });

  factory ProcessPaymentDto.fromJson(Map<String, dynamic> json) =>
      _$ProcessPaymentDtoFromJson(json);

  final String orderId;
  final String orderType; // 'ride', 'food', 'delivery'
  final String paymentMethodId;
  final double amount;
  final String currency;
  final String? promoCode;

  Map<String, dynamic> toJson() => _$ProcessPaymentDtoToJson(this);
}

@JsonSerializable()
class PaymentResultDto {
  const PaymentResultDto({
    required this.id,
    required this.status,
    required this.amount,
    required this.currency,
    this.transactionId,
    this.receiptUrl,
    this.errorMessage,
  });

  factory PaymentResultDto.fromJson(Map<String, dynamic> json) =>
      _$PaymentResultDtoFromJson(json);

  final String id;
  final String status; // 'success', 'pending', 'failed'
  final double amount;
  final String currency;
  final String? transactionId;
  final String? receiptUrl;
  final String? errorMessage;

  Map<String, dynamic> toJson() => _$PaymentResultDtoToJson(this);
}

@JsonSerializable()
class PaymentStatusDto {
  const PaymentStatusDto({
    required this.id,
    required this.status,
    required this.amount,
    required this.currency,
    this.paidAt,
    this.failedAt,
    this.errorMessage,
  });

  factory PaymentStatusDto.fromJson(Map<String, dynamic> json) =>
      _$PaymentStatusDtoFromJson(json);

  final String id;
  final String status;
  final double amount;
  final String currency;
  final DateTime? paidAt;
  final DateTime? failedAt;
  final String? errorMessage;

  Map<String, dynamic> toJson() => _$PaymentStatusDtoToJson(this);
}

// === M-Pesa DTOs ===

@JsonSerializable()
class MpesaPaymentRequestDto {
  const MpesaPaymentRequestDto({
    required this.phoneNumber,
    required this.amount,
    required this.orderId,
    required this.orderType,
    this.description,
  });

  factory MpesaPaymentRequestDto.fromJson(Map<String, dynamic> json) =>
      _$MpesaPaymentRequestDtoFromJson(json);

  final String phoneNumber;
  final double amount;
  final String orderId;
  final String orderType;
  final String? description;

  Map<String, dynamic> toJson() => _$MpesaPaymentRequestDtoToJson(this);
}

@JsonSerializable()
class MpesaInitResponseDto {
  const MpesaInitResponseDto({
    required this.checkoutRequestId,
    required this.merchantRequestId,
    required this.responseDescription,
  });

  factory MpesaInitResponseDto.fromJson(Map<String, dynamic> json) =>
      _$MpesaInitResponseDtoFromJson(json);

  final String checkoutRequestId;
  final String merchantRequestId;
  final String responseDescription;

  Map<String, dynamic> toJson() => _$MpesaInitResponseDtoToJson(this);
}

@JsonSerializable()
class MpesaStatusDto {
  const MpesaStatusDto({
    required this.resultCode,
    required this.resultDesc,
    this.transactionId,
    this.amount,
  });

  factory MpesaStatusDto.fromJson(Map<String, dynamic> json) =>
      _$MpesaStatusDtoFromJson(json);

  final String resultCode;
  final String resultDesc;
  final String? transactionId;
  final double? amount;

  bool get isSuccess => resultCode == '0';

  Map<String, dynamic> toJson() => _$MpesaStatusDtoToJson(this);
}

// === MTN MoMo DTOs ===

@JsonSerializable()
class MtnPaymentRequestDto {
  const MtnPaymentRequestDto({
    required this.phoneNumber,
    required this.amount,
    required this.currency,
    required this.orderId,
    required this.orderType,
    this.payerMessage,
    this.payeeNote,
  });

  factory MtnPaymentRequestDto.fromJson(Map<String, dynamic> json) =>
      _$MtnPaymentRequestDtoFromJson(json);

  final String phoneNumber;
  final double amount;
  final String currency;
  final String orderId;
  final String orderType;
  final String? payerMessage;
  final String? payeeNote;

  Map<String, dynamic> toJson() => _$MtnPaymentRequestDtoToJson(this);
}

@JsonSerializable()
class MtnInitResponseDto {
  const MtnInitResponseDto({
    required this.referenceId,
    required this.status,
  });

  factory MtnInitResponseDto.fromJson(Map<String, dynamic> json) =>
      _$MtnInitResponseDtoFromJson(json);

  final String referenceId;
  final String status;

  Map<String, dynamic> toJson() => _$MtnInitResponseDtoToJson(this);
}

@JsonSerializable()
class MtnStatusDto {
  const MtnStatusDto({
    required this.status,
    this.financialTransactionId,
    this.amount,
    this.currency,
    this.reason,
  });

  factory MtnStatusDto.fromJson(Map<String, dynamic> json) =>
      _$MtnStatusDtoFromJson(json);

  final String status; // 'PENDING', 'SUCCESSFUL', 'FAILED'
  final String? financialTransactionId;
  final double? amount;
  final String? currency;
  final String? reason;

  bool get isSuccess => status == 'SUCCESSFUL';
  bool get isPending => status == 'PENDING';

  Map<String, dynamic> toJson() => _$MtnStatusDtoToJson(this);
}

// === Stripe DTOs ===

@JsonSerializable()
class CreatePaymentIntentDto {
  const CreatePaymentIntentDto({
    required this.amount,
    required this.currency,
    required this.orderId,
    required this.orderType,
    this.paymentMethodId,
  });

  factory CreatePaymentIntentDto.fromJson(Map<String, dynamic> json) =>
      _$CreatePaymentIntentDtoFromJson(json);

  final int amount; // in smallest currency unit (cents)
  final String currency;
  final String orderId;
  final String orderType;
  final String? paymentMethodId;

  Map<String, dynamic> toJson() => _$CreatePaymentIntentDtoToJson(this);
}

@JsonSerializable()
class StripePaymentIntentDto {
  const StripePaymentIntentDto({
    required this.clientSecret,
    required this.paymentIntentId,
    this.ephemeralKey,
    this.customerId,
  });

  factory StripePaymentIntentDto.fromJson(Map<String, dynamic> json) =>
      _$StripePaymentIntentDtoFromJson(json);

  final String clientSecret;
  final String paymentIntentId;
  final String? ephemeralKey;
  final String? customerId;

  Map<String, dynamic> toJson() => _$StripePaymentIntentDtoToJson(this);
}

@JsonSerializable()
class ConfirmStripePaymentDto {
  const ConfirmStripePaymentDto({
    required this.paymentIntentId,
    required this.paymentMethodId,
  });

  factory ConfirmStripePaymentDto.fromJson(Map<String, dynamic> json) =>
      _$ConfirmStripePaymentDtoFromJson(json);

  final String paymentIntentId;
  final String paymentMethodId;

  Map<String, dynamic> toJson() => _$ConfirmStripePaymentDtoToJson(this);
}

@JsonSerializable()
class StripeSetupIntentDto {
  const StripeSetupIntentDto({
    required this.clientSecret,
    required this.setupIntentId,
    this.ephemeralKey,
    this.customerId,
  });

  factory StripeSetupIntentDto.fromJson(Map<String, dynamic> json) =>
      _$StripeSetupIntentDtoFromJson(json);

  final String clientSecret;
  final String setupIntentId;
  final String? ephemeralKey;
  final String? customerId;

  Map<String, dynamic> toJson() => _$StripeSetupIntentDtoToJson(this);
}

// === Wallet DTOs ===

@JsonSerializable()
class WalletBalanceDto {
  const WalletBalanceDto({
    required this.balance,
    required this.currency,
    this.pendingBalance,
    this.availableBalance,
  });

  factory WalletBalanceDto.fromJson(Map<String, dynamic> json) =>
      _$WalletBalanceDtoFromJson(json);

  final double balance;
  final String currency;
  final double? pendingBalance;
  final double? availableBalance;

  Map<String, dynamic> toJson() => _$WalletBalanceDtoToJson(this);
}

@JsonSerializable()
class TopUpWalletDto {
  const TopUpWalletDto({
    required this.amount,
    required this.currency,
    required this.paymentMethodType,
    this.paymentMethodId,
    this.phoneNumber,
  });

  factory TopUpWalletDto.fromJson(Map<String, dynamic> json) =>
      _$TopUpWalletDtoFromJson(json);

  final double amount;
  final String currency;
  final String paymentMethodType; // 'card', 'mpesa', 'mtn'
  final String? paymentMethodId;
  final String? phoneNumber;

  Map<String, dynamic> toJson() => _$TopUpWalletDtoToJson(this);
}

@JsonSerializable()
class TopUpResultDto {
  const TopUpResultDto({
    required this.id,
    required this.status,
    required this.amount,
    required this.currency,
    this.transactionId,
    this.newBalance,
    this.errorMessage,
  });

  factory TopUpResultDto.fromJson(Map<String, dynamic> json) =>
      _$TopUpResultDtoFromJson(json);

  final String id;
  final String status;
  final double amount;
  final String currency;
  final String? transactionId;
  final double? newBalance;
  final String? errorMessage;

  Map<String, dynamic> toJson() => _$TopUpResultDtoToJson(this);
}

@JsonSerializable()
class WithdrawDto {
  const WithdrawDto({
    required this.amount,
    required this.currency,
    required this.withdrawalMethod,
    this.phoneNumber,
    this.bankAccountId,
  });

  factory WithdrawDto.fromJson(Map<String, dynamic> json) =>
      _$WithdrawDtoFromJson(json);

  final double amount;
  final String currency;
  final String withdrawalMethod; // 'mpesa', 'mtn', 'bank'
  final String? phoneNumber;
  final String? bankAccountId;

  Map<String, dynamic> toJson() => _$WithdrawDtoToJson(this);
}

@JsonSerializable()
class WithdrawalResultDto {
  const WithdrawalResultDto({
    required this.id,
    required this.status,
    required this.amount,
    required this.currency,
    this.transactionId,
    this.newBalance,
    this.estimatedArrival,
    this.errorMessage,
  });

  factory WithdrawalResultDto.fromJson(Map<String, dynamic> json) =>
      _$WithdrawalResultDtoFromJson(json);

  final String id;
  final String status;
  final double amount;
  final String currency;
  final String? transactionId;
  final double? newBalance;
  final DateTime? estimatedArrival;
  final String? errorMessage;

  Map<String, dynamic> toJson() => _$WithdrawalResultDtoToJson(this);
}

@JsonSerializable()
class WalletTransactionDetailDto {
  const WalletTransactionDetailDto({
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

  factory WalletTransactionDetailDto.fromJson(Map<String, dynamic> json) =>
      _$WalletTransactionDetailDtoFromJson(json);

  final String id;
  final String type; // 'credit', 'debit', 'refund', 'topup', 'withdrawal', 'earning'
  final double amount;
  final String currency;
  final String status;
  final DateTime createdAt;
  final String? description;
  final String? referenceId;
  final String? referenceType;
  final double? balanceAfter;

  Map<String, dynamic> toJson() => _$WalletTransactionDetailDtoToJson(this);
}

// === Promo Code DTOs ===

@JsonSerializable()
class ValidatePromoCodeDto {
  const ValidatePromoCodeDto({
    required this.code,
    required this.orderType,
    this.amount,
  });

  factory ValidatePromoCodeDto.fromJson(Map<String, dynamic> json) =>
      _$ValidatePromoCodeDtoFromJson(json);

  final String code;
  final String orderType;
  final double? amount;

  Map<String, dynamic> toJson() => _$ValidatePromoCodeDtoToJson(this);
}

@JsonSerializable()
class PromoCodeDto {
  const PromoCodeDto({
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

  factory PromoCodeDto.fromJson(Map<String, dynamic> json) =>
      _$PromoCodeDtoFromJson(json);

  final String code;
  final String type; // 'percentage', 'fixed'
  final double value;
  final String? description;
  final double? minOrderAmount;
  final double? maxDiscount;
  final DateTime? validUntil;
  final int? usesRemaining;
  final List<String>? applicableServices;

  Map<String, dynamic> toJson() => _$PromoCodeDtoToJson(this);
}

@JsonSerializable()
class ApplyPromoCodeDto {
  const ApplyPromoCodeDto({
    required this.code,
    required this.orderId,
    required this.orderType,
  });

  factory ApplyPromoCodeDto.fromJson(Map<String, dynamic> json) =>
      _$ApplyPromoCodeDtoFromJson(json);

  final String code;
  final String orderId;
  final String orderType;

  Map<String, dynamic> toJson() => _$ApplyPromoCodeDtoToJson(this);
}

@JsonSerializable()
class AppliedPromoDto {
  const AppliedPromoDto({
    required this.code,
    required this.discount,
    required this.currency,
    required this.originalAmount,
    required this.newAmount,
  });

  factory AppliedPromoDto.fromJson(Map<String, dynamic> json) =>
      _$AppliedPromoDtoFromJson(json);

  final String code;
  final double discount;
  final String currency;
  final double originalAmount;
  final double newAmount;

  Map<String, dynamic> toJson() => _$AppliedPromoDtoToJson(this);
}
