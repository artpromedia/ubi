import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../theme/ubi_colors.dart';

/// UBI Route Polyline Types
///
/// Different polyline types used in UBI apps.
enum UbiPolylineType {
  /// Active ride route (UBI Green)
  rideRoute,

  /// Estimated/suggested route (gray dashed)
  estimatedRoute,

  /// Driver's path to pickup
  driverToPickup,

  /// Food delivery route (orange)
  foodDeliveryRoute,

  /// Package delivery route (teal)
  packageDeliveryRoute,

  /// Walking route (dotted)
  walkingRoute,
}

/// UBI Route Polyline Factory
///
/// Creates styled polylines for UBI maps with consistent branding.
///
/// Example:
/// ```dart
/// final polyline = UbiRoutePolyline.create(
///   type: UbiPolylineType.rideRoute,
///   points: routePoints,
///   id: 'main_route',
/// );
/// ```
class UbiRoutePolyline {
  UbiRoutePolyline._();

  /// Create a styled polyline
  static Polyline create({
    required UbiPolylineType type,
    required List<LatLng> points,
    required String id,
    VoidCallback? onTap,
    int zIndex = 0,
  }) {
    final config = _getPolylineConfig(type);

    return Polyline(
      polylineId: PolylineId(id),
      points: points,
      color: config.color,
      width: config.width,
      patterns: config.patterns,
      startCap: config.startCap,
      endCap: config.endCap,
      jointType: JointType.round,
      geodesic: true,
      zIndex: zIndex,
      onTap: onTap,
    );
  }

  /// Create a ride route polyline
  static Polyline rideRoute({
    required List<LatLng> points,
    String id = 'ride_route',
    VoidCallback? onTap,
  }) {
    return create(
      type: UbiPolylineType.rideRoute,
      points: points,
      id: id,
      onTap: onTap,
      zIndex: 1,
    );
  }

  /// Create a driver-to-pickup polyline
  static Polyline driverToPickup({
    required List<LatLng> points,
    String id = 'driver_to_pickup',
    VoidCallback? onTap,
  }) {
    return create(
      type: UbiPolylineType.driverToPickup,
      points: points,
      id: id,
      onTap: onTap,
      zIndex: 2,
    );
  }

  /// Create an estimated route polyline (dashed)
  static Polyline estimatedRoute({
    required List<LatLng> points,
    String id = 'estimated_route',
    VoidCallback? onTap,
  }) {
    return create(
      type: UbiPolylineType.estimatedRoute,
      points: points,
      id: id,
      onTap: onTap,
      zIndex: 0,
    );
  }

  /// Create a food delivery route polyline
  static Polyline foodDeliveryRoute({
    required List<LatLng> points,
    String id = 'food_delivery_route',
    VoidCallback? onTap,
  }) {
    return create(
      type: UbiPolylineType.foodDeliveryRoute,
      points: points,
      id: id,
      onTap: onTap,
      zIndex: 1,
    );
  }

  /// Create a package delivery route polyline
  static Polyline packageDeliveryRoute({
    required List<LatLng> points,
    String id = 'package_delivery_route',
    VoidCallback? onTap,
  }) {
    return create(
      type: UbiPolylineType.packageDeliveryRoute,
      points: points,
      id: id,
      onTap: onTap,
      zIndex: 1,
    );
  }

  /// Create a walking route polyline
  static Polyline walkingRoute({
    required List<LatLng> points,
    String id = 'walking_route',
    VoidCallback? onTap,
  }) {
    return create(
      type: UbiPolylineType.walkingRoute,
      points: points,
      id: id,
      onTap: onTap,
      zIndex: 0,
    );
  }

  /// Get polyline configuration for type
  static _PolylineConfig _getPolylineConfig(UbiPolylineType type) {
    switch (type) {
      case UbiPolylineType.rideRoute:
        return _PolylineConfig(
          color: UbiColors.ubiGreen,
          width: 5,
          patterns: [],
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
        );
      case UbiPolylineType.estimatedRoute:
        return _PolylineConfig(
          color: UbiColors.gray400,
          width: 4,
          patterns: [
            PatternItem.dash(20),
            PatternItem.gap(10),
          ],
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
        );
      case UbiPolylineType.driverToPickup:
        return _PolylineConfig(
          color: UbiColors.ubiGreen.withValues(alpha: 0.7),
          width: 4,
          patterns: [
            PatternItem.dash(15),
            PatternItem.gap(8),
          ],
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
        );
      case UbiPolylineType.foodDeliveryRoute:
        return _PolylineConfig(
          color: UbiColors.ubiBitesColor,
          width: 5,
          patterns: [],
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
        );
      case UbiPolylineType.packageDeliveryRoute:
        return _PolylineConfig(
          color: UbiColors.ubiSendColor,
          width: 5,
          patterns: [],
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
        );
      case UbiPolylineType.walkingRoute:
        return _PolylineConfig(
          color: UbiColors.gray500,
          width: 3,
          patterns: [
            PatternItem.dot,
            PatternItem.gap(8),
          ],
          startCap: Cap.roundCap,
          endCap: Cap.roundCap,
        );
    }
  }
}

/// Internal polyline configuration
class _PolylineConfig {
  const _PolylineConfig({
    required this.color,
    required this.width,
    required this.patterns,
    required this.startCap,
    required this.endCap,
  });

  final Color color;
  final int width;
  final List<PatternItem> patterns;
  final Cap startCap;
  final Cap endCap;
}

/// Utility function to decode Google Polyline encoded string
///
/// The polyline encoding is a lossy compression algorithm that allows
/// you to store a series of coordinates as a single string.
List<LatLng> decodePolyline(String encoded) {
  final List<LatLng> points = [];
  int index = 0;
  int lat = 0;
  int lng = 0;

  while (index < encoded.length) {
    int shift = 0;
    int result = 0;
    int byte;

    // Decode latitude
    do {
      byte = encoded.codeUnitAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

    // Decode longitude
    shift = 0;
    result = 0;
    do {
      byte = encoded.codeUnitAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lng += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);

    points.add(LatLng(lat / 1e5, lng / 1e5));
  }

  return points;
}

/// Utility function to encode coordinates to Google Polyline format
String encodePolyline(List<LatLng> points) {
  final StringBuffer encoded = StringBuffer();

  int prevLat = 0;
  int prevLng = 0;

  for (final point in points) {
    final int lat = (point.latitude * 1e5).round();
    final int lng = (point.longitude * 1e5).round();

    _encodeValue(lat - prevLat, encoded);
    _encodeValue(lng - prevLng, encoded);

    prevLat = lat;
    prevLng = lng;
  }

  return encoded.toString();
}

void _encodeValue(int value, StringBuffer buffer) {
  int v = value < 0 ? ~(value << 1) : (value << 1);

  while (v >= 0x20) {
    buffer.writeCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  buffer.writeCharCode(v + 63);
}

/// Calculate the bounds that encompass all given polyline points
LatLngBounds boundsFromPolyline(List<LatLng> points) {
  if (points.isEmpty) {
    throw ArgumentError('Points list cannot be empty');
  }

  double minLat = points.first.latitude;
  double maxLat = points.first.latitude;
  double minLng = points.first.longitude;
  double maxLng = points.first.longitude;

  for (final point in points) {
    if (point.latitude < minLat) minLat = point.latitude;
    if (point.latitude > maxLat) maxLat = point.latitude;
    if (point.longitude < minLng) minLng = point.longitude;
    if (point.longitude > maxLng) maxLng = point.longitude;
  }

  return LatLngBounds(
    southwest: LatLng(minLat, minLng),
    northeast: LatLng(maxLat, maxLng),
  );
}

/// Calculate the total distance of a polyline in meters
double polylineDistance(List<LatLng> points) {
  if (points.length < 2) return 0;

  double total = 0;
  for (int i = 0; i < points.length - 1; i++) {
    total += _haversineDistance(points[i], points[i + 1]);
  }
  return total;
}

/// Calculate distance between two points using Haversine formula
double _haversineDistance(LatLng p1, LatLng p2) {
  const double earthRadius = 6371000; // meters
  final double dLat = _toRadians(p2.latitude - p1.latitude);
  final double dLng = _toRadians(p2.longitude - p1.longitude);
  final double lat1 = _toRadians(p1.latitude);
  final double lat2 = _toRadians(p2.latitude);

  final double a = _sin(dLat / 2) * _sin(dLat / 2) +
      _cos(lat1) * _cos(lat2) * _sin(dLng / 2) * _sin(dLng / 2);
  final double c = 2 * _atan2(_sqrt(a), _sqrt(1 - a));

  return earthRadius * c;
}

double _toRadians(double degrees) => degrees * 3.14159265359 / 180;
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
