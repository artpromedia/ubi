// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payment_service.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ProcessPaymentDto _$ProcessPaymentDtoFromJson(Map<String, dynamic> json) =>
    ProcessPaymentDto(
      orderId: json['orderId'] as String,
      orderType: json['orderType'] as String,
      paymentMethodId: json['paymentMethodId'] as String,
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
      promoCode: json['promoCode'] as String?,
    );

Map<String, dynamic> _$ProcessPaymentDtoToJson(ProcessPaymentDto instance) =>
    <String, dynamic>{
      'orderId': instance.orderId,
      'orderType': instance.orderType,
      'paymentMethodId': instance.paymentMethodId,
      'amount': instance.amount,
      'currency': instance.currency,
      'promoCode': instance.promoCode,
    };

PaymentResultDto _$PaymentResultDtoFromJson(Map<String, dynamic> json) =>
    PaymentResultDto(
      id: json['id'] as String,
      status: json['status'] as String,
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
      transactionId: json['transactionId'] as String?,
      receiptUrl: json['receiptUrl'] as String?,
      errorMessage: json['errorMessage'] as String?,
    );

Map<String, dynamic> _$PaymentResultDtoToJson(PaymentResultDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'status': instance.status,
      'amount': instance.amount,
      'currency': instance.currency,
      'transactionId': instance.transactionId,
      'receiptUrl': instance.receiptUrl,
      'errorMessage': instance.errorMessage,
    };

PaymentStatusDto _$PaymentStatusDtoFromJson(Map<String, dynamic> json) =>
    PaymentStatusDto(
      id: json['id'] as String,
      status: json['status'] as String,
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
      paidAt: json['paidAt'] == null
          ? null
          : DateTime.parse(json['paidAt'] as String),
      failedAt: json['failedAt'] == null
          ? null
          : DateTime.parse(json['failedAt'] as String),
      errorMessage: json['errorMessage'] as String?,
    );

Map<String, dynamic> _$PaymentStatusDtoToJson(PaymentStatusDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'status': instance.status,
      'amount': instance.amount,
      'currency': instance.currency,
      'paidAt': instance.paidAt?.toIso8601String(),
      'failedAt': instance.failedAt?.toIso8601String(),
      'errorMessage': instance.errorMessage,
    };

MpesaPaymentRequestDto _$MpesaPaymentRequestDtoFromJson(
        Map<String, dynamic> json) =>
    MpesaPaymentRequestDto(
      phoneNumber: json['phoneNumber'] as String,
      amount: (json['amount'] as num).toDouble(),
      orderId: json['orderId'] as String,
      orderType: json['orderType'] as String,
      description: json['description'] as String?,
    );

Map<String, dynamic> _$MpesaPaymentRequestDtoToJson(
        MpesaPaymentRequestDto instance) =>
    <String, dynamic>{
      'phoneNumber': instance.phoneNumber,
      'amount': instance.amount,
      'orderId': instance.orderId,
      'orderType': instance.orderType,
      'description': instance.description,
    };

MpesaInitResponseDto _$MpesaInitResponseDtoFromJson(
        Map<String, dynamic> json) =>
    MpesaInitResponseDto(
      checkoutRequestId: json['checkoutRequestId'] as String,
      merchantRequestId: json['merchantRequestId'] as String,
      responseDescription: json['responseDescription'] as String,
    );

Map<String, dynamic> _$MpesaInitResponseDtoToJson(
        MpesaInitResponseDto instance) =>
    <String, dynamic>{
      'checkoutRequestId': instance.checkoutRequestId,
      'merchantRequestId': instance.merchantRequestId,
      'responseDescription': instance.responseDescription,
    };

MpesaStatusDto _$MpesaStatusDtoFromJson(Map<String, dynamic> json) =>
    MpesaStatusDto(
      resultCode: json['resultCode'] as String,
      resultDesc: json['resultDesc'] as String,
      transactionId: json['transactionId'] as String?,
      amount: (json['amount'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$MpesaStatusDtoToJson(MpesaStatusDto instance) =>
    <String, dynamic>{
      'resultCode': instance.resultCode,
      'resultDesc': instance.resultDesc,
      'transactionId': instance.transactionId,
      'amount': instance.amount,
    };

MtnPaymentRequestDto _$MtnPaymentRequestDtoFromJson(
        Map<String, dynamic> json) =>
    MtnPaymentRequestDto(
      phoneNumber: json['phoneNumber'] as String,
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
      orderId: json['orderId'] as String,
      orderType: json['orderType'] as String,
      payerMessage: json['payerMessage'] as String?,
      payeeNote: json['payeeNote'] as String?,
    );

Map<String, dynamic> _$MtnPaymentRequestDtoToJson(
        MtnPaymentRequestDto instance) =>
    <String, dynamic>{
      'phoneNumber': instance.phoneNumber,
      'amount': instance.amount,
      'currency': instance.currency,
      'orderId': instance.orderId,
      'orderType': instance.orderType,
      'payerMessage': instance.payerMessage,
      'payeeNote': instance.payeeNote,
    };

MtnInitResponseDto _$MtnInitResponseDtoFromJson(Map<String, dynamic> json) =>
    MtnInitResponseDto(
      referenceId: json['referenceId'] as String,
      status: json['status'] as String,
    );

Map<String, dynamic> _$MtnInitResponseDtoToJson(MtnInitResponseDto instance) =>
    <String, dynamic>{
      'referenceId': instance.referenceId,
      'status': instance.status,
    };

MtnStatusDto _$MtnStatusDtoFromJson(Map<String, dynamic> json) => MtnStatusDto(
      status: json['status'] as String,
      financialTransactionId: json['financialTransactionId'] as String?,
      amount: (json['amount'] as num?)?.toDouble(),
      currency: json['currency'] as String?,
      reason: json['reason'] as String?,
    );

Map<String, dynamic> _$MtnStatusDtoToJson(MtnStatusDto instance) =>
    <String, dynamic>{
      'status': instance.status,
      'financialTransactionId': instance.financialTransactionId,
      'amount': instance.amount,
      'currency': instance.currency,
      'reason': instance.reason,
    };

CreatePaymentIntentDto _$CreatePaymentIntentDtoFromJson(
        Map<String, dynamic> json) =>
    CreatePaymentIntentDto(
      amount: (json['amount'] as num).toInt(),
      currency: json['currency'] as String,
      orderId: json['orderId'] as String,
      orderType: json['orderType'] as String,
      paymentMethodId: json['paymentMethodId'] as String?,
    );

Map<String, dynamic> _$CreatePaymentIntentDtoToJson(
        CreatePaymentIntentDto instance) =>
    <String, dynamic>{
      'amount': instance.amount,
      'currency': instance.currency,
      'orderId': instance.orderId,
      'orderType': instance.orderType,
      'paymentMethodId': instance.paymentMethodId,
    };

StripePaymentIntentDto _$StripePaymentIntentDtoFromJson(
        Map<String, dynamic> json) =>
    StripePaymentIntentDto(
      clientSecret: json['clientSecret'] as String,
      paymentIntentId: json['paymentIntentId'] as String,
      ephemeralKey: json['ephemeralKey'] as String?,
      customerId: json['customerId'] as String?,
    );

Map<String, dynamic> _$StripePaymentIntentDtoToJson(
        StripePaymentIntentDto instance) =>
    <String, dynamic>{
      'clientSecret': instance.clientSecret,
      'paymentIntentId': instance.paymentIntentId,
      'ephemeralKey': instance.ephemeralKey,
      'customerId': instance.customerId,
    };

ConfirmStripePaymentDto _$ConfirmStripePaymentDtoFromJson(
        Map<String, dynamic> json) =>
    ConfirmStripePaymentDto(
      paymentIntentId: json['paymentIntentId'] as String,
      paymentMethodId: json['paymentMethodId'] as String,
    );

Map<String, dynamic> _$ConfirmStripePaymentDtoToJson(
        ConfirmStripePaymentDto instance) =>
    <String, dynamic>{
      'paymentIntentId': instance.paymentIntentId,
      'paymentMethodId': instance.paymentMethodId,
    };

StripeSetupIntentDto _$StripeSetupIntentDtoFromJson(
        Map<String, dynamic> json) =>
    StripeSetupIntentDto(
      clientSecret: json['clientSecret'] as String,
      setupIntentId: json['setupIntentId'] as String,
      ephemeralKey: json['ephemeralKey'] as String?,
      customerId: json['customerId'] as String?,
    );

Map<String, dynamic> _$StripeSetupIntentDtoToJson(
        StripeSetupIntentDto instance) =>
    <String, dynamic>{
      'clientSecret': instance.clientSecret,
      'setupIntentId': instance.setupIntentId,
      'ephemeralKey': instance.ephemeralKey,
      'customerId': instance.customerId,
    };

WalletBalanceDto _$WalletBalanceDtoFromJson(Map<String, dynamic> json) =>
    WalletBalanceDto(
      balance: (json['balance'] as num).toDouble(),
      currency: json['currency'] as String,
      pendingBalance: (json['pendingBalance'] as num?)?.toDouble(),
      availableBalance: (json['availableBalance'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$WalletBalanceDtoToJson(WalletBalanceDto instance) =>
    <String, dynamic>{
      'balance': instance.balance,
      'currency': instance.currency,
      'pendingBalance': instance.pendingBalance,
      'availableBalance': instance.availableBalance,
    };

TopUpWalletDto _$TopUpWalletDtoFromJson(Map<String, dynamic> json) =>
    TopUpWalletDto(
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
      paymentMethodType: json['paymentMethodType'] as String,
      paymentMethodId: json['paymentMethodId'] as String?,
      phoneNumber: json['phoneNumber'] as String?,
    );

Map<String, dynamic> _$TopUpWalletDtoToJson(TopUpWalletDto instance) =>
    <String, dynamic>{
      'amount': instance.amount,
      'currency': instance.currency,
      'paymentMethodType': instance.paymentMethodType,
      'paymentMethodId': instance.paymentMethodId,
      'phoneNumber': instance.phoneNumber,
    };

TopUpResultDto _$TopUpResultDtoFromJson(Map<String, dynamic> json) =>
    TopUpResultDto(
      id: json['id'] as String,
      status: json['status'] as String,
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
      transactionId: json['transactionId'] as String?,
      newBalance: (json['newBalance'] as num?)?.toDouble(),
      errorMessage: json['errorMessage'] as String?,
    );

Map<String, dynamic> _$TopUpResultDtoToJson(TopUpResultDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'status': instance.status,
      'amount': instance.amount,
      'currency': instance.currency,
      'transactionId': instance.transactionId,
      'newBalance': instance.newBalance,
      'errorMessage': instance.errorMessage,
    };

WithdrawDto _$WithdrawDtoFromJson(Map<String, dynamic> json) => WithdrawDto(
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
      withdrawalMethod: json['withdrawalMethod'] as String,
      phoneNumber: json['phoneNumber'] as String?,
      bankAccountId: json['bankAccountId'] as String?,
    );

Map<String, dynamic> _$WithdrawDtoToJson(WithdrawDto instance) =>
    <String, dynamic>{
      'amount': instance.amount,
      'currency': instance.currency,
      'withdrawalMethod': instance.withdrawalMethod,
      'phoneNumber': instance.phoneNumber,
      'bankAccountId': instance.bankAccountId,
    };

WithdrawalResultDto _$WithdrawalResultDtoFromJson(Map<String, dynamic> json) =>
    WithdrawalResultDto(
      id: json['id'] as String,
      status: json['status'] as String,
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
      transactionId: json['transactionId'] as String?,
      newBalance: (json['newBalance'] as num?)?.toDouble(),
      estimatedArrival: json['estimatedArrival'] == null
          ? null
          : DateTime.parse(json['estimatedArrival'] as String),
      errorMessage: json['errorMessage'] as String?,
    );

Map<String, dynamic> _$WithdrawalResultDtoToJson(
        WithdrawalResultDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'status': instance.status,
      'amount': instance.amount,
      'currency': instance.currency,
      'transactionId': instance.transactionId,
      'newBalance': instance.newBalance,
      'estimatedArrival': instance.estimatedArrival?.toIso8601String(),
      'errorMessage': instance.errorMessage,
    };

WalletTransactionDetailDto _$WalletTransactionDetailDtoFromJson(
        Map<String, dynamic> json) =>
    WalletTransactionDetailDto(
      id: json['id'] as String,
      type: json['type'] as String,
      amount: (json['amount'] as num).toDouble(),
      currency: json['currency'] as String,
      status: json['status'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      description: json['description'] as String?,
      referenceId: json['referenceId'] as String?,
      referenceType: json['referenceType'] as String?,
      balanceAfter: (json['balanceAfter'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$WalletTransactionDetailDtoToJson(
        WalletTransactionDetailDto instance) =>
    <String, dynamic>{
      'id': instance.id,
      'type': instance.type,
      'amount': instance.amount,
      'currency': instance.currency,
      'status': instance.status,
      'createdAt': instance.createdAt.toIso8601String(),
      'description': instance.description,
      'referenceId': instance.referenceId,
      'referenceType': instance.referenceType,
      'balanceAfter': instance.balanceAfter,
    };

ValidatePromoCodeDto _$ValidatePromoCodeDtoFromJson(
        Map<String, dynamic> json) =>
    ValidatePromoCodeDto(
      code: json['code'] as String,
      orderType: json['orderType'] as String,
      amount: (json['amount'] as num?)?.toDouble(),
    );

Map<String, dynamic> _$ValidatePromoCodeDtoToJson(
        ValidatePromoCodeDto instance) =>
    <String, dynamic>{
      'code': instance.code,
      'orderType': instance.orderType,
      'amount': instance.amount,
    };

PromoCodeDto _$PromoCodeDtoFromJson(Map<String, dynamic> json) => PromoCodeDto(
      code: json['code'] as String,
      type: json['type'] as String,
      value: (json['value'] as num).toDouble(),
      description: json['description'] as String?,
      minOrderAmount: (json['minOrderAmount'] as num?)?.toDouble(),
      maxDiscount: (json['maxDiscount'] as num?)?.toDouble(),
      validUntil: json['validUntil'] == null
          ? null
          : DateTime.parse(json['validUntil'] as String),
      usesRemaining: (json['usesRemaining'] as num?)?.toInt(),
      applicableServices: (json['applicableServices'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
    );

Map<String, dynamic> _$PromoCodeDtoToJson(PromoCodeDto instance) =>
    <String, dynamic>{
      'code': instance.code,
      'type': instance.type,
      'value': instance.value,
      'description': instance.description,
      'minOrderAmount': instance.minOrderAmount,
      'maxDiscount': instance.maxDiscount,
      'validUntil': instance.validUntil?.toIso8601String(),
      'usesRemaining': instance.usesRemaining,
      'applicableServices': instance.applicableServices,
    };

ApplyPromoCodeDto _$ApplyPromoCodeDtoFromJson(Map<String, dynamic> json) =>
    ApplyPromoCodeDto(
      code: json['code'] as String,
      orderId: json['orderId'] as String,
      orderType: json['orderType'] as String,
    );

Map<String, dynamic> _$ApplyPromoCodeDtoToJson(ApplyPromoCodeDto instance) =>
    <String, dynamic>{
      'code': instance.code,
      'orderId': instance.orderId,
      'orderType': instance.orderType,
    };

AppliedPromoDto _$AppliedPromoDtoFromJson(Map<String, dynamic> json) =>
    AppliedPromoDto(
      code: json['code'] as String,
      discount: (json['discount'] as num).toDouble(),
      currency: json['currency'] as String,
      originalAmount: (json['originalAmount'] as num).toDouble(),
      newAmount: (json['newAmount'] as num).toDouble(),
    );

Map<String, dynamic> _$AppliedPromoDtoToJson(AppliedPromoDto instance) =>
    <String, dynamic>{
      'code': instance.code,
      'discount': instance.discount,
      'currency': instance.currency,
      'originalAmount': instance.originalAmount,
      'newAmount': instance.newAmount,
    };

// **************************************************************************
// RetrofitGenerator
// **************************************************************************

// ignore_for_file: unnecessary_brace_in_string_interps,no_leading_underscores_for_local_identifiers,unused_element

class _PaymentService implements PaymentService {
  _PaymentService(
    this._dio, {
    this.baseUrl,
    this.errorLogger,
  });

  final Dio _dio;

  String? baseUrl;

  final ParseErrorLogger? errorLogger;

  @override
  Future<PaymentResultDto> processPayment(ProcessPaymentDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<PaymentResultDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/process',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaymentResultDto _value;
    try {
      _value = PaymentResultDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PaymentStatusDto> getPaymentStatus(String id) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<PaymentStatusDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/${id}/status',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaymentStatusDto _value;
    try {
      _value = PaymentStatusDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<MpesaInitResponseDto> initiateMpesaPayment(
      MpesaPaymentRequestDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<MpesaInitResponseDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/mpesa/stk-push',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late MpesaInitResponseDto _value;
    try {
      _value = MpesaInitResponseDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<MpesaStatusDto> getMpesaStatus(String transactionId) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<MpesaStatusDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/mpesa/${transactionId}/status',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late MpesaStatusDto _value;
    try {
      _value = MpesaStatusDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<MtnInitResponseDto> initiateMtnPayment(
      MtnPaymentRequestDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<MtnInitResponseDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/mtn/request-to-pay',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late MtnInitResponseDto _value;
    try {
      _value = MtnInitResponseDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<MtnStatusDto> getMtnStatus(String referenceId) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<MtnStatusDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/mtn/${referenceId}/status',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late MtnStatusDto _value;
    try {
      _value = MtnStatusDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<StripePaymentIntentDto> createStripePaymentIntent(
      CreatePaymentIntentDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<StripePaymentIntentDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/stripe/create-payment-intent',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late StripePaymentIntentDto _value;
    try {
      _value = StripePaymentIntentDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PaymentResultDto> confirmStripePayment(
      ConfirmStripePaymentDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<PaymentResultDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/stripe/confirm',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaymentResultDto _value;
    try {
      _value = PaymentResultDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<StripeSetupIntentDto> createStripeSetupIntent() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<StripeSetupIntentDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/stripe/create-setup-intent',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late StripeSetupIntentDto _value;
    try {
      _value = StripeSetupIntentDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<WalletBalanceDto> getWalletBalance() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<WalletBalanceDto>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/wallet',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late WalletBalanceDto _value;
    try {
      _value = WalletBalanceDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<TopUpResultDto> topUpWallet(TopUpWalletDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<TopUpResultDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/wallet/top-up',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late TopUpResultDto _value;
    try {
      _value = TopUpResultDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<WithdrawalResultDto> withdrawFromWallet(WithdrawDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<WithdrawalResultDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/wallet/withdraw',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late WithdrawalResultDto _value;
    try {
      _value = WithdrawalResultDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PaginatedResponseDto<WalletTransactionDetailDto>>
      getWalletTransactions(
    int page,
    int limit,
    String? type,
  ) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{
      r'page': page,
      r'limit': limit,
      r'type': type,
    };
    queryParameters.removeWhere((k, v) => v == null);
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options =
        _setStreamType<PaginatedResponseDto<WalletTransactionDetailDto>>(
            Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
                .compose(
                  _dio.options,
                  '/payments/wallet/transactions',
                  queryParameters: queryParameters,
                  data: _data,
                )
                .copyWith(
                    baseUrl: _combineBaseUrls(
                  _dio.options.baseUrl,
                  baseUrl,
                )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PaginatedResponseDto<WalletTransactionDetailDto> _value;
    try {
      _value = PaginatedResponseDto<WalletTransactionDetailDto>.fromJson(
        _result.data!,
        (json) =>
            WalletTransactionDetailDto.fromJson(json as Map<String, dynamic>),
      );
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<PromoCodeDto> validatePromoCode(ValidatePromoCodeDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<PromoCodeDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/promo/validate',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late PromoCodeDto _value;
    try {
      _value = PromoCodeDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<AppliedPromoDto> applyPromoCode(ApplyPromoCodeDto request) async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    final _data = <String, dynamic>{};
    _data.addAll(request.toJson());
    final _options = _setStreamType<AppliedPromoDto>(Options(
      method: 'POST',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/promo/apply',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<Map<String, dynamic>>(_options);
    late AppliedPromoDto _value;
    try {
      _value = AppliedPromoDto.fromJson(_result.data!);
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  @override
  Future<List<PromoCodeDto>> getAvailablePromoCodes() async {
    final _extra = <String, dynamic>{};
    final queryParameters = <String, dynamic>{};
    final _headers = <String, dynamic>{};
    const Map<String, dynamic>? _data = null;
    final _options = _setStreamType<List<PromoCodeDto>>(Options(
      method: 'GET',
      headers: _headers,
      extra: _extra,
    )
        .compose(
          _dio.options,
          '/payments/promo/available',
          queryParameters: queryParameters,
          data: _data,
        )
        .copyWith(
            baseUrl: _combineBaseUrls(
          _dio.options.baseUrl,
          baseUrl,
        )));
    final _result = await _dio.fetch<List<dynamic>>(_options);
    late List<PromoCodeDto> _value;
    try {
      _value = _result.data!
          .map((dynamic i) => PromoCodeDto.fromJson(i as Map<String, dynamic>))
          .toList();
    } on Object catch (e, s) {
      errorLogger?.logError(e, s, _options);
      rethrow;
    }
    return _value;
  }

  RequestOptions _setStreamType<T>(RequestOptions requestOptions) {
    if (T != dynamic &&
        !(requestOptions.responseType == ResponseType.bytes ||
            requestOptions.responseType == ResponseType.stream)) {
      if (T == String) {
        requestOptions.responseType = ResponseType.plain;
      } else {
        requestOptions.responseType = ResponseType.json;
      }
    }
    return requestOptions;
  }

  String _combineBaseUrls(
    String dioBaseUrl,
    String? baseUrl,
  ) {
    if (baseUrl == null || baseUrl.trim().isEmpty) {
      return dioBaseUrl;
    }

    final url = Uri.parse(baseUrl);

    if (url.isAbsolute) {
      return url.toString();
    }

    return Uri.parse(dioBaseUrl).resolveUri(url).toString();
  }
}
