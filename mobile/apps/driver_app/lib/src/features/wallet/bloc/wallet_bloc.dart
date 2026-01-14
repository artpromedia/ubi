import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../data/wallet_repository.dart';

part 'wallet_event.dart';
part 'wallet_state.dart';

/// BLoC for managing UBI Pay wallet functionality
class WalletBloc extends Bloc<WalletEvent, WalletState> {
  WalletBloc({required WalletRepository walletRepository})
      : _walletRepository = walletRepository,
        super(const WalletInitial()) {
    on<WalletLoad>(_onLoad);
    on<WalletRefresh>(_onRefresh);
    on<WalletTopUp>(_onTopUp);
    on<WalletWithdraw>(_onWithdraw);
    on<WalletLoadTransactions>(_onLoadTransactions);
    on<WalletLoadMoreTransactions>(_onLoadMoreTransactions);
    on<WalletAddPaymentMethod>(_onAddPaymentMethod);
    on<WalletRemovePaymentMethod>(_onRemovePaymentMethod);
    on<WalletSetDefaultPaymentMethod>(_onSetDefaultPaymentMethod);
    on<WalletTransferToBank>(_onTransferToBank);
    on<WalletSendMoney>(_onSendMoney);
    on<WalletRequestMoney>(_onRequestMoney);
    on<WalletReset>(_onReset);
  }

  final WalletRepository _walletRepository;

  // Cache for pagination
  List<WalletTransaction> _transactionsCache = [];
  int _currentPage = 1;
  static const _pageSize = 20;

  Future<void> _onLoad(
    WalletLoad event,
    Emitter<WalletState> emit,
  ) async {
    emit(const WalletLoading(message: 'Loading wallet...'));

    try {
      // Fetch wallet data, payment methods, and recent transactions in parallel
      final results = await Future.wait([
        _walletRepository.getWallet(),
        _walletRepository.getPaymentMethods(),
        _walletRepository.getTransactions(page: 1, limit: 5),
      ]);

      final walletData = results[0] as Map<String, dynamic>;
      final paymentMethodsData = results[1] as List<Map<String, dynamic>>;
      final transactionsData = results[2] as Map<String, dynamic>;

      // Parse wallet data
      final walletInfo = walletData['data'] as Map<String, dynamic>? ?? walletData;
      final wallet = WalletData(
        balance: (walletInfo['balance'] as num?)?.toDouble() ?? 0.0,
        pendingBalance: (walletInfo['pendingBalance'] as num?)?.toDouble() ?? 0.0,
        availableBalance: (walletInfo['availableBalance'] as num?)?.toDouble() ?? 0.0,
        currency: walletInfo['currency'] as String? ?? 'KES',
        accountNumber: walletInfo['accountNumber'] as String? ?? '',
        tier: _parseTier(walletInfo['tier'] as String?),
        dailyLimit: (walletInfo['dailyLimit'] as num?)?.toDouble() ?? 100000.0,
        monthlyLimit: (walletInfo['monthlyLimit'] as num?)?.toDouble() ?? 500000.0,
        dailyUsed: (walletInfo['dailyUsed'] as num?)?.toDouble() ?? 0.0,
        monthlyUsed: (walletInfo['monthlyUsed'] as num?)?.toDouble() ?? 0.0,
      );

      // Parse payment methods
      final paymentMethods = paymentMethodsData.map((pm) => _parsePaymentMethod(pm)).toList();

      // Parse transactions
      final transactionsList = (transactionsData['data'] as List?)?.cast<Map<String, dynamic>>() ?? [];
      final recentTransactions = transactionsList.map((tx) => _parseTransaction(tx)).toList();
      _transactionsCache = recentTransactions;

      emit(WalletLoaded(
        wallet: wallet,
        paymentMethods: paymentMethods,
        recentTransactions: recentTransactions,
      ));
    } catch (e) {
      emit(WalletError(message: 'Failed to load wallet: ${e.toString()}'));
    }
  }

  Future<void> _onRefresh(
    WalletRefresh event,
    Emitter<WalletState> emit,
  ) async {
    add(const WalletLoad());
  }

  Future<void> _onTopUp(
    WalletTopUp event,
    Emitter<WalletState> emit,
  ) async {
    final currentState = state;
    if (currentState is! WalletLoaded) return;

    emit(WalletProcessing(
      message: 'Processing top up...',
      wallet: currentState.wallet,
      paymentMethods: currentState.paymentMethods,
      recentTransactions: currentState.recentTransactions,
    ));

    try {
      // Call the actual API to process top-up
      final result = await _walletRepository.topUp(
        amount: event.amount,
        paymentMethodId: event.paymentMethod.id,
        currency: currentState.wallet.currency,
      );

      if (result['success'] != true) {
        throw Exception(result['error']?['message'] ?? 'Top up failed');
      }

      // Refresh wallet data to get updated balance
      final walletData = await _walletRepository.getWallet();
      final walletInfo = walletData['data'] as Map<String, dynamic>? ?? walletData;

      final updatedWallet = WalletData(
        balance: (walletInfo['balance'] as num?)?.toDouble() ?? currentState.wallet.balance,
        pendingBalance: (walletInfo['pendingBalance'] as num?)?.toDouble() ?? currentState.wallet.pendingBalance,
        availableBalance: (walletInfo['availableBalance'] as num?)?.toDouble() ?? currentState.wallet.availableBalance,
        currency: currentState.wallet.currency,
        accountNumber: currentState.wallet.accountNumber,
        tier: currentState.wallet.tier,
        dailyLimit: currentState.wallet.dailyLimit,
        monthlyLimit: currentState.wallet.monthlyLimit,
        dailyUsed: (walletInfo['dailyUsed'] as num?)?.toDouble() ?? currentState.wallet.dailyUsed,
        monthlyUsed: (walletInfo['monthlyUsed'] as num?)?.toDouble() ?? currentState.wallet.monthlyUsed,
      );

      // Create transaction record from response
      final txData = result['data']?['transaction'] as Map<String, dynamic>?;
      final newTransaction = txData != null
          ? _parseTransaction(txData)
          : WalletTransaction(
              id: 'txn-${DateTime.now().millisecondsSinceEpoch}',
              type: WalletTransactionType.topUp,
              amount: event.amount,
              currency: currentState.wallet.currency,
              status: 'completed',
              description: 'Wallet top up via ${event.paymentMethod.displayName}',
              createdAt: DateTime.now(),
              balanceAfter: updatedWallet.balance,
            );

      final updatedTransactions = [newTransaction, ...currentState.recentTransactions.take(4)];
      _transactionsCache = [newTransaction, ..._transactionsCache];

      emit(WalletOperationSuccess(
        message: 'Successfully topped up ${currentState.wallet.currency} ${event.amount.toStringAsFixed(2)}',
        wallet: updatedWallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: updatedTransactions,
      ));

      // Reset to normal loaded state after showing success
      await Future.delayed(const Duration(seconds: 2));
      emit(WalletLoaded(
        wallet: updatedWallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: updatedTransactions,
      ));
    } catch (e) {
      emit(WalletOperationError(
        message: 'Top up failed: ${e.toString()}',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    }
  }

  Future<void> _onWithdraw(
    WalletWithdraw event,
    Emitter<WalletState> emit,
  ) async {
    final currentState = state;
    if (currentState is! WalletLoaded) return;

    final currentAvailable = currentState.wallet.availableBalance ?? currentState.wallet.balance;
    if (event.amount > currentAvailable) {
      emit(WalletOperationError(
        message: 'Insufficient balance',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
      return;
    }

    emit(WalletProcessing(
      message: 'Processing withdrawal...',
      wallet: currentState.wallet,
      paymentMethods: currentState.paymentMethods,
      recentTransactions: currentState.recentTransactions,
    ));

    try {
      // Call the actual API to process withdrawal
      final result = await _walletRepository.withdraw(
        amount: event.amount,
        destinationId: event.destination.id,
        currency: currentState.wallet.currency,
      );

      if (result['success'] != true) {
        throw Exception(result['error']?['message'] ?? 'Withdrawal failed');
      }

      // Refresh wallet data
      final walletData = await _walletRepository.getWallet();
      final walletInfo = walletData['data'] as Map<String, dynamic>? ?? walletData;

      final updatedWallet = WalletData(
        balance: (walletInfo['balance'] as num?)?.toDouble() ?? currentState.wallet.balance - event.amount,
        pendingBalance: (walletInfo['pendingBalance'] as num?)?.toDouble() ?? currentState.wallet.pendingBalance,
        availableBalance: (walletInfo['availableBalance'] as num?)?.toDouble() ?? currentAvailable - event.amount,
        currency: currentState.wallet.currency,
        accountNumber: currentState.wallet.accountNumber,
        tier: currentState.wallet.tier,
        dailyLimit: currentState.wallet.dailyLimit,
        monthlyLimit: currentState.wallet.monthlyLimit,
        dailyUsed: currentState.wallet.dailyUsed,
        monthlyUsed: currentState.wallet.monthlyUsed,
      );

      final newTransaction = WalletTransaction(
        id: result['data']?['transactionId'] ?? 'txn-${DateTime.now().millisecondsSinceEpoch}',
        type: WalletTransactionType.withdrawal,
        amount: event.amount,
        currency: currentState.wallet.currency,
        status: 'completed',
        description: 'Withdrawal to ${event.destination.displayName}',
        createdAt: DateTime.now(),
        balanceAfter: updatedWallet.balance,
      );

      final updatedTransactions = [newTransaction, ...currentState.recentTransactions.take(4)];
      _transactionsCache = [newTransaction, ..._transactionsCache];

      emit(WalletOperationSuccess(
        message: 'Successfully withdrew ${currentState.wallet.currency} ${event.amount.toStringAsFixed(2)}',
        wallet: updatedWallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: updatedTransactions,
      ));

      await Future.delayed(const Duration(seconds: 2));
      emit(WalletLoaded(
        wallet: updatedWallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: updatedTransactions,
      ));
    } catch (e) {
      emit(WalletOperationError(
        message: 'Withdrawal failed: ${e.toString()}',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    }
  }

  Future<void> _onLoadTransactions(
    WalletLoadTransactions event,
    Emitter<WalletState> emit,
  ) async {
    emit(WalletTransactionsLoading(filter: event.filter));

    try {
      _currentPage = 1;

      final filterString = event.filter == TransactionFilter.incoming
          ? 'incoming'
          : event.filter == TransactionFilter.outgoing
              ? 'outgoing'
              : null;

      final result = await _walletRepository.getTransactions(
        page: _currentPage,
        limit: _pageSize,
        filter: filterString,
      );

      final transactionsList = (result['data'] as List?)?.cast<Map<String, dynamic>>() ?? [];
      _transactionsCache = transactionsList.map((tx) => _parseTransaction(tx)).toList();

      final hasMore = (result['pagination']?['hasMore'] as bool?) ??
          (transactionsList.length >= _pageSize);

      emit(WalletTransactionsLoaded(
        transactions: _transactionsCache,
        hasMore: hasMore,
        filter: event.filter,
      ));
    } catch (e) {
      emit(WalletTransactionsError(message: 'Failed to load transactions: ${e.toString()}'));
    }
  }

  Future<void> _onLoadMoreTransactions(
    WalletLoadMoreTransactions event,
    Emitter<WalletState> emit,
  ) async {
    final currentState = state;
    if (currentState is! WalletTransactionsLoaded || currentState.isLoadingMore) return;

    emit(currentState.copyWith(isLoadingMore: true));

    try {
      _currentPage++;

      final filterString = currentState.filter == TransactionFilter.incoming
          ? 'incoming'
          : currentState.filter == TransactionFilter.outgoing
              ? 'outgoing'
              : null;

      final result = await _walletRepository.getTransactions(
        page: _currentPage,
        limit: _pageSize,
        filter: filterString,
      );

      final transactionsList = (result['data'] as List?)?.cast<Map<String, dynamic>>() ?? [];
      final newTransactions = transactionsList.map((tx) => _parseTransaction(tx)).toList();

      if (newTransactions.isEmpty) {
        emit(currentState.copyWith(hasMore: false, isLoadingMore: false));
        return;
      }

      _transactionsCache.addAll(newTransactions);

      emit(WalletTransactionsLoaded(
        transactions: _transactionsCache,
        hasMore: newTransactions.length >= _pageSize,
        filter: currentState.filter,
      ));
    } catch (e) {
      emit(currentState.copyWith(isLoadingMore: false));
    }
  }

  Future<void> _onAddPaymentMethod(
    WalletAddPaymentMethod event,
    Emitter<WalletState> emit,
  ) async {
    final currentState = state;
    if (currentState is! WalletLoaded) return;

    emit(WalletProcessing(
      message: 'Adding payment method...',
      wallet: currentState.wallet,
      paymentMethods: currentState.paymentMethods,
      recentTransactions: currentState.recentTransactions,
    ));

    try {
      await _walletRepository.addPaymentMethod(
        type: event.method.type.name,
        phoneNumber: event.method.phoneNumber,
        bankCode: event.method.bankName,
        accountNumber: event.method.accountNumber,
      );

      // Refresh payment methods
      final paymentMethodsData = await _walletRepository.getPaymentMethods();
      final updatedMethods = paymentMethodsData.map((pm) => _parsePaymentMethod(pm)).toList();

      emit(WalletOperationSuccess(
        message: 'Payment method added successfully',
        wallet: currentState.wallet,
        paymentMethods: updatedMethods,
        recentTransactions: currentState.recentTransactions,
      ));

      await Future.delayed(const Duration(seconds: 1));
      emit(WalletLoaded(
        wallet: currentState.wallet,
        paymentMethods: updatedMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    } catch (e) {
      emit(WalletOperationError(
        message: 'Failed to add payment method: ${e.toString()}',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    }
  }

  Future<void> _onRemovePaymentMethod(
    WalletRemovePaymentMethod event,
    Emitter<WalletState> emit,
  ) async {
    final currentState = state;
    if (currentState is! WalletLoaded) return;

    try {
      await _walletRepository.removePaymentMethod(event.methodId);

      final updatedMethods = currentState.paymentMethods
          .where((m) => m.id != event.methodId)
          .toList();

      emit(WalletLoaded(
        wallet: currentState.wallet,
        paymentMethods: updatedMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    } catch (e) {
      emit(WalletOperationError(
        message: 'Failed to remove payment method: ${e.toString()}',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    }
  }

  Future<void> _onSetDefaultPaymentMethod(
    WalletSetDefaultPaymentMethod event,
    Emitter<WalletState> emit,
  ) async {
    final currentState = state;
    if (currentState is! WalletLoaded) return;

    try {
      await _walletRepository.setDefaultPaymentMethod(event.methodId);

      final updatedMethods = currentState.paymentMethods.map((m) {
        return PaymentMethodData(
          id: m.id,
          type: m.type,
          displayName: m.displayName,
          last4: m.last4,
          brand: m.brand,
          expiryMonth: m.expiryMonth,
          expiryYear: m.expiryYear,
          phoneNumber: m.phoneNumber,
          bankName: m.bankName,
          accountNumber: m.accountNumber,
          isDefault: m.id == event.methodId,
        );
      }).toList();

      emit(WalletLoaded(
        wallet: currentState.wallet,
        paymentMethods: updatedMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    } catch (e) {
      emit(WalletOperationError(
        message: 'Failed to set default payment method: ${e.toString()}',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    }
  }

  Future<void> _onTransferToBank(
    WalletTransferToBank event,
    Emitter<WalletState> emit,
  ) async {
    final currentState = state;
    if (currentState is! WalletLoaded) return;

    emit(WalletProcessing(
      message: 'Processing bank transfer...',
      wallet: currentState.wallet,
      paymentMethods: currentState.paymentMethods,
      recentTransactions: currentState.recentTransactions,
    ));

    try {
      final result = await _walletRepository.transferToBank(
        amount: event.amount,
        bankAccountId: event.bankAccount.id,
        currency: currentState.wallet.currency,
      );

      if (result['success'] != true) {
        throw Exception(result['error']?['message'] ?? 'Bank transfer failed');
      }

      emit(WalletOperationSuccess(
        message: 'Transfer initiated. Funds will arrive in 1-2 business days.',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));

      await Future.delayed(const Duration(seconds: 2));
      add(const WalletRefresh());
    } catch (e) {
      emit(WalletOperationError(
        message: 'Bank transfer failed: ${e.toString()}',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    }
  }

  Future<void> _onSendMoney(
    WalletSendMoney event,
    Emitter<WalletState> emit,
  ) async {
    final currentState = state;
    if (currentState is! WalletLoaded) return;

    final currentAvailable = currentState.wallet.availableBalance ?? currentState.wallet.balance;
    if (event.amount > currentAvailable) {
      emit(WalletOperationError(
        message: 'Insufficient balance',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
      return;
    }

    emit(WalletProcessing(
      message: 'Sending money...',
      wallet: currentState.wallet,
      paymentMethods: currentState.paymentMethods,
      recentTransactions: currentState.recentTransactions,
    ));

    try {
      final result = await _walletRepository.sendMoney(
        amount: event.amount,
        recipientIdentifier: event.recipient,
        recipientType: event.recipientType ?? 'phone',
        currency: currentState.wallet.currency,
        note: event.note,
      );

      if (result['success'] != true) {
        throw Exception(result['error']?['message'] ?? 'Failed to send money');
      }

      emit(WalletOperationSuccess(
        message: 'Successfully sent ${currentState.wallet.currency} ${event.amount.toStringAsFixed(2)} to ${event.recipient}',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));

      await Future.delayed(const Duration(seconds: 2));
      add(const WalletRefresh());
    } catch (e) {
      emit(WalletOperationError(
        message: 'Failed to send money: ${e.toString()}',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    }
  }

  Future<void> _onRequestMoney(
    WalletRequestMoney event,
    Emitter<WalletState> emit,
  ) async {
    final currentState = state;
    if (currentState is! WalletLoaded) return;

    emit(WalletProcessing(
      message: 'Sending request...',
      wallet: currentState.wallet,
      paymentMethods: currentState.paymentMethods,
      recentTransactions: currentState.recentTransactions,
    ));

    try {
      final result = await _walletRepository.requestMoney(
        amount: event.amount,
        fromIdentifier: event.fromUser,
        fromType: event.fromType ?? 'phone',
        currency: currentState.wallet.currency,
        note: event.note,
      );

      if (result['success'] != true) {
        throw Exception(result['error']?['message'] ?? 'Failed to send request');
      }

      emit(WalletOperationSuccess(
        message: 'Request sent to ${event.fromUser}',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));

      await Future.delayed(const Duration(seconds: 2));
      emit(WalletLoaded(
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    } catch (e) {
      emit(WalletOperationError(
        message: 'Failed to send request: ${e.toString()}',
        wallet: currentState.wallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: currentState.recentTransactions,
      ));
    }
  }

  void _onReset(
    WalletReset event,
    Emitter<WalletState> emit,
  ) {
    _transactionsCache = [];
    _currentPage = 1;
    emit(const WalletInitial());
  }

  // Helper methods for parsing API responses

  WalletTier _parseTier(String? tier) {
    switch (tier?.toLowerCase()) {
      case 'bronze':
        return WalletTier.bronze;
      case 'silver':
        return WalletTier.silver;
      case 'gold':
        return WalletTier.gold;
      case 'platinum':
        return WalletTier.platinum;
      default:
        return WalletTier.bronze;
    }
  }

  PaymentMethodData _parsePaymentMethod(Map<String, dynamic> data) {
    final typeStr = data['type'] as String? ?? '';
    final type = _parsePaymentMethodType(typeStr);

    return PaymentMethodData(
      id: data['id'] as String? ?? '',
      type: type,
      displayName: data['displayName'] as String? ?? data['name'] as String? ?? '',
      last4: data['last4'] as String? ?? data['lastFour'] as String?,
      brand: data['brand'] as String?,
      expiryMonth: data['expiryMonth'] as int?,
      expiryYear: data['expiryYear'] as int?,
      phoneNumber: data['phoneNumber'] as String?,
      bankName: data['bankName'] as String?,
      accountNumber: data['accountNumber'] as String?,
      isDefault: data['isDefault'] as bool? ?? false,
    );
  }

  PaymentMethodType _parsePaymentMethodType(String type) {
    switch (type.toLowerCase()) {
      case 'mpesa':
      case 'mobile_money':
        return PaymentMethodType.mpesa;
      case 'card':
        return PaymentMethodType.card;
      case 'bank':
      case 'bank_account':
        return PaymentMethodType.bank;
      default:
        return PaymentMethodType.mpesa;
    }
  }

  WalletTransaction _parseTransaction(Map<String, dynamic> data) {
    final typeStr = data['type'] as String? ?? '';
    final type = _parseTransactionType(typeStr);

    return WalletTransaction(
      id: data['id'] as String? ?? '',
      type: type,
      amount: (data['amount'] as num?)?.toDouble() ?? 0.0,
      currency: data['currency'] as String? ?? 'KES',
      status: data['status'] as String? ?? 'completed',
      description: data['description'] as String? ?? '',
      createdAt: data['createdAt'] != null
          ? DateTime.parse(data['createdAt'] as String)
          : DateTime.now(),
      balanceAfter: (data['balanceAfter'] as num?)?.toDouble(),
    );
  }

  WalletTransactionType _parseTransactionType(String type) {
    switch (type.toLowerCase()) {
      case 'topup':
      case 'top_up':
      case 'wallet_topup':
        return WalletTransactionType.topUp;
      case 'withdrawal':
      case 'withdraw':
        return WalletTransactionType.withdrawal;
      case 'earning':
      case 'earnings':
      case 'driver_earning':
        return WalletTransactionType.earning;
      case 'bonus':
      case 'incentive_bonus':
        return WalletTransactionType.bonus;
      case 'credit':
      case 'receive':
      case 'transfer_received':
        return WalletTransactionType.credit;
      case 'debit':
      case 'send':
      case 'transfer_sent':
        return WalletTransactionType.debit;
      case 'refund':
        return WalletTransactionType.refund;
      default:
        return WalletTransactionType.credit;
    }
  }
}
