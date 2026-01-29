import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../theme/ubi_colors.dart';

/// UBI Map Configuration
///
/// Configuration options for the UBI Map component.
class UbiMapConfig {
  const UbiMapConfig({
    this.initialZoom = 15.0,
    this.minZoom = 3.0,
    this.maxZoom = 20.0,
    this.myLocationEnabled = true,
    this.myLocationButtonEnabled = false,
    this.zoomControlsEnabled = false,
    this.compassEnabled = true,
    this.mapToolbarEnabled = false,
    this.trafficEnabled = false,
    this.buildingsEnabled = true,
    this.indoorViewEnabled = false,
    this.rotateGesturesEnabled = true,
    this.scrollGesturesEnabled = true,
    this.tiltGesturesEnabled = true,
    this.zoomGesturesEnabled = true,
  });

  /// Default configuration
  static const UbiMapConfig defaults = UbiMapConfig();

  /// Initial map zoom level
  final double initialZoom;

  /// Minimum zoom level
  final double minZoom;

  /// Maximum zoom level
  final double maxZoom;

  /// Enable user's location dot
  final bool myLocationEnabled;

  /// Show the default "my location" button
  final bool myLocationButtonEnabled;

  /// Show zoom controls
  final bool zoomControlsEnabled;

  /// Show compass when map is rotated
  final bool compassEnabled;

  /// Show map toolbar
  final bool mapToolbarEnabled;

  /// Show traffic overlay
  final bool trafficEnabled;

  /// Show 3D buildings
  final bool buildingsEnabled;

  /// Enable indoor view for supported buildings
  final bool indoorViewEnabled;

  /// Allow rotate gestures
  final bool rotateGesturesEnabled;

  /// Allow scroll/pan gestures
  final bool scrollGesturesEnabled;

  /// Allow tilt gestures
  final bool tiltGesturesEnabled;

  /// Allow zoom gestures
  final bool zoomGesturesEnabled;
}

/// UBI Map
///
/// A customized Google Maps widget for UBI applications.
/// Provides consistent styling and UBI-specific features like:
/// - Dark mode support
/// - Custom UBI map styling
/// - Optimized for African markets with appropriate defaults
///
/// Example:
/// ```dart
/// UbiMap(
///   initialPosition: LatLng(-1.2921, 36.8219), // Nairobi
///   markers: {pickupMarker, dropoffMarker},
///   polylines: {routePolyline},
///   onMapCreated: (controller) => _mapController = controller,
/// )
/// ```
class UbiMap extends StatefulWidget {
  const UbiMap({
    super.key,
    required this.initialPosition,
    this.markers = const {},
    this.polylines = const {},
    this.circles = const {},
    this.polygons = const {},
    this.config = UbiMapConfig.defaults,
    this.onMapCreated,
    this.onCameraMove,
    this.onCameraIdle,
    this.onTap,
    this.onLongPress,
    this.padding = EdgeInsets.zero,
    this.liteModeEnabled = false,
  });

  /// Initial camera position
  final LatLng initialPosition;

  /// Set of markers to display on the map
  final Set<Marker> markers;

  /// Set of polylines to display on the map
  final Set<Polyline> polylines;

  /// Set of circles to display on the map
  final Set<Circle> circles;

  /// Set of polygons to display on the map
  final Set<Polygon> polygons;

  /// Map configuration options
  final UbiMapConfig config;

  /// Callback when map is created
  final void Function(GoogleMapController controller)? onMapCreated;

  /// Callback when camera moves
  final void Function(CameraPosition position)? onCameraMove;

  /// Callback when camera stops moving
  final VoidCallback? onCameraIdle;

  /// Callback when map is tapped
  final void Function(LatLng position)? onTap;

  /// Callback when map is long-pressed
  final void Function(LatLng position)? onLongPress;

  /// Padding for the map
  final EdgeInsets padding;

  /// Enable lite mode for static map display (Android only)
  final bool liteModeEnabled;

  @override
  State<UbiMap> createState() => _UbiMapState();
}

class _UbiMapState extends State<UbiMap> {
  GoogleMapController? _controller;

  @override
  void didUpdateWidget(UbiMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Update map style when theme changes
    if (_controller != null) {
      _updateMapStyle();
    }
  }

  void _onMapCreated(GoogleMapController controller) {
    _controller = controller;
    _updateMapStyle();
    widget.onMapCreated?.call(controller);
  }

  void _updateMapStyle() {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    
    if (isDark) {
      _controller?.setMapStyle(_darkMapStyle);
    } else {
      _controller?.setMapStyle(_lightMapStyle);
    }
  }

  @override
  Widget build(BuildContext context) {
    return GoogleMap(
      initialCameraPosition: CameraPosition(
        target: widget.initialPosition,
        zoom: widget.config.initialZoom,
      ),
      markers: widget.markers,
      polylines: widget.polylines,
      circles: widget.circles,
      polygons: widget.polygons,
      onMapCreated: _onMapCreated,
      onCameraMove: widget.onCameraMove,
      onCameraIdle: widget.onCameraIdle,
      onTap: widget.onTap,
      onLongPress: widget.onLongPress,
      padding: widget.padding,
      liteModeEnabled: widget.liteModeEnabled,
      myLocationEnabled: widget.config.myLocationEnabled,
      myLocationButtonEnabled: widget.config.myLocationButtonEnabled,
      zoomControlsEnabled: widget.config.zoomControlsEnabled,
      compassEnabled: widget.config.compassEnabled,
      mapToolbarEnabled: widget.config.mapToolbarEnabled,
      trafficEnabled: widget.config.trafficEnabled,
      buildingsEnabled: widget.config.buildingsEnabled,
      indoorViewEnabled: widget.config.indoorViewEnabled,
      rotateGesturesEnabled: widget.config.rotateGesturesEnabled,
      scrollGesturesEnabled: widget.config.scrollGesturesEnabled,
      tiltGesturesEnabled: widget.config.tiltGesturesEnabled,
      zoomGesturesEnabled: widget.config.zoomGesturesEnabled,
      minMaxZoomPreference: MinMaxZoomPreference(
        widget.config.minZoom,
        widget.config.maxZoom,
      ),
    );
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }
}

/// Light mode map style - Optimized for UBI brand
const String _lightMapStyle = '''
[
  {
    "featureType": "poi",
    "elementType": "labels",
    "stylers": [{"visibility": "off"}]
  },
  {
    "featureType": "transit",
    "stylers": [{"visibility": "off"}]
  },
  {
    "featureType": "road",
    "elementType": "geometry",
    "stylers": [{"color": "#ffffff"}]
  },
  {
    "featureType": "road",
    "elementType": "geometry.stroke",
    "stylers": [{"color": "#e5e7eb"}]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry",
    "stylers": [{"color": "#f3f4f6"}]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry.stroke",
    "stylers": [{"color": "#d1d5db"}]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [{"color": "#dbeafe"}]
  },
  {
    "featureType": "landscape",
    "elementType": "geometry",
    "stylers": [{"color": "#f9fafb"}]
  },
  {
    "featureType": "landscape.man_made",
    "elementType": "geometry",
    "stylers": [{"color": "#f3f4f6"}]
  }
]
''';

/// Dark mode map style - UBI branded dark theme
const String _darkMapStyle = '''
[
  {
    "elementType": "geometry",
    "stylers": [{"color": "#1f2937"}]
  },
  {
    "elementType": "labels.text.stroke",
    "stylers": [{"color": "#1f2937"}]
  },
  {
    "elementType": "labels.text.fill",
    "stylers": [{"color": "#9ca3af"}]
  },
  {
    "featureType": "poi",
    "elementType": "labels",
    "stylers": [{"visibility": "off"}]
  },
  {
    "featureType": "transit",
    "stylers": [{"visibility": "off"}]
  },
  {
    "featureType": "road",
    "elementType": "geometry",
    "stylers": [{"color": "#374151"}]
  },
  {
    "featureType": "road",
    "elementType": "geometry.stroke",
    "stylers": [{"color": "#4b5563"}]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry",
    "stylers": [{"color": "#4b5563"}]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry.stroke",
    "stylers": [{"color": "#6b7280"}]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [{"color": "#1e3a5f"}]
  },
  {
    "featureType": "landscape",
    "elementType": "geometry",
    "stylers": [{"color": "#1f2937"}]
  },
  {
    "featureType": "landscape.man_made",
    "elementType": "geometry",
    "stylers": [{"color": "#111827"}]
  }
]
''';

/// Extension to help with map controller operations
extension UbiMapControllerExtension on GoogleMapController {
  /// Animate camera to a specific position
  Future<void> animateToPosition(
    LatLng position, {
    double zoom = 15.0,
    double bearing = 0.0,
    double tilt = 0.0,
  }) async {
    await animateCamera(
      CameraUpdate.newCameraPosition(
        CameraPosition(
          target: position,
          zoom: zoom,
          bearing: bearing,
          tilt: tilt,
        ),
      ),
    );
  }

  /// Animate camera to show all given points
  Future<void> animateToFitBounds(
    LatLngBounds bounds, {
    double padding = 50.0,
  }) async {
    await animateCamera(
      CameraUpdate.newLatLngBounds(bounds, padding),
    );
  }

  /// Animate camera to show pickup and dropoff locations
  Future<void> animateToShowRoute({
    required LatLng pickup,
    required LatLng dropoff,
    double padding = 80.0,
  }) async {
    final bounds = LatLngBounds(
      southwest: LatLng(
        pickup.latitude < dropoff.latitude ? pickup.latitude : dropoff.latitude,
        pickup.longitude < dropoff.longitude
            ? pickup.longitude
            : dropoff.longitude,
      ),
      northeast: LatLng(
        pickup.latitude > dropoff.latitude ? pickup.latitude : dropoff.latitude,
        pickup.longitude > dropoff.longitude
            ? pickup.longitude
            : dropoff.longitude,
      ),
    );
    await animateToFitBounds(bounds, padding: padding);
  }
}
