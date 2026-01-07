import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../bloc/wallet_bloc.dart';

/// Transaction History Page
class TransactionsPage extends StatefulWidget {
  const TransactionsPage({super.key});

  @override
  State<TransactionsPage> createState() => _TransactionsPageState();
}

class _TransactionsPageState extends State<TransactionsPage> {
  final _scrollController = ScrollController();
  TransactionFilter _currentFilter = TransactionFilter.all;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    context.read<WalletBloc>().add(const WalletLoadTransactions());
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_isBottom) {
      context.read<WalletBloc>().add(const WalletLoadMoreTransactions());
    }
  }

  bool get _isBottom {
    if (!_scrollController.hasClients) return false;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.offset;
    return currentScroll >= (maxScroll * 0.9);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF1A1A2E),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A2E),
        elevation: 0,
        title: const Text('Transaction History'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: _showSearch,
          ),
          IconButton(
            icon: const Icon(Icons.filter_list),
            onPressed: _showFilterSheet,
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter Chips
          _buildFilterChips(),

          // Transactions List
          Expanded(
            child: BlocBuilder<WalletBloc, WalletState>(
              builder: (context, state) {
                if (state is WalletTransactionsLoading) {
                  return const Center(
                    child: CircularProgressIndicator(color: Colors.white),
                  );
                }

                if (state is WalletTransactionsError) {
                  return _buildErrorState(state.message);
                }

                if (state is WalletTransactionsLoaded) {
                  return _buildTransactionsList(state);
                }

                return const Center(
                  child: Text(
                    'No transactions',
                    style: TextStyle(color: Colors.white54),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChips() {
    return Container(
      height: 50,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        itemCount: TransactionFilter.values.length,
        itemBuilder: (context, index) {
          final filter = TransactionFilter.values[index];
          final isSelected = _currentFilter == filter;

          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilterChip(
              label: Text(filter.displayName),
              selected: isSelected,
              onSelected: (selected) {
                setState(() => _currentFilter = filter);
                context.read<WalletBloc>().add(
                      WalletLoadTransactions(filter: filter),
                    );
              },
              selectedColor: const Color(0xFF667EEA),
              backgroundColor: const Color(0xFF252542),
              labelStyle: TextStyle(
                color: isSelected ? Colors.white : Colors.white70,
              ),
              checkmarkColor: Colors.white,
            ),
          );
        },
      ),
    );
  }

  Widget _buildErrorState(String message) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 48, color: Colors.red),
          const SizedBox(height: 16),
          Text(
            message,
            style: const TextStyle(color: Colors.white54),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: () {
              context.read<WalletBloc>().add(
                    WalletLoadTransactions(filter: _currentFilter),
                  );
            },
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _buildTransactionsList(WalletTransactionsLoaded state) {
    if (state.transactions.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.receipt_long, size: 64, color: Colors.white24),
            SizedBox(height: 16),
            Text(
              'No transactions found',
              style: TextStyle(color: Colors.white54, fontSize: 16),
            ),
          ],
        ),
      );
    }

    final currencyFormat = NumberFormat.currency(
      symbol: 'KES',
      decimalDigits: 2,
    );

    // Group transactions by date
    final groupedTransactions = _groupByDate(state.transactions);

    return RefreshIndicator(
      onRefresh: () async {
        context.read<WalletBloc>().add(
              WalletLoadTransactions(filter: _currentFilter),
            );
      },
      child: ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.all(16),
        itemCount: groupedTransactions.length + (state.hasMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index >= groupedTransactions.length) {
            return state.isLoadingMore
                ? const Center(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: CircularProgressIndicator(color: Colors.white54),
                    ),
                  )
                : const SizedBox.shrink();
          }

          final entry = groupedTransactions.entries.elementAt(index);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Date Header
              Padding(
                padding: const EdgeInsets.only(top: 16, bottom: 8),
                child: Text(
                  entry.key,
                  style: const TextStyle(
                    color: Colors.white54,
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              // Transactions for this date
              ...entry.value.map(
                (txn) => _buildTransactionItem(txn, currencyFormat),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildTransactionItem(
    WalletTransaction txn,
    NumberFormat currencyFormat,
  ) {
    final isPositive = txn.type.isPositive;
    final amountColor = isPositive ? const Color(0xFF4CAF50) : const Color(0xFFF44336);

    return GestureDetector(
      onTap: () => _showTransactionDetails(txn),
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF252542),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: amountColor.withOpacity(0.15),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(
                _getTransactionIcon(txn.type),
                color: amountColor,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    txn.description ?? txn.type.displayName,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Text(
                        DateFormat('HH:mm').format(txn.createdAt),
                        style: const TextStyle(
                          color: Colors.white38,
                          fontSize: 12,
                        ),
                      ),
                      if (txn.isPending) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.orange.withOpacity(0.2),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: const Text(
                            'Pending',
                            style: TextStyle(
                              color: Colors.orange,
                              fontSize: 10,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  '${isPositive ? '+' : '-'} ${currencyFormat.format(txn.amount)}',
                  style: TextStyle(
                    color: amountColor,
                    fontWeight: FontWeight.bold,
                    fontSize: 15,
                  ),
                ),
                if (txn.balanceAfter != null)
                  Text(
                    'Bal: ${currencyFormat.format(txn.balanceAfter)}',
                    style: const TextStyle(
                      color: Colors.white38,
                      fontSize: 11,
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Map<String, List<WalletTransaction>> _groupByDate(
    List<WalletTransaction> transactions,
  ) {
    final grouped = <String, List<WalletTransaction>>{};
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));

    for (final txn in transactions) {
      final txnDate = DateTime(
        txn.createdAt.year,
        txn.createdAt.month,
        txn.createdAt.day,
      );

      String dateKey;
      if (txnDate == today) {
        dateKey = 'Today';
      } else if (txnDate == yesterday) {
        dateKey = 'Yesterday';
      } else if (txnDate.isAfter(today.subtract(const Duration(days: 7)))) {
        dateKey = DateFormat('EEEE').format(txn.createdAt);
      } else {
        dateKey = DateFormat('MMM d, y').format(txn.createdAt);
      }

      grouped.putIfAbsent(dateKey, () => []).add(txn);
    }

    return grouped;
  }

  IconData _getTransactionIcon(WalletTransactionType type) {
    switch (type) {
      case WalletTransactionType.topUp:
        return Icons.add_circle_outline;
      case WalletTransactionType.withdrawal:
        return Icons.arrow_circle_down;
      case WalletTransactionType.earning:
        return Icons.monetization_on;
      case WalletTransactionType.bonus:
        return Icons.card_giftcard;
      case WalletTransactionType.credit:
        return Icons.arrow_circle_up;
      case WalletTransactionType.debit:
        return Icons.arrow_circle_down;
      case WalletTransactionType.refund:
        return Icons.replay;
    }
  }

  void _showSearch() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Search coming soon!'),
        backgroundColor: Color(0xFF667EEA),
      ),
    );
  }

  void _showFilterSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF252542),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Filter Transactions',
              style: TextStyle(
                color: Colors.white,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 20),
            ...TransactionFilter.values.map((filter) {
              final isSelected = _currentFilter == filter;
              return ListTile(
                leading: Icon(
                  isSelected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_unchecked,
                  color: isSelected ? const Color(0xFF667EEA) : Colors.white54,
                ),
                title: Text(
                  filter.displayName,
                  style: const TextStyle(color: Colors.white),
                ),
                onTap: () {
                  setState(() => _currentFilter = filter);
                  context.read<WalletBloc>().add(
                        WalletLoadTransactions(filter: filter),
                      );
                  Navigator.pop(context);
                },
              );
            }),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  void _showTransactionDetails(WalletTransaction txn) {
    final currencyFormat = NumberFormat.currency(symbol: 'KES', decimalDigits: 2);
    final isPositive = txn.type.isPositive;

    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF252542),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 60,
              height: 60,
              decoration: BoxDecoration(
                color: (isPositive ? const Color(0xFF4CAF50) : const Color(0xFFF44336))
                    .withOpacity(0.15),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Icon(
                _getTransactionIcon(txn.type),
                color: isPositive ? const Color(0xFF4CAF50) : const Color(0xFFF44336),
                size: 32,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              '${isPositive ? '+' : '-'} ${currencyFormat.format(txn.amount)}',
              style: TextStyle(
                color: isPositive ? const Color(0xFF4CAF50) : const Color(0xFFF44336),
                fontSize: 28,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              txn.description ?? txn.type.displayName,
              style: const TextStyle(color: Colors.white, fontSize: 16),
            ),
            const SizedBox(height: 24),
            _buildDetailRow('Status', txn.isPending ? 'Pending' : 'Completed'),
            _buildDetailRow('Type', txn.type.displayName),
            _buildDetailRow(
              'Date',
              DateFormat('MMM d, y • HH:mm').format(txn.createdAt),
            ),
            _buildDetailRow('Reference', txn.id),
            if (txn.balanceAfter != null)
              _buildDetailRow(
                'Balance After',
                currencyFormat.format(txn.balanceAfter),
              ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.pop(context),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF667EEA),
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: const Text('Close'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.white54)),
          Text(
            value,
            style: const TextStyle(color: Colors.white),
          ),
        ],
      ),
    );
  }
}
