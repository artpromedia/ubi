import 'package:api_client/api_client.dart';

/// Repository for wallet-related API calls
class WalletRepository {
  WalletRepository({required ApiClient apiClient}) : _apiClient = apiClient;

  final ApiClient _apiClient;

  /// Fetch wallet data
  Future<Map<String, dynamic>> getWallet() async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/payments/wallet',
    );
    return response.data ?? {};
  }

  /// Fetch wallet transactions
  Future<Map<String, dynamic>> getTransactions({
    int page = 1,
    int limit = 20,
    String? filter,
    DateTime? startDate,
    DateTime? endDate,
  }) async {
    final queryParams = <String, dynamic>{
      'page': page,
      'limit': limit,
    };
    if (filter != null && filter != 'all') {
      queryParams['filter'] = filter;
    }
    if (startDate != null) {
      queryParams['startDate'] = startDate.toIso8601String();
    }
    if (endDate != null) {
      queryParams['endDate'] = endDate.toIso8601String();
    }

    final response = await _apiClient.get<Map<String, dynamic>>(
      '/payments/wallet/transactions',
      queryParameters: queryParams,
    );
    return response.data ?? {};
  }

  /// Fetch payment methods
  Future<List<Map<String, dynamic>>> getPaymentMethods() async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/payments/methods',
    );
    final data = response.data;
    if (data != null && data['data'] is List) {
      return List<Map<String, dynamic>>.from(data['data'] as List);
    }
    return [];
  }

  /// Top up wallet
  Future<Map<String, dynamic>> topUp({
    required double amount,
    required String paymentMethodId,
    required String currency,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/payments/wallet/top-up',
      data: {
        'amount': amount,
        'paymentMethodId': paymentMethodId,
        'currency': currency,
      },
    );
    return response.data ?? {};
  }

  /// Withdraw from wallet
  Future<Map<String, dynamic>> withdraw({
    required double amount,
    required String destinationId,
    required String currency,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/payments/wallet/withdraw',
      data: {
        'amount': amount,
        'destinationId': destinationId,
        'currency': currency,
      },
    );
    return response.data ?? {};
  }

  /// Add payment method
  Future<Map<String, dynamic>> addPaymentMethod({
    required String type,
    String? phoneNumber,
    String? cardToken,
    String? bankCode,
    String? accountNumber,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/payments/methods',
      data: {
        'type': type,
        if (phoneNumber != null) 'phoneNumber': phoneNumber,
        if (cardToken != null) 'token': cardToken,
        if (bankCode != null) 'bankCode': bankCode,
        if (accountNumber != null) 'accountNumber': accountNumber,
      },
    );
    return response.data ?? {};
  }

  /// Remove payment method
  Future<void> removePaymentMethod(String methodId) async {
    await _apiClient.delete<void>('/payments/methods/$methodId');
  }

  /// Set default payment method
  Future<void> setDefaultPaymentMethod(String methodId) async {
    await _apiClient.put<void>(
      '/payments/methods/$methodId/default',
    );
  }

  /// Transfer to bank
  Future<Map<String, dynamic>> transferToBank({
    required double amount,
    required String bankAccountId,
    required String currency,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/payments/wallet/transfer-to-bank',
      data: {
        'amount': amount,
        'bankAccountId': bankAccountId,
        'currency': currency,
      },
    );
    return response.data ?? {};
  }

  /// Send money to another user
  Future<Map<String, dynamic>> sendMoney({
    required double amount,
    required String recipientIdentifier,
    required String recipientType, // 'phone', 'email', 'username'
    required String currency,
    String? note,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/payments/p2p/send',
      data: {
        'amount': amount,
        'recipient': recipientIdentifier,
        'recipientType': recipientType,
        'currency': currency,
        if (note != null) 'note': note,
      },
    );
    return response.data ?? {};
  }

  /// Request money from another user
  Future<Map<String, dynamic>> requestMoney({
    required double amount,
    required String fromIdentifier,
    required String fromType, // 'phone', 'email', 'username'
    required String currency,
    String? note,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/payments/p2p/request',
      data: {
        'amount': amount,
        'from': fromIdentifier,
        'fromType': fromType,
        'currency': currency,
        if (note != null) 'note': note,
      },
    );
    return response.data ?? {};
  }

  /// Initiate M-Pesa STK Push for top-up
  Future<Map<String, dynamic>> initiateMpesaTopUp({
    required double amount,
    required String phoneNumber,
  }) async {
    final response = await _apiClient.post<Map<String, dynamic>>(
      '/payments/mpesa/stk-push',
      data: {
        'amount': amount,
        'phoneNumber': phoneNumber,
        'type': 'wallet_topup',
      },
    );
    return response.data ?? {};
  }

  /// Check M-Pesa transaction status
  Future<Map<String, dynamic>> checkMpesaStatus(String checkoutRequestId) async {
    final response = await _apiClient.get<Map<String, dynamic>>(
      '/payments/mpesa/status/$checkoutRequestId',
    );
    return response.data ?? {};
  }
}
