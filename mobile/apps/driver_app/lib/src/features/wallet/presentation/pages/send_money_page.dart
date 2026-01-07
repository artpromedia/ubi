import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../bloc/wallet_bloc.dart';

/// Send Money Page (P2P Transfer)
class SendMoneyPage extends StatefulWidget {
  const SendMoneyPage({super.key});

  @override
  State<SendMoneyPage> createState() => _SendMoneyPageState();
}

class _SendMoneyPageState extends State<SendMoneyPage> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _recipientController = TextEditingController();
  final _noteController = TextEditingController();
  
  String _recipientType = 'phone'; // 'phone', 'wallet', 'email'

  @override
  void dispose() {
    _amountController.dispose();
    _recipientController.dispose();
    _noteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        elevation: 0,
        title: const Text('Send Money'),
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
                  // Balance Display
                  _buildBalanceCard(state),
                  const SizedBox(height: 24),

                  // Recipient Type Selection
                  const Text(
                    'Send To',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildRecipientTypeSelector(),
                  const SizedBox(height: 16),

                  // Recipient Input
                  _buildRecipientInput(),
                  const SizedBox(height: 24),

                  // Amount Input
                  const Text(
                    'Amount',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildAmountInput(state),
                  const SizedBox(height: 24),

                  // Note (optional)
                  const Text(
                    'Note (Optional)',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildNoteInput(),
                  const SizedBox(height: 32),

                  // Recent Recipients
                  _buildRecentRecipients(),
                  const SizedBox(height: 32),

                  // Send Button
                  SizedBox(
                    width: double.infinity,
                    height: 56,
                    child: ElevatedButton(
                      onPressed: isProcessing ? null : _handleSend,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF9C27B0),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        disabledBackgroundColor: const Color(0xFF9C27B0).withOpacity(0.5),
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
                          : const Row(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Icon(Icons.send),
                                SizedBox(width: 8),
                                Text(
                                  'Send Money',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
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
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Available Balance',
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
              SizedBox(height: 4),
            ],
          ),
          Text(
            currencyFormat.format(state.wallet.effectiveAvailableBalance),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRecipientTypeSelector() {
    return Row(
      children: [
        _buildRecipientTypeChip(
          type: 'phone',
          icon: Icons.phone_android,
          label: 'Phone',
        ),
        const SizedBox(width: 12),
        _buildRecipientTypeChip(
          type: 'wallet',
          icon: Icons.account_balance_wallet,
          label: 'UBI Wallet',
        ),
        const SizedBox(width: 12),
        _buildRecipientTypeChip(
          type: 'email',
          icon: Icons.email,
          label: 'Email',
        ),
      ],
    );
  }

  Widget _buildRecipientTypeChip({
    required String type,
    required IconData icon,
    required String label,
  }) {
    final isSelected = _recipientType == type;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() {
          _recipientType = type;
          _recipientController.clear();
        }),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: isSelected
                ? const Color(0xFF9C27B0).withOpacity(0.2)
                : const Color(0xFF252542),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isSelected
                  ? const Color(0xFF9C27B0)
                  : Colors.transparent,
              width: 2,
            ),
          ),
          child: Column(
            children: [
              Icon(
                icon,
                color: isSelected
                    ? const Color(0xFF9C27B0)
                    : Colors.white54,
              ),
              const SizedBox(height: 4),
              Text(
                label,
                style: TextStyle(
                  color: isSelected
                      ? const Color(0xFF9C27B0)
                      : Colors.white54,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRecipientInput() {
    String hint;
    TextInputType keyboardType;
    List<TextInputFormatter> formatters;
    String? Function(String?)? validator;

    switch (_recipientType) {
      case 'phone':
        hint = '+254 712 345 678';
        keyboardType = TextInputType.phone;
        formatters = [FilteringTextInputFormatter.allow(RegExp(r'[\d+\s]'))];
        validator = (value) {
          if (value == null || value.isEmpty) {
            return 'Please enter a phone number';
          }
          if (value.replaceAll(RegExp(r'\D'), '').length < 10) {
            return 'Please enter a valid phone number';
          }
          return null;
        };
        break;
      case 'wallet':
        hint = 'UBI-XXXXXXXXXX';
        keyboardType = TextInputType.text;
        formatters = [];
        validator = (value) {
          if (value == null || value.isEmpty) {
            return 'Please enter a wallet ID';
          }
          if (!value.startsWith('UBI-')) {
            return 'Wallet ID should start with UBI-';
          }
          return null;
        };
        break;
      case 'email':
        hint = 'name@example.com';
        keyboardType = TextInputType.emailAddress;
        formatters = [];
        validator = (value) {
          if (value == null || value.isEmpty) {
            return 'Please enter an email';
          }
          if (!value.contains('@') || !value.contains('.')) {
            return 'Please enter a valid email';
          }
          return null;
        };
        break;
      default:
        hint = '';
        keyboardType = TextInputType.text;
        formatters = [];
        validator = null;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(12),
      ),
      child: TextFormField(
        controller: _recipientController,
        keyboardType: keyboardType,
        inputFormatters: formatters,
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          border: InputBorder.none,
          hintText: hint,
          hintStyle: const TextStyle(color: Colors.white24),
          prefixIcon: Icon(
            _recipientType == 'phone'
                ? Icons.phone
                : _recipientType == 'wallet'
                    ? Icons.account_balance_wallet
                    : Icons.email,
            color: Colors.white54,
          ),
          suffixIcon: IconButton(
            icon: const Icon(Icons.contacts, color: Colors.white54),
            onPressed: _pickFromContacts,
          ),
        ),
        validator: validator,
      ),
    );
  }

  Widget _buildAmountInput(WalletLoaded state) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Text(
            state.wallet.currency,
            style: const TextStyle(
              color: Colors.white54,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: TextFormField(
              controller: _amountController,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              style: const TextStyle(
                color: Colors.white,
                fontSize: 24,
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
                if (amount < 10) {
                  return 'Minimum transfer is ${state.wallet.currency} 10';
                }
                if (amount > state.wallet.effectiveAvailableBalance) {
                  return 'Insufficient balance';
                }
                return null;
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNoteInput() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(12),
      ),
      child: TextFormField(
        controller: _noteController,
        maxLines: 2,
        maxLength: 100,
        style: const TextStyle(color: Colors.white),
        decoration: const InputDecoration(
          border: InputBorder.none,
          hintText: 'What\'s this for?',
          hintStyle: TextStyle(color: Colors.white24),
          counterStyle: TextStyle(color: Colors.white38),
        ),
      ),
    );
  }

  Widget _buildRecentRecipients() {
    // Mock recent recipients
    final recentRecipients = [
      {'name': 'John Doe', 'phone': '+254712345678', 'avatar': 'JD'},
      {'name': 'Sarah M.', 'phone': '+254723456789', 'avatar': 'SM'},
      {'name': 'Mike K.', 'phone': '+254734567890', 'avatar': 'MK'},
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Recent Recipients',
          style: TextStyle(
            color: Colors.white,
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 80,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            itemCount: recentRecipients.length,
            itemBuilder: (context, index) {
              final recipient = recentRecipients[index];
              return GestureDetector(
                onTap: () {
                  setState(() {
                    _recipientType = 'phone';
                    _recipientController.text = recipient['phone']!;
                  });
                },
                child: Container(
                  width: 70,
                  margin: const EdgeInsets.only(right: 12),
                  child: Column(
                    children: [
                      CircleAvatar(
                        radius: 24,
                        backgroundColor: const Color(0xFF9C27B0).withOpacity(0.2),
                        child: Text(
                          recipient['avatar']!,
                          style: const TextStyle(
                            color: Color(0xFF9C27B0),
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        recipient['name']!,
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  void _pickFromContacts() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Contact picker coming soon!'),
        backgroundColor: Color(0xFF667EEA),
      ),
    );
  }

  void _handleSend() {
    if (!_formKey.currentState!.validate()) return;

    final amount = double.parse(_amountController.text);
    final recipient = _recipientController.text;
    final note = _noteController.text.isNotEmpty ? _noteController.text : null;

    // Confirm send
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: const Color(0xFF252542),
        title: const Text(
          'Confirm Transfer',
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
            const SizedBox(height: 8),
            Text(
              'To: $recipient',
              style: const TextStyle(color: Colors.white70),
            ),
            if (note != null) ...[
              const SizedBox(height: 8),
              Text(
                'Note: $note',
                style: const TextStyle(color: Colors.white54, fontSize: 12),
              ),
            ],
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
              context.read<WalletBloc>().add(WalletSendMoney(
                    amount: amount,
                    recipient: recipient,
                    note: note,
                  ));
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF9C27B0),
            ),
            child: const Text('Send'),
          ),
        ],
      ),
    );
  }
}
