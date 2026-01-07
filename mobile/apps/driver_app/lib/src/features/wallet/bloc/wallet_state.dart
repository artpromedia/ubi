part of 'wallet_bloc.dart';

/// Base class for wallet states
sealed class WalletState extends Equatable {
  const WalletState();

  @override
  List<Object?> get props => [];
}

/// Initial state
class WalletInitial extends WalletState {
  const WalletInitial();
}

/// Loading wallet data
class WalletLoading extends WalletState {
  const WalletLoading({this.message});

  final String? message;

  @override
  List<Object?> get props => [message];
}

/// Wallet data loaded
class WalletLoaded extends WalletState {
  const WalletLoaded({
    required this.wallet,
    required this.paymentMethods,
    required this.recentTransactions,
  });

  final WalletData wallet;
  final List<PaymentMethodData> paymentMethods;
  final List<WalletTransaction> recentTransactions;

  @override
  List<Object?> get props => [wallet, paymentMethods, recentTransactions];
}

/// Processing a wallet operation
class WalletProcessing extends WalletLoaded {
  const WalletProcessing({
    required this.message,
    required super.wallet,
    required super.paymentMethods,
    required super.recentTransactions,
  });

  final String message;

  @override
  List<Object?> get props => [message, ...super.props];
}

/// Wallet operation success
class WalletOperationSuccess extends WalletLoaded {
  const WalletOperationSuccess({
    required this.message,
    required super.wallet,
    required super.paymentMethods,
    required super.recentTransactions,
  });

  final String message;

  @override
  List<Object?> get props => [message, ...super.props];
}

/// Wallet operation error
class WalletOperationError extends WalletLoaded {
  const WalletOperationError({
    required this.message,
    required super.wallet,
    required super.paymentMethods,
    required super.recentTransactions,
  });

  final String message;

  @override
  List<Object?> get props => [message, ...super.props];
}

/// Error state
class WalletError extends WalletState {
  const WalletError({required this.message});

  final String message;

  @override
  List<Object?> get props => [message];
}

/// Transactions loading state
class WalletTransactionsLoading extends WalletState {
  const WalletTransactionsLoading({this.filter = TransactionFilter.all});

  final TransactionFilter filter;

  @override
  List<Object?> get props => [filter];
}

/// Transactions loaded state
class WalletTransactionsLoaded extends WalletState {
  const WalletTransactionsLoaded({
    required this.transactions,
    required this.hasMore,
    this.filter = TransactionFilter.all,
    this.isLoadingMore = false,
  });

  final List<WalletTransaction> transactions;
  final bool hasMore;
  final TransactionFilter filter;
  final bool isLoadingMore;

  WalletTransactionsLoaded copyWith({
    List<WalletTransaction>? transactions,
    bool? hasMore,
    TransactionFilter? filter,
    bool? isLoadingMore,
  }) {
    return WalletTransactionsLoaded(
      transactions: transactions ?? this.transactions,
      hasMore: hasMore ?? this.hasMore,
      filter: filter ?? this.filter,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
    );
  }

  @override
  List<Object?> get props => [transactions, hasMore, filter, isLoadingMore];
}

/// Transactions error state
class WalletTransactionsError extends WalletState {
  const WalletTransactionsError({required this.message});

  final String message;

  @override
  List<Object?> get props => [message];
}

// ============= Data Models =============

/// Wallet tier levels
enum WalletTier {
  basic('Basic', 10000, 50000),
  silver('Silver', 50000, 200000),
  gold('Gold', 100000, 500000),
  platinum('Platinum', 500000, 2000000);

  const WalletTier(this.displayName, this.dailyLimit, this.monthlyLimit);

  final String displayName;
  final double dailyLimit;
  final double monthlyLimit;
}

/// Payment method types
enum PaymentMethodType {
  mpesa('M-Pesa'),
  mtn('MTN MoMo'),
  card('Card'),
  bank('Bank Account'),
  wallet('UBI Wallet');

  const PaymentMethodType(this.displayName);
  final String displayName;

  bool get isMobileMoney => this == mpesa || this == mtn;
}

/// Wallet data model
class WalletData extends Equatable {
  const WalletData({
    required this.balance,
    required this.currency,
    this.pendingBalance = 0,
    this.availableBalance,
    this.accountNumber,
    this.tier = WalletTier.basic,
    this.dailyLimit = 10000,
    this.monthlyLimit = 50000,
    this.dailyUsed = 0,
    this.monthlyUsed = 0,
  });

  final double balance;
  final String currency;
  final double pendingBalance;
  final double? availableBalance;
  final String? accountNumber;
  final WalletTier tier;
  final double dailyLimit;
  final double monthlyLimit;
  final double dailyUsed;
  final double monthlyUsed;

  double get effectiveAvailableBalance => availableBalance ?? balance;
  double get dailyRemaining => dailyLimit - dailyUsed;
  double get monthlyRemaining => monthlyLimit - monthlyUsed;
  double get dailyUsagePercent => (dailyUsed / dailyLimit * 100).clamp(0, 100);
  double get monthlyUsagePercent => (monthlyUsed / monthlyLimit * 100).clamp(0, 100);

  @override
  List<Object?> get props => [balance, currency, pendingBalance, availableBalance, accountNumber, tier];
}

/// Payment method data model
class PaymentMethodData extends Equatable {
  const PaymentMethodData({
    required this.id,
    required this.type,
    required this.displayName,
    this.last4,
    this.brand,
    this.expiryMonth,
    this.expiryYear,
    this.phoneNumber,
    this.bankName,
    this.accountNumber,
    this.isDefault = false,
  });

  final String id;
  final PaymentMethodType type;
  final String displayName;
  final String? last4;
  final String? brand;
  final int? expiryMonth;
  final int? expiryYear;
  final String? phoneNumber;
  final String? bankName;
  final String? accountNumber;
  final bool isDefault;

  String? get expiryDisplay {
    if (expiryMonth == null || expiryYear == null) return null;
    return '${expiryMonth.toString().padLeft(2, '0')}/${(expiryYear! % 100).toString().padLeft(2, '0')}';
  }

  @override
  List<Object?> get props => [id, type, displayName, isDefault];
}

/// Wallet transaction type
enum WalletTransactionType {
  credit('Credit'),
  debit('Debit'),
  refund('Refund'),
  topUp('Top Up'),
  withdrawal('Withdrawal'),
  earning('Earning'),
  bonus('Bonus');

  const WalletTransactionType(this.displayName);

  final String displayName;

  bool get isPositive => this == credit || this == refund || this == topUp || this == earning || this == bonus;
}

/// Wallet transaction data model
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
  final double? balanceAfter;

  String get displayAmount {
    final sign = type.isPositive ? '+' : '-';
    return '$sign $currency ${amount.toStringAsFixed(2)}';
  }

  bool get isPending => status == 'pending';
  bool get isCompleted => status == 'completed';

  @override
  List<Object?> get props => [id, type, amount, currency, status, createdAt];
}
