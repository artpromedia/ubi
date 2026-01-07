import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../bloc/wallet_bloc.dart';

/// Main UBI Pay Wallet Page
class WalletPage extends StatelessWidget {
  const WalletPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      body: BlocConsumer<WalletBloc, WalletState>(
        listener: (context, state) {
          if (state is WalletOperationSuccess) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(state.message),
                backgroundColor: Colors.green,
              ),
            );
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
          if (state is WalletLoading) {
            return const Center(
              child: CircularProgressIndicator(color: Colors.white),
            );
          }

          if (state is WalletError) {
            return _buildErrorState(context, state.message);
          }

          if (state is WalletLoaded) {
            return _buildWalletContent(context, state);
          }

          // Initial state - load wallet
          context.read<WalletBloc>().add(const WalletLoad());
          return const Center(
            child: CircularProgressIndicator(color: Colors.white),
          );
        },
      ),
    );
  }

  Widget _buildErrorState(BuildContext context, String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 64, color: Colors.red),
          const SizedBox(height: 16),
          Text(
            message,
            style: const TextStyle(color: Colors.white),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: () => context.read<WalletBloc>().add(const WalletLoad()),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _buildWalletContent(BuildContext context, WalletLoaded state) {
    final currencyFormat = NumberFormat.currency(
      symbol: state.wallet.currency,
      decimalDigits: 2,
    );

    return CustomScrollView(
      slivers: [
        // App Bar
        SliverAppBar(
          backgroundColor: const Color(0xFF1A1A2E),
          pinned: true,
          expandedHeight: 280,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white),
            onPressed: () => context.pop(),
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.history, color: Colors.white),
              onPressed: () => context.push('/wallet/transactions'),
            ),
            IconButton(
              icon: const Icon(Icons.more_vert, color: Colors.white),
              onPressed: () => _showOptionsMenu(context),
            ),
          ],
          flexibleSpace: FlexibleSpaceBar(
            background: _buildWalletCard(context, state, currencyFormat),
          ),
        ),

        // Quick Actions
        SliverToBoxAdapter(
          child: _buildQuickActions(context),
        ),

        // Payment Methods Section
        SliverToBoxAdapter(
          child: _buildPaymentMethodsSection(context, state),
        ),

        // Recent Transactions Section
        SliverToBoxAdapter(
          child: _buildRecentTransactionsSection(context, state, currencyFormat),
        ),

        // UBI Pay Services
        SliverToBoxAdapter(
          child: _buildServicesSection(context),
        ),

        const SliverToBoxAdapter(
          child: SizedBox(height: 24),
        ),
      ],
    );
  }

  Widget _buildWalletCard(
    BuildContext context,
    WalletLoaded state,
    NumberFormat currencyFormat,
  ) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 100, 20, 20),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF667EEA),
            Color(0xFF764BA2),
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(Icons.account_balance_wallet, color: Colors.white, size: 24),
              ),
              const SizedBox(width: 12),
              const Text(
                'UBI Pay',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  state.wallet.tier.displayName,
                  style: const TextStyle(color: Colors.white, fontSize: 12),
                ),
              ),
            ],
          ),
          const SizedBox(height: 24),
          const Text(
            'Available Balance',
            style: TextStyle(
              color: Colors.white70,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            currencyFormat.format(state.wallet.effectiveAvailableBalance),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 36,
              fontWeight: FontWeight.bold,
            ),
          ),
          if (state.wallet.pendingBalance > 0) ...[
            const SizedBox(height: 8),
            Text(
              'Pending: ${currencyFormat.format(state.wallet.pendingBalance)}',
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 14,
              ),
            ),
          ],
          const SizedBox(height: 16),
          if (state.wallet.accountNumber != null)
            Row(
              children: [
                const Icon(Icons.copy, color: Colors.white54, size: 16),
                const SizedBox(width: 8),
                Text(
                  state.wallet.accountNumber!,
                  style: const TextStyle(color: Colors.white70, fontSize: 14),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Widget _buildQuickActions(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          _buildActionButton(
            context,
            icon: Icons.add,
            label: 'Top Up',
            color: const Color(0xFF4CAF50),
            onTap: () => context.push('/wallet/topup'),
          ),
          _buildActionButton(
            context,
            icon: Icons.arrow_downward,
            label: 'Withdraw',
            color: const Color(0xFF2196F3),
            onTap: () => context.push('/wallet/withdraw'),
          ),
          _buildActionButton(
            context,
            icon: Icons.send,
            label: 'Send',
            color: const Color(0xFF9C27B0),
            onTap: () => context.push('/wallet/send'),
          ),
          _buildActionButton(
            context,
            icon: Icons.qr_code_scanner,
            label: 'Scan',
            color: const Color(0xFFFF9800),
            onTap: () => _showScanQR(context),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton(
    BuildContext context, {
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: color.withOpacity(0.15),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(icon, color: color, size: 28),
          ),
          const SizedBox(height: 8),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPaymentMethodsSection(BuildContext context, WalletLoaded state) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Payment Methods',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              TextButton.icon(
                onPressed: () => context.push('/wallet/payment-methods'),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Add'),
                style: TextButton.styleFrom(foregroundColor: const Color(0xFF667EEA)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...state.paymentMethods.take(3).map(
                (method) => _buildPaymentMethodTile(method),
              ),
          if (state.paymentMethods.length > 3)
            TextButton(
              onPressed: () => context.push('/wallet/payment-methods'),
              child: Text('View all ${state.paymentMethods.length} methods'),
            ),
        ],
      ),
    );
  }

  Widget _buildPaymentMethodTile(PaymentMethodData method) {
    IconData icon;
    switch (method.type) {
      case PaymentMethodType.mpesa:
        icon = Icons.phone_android;
        break;
      case PaymentMethodType.mtn:
        icon = Icons.phone_android;
        break;
      case PaymentMethodType.card:
        icon = Icons.credit_card;
        break;
      case PaymentMethodType.bank:
        icon = Icons.account_balance;
        break;
      case PaymentMethodType.wallet:
        icon = Icons.account_balance_wallet;
        break;
    }

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: const Color(0xFF1A1A2E),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: Colors.white70),
      ),
      title: Text(
        method.displayName,
        style: const TextStyle(color: Colors.white),
      ),
      subtitle: method.phoneNumber != null
          ? Text(
              method.phoneNumber!,
              style: const TextStyle(color: Colors.white54, fontSize: 12),
            )
          : method.expiryDisplay != null
              ? Text(
                  'Expires ${method.expiryDisplay}',
                  style: const TextStyle(color: Colors.white54, fontSize: 12),
                )
              : null,
      trailing: method.isDefault
          ? Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFF667EEA).withOpacity(0.2),
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Text(
                'Default',
                style: TextStyle(color: Color(0xFF667EEA), fontSize: 10),
              ),
            )
          : null,
    );
  }

  Widget _buildRecentTransactionsSection(
    BuildContext context,
    WalletLoaded state,
    NumberFormat currencyFormat,
  ) {
    return Container(
      margin: const EdgeInsets.all(20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Recent Transactions',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              TextButton(
                onPressed: () => context.push('/wallet/transactions'),
                child: const Text('See All'),
                style: TextButton.styleFrom(foregroundColor: const Color(0xFF667EEA)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (state.recentTransactions.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Text(
                  'No transactions yet',
                  style: TextStyle(color: Colors.white54),
                ),
              ),
            )
          else
            ...state.recentTransactions.map(
              (txn) => _buildTransactionTile(txn, currencyFormat),
            ),
        ],
      ),
    );
  }

  Widget _buildTransactionTile(WalletTransaction txn, NumberFormat currencyFormat) {
    final isPositive = txn.type.isPositive;
    final amountColor = isPositive ? const Color(0xFF4CAF50) : const Color(0xFFF44336);

    IconData icon;
    switch (txn.type) {
      case WalletTransactionType.topUp:
        icon = Icons.add_circle_outline;
        break;
      case WalletTransactionType.withdrawal:
        icon = Icons.arrow_circle_down;
        break;
      case WalletTransactionType.earning:
        icon = Icons.monetization_on;
        break;
      case WalletTransactionType.bonus:
        icon = Icons.card_giftcard;
        break;
      case WalletTransactionType.credit:
        icon = Icons.arrow_circle_up;
        break;
      case WalletTransactionType.debit:
        icon = Icons.arrow_circle_down;
        break;
      case WalletTransactionType.refund:
        icon = Icons.replay;
        break;
    }

    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: amountColor.withOpacity(0.15),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: amountColor),
      ),
      title: Text(
        txn.description ?? txn.type.displayName,
        style: const TextStyle(color: Colors.white),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(
        _formatDate(txn.createdAt),
        style: const TextStyle(color: Colors.white54, fontSize: 12),
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            '${isPositive ? '+' : '-'} ${currencyFormat.format(txn.amount)}',
            style: TextStyle(
              color: amountColor,
              fontWeight: FontWeight.bold,
            ),
          ),
          if (txn.isPending)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.orange.withOpacity(0.2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Text(
                'Pending',
                style: TextStyle(color: Colors.orange, fontSize: 10),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildServicesSection(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF252542),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'UBI Pay Services',
            style: TextStyle(
              color: Colors.white,
              fontSize: 16,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _buildServiceTile(
                  icon: Icons.swap_horiz,
                  label: 'P2P Transfer',
                  color: const Color(0xFF9C27B0),
                  onTap: () => context.push('/wallet/send'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildServiceTile(
                  icon: Icons.request_quote,
                  label: 'Request',
                  color: const Color(0xFF00BCD4),
                  onTap: () => _showRequestMoney(context),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _buildServiceTile(
                  icon: Icons.savings,
                  label: 'Savings',
                  color: const Color(0xFF4CAF50),
                  onTap: () => _showComingSoon(context, 'Savings'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _buildServiceTile(
                  icon: Icons.account_balance,
                  label: 'Loans',
                  color: const Color(0xFFFF9800),
                  onTap: () => _showComingSoon(context, 'Loans'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildServiceTile({
    required IconData icon,
    required String label,
    required Color color,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: color.withOpacity(0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: color.withOpacity(0.3)),
        ),
        child: Column(
          children: [
            Icon(icon, color: color, size: 28),
            const SizedBox(height: 8),
            Text(
              label,
              style: TextStyle(color: color, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);

    if (diff.inMinutes < 60) {
      return '${diff.inMinutes}m ago';
    } else if (diff.inHours < 24) {
      return '${diff.inHours}h ago';
    } else if (diff.inDays < 7) {
      return '${diff.inDays}d ago';
    } else {
      return DateFormat('MMM d, y').format(date);
    }
  }

  void _showOptionsMenu(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF252542),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: const Icon(Icons.settings, color: Colors.white70),
            title: const Text('Wallet Settings', style: TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              _showComingSoon(context, 'Settings');
            },
          ),
          ListTile(
            leading: const Icon(Icons.security, color: Colors.white70),
            title: const Text('Security', style: TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              _showComingSoon(context, 'Security');
            },
          ),
          ListTile(
            leading: const Icon(Icons.help_outline, color: Colors.white70),
            title: const Text('Help & Support', style: TextStyle(color: Colors.white)),
            onTap: () {
              Navigator.pop(context);
              _showComingSoon(context, 'Help');
            },
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  void _showScanQR(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('QR Scanner coming soon!'),
        backgroundColor: Color(0xFF667EEA),
      ),
    );
  }

  void _showRequestMoney(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Request Money coming soon!'),
        backgroundColor: Color(0xFF667EEA),
      ),
    );
  }

  void _showComingSoon(BuildContext context, String feature) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$feature coming soon!'),
        backgroundColor: const Color(0xFF667EEA),
      ),
    );
  }
}
