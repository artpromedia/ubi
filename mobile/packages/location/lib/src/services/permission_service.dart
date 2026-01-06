/// Permission Service
///
/// Handles location permission requests and status checks.
library;

import 'dart:io';

import 'package:geolocator/geolocator.dart' as geolocator;
import 'package:injectable/injectable.dart';
import 'package:permission_handler/permission_handler.dart';

/// Permission status result
enum LocationPermissionStatus {
  /// Permission granted
  granted,

  /// Permission denied but can request again
  denied,

  /// Permission denied permanently (user must enable in settings)
  deniedForever,

  /// Location services are disabled on device
  serviceDisabled,

  /// Permission granted only while app is in use
  whileInUse,
}

/// Service for managing location permissions
@lazySingleton
class PermissionService {
  /// Check current location permission status
  Future<LocationPermissionStatus> checkLocationPermission() async {
    // First check if location services are enabled
    final serviceEnabled = await geolocator.Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return LocationPermissionStatus.serviceDisabled;
    }

    // Check permission status
    final permission = await geolocator.Geolocator.checkPermission();
    return _mapGeolocatorPermission(permission);
  }

  /// Request location permission
  Future<LocationPermissionStatus> requestLocationPermission() async {
    // First check if location services are enabled
    final serviceEnabled = await geolocator.Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return LocationPermissionStatus.serviceDisabled;
    }

    // Check current permission
    geolocator.LocationPermission permission = await geolocator.Geolocator.checkPermission();

    if (permission == geolocator.LocationPermission.denied) {
      // Request permission
      permission = await geolocator.Geolocator.requestPermission();
    }

    return _mapGeolocatorPermission(permission);
  }

  /// Request background location permission (for driver app)
  Future<LocationPermissionStatus> requestBackgroundPermission() async {
    // First ensure we have foreground permission
    final foregroundStatus = await requestLocationPermission();
    if (foregroundStatus != LocationPermissionStatus.granted &&
        foregroundStatus != LocationPermissionStatus.whileInUse) {
      return foregroundStatus;
    }

    // Request background permission (Android only)
    if (Platform.isAndroid) {
      final status = await Permission.locationAlways.request();
      if (status.isGranted) {
        return LocationPermissionStatus.granted;
      } else if (status.isPermanentlyDenied) {
        return LocationPermissionStatus.deniedForever;
      } else {
        return LocationPermissionStatus.denied;
      }
    }

    // iOS handles this differently through Info.plist
    return LocationPermissionStatus.granted;
  }

  /// Check if location services are enabled on device
  Future<bool> isLocationServiceEnabled() async {
    return await geolocator.Geolocator.isLocationServiceEnabled();
  }

  /// Open device location settings
  Future<bool> openLocationSettings() async {
    return await geolocator.Geolocator.openLocationSettings();
  }

  /// Open app settings (for permission management)
  Future<bool> openAppSettings() async {
    return await geolocator.Geolocator.openAppSettings();
  }

  /// Stream location service status changes
  Stream<bool> get serviceStatusStream {
    return geolocator.Geolocator.getServiceStatusStream().map(
      (status) => status == geolocator.ServiceStatus.enabled,
    );
  }

  /// Map Geolocator permission to our enum
  LocationPermissionStatus _mapGeolocatorPermission(geolocator.LocationPermission permission) {
    switch (permission) {
      case geolocator.LocationPermission.always:
        return LocationPermissionStatus.granted;
      case geolocator.LocationPermission.whileInUse:
        return LocationPermissionStatus.whileInUse;
      case geolocator.LocationPermission.denied:
        return LocationPermissionStatus.denied;
      case geolocator.LocationPermission.deniedForever:
        return LocationPermissionStatus.deniedForever;
      case geolocator.LocationPermission.unableToDetermine:
        return LocationPermissionStatus.denied;
    }
  }
}
