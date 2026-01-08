import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:ubi_storage/ubi_storage.dart';

/// Types of haptic feedback available in the app
enum HapticType {
  /// Light feedback for selections, taps on list items, toggles
  light,

  /// Medium feedback for confirmations (ride confirmed, payment success)
  medium,

  /// Heavy feedback for alerts (driver arrived, ride started)
  heavy,

  /// Success pattern - one longer vibration (trip completed)
  success,

  /// Error pattern - two short buzzes (payment failed, ride cancelled)
  error,

  /// Selection changed feedback
  selection,
}

/// Service for managing haptic feedback throughout the app
///
/// Provides different feedback patterns for various user interactions:
/// - Light: button taps, list item selections, toggles
/// - Medium: ride confirmed, payment successful
/// - Heavy: driver arrived, ride started
/// - Success: trip completed (one long buzz)
/// - Error: payment failed, ride cancelled (two short buzzes)
class HapticService {
  HapticService._();

  static final HapticService instance = HapticService._();

  AppPreferences? _prefs;

  bool _isEnabled = true;
  bool _isInitialized = false;
  bool _isAppActive = true;

  /// Whether haptic feedback is currently enabled
  bool get isEnabled => _isEnabled;

  /// Initialize the haptic service
  ///
  /// Loads user preference from storage and checks system settings
  Future<void> initialize([AppPreferences? prefs]) async {
    if (_isInitialized) return;

    try {
      _prefs = prefs ?? await AppPreferences.create();
      _isEnabled = _prefs!.hapticFeedbackEnabled;
      _isInitialized = true;
    } catch (e) {
      debugPrint('HapticService: Failed to load preferences: $e');
      _isEnabled = true;
      _isInitialized = true;
    }
  }

  /// Set whether the app is in active/foreground state
  ///
  /// Haptics are disabled when app is in background
  void setAppActive(bool active) {
    _isAppActive = active;
  }

  /// Enable or disable haptic feedback
  Future<void> setEnabled(bool enabled) async {
    _isEnabled = enabled;

    try {
      await _prefs?.setHapticFeedbackEnabled(enabled);
    } catch (e) {
      debugPrint('HapticService: Failed to save preference: $e');
    }
  }

  /// Toggle haptic feedback on/off
  Future<void> toggle() async {
    await setEnabled(!_isEnabled);
  }

  /// Trigger haptic feedback of the specified type
  ///
  /// Does nothing if:
  /// - Haptics are disabled by user preference
  /// - App is in background/inactive state
  /// - Running on web platform
  Future<void> trigger(HapticType type) async {
    if (!_shouldTrigger()) return;

    switch (type) {
      case HapticType.light:
        await _lightImpact();
      case HapticType.medium:
        await _mediumImpact();
      case HapticType.heavy:
        await _heavyImpact();
      case HapticType.success:
        await _successPattern();
      case HapticType.error:
        await _errorPattern();
      case HapticType.selection:
        await _selectionClick();
    }
  }

  /// Light impact - for selections and taps
  Future<void> light() => trigger(HapticType.light);

  /// Medium impact - for confirmations
  Future<void> medium() => trigger(HapticType.medium);

  /// Heavy impact - for alerts
  Future<void> heavy() => trigger(HapticType.heavy);

  /// Success pattern - for completed actions
  Future<void> success() => trigger(HapticType.success);

  /// Error pattern - for failed actions
  Future<void> error() => trigger(HapticType.error);

  /// Selection click - for selection changes
  Future<void> selection() => trigger(HapticType.selection);

  bool _shouldTrigger() {
    // Don't trigger on web
    if (kIsWeb) return false;

    // Don't trigger if disabled by user
    if (!_isEnabled) return false;

    // Don't trigger if app is inactive
    if (!_isAppActive) return false;

    return true;
  }

  Future<void> _lightImpact() async {
    try {
      await HapticFeedback.lightImpact();
    } catch (e) {
      debugPrint('HapticService: lightImpact failed: $e');
    }
  }

  Future<void> _mediumImpact() async {
    try {
      await HapticFeedback.mediumImpact();
    } catch (e) {
      debugPrint('HapticService: mediumImpact failed: $e');
    }
  }

  Future<void> _heavyImpact() async {
    try {
      await HapticFeedback.heavyImpact();
    } catch (e) {
      debugPrint('HapticService: heavyImpact failed: $e');
    }
  }

  Future<void> _selectionClick() async {
    try {
      await HapticFeedback.selectionClick();
    } catch (e) {
      debugPrint('HapticService: selectionClick failed: $e');
    }
  }

  /// Success pattern: one medium-length vibration
  Future<void> _successPattern() async {
    try {
      // Use heavy impact for a more satisfying success feel
      await HapticFeedback.heavyImpact();
      // On iOS, we can trigger vibrate for a longer feel
      if (Platform.isIOS) {
        await Future.delayed(const Duration(milliseconds: 50));
        await HapticFeedback.mediumImpact();
      }
    } catch (e) {
      debugPrint('HapticService: successPattern failed: $e');
    }
  }

  /// Error pattern: two short buzzes
  Future<void> _errorPattern() async {
    try {
      await HapticFeedback.mediumImpact();
      await Future.delayed(const Duration(milliseconds: 100));
      await HapticFeedback.mediumImpact();
    } catch (e) {
      debugPrint('HapticService: errorPattern failed: $e');
    }
  }
}

/// Extension to easily trigger haptics from any widget
extension HapticExtension on HapticService {
  /// Trigger light haptic for button press
  Future<void> onButtonPress() => light();

  /// Trigger light haptic for list item tap
  Future<void> onListItemTap() => light();

  /// Trigger selection haptic for toggle/switch
  Future<void> onToggle() => selection();

  /// Trigger medium haptic for ride confirmed
  Future<void> onRideConfirmed() => medium();

  /// Trigger medium haptic for payment success
  Future<void> onPaymentSuccess() => medium();

  /// Trigger heavy haptic for driver arrived
  Future<void> onDriverArrived() => heavy();

  /// Trigger heavy haptic for ride started
  Future<void> onRideStarted() => heavy();

  /// Trigger success haptic for trip completed
  Future<void> onTripCompleted() => success();

  /// Trigger error haptic for payment failed
  Future<void> onPaymentFailed() => error();

  /// Trigger error haptic for ride cancelled
  Future<void> onRideCancelled() => error();

  /// Trigger light haptic for pull to refresh
  Future<void> onPullToRefresh() => light();

  /// Trigger light haptic for swipe action
  Future<void> onSwipeAction() => light();

  /// Trigger light haptic for bottom sheet open/close
  Future<void> onBottomSheet() => light();
}

/// Mixin to add haptic feedback capability to StatefulWidgets
mixin HapticFeedbackMixin {
  HapticService get haptics => HapticService.instance;

  /// Wrap a callback with light haptic feedback
  VoidCallback? withLightHaptic(VoidCallback? callback) {
    if (callback == null) return null;
    return () {
      haptics.light();
      callback();
    };
  }

  /// Wrap a callback with medium haptic feedback
  VoidCallback? withMediumHaptic(VoidCallback? callback) {
    if (callback == null) return null;
    return () {
      haptics.medium();
      callback();
    };
  }

  /// Wrap a callback with selection haptic feedback
  VoidCallback? withSelectionHaptic(VoidCallback? callback) {
    if (callback == null) return null;
    return () {
      haptics.selection();
      callback();
    };
  }
}
