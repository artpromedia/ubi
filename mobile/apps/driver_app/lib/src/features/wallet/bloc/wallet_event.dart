part of 'wallet_bloc.dart';

/// Base class for wallet events
sealed class WalletEvent extends Equatable {
  const WalletEvent();

  @override
  List<Object?> get props => [];
}

/// Load wallet data
class WalletLoad extends WalletEvent {
  const WalletLoad();
}

/// Refresh wallet data
class WalletRefresh extends WalletEvent {
  const WalletRefresh();
}

/// Top up wallet
class WalletTopUp extends WalletEvent {
  const WalletTopUp({
    required this.amount,
    required this.paymentMethod,
  });

  final double amount;
  final PaymentMethodData paymentMethod;

  @override
  List<Object?> get props => [amount, paymentMethod];
}

/// Withdraw from wallet
class WalletWithdraw extends WalletEvent {
  const WalletWithdraw({
    required this.amount,
    required this.destination,
  });

  final double amount;
  final PaymentMethodData destination;

  @override
  List<Object?> get props => [amount, destination];
}

/// Load transaction history
class WalletLoadTransactions extends WalletEvent {
  const WalletLoadTransactions({this.filter = TransactionFilter.all});

  final TransactionFilter filter;

  @override
  List<Object?> get props => [filter];
}

/// Load more transactions (pagination)
class WalletLoadMoreTransactions extends WalletEvent {
  const WalletLoadMoreTransactions();
}

/// Add a payment method
class WalletAddPaymentMethod extends WalletEvent {
  const WalletAddPaymentMethod({required this.method});

  final PaymentMethodData method;

  @override
  List<Object?> get props => [method];
}

/// Remove a payment method
class WalletRemovePaymentMethod extends WalletEvent {
  const WalletRemovePaymentMethod({required this.methodId});

  final String methodId;

  @override
  List<Object?> get props => [methodId];
}

/// Set default payment method
class WalletSetDefaultPaymentMethod extends WalletEvent {
  const WalletSetDefaultPaymentMethod({required this.methodId});

  final String methodId;

  @override
  List<Object?> get props => [methodId];
}

/// Transfer to bank account
class WalletTransferToBank extends WalletEvent {
  const WalletTransferToBank({
    required this.amount,
    required this.bankAccount,
  });

  final double amount;
  final PaymentMethodData bankAccount;

  @override
  List<Object?> get props => [amount, bankAccount];
}

/// Send money to another user
class WalletSendMoney extends WalletEvent {
  const WalletSendMoney({
    required this.amount,
    required this.recipient,
    this.note,
  });

  final double amount;
  final String recipient;
  final String? note;

  @override
  List<Object?> get props => [amount, recipient, note];
}

/// Request money from another user
class WalletRequestMoney extends WalletEvent {
  const WalletRequestMoney({
    required this.amount,
    required this.fromUser,
    this.note,
  });

  final double amount;
  final String fromUser;
  final String? note;

  @override
  List<Object?> get props => [amount, fromUser, note];
}

/// Reset wallet state
class WalletReset extends WalletEvent {
  const WalletReset();
}

/// Transaction filter
enum TransactionFilter {
  all('All'),
  incoming('Incoming'),
  outgoing('Outgoing'),
  topUp('Top Up'),
  withdrawal('Withdrawals'),
  earnings('Earnings');

  const TransactionFilter(this.displayName);
  final String displayName;
}
