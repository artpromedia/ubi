import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

part 'wallet_event.dart';
part 'wallet_state.dart';

/// BLoC for managing UBI Pay wallet functionality
class WalletBloc extends Bloc<WalletEvent, WalletState> {
  WalletBloc() : super(const WalletInitial()) {
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
      await Future.delayed(const Duration(milliseconds: 500));

      // TODO: Replace with API call
      const wallet = WalletData(
        balance: 12450.50,
        pendingBalance: 1200.0,
        availableBalance: 11250.50,
        currency: 'KES',
        accountNumber: 'UBI-7845632190',
        tier: WalletTier.gold,
        dailyLimit: 100000.0,
        monthlyLimit: 500000.0,
        dailyUsed: 15000.0,
        monthlyUsed: 85000.0,
      );

      final paymentMethods = [
        const PaymentMethodData(
          id: 'pm-1',
          type: PaymentMethodType.mpesa,
          displayName: 'M-Pesa',
          phoneNumber: '+254712345678',
          isDefault: true,
        ),
        const PaymentMethodData(
          id: 'pm-2',
          type: PaymentMethodType.card,
          displayName: 'Visa •••• 4242',
          last4: '4242',
          brand: 'visa',
          expiryMonth: 12,
          expiryYear: 2025,
        ),
        const PaymentMethodData(
          id: 'pm-3',
          type: PaymentMethodType.bank,
          displayName: 'KCB Bank',
          bankName: 'KCB Bank',
          accountNumber: '****5678',
        ),
      ];

      // Recent transactions
      final recentTransactions = _generateMockTransactions(5);
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
      await Future.delayed(const Duration(seconds: 2));

      // TODO: Replace with API call
      final newBalance = currentState.wallet.balance + event.amount;
      final currentAvailable = currentState.wallet.availableBalance ?? currentState.wallet.balance;
      final updatedWallet = WalletData(
        balance: newBalance,
        pendingBalance: currentState.wallet.pendingBalance,
        availableBalance: currentAvailable + event.amount,
        currency: currentState.wallet.currency,
        accountNumber: currentState.wallet.accountNumber,
        tier: currentState.wallet.tier,
        dailyLimit: currentState.wallet.dailyLimit,
        monthlyLimit: currentState.wallet.monthlyLimit,
        dailyUsed: currentState.wallet.dailyUsed + event.amount,
        monthlyUsed: currentState.wallet.monthlyUsed + event.amount,
      );

      // Add transaction to list
      final newTransaction = WalletTransaction(
        id: 'txn-${DateTime.now().millisecondsSinceEpoch}',
        type: WalletTransactionType.topUp,
        amount: event.amount,
        currency: currentState.wallet.currency,
        status: 'completed',
        description: 'Wallet top up via ${event.paymentMethod.displayName}',
        createdAt: DateTime.now(),
        balanceAfter: newBalance,
      );

      final updatedTransactions = [newTransaction, ...currentState.recentTransactions];
      _transactionsCache = [newTransaction, ..._transactionsCache];

      emit(WalletOperationSuccess(
        message: 'Successfully topped up KES ${event.amount.toStringAsFixed(2)}',
        wallet: updatedWallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: updatedTransactions.take(5).toList(),
      ));

      // Reset to normal loaded state after showing success
      await Future.delayed(const Duration(seconds: 2));
      emit(WalletLoaded(
        wallet: updatedWallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: updatedTransactions.take(5).toList(),
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
      await Future.delayed(const Duration(seconds: 2));

      // TODO: Replace with API call
      final newBalance = currentState.wallet.balance - event.amount;
      final updatedWallet = WalletData(
        balance: newBalance,
        pendingBalance: currentState.wallet.pendingBalance,
        availableBalance: currentAvailable - event.amount,
        currency: currentState.wallet.currency,
        accountNumber: currentState.wallet.accountNumber,
        tier: currentState.wallet.tier,
        dailyLimit: currentState.wallet.dailyLimit,
        monthlyLimit: currentState.wallet.monthlyLimit,
        dailyUsed: currentState.wallet.dailyUsed,
        monthlyUsed: currentState.wallet.monthlyUsed,
      );

      final newTransaction = WalletTransaction(
        id: 'txn-${DateTime.now().millisecondsSinceEpoch}',
        type: WalletTransactionType.withdrawal,
        amount: event.amount,
        currency: currentState.wallet.currency,
        status: 'completed',
        description: 'Withdrawal to ${event.destination.displayName}',
        createdAt: DateTime.now(),
        balanceAfter: newBalance,
      );

      final updatedTransactions = [newTransaction, ...currentState.recentTransactions];
      _transactionsCache = [newTransaction, ..._transactionsCache];

      emit(WalletOperationSuccess(
        message: 'Successfully withdrew KES ${event.amount.toStringAsFixed(2)}',
        wallet: updatedWallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: updatedTransactions.take(5).toList(),
      ));

      await Future.delayed(const Duration(seconds: 2));
      emit(WalletLoaded(
        wallet: updatedWallet,
        paymentMethods: currentState.paymentMethods,
        recentTransactions: updatedTransactions.take(5).toList(),
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
      await Future.delayed(const Duration(milliseconds: 500));

      _currentPage = 1;
      _transactionsCache = _generateMockTransactions(20, filter: event.filter);

      emit(WalletTransactionsLoaded(
        transactions: _transactionsCache,
        hasMore: true,
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
      await Future.delayed(const Duration(milliseconds: 500));

      _currentPage++;
      final newTransactions = _generateMockTransactions(
        _pageSize,
        offset: _transactionsCache.length,
        filter: currentState.filter,
      );

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
      await Future.delayed(const Duration(seconds: 1));

      final updatedMethods = [...currentState.paymentMethods, event.method];

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

    final updatedMethods = currentState.paymentMethods
        .where((m) => m.id != event.methodId)
        .toList();

    emit(WalletLoaded(
      wallet: currentState.wallet,
      paymentMethods: updatedMethods,
      recentTransactions: currentState.recentTransactions,
    ));
  }

  Future<void> _onSetDefaultPaymentMethod(
    WalletSetDefaultPaymentMethod event,
    Emitter<WalletState> emit,
  ) async {
    final currentState = state;
    if (currentState is! WalletLoaded) return;

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
      await Future.delayed(const Duration(seconds: 3));

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
      await Future.delayed(const Duration(seconds: 2));

      emit(WalletOperationSuccess(
        message: 'Successfully sent KES ${event.amount.toStringAsFixed(2)} to ${event.recipient}',
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
      await Future.delayed(const Duration(seconds: 1));

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

  // Helper method to generate mock transactions
  List<WalletTransaction> _generateMockTransactions(
    int count, {
    int offset = 0,
    TransactionFilter? filter,
  }) {
    final types = WalletTransactionType.values;
    final transactions = <WalletTransaction>[];

    for (var i = 0; i < count; i++) {
      final type = types[(i + offset) % types.length];
      
      // Apply filter
      if (filter != null && filter != TransactionFilter.all) {
        if (filter == TransactionFilter.incoming && !type.isPositive) continue;
        if (filter == TransactionFilter.outgoing && type.isPositive) continue;
      }

      final isPositive = type.isPositive;
      final amount = 100.0 + (i * 50) + (offset * 10);

      transactions.add(WalletTransaction(
        id: 'txn-${offset + i}',
        type: type,
        amount: amount,
        currency: 'KES',
        status: i % 10 == 0 ? 'pending' : 'completed',
        description: _getTransactionDescription(type),
        createdAt: DateTime.now().subtract(Duration(hours: i + offset)),
        balanceAfter: isPositive ? 12450.50 + amount : 12450.50 - amount,
      ));
    }

    return transactions;
  }

  String _getTransactionDescription(WalletTransactionType type) {
    switch (type) {
      case WalletTransactionType.topUp:
        return 'Wallet top up via M-Pesa';
      case WalletTransactionType.withdrawal:
        return 'Withdrawal to M-Pesa';
      case WalletTransactionType.earning:
        return 'Trip earnings';
      case WalletTransactionType.bonus:
        return 'Weekly bonus reward';
      case WalletTransactionType.credit:
        return 'Payment received';
      case WalletTransactionType.debit:
        return 'Payment sent';
      case WalletTransactionType.refund:
        return 'Refund processed';
    }
  }
}
