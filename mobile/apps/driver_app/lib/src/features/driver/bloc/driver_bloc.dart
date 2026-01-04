import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

part 'driver_event.dart';
part 'driver_state.dart';

/// BLoC for managing driver online/offline status and incoming requests
class DriverBloc extends Bloc<DriverEvent, DriverState> {
  DriverBloc() : super(const DriverInitial()) {
    on<DriverInitialized>(_onInitialized);
    on<DriverStatusToggled>(_onStatusToggled);
    on<DriverWentOnline>(_onWentOnline);
    on<DriverWentOffline>(_onWentOffline);
    on<DriverLocationUpdated>(_onLocationUpdated);
    on<DriverProfileLoaded>(_onProfileLoaded);
    on<DriverServiceTypesUpdated>(_onServiceTypesUpdated);
    on<DriverServiceTypeToggled>(_onServiceTypeToggled);
    on<DriverVehicleUpdated>(_onVehicleUpdated);
    on<DriverStatsLoaded>(_onStatsLoaded);
    on<DriverTripRequestReceived>(_onTripRequestReceived);
    on<DriverTripRequestAccepted>(_onTripRequestAccepted);
    on<DriverTripRequestDeclined>(_onTripRequestDeclined);
    on<DriverTripRequestTimedOut>(_onTripRequestTimedOut);
    on<DriverBreakStarted>(_onBreakStarted);
    on<DriverBreakEnded>(_onBreakEnded);
    on<DriverDocumentsChecked>(_onDocumentsChecked);
    on<DriverNotificationPrefsUpdated>(_onNotificationPrefsUpdated);
    on<DriverReset>(_onReset);
  }

  // Location stream subscription
  StreamSubscription<dynamic>? _locationSubscription;

  // Request timeout timer
  Timer? _requestTimer;

  // Stats refresh timer
  Timer? _statsTimer;

  @override
  Future<void> close() {
    _locationSubscription?.cancel();
    _requestTimer?.cancel();
    _statsTimer?.cancel();
    return super.close();
  }

  Future<void> _onInitialized(
    DriverInitialized event,
    Emitter<DriverState> emit,
  ) async {
    emit(const DriverLoading(message: 'Initializing...'));

    try {
      // Load driver profile and stats
      await Future.delayed(const Duration(milliseconds: 500));

      final stats = DriverStats.empty();
      const vehicle = VehicleInfo(
        id: 'vehicle-1',
        make: 'Toyota',
        model: 'Camry',
        year: 2022,
        color: 'White',
        licensePlate: 'KCA 123X',
        vehicleType: 'sedan',
      );

      emit(DriverOffline(
        stats: stats,
        vehicle: vehicle,
        activeServiceTypes: [ServiceType.ride, ServiceType.food],
        documentsValid: true,
      ));
    } catch (e) {
      emit(DriverError(message: 'Failed to initialize: $e'));
    }
  }

  Future<void> _onStatusToggled(
    DriverStatusToggled event,
    Emitter<DriverState> emit,
  ) async {
    final currentState = state;

    if (currentState is DriverOffline) {
      add(const DriverWentOnline());
    } else if (currentState is DriverOnline) {
      add(const DriverWentOffline());
    }
  }

  Future<void> _onWentOnline(
    DriverWentOnline event,
    Emitter<DriverState> emit,
  ) async {
    final currentState = state;
    emit(const DriverLoading(message: 'Going online...'));

    try {
      // Start location updates
      await Future.delayed(const Duration(milliseconds: 500));

      DriverStats? stats;
      VehicleInfo? vehicle;
      List<ServiceType> serviceTypes = [];

      if (currentState is DriverOffline) {
        stats = currentState.stats;
        vehicle = currentState.vehicle;
        serviceTypes = currentState.activeServiceTypes;
      } else if (currentState is DriverOnBreak) {
        stats = currentState.stats;
        vehicle = currentState.vehicle;
      }

      emit(DriverOnline(
        latitude: -1.2921,
        longitude: 36.8219,
        stats: stats,
        vehicle: vehicle,
        activeServiceTypes: serviceTypes,
      ));

      // Start stats refresh timer
      _startStatsRefresh();
    } catch (e) {
      emit(DriverError(
        message: 'Failed to go online: $e',
        previousState: currentState,
      ));
    }
  }

  Future<void> _onWentOffline(
    DriverWentOffline event,
    Emitter<DriverState> emit,
  ) async {
    final currentState = state;
    emit(const DriverLoading(message: 'Going offline...'));

    try {
      // Stop location updates
      _locationSubscription?.cancel();
      _statsTimer?.cancel();
      _requestTimer?.cancel();

      await Future.delayed(const Duration(milliseconds: 300));

      DriverStats? stats;
      VehicleInfo? vehicle;
      List<ServiceType> serviceTypes = [];

      if (currentState is DriverOnline) {
        stats = currentState.stats;
        vehicle = currentState.vehicle;
        serviceTypes = currentState.activeServiceTypes;
      } else if (currentState is DriverBusy) {
        stats = currentState.stats;
        vehicle = currentState.vehicle;
      }

      emit(DriverOffline(
        stats: stats,
        vehicle: vehicle,
        activeServiceTypes: serviceTypes,
        documentsValid: true,
      ));
    } catch (e) {
      emit(DriverError(
        message: 'Failed to go offline: $e',
        previousState: currentState,
      ));
    }
  }

  void _onLocationUpdated(
    DriverLocationUpdated event,
    Emitter<DriverState> emit,
  ) {
    final currentState = state;

    if (currentState is DriverOnline) {
      emit(currentState.copyWith(
        latitude: event.latitude,
        longitude: event.longitude,
        heading: event.heading,
        speed: event.speed,
      ));
    } else if (currentState is DriverBusy) {
      emit(currentState.copyWith(
        latitude: event.latitude,
        longitude: event.longitude,
        heading: event.heading,
        speed: event.speed,
      ));
    } else if (currentState is DriverRequestPending) {
      emit(DriverRequestPending(
        request: currentState.request,
        latitude: event.latitude,
        longitude: event.longitude,
        heading: event.heading,
        speed: event.speed,
        stats: currentState.stats,
        vehicle: currentState.vehicle,
      ));
    }
  }

  Future<void> _onProfileLoaded(
    DriverProfileLoaded event,
    Emitter<DriverState> emit,
  ) async {
    // Reload driver profile
    add(const DriverInitialized());
  }

  void _onServiceTypesUpdated(
    DriverServiceTypesUpdated event,
    Emitter<DriverState> emit,
  ) {
    final currentState = state;

    if (currentState is DriverOffline) {
      emit(DriverOffline(
        stats: currentState.stats,
        vehicle: currentState.vehicle,
        activeServiceTypes: event.serviceTypes,
        documentsValid: currentState.documentsValid,
      ));
    } else if (currentState is DriverOnline) {
      emit(currentState.copyWith(activeServiceTypes: event.serviceTypes));
    }
  }

  void _onServiceTypeToggled(
    DriverServiceTypeToggled event,
    Emitter<DriverState> emit,
  ) {
    final currentState = state;
    List<ServiceType> currentTypes = [];

    if (currentState is DriverOffline) {
      currentTypes = List.from(currentState.activeServiceTypes);
    } else if (currentState is DriverOnline) {
      currentTypes = List.from(currentState.activeServiceTypes);
    }

    if (currentTypes.contains(event.serviceType)) {
      currentTypes.remove(event.serviceType);
    } else {
      currentTypes.add(event.serviceType);
    }

    add(DriverServiceTypesUpdated(serviceTypes: currentTypes));
  }

  void _onVehicleUpdated(
    DriverVehicleUpdated event,
    Emitter<DriverState> emit,
  ) {
    final currentState = state;

    if (currentState is DriverOffline) {
      emit(DriverOffline(
        stats: currentState.stats,
        vehicle: event.vehicle,
        activeServiceTypes: currentState.activeServiceTypes,
        documentsValid: currentState.documentsValid,
      ));
    } else if (currentState is DriverOnline) {
      emit(currentState.copyWith(vehicle: event.vehicle));
    }
  }

  Future<void> _onStatsLoaded(
    DriverStatsLoaded event,
    Emitter<DriverState> emit,
  ) async {
    final currentState = state;

    try {
      // Load stats from API
      await Future.delayed(const Duration(milliseconds: 300));

      // Mock stats
      const stats = DriverStats(
        todayTrips: 8,
        todayEarnings: 2450.0,
        todayHoursOnline: 5.5,
        acceptanceRate: 92.5,
        cancellationRate: 2.1,
        rating: 4.85,
      );

      if (currentState is DriverOffline) {
        emit(DriverOffline(
          stats: stats,
          vehicle: currentState.vehicle,
          activeServiceTypes: currentState.activeServiceTypes,
          documentsValid: currentState.documentsValid,
        ));
      } else if (currentState is DriverOnline) {
        emit(currentState.copyWith(stats: stats));
      } else if (currentState is DriverBusy) {
        emit(currentState.copyWith(stats: stats));
      }
    } catch (e) {
      // Stats loading failed, keep current state
    }
  }

  void _onTripRequestReceived(
    DriverTripRequestReceived event,
    Emitter<DriverState> emit,
  ) {
    final currentState = state;

    if (currentState is DriverOnline) {
      emit(DriverRequestPending(
        request: event.request,
        latitude: currentState.latitude,
        longitude: currentState.longitude,
        heading: currentState.heading,
        speed: currentState.speed,
        stats: currentState.stats,
        vehicle: currentState.vehicle,
      ));

      // Start timeout timer
      _startRequestTimer(event.request);
    }
  }

  Future<void> _onTripRequestAccepted(
    DriverTripRequestAccepted event,
    Emitter<DriverState> emit,
  ) async {
    final currentState = state;
    _requestTimer?.cancel();

    if (currentState is DriverRequestPending) {
      emit(const DriverLoading(message: 'Accepting request...'));

      try {
        // Accept request via API
        await Future.delayed(const Duration(milliseconds: 500));

        emit(DriverBusy(
          tripId: event.requestId,
          tripType: currentState.request.type,
          latitude: currentState.latitude,
          longitude: currentState.longitude,
          heading: currentState.heading,
          speed: currentState.speed,
          stats: currentState.stats,
          vehicle: currentState.vehicle,
        ));
      } catch (e) {
        emit(DriverError(
          message: 'Failed to accept request: $e',
          previousState: currentState,
        ));
      }
    }
  }

  Future<void> _onTripRequestDeclined(
    DriverTripRequestDeclined event,
    Emitter<DriverState> emit,
  ) async {
    final currentState = state;
    _requestTimer?.cancel();

    if (currentState is DriverRequestPending) {
      emit(const DriverLoading(message: 'Declining request...'));

      try {
        // Decline request via API
        await Future.delayed(const Duration(milliseconds: 300));

        emit(DriverOnline(
          latitude: currentState.latitude,
          longitude: currentState.longitude,
          heading: currentState.heading,
          speed: currentState.speed,
          stats: currentState.stats,
          vehicle: currentState.vehicle,
          activeServiceTypes: [ServiceType.ride, ServiceType.food],
        ));
      } catch (e) {
        emit(DriverError(
          message: 'Failed to decline request: $e',
          previousState: currentState,
        ));
      }
    }
  }

  void _onTripRequestTimedOut(
    DriverTripRequestTimedOut event,
    Emitter<DriverState> emit,
  ) {
    final currentState = state;
    _requestTimer?.cancel();

    if (currentState is DriverRequestPending) {
      emit(DriverOnline(
        latitude: currentState.latitude,
        longitude: currentState.longitude,
        heading: currentState.heading,
        speed: currentState.speed,
        stats: currentState.stats,
        vehicle: currentState.vehicle,
        activeServiceTypes: [ServiceType.ride, ServiceType.food],
      ));
    }
  }

  void _onBreakStarted(
    DriverBreakStarted event,
    Emitter<DriverState> emit,
  ) {
    final currentState = state;
    _locationSubscription?.cancel();
    _statsTimer?.cancel();

    DriverStats? stats;
    VehicleInfo? vehicle;

    if (currentState is DriverOnline) {
      stats = currentState.stats;
      vehicle = currentState.vehicle;
    }

    emit(DriverOnBreak(
      breakStartedAt: DateTime.now(),
      stats: stats,
      vehicle: vehicle,
    ));
  }

  void _onBreakEnded(
    DriverBreakEnded event,
    Emitter<DriverState> emit,
  ) {
    final currentState = state;

    if (currentState is DriverOnBreak) {
      add(const DriverWentOnline());
    }
  }

  Future<void> _onDocumentsChecked(
    DriverDocumentsChecked event,
    Emitter<DriverState> emit,
  ) async {
    final currentState = state;

    // Check document validity via API
    await Future.delayed(const Duration(milliseconds: 300));

    if (currentState is DriverOffline) {
      emit(DriverOffline(
        stats: currentState.stats,
        vehicle: currentState.vehicle,
        activeServiceTypes: currentState.activeServiceTypes,
        documentsValid: true, // From API response
      ));
    }
  }

  void _onNotificationPrefsUpdated(
    DriverNotificationPrefsUpdated event,
    Emitter<DriverState> emit,
  ) {
    // Update local notification preferences
    // This would typically be stored in SharedPreferences
  }

  void _onReset(
    DriverReset event,
    Emitter<DriverState> emit,
  ) {
    _locationSubscription?.cancel();
    _requestTimer?.cancel();
    _statsTimer?.cancel();
    emit(const DriverInitial());
  }

  void _startRequestTimer(TripRequest request) {
    _requestTimer?.cancel();
    _requestTimer = Timer(
      Duration(seconds: request.secondsRemaining),
      () => add(DriverTripRequestTimedOut(requestId: request.id)),
    );
  }

  void _startStatsRefresh() {
    _statsTimer?.cancel();
    _statsTimer = Timer.periodic(
      const Duration(minutes: 5),
      (_) => add(const DriverStatsLoaded()),
    );
  }
}
