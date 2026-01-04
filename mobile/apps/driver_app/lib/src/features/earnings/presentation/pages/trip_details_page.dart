import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../bloc/earnings_bloc.dart';

/// Detailed view of a single trip's earnings breakdown
class TripDetailsPage extends StatefulWidget {
  final String tripId;

  const TripDetailsPage({
    super.key,
    required this.tripId,
  });

  @override
  State<TripDetailsPage> createState() => _TripDetailsPageState();
}

class _TripDetailsPageState extends State<TripDetailsPage> {
  @override
  void initState() {
    super.initState();
    context.read<EarningsBloc>().add(LoadTripDetails(widget.tripId));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Trip Details'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.help_outline),
            onPressed: () => _showHelpDialog(context),
          ),
        ],
      ),
      body: BlocBuilder<EarningsBloc, EarningsState>(
        builder: (context, state) {
          if (state is EarningsLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state is EarningsTripDetailsLoaded) {
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header card
                  _buildHeaderCard(context, state.details),
                  const SizedBox(height: 24),

                  // Route details
                  _buildRouteSection(context, state.details),
                  const SizedBox(height: 24),

                  // Customer info
                  _buildCustomerSection(context, state.details),
                  const SizedBox(height: 24),

                  // Earnings breakdown
                  _buildEarningsBreakdown(context, state.details),
                  const SizedBox(height: 24),

                  // Trip stats
                  _buildTripStats(context, state.details),
                  const SizedBox(height: 24),

                  // Report issue button
                  _buildReportButton(context),
                ],
              ),
            );
          }

          return const Center(child: Text('Trip not found'));
        },
      ),
    );
  }

  Widget _buildHeaderCard(BuildContext context, TripEarningsDetails details) {
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
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              details.tripType.toUpperCase(),
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(height: 16),
          Text(
            'KES ${details.totalEarnings.toStringAsFixed(0)}',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 40,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            details.formattedDateTime,
            style: TextStyle(
              color: Colors.white.withOpacity(0.8),
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.green.withOpacity(0.2),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.check_circle,
                  color: Colors.white,
                  size: 16,
                ),
                const SizedBox(width: 8),
                Text(
                  details.status.toUpperCase(),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteSection(BuildContext context, TripEarningsDetails details) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Route',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.grey.shade50,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.grey.shade200),
          ),
          child: Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Column(
                    children: [
                      Container(
                        width: 12,
                        height: 12,
                        decoration: const BoxDecoration(
                          color: Color(0xFF00A86B),
                          shape: BoxShape.circle,
                        ),
                      ),
                      Container(
                        width: 2,
                        height: 40,
                        color: Colors.grey.shade300,
                      ),
                      Container(
                        width: 12,
                        height: 12,
                        decoration: const BoxDecoration(
                          color: Colors.red,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Pickup
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Pickup',
                              style: TextStyle(
                                color: Colors.grey.shade600,
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              details.pickupAddress,
                              style: const TextStyle(fontWeight: FontWeight.w500),
                            ),
                            Text(
                              details.pickupTime,
                              style: TextStyle(
                                color: Colors.grey.shade600,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 24),
                        // Dropoff
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Dropoff',
                              style: TextStyle(
                                color: Colors.grey.shade600,
                                fontSize: 12,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              details.dropoffAddress,
                              style: const TextStyle(fontWeight: FontWeight.w500),
                            ),
                            Text(
                              details.dropoffTime,
                              style: TextStyle(
                                color: Colors.grey.shade600,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildCustomerSection(
      BuildContext context, TripEarningsDetails details) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Customer',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.grey.shade200),
          ),
          child: Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: Colors.grey.shade200,
                child: const Icon(Icons.person, color: Colors.grey),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      details.customerName,
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    if (details.customerRating > 0)
                      Row(
                        children: [
                          const Icon(
                            Icons.star,
                            size: 14,
                            color: Colors.amber,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            details.customerRating.toStringAsFixed(1),
                            style: TextStyle(color: Colors.grey.shade600),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
              if (details.tips > 0)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: Colors.green.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.favorite,
                        size: 14,
                        color: Colors.green,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Tipped KES ${details.tips.toStringAsFixed(0)}',
                        style: const TextStyle(
                          color: Colors.green,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEarningsBreakdown(
      BuildContext context, TripEarningsDetails details) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Earnings Breakdown',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.grey.shade200),
          ),
          child: Column(
            children: [
              _buildBreakdownRow('Base Fare', details.baseFare),
              _buildBreakdownRow('Distance (${details.distanceKm.toStringAsFixed(1)} km)', details.distanceCharge),
              _buildBreakdownRow('Time (${details.durationMinutes} min)', details.timeCharge),
              if (details.surgeMultiplier > 1)
                _buildBreakdownRow(
                  'Surge (${details.surgeMultiplier}x)',
                  details.surgeAmount,
                  isHighlight: true,
                ),
              if (details.tips > 0)
                _buildBreakdownRow('Tip', details.tips, isHighlight: true),
              if (details.bonus > 0)
                _buildBreakdownRow('Bonus', details.bonus, isHighlight: true),
              const Divider(height: 24),
              _buildBreakdownRow(
                'Platform Fee',
                -details.platformFee,
                isDeduction: true,
              ),
              const Divider(height: 24),
              _buildBreakdownRow(
                'Total Earnings',
                details.totalEarnings,
                isTotal: true,
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildBreakdownRow(
    String label,
    double amount, {
    bool isTotal = false,
    bool isHighlight = false,
    bool isDeduction = false,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontWeight: isTotal ? FontWeight.bold : FontWeight.normal,
              fontSize: isTotal ? 16 : 14,
              color: isDeduction ? Colors.red : null,
            ),
          ),
          Text(
            '${isDeduction && amount > 0 ? '-' : ''}KES ${amount.abs().toStringAsFixed(0)}',
            style: TextStyle(
              fontWeight: isTotal ? FontWeight.bold : FontWeight.w500,
              fontSize: isTotal ? 18 : 14,
              color: isTotal
                  ? Theme.of(context).primaryColor
                  : isHighlight
                      ? Colors.green
                      : isDeduction
                          ? Colors.red
                          : null,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTripStats(BuildContext context, TripEarningsDetails details) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Trip Stats',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildStatCard(
                context,
                Icons.route,
                '${details.distanceKm.toStringAsFixed(1)} km',
                'Distance',
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildStatCard(
                context,
                Icons.schedule,
                '${details.durationMinutes} min',
                'Duration',
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildStatCard(
                context,
                Icons.hourglass_empty,
                '${details.waitTimeMinutes} min',
                'Wait Time',
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildStatCard(
                context,
                Icons.payment,
                details.paymentMethod,
                'Payment',
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildStatCard(
    BuildContext context,
    IconData icon,
    String value,
    String label,
  ) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Theme.of(context).primaryColor, size: 24),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 16,
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

  Widget _buildReportButton(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: () => _showReportSheet(context),
        icon: const Icon(Icons.flag_outlined),
        label: const Text('Report an issue with this trip'),
        style: OutlinedButton.styleFrom(
          foregroundColor: Colors.orange,
          side: const BorderSide(color: Colors.orange),
          padding: const EdgeInsets.symmetric(vertical: 12),
        ),
      ),
    );
  }

  void _showHelpDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Earnings Help'),
        content: const SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Base Fare',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              Text('The fixed amount you earn for starting a trip.'),
              SizedBox(height: 12),
              Text(
                'Distance Charge',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              Text('Calculated based on the distance traveled.'),
              SizedBox(height: 12),
              Text(
                'Time Charge',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              Text('Additional earnings based on trip duration.'),
              SizedBox(height: 12),
              Text(
                'Platform Fee',
                style: TextStyle(fontWeight: FontWeight.bold),
              ),
              Text('Service fee deducted for using the platform.'),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Got it'),
          ),
        ],
      ),
    );
  }

  void _showReportSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Report an Issue',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.money_off),
              title: const Text('Incorrect earnings'),
              onTap: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Report submitted')),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.route),
              title: const Text('Wrong route/distance'),
              onTap: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Report submitted')),
                );
              },
            ),
            ListTile(
              leading: const Icon(Icons.more_horiz),
              title: const Text('Other issue'),
              onTap: () {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Report submitted')),
                );
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
