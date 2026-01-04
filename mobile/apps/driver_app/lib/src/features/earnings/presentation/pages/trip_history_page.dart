import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../bloc/earnings_bloc.dart';

/// Trip history page showing paginated list of past trips
class TripHistoryPage extends StatefulWidget {
  const TripHistoryPage({super.key});

  @override
  State<TripHistoryPage> createState() => _TripHistoryPageState();
}

class _TripHistoryPageState extends State<TripHistoryPage> {
  final ScrollController _scrollController = ScrollController();
  TripHistoryFilter _currentFilter = TripHistoryFilter.all;

  @override
  void initState() {
    super.initState();
    context.read<EarningsBloc>().add(const LoadTripHistory());
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      // Load more trips when near the end
      context.read<EarningsBloc>().add(const LoadMoreTrips());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Trip History'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.filter_list),
            onPressed: () => _showFilterSheet(context),
          ),
        ],
      ),
      body: Column(
        children: [
          // Filter chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                _buildFilterChip(TripHistoryFilter.all, 'All'),
                const SizedBox(width: 8),
                _buildFilterChip(TripHistoryFilter.rides, 'Rides'),
                const SizedBox(width: 8),
                _buildFilterChip(TripHistoryFilter.deliveries, 'Deliveries'),
                const SizedBox(width: 8),
                _buildFilterChip(TripHistoryFilter.food, 'Food'),
              ],
            ),
          ),

          // Trips list
          Expanded(
            child: BlocBuilder<EarningsBloc, EarningsState>(
              builder: (context, state) {
                if (state is EarningsLoading) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (state is EarningsTripHistoryLoaded) {
                  if (state.trips.isEmpty) {
                    return _buildEmptyState();
                  }

                  return ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: state.trips.length + (state.hasMore ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index == state.trips.length) {
                        return const Center(
                          child: Padding(
                            padding: EdgeInsets.all(16),
                            child: CircularProgressIndicator(),
                          ),
                        );
                      }

                      final trip = state.trips[index];
                      return _buildTripCard(context, trip);
                    },
                  );
                }

                return _buildEmptyState();
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChip(TripHistoryFilter filter, String label) {
    final isSelected = _currentFilter == filter;
    return FilterChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (selected) {
        setState(() {
          _currentFilter = filter;
        });
        context.read<EarningsBloc>().add(LoadTripHistory(filter: filter));
      },
      selectedColor: Theme.of(context).primaryColor.withOpacity(0.2),
      checkmarkColor: Theme.of(context).primaryColor,
    );
  }

  Widget _buildTripCard(BuildContext context, TripEarningsEntry trip) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: InkWell(
        onTap: () => context.push(
          AppRoutes.tripDetails.replaceAll(':id', trip.tripId),
        ),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: _getTripTypeColor(trip.tripType).withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(
                      _getTripTypeIcon(trip.tripType),
                      color: _getTripTypeColor(trip.tripType),
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          trip.tripType.toUpperCase(),
                          style: TextStyle(
                            color: _getTripTypeColor(trip.tripType),
                            fontSize: 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          trip.formattedDate,
                          style: TextStyle(
                            color: Colors.grey.shade600,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        'KES ${trip.totalEarnings.toStringAsFixed(0)}',
                        style: const TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                      if (trip.tips > 0)
                        Text(
                          '+KES ${trip.tips.toStringAsFixed(0)} tip',
                          style: const TextStyle(
                            color: Colors.green,
                            fontSize: 12,
                          ),
                        ),
                    ],
                  ),
                ],
              ),
              const Divider(height: 24),
              // Route info
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: Color(0xFF00A86B),
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      trip.pickupAddress,
                      style: const TextStyle(fontSize: 13),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              Padding(
                padding: const EdgeInsets.only(left: 3),
                child: Container(
                  width: 2,
                  height: 16,
                  color: Colors.grey.shade300,
                ),
              ),
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: Colors.red,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      trip.dropoffAddress,
                      style: const TextStyle(fontSize: 13),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              // Stats row
              Row(
                children: [
                  _buildTripStat(
                    Icons.route,
                    '${trip.distanceKm.toStringAsFixed(1)} km',
                  ),
                  const SizedBox(width: 16),
                  _buildTripStat(
                    Icons.schedule,
                    '${trip.durationMinutes} min',
                  ),
                  const Spacer(),
                  Icon(
                    Icons.chevron_right,
                    color: Colors.grey.shade400,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTripStat(IconData icon, String value) {
    return Row(
      children: [
        Icon(icon, size: 14, color: Colors.grey),
        const SizedBox(width: 4),
        Text(
          value,
          style: TextStyle(
            color: Colors.grey.shade600,
            fontSize: 12,
          ),
        ),
      ],
    );
  }

  IconData _getTripTypeIcon(String tripType) {
    switch (tripType.toLowerCase()) {
      case 'ride':
        return Icons.directions_car;
      case 'delivery':
        return Icons.local_shipping;
      case 'food':
        return Icons.fastfood;
      default:
        return Icons.receipt;
    }
  }

  Color _getTripTypeColor(String tripType) {
    switch (tripType.toLowerCase()) {
      case 'ride':
        return const Color(0xFF00A86B);
      case 'delivery':
        return Colors.blue;
      case 'food':
        return Colors.orange;
      default:
        return Colors.grey;
    }
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.history,
            size: 64,
            color: Colors.grey.shade400,
          ),
          const SizedBox(height: 16),
          Text(
            'No trips yet',
            style: TextStyle(
              color: Colors.grey.shade600,
              fontSize: 18,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Your completed trips will appear here',
            style: TextStyle(
              color: Colors.grey.shade500,
            ),
          ),
        ],
      ),
    );
  }

  void _showFilterSheet(BuildContext context) {
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
              'Filter Trips',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'Date Range',
              style: TextStyle(fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      // Show date picker
                    },
                    child: const Text('Start Date'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      // Show date picker
                    },
                    child: const Text('End Date'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Text(
              'Minimum Earnings',
              style: TextStyle(fontWeight: FontWeight.w500),
            ),
            const SizedBox(height: 8),
            TextField(
              decoration: const InputDecoration(
                prefixText: 'KES ',
                hintText: '0',
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      Navigator.pop(context);
                    },
                    child: const Text('Reset'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      Navigator.pop(context);
                    },
                    child: const Text('Apply'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
