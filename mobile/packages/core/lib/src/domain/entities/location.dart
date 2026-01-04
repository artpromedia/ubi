import 'package:freezed_annotation/freezed_annotation.dart';

part 'location.freezed.dart';
part 'location.g.dart';

/// Geographic location
@freezed
class GeoLocation with _$GeoLocation {
  const GeoLocation._();

  const factory GeoLocation({
    required double latitude,
    required double longitude,
    double? altitude,
    double? accuracy,
    double? heading,
    double? speed,
    DateTime? timestamp,
  }) = _GeoLocation;

  factory GeoLocation.fromJson(Map<String, dynamic> json) =>
      _$GeoLocationFromJson(json);

  /// Calculate distance to another location in meters
  double distanceTo(GeoLocation other) {
    const double earthRadius = 6371000; // meters
    final double lat1Rad = latitude * (3.14159265359 / 180);
    final double lat2Rad = other.latitude * (3.14159265359 / 180);
    final double deltaLatRad = (other.latitude - latitude) * (3.14159265359 / 180);
    final double deltaLngRad = (other.longitude - longitude) * (3.14159265359 / 180);

    final double a = _sin(deltaLatRad / 2) * _sin(deltaLatRad / 2) +
        _cos(lat1Rad) * _cos(lat2Rad) * _sin(deltaLngRad / 2) * _sin(deltaLngRad / 2);
    final double c = 2 * _atan2(_sqrt(a), _sqrt(1 - a));

    return earthRadius * c;
  }

  double _sin(double x) => x - (x * x * x) / 6 + (x * x * x * x * x) / 120;
  double _cos(double x) => 1 - (x * x) / 2 + (x * x * x * x) / 24;
  double _sqrt(double x) {
    if (x <= 0) return 0;
    double guess = x / 2;
    for (int i = 0; i < 10; i++) {
      guess = (guess + x / guess) / 2;
    }
    return guess;
  }
  double _atan2(double y, double x) {
    if (x > 0) return _atan(y / x);
    if (x < 0 && y >= 0) return _atan(y / x) + 3.14159265359;
    if (x < 0 && y < 0) return _atan(y / x) - 3.14159265359;
    if (x == 0 && y > 0) return 3.14159265359 / 2;
    if (x == 0 && y < 0) return -3.14159265359 / 2;
    return 0;
  }
  double _atan(double x) => x - (x * x * x) / 3 + (x * x * x * x * x) / 5;

  /// Create a copy with updated timestamp
  GeoLocation withTimestamp() => copyWith(timestamp: DateTime.now());

  /// Format as string for display
  String toDisplayString({int decimals = 6}) {
    return '${latitude.toStringAsFixed(decimals)}, ${longitude.toStringAsFixed(decimals)}';
  }
}

/// Location update stream data
@freezed
class LocationUpdate with _$LocationUpdate {
  const factory LocationUpdate({
    required GeoLocation location,
    required DateTime timestamp,
    String? provider,
    bool? isMocked,
  }) = _LocationUpdate;

  factory LocationUpdate.fromJson(Map<String, dynamic> json) =>
      _$LocationUpdateFromJson(json);
}

/// Bounds for a geographic area
@freezed
class GeoBounds with _$GeoBounds {
  const GeoBounds._();

  const factory GeoBounds({
    required GeoLocation northeast,
    required GeoLocation southwest,
  }) = _GeoBounds;

  factory GeoBounds.fromJson(Map<String, dynamic> json) =>
      _$GeoBoundsFromJson(json);

  /// Get center of bounds
  GeoLocation get center {
    return GeoLocation(
      latitude: (northeast.latitude + southwest.latitude) / 2,
      longitude: (northeast.longitude + southwest.longitude) / 2,
    );
  }

  /// Check if location is within bounds
  bool contains(GeoLocation location) {
    return location.latitude <= northeast.latitude &&
        location.latitude >= southwest.latitude &&
        location.longitude <= northeast.longitude &&
        location.longitude >= southwest.longitude;
  }

  /// Expand bounds to include location
  GeoBounds expandToInclude(GeoLocation location) {
    return GeoBounds(
      northeast: GeoLocation(
        latitude: location.latitude > northeast.latitude
            ? location.latitude
            : northeast.latitude,
        longitude: location.longitude > northeast.longitude
            ? location.longitude
            : northeast.longitude,
      ),
      southwest: GeoLocation(
        latitude: location.latitude < southwest.latitude
            ? location.latitude
            : southwest.latitude,
        longitude: location.longitude < southwest.longitude
            ? location.longitude
            : southwest.longitude,
      ),
    );
  }
}
