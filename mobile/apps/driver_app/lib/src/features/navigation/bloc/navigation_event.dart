part of 'navigation_bloc.dart';

/// Base class for all navigation events
sealed class NavigationEvent extends Equatable {
  const NavigationEvent();

  @override
  List<Object?> get props => [];
}

/// Start navigation to destination
class NavigationStarted extends NavigationEvent {
  const NavigationStarted({
    required this.destinationLatitude,
    required this.destinationLongitude,
    required this.destinationAddress,
    this.destinationType,
    this.waypoints = const [],
  });

  final double destinationLatitude;
  final double destinationLongitude;
  final String destinationAddress;
  final DestinationType? destinationType;
  final List<NavigationWaypoint> waypoints;

  @override
  List<Object?> get props => [
        destinationLatitude,
        destinationLongitude,
        destinationAddress,
        destinationType,
        waypoints,
      ];
}

/// Update driver location during navigation
class NavigationLocationUpdated extends NavigationEvent {
  const NavigationLocationUpdated({
    required this.latitude,
    required this.longitude,
    required this.heading,
    this.speed,
    this.accuracy,
  });

  final double latitude;
  final double longitude;
  final double heading;
  final double? speed;
  final double? accuracy;

  @override
  List<Object?> get props => [latitude, longitude, heading, speed, accuracy];
}

/// Route calculated/recalculated
class NavigationRouteUpdated extends NavigationEvent {
  const NavigationRouteUpdated({
    required this.routePoints,
    required this.totalDistance,
    required this.totalDuration,
    required this.instructions,
  });

  final List<LatLng> routePoints;
  final double totalDistance;
  final int totalDuration;
  final List<NavigationInstruction> instructions;

  @override
  List<Object?> get props => [routePoints, totalDistance, totalDuration, instructions];
}

/// Request route recalculation (off route or better route found)
class NavigationRecalculate extends NavigationEvent {
  const NavigationRecalculate({this.avoidTolls, this.avoidHighways});

  final bool? avoidTolls;
  final bool? avoidHighways;

  @override
  List<Object?> get props => [avoidTolls, avoidHighways];
}

/// User selected alternative route
class NavigationAlternativeSelected extends NavigationEvent {
  const NavigationAlternativeSelected({required this.routeIndex});

  final int routeIndex;

  @override
  List<Object?> get props => [routeIndex];
}

/// Completed a navigation instruction
class NavigationInstructionCompleted extends NavigationEvent {
  const NavigationInstructionCompleted({required this.instructionIndex});

  final int instructionIndex;

  @override
  List<Object?> get props => [instructionIndex];
}

/// Toggle voice guidance
class NavigationVoiceToggled extends NavigationEvent {
  const NavigationVoiceToggled();
}

/// Arrived at destination
class NavigationArrived extends NavigationEvent {
  const NavigationArrived();
}

/// Skip current waypoint
class NavigationSkipWaypoint extends NavigationEvent {
  const NavigationSkipWaypoint();
}

/// Stop navigation
class NavigationStopped extends NavigationEvent {
  const NavigationStopped();
}

/// Report traffic/road issue
class NavigationReportIssue extends NavigationEvent {
  const NavigationReportIssue({
    required this.issueType,
    required this.latitude,
    required this.longitude,
  });

  final RoadIssueType issueType;
  final double latitude;
  final double longitude;

  @override
  List<Object?> get props => [issueType, latitude, longitude];
}

/// Reset navigation state
class NavigationReset extends NavigationEvent {
  const NavigationReset();
}

// Enums
enum DestinationType { pickup, dropoff, waypoint, restaurant, deliveryAddress }

enum RoadIssueType {
  heavyTraffic,
  accident,
  roadClosed,
  construction,
  hazard,
  policeCheckpoint,
}

enum ManeuverType {
  depart,
  turnLeft,
  turnRight,
  turnSlightLeft,
  turnSlightRight,
  turnSharpLeft,
  turnSharpRight,
  uturn,
  keepLeft,
  keepRight,
  merge,
  exitLeft,
  exitRight,
  ramp,
  roundaboutLeft,
  roundaboutRight,
  arrive,
  continueOnRoute,
  ferry,
}

// Models
class LatLng extends Equatable {
  const LatLng({required this.latitude, required this.longitude});

  final double latitude;
  final double longitude;

  @override
  List<Object?> get props => [latitude, longitude];
}

class NavigationWaypoint extends Equatable {
  const NavigationWaypoint({
    required this.id,
    required this.latitude,
    required this.longitude,
    required this.address,
    this.type = DestinationType.waypoint,
    this.isCompleted = false,
  });

  final String id;
  final double latitude;
  final double longitude;
  final String address;
  final DestinationType type;
  final bool isCompleted;

  NavigationWaypoint copyWith({
    String? id,
    double? latitude,
    double? longitude,
    String? address,
    DestinationType? type,
    bool? isCompleted,
  }) {
    return NavigationWaypoint(
      id: id ?? this.id,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      address: address ?? this.address,
      type: type ?? this.type,
      isCompleted: isCompleted ?? this.isCompleted,
    );
  }

  @override
  List<Object?> get props => [id, latitude, longitude, address, type, isCompleted];
}

class NavigationInstruction extends Equatable {
  const NavigationInstruction({
    required this.index,
    required this.maneuver,
    required this.instruction,
    required this.distance,
    required this.duration,
    required this.startLatitude,
    required this.startLongitude,
    this.roadName,
    this.exitNumber,
    this.isCompleted = false,
  });

  final int index;
  final ManeuverType maneuver;
  final String instruction;
  final double distance; // meters
  final int duration; // seconds
  final double startLatitude;
  final double startLongitude;
  final String? roadName;
  final int? exitNumber;
  final bool isCompleted;

  String get distanceText {
    if (distance >= 1000) {
      return '${(distance / 1000).toStringAsFixed(1)} km';
    }
    return '${distance.round()} m';
  }

  NavigationInstruction copyWith({
    int? index,
    ManeuverType? maneuver,
    String? instruction,
    double? distance,
    int? duration,
    double? startLatitude,
    double? startLongitude,
    String? roadName,
    int? exitNumber,
    bool? isCompleted,
  }) {
    return NavigationInstruction(
      index: index ?? this.index,
      maneuver: maneuver ?? this.maneuver,
      instruction: instruction ?? this.instruction,
      distance: distance ?? this.distance,
      duration: duration ?? this.duration,
      startLatitude: startLatitude ?? this.startLatitude,
      startLongitude: startLongitude ?? this.startLongitude,
      roadName: roadName ?? this.roadName,
      exitNumber: exitNumber ?? this.exitNumber,
      isCompleted: isCompleted ?? this.isCompleted,
    );
  }

  @override
  List<Object?> get props => [
        index,
        maneuver,
        instruction,
        distance,
        duration,
        startLatitude,
        startLongitude,
        roadName,
        exitNumber,
        isCompleted,
      ];
}

class AlternativeRoute extends Equatable {
  const AlternativeRoute({
    required this.index,
    required this.routePoints,
    required this.distance,
    required this.duration,
    required this.summary,
    this.hasTolls = false,
    this.hasHighways = true,
  });

  final int index;
  final List<LatLng> routePoints;
  final double distance;
  final int duration;
  final String summary;
  final bool hasTolls;
  final bool hasHighways;

  String get distanceText {
    if (distance >= 1000) {
      return '${(distance / 1000).toStringAsFixed(1)} km';
    }
    return '${distance.round()} m';
  }

  String get durationText {
    if (duration >= 3600) {
      final hours = duration ~/ 3600;
      final minutes = (duration % 3600) ~/ 60;
      return '$hours h $minutes min';
    }
    return '${duration ~/ 60} min';
  }

  @override
  List<Object?> get props => [
        index,
        routePoints,
        distance,
        duration,
        summary,
        hasTolls,
        hasHighways,
      ];
}
