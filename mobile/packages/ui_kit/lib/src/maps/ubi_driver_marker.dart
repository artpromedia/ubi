import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../theme/ubi_colors.dart';

/// UBI Driver Marker
///
/// A specialized animated marker for displaying driver locations on the map.
/// Features:
/// - Smooth position animations for real-time updates
/// - Rotation based on driver heading
/// - Vehicle type customization
/// - Pulse animation for nearby drivers
///
/// Example:
/// ```dart
/// final marker = await UbiDriverMarker.create(
///   driverId: 'driver_123',
///   position: LatLng(-1.2921, 36.8219),
///   heading: 45.0,
///   vehicleType: 'ubi_x',
///   isNearby: true,
/// );
/// ```
class UbiDriverMarker {
  UbiDriverMarker._();

  static final Map<String, BitmapDescriptor> _iconCache = {};

  /// Create a driver marker
  static Future<Marker> create({
    required String driverId,
    required LatLng position,
    required double heading,
    String? vehicleType,
    bool isNearby = false,
    bool isSelected = false,
    VoidCallback? onTap,
    String? driverName,
    double? rating,
    String? eta,
  }) async {
    final icon = await _getDriverIcon(
      vehicleType: vehicleType,
      isNearby: isNearby,
      isSelected: isSelected,
    );

    return Marker(
      markerId: MarkerId('driver_$driverId'),
      position: position,
      icon: icon,
      rotation: heading,
      anchor: const Offset(0.5, 0.5),
      flat: true,
      zIndex: isSelected ? 3.0 : 2.0,
      onTap: onTap,
      infoWindow: driverName != null
          ? InfoWindow(
              title: driverName,
              snippet: _buildSnippet(rating: rating, eta: eta),
            )
          : InfoWindow.noText,
    );
  }

  /// Create multiple driver markers
  static Future<Set<Marker>> createMultiple(
    List<DriverMarkerData> drivers, {
    String? selectedDriverId,
    void Function(String driverId)? onDriverTap,
  }) async {
    final markers = <Marker>[];

    for (final driver in drivers) {
      final marker = await create(
        driverId: driver.id,
        position: driver.position,
        heading: driver.heading,
        vehicleType: driver.vehicleType,
        isNearby: driver.isNearby,
        isSelected: driver.id == selectedDriverId,
        driverName: driver.name,
        rating: driver.rating,
        eta: driver.eta,
        onTap: onDriverTap != null ? () => onDriverTap(driver.id) : null,
      );
      markers.add(marker);
    }

    return markers.toSet();
  }

  /// Get cached driver icon or create new one
  static Future<BitmapDescriptor> _getDriverIcon({
    String? vehicleType,
    bool isNearby = false,
    bool isSelected = false,
  }) async {
    final cacheKey = 'driver_${vehicleType ?? 'default'}_$isNearby\_$isSelected';

    if (_iconCache.containsKey(cacheKey)) {
      return _iconCache[cacheKey]!;
    }

    final icon = await _createDriverBitmap(
      vehicleType: vehicleType,
      isNearby: isNearby,
      isSelected: isSelected,
    );
    _iconCache[cacheKey] = icon;
    return icon;
  }

  /// Create driver marker bitmap
  static Future<BitmapDescriptor> _createDriverBitmap({
    String? vehicleType,
    bool isNearby = false,
    bool isSelected = false,
  }) async {
    final pictureRecorder = ui.PictureRecorder();
    final canvas = Canvas(pictureRecorder);
    final paint = Paint()..isAntiAlias = true;

    const size = 56.0;
    const center = Offset(size / 2, size / 2);

    // Draw outer ring for selected/nearby state
    if (isSelected || isNearby) {
      paint.color = isSelected
          ? UbiColors.ubiGreen.withValues(alpha: 0.3)
          : UbiColors.ubiGreen.withValues(alpha: 0.15);
      canvas.drawCircle(center, 26, paint);
    }

    // Draw shadow
    paint
      ..color = Colors.black.withValues(alpha: 0.25)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3);
    canvas.drawCircle(Offset(center.dx, center.dy + 2), 18, paint);

    // Draw main circle background
    paint
      ..color = isSelected ? UbiColors.ubiGreen : UbiColors.ubiBlack
      ..maskFilter = null;
    canvas.drawCircle(center, 18, paint);

    // Draw white inner circle
    paint.color = Colors.white;
    canvas.drawCircle(center, 14, paint);

    // Draw vehicle icon
    final iconData = _getVehicleIcon(vehicleType);
    final iconPainter = TextPainter(
      text: TextSpan(
        text: String.fromCharCode(iconData.codePoint),
        style: TextStyle(
          fontSize: 16,
          color: isSelected ? UbiColors.ubiGreen : UbiColors.ubiBlack,
          fontFamily: iconData.fontFamily,
        ),
      ),
      textDirection: TextDirection.ltr,
    );
    iconPainter.layout();
    iconPainter.paint(
      canvas,
      Offset(
        center.dx - iconPainter.width / 2,
        center.dy - iconPainter.height / 2,
      ),
    );

    // Draw direction indicator (pointing up)
    paint.color = isSelected ? UbiColors.ubiGreen : UbiColors.ubiBlack;
    final arrowPath = Path()
      ..moveTo(size / 2, 4)
      ..lineTo(size / 2 - 5, 12)
      ..lineTo(size / 2 + 5, 12)
      ..close();
    canvas.drawPath(arrowPath, paint);

    final picture = pictureRecorder.endRecording();
    final image = await picture.toImage(size.toInt(), size.toInt());
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);

    return BitmapDescriptor.bytes(byteData!.buffer.asUint8List());
  }

  /// Get vehicle icon based on type
  static IconData _getVehicleIcon(String? vehicleType) {
    switch (vehicleType?.toLowerCase()) {
      case 'ubi_moto':
      case 'ubimoto':
      case 'moto':
        return Icons.two_wheeler;
      case 'ubi_xl':
      case 'ubixl':
      case 'xl':
        return Icons.airport_shuttle;
      case 'ubi_lux':
      case 'ubilux':
      case 'lux':
        return Icons.local_taxi;
      case 'ubi_comfort':
      case 'ubicomfort':
      case 'comfort':
        return Icons.directions_car;
      case 'ubi_x':
      case 'ubix':
      default:
        return Icons.directions_car;
    }
  }

  /// Build info window snippet
  static String? _buildSnippet({double? rating, String? eta}) {
    final parts = <String>[];
    if (rating != null) {
      parts.add('★ ${rating.toStringAsFixed(1)}');
    }
    if (eta != null) {
      parts.add(eta);
    }
    return parts.isNotEmpty ? parts.join(' • ') : null;
  }

  /// Clear icon cache
  static void clearCache() {
    _iconCache.clear();
  }
}

/// Driver marker data model
class DriverMarkerData {
  const DriverMarkerData({
    required this.id,
    required this.position,
    required this.heading,
    this.vehicleType,
    this.name,
    this.rating,
    this.eta,
    this.isNearby = false,
  });

  /// Driver ID
  final String id;

  /// Current position
  final LatLng position;

  /// Current heading in degrees
  final double heading;

  /// Vehicle type (ubi_x, ubi_comfort, etc.)
  final String? vehicleType;

  /// Driver name
  final String? name;

  /// Driver rating
  final double? rating;

  /// ETA to pickup
  final String? eta;

  /// Whether driver is nearby (within pickup radius)
  final bool isNearby;

  /// Create a copy with updated position and heading
  DriverMarkerData copyWith({
    LatLng? position,
    double? heading,
    bool? isNearby,
    String? eta,
  }) {
    return DriverMarkerData(
      id: id,
      position: position ?? this.position,
      heading: heading ?? this.heading,
      vehicleType: vehicleType,
      name: name,
      rating: rating,
      eta: eta ?? this.eta,
      isNearby: isNearby ?? this.isNearby,
    );
  }
}

/// Interpolates between two positions for smooth animations
LatLng interpolatePosition(LatLng from, LatLng to, double t) {
  return LatLng(
    from.latitude + (to.latitude - from.latitude) * t,
    from.longitude + (to.longitude - from.longitude) * t,
  );
}

/// Interpolates between two headings for smooth rotation
double interpolateHeading(double from, double to, double t) {
  // Handle wrap-around at 360 degrees
  double diff = to - from;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return (from + diff * t) % 360;
}
