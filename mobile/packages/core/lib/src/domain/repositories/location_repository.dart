/// Location Repository Interface
///
/// Contract for location-related data operations.
library;

import '../../../core.dart';

/// Repository for location operations
abstract class LocationRepository {
  /// Get current user location
  Future<Result<GeoLocation>> getCurrentLocation();

  /// Request location permission
  Future<Result<bool>> requestLocationPermission();

  /// Check location permission status
  Future<Result<bool>> checkLocationPermission();

  /// Check if location services are enabled
  Future<Result<bool>> isLocationServiceEnabled();

  /// Open device location settings
  Future<Result<void>> openLocationSettings();

  /// Get last known location (faster, may be stale)
  Future<Result<GeoLocation?>> getLastKnownLocation();

  /// Search places by query
  Future<Result<List<PlaceSearchResult>>> searchPlaces({
    required String query,
    GeoLocation? biasLocation,
    String? countryCode,
    int limit = 10,
  });

  /// Autocomplete places for input
  Future<Result<List<PlaceSearchResult>>> autocompletePlaces({
    required String input,
    required String sessionToken,
    GeoLocation? location,
    double? radiusMeters,
    String? countryCode,
  });

  /// Get place details
  Future<Result<PlaceDetails>> getPlaceDetails(String placeId);

  /// Reverse geocode coordinates to address
  Future<Result<PlaceDetails>> reverseGeocode({
    required double latitude,
    required double longitude,
  });

  /// Calculate route between two points
  Future<Result<Route>> getRoute({
    required GeoLocation origin,
    required GeoLocation destination,
    List<GeoLocation>? waypoints,
    String? mode, // driving, walking, bicycling
  });

  /// Get distance and duration between points
  Future<Result<DistanceInfo>> getDistanceMatrix({
    required GeoLocation origin,
    required GeoLocation destination,
    String? mode,
  });

  /// Stream continuous location updates
  Stream<LocationUpdate> watchLocation({
    int? distanceFilter,
    Duration? interval,
    bool highAccuracy = true,
  });

  /// Start background location tracking
  Future<Result<void>> startBackgroundTracking({
    Duration interval = const Duration(seconds: 10),
    int distanceFilter = 10,
  });

  /// Stop background location tracking
  Future<Result<void>> stopBackgroundTracking();

  /// Get address from saved place ID
  Future<Result<SavedPlace>> getSavedPlaceById(String placeId);
}

/// Route information between two points
class Route {
  const Route({
    required this.polyline,
    required this.distance,
    required this.duration,
    this.distanceText,
    this.durationText,
    this.steps,
  });

  /// Encoded polyline string
  final String polyline;

  /// Distance in meters
  final double distance;

  /// Duration in seconds
  final double duration;

  /// Human-readable distance
  final String? distanceText;

  /// Human-readable duration
  final String? durationText;

  /// Turn-by-turn directions
  final List<RouteStep>? steps;
}

/// Single step in a route
class RouteStep {
  const RouteStep({
    required this.instruction,
    required this.distance,
    required this.duration,
    this.startLocation,
    this.endLocation,
    this.maneuver,
  });

  final String instruction;
  final double distance; // meters
  final double duration; // seconds
  final GeoLocation? startLocation;
  final GeoLocation? endLocation;
  final String? maneuver;
}

/// Distance information between two points
class DistanceInfo {
  const DistanceInfo({
    required this.distanceMeters,
    required this.durationSeconds,
    this.distanceText,
    this.durationText,
  });

  final double distanceMeters;
  final double durationSeconds;
  final String? distanceText;
  final String? durationText;
}
