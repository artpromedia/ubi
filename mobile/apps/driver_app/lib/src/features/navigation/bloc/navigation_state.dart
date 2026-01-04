part of 'navigation_bloc.dart';

/// Base class for all navigation states
sealed class NavigationState extends Equatable {
  const NavigationState();

  @override
  List<Object?> get props => [];
}

/// Initial state - not navigating
class NavigationIdle extends NavigationState {
  const NavigationIdle();
}

/// Loading route
class NavigationLoading extends NavigationState {
  const NavigationLoading({this.message});

  final String? message;

  @override
  List<Object?> get props => [message];
}

/// Route loaded, ready to navigate
class NavigationReady extends NavigationState {
  const NavigationReady({
    required this.destination,
    required this.routePoints,
    required this.instructions,
    required this.totalDistance,
    required this.totalDuration,
    this.waypoints = const [],
    this.alternativeRoutes = const [],
    this.voiceEnabled = true,
  });

  final NavigationWaypoint destination;
  final List<LatLng> routePoints;
  final List<NavigationInstruction> instructions;
  final double totalDistance;
  final int totalDuration;
  final List<NavigationWaypoint> waypoints;
  final List<AlternativeRoute> alternativeRoutes;
  final bool voiceEnabled;

  @override
  List<Object?> get props => [
        destination,
        routePoints,
        instructions,
        totalDistance,
        totalDuration,
        waypoints,
        alternativeRoutes,
        voiceEnabled,
      ];
}

/// Actively navigating
class NavigationActive extends NavigationState {
  const NavigationActive({
    required this.destination,
    required this.routePoints,
    required this.instructions,
    required this.currentInstructionIndex,
    required this.driverLatitude,
    required this.driverLongitude,
    required this.driverHeading,
    required this.distanceToNextManeuver,
    required this.distanceRemaining,
    required this.durationRemaining,
    this.driverSpeed,
    this.waypoints = const [],
    this.currentWaypointIndex = 0,
    this.voiceEnabled = true,
    this.isOffRoute = false,
    this.eta,
  });

  final NavigationWaypoint destination;
  final List<LatLng> routePoints;
  final List<NavigationInstruction> instructions;
  final int currentInstructionIndex;
  final double driverLatitude;
  final double driverLongitude;
  final double driverHeading;
  final double distanceToNextManeuver;
  final double distanceRemaining;
  final int durationRemaining;
  final double? driverSpeed;
  final List<NavigationWaypoint> waypoints;
  final int currentWaypointIndex;
  final bool voiceEnabled;
  final bool isOffRoute;
  final DateTime? eta;

  NavigationInstruction get currentInstruction => instructions[currentInstructionIndex];
  NavigationInstruction? get nextInstruction =>
      currentInstructionIndex + 1 < instructions.length
          ? instructions[currentInstructionIndex + 1]
          : null;

  bool get hasMoreWaypoints => currentWaypointIndex < waypoints.length;
  NavigationWaypoint? get currentWaypoint =>
      hasMoreWaypoints ? waypoints[currentWaypointIndex] : null;

  String get distanceRemainingText {
    if (distanceRemaining >= 1000) {
      return '${(distanceRemaining / 1000).toStringAsFixed(1)} km';
    }
    return '${distanceRemaining.round()} m';
  }

  String get durationRemainingText {
    if (durationRemaining >= 3600) {
      final hours = durationRemaining ~/ 3600;
      final minutes = (durationRemaining % 3600) ~/ 60;
      return '$hours h $minutes min';
    }
    return '${durationRemaining ~/ 60} min';
  }

  String get distanceToNextManeuverText {
    if (distanceToNextManeuver >= 1000) {
      return '${(distanceToNextManeuver / 1000).toStringAsFixed(1)} km';
    }
    return '${distanceToNextManeuver.round()} m';
  }

  NavigationActive copyWith({
    NavigationWaypoint? destination,
    List<LatLng>? routePoints,
    List<NavigationInstruction>? instructions,
    int? currentInstructionIndex,
    double? driverLatitude,
    double? driverLongitude,
    double? driverHeading,
    double? distanceToNextManeuver,
    double? distanceRemaining,
    int? durationRemaining,
    double? driverSpeed,
    List<NavigationWaypoint>? waypoints,
    int? currentWaypointIndex,
    bool? voiceEnabled,
    bool? isOffRoute,
    DateTime? eta,
  }) {
    return NavigationActive(
      destination: destination ?? this.destination,
      routePoints: routePoints ?? this.routePoints,
      instructions: instructions ?? this.instructions,
      currentInstructionIndex: currentInstructionIndex ?? this.currentInstructionIndex,
      driverLatitude: driverLatitude ?? this.driverLatitude,
      driverLongitude: driverLongitude ?? this.driverLongitude,
      driverHeading: driverHeading ?? this.driverHeading,
      distanceToNextManeuver: distanceToNextManeuver ?? this.distanceToNextManeuver,
      distanceRemaining: distanceRemaining ?? this.distanceRemaining,
      durationRemaining: durationRemaining ?? this.durationRemaining,
      driverSpeed: driverSpeed ?? this.driverSpeed,
      waypoints: waypoints ?? this.waypoints,
      currentWaypointIndex: currentWaypointIndex ?? this.currentWaypointIndex,
      voiceEnabled: voiceEnabled ?? this.voiceEnabled,
      isOffRoute: isOffRoute ?? this.isOffRoute,
      eta: eta ?? this.eta,
    );
  }

  @override
  List<Object?> get props => [
        destination,
        routePoints,
        instructions,
        currentInstructionIndex,
        driverLatitude,
        driverLongitude,
        driverHeading,
        distanceToNextManeuver,
        distanceRemaining,
        durationRemaining,
        driverSpeed,
        waypoints,
        currentWaypointIndex,
        voiceEnabled,
        isOffRoute,
        eta,
      ];
}

/// Recalculating route
class NavigationRecalculating extends NavigationState {
  const NavigationRecalculating({
    required this.driverLatitude,
    required this.driverLongitude,
    required this.destination,
    this.reason,
  });

  final double driverLatitude;
  final double driverLongitude;
  final NavigationWaypoint destination;
  final String? reason;

  @override
  List<Object?> get props => [driverLatitude, driverLongitude, destination, reason];
}

/// Arrived at waypoint
class NavigationArrivedWaypoint extends NavigationState {
  const NavigationArrivedWaypoint({
    required this.waypoint,
    required this.nextDestination,
    required this.remainingWaypoints,
  });

  final NavigationWaypoint waypoint;
  final NavigationWaypoint? nextDestination;
  final int remainingWaypoints;

  @override
  List<Object?> get props => [waypoint, nextDestination, remainingWaypoints];
}

/// Arrived at final destination
class NavigationArrived extends NavigationState {
  const NavigationArrived({
    required this.destination,
    required this.totalDistance,
    required this.totalDuration,
    required this.arrivedAt,
  });

  final NavigationWaypoint destination;
  final double totalDistance;
  final int totalDuration;
  final DateTime arrivedAt;

  @override
  List<Object?> get props => [destination, totalDistance, totalDuration, arrivedAt];
}

/// Navigation error
class NavigationError extends NavigationState {
  const NavigationError({
    required this.message,
    this.previousState,
  });

  final String message;
  final NavigationState? previousState;

  @override
  List<Object?> get props => [message, previousState];
}
