/// Location Service
///
/// Provides location tracking and position updates.
library;

import 'dart:async';

import 'package:geolocator/geolocator.dart' as geo;
import 'package:geolocator/geolocator.dart' show Position, LocationServiceDisabledException, AndroidSettings, ForegroundNotificationConfig, LocationSettings;
import 'package:injectable/injectable.dart';
import 'package:rxdart/rxdart.dart';
import 'package:ubi_core/ubi_core.dart';

import 'permission_service.dart';

/// Location accuracy level
enum LocationAccuracy {
  /// Best accuracy, highest battery usage
  high,

  /// Balanced accuracy and battery
  medium,

  /// Lower accuracy, better battery life
  low,

  /// Lowest accuracy, minimal battery usage
  lowest,
}

/// Location service for tracking device position
@lazySingleton
class LocationService {
  LocationService(this._permissionService);

  final PermissionService _permissionService;

  // Location update stream
  StreamSubscription<Position>? _positionSubscription;
  final _locationController = BehaviorSubject<LocationUpdate>();

  // Last known position
  Position? _lastPosition;

  // Background tracking state
  bool _isBackgroundTrackingActive = false;

  /// Stream of location updates
  Stream<LocationUpdate> get locationStream => _locationController.stream;

  /// Whether background tracking is active
  bool get isBackgroundTrackingActive => _isBackgroundTrackingActive;

  /// Get current location
  Future<Result<GeoLocation>> getCurrentLocation({
    LocationAccuracy accuracy = LocationAccuracy.high,
    Duration timeout = const Duration(seconds: 15),
  }) async {
    try {
      // Check permission
      final permissionStatus = await _permissionService.checkLocationPermission();
      if (permissionStatus == LocationPermissionStatus.serviceDisabled) {
        return Result.failure(const Failure.location(message: 'Location services are disabled'));
      }
      if (permissionStatus == LocationPermissionStatus.denied ||
          permissionStatus == LocationPermissionStatus.deniedForever) {
        return Result.failure(const Failure.location(message: 'Location permission denied'));
      }

      // Get position
      final position = await geo.Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(
          accuracy: _mapAccuracy(accuracy),
          timeLimit: timeout,
        ),
      );

      _lastPosition = position;

      return Result.success(GeoLocation(
        latitude: position.latitude,
        longitude: position.longitude,
        altitude: position.altitude,
        accuracy: position.accuracy,
        heading: position.heading,
        speed: position.speed,
        timestamp: position.timestamp,
      ));
    } on TimeoutException {
      return Result.failure(const Failure.location(message: 'Location request timed out'));
    } on LocationServiceDisabledException {
      return Result.failure(const Failure.location(message: 'Location services are disabled'));
    } catch (e) {
      return Result.failure(Failure.location(message: 'Failed to get location: $e'));
    }
  }

  /// Get last known location (faster, may be stale)
  Future<Result<GeoLocation?>> getLastKnownLocation() async {
    try {
      final position = await geo.Geolocator.getLastKnownPosition();
      if (position == null) {
        return Result.success(null);
      }

      return Result.success(GeoLocation(
        latitude: position.latitude,
        longitude: position.longitude,
        altitude: position.altitude,
        accuracy: position.accuracy,
        heading: position.heading,
        speed: position.speed,
        timestamp: position.timestamp,
      ));
    } catch (e) {
      return Result.failure(Failure.location(message: 'Failed to get last known location: $e'));
    }
  }

  /// Start continuous location updates
  Stream<LocationUpdate> watchLocation({
    LocationAccuracy accuracy = LocationAccuracy.high,
    int distanceFilter = 10, // meters
    Duration? interval,
  }) {
    // Cancel any existing subscription
    _positionSubscription?.cancel();

    final settings = _createLocationSettings(
      accuracy: accuracy,
      distanceFilter: distanceFilter,
      interval: interval,
    );

    _positionSubscription = geo.Geolocator.getPositionStream(
      locationSettings: settings,
    ).listen(
      (position) {
        _lastPosition = position;
        _locationController.add(LocationUpdate(
          location: GeoLocation(
            latitude: position.latitude,
            longitude: position.longitude,
            altitude: position.altitude,
            accuracy: position.accuracy,
            heading: position.heading,
            speed: position.speed,
            timestamp: position.timestamp,
          ),
          timestamp: position.timestamp ?? DateTime.now(),
        ));
      },
      onError: (error) {
        _locationController.addError(error);
      },
    );

    return _locationController.stream;
  }

  /// Start background location tracking (for driver app)
  Future<Result<void>> startBackgroundTracking({
    Duration interval = const Duration(seconds: 10),
    int distanceFilter = 10,
  }) async {
    try {
      // Check background permission
      final permissionStatus = await _permissionService.requestBackgroundPermission();
      if (permissionStatus != LocationPermissionStatus.granted) {
        return Result.failure(const Failure.location(message: 'Background location permission required'));
      }

      // Start tracking
      watchLocation(
        accuracy: LocationAccuracy.high,
        distanceFilter: distanceFilter,
        interval: interval,
      );

      _isBackgroundTrackingActive = true;
      return Result.success(null);
    } catch (e) {
      return Result.failure(Failure.location(message: 'Failed to start background tracking: $e'));
    }
  }

  /// Stop background location tracking
  Future<Result<void>> stopBackgroundTracking() async {
    try {
      _positionSubscription?.cancel();
      _positionSubscription = null;
      _isBackgroundTrackingActive = false;
      return Result.success(null);
    } catch (e) {
      return Result.failure(Failure.location(message: 'Failed to stop background tracking: $e'));
    }
  }

  /// Calculate distance between two points in meters
  double calculateDistance(GeoLocation from, GeoLocation to) {
    return geo.Geolocator.distanceBetween(
      from.latitude,
      from.longitude,
      to.latitude,
      to.longitude,
    );
  }

  /// Calculate bearing between two points in degrees
  double calculateBearing(GeoLocation from, GeoLocation to) {
    return geo.Geolocator.bearingBetween(
      from.latitude,
      from.longitude,
      to.latitude,
      to.longitude,
    );
  }

  /// Dispose resources
  void dispose() {
    _positionSubscription?.cancel();
    _locationController.close();
  }

  /// Map our accuracy enum to Geolocator's
  geo.LocationAccuracy _mapAccuracy(LocationAccuracy accuracy) {
    switch (accuracy) {
      case LocationAccuracy.high:
        return geo.LocationAccuracy.best;
      case LocationAccuracy.medium:
        return geo.LocationAccuracy.medium;
      case LocationAccuracy.low:
        return geo.LocationAccuracy.low;
      case LocationAccuracy.lowest:
        return geo.LocationAccuracy.lowest;
    }
  }

  /// Create platform-specific location settings
  LocationSettings _createLocationSettings({
    required LocationAccuracy accuracy,
    required int distanceFilter,
    Duration? interval,
  }) {
    final geoAccuracy = _mapAccuracy(accuracy);

    // Android-specific settings for better background tracking
    return AndroidSettings(
      accuracy: geoAccuracy,
      distanceFilter: distanceFilter,
      intervalDuration: interval,
      forceLocationManager: false,
      foregroundNotificationConfig: const ForegroundNotificationConfig(
        notificationTitle: 'UBI Location Tracking',
        notificationText: 'Tracking your location for ride/delivery',
        enableWakeLock: true,
      ),
    );
  }
}
