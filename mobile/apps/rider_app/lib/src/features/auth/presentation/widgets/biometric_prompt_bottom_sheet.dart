import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ubi_core/ubi_core.dart';

import '../../bloc/auth_bloc.dart';
import '../../../../core/services/biometric_auth_service.dart';

/// Bottom sheet prompting user to enable biometric login after first successful login
class BiometricPromptBottomSheet extends StatefulWidget {
  const BiometricPromptBottomSheet({
    super.key,
    required this.user,
  });

  final User user;

  /// Show the bottom sheet
  static Future<void> show(BuildContext context, User user) async {
    await showModalBottomSheet<void>(
      context: context,
      isDismissible: false,
      enableDrag: false,
      builder: (context) => BiometricPromptBottomSheet(user: user),
    );
  }

  @override
  State<BiometricPromptBottomSheet> createState() =>
      _BiometricPromptBottomSheetState();
}

class _BiometricPromptBottomSheetState
    extends State<BiometricPromptBottomSheet> {
  final _biometricService = BiometricAuthService();
  AppBiometricType _biometricType = AppBiometricType.none;
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
    switch (_biometricType) {
      case AppBiometricType.faceId:
        return 'Face ID';
      case AppBiometricType.touchId:
        return 'Touch ID';
      case AppBiometricType.fingerprint:
        return 'Fingerprint';
      case AppBiometricType.iris:
        return 'Iris';
      case AppBiometricType.none:
        return 'Biometrics';
    }
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
        return Icons.security;
    }
  }

  Future<void> _enableBiometric() async {
    setState(() => _isLoading = true);
    
    context.read<AuthBloc>().add(
      const AuthEnableBiometricRequested(),
    );
    
    if (mounted) {
      Navigator.of(context).pop();
    }
  }

  void _skipBiometric() {
    context.read<AuthBloc>().add(
      const AuthSkipBiometricSetup(),
    );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(20),
        ),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Handle bar
            Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 24),
              decoration: BoxDecoration(
                color: theme.colorScheme.outline.withOpacity(0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),

            // Icon
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer,
                shape: BoxShape.circle,
              ),
              child: Icon(
                _biometricIcon,
                size: 40,
                color: theme.colorScheme.primary,
              ),
            ),
            const SizedBox(height: 24),

            // Title
            Text(
              'Enable $_biometricName?',
              style: theme.textTheme.headlineSmall?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),

            // Description
            Text(
              'Sign in faster with $_biometricName. You can always change this in Settings.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 32),

            // Enable button
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _isLoading ? null : _enableBiometric,
                icon: _isLoading
                    ? SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: theme.colorScheme.onPrimary,
                        ),
                      )
                    : Icon(_biometricIcon),
                label: Text('Enable $_biometricName'),
              ),
            ),
            const SizedBox(height: 12),

            // Skip button
            SizedBox(
              width: double.infinity,
              child: TextButton(
                onPressed: _isLoading ? null : _skipBiometric,
                child: const Text('Not Now'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
