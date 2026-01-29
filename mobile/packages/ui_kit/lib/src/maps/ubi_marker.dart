import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../theme/ubi_colors.dart';

/// UBI Marker Types
///
/// Different marker types used in UBI apps.
enum UbiMarkerType {
  /// Pickup location marker (green)
  pickup,

  /// Dropoff location marker (red)
  dropoff,

  /// Driver location marker
  driver,

  /// Stop location marker (intermediate stops)
  stop,

  /// Restaurant location marker
  restaurant,

  /// User's current location
  userLocation,

  /// Package pickup point
  packagePickup,

  /// Package delivery point
  packageDelivery,

  /// Generic point of interest
  poi,
}

/// UBI Marker Factory
///
/// Creates custom markers for UBI maps with consistent styling.
/// Markers are optimized for visibility on African road conditions
/// and varying screen brightness levels.
///
/// Example:
/// ```dart
/// final marker = await UbiMarkerFactory.createMarker(
///   type: UbiMarkerType.pickup,
///   position: LatLng(-1.2921, 36.8219),
///   id: 'pickup_marker',
/// );
/// ```
class UbiMarkerFactory {
  UbiMarkerFactory._();

  static final Map<String, BitmapDescriptor> _markerCache = {};

  /// Create a marker with UBI styling
  static Future<Marker> createMarker({
    required UbiMarkerType type,
    required LatLng position,
    required String id,
    String? title,
    String? snippet,
    VoidCallback? onTap,
    bool draggable = false,
    void Function(LatLng)? onDragEnd,
    double rotation = 0.0,
    Offset anchor = const Offset(0.5, 1.0),
    bool flat = false,
    double zIndex = 0.0,
  }) async {
    final icon = await _getMarkerIcon(type);

    return Marker(
      markerId: MarkerId(id),
      position: position,
      icon: icon,
      infoWindow: title != null
          ? InfoWindow(title: title, snippet: snippet)
          : InfoWindow.noText,
      onTap: onTap,
      draggable: draggable,
      onDragEnd: onDragEnd,
      rotation: rotation,
      anchor: anchor,
      flat: flat,
      zIndex: zIndex,
    );
  }

  /// Create a driver marker with custom vehicle icon
  static Future<Marker> createDriverMarker({
    required LatLng position,
    required String driverId,
    required double heading,
    String? vehicleType,
    VoidCallback? onTap,
  }) async {
    final icon = await _getDriverIcon(vehicleType);

    return Marker(
      markerId: MarkerId('driver_$driverId'),
      position: position,
      icon: icon,
      rotation: heading,
      anchor: const Offset(0.5, 0.5),
      flat: true,
      zIndex: 2.0,
      onTap: onTap,
    );
  }

  /// Get marker icon for a given type
  static Future<BitmapDescriptor> _getMarkerIcon(UbiMarkerType type) async {
    final cacheKey = type.toString();

    if (_markerCache.containsKey(cacheKey)) {
      return _markerCache[cacheKey]!;
    }

    final icon = await _createMarkerBitmap(type);
    _markerCache[cacheKey] = icon;
    return icon;
  }

  /// Get driver icon for vehicle type
  static Future<BitmapDescriptor> _getDriverIcon(String? vehicleType) async {
    final cacheKey = 'driver_${vehicleType ?? 'default'}';

    if (_markerCache.containsKey(cacheKey)) {
      return _markerCache[cacheKey]!;
    }

    final icon = await _createDriverBitmap(vehicleType);
    _markerCache[cacheKey] = icon;
    return icon;
  }

  /// Create a custom marker bitmap
  static Future<BitmapDescriptor> _createMarkerBitmap(
      UbiMarkerType type) async {
    final config = _getMarkerConfig(type);
    final pictureRecorder = ui.PictureRecorder();
    final canvas = Canvas(pictureRecorder);
    final paint = Paint()..isAntiAlias = true;

    const size = 48.0;
    const pinHeight = 60.0;

    // Draw pin shadow
    paint
      ..color = Colors.black.withValues(alpha: 0.2)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4);
    canvas.drawCircle(
      const Offset(size / 2, pinHeight - 4),
      6,
      paint,
    );

    // Draw pin body
    paint
      ..color = config.color
      ..maskFilter = null;

    final pinPath = Path()
      ..moveTo(size / 2, pinHeight)
      ..lineTo(size / 2 - 12, size / 2 + 4)
      ..arcToPoint(
        Offset(size / 2 + 12, size / 2 + 4),
        radius: const Radius.circular(16),
        largeArc: true,
      )
      ..close();

    canvas.drawPath(pinPath, paint);

    // Draw circle background
    canvas.drawCircle(
      const Offset(size / 2, size / 2 - 4),
      16,
      paint,
    );

    // Draw inner white circle
    paint.color = Colors.white;
    canvas.drawCircle(
      const Offset(size / 2, size / 2 - 4),
      10,
      paint,
    );

    // Draw icon
    paint.color = config.color;
    final iconPainter = TextPainter(
      text: TextSpan(
        text: config.icon,
        style: TextStyle(
          fontSize: 12,
          color: config.color,
          fontFamily: 'MaterialIcons',
        ),
      ),
      textDirection: TextDirection.ltr,
    );
    iconPainter.layout();
    iconPainter.paint(
      canvas,
      Offset(
        (size - iconPainter.width) / 2,
        (size - iconPainter.height) / 2 - 4,
      ),
    );

    final picture = pictureRecorder.endRecording();
    final image =
        await picture.toImage(size.toInt(), pinHeight.toInt());
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);

    return BitmapDescriptor.bytes(byteData!.buffer.asUint8List());
  }

  /// Create a driver marker bitmap
  static Future<BitmapDescriptor> _createDriverBitmap(
      String? vehicleType) async {
    final pictureRecorder = ui.PictureRecorder();
    final canvas = Canvas(pictureRecorder);
    final paint = Paint()..isAntiAlias = true;

    const size = 48.0;

    // Draw shadow
    paint
      ..color = Colors.black.withValues(alpha: 0.3)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 4);
    canvas.drawCircle(
      const Offset(size / 2, size / 2 + 2),
      20,
      paint,
    );

    // Draw outer circle (UBI green)
    paint
      ..color = UbiColors.ubiGreen
      ..maskFilter = null;
    canvas.drawCircle(
      const Offset(size / 2, size / 2),
      20,
      paint,
    );

    // Draw inner circle (white)
    paint.color = Colors.white;
    canvas.drawCircle(
      const Offset(size / 2, size / 2),
      16,
      paint,
    );

    // Draw car icon
    paint.color = UbiColors.ubiBlack;
    final iconPainter = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(Icons.directions_car.codePoint),
        style: TextStyle(
          fontSize: 18,
          color: UbiColors.ubiBlack,
          fontFamily: Icons.directions_car.fontFamily,
        ),
      ),
      textDirection: TextDirection.ltr,
    );
    iconPainter.layout();
    iconPainter.paint(
      canvas,
      Offset(
        (size - iconPainter.width) / 2,
        (size - iconPainter.height) / 2,
      ),
    );

    // Draw direction indicator (arrow pointing up, will be rotated with marker)
    paint.color = UbiColors.ubiGreen;
    final arrowPath = Path()
      ..moveTo(size / 2, 2)
      ..lineTo(size / 2 - 6, 10)
      ..lineTo(size / 2 + 6, 10)
      ..close();
    canvas.drawPath(arrowPath, paint);

    final picture = pictureRecorder.endRecording();
    final image = await picture.toImage(size.toInt(), size.toInt());
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);

    return BitmapDescriptor.bytes(byteData!.buffer.asUint8List());
  }

  /// Get marker configuration for type
  static _MarkerConfig _getMarkerConfig(UbiMarkerType type) {
    switch (type) {
      case UbiMarkerType.pickup:
        return _MarkerConfig(
          color: UbiColors.ubiGreen,
          icon: String.fromCharCode(Icons.trip_origin.codePoint),
        );
      case UbiMarkerType.dropoff:
        return _MarkerConfig(
          color: UbiColors.error,
          icon: String.fromCharCode(Icons.location_on.codePoint),
        );
      case UbiMarkerType.driver:
        return _MarkerConfig(
          color: UbiColors.ubiGreen,
          icon: String.fromCharCode(Icons.directions_car.codePoint),
        );
      case UbiMarkerType.stop:
        return _MarkerConfig(
          color: UbiColors.warning,
          icon: String.fromCharCode(Icons.circle.codePoint),
        );
      case UbiMarkerType.restaurant:
        return _MarkerConfig(
          color: UbiColors.ubiBitesColor,
          icon: String.fromCharCode(Icons.restaurant.codePoint),
        );
      case UbiMarkerType.userLocation:
        return _MarkerConfig(
          color: UbiColors.info,
          icon: String.fromCharCode(Icons.person_pin.codePoint),
        );
      case UbiMarkerType.packagePickup:
        return _MarkerConfig(
          color: UbiColors.ubiSendColor,
          icon: String.fromCharCode(Icons.inventory_2.codePoint),
        );
      case UbiMarkerType.packageDelivery:
        return _MarkerConfig(
          color: UbiColors.ubiSendColor,
          icon: String.fromCharCode(Icons.local_shipping.codePoint),
        );
      case UbiMarkerType.poi:
        return _MarkerConfig(
          color: UbiColors.gray600,
          icon: String.fromCharCode(Icons.place.codePoint),
        );
    }
  }

  /// Clear marker cache (call when theme changes)
  static void clearCache() {
    _markerCache.clear();
  }
}

/// Internal marker configuration
class _MarkerConfig {
  const _MarkerConfig({
    required this.color,
    required this.icon,
  });

  final Color color;
  final String icon;
}

/// Creates a simple pickup marker at the given position
Future<Marker> createPickupMarker({
  required LatLng position,
  String id = 'pickup',
  String? title,
  VoidCallback? onTap,
}) {
  return UbiMarkerFactory.createMarker(
    type: UbiMarkerType.pickup,
    position: position,
    id: id,
    title: title ?? 'Pickup',
    onTap: onTap,
  );
}

/// Creates a simple dropoff marker at the given position
Future<Marker> createDropoffMarker({
  required LatLng position,
  String id = 'dropoff',
  String? title,
  VoidCallback? onTap,
}) {
  return UbiMarkerFactory.createMarker(
    type: UbiMarkerType.dropoff,
    position: position,
    id: id,
    title: title ?? 'Dropoff',
    onTap: onTap,
  );
}

/// Creates a driver marker with rotation based on heading
Future<Marker> createDriverMarker({
  required LatLng position,
  required String driverId,
  required double heading,
  String? vehicleType,
  VoidCallback? onTap,
}) {
  return UbiMarkerFactory.createDriverMarker(
    position: position,
    driverId: driverId,
    heading: heading,
    vehicleType: vehicleType,
    onTap: onTap,
  );
}
