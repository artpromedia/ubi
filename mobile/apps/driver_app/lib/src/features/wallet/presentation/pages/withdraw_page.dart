import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../bloc/wallet_bloc.dart';

/// Withdraw from Wallet Page
class WithdrawPage extends StatefulWidget {
  const WithdrawPage({super.key});

  @override
  State<WithdrawPage> createState() => _WithdrawPageState();
}

class _WithdrawPageState extends State<WithdrawPage> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  PaymentMethodData? _selectedDestination;

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        elevation: 0,
        title: const Text('Withdraw'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: BlocConsumer<WalletBloc, WalletState>(
        listener: (context, state) {
          if (state is WalletOperationSuccess) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.message),
                backgroundColor: Colors.green,
              ),
            );
            context.pop();
          } else if (state is WalletOperationError) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.message),
                backgroundColor: Colors.red,
              ),
            );
          }
        },
        builder: (context, state) {
          if (state is! WalletLoaded) {
            return const Center(child: CircularProgressIndicator());
          }

          final isProcessing = state is WalletProcessing;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Available Balance Card
                  _buildBalanceCard(state),
                  const SizedBox(height: 24),

                  // Amount Input
                  const Text(
                    'Amount to Withdraw',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildAmountInput(state),
                  const SizedBox(height: 16),

                  // Withdraw All Button
                  _buildWithdrawAllButton(state),
                  const SizedBox(height: 24),

                  // Destination Selection
                  const Text(
                    'Withdraw To',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildDestinationSelector(state.paymentMethods),
                  const SizedBox(height: 24),

                  // Fee Info
                  _buildFeeInfo(state.wallet.currency),
                  const SizedBox(height: 32),

                  // Withdraw Button
                  SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: ElevatedButton(
                      onPressed: isProcessing ? null : _handleWithdraw,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF2196F3),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        disabledBackgroundColor: const Color(0xFF2196F3).withOpacity(0.5),
                      ),
                      child: isProcessing
                          ? const SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(
                                color: Colors.white,
                                strokeWidth: 2,
                              ),
                            )
                          : const Text(
                              'Withdraw Now',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildBalanceCard(WalletLoaded state) {
    final currencyFormat = NumberFormat.currency(
      symbol: state.wallet.currency,
      decimalDigits: 2,
    );

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Available Balance',
                style: TextStyle(color: Colors.white54, fontSize: 14),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: const Color(0xFF2196F3).withOpacity(0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  'Daily: ${currencyFormat.format(state.wallet.dailyRemaining)} left',
                  style: const TextStyle(
                    color: Color(0xFF2196F3),
                    fontSize: 11,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Text(
                currencyFormat.format(state.wallet.effectiveAvailableBalance),
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 32,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          if (state.wallet.pendingBalance > 0) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.schedule, size: 14, color: Colors.orange),
                const SizedBox(width: 4),
                Text(
                  'Pending: ${currencyFormat.format(state.wallet.pendingBalance)}',
                  style: const TextStyle(color: Colors.orange, fontSize: 12),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildAmountInput(WalletLoaded state) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Text(
            state.wallet.currency,
            style: const TextStyle(
              color: Colors.white54,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextFormField(
              controller: _amountController,
              keyboardType: TextInputType.number,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
              ],
              style: const TextStyle(
                color: Colors.white,
                fontSize: 28,
                fontWeight: FontWeight.bold,
              ),
              decoration: const InputDecoration(
                border: InputBorder.none,
                hintText: '0',
                hintStyle: TextStyle(color: Colors.white24),
              ),
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return 'Please enter an amount';
                }
                final amount = double.tryParse(value);
                if (amount == null || amount <= 0) {
                  return 'Please enter a valid amount';
                }
                if (amount < 100) {
                  return 'Minimum withdrawal is ${state.wallet.currency} 100';
                }
                if (amount > state.wallet.effectiveAvailableBalance) {
                  return 'Insufficient balance';
                }
                if (amount > state.wallet.dailyRemaining) {
                  return 'Exceeds daily limit';
                }
                return null;
              },
              onChanged: (value) => setState(() {}),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWithdrawAllButton(WalletLoaded state) {
    return Align(
      alignment: Alignment.centerRight,
      child: TextButton(
        onPressed: () {
          setState(() {
            final maxAmount = [
              state.wallet.effectiveAvailableBalance,
              state.wallet.dailyRemaining,
            ].reduce((a, b) => a < b ? a : b);
            _amountController.text = maxAmount.toInt().toString();
          });
        },
        child: const Text(
          'Withdraw All Available',
          style: TextStyle(color: Color(0xFF2196F3)),
        ),
      ),
    );
  }

  Widget _buildDestinationSelector(List<PaymentMethodData> methods) {
    // All methods can be withdrawal destinations
    if (_selectedDestination == null && methods.isNotEmpty) {
      _selectedDestination = methods.firstWhere(
        (m) => m.isDefault,
        orElse: () => methods.first,
      );
    }

    return Column(
      children: methods.map((method) {
        final isSelected = _selectedDestination?.id == method.id;
        return GestureDetector(
          onTap: () => setState(() => _selectedDestination = method),
          child: Container(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF252542),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isSelected
                    ? const Color(0xFF2196F3)
                    : Colors.transparent,
                width: 2,
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: const Color(0xFF1A1A2E),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    _getMethodIcon(method.type),
                    color: Colors.white70,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        method.displayName,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      Text(
                        _getMethodSubtitle(method),
                        style: const TextStyle(
                          color: Colors.white54,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    if (isSelected)
                      const Icon(
                        Icons.check_circle,
                        color: Color(0xFF2196F3),
                      ),
                    Text(
                      _getTransferTime(method.type),
                      style: const TextStyle(
                        color: Colors.white38,
                        fontSize: 10,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildFeeInfo(String currency) {
    final amount = double.tryParse(_amountController.text) ?? 0;
    final fee = _calculateFee(amount);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Amount', style: TextStyle(color: Colors.white54)),
              Text(
                '$currency ${amount.toStringAsFixed(2)}',
                style: const TextStyle(color: Colors.white),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Fee', style: TextStyle(color: Colors.white54)),
              Text(
                '$currency ${fee.toStringAsFixed(2)}',
                style: const TextStyle(color: Colors.orange),
              ),
            ],
          ),
          const Divider(color: Colors.white24, height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'You\'ll Receive',
                style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
              ),
              Text(
                '$currency ${(amount - fee).toStringAsFixed(2)}',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  IconData _getMethodIcon(PaymentMethodType type) {
    switch (type) {
      case PaymentMethodType.mpesa:
      case PaymentMethodType.mtn:
        return Icons.phone_android;
      case PaymentMethodType.card:
        return Icons.credit_card;
      case PaymentMethodType.bank:
        return Icons.account_balance;
      case PaymentMethodType.wallet:
        return Icons.account_balance_wallet;
    }
  }

  String _getMethodSubtitle(PaymentMethodData method) {
    if (method.phoneNumber != null) return method.phoneNumber!;
    if (method.accountNumber != null) return method.accountNumber!;
    if (method.last4 != null) return '•••• ${method.last4}';
    return method.type.displayName;
  }

  String _getTransferTime(PaymentMethodType type) {
    switch (type) {
      case PaymentMethodType.mpesa:
      case PaymentMethodType.mtn:
        return 'Instant';
      case PaymentMethodType.bank:
        return '1-2 days';
      case PaymentMethodType.card:
        return '3-5 days';
      default:
        return '';
    }
  }

  double _calculateFee(double amount) {
    if (amount <= 0) return 0;
    // Simple fee structure: 1% with min 10, max 100
    final fee = amount * 0.01;
    return fee.clamp(10, 100);
  }

  void _handleWithdraw() {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedDestination == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select a withdrawal destination'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    final amount = double.parse(_amountController.text);
    
    // Confirm withdrawal
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF252542),
        title: const Text(
          'Confirm Withdrawal',
          style: TextStyle(color: Colors.white),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Amount: KES ${amount.toStringAsFixed(2)}',
              style: const TextStyle(color: Colors.white70),
            ),
            Text(
              'Fee: KES ${_calculateFee(amount).toStringAsFixed(2)}',
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 8),
            Text(
              'To: ${_selectedDestination!.displayName}',
              style: const TextStyle(color: Colors.white70),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              context.read<WalletBloc>().add(WalletWithdraw(
                    amount: amount,
                    destination: _selectedDestination!,
                  ));
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF2196F3),
            ),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
  }
}
