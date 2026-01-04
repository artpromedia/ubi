import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/router/app_router.dart';
import '../bloc/trips_bloc.dart';

/// Active trip page showing current trip with navigation and customer info
class ActiveTripPage extends StatefulWidget {
  final String tripId;

  const ActiveTripPage({
    super.key,
    required this.tripId,
  });

  @override
  State<ActiveTripPage> createState() => _ActiveTripPageState();
}

class _ActiveTripPageState extends State<ActiveTripPage> {
  @override
  void initState() {
    super.initState();
    context.read<TripsBloc>().add(LoadActiveTrip(widget.tripId));
  }

  @override
  Widget build(BuildContext context) {
    return BlocConsumer<TripsBloc, TripsState>(
      listener: (context, state) {
        if (state is TripsComplete) {
          // Navigate to trip summary
          showDialog(
            context: context,
            barrierDismissible: false,
            builder: (context) => _buildTripSummaryDialog(context, state.summary),
          );
        }
      },
      builder: (context, state) {
        return Scaffold(
          body: Stack(
            children: [
              // Map placeholder
              Container(
                width: double.infinity,
                height: double.infinity,
                color: Colors.grey.shade200,
                child: const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.map,
                        size: 64,
                        color: Colors.grey,
                      ),
                      SizedBox(height: 16),
                      Text(
                        'Navigation Map',
                        style: TextStyle(
                          color: Colors.grey,
                          fontSize: 18,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // Top bar with navigation button
              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Container(
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.1),
                              blurRadius: 8,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: IconButton(
                          icon: const Icon(Icons.arrow_back),
                          onPressed: () {
                            _showExitConfirmation(context);
                          },
                        ),
                      ),
                      const Spacer(),
                      // Navigation button
                      if (state is TripsEnRouteToPickup ||
                          state is TripsInProgress)
                        Container(
                          decoration: BoxDecoration(
                            color: Theme.of(context).primaryColor,
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.1),
                                blurRadius: 8,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: IconButton(
                            icon: const Icon(
                              Icons.navigation,
                              color: Colors.white,
                            ),
                            onPressed: () {
                              context.push(
                                AppRoutes.navigation,
                                extra: widget.tripId,
                              );
                            },
                          ),
                        ),
                    ],
                  ),
                ),
              ),

              // Bottom sheet
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: _buildBottomSheet(context, state),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildBottomSheet(BuildContext context, TripsState state) {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.grey.shade300,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 16),

          // Status indicator
          _buildStatusIndicator(context, state),
          const SizedBox(height: 16),

          // Customer card
          _buildCustomerCard(context, state),
          const SizedBox(height: 16),

          // Route info
          _buildRouteInfo(context, state),
          const SizedBox(height: 24),

          // Action button
          _buildActionButton(context, state),
        ],
      ),
    );
  }

  Widget _buildStatusIndicator(BuildContext context, TripsState state) {
    String status;
    Color color;
    IconData icon;

    if (state is TripsEnRouteToPickup) {
      status = 'En route to pickup';
      color = Colors.blue;
      icon = Icons.directions_car;
    } else if (state is TripsArrivedPickup) {
      status = 'Arrived at pickup';
      color = const Color(0xFF00A86B);
      icon = Icons.location_on;
    } else if (state is TripsInProgress) {
      status = 'Trip in progress';
      color = const Color(0xFF00A86B);
      icon = Icons.navigation;
    } else if (state is TripsArrivedDropoff) {
      status = 'Arrived at dropoff';
      color = Colors.orange;
      icon = Icons.flag;
    } else if (state is TripsCollectingCash) {
      status = 'Collecting payment';
      color = Colors.green;
      icon = Icons.payments;
    } else {
      status = 'Loading...';
      color = Colors.grey;
      icon = Icons.hourglass_empty;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 8),
          Text(
            status,
            style: TextStyle(
              color: color,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCustomerCard(BuildContext context, TripsState state) {
    // Extract trip data from state
    ActiveTrip? trip;
    if (state is TripsEnRouteToPickup) {
      trip = state.trip;
    } else if (state is TripsArrivedPickup) {
      trip = state.trip;
    } else if (state is TripsInProgress) {
      trip = state.trip;
    } else if (state is TripsArrivedDropoff) {
      trip = state.trip;
    } else if (state is TripsCollectingCash) {
      trip = state.trip;
    }

    final customer = trip?.customer;
    final customerName = customer?.name ?? 'Customer';
    final customerRating = customer?.rating ?? 0.0;

    return Row(
      children: [
        CircleAvatar(
          radius: 24,
          backgroundColor: Colors.grey.shade200,
          child: const Icon(Icons.person, color: Colors.grey),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                customerName,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              if (customerRating > 0)
                Row(
                  children: [
                    const Icon(Icons.star, size: 14, color: Colors.amber),
                    const SizedBox(width: 4),
                    Text(
                      customerRating.toStringAsFixed(1),
                      style: TextStyle(color: Colors.grey.shade600),
                    ),
                  ],
                ),
            ],
          ),
        ),
        // Call button
        Container(
          decoration: BoxDecoration(
            color: Colors.green.withOpacity(0.1),
            shape: BoxShape.circle,
          ),
          child: IconButton(
            icon: const Icon(Icons.phone, color: Colors.green),
            onPressed: () => _callCustomer(customer?.phone),
          ),
        ),
        const SizedBox(width: 8),
        // Message button
        Container(
          decoration: BoxDecoration(
            color: Colors.blue.withOpacity(0.1),
            shape: BoxShape.circle,
          ),
          child: IconButton(
            icon: const Icon(Icons.message, color: Colors.blue),
            onPressed: () => _messageCustomer(customer?.phone),
          ),
        ),
      ],
    );
  }

  Widget _buildRouteInfo(BuildContext context, TripsState state) {
    // Extract trip data from state
    ActiveTrip? trip;
    if (state is TripsEnRouteToPickup) {
      trip = state.trip;
    } else if (state is TripsArrivedPickup) {
      trip = state.trip;
    } else if (state is TripsInProgress) {
      trip = state.trip;
    } else if (state is TripsArrivedDropoff) {
      trip = state.trip;
    } else if (state is TripsCollectingCash) {
      trip = state.trip;
    }

    final pickup = trip?.pickupAddress ?? 'Pickup location';
    final dropoff = trip?.dropoffAddress ?? 'Dropoff location';
    final distance = trip?.distanceKm ?? 0.0;
    final fare = trip?.estimatedFare ?? 0.0;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: const BoxDecoration(
                  color: Color(0xFF00A86B),
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  pickup,
                  style: const TextStyle(fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Container(
              width: 2,
              height: 20,
              color: Colors.grey.shade300,
            ),
          ),
          Row(
            children: [
              Container(
                width: 10,
                height: 10,
                decoration: const BoxDecoration(
                  color: Colors.red,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  dropoff,
                  style: const TextStyle(fontSize: 13),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Divider(),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              Column(
                children: [
                  Text(
                    '${distance.toStringAsFixed(1)} km',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                  Text(
                    'Distance',
                    style: TextStyle(
                      color: Colors.grey.shade600,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              Container(
                width: 1,
                height: 30,
                color: Colors.grey.shade300,
              ),
              Column(
                children: [
                  Text(
                    'KES ${fare.toInt()}',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                      color: Theme.of(context).primaryColor,
                    ),
                  ),
                  Text(
                    'Est. Fare',
                    style: TextStyle(
                      color: Colors.grey.shade600,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton(BuildContext context, TripsState state) {
    String text;
    VoidCallback onPressed;
    Color? color;

    if (state is TripsEnRouteToPickup) {
      text = 'Arrived at Pickup';
      onPressed = () {
        context.read<TripsBloc>().add(const ArrivedAtPickup());
      };
    } else if (state is TripsArrivedPickup) {
      text = 'Start Trip';
      onPressed = () {
        context.read<TripsBloc>().add(const TripStarted());
      };
    } else if (state is TripsInProgress) {
      text = 'Complete Trip';
      onPressed = () {
        context.read<TripsBloc>().add(const TripCompleted());
      };
    } else if (state is TripsArrivedDropoff) {
      text = 'Confirm Dropoff';
      onPressed = () {
        context.read<TripsBloc>().add(const TripCompleted());
      };
    } else if (state is TripsCollectingCash) {
      text = 'Cash Collected - KES ${state.trip.estimatedFare.toInt()}';
      color = Colors.green;
      onPressed = () {
        context.read<TripsBloc>().add(
              CashCollected(state.trip.estimatedFare),
            );
      };
    } else {
      text = 'Loading...';
      onPressed = () {};
    }

    return Column(
      children: [
        SizedBox(
          width: double.infinity,
          height: 56,
          child: ElevatedButton(
            onPressed: onPressed,
            style: color != null
                ? ElevatedButton.styleFrom(backgroundColor: color)
                : null,
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
        if (state is! TripsCollectingCash) ...[
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              TextButton.icon(
                onPressed: () => _showIssueReport(context),
                icon: const Icon(Icons.warning_amber, size: 18),
                label: const Text('Report Issue'),
              ),
              if (state is TripsEnRouteToPickup ||
                  state is TripsArrivedPickup)
                TextButton.icon(
                  onPressed: () => _showCancelConfirmation(context),
                  icon: const Icon(Icons.close, size: 18),
                  label: const Text('Cancel'),
                  style: TextButton.styleFrom(foregroundColor: Colors.red),
                ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildTripSummaryDialog(BuildContext context, TripSummary summary) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: const Color(0xFF00A86B).withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.check_circle,
                color: Color(0xFF00A86B),
                size: 40,
              ),
            ),
            const SizedBox(height: 16),
            const Text(
              'Trip Completed!',
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 24),
            _buildSummaryRow('Fare', 'KES ${summary.fare.toInt()}'),
            _buildSummaryRow('Tips', 'KES ${summary.tips.toInt()}'),
            _buildSummaryRow('Bonus', 'KES ${summary.bonus.toInt()}'),
            const Divider(height: 24),
            _buildSummaryRow(
              'Total Earnings',
              'KES ${summary.totalEarnings.toInt()}',
              isTotal: true,
            ),
            const SizedBox(height: 8),
            _buildSummaryRow(
              'Distance',
              '${summary.distanceKm.toStringAsFixed(1)} km',
            ),
            _buildSummaryRow(
              'Duration',
              '${summary.durationMinutes} min',
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.pop(context);
                  context.go(AppRoutes.home);
                },
                child: const Text('Done'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryRow(String label, String value, {bool isTotal = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: isTotal ? 16 : 14,
              fontWeight: isTotal ? FontWeight.bold : FontWeight.normal,
              color: isTotal ? null : Colors.grey.shade600,
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: isTotal ? 18 : 14,
              fontWeight: isTotal ? FontWeight.bold : FontWeight.w500,
              color: isTotal ? const Color(0xFF00A86B) : null,
            ),
          ),
        ],
      ),
    );
  }

  void _callCustomer(String? phone) async {
    if (phone == null) return;
    final uri = Uri(scheme: 'tel', path: phone);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  void _messageCustomer(String? phone) async {
    if (phone == null) return;
    final uri = Uri(scheme: 'sms', path: phone);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    }
  }

  void _showExitConfirmation(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Active Trip'),
        content: const Text(
          'You have an active trip. You cannot leave this screen until the trip is completed or cancelled.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  void _showCancelConfirmation(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel Trip?'),
        content: const Text(
          'Are you sure you want to cancel this trip? This may affect your acceptance rate.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('No'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              context.read<TripsBloc>().add(
                    const TripCancelled('Driver cancelled'),
                  );
              context.go(AppRoutes.home);
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Yes, Cancel'),
          ),
        ],
      ),
    );
  }

  void _showIssueReport(BuildContext context) {
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
              leading: const Icon(Icons.person_off),
              title: const Text('Customer not at pickup'),
              onTap: () {
                Navigator.pop(context);
                context.read<TripsBloc>().add(
                      const ReportIssue(TripIssueType.customerNotFound, ''),
                    );
              },
            ),
            ListTile(
              leading: const Icon(Icons.wrong_location),
              title: const Text('Wrong pickup location'),
              onTap: () {
                Navigator.pop(context);
                context.read<TripsBloc>().add(
                      const ReportIssue(TripIssueType.wrongLocation, ''),
                    );
              },
            ),
            ListTile(
              leading: const Icon(Icons.warning),
              title: const Text('Safety concern'),
              onTap: () {
                Navigator.pop(context);
                context.read<TripsBloc>().add(
                      const ReportIssue(TripIssueType.safetyIssue, ''),
                    );
              },
            ),
            ListTile(
              leading: const Icon(Icons.more_horiz),
              title: const Text('Other issue'),
              onTap: () {
                Navigator.pop(context);
                context.read<TripsBloc>().add(
                      const ReportIssue(TripIssueType.other, ''),
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
