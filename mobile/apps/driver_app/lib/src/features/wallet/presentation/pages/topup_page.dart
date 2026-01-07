import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../bloc/wallet_bloc.dart';

/// Top Up Wallet Page
class TopUpPage extends StatefulWidget {
  const TopUpPage({super.key});

  @override
  State<TopUpPage> createState() => _TopUpPageState();
}

class _TopUpPageState extends State<TopUpPage> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  PaymentMethodData? _selectedMethod;
  final List<double> _quickAmounts = [500, 1000, 2000, 5000, 10000];

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
        title: const Text('Top Up Wallet'),
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
                  // Current Balance Card
                  _buildBalanceCard(state),
                  const SizedBox(height: 24),

                  // Amount Input
                  const Text(
                    'Enter Amount',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildAmountInput(state.wallet.currency),
                  const SizedBox(height: 16),

                  // Quick Amount Buttons
                  _buildQuickAmounts(state.wallet.currency),
                  const SizedBox(height: 24),

                  // Payment Method Selection
                  const Text(
                    'Pay From',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildPaymentMethodSelector(state.paymentMethods),
                  const SizedBox(height: 32),

                  // Top Up Button
                  SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: ElevatedButton(
                      onPressed: isProcessing ? null : _handleTopUp,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF4CAF50),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        disabledBackgroundColor: const Color(0xFF4CAF50).withOpacity(0.5),
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
                              'Top Up Now',
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
        gradient: const LinearGradient(
          colors: [Color(0xFF667EEA), Color(0xFF764BA2)],
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Current Balance',
                  style: TextStyle(color: Colors.white70, fontSize: 14),
                ),
                const SizedBox(height: 4),
                Text(
                  currencyFormat.format(state.wallet.balance),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.account_balance_wallet,
              color: Colors.white,
              size: 32,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildAmountInput(String currency) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Text(
            currency,
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
                if (amount < 50) {
                  return 'Minimum top up is $currency 50';
                }
                return null;
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickAmounts(String currency) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _quickAmounts.map((amount) {
        final isSelected = _amountController.text == amount.toInt().toString();
        return GestureDetector(
          onTap: () {
            setState(() {
              _amountController.text = amount.toInt().toString();
            });
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: isSelected
                  ? const Color(0xFF4CAF50)
                  : const Color(0xFF252542),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: isSelected
                    ? const Color(0xFF4CAF50)
                    : const Color(0xFF3D3D5C),
              ),
            ),
            child: Text(
              '$currency ${NumberFormat.compact().format(amount)}',
              style: TextStyle(
                color: isSelected ? Colors.white : Colors.white70,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
            ),
          ),
        );
      }).toList(),
    );
  }

  Widget _buildPaymentMethodSelector(List<PaymentMethodData> methods) {
    // Filter to only payment sources (not bank accounts for withdrawal)
    final paymentSources = methods
        .where((m) => m.type != PaymentMethodType.bank)
        .toList();

    if (_selectedMethod == null && paymentSources.isNotEmpty) {
      _selectedMethod = paymentSources.firstWhere(
        (m) => m.isDefault,
        orElse: () => paymentSources.first,
      );
    }

    return Column(
      children: paymentSources.map((method) {
        final isSelected = _selectedMethod?.id == method.id;
        return GestureDetector(
          onTap: () => setState(() => _selectedMethod = method),
          child: Container(
            margin: const EdgeInsets.only(bottom: 12),
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF252542),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: isSelected
                    ? const Color(0xFF4CAF50)
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
                      if (method.phoneNumber != null)
                        Text(
                          method.phoneNumber!,
                          style: const TextStyle(
                            color: Colors.white54,
                            fontSize: 12,
                          ),
                        ),
                    ],
                  ),
                ),
                if (isSelected)
                  const Icon(
                    Icons.check_circle,
                    color: Color(0xFF4CAF50),
                  ),
              ],
            ),
          ),
        );
      }).toList(),
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

  void _handleTopUp() {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedMethod == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select a payment method'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    final amount = double.parse(_amountController.text);
    context.read<WalletBloc>().add(WalletTopUp(
          amount: amount,
          paymentMethod: _selectedMethod!,
        ));
  }
}
