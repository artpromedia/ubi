import 'dart:async';
import 'dart:math' as math;

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

part 'trips_event.dart';
part 'trips_state.dart';

/// BLoC for managing active trip lifecycle
class TripsBloc extends Bloc<TripsEvent, TripsState> {
  TripsBloc() : super(const TripsInitial()) {
    on<TripsLoadActive>(_onLoadActive);
    on<TripsArrivedAtPickup>(_onArrivedAtPickup);
    on<TripsStarted>(_onStarted);
    on<TripsCompleted>(_onCompleted);
    on<TripsCancelled>(_onCancelled);
    on<TripsLocationUpdated>(_onLocationUpdated);
    on<TripsContactCustomer>(_onContactCustomer);
    on<TripsReportIssue>(_onReportIssue);
    on<TripsAddStop>(_onAddStop);
    on<TripsSkipStop>(_onSkipStop);
    on<TripsRouteUpdated>(_onRouteUpdated);
    on<TripsCollectCash>(_onCollectCash);
    on<TripsReset>(_onReset);
  }

  // Location stream subscription
  StreamSubscription<dynamic>? _locationSubscription;

  // ETA update timer
  Timer? _etaTimer;

  @override
  Future<void> close() {
    _locationSubscription?.cancel();
    _etaTimer?.cancel();
    return super.close();
  }

  Future<void> _onLoadActive(
    TripsLoadActive event,
    Emitter<TripsState> emit,
  ) async {
    emit(const TripsLoading(message: 'Loading trip...'));

    try {
      // Load trip from API
      await Future.delayed(const Duration(milliseconds: 500));

      // Mock trip data
      final trip = ActiveTrip(
        id: event.tripId,
        type: 'ride',
        stage: TripStage.enRouteToPickup,
        stops: [
          const TripStop(
            id: 'stop-1',
            address: 'Westlands Mall, Nairobi',
            latitude: -1.2634,
            longitude: 36.8036,
            type: StopType.pickup,
          ),
          const TripStop(
            id: 'stop-2',
            address: 'JKIA Terminal 1A, Nairobi',
            latitude: -1.3192,
            longitude: 36.9275,
            type: StopType.dropoff,
          ),
        ],
        currentStopIndex: 0,
        fare: 850.0,
        paymentMethod: 'card',
        startedAt: DateTime.now(),
        customer: const CustomerInfo(
          id: 'customer-1',
          name: 'John Doe',
          phoneNumber: '+254712345678',
          rating: 4.8,
        ),
        distanceRemaining: 8.5,
        durationRemaining: 25,
        routePoints: _generateMockRoute(),
      );

      emit(TripsEnRouteToPickup(
        trip: trip,
        driverLatitude: -1.2921,
        driverLongitude: 36.8219,
      ));

      // Start ETA updates
      _startEtaUpdates();
    } catch (e) {
      emit(TripsError(message: 'Failed to load trip: $e'));
    }
  }

  void _onArrivedAtPickup(
    TripsArrivedAtPickup event,
    Emitter<TripsState> emit,
  ) {
    final currentState = state;

    if (currentState is TripsEnRouteToPickup) {
      // Update trip stage
      final updatedTrip = currentState.trip.copyWith(
        stage: TripStage.arrivedAtPickup,
      );

      emit(TripsArrivedPickup(
        trip: updatedTrip,
        arrivedAt: DateTime.now(),
        driverLatitude: currentState.driverLatitude,
        driverLongitude: currentState.driverLongitude,
      ));
    }
  }

  Future<void> _onStarted(
    TripsStarted event,
    Emitter<TripsState> emit,
  ) async {
    final currentState = state;

    if (currentState is TripsArrivedPickup) {
      emit(const TripsLoading(message: 'Starting trip...'));

      try {
        // Notify API
        await Future.delayed(const Duration(milliseconds: 300));

        // Move to next stop (dropoff)
        final updatedTrip = currentState.trip.copyWith(
          stage: TripStage.inProgress,
          currentStopIndex: 1,
        );

        emit(TripsInProgress(
          trip: updatedTrip,
          driverLatitude: currentState.driverLatitude,
          driverLongitude: currentState.driverLongitude,
        ));
      } catch (e) {
        emit(TripsError(
          message: 'Failed to start trip: $e',
          previousState: currentState,
        ));
      }
    }
  }

  Future<void> _onCompleted(
    TripsCompleted event,
    Emitter<TripsState> emit,
  ) async {
    final currentState = state;
    ActiveTrip? trip;

    if (currentState is TripsInProgress) {
      trip = currentState.trip;
    } else if (currentState is TripsArrivedDropoff) {
      trip = currentState.trip;
    } else if (currentState is TripsCollectingCash) {
      trip = currentState.trip;
    }

    if (trip == null) return;

    emit(const TripsLoading(message: 'Completing trip...'));

    try {
      // Complete trip via API
      await Future.delayed(const Duration(milliseconds: 500));

      final summary = TripSummary(
        tripId: trip.id,
        type: trip.type,
        baseFare: 200.0,
        distanceFare: 450.0,
        timeFare: 150.0,
        tips: 50.0,
        totalFare: trip.fare,
        driverEarnings: trip.fare * 0.8, // 80% to driver
        distance: 8.5,
        duration: 32,
        startTime: trip.startedAt,
        endTime: DateTime.now(),
        customerRating: 5,
      );

      _etaTimer?.cancel();
      _locationSubscription?.cancel();

      emit(TripsComplete(
        tripId: trip.id,
        summary: summary,
      ));
    } catch (e) {
      emit(TripsError(
        message: 'Failed to complete trip: $e',
        previousState: currentState,
      ));
    }
  }

  Future<void> _onCancelled(
    TripsCancelled event,
    Emitter<TripsState> emit,
  ) async {
    final currentState = state;
    String? tripId;

    if (currentState is TripsEnRouteToPickup) {
      tripId = currentState.trip.id;
    } else if (currentState is TripsArrivedPickup) {
      tripId = currentState.trip.id;
    } else if (currentState is TripsInProgress) {
      tripId = currentState.trip.id;
    }

    if (tripId == null) return;

    emit(const TripsLoading(message: 'Cancelling trip...'));

    try {
      // Cancel trip via API
      await Future.delayed(const Duration(milliseconds: 500));

      _etaTimer?.cancel();
      _locationSubscription?.cancel();

      emit(TripsCancelled(
        tripId: tripId,
        reason: event.reason,
        cancellationFee: 50.0, // Potential cancellation fee
      ));
    } catch (e) {
      emit(TripsError(
        message: 'Failed to cancel trip: $e',
        previousState: currentState,
      ));
    }
  }

  void _onLocationUpdated(
    TripsLocationUpdated event,
    Emitter<TripsState> emit,
  ) {
    final currentState = state;

    if (currentState is TripsEnRouteToPickup) {
      // Check if arrived at pickup
      final distanceToPickup = _calculateDistance(
        event.latitude,
        event.longitude,
        currentState.trip.currentStop.latitude,
        currentState.trip.currentStop.longitude,
      );

      if (distanceToPickup < 0.1) {
        // Within 100m
        add(const TripsArrivedAtPickup());
      } else {
        emit(currentState.copyWith(
          driverLatitude: event.latitude,
          driverLongitude: event.longitude,
          driverHeading: event.heading,
        ));
      }
    } else if (currentState is TripsInProgress) {
      // Check if arrived at dropoff
      final distanceToDropoff = _calculateDistance(
        event.latitude,
        event.longitude,
        currentState.trip.currentStop.latitude,
        currentState.trip.currentStop.longitude,
      );

      if (distanceToDropoff < 0.1) {
        // Within 100m
        emit(TripsArrivedDropoff(
          trip: currentState.trip.copyWith(stage: TripStage.arrivedAtDropoff),
          driverLatitude: event.latitude,
          driverLongitude: event.longitude,
        ));
      } else {
        emit(currentState.copyWith(
          driverLatitude: event.latitude,
          driverLongitude: event.longitude,
          driverHeading: event.heading,
          driverSpeed: event.speed,
        ));
      }
    }
  }

  void _onContactCustomer(
    TripsContactCustomer event,
    Emitter<TripsState> emit,
  ) {
    // This would open phone dialer or messaging
    // Implementation depends on platform channel
  }

  Future<void> _onReportIssue(
    TripsReportIssue event,
    Emitter<TripsState> emit,
  ) async {
    // Report issue to backend
    // This is a side effect, doesn't change state
    try {
      await Future.delayed(const Duration(milliseconds: 300));
      // Issue reported successfully
    } catch (e) {
      // Handle error
    }
  }

  void _onAddStop(
    TripsAddStop event,
    Emitter<TripsState> emit,
  ) {
    final currentState = state;

    if (currentState is TripsInProgress) {
      final newStop = TripStop(
        id: 'stop-${currentState.trip.stops.length + 1}',
        address: event.address,
        latitude: event.latitude,
        longitude: event.longitude,
        type: StopType.extra,
      );

      final updatedStops = List<TripStop>.from(currentState.trip.stops)
        ..insert(currentState.trip.currentStopIndex + 1, newStop);

      final updatedTrip = currentState.trip.copyWith(stops: updatedStops);

      emit(currentState.copyWith(trip: updatedTrip));
    }
  }

  void _onSkipStop(
    TripsSkipStop event,
    Emitter<TripsState> emit,
  ) {
    final currentState = state;

    if (currentState is TripsInProgress) {
      if (currentState.trip.isLastStop) return;

      final updatedTrip = currentState.trip.copyWith(
        currentStopIndex: currentState.trip.currentStopIndex + 1,
      );

      emit(currentState.copyWith(trip: updatedTrip));
    }
  }

  void _onRouteUpdated(
    TripsRouteUpdated event,
    Emitter<TripsState> emit,
  ) {
    final currentState = state;

    if (currentState is TripsEnRouteToPickup) {
      final updatedTrip = currentState.trip.copyWith(
        routePoints: event.routePoints,
      );
      emit(currentState.copyWith(trip: updatedTrip));
    } else if (currentState is TripsInProgress) {
      final updatedTrip = currentState.trip.copyWith(
        routePoints: event.routePoints,
      );
      emit(currentState.copyWith(trip: updatedTrip));
    }
  }

  Future<void> _onCollectCash(
    TripsCollectCash event,
    Emitter<TripsState> emit,
  ) async {
    final currentState = state;

    if (currentState is TripsArrivedDropoff ||
        currentState is TripsInProgress ||
        currentState is TripsCollectingCash) {
      // Record cash collection then complete
      try {
        await Future.delayed(const Duration(milliseconds: 300));
        add(const TripsCompleted());
      } catch (e) {
        emit(TripsError(
          message: 'Failed to record payment: $e',
          previousState: currentState,
        ));
      }
    }
  }

  void _onReset(
    TripsReset event,
    Emitter<TripsState> emit,
  ) {
    _etaTimer?.cancel();
    _locationSubscription?.cancel();
    emit(const TripsInitial());
  }

  void _startEtaUpdates() {
    _etaTimer?.cancel();
    _etaTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) {
        // Update ETA from API
        // This would recalculate route and update state
      },
    );
  }

  /// Calculate distance between two points using Haversine formula
  double _calculateDistance(
    double lat1,
    double lon1,
    double lat2,
    double lon2,
  ) {
    const earthRadius = 6371.0; // km

    final dLat = _toRadians(lat2 - lat1);
    final dLon = _toRadians(lon2 - lon1);

    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_toRadians(lat1)) *
            math.cos(_toRadians(lat2)) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);

    final c = 2 * math.asin(math.sqrt(a));

    return earthRadius * c;
  }

  double _toRadians(double degrees) => degrees * math.pi / 180;

  List<LatLng> _generateMockRoute() {
    return const [
      LatLng(latitude: -1.2921, longitude: 36.8219),
      LatLng(latitude: -1.2800, longitude: 36.8100),
      LatLng(latitude: -1.2700, longitude: 36.8050),
      LatLng(latitude: -1.2634, longitude: 36.8036),
    ];
  }
}
