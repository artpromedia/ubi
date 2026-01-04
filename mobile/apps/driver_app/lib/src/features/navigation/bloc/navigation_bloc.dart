import 'dart:async';
import 'dart:math' as math;

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

part 'navigation_event.dart';
part 'navigation_state.dart';

/// BLoC for managing turn-by-turn navigation
class NavigationBloc extends Bloc<NavigationEvent, NavigationState> {
  NavigationBloc() : super(const NavigationIdle()) {
    on<NavigationStarted>(_onStarted);
    on<NavigationLocationUpdated>(_onLocationUpdated);
    on<NavigationRouteUpdated>(_onRouteUpdated);
    on<NavigationRecalculate>(_onRecalculate);
    on<NavigationAlternativeSelected>(_onAlternativeSelected);
    on<NavigationInstructionCompleted>(_onInstructionCompleted);
    on<NavigationVoiceToggled>(_onVoiceToggled);
    on<NavigationArrived>(_onArrived);
    on<NavigationSkipWaypoint>(_onSkipWaypoint);
    on<NavigationStopped>(_onStopped);
    on<NavigationReportIssue>(_onReportIssue);
    on<NavigationReset>(_onReset);
  }

  // ETA update timer
  Timer? _etaTimer;

  // Off-route detection threshold (meters)
  static const double _offRouteThreshold = 50.0;

  // Arrival detection threshold (meters)
  static const double _arrivalThreshold = 30.0;

  // Instruction completion threshold (meters)
  static const double _instructionThreshold = 25.0;

  @override
  Future<void> close() {
    _etaTimer?.cancel();
    return super.close();
  }

  Future<void> _onStarted(
    NavigationStarted event,
    Emitter<NavigationState> emit,
  ) async {
    emit(const NavigationLoading(message: 'Calculating route...'));

    try {
      await Future.delayed(const Duration(milliseconds: 800));

      final destination = NavigationWaypoint(
        id: 'dest-1',
        latitude: event.destinationLatitude,
        longitude: event.destinationLongitude,
        address: event.destinationAddress,
        type: event.destinationType ?? DestinationType.dropoff,
      );

      // Generate mock route
      final routePoints = _generateMockRoute(
        -1.2921, // Start lat
        36.8219, // Start lon
        event.destinationLatitude,
        event.destinationLongitude,
      );

      final instructions = _generateMockInstructions();
      const totalDistance = 5200.0; // 5.2 km
      const totalDuration = 1080; // 18 minutes

      // Generate alternative routes
      final alternativeRoutes = [
        AlternativeRoute(
          index: 0,
          routePoints: routePoints,
          distance: totalDistance,
          duration: totalDuration,
          summary: 'Via Uhuru Highway',
        ),
        AlternativeRoute(
          index: 1,
          routePoints: _generateMockRoute(
            -1.2921,
            36.8219,
            event.destinationLatitude,
            event.destinationLongitude,
          ),
          distance: totalDistance + 800,
          duration: totalDuration - 120, // Faster but longer
          summary: 'Via Mombasa Road',
          hasHighways: true,
        ),
      ];

      emit(NavigationReady(
        destination: destination,
        routePoints: routePoints,
        instructions: instructions,
        totalDistance: totalDistance,
        totalDuration: totalDuration,
        waypoints: event.waypoints,
        alternativeRoutes: alternativeRoutes,
      ));

      // Start navigation immediately
      emit(NavigationActive(
        destination: destination,
        routePoints: routePoints,
        instructions: instructions,
        currentInstructionIndex: 0,
        driverLatitude: -1.2921,
        driverLongitude: 36.8219,
        driverHeading: 45.0,
        distanceToNextManeuver: instructions[0].distance,
        distanceRemaining: totalDistance,
        durationRemaining: totalDuration,
        waypoints: event.waypoints,
        eta: DateTime.now().add(Duration(seconds: totalDuration)),
      ));

      _startEtaUpdates();
    } catch (e) {
      emit(NavigationError(message: 'Failed to calculate route: $e'));
    }
  }

  void _onLocationUpdated(
    NavigationLocationUpdated event,
    Emitter<NavigationState> emit,
  ) {
    final currentState = state;

    if (currentState is NavigationActive) {
      // Calculate distance to destination
      final distanceToDestination = _calculateDistance(
        event.latitude,
        event.longitude,
        currentState.destination.latitude,
        currentState.destination.longitude,
      );

      // Check if arrived at destination
      if (distanceToDestination < _arrivalThreshold) {
        add(const NavigationArrived());
        return;
      }

      // Check if arrived at current waypoint
      if (currentState.hasMoreWaypoints) {
        final currentWaypoint = currentState.currentWaypoint!;
        final distanceToWaypoint = _calculateDistance(
          event.latitude,
          event.longitude,
          currentWaypoint.latitude,
          currentWaypoint.longitude,
        );

        if (distanceToWaypoint < _arrivalThreshold) {
          // Arrived at waypoint
          final updatedWaypoints = List<NavigationWaypoint>.from(currentState.waypoints);
          updatedWaypoints[currentState.currentWaypointIndex] =
              currentWaypoint.copyWith(isCompleted: true);

          emit(NavigationArrivedWaypoint(
            waypoint: currentWaypoint,
            nextDestination: currentState.currentWaypointIndex + 1 < updatedWaypoints.length
                ? updatedWaypoints[currentState.currentWaypointIndex + 1]
                : currentState.destination,
            remainingWaypoints: updatedWaypoints.length - currentState.currentWaypointIndex - 1,
          ));
          return;
        }
      }

      // Check distance to current instruction
      final currentInstruction = currentState.currentInstruction;
      final distanceToInstruction = _calculateDistance(
        event.latitude,
        event.longitude,
        currentInstruction.startLatitude,
        currentInstruction.startLongitude,
      );

      // Check if instruction completed
      if (distanceToInstruction < _instructionThreshold &&
          currentState.currentInstructionIndex < currentState.instructions.length - 1) {
        add(NavigationInstructionCompleted(
          instructionIndex: currentState.currentInstructionIndex,
        ));
      }

      // Check if off route
      final isOffRoute = _isOffRoute(
        event.latitude,
        event.longitude,
        currentState.routePoints,
      );

      if (isOffRoute && !currentState.isOffRoute) {
        // Just went off route - trigger recalculation
        add(const NavigationRecalculate());
        return;
      }

      // Calculate new distance to next maneuver
      final distanceToNextManeuver = _calculateDistanceToInstruction(
        event.latitude,
        event.longitude,
        currentInstruction,
      );

      // Update ETA based on speed
      final newDurationRemaining = _calculateDurationRemaining(
        distanceToDestination,
        event.speed ?? 30.0, // Default 30 km/h
      );

      emit(currentState.copyWith(
        driverLatitude: event.latitude,
        driverLongitude: event.longitude,
        driverHeading: event.heading,
        driverSpeed: event.speed,
        distanceToNextManeuver: distanceToNextManeuver,
        distanceRemaining: distanceToDestination * 1000, // Convert to meters
        durationRemaining: newDurationRemaining,
        isOffRoute: isOffRoute,
        eta: DateTime.now().add(Duration(seconds: newDurationRemaining)),
      ));
    }
  }

  void _onRouteUpdated(
    NavigationRouteUpdated event,
    Emitter<NavigationState> emit,
  ) {
    final currentState = state;

    if (currentState is NavigationActive) {
      emit(currentState.copyWith(
        routePoints: event.routePoints,
        instructions: event.instructions,
        distanceRemaining: event.totalDistance,
        durationRemaining: event.totalDuration,
        currentInstructionIndex: 0,
        isOffRoute: false,
      ));
    }
  }

  Future<void> _onRecalculate(
    NavigationRecalculate event,
    Emitter<NavigationState> emit,
  ) async {
    final currentState = state;

    if (currentState is NavigationActive) {
      emit(NavigationRecalculating(
        driverLatitude: currentState.driverLatitude,
        driverLongitude: currentState.driverLongitude,
        destination: currentState.destination,
        reason: 'Finding better route...',
      ));

      try {
        await Future.delayed(const Duration(seconds: 1));

        // Generate new route from current position
        final newRoutePoints = _generateMockRoute(
          currentState.driverLatitude,
          currentState.driverLongitude,
          currentState.destination.latitude,
          currentState.destination.longitude,
        );

        final newInstructions = _generateMockInstructions();

        emit(NavigationActive(
          destination: currentState.destination,
          routePoints: newRoutePoints,
          instructions: newInstructions,
          currentInstructionIndex: 0,
          driverLatitude: currentState.driverLatitude,
          driverLongitude: currentState.driverLongitude,
          driverHeading: currentState.driverHeading,
          distanceToNextManeuver: newInstructions[0].distance,
          distanceRemaining: currentState.distanceRemaining,
          durationRemaining: currentState.durationRemaining,
          waypoints: currentState.waypoints,
          currentWaypointIndex: currentState.currentWaypointIndex,
          voiceEnabled: currentState.voiceEnabled,
          isOffRoute: false,
          eta: currentState.eta,
        ));
      } catch (e) {
        emit(NavigationError(
          message: 'Failed to recalculate route: $e',
          previousState: currentState,
        ));
      }
    }
  }

  Future<void> _onAlternativeSelected(
    NavigationAlternativeSelected event,
    Emitter<NavigationState> emit,
  ) async {
    final currentState = state;

    if (currentState is NavigationReady) {
      if (event.routeIndex >= 0 &&
          event.routeIndex < currentState.alternativeRoutes.length) {
        final selectedRoute = currentState.alternativeRoutes[event.routeIndex];

        emit(NavigationReady(
          destination: currentState.destination,
          routePoints: selectedRoute.routePoints,
          instructions: currentState.instructions,
          totalDistance: selectedRoute.distance,
          totalDuration: selectedRoute.duration,
          waypoints: currentState.waypoints,
          alternativeRoutes: currentState.alternativeRoutes,
        ));
      }
    }
  }

  void _onInstructionCompleted(
    NavigationInstructionCompleted event,
    Emitter<NavigationState> emit,
  ) {
    final currentState = state;

    if (currentState is NavigationActive) {
      final newIndex = event.instructionIndex + 1;

      if (newIndex < currentState.instructions.length) {
        // Update instructions list to mark completed
        final updatedInstructions =
            List<NavigationInstruction>.from(currentState.instructions);
        updatedInstructions[event.instructionIndex] =
            currentState.instructions[event.instructionIndex].copyWith(
          isCompleted: true,
        );

        emit(currentState.copyWith(
          instructions: updatedInstructions,
          currentInstructionIndex: newIndex,
          distanceToNextManeuver:
              currentState.instructions[newIndex].distance,
        ));

        // Announce next instruction if voice is enabled
        if (currentState.voiceEnabled) {
          _announceInstruction(currentState.instructions[newIndex]);
        }
      }
    }
  }

  void _onVoiceToggled(
    NavigationVoiceToggled event,
    Emitter<NavigationState> emit,
  ) {
    final currentState = state;

    if (currentState is NavigationActive) {
      emit(currentState.copyWith(voiceEnabled: !currentState.voiceEnabled));
    }
  }

  void _onArrived(
    NavigationArrived event,
    Emitter<NavigationState> emit,
  ) {
    final currentState = state;

    if (currentState is NavigationActive) {
      _etaTimer?.cancel();

      emit(NavigationArrived(
        destination: currentState.destination,
        totalDistance: currentState.distanceRemaining,
        totalDuration: currentState.durationRemaining,
        arrivedAt: DateTime.now(),
      ));
    }
  }

  void _onSkipWaypoint(
    NavigationSkipWaypoint event,
    Emitter<NavigationState> emit,
  ) {
    final currentState = state;

    if (currentState is NavigationActive && currentState.hasMoreWaypoints) {
      emit(currentState.copyWith(
        currentWaypointIndex: currentState.currentWaypointIndex + 1,
      ));

      // Recalculate route to next destination
      add(const NavigationRecalculate());
    }
  }

  void _onStopped(
    NavigationStopped event,
    Emitter<NavigationState> emit,
  ) {
    _etaTimer?.cancel();
    emit(const NavigationIdle());
  }

  Future<void> _onReportIssue(
    NavigationReportIssue event,
    Emitter<NavigationState> emit,
  ) async {
    // Report road issue to backend
    // This is a side effect, doesn't change navigation state
    try {
      await Future.delayed(const Duration(milliseconds: 300));
      // Issue reported
    } catch (e) {
      // Handle error
    }
  }

  void _onReset(
    NavigationReset event,
    Emitter<NavigationState> emit,
  ) {
    _etaTimer?.cancel();
    emit(const NavigationIdle());
  }

  void _startEtaUpdates() {
    _etaTimer?.cancel();
    _etaTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) {
        // Could trigger ETA recalculation based on traffic
      },
    );
  }

  void _announceInstruction(NavigationInstruction instruction) {
    // This would use text-to-speech
    // Using audioplayers package or similar
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

  bool _isOffRoute(
    double lat,
    double lon,
    List<LatLng> routePoints,
  ) {
    // Check minimum distance to any point on route
    double minDistance = double.infinity;

    for (final point in routePoints) {
      final distance = _calculateDistance(lat, lon, point.latitude, point.longitude);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }

    return minDistance * 1000 > _offRouteThreshold; // Convert km to meters
  }

  double _calculateDistanceToInstruction(
    double lat,
    double lon,
    NavigationInstruction instruction,
  ) {
    return _calculateDistance(
          lat,
          lon,
          instruction.startLatitude,
          instruction.startLongitude,
        ) *
        1000; // Convert to meters
  }

  int _calculateDurationRemaining(double distanceKm, double speedKmh) {
    if (speedKmh <= 0) return 9999;
    return (distanceKm / speedKmh * 3600).round();
  }

  List<LatLng> _generateMockRoute(
    double startLat,
    double startLon,
    double endLat,
    double endLon,
  ) {
    final points = <LatLng>[];
    const steps = 20;

    for (var i = 0; i <= steps; i++) {
      final fraction = i / steps;
      points.add(LatLng(
        latitude: startLat + (endLat - startLat) * fraction,
        longitude: startLon + (endLon - startLon) * fraction,
      ));
    }

    return points;
  }

  List<NavigationInstruction> _generateMockInstructions() {
    return [
      const NavigationInstruction(
        index: 0,
        maneuver: ManeuverType.depart,
        instruction: 'Head north on Kenyatta Avenue',
        distance: 200,
        duration: 45,
        startLatitude: -1.2921,
        startLongitude: 36.8219,
        roadName: 'Kenyatta Avenue',
      ),
      const NavigationInstruction(
        index: 1,
        maneuver: ManeuverType.turnRight,
        instruction: 'Turn right onto Uhuru Highway',
        distance: 1500,
        duration: 180,
        startLatitude: -1.2900,
        startLongitude: 36.8219,
        roadName: 'Uhuru Highway',
      ),
      const NavigationInstruction(
        index: 2,
        maneuver: ManeuverType.keepLeft,
        instruction: 'Keep left at the fork',
        distance: 800,
        duration: 120,
        startLatitude: -1.2750,
        startLongitude: 36.8100,
        roadName: 'Uhuru Highway',
      ),
      const NavigationInstruction(
        index: 3,
        maneuver: ManeuverType.turnLeft,
        instruction: 'Turn left onto Waiyaki Way',
        distance: 2000,
        duration: 300,
        startLatitude: -1.2700,
        startLongitude: 36.8050,
        roadName: 'Waiyaki Way',
      ),
      const NavigationInstruction(
        index: 4,
        maneuver: ManeuverType.arrive,
        instruction: 'Arrive at destination on the right',
        distance: 50,
        duration: 15,
        startLatitude: -1.2634,
        startLongitude: 36.8036,
        roadName: 'Destination',
      ),
    ];
  }
}
