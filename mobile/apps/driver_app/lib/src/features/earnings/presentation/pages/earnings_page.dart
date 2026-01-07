import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/app_router.dart';
import '../../bloc/earnings_bloc.dart';

/// Main earnings page showing today/week/month earnings with charts
class EarningsPage extends StatefulWidget {
  const EarningsPage({super.key});

  @override
  State<EarningsPage> createState() => _EarningsPageState();
}

class _EarningsPageState extends State<EarningsPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  int _selectedPeriod = 0; // 0: Today, 1: Week, 2: Month

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(_onTabChanged);
    context.read<EarningsBloc>().add(const EarningsLoadToday());
  }

  void _onTabChanged() {
    if (_tabController.indexIsChanging) return;

    setState(() {
      _selectedPeriod = _tabController.index;
    });

    switch (_tabController.index) {
      case 0:
        context.read<EarningsBloc>().add(const EarningsLoadToday());
        break;
      case 1:
        context.read<EarningsBloc>().add(const EarningsLoadWeek());
        break;
      case 2:
        context.read<EarningsBloc>().add(const EarningsLoadMonth());
        break;
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Earnings'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.history),
            onPressed: () => context.push(AppRoutes.tripHistory),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Today'),
            Tab(text: 'This Week'),
            Tab(text: 'This Month'),
          ],
        ),
      ),
      body: BlocBuilder<EarningsBloc, EarningsState>(
        builder: (context, state) {
          if (state is EarningsLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          EarningsSummary? summary;
          List<dynamic>? breakdownData;

          if (state is EarningsTodayLoaded) {
            summary = state.summary;
            breakdownData = state.hourlyBreakdown;
          } else if (state is EarningsWeekLoaded) {
            summary = state.summary;
            breakdownData = state.dailyBreakdown;
          } else if (state is EarningsMonthLoaded) {
            summary = state.summary;
            breakdownData = state.weeklyBreakdown;
          }

          if (summary == null) {
            return const Center(child: Text('No earnings data'));
          }

          return RefreshIndicator(
            onRefresh: () async {
              _onTabChanged();
            },
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Total earnings card
                  _buildTotalEarningsCard(context, summary),
                  const SizedBox(height: 24),

                  // Earnings chart
                  _buildEarningsChart(context, breakdownData),
                  const SizedBox(height: 24),

                  // Breakdown cards
                  _buildBreakdownCards(context, summary),
                  const SizedBox(height: 24),

                  // Quick actions
                  _buildQuickActions(context),
                  const SizedBox(height: 24),

                  // Incentives section
                  _buildIncentivesSection(context),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildTotalEarningsCard(BuildContext context, EarningsSummary summary) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Theme.of(context).primaryColor,
            Theme.of(context).primaryColor.withOpacity(0.8),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
        boxShadow: [
          BoxShadow(
            color: Theme.of(context).primaryColor.withOpacity(0.3),
            blurRadius: 16,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _getPeriodLabel(),
            style: TextStyle(
              color: Colors.white.withOpacity(0.8),
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'KES ${summary.totalEarnings.toStringAsFixed(0)}',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 36,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              _buildMiniStat(
                Icons.route,
                '${summary.tripCount}',
                'Trips',
              ),
              const SizedBox(width: 24),
              _buildMiniStat(
                Icons.schedule,
                '${summary.onlineHours.toStringAsFixed(1)}h',
                'Online',
              ),
              const SizedBox(width: 24),
              _buildMiniStat(
                Icons.trending_up,
                'KES ${(summary.totalEarnings / (summary.onlineHours > 0 ? summary.onlineHours : 1)).toStringAsFixed(0)}',
                'Per Hour',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMiniStat(IconData icon, String value, String label) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, color: Colors.white70, size: 16),
            const SizedBox(width: 4),
            Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
          ],
        ),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withOpacity(0.7),
            fontSize: 11,
          ),
        ),
      ],
    );
  }

  String _getPeriodLabel() {
    switch (_selectedPeriod) {
      case 0:
        return "Today's Earnings";
      case 1:
        return 'This Week';
      case 2:
        return 'This Month';
      default:
        return 'Total Earnings';
    }
  }

  String _getDayLabel(DateTime date) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days[date.weekday - 1];
  }

  Widget _buildEarningsChart(BuildContext context, List<dynamic>? data) {
    return Container(
      height: 200,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Earnings Overview',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: data == null || data.isEmpty
                ? const Center(child: Text('No data available'))
                : Row(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: List.generate(
                      data.length > 7 ? 7 : data.length,
                      (index) => _buildBarItem(context, index, data),
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  Widget _buildBarItem(BuildContext context, int index, List<dynamic> data) {
    // This is a simplified bar chart representation
    final maxValue = data.fold<double>(0, (max, item) {
      double value = 0;
      if (item is HourlyEarnings) {
        value = item.earnings;
      } else if (item is DailyEarnings) {
        value = item.earnings;
      }
      return value > max ? value : max;
    });

    double value = 0;
    String label = '';

    final item = data[index];
    if (item is HourlyEarnings) {
      value = item.earnings;
      label = '${item.hour}:00';
    } else if (item is DailyEarnings) {
      value = item.earnings;
      label = _getDayLabel(item.date);
    }

    final height = maxValue > 0 ? (value / maxValue) * 80 : 0.0;

    return Column(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        Container(
          width: 24,
          height: height,
          decoration: BoxDecoration(
            color: Theme.of(context).primaryColor.withOpacity(
                  index == data.length - 1 ? 1.0 : 0.6,
                ),
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(4),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: const TextStyle(fontSize: 10),
        ),
      ],
    );
  }

  Widget _buildBreakdownCards(BuildContext context, EarningsSummary summary) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Breakdown',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildBreakdownCard(
                context,
                icon: Icons.attach_money,
                label: 'Trip Fares',
                value: 'KES ${summary.tripEarnings.toStringAsFixed(0)}',
                color: Colors.green,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildBreakdownCard(
                context,
                icon: Icons.card_giftcard,
                label: 'Tips',
                value: 'KES ${summary.tips.toStringAsFixed(0)}',
                color: Colors.orange,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildBreakdownCard(
                context,
                icon: Icons.star,
                label: 'Bonuses',
                value: 'KES ${summary.bonuses.toStringAsFixed(0)}',
                color: Colors.purple,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildBreakdownCard(
                context,
                icon: Icons.local_offer,
                label: 'Surge Earnings',
                value: 'KES ${summary.surgeEarnings.toStringAsFixed(0)}',
                color: Colors.blue,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildBreakdownCard(
    BuildContext context, {
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 24),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 16,
              color: color,
            ),
          ),
          Text(
            label,
            style: TextStyle(
              color: Colors.grey.shade600,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickActions(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: () => context.push(AppRoutes.tripHistory),
            icon: const Icon(Icons.history),
            label: const Text('Trip History'),
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: ElevatedButton.icon(
            onPressed: () => context.push(AppRoutes.payoutHistory),
            icon: const Icon(Icons.account_balance_wallet),
            label: const Text('Payouts'),
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildIncentivesSection(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.amber.withOpacity(0.1),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.amber.withOpacity(0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.amber,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(
                  Icons.local_fire_department,
                  color: Colors.white,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Active Incentives',
                      style: TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    Text(
                      'Complete trips to earn bonuses!',
                      style: TextStyle(
                        color: Colors.grey,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              children: [
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Complete 5 more trips',
                        style: TextStyle(fontWeight: FontWeight.w500),
                      ),
                      Text(
                        'Earn KES 500 bonus',
                        style: TextStyle(
                          color: Colors.green,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(
                  width: 60,
                  height: 60,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      CircularProgressIndicator(
                        value: 0.6,
                        strokeWidth: 4,
                        backgroundColor: Colors.grey.shade200,
                        valueColor: const AlwaysStoppedAnimation<Color>(
                          Colors.amber,
                        ),
                      ),
                      const Text(
                        '3/5',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
