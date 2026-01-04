/// Permission Service
///
/// Handles location permission requests and status checks.
library;

import 'dart:io';

import 'package:geolocator/geolocator.dart';
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
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return LocationPermissionStatus.serviceDisabled;
    }

    // Check permission status
    final permission = await Geolocator.checkPermission();
    return _mapGeolocatorPermission(permission);
  }

  /// Request location permission
  Future<LocationPermissionStatus> requestLocationPermission() async {
    // First check if location services are enabled
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return LocationPermissionStatus.serviceDisabled;
    }

    // Check current permission
    LocationPermission permission = await Geolocator.checkPermission();

    if (permission == LocationPermission.denied) {
      // Request permission
      permission = await Geolocator.requestPermission();
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
    return await Geolocator.isLocationServiceEnabled();
  }

  /// Open device location settings
  Future<bool> openLocationSettings() async {
    return await Geolocator.openLocationSettings();
  }

  /// Open app settings (for permission management)
  Future<bool> openAppSettings() async {
    return await Geolocator.openAppSettings();
  }

  /// Stream location service status changes
  Stream<bool> get serviceStatusStream {
    return Geolocator.getServiceStatusStream().map(
      (status) => status == ServiceStatus.enabled,
    );
  }

  /// Map Geolocator permission to our enum
  LocationPermissionStatus _mapGeolocatorPermission(LocationPermission permission) {
    switch (permission) {
      case LocationPermission.always:
        return LocationPermissionStatus.granted;
      case LocationPermission.whileInUse:
        return LocationPermissionStatus.whileInUse;
      case LocationPermission.denied:
        return LocationPermissionStatus.denied;
      case LocationPermission.deniedForever:
        return LocationPermissionStatus.deniedForever;
      case LocationPermission.unableToDetermine:
        return LocationPermissionStatus.denied;
    }
  }
}
