import 'package:flutter/services.dart';
import 'package:injectable/injectable.dart';

/// Application version information
///
/// Provides version information for the app, including
/// version string, build number, and platform details.
@singleton
class AppVersionService {
  AppVersionService();

  String? _version;
  String? _buildNumber;
  String? _packageName;
  bool _initialized = false;

  /// Initialize version service by reading from native platform
  Future<void> initialize() async {
    if (_initialized) return;

    try {
      final result = await const MethodChannel('ubi/app_info')
          .invokeMethod<Map<dynamic, dynamic>>('getAppInfo');

      if (result != null) {
        _version = result['version'] as String?;
        _buildNumber = result['buildNumber'] as String?;
        _packageName = result['packageName'] as String?;
      }
    } catch (_) {
      // Fallback to defaults if method channel fails
      _version = '1.0.0';
      _buildNumber = '1';
      _packageName = 'com.ubi.rider';
    }

    _initialized = true;
  }

  /// Get app version string (e.g., "1.2.3")
  String get version => _version ?? '1.0.0';

  /// Get build number (e.g., "42")
  String get buildNumber => _buildNumber ?? '1';

  /// Get package name/bundle ID
  String get packageName => _packageName ?? 'com.ubi.rider';

  /// Get full version string (e.g., "1.2.3+42")
  String get fullVersion => '$version+$buildNumber';

  /// Get version for API headers (e.g., "1.2.3")
  String get apiVersion => version;

  /// Get user agent string for API requests
  String get userAgent => 'UBI-Mobile/$version ($packageName; Build/$buildNumber)';

  /// Check if current version is at least the given version
  bool isAtLeast(String minVersion) {
    return _compareVersions(version, minVersion) >= 0;
  }

  /// Compare two version strings
  /// Returns: negative if v1 < v2, positive if v1 > v2, 0 if equal
  int _compareVersions(String v1, String v2) {
    final parts1 = v1.split('.').map((p) => int.tryParse(p) ?? 0).toList();
    final parts2 = v2.split('.').map((p) => int.tryParse(p) ?? 0).toList();

    // Pad shorter version with zeros
    while (parts1.length < parts2.length) {
      parts1.add(0);
    }
    while (parts2.length < parts1.length) {
      parts2.add(0);
    }

    // Compare each part
    for (int i = 0; i < parts1.length; i++) {
      if (parts1[i] < parts2[i]) return -1;
      if (parts1[i] > parts2[i]) return 1;
    }

    return 0;
  }
}

/// Version check result
enum VersionCheckResult {
  /// App is up to date
  upToDate,

  /// Optional update available
  updateAvailable,

  /// Critical update required (app may not function properly)
  updateRequired,
}

/// Version check response from API
class VersionCheckResponse {
  const VersionCheckResponse({
    required this.minimumVersion,
    required this.latestVersion,
    required this.updateUrl,
    this.releaseNotes,
    this.isMaintenanceMode = false,
    this.maintenanceMessage,
  });

  /// Minimum supported version (force update if below)
  final String minimumVersion;

  /// Latest available version
  final String latestVersion;

  /// URL to app store for update
  final String updateUrl;

  /// Release notes for latest version
  final String? releaseNotes;

  /// Whether app is in maintenance mode
  final bool isMaintenanceMode;

  /// Message to show during maintenance
  final String? maintenanceMessage;

  factory VersionCheckResponse.fromJson(Map<String, dynamic> json) {
    return VersionCheckResponse(
      minimumVersion: json['minimum_version'] as String? ?? '1.0.0',
      latestVersion: json['latest_version'] as String? ?? '1.0.0',
      updateUrl: json['update_url'] as String? ?? '',
      releaseNotes: json['release_notes'] as String?,
      isMaintenanceMode: json['is_maintenance_mode'] as bool? ?? false,
      maintenanceMessage: json['maintenance_message'] as String?,
    );
  }
}
