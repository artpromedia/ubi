import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:ubi_core/ubi_config.dart';
import 'package:ubi_core/ubi_test_ids.dart';

import '../../../core/router/app_router.dart';
import '../../driver/bloc/driver_bloc.dart';

/// The offer exactly as the server sent it.
///
/// Nothing on this screen is computed locally: the fare is server-signed
/// [Money], the distance and time are the server's strings, and the offer
/// window comes from city config (CLAUDE.md rules 1 and 6).
@immutable
class TripOffer {
  const TripOffer({
    required this.requestId,
    this.riderName,
    this.riderRating,
    this.pickupAddress,
    this.dropoffAddress,
    this.distanceLabel,
    this.etaLabel,
    this.fare,
    this.paymentMethodId,
    this.tripTypeLabel,
  });

  final String requestId;
  final String? riderName;
  final String? riderRating;
  final String? pickupAddress;
  final String? dropoffAddress;
  final String? distanceLabel;
  final String? etaLabel;

  /// Server-computed offer value. The driver app never prices a trip.
  final Money? fare;

  /// Payment method id from city config, e.g. `cash`.
  final String? paymentMethodId;

  final String? tripTypeLabel;
}

/// Trip request page shown when a new trip request comes in.
///
/// The previous version carried a mock rider ("John Doe", 4.8), a Nairobi
/// pickup address, a hard-coded KES 450 fare and an ETA computed as
/// `distance * 3` on the device. All of it is gone: this screen renders what
/// it is given and says so when it has not been given anything.
class TripRequestPage extends StatefulWidget {
  final String requestId;

  /// The offer to render. Null while it is still being fetched.
  final TripOffer? offer;

  /// `offerTtlSec` from city config. Null means we do not know the window, so
  /// no countdown is drawn — the server enforces the deadline regardless.
  final int? offerTtlSeconds;

  const TripRequestPage({
    super.key,
    required this.requestId,
    this.offer,
    this.offerTtlSeconds,
  });

  @override
  State<TripRequestPage> createState() => _TripRequestPageState();
}

class _TripRequestPageState extends State<TripRequestPage>
    with SingleTickerProviderStateMixin {
  late AnimationController _countdownController;
  late final int _totalSeconds = widget.offerTtlSeconds ?? 0;
  late int _remainingSeconds = _totalSeconds;
  Timer? _countdownTimer;

  TripOffer? get _offer => widget.offer;

  String get _customerName => _offer?.riderName ?? 'Rider';
  String get _rating => _offer?.riderRating ?? '-';
  String get _pickupAddress => _offer?.pickupAddress ?? 'Pickup loading';
  String get _dropoffAddress => _offer?.dropoffAddress ?? 'Drop-off loading';
  String get _distanceLabel => _offer?.distanceLabel ?? '-';
  String get _etaLabel => _offer?.etaLabel ?? '-';
  bool get _isCash => _offer?.paymentMethodId == 'cash';
  String get _paymentMethod => _offer?.paymentMethodId ?? 'Payment pending';
  String get _tripType => _offer?.tripTypeLabel ?? 'Trip';

  /// Formats the server's offer value with the city's currency, fraction
  /// digits and locale. No config means no honest way to show an amount.
  String _fareLabel(BuildContext context) {
    final offerFare = _offer?.fare;
    final formatter = context.watch<ConfigCubit>().state.money;
    if (offerFare == null || formatter == null) {
      return '-';
    }
    return formatter.format(offerFare);
  }

  @override
  void initState() {
    super.initState();
    _countdownController = AnimationController(
      vsync: this,
      duration: Duration(seconds: _totalSeconds),
    );
    if (_totalSeconds > 0) {
      _countdownController.forward();
      _startCountdown();
    }
  }

  void _startCountdown() {
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_remainingSeconds > 0) {
        setState(() {
          _remainingSeconds--;
        });
      } else {
        timer.cancel();
        _onTimeout();
      }
    });
  }

  void _onTimeout() {
    context.read<DriverBloc>().add(TripRequestTimedOut(widget.requestId));
    if (mounted) {
      context.pop();
    }
  }

  @override
  void dispose() {
    _countdownController.dispose();
    _countdownTimer?.cancel();
    super.dispose();
  }

  void _acceptRequest() {
    context.read<DriverBloc>().add(TripRequestAccepted(widget.requestId));
    context.go(AppRoutes.activeTrip, extra: widget.requestId);
  }

  void _declineRequest() {
    context.read<DriverBloc>().add(TripRequestDeclined(widget.requestId));
    context.pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black.withOpacity(0.9),
      body: SafeArea(
        child: Column(
          children: [
            // Countdown timer. The window is `offerTtlSec` from city config,
            // never a constant in the app (CLAUDE.md rule 6).
            Padding(
              key: testKey(TestIds.driverOfferCountdown),
              padding: const EdgeInsets.all(24),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  SizedBox(
                    width: 80,
                    height: 80,
                    child: CircularProgressIndicator(
                      value: _totalSeconds == 0
                          ? null
                          : _remainingSeconds / _totalSeconds,
                      strokeWidth: 6,
                      backgroundColor: Colors.grey.shade800,
                      valueColor: AlwaysStoppedAnimation<Color>(
                        _remainingSeconds <= 5 ? Colors.red : Colors.white,
                      ),
                    ),
                  ),
                  Text(
                    _totalSeconds == 0 ? '-' : '$_remainingSeconds',
                    semanticsLabel: _totalSeconds == 0
                        ? 'Offer window unknown'
                        : '$_remainingSeconds seconds left to respond',
                    style: TextStyle(
                      color: _remainingSeconds <= 5 ? Colors.red : Colors.white,
                      fontSize: 32,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),

            // Trip type badge
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: Theme.of(context).primaryColor,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.directions_car,
                    color: Colors.white,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _tripType.toUpperCase(),
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),

            // Main content
            Expanded(
              child: Container(
                width: double.infinity,
                margin: const EdgeInsets.symmetric(horizontal: 16),
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Customer info
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 28,
                          backgroundColor: Colors.grey.shade200,
                          child: const Icon(
                            Icons.person,
                            size: 32,
                            color: Colors.grey,
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _customerName,
                                style: const TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Row(
                                children: [
                                  const Icon(
                                    Icons.star,
                                    size: 16,
                                    color: Colors.amber,
                                  ),
                                  const SizedBox(width: 4),
                                  Text(
                                    _rating,
                                    style: TextStyle(
                                      color: Colors.grey.shade600,
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 6,
                          ),
                          decoration: BoxDecoration(
                            color: _isCash
                                ? Colors.green.withOpacity(0.1)
                                : Colors.blue.withOpacity(0.1),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            _paymentMethod,
                            style: TextStyle(
                              color: _isCash
                                  ? Colors.green
                                  : Colors.blue,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),

                    // Route info
                    Container(
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
                                width: 12,
                                height: 12,
                                decoration: const BoxDecoration(
                                  color: Color(0xFF00A86B),
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
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
                                      _pickupAddress,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          Padding(
                            padding: const EdgeInsets.only(left: 5),
                            child: Container(
                              width: 2,
                              height: 32,
                              color: Colors.grey.shade300,
                            ),
                          ),
                          Row(
                            children: [
                              Container(
                                width: 12,
                                height: 12,
                                decoration: const BoxDecoration(
                                  color: Colors.red,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
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
                                      _dropoffAddress,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 24),

                    // Offer economics: distance, time and the server's fare.
                    Row(
                      key: testKey(TestIds.driverOfferEconomics),
                      children: [
                        Expanded(
                          child: _buildStatCard(
                            icon: Icons.route,
                            value: _distanceLabel,
                            label: 'Distance',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _buildStatCard(
                            icon: Icons.schedule,
                            value: _etaLabel,
                            label: 'Est. Time',
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _buildStatCard(
                            icon: Icons.attach_money,
                            value: _fareLabel(context),
                            label: 'Est. Fare',
                            highlight: true,
                          ),
                        ),
                      ],
                    ),

                    const Spacer(),

                    // Action buttons
                    Row(
                      children: [
                        Expanded(
                          child: SizedBox(
                            height: 56,
                            child: OutlinedButton(
                              key: testKey(TestIds.driverOfferDecline),
                              onPressed: _declineRequest,
                              style: OutlinedButton.styleFrom(
                                foregroundColor: Colors.red,
                                side: const BorderSide(color: Colors.red),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(16),
                                ),
                              ),
                              child: const Text(
                                'Decline',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 16),
                        Expanded(
                          flex: 2,
                          child: SizedBox(
                            height: 56,
                            child: ElevatedButton(
                              key: testKey(TestIds.driverOfferAccept),
                              onPressed: _acceptRequest,
                              style: ElevatedButton.styleFrom(
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(16),
                                ),
                              ),
                              child: const Text(
                                'Accept',
                                style: TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildStatCard({
    required IconData icon,
    required String value,
    required String label,
    bool highlight = false,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: highlight
            ? Theme.of(context).primaryColor.withOpacity(0.1)
            : Colors.grey.shade100,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: [
          Icon(
            icon,
            color: highlight ? Theme.of(context).primaryColor : Colors.grey,
            size: 24,
          ),
          const SizedBox(height: 8),
          Text(
            value,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
              color: highlight ? Theme.of(context).primaryColor : null,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: Colors.grey.shade600,
            ),
          ),
        ],
      ),
    );
  }
}
