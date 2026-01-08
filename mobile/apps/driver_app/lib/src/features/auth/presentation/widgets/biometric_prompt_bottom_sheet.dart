import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../bloc/auth_bloc.dart';
import '../../../../core/services/biometric_auth_service.dart';

/// Bottom sheet to prompt user to enable biometric login
///
/// Shows after successful OTP verification on devices that support
/// Face ID, Touch ID, or fingerprint authentication.
class BiometricPromptBottomSheet extends StatefulWidget {
  const BiometricPromptBottomSheet({
    super.key,
    this.onEnabled,
    this.onSkipped,
  });

  final VoidCallback? onEnabled;
  final VoidCallback? onSkipped;

  /// Show the biometric prompt bottom sheet
  static Future<bool?> show(BuildContext context) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => const BiometricPromptBottomSheet(),
    );
  }

  @override
  State<BiometricPromptBottomSheet> createState() => _BiometricPromptBottomSheetState();
}

class _BiometricPromptBottomSheetState extends State<BiometricPromptBottomSheet> {
  final BiometricAuthService _biometricService = BiometricAuthService();
  AppBiometricType _biometricType = AppBiometricType.fingerprint;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _loadBiometricType();
  }

  Future<void> _loadBiometricType() async {
    final type = await _biometricService.getPrimaryBiometricType();
    if (mounted) {
      setState(() => _biometricType = type);
    }
  }

  String get _biometricName {
    return _biometricService.getBiometricName(_biometricType);
  }

  IconData get _biometricIcon {
    switch (_biometricType) {
      case AppBiometricType.faceId:
        return Icons.face;
      case AppBiometricType.touchId:
      case AppBiometricType.fingerprint:
        return Icons.fingerprint;
      case AppBiometricType.iris:
        return Icons.remove_red_eye;
      case AppBiometricType.none:
        return Icons.lock;
    }
  }

  String get _title {
    if (Platform.isIOS && _biometricType == AppBiometricType.faceId) {
      return 'Enable Face ID';
    } else if (Platform.isIOS && _biometricType == AppBiometricType.touchId) {
      return 'Enable Touch ID';
    }
    return 'Enable $_biometricName';
  }

  String get _description {
    if (Platform.isIOS && _biometricType == AppBiometricType.faceId) {
      return 'Sign in faster and more securely with Face ID. Your face data stays on your device.';
    } else if (Platform.isIOS && _biometricType == AppBiometricType.touchId) {
      return 'Sign in faster and more securely with Touch ID. Your fingerprint data stays on your device.';
    }
    return 'Sign in faster and more securely with your fingerprint. Your biometric data stays on your device.';
  }

  Future<void> _enableBiometric() async {
    setState(() => _isLoading = true);
    
    context.read<AuthBloc>().add(const AuthEnableBiometricRequested());
    
    // Listen for result
    // The bloc listener in the parent will handle the result
    widget.onEnabled?.call();
    if (mounted) {
      Navigator.of(context).pop(true);
    }
  }

  void _skipBiometric() {
    context.read<AuthBloc>().add(const AuthSkipBiometricSetup());
    widget.onSkipped?.call();
    Navigator.of(context).pop(false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bottomPadding = MediaQuery.of(context).viewPadding.bottom;

    return Container(
      decoration: BoxDecoration(
        color: theme.scaffoldBackgroundColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: EdgeInsets.fromLTRB(24, 12, 24, bottomPadding + 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Handle bar
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.grey.shade300,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          const SizedBox(height: 24),

          // Icon
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: theme.primaryColor.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              _biometricIcon,
              size: 40,
              color: theme.primaryColor,
            ),
          ),
          const SizedBox(height: 24),

          // Title
          Text(
            _title,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),

          // Description
          Text(
            _description,
            style: theme.textTheme.bodyLarge?.copyWith(
              color: Colors.grey.shade600,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),

          // Security note
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.shield_outlined,
                size: 16,
                color: Colors.green.shade600,
              ),
              const SizedBox(width: 6),
              Text(
                'Secure and private',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: Colors.green.shade600,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
          const SizedBox(height: 32),

          // Enable button
          SizedBox(
            width: double.infinity,
            height: 56,
            child: ElevatedButton.icon(
              onPressed: _isLoading ? null : _enableBiometric,
              icon: _isLoading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Icon(_biometricIcon),
              label: Text(_isLoading ? 'Enabling...' : 'Enable $_biometricName'),
            ),
          ),
          const SizedBox(height: 12),

          // Skip button
          SizedBox(
            width: double.infinity,
            height: 48,
            child: TextButton(
              onPressed: _isLoading ? null : _skipBiometric,
              child: const Text('Not now'),
            ),
          ),
        ],
      ),
    );
  }
}
