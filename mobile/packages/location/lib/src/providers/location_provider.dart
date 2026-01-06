/// Location Provider
///
/// High-level provider that combines location, geocoding, and places services.
library;

import 'package:injectable/injectable.dart';
import 'package:rxdart/rxdart.dart';
import 'package:ubi_core/ubi_core.dart';

import '../services/geocoding_service.dart';
import '../services/location_service.dart';
import '../services/permission_service.dart';
import '../services/places_service.dart';

/// Combines all location-related services into a single provider
@lazySingleton
class LocationProvider {
  LocationProvider({
    required LocationService locationService,
    required PermissionService permissionService,
    required GeocodingService geocodingService,
    required PlacesService placesService,
  })  : _locationService = locationService,
        _permissionService = permissionService,
        _geocodingService = geocodingService,
        _placesService = placesService;

  final LocationService _locationService;
  final PermissionService _permissionService;
  final GeocodingService _geocodingService;
  final PlacesService _placesService;

  // Current location state
  final _currentLocationSubject = BehaviorSubject<GeoLocation?>();
  final _isTrackingSubject = BehaviorSubject<bool>.seeded(false);

  /// Current location stream
  Stream<GeoLocation?> get currentLocationStream => _currentLocationSubject.stream;

  /// Current location (if available)
  GeoLocation? get currentLocation => _currentLocationSubject.valueOrNull;

  /// Whether location tracking is active
  Stream<bool> get isTrackingStream => _isTrackingSubject.stream;

  /// Whether location tracking is currently active
  bool get isTracking => _isTrackingSubject.value;

  // === Permission Methods ===

  /// Check location permission status
  Future<LocationPermissionStatus> checkPermission() {
    return _permissionService.checkLocationPermission();
  }

  /// Request location permission
  Future<LocationPermissionStatus> requestPermission() {
    return _permissionService.requestLocationPermission();
  }

  /// Request background location permission (for driver app)
  Future<LocationPermissionStatus> requestBackgroundPermission() {
    return _permissionService.requestBackgroundPermission();
  }

  /// Check if location services are enabled
  Future<bool> isLocationServiceEnabled() {
    return _permissionService.isLocationServiceEnabled();
  }

  /// Open device location settings
  Future<bool> openLocationSettings() {
    return _permissionService.openLocationSettings();
  }

  /// Open app settings
  Future<bool> openAppSettings() {
    return _permissionService.openAppSettings();
  }

  // === Location Methods ===

  /// Get current location once
  Future<Result<GeoLocation>> getCurrentLocation() async {
    final result = await _locationService.getCurrentLocation();
    if (result.isSuccess && result.dataOrNull != null) {
      _currentLocationSubject.add(result.dataOrNull!);
    }
    return result;
  }

  /// Get last known location (faster, may be stale)
  Future<Result<GeoLocation?>> getLastKnownLocation() {
    return _locationService.getLastKnownLocation();
  }

  /// Start continuous location tracking
  void startTracking({
    LocationAccuracy accuracy = LocationAccuracy.high,
    int distanceFilter = 10,
    Duration? interval,
  }) {
    _locationService
        .watchLocation(
          accuracy: accuracy,
          distanceFilter: distanceFilter,
          interval: interval,
        )
        .listen(
          (update) => _currentLocationSubject.add(update.location),
          onError: (e) => _currentLocationSubject.addError(e),
        );
    _isTrackingSubject.add(true);
  }

  /// Stop location tracking
  void stopTracking() {
    _isTrackingSubject.add(false);
  }

  /// Start background tracking (for driver app)
  Future<Result<void>> startBackgroundTracking({
    Duration interval = const Duration(seconds: 10),
    int distanceFilter = 10,
  }) async {
    final result = await _locationService.startBackgroundTracking(
      interval: interval,
      distanceFilter: distanceFilter,
    );
    if (result.isSuccess) {
      _isTrackingSubject.add(true);
    }
    return result;
  }

  /// Stop background tracking
  Future<Result<void>> stopBackgroundTracking() async {
    final result = await _locationService.stopBackgroundTracking();
    if (result.isSuccess) {
      _isTrackingSubject.add(false);
    }
    return result;
  }

  /// Calculate distance between two locations
  double calculateDistance(GeoLocation from, GeoLocation to) {
    return _locationService.calculateDistance(from, to);
  }

  /// Calculate bearing between two locations
  double calculateBearing(GeoLocation from, GeoLocation to) {
    return _locationService.calculateBearing(from, to);
  }

  // === Geocoding Methods ===

  /// Convert address to coordinates
  Future<Result<GeoLocation>> geocode(String address) {
    return _geocodingService.geocode(address);
  }

  /// Convert coordinates to address
  Future<Result<PlaceDetails>> reverseGeocode({
    required double latitude,
    required double longitude,
  }) {
    return _geocodingService.reverseGeocode(
      latitude: latitude,
      longitude: longitude,
    );
  }

  /// Reverse geocode current location
  Future<Result<PlaceDetails>> reverseGeocodeCurrentLocation() async {
    final location = currentLocation;
    if (location == null) {
      return Result.failure(const Failure.location(message: 'No current location available'));
    }
    return reverseGeocode(
      latitude: location.latitude,
      longitude: location.longitude,
    );
  }

  // === Places Methods ===

  /// Configure places service with API key
  void configurePlaces(PlacesConfig config) {
    _placesService.configure(config);
  }

  /// Search places by query
  Future<Result<List<PlaceSearchResult>>> searchPlaces({
    required String query,
    GeoLocation? location,
    double? radiusMeters,
  }) {
    return _placesService.searchPlaces(
      query: query,
      location: location ?? currentLocation,
      radiusMeters: radiusMeters,
    );
  }

  /// Autocomplete place input
  Future<Result<List<PlaceSearchResult>>> autocompletePlaces({
    required String input,
    required String sessionToken,
    double? radiusMeters,
    String? countryCode,
  }) {
    return _placesService.autocompletePlaces(
      input: input,
      sessionToken: sessionToken,
      location: currentLocation,
      radiusMeters: radiusMeters,
      countryCode: countryCode,
    );
  }

  /// Get place details
  Future<Result<PlaceDetails>> getPlaceDetails(String placeId) {
    return _placesService.getPlaceDetails(placeId);
  }

  /// Get nearby places
  Future<Result<List<PlaceSearchResult>>> getNearbyPlaces({
    required double radiusMeters,
    String? type,
    String? keyword,
  }) async {
    final location = currentLocation;
    if (location == null) {
      return Result.failure(const Failure.location(message: 'No current location available'));
    }
    return _placesService.getNearbyPlaces(
      location: location,
      radiusMeters: radiusMeters,
      type: type,
      keyword: keyword,
    );
  }

  /// Dispose resources
  void dispose() {
    _currentLocationSubject.close();
    _isTrackingSubject.close();
    _locationService.dispose();
    _placesService.dispose();
  }
}
