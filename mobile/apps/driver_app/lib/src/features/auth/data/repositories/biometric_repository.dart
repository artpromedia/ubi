import 'package:ubi_storage/ubi_storage.dart';

/// Keys for biometric-related secure storage
abstract class BiometricStorageKeys {
  static const biometricEnabled = 'biometric_enabled';
  static const biometricUserId = 'biometric_user_id';
  static const biometricEnrolledAt = 'biometric_enrolled_at';
  static const biometricDeviceKey = 'biometric_device_key';
  static const lastBiometricLogin = 'last_biometric_login';
  static const biometricPromptShown = 'biometric_prompt_shown';
  static const biometricSetupSkipped = 'biometric_setup_skipped';
}

/// Repository for managing biometric authentication data
///
/// Handles secure storage of biometric enrollment state and
/// user credentials for biometric login.
class BiometricRepository {
  BiometricRepository({
    required SecureStorage secureStorage,
  }) : _secureStorage = secureStorage;

  final SecureStorage _secureStorage;

  /// Check if biometric login is enabled for this device
  Future<bool> isBiometricEnabled() async {
    final enabled = await _secureStorage.read(BiometricStorageKeys.biometricEnabled);
    return enabled == 'true';
  }

  /// Enable biometric login for the given user
  ///
  /// Stores the user ID securely and marks biometric as enabled.
  /// The [deviceKey] is a unique identifier that changes if device
  /// biometrics are modified (e.g., new fingerprint added).
  Future<void> enableBiometric({
    required String userId,
    required String deviceKey,
  }) async {
    await Future.wait([
      _secureStorage.write(BiometricStorageKeys.biometricEnabled, 'true'),
      _secureStorage.write(BiometricStorageKeys.biometricUserId, userId),
      _secureStorage.write(BiometricStorageKeys.biometricDeviceKey, deviceKey),
      _secureStorage.write(
        BiometricStorageKeys.biometricEnrolledAt,
        DateTime.now().toIso8601String(),
      ),
    ]);
  }

  /// Disable biometric login
  Future<void> disableBiometric() async {
    await Future.wait([
      _secureStorage.delete(BiometricStorageKeys.biometricEnabled),
      _secureStorage.delete(BiometricStorageKeys.biometricUserId),
      _secureStorage.delete(BiometricStorageKeys.biometricDeviceKey),
      _secureStorage.delete(BiometricStorageKeys.biometricEnrolledAt),
      _secureStorage.delete(BiometricStorageKeys.lastBiometricLogin),
    ]);
  }

  /// Get the user ID associated with biometric login
  Future<String?> getBiometricUserId() async {
    return await _secureStorage.read(BiometricStorageKeys.biometricUserId);
  }

  /// Get the stored device key (for checking if biometrics changed)
  Future<String?> getStoredDeviceKey() async {
    return await _secureStorage.read(BiometricStorageKeys.biometricDeviceKey);
  }

  /// Update the device key after successful biometric auth
  Future<void> updateDeviceKey(String deviceKey) async {
    await _secureStorage.write(BiometricStorageKeys.biometricDeviceKey, deviceKey);
  }

  /// Record a successful biometric login
  Future<void> recordBiometricLogin() async {
    await _secureStorage.write(
      BiometricStorageKeys.lastBiometricLogin,
      DateTime.now().toIso8601String(),
    );
  }

  /// Get the last biometric login time
  Future<DateTime?> getLastBiometricLogin() async {
    final value = await _secureStorage.read(BiometricStorageKeys.lastBiometricLogin);
    if (value == null) return null;
    return DateTime.tryParse(value);
  }

  /// Get the biometric enrollment date
  Future<DateTime?> getBiometricEnrolledAt() async {
    final value = await _secureStorage.read(BiometricStorageKeys.biometricEnrolledAt);
    if (value == null) return null;
    return DateTime.tryParse(value);
  }

  /// Check if the biometric setup prompt has been shown to the user
  Future<bool> hasBiometricPromptBeenShown() async {
    final value = await _secureStorage.read(BiometricStorageKeys.biometricPromptShown);
    return value == 'true';
  }

  /// Mark that the biometric setup prompt has been shown
  Future<void> markBiometricPromptShown() async {
    await _secureStorage.write(BiometricStorageKeys.biometricPromptShown, 'true');
  }

  /// Check if user has skipped biometric setup
  Future<bool> hasBiometricSetupBeenSkipped() async {
    final value = await _secureStorage.read(BiometricStorageKeys.biometricSetupSkipped);
    return value == 'true';
  }

  /// Mark that user skipped biometric setup
  Future<void> markBiometricSetupSkipped() async {
    await _secureStorage.write(BiometricStorageKeys.biometricSetupSkipped, 'true');
  }

  /// Reset the skip state (e.g., when user goes to settings)
  Future<void> resetBiometricSetupSkipped() async {
    await _secureStorage.delete(BiometricStorageKeys.biometricSetupSkipped);
  }

  /// Invalidate biometric tokens (e.g., when device biometrics change)
  ///
  /// This clears the biometric enrollment but preserves the regular
  /// auth tokens so the user stays logged in but must re-enroll biometrics.
  Future<void> invalidateBiometricEnrollment() async {
    await disableBiometric();
    await resetBiometricSetupSkipped();
  }

  /// Check if user can use biometric login
  ///
  /// Returns true if:
  /// - Biometric is enabled
  /// - User ID is stored
  /// - Device key matches (biometrics haven't changed)
  Future<BiometricLoginStatus> checkBiometricLoginStatus({
    required String currentDeviceKey,
  }) async {
    final isEnabled = await isBiometricEnabled();
    if (!isEnabled) {
      return BiometricLoginStatus.notEnabled;
    }

    final storedUserId = await getBiometricUserId();
    if (storedUserId == null) {
      return BiometricLoginStatus.notEnrolled;
    }

    final storedDeviceKey = await getStoredDeviceKey();
    if (storedDeviceKey != null && storedDeviceKey != currentDeviceKey) {
      // Device biometrics have changed, invalidate
      await invalidateBiometricEnrollment();
      return BiometricLoginStatus.invalidated;
    }

    return BiometricLoginStatus.ready;
  }
}

/// Status of biometric login availability
enum BiometricLoginStatus {
  /// Biometric login is ready to use
  ready,
  /// Biometric login is not enabled
  notEnabled,
  /// No biometric enrollment found
  notEnrolled,
  /// Biometric enrollment was invalidated (device biometrics changed)
  invalidated,
}

