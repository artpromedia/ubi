import 'dart:io';

import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';
import 'package:local_auth/error_codes.dart' as auth_error;

/// Types of biometric authentication available (our app's representation)
enum AppBiometricType {
  fingerprint,
  faceId,
  touchId,
  iris,
  none,
}

/// Result of a biometric authentication attempt
class BiometricAuthResult {
  const BiometricAuthResult._({
    required this.success,
    this.errorCode,
    this.errorMessage,
    this.canRetry = true,
  });

  final bool success;
  final String? errorCode;
  final String? errorMessage;
  final bool canRetry;

  factory BiometricAuthResult.success() =>
      const BiometricAuthResult._(success: true);

  factory BiometricAuthResult.failure({
    String? errorCode,
    String? errorMessage,
    bool canRetry = true,
  }) =>
      BiometricAuthResult._(
        success: false,
        errorCode: errorCode,
        errorMessage: errorMessage,
        canRetry: canRetry,
      );

  factory BiometricAuthResult.userCancelled() => const BiometricAuthResult._(
        success: false,
        errorCode: 'user_cancelled',
        errorMessage: 'Authentication was cancelled',
        canRetry: true,
      );

  factory BiometricAuthResult.notAvailable() => const BiometricAuthResult._(
        success: false,
        errorCode: 'not_available',
        errorMessage: 'Biometric authentication is not available on this device',
        canRetry: false,
      );

  factory BiometricAuthResult.notEnrolled() => const BiometricAuthResult._(
        success: false,
        errorCode: 'not_enrolled',
        errorMessage: 'No biometrics enrolled on this device',
        canRetry: false,
      );

  factory BiometricAuthResult.lockedOut() => const BiometricAuthResult._(
        success: false,
        errorCode: 'locked_out',
        errorMessage: 'Too many attempts. Please try again later.',
        canRetry: false,
      );

  factory BiometricAuthResult.permanentlyLockedOut() => const BiometricAuthResult._(
        success: false,
        errorCode: 'permanently_locked_out',
        errorMessage: 'Biometric authentication is permanently locked. Please unlock with passcode.',
        canRetry: false,
      );
}

/// Service for biometric authentication
///
/// Uses local_auth package to provide Face ID, Touch ID, and fingerprint
/// authentication on iOS and Android devices.
class BiometricAuthService {
  BiometricAuthService({LocalAuthentication? localAuth})
      : _localAuth = localAuth ?? LocalAuthentication();

  final LocalAuthentication _localAuth;

  /// Check if the device supports biometric authentication
  Future<bool> isDeviceSupported() async {
    try {
      return await _localAuth.isDeviceSupported();
    } on PlatformException {
      return false;
    }
  }

  /// Check if biometrics can be used (device supported + enrolled)
  Future<bool> canCheckBiometrics() async {
    try {
      return await _localAuth.canCheckBiometrics;
    } on PlatformException {
      return false;
    }
  }

  /// Check if biometrics are available for use
  Future<bool> isAvailable() async {
    final canCheck = await canCheckBiometrics();
    final isSupported = await isDeviceSupported();
    return canCheck && isSupported;
  }

  /// Get available biometric types
  Future<List<AppBiometricType>> getAvailableBiometrics() async {
    try {
      final availableBiometrics = await _localAuth.getAvailableBiometrics();
      
      return availableBiometrics.map((biometric) {
        switch (biometric) {
          case BiometricType.fingerprint:
            return AppBiometricType.fingerprint;
          case BiometricType.face:
            return Platform.isIOS ? AppBiometricType.faceId : AppBiometricType.faceId;
          case BiometricType.iris:
            return AppBiometricType.iris;
          default:
            return AppBiometricType.none;
        }
      }).where((type) => type != AppBiometricType.none).toList();
    } on PlatformException {
      return [];
    }
  }

  /// Get the primary biometric type available
  Future<AppBiometricType> getPrimaryBiometricType() async {
    final available = await getAvailableBiometrics();
    
    if (available.isEmpty) return AppBiometricType.none;
    
    // Prioritize Face ID on iOS, fingerprint on Android
    if (Platform.isIOS && available.contains(AppBiometricType.faceId)) {
      return AppBiometricType.faceId;
    }
    
    if (Platform.isIOS) {
      // Check for Touch ID
      if (available.contains(AppBiometricType.fingerprint)) {
        return AppBiometricType.touchId;
      }
    }
    
    if (available.contains(AppBiometricType.fingerprint)) {
      return AppBiometricType.fingerprint;
    }
    
    return available.first;
  }

  /// Get user-friendly name for biometric type
  String getBiometricName(AppBiometricType type) {
    switch (type) {
      case AppBiometricType.faceId:
        return 'Face ID';
      case AppBiometricType.touchId:
        return 'Touch ID';
      case AppBiometricType.fingerprint:
        return 'Fingerprint';
      case AppBiometricType.iris:
        return 'Iris scan';
      case AppBiometricType.none:
        return 'Biometrics';
    }
  }

  /// Authenticate using biometrics
  ///
  /// [reason] - The message to display to the user
  /// [biometricOnly] - If true, don't allow fallback to device PIN/password
  Future<BiometricAuthResult> authenticate({
    String reason = 'Authenticate to continue',
    bool biometricOnly = false,
  }) async {
    try {
      // First check if biometrics are available
      final canAuthenticate = await canCheckBiometrics();
      if (!canAuthenticate) {
        return BiometricAuthResult.notAvailable();
      }

      final availableBiometrics = await getAvailableBiometrics();
      if (availableBiometrics.isEmpty) {
        return BiometricAuthResult.notEnrolled();
      }

      final authenticated = await _localAuth.authenticate(
        localizedReason: reason,
        options: AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: biometricOnly,
          useErrorDialogs: true,
        ),
      );

      if (authenticated) {
        return BiometricAuthResult.success();
      } else {
        return BiometricAuthResult.userCancelled();
      }
    } on PlatformException catch (e) {
      return _handlePlatformException(e);
    }
  }

  /// Stop any ongoing authentication
  Future<void> stopAuthentication() async {
    try {
      await _localAuth.stopAuthentication();
    } on PlatformException {
      // Ignore errors when stopping
    }
  }

  BiometricAuthResult _handlePlatformException(PlatformException e) {
    switch (e.code) {
      case auth_error.notEnrolled:
        return BiometricAuthResult.notEnrolled();
      case auth_error.lockedOut:
        return BiometricAuthResult.lockedOut();
      case auth_error.permanentlyLockedOut:
        return BiometricAuthResult.permanentlyLockedOut();
      case auth_error.notAvailable:
        return BiometricAuthResult.notAvailable();
      case auth_error.passcodeNotSet:
        return BiometricAuthResult.failure(
          errorCode: 'passcode_not_set',
          errorMessage: 'Please set a device passcode first',
        );
      case auth_error.otherOperatingSystem:
        return BiometricAuthResult.notAvailable();
      default:
        return BiometricAuthResult.failure(
          errorCode: e.code,
          errorMessage: e.message ?? 'Authentication failed',
        );
    }
  }
}
