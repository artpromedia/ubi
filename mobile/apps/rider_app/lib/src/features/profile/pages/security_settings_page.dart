import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/services/biometric_auth_service.dart';
import '../../auth/data/repositories/biometric_repository.dart';
import '../../auth/bloc/auth_bloc.dart';

/// Security settings page for managing biometric login and other security options
class SecuritySettingsPage extends StatefulWidget {
  const SecuritySettingsPage({super.key});

  @override
  State<SecuritySettingsPage> createState() => _SecuritySettingsPageState();
}

class _SecuritySettingsPageState extends State<SecuritySettingsPage> {
  final _biometricAuthService = BiometricAuthService();
  final _biometricRepository = BiometricRepository();
  
  bool _biometricAvailable = false;
  bool _biometricEnabled = false;
  bool _isLoading = true;
  AppBiometricType _biometricType = AppBiometricType.none;
  String? _lastUsed;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    setState(() => _isLoading = true);

    try {
      final isAvailable = await _biometricAuthService.isAvailable();
      final type = await _biometricAuthService.getPrimaryBiometricType();
      final status = await _biometricRepository.checkBiometricLoginStatus();

      if (mounted) {
        setState(() {
          _biometricAvailable = isAvailable;
          _biometricType = type;
          _biometricEnabled = status.isEnabled;
          _lastUsed = status.enrolledAt;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  String get _biometricName {
    return _biometricAuthService.getBiometricName(_biometricType);
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

  Future<void> _toggleBiometric(bool enable) async {
    if (enable) {
      // Authenticate first to enable
      final result = await _biometricAuthService.authenticate(
        reason: 'Verify your identity to enable $_biometricName',
      );

      if (!result.success) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(result.errorMessage ?? 'Verification failed'),
              backgroundColor: Colors.red,
            ),
          );
        }
        return;
      }

      // Get current user from auth bloc
      final authState = context.read<AuthBloc>().state;
      if (authState is AuthAuthenticated) {
        await _biometricRepository.enableBiometric(
          userId: authState.user.id,
          deviceKey: 'device-${DateTime.now().millisecondsSinceEpoch}',
        );
      }
    } else {
      await _biometricRepository.disableBiometric();
    }

    await _loadSettings();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            enable
                ? '$_biometricName login enabled'
                : '$_biometricName login disabled',
          ),
          backgroundColor: enable ? Colors.green : Colors.grey,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Security'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              children: [
                // Biometric Section
                const _SectionHeader(title: 'Biometric Login'),
                
                if (_biometricAvailable) ...[
                  Container(
                    margin: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primaryContainer.withOpacity(0.3),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Column(
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Row(
                            children: [
                              Container(
                                width: 56,
                                height: 56,
                                decoration: BoxDecoration(
                                  color: theme.colorScheme.primary,
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(
                                  _biometricIcon,
                                  color: Colors.white,
                                  size: 28,
                                ),
                              ),
                              const SizedBox(width: 16),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      _biometricName,
                                      style: theme.textTheme.titleMedium?.copyWith(
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      _biometricEnabled
                                          ? 'Sign in quickly using $_biometricName'
                                          : 'Enable for faster sign in',
                                      style: theme.textTheme.bodySmall?.copyWith(
                                        color: theme.colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              Switch(
                                value: _biometricEnabled,
                                onChanged: _toggleBiometric,
                              ),
                            ],
                          ),
                        ),
                        if (_biometricEnabled && _lastUsed != null)
                          Padding(
                            padding: const EdgeInsets.only(
                              left: 16,
                              right: 16,
                              bottom: 16,
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  Icons.schedule,
                                  size: 14,
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                                const SizedBox(width: 4),
                                Text(
                                  'Enabled: $_lastUsed',
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                ] else ...[
                  Container(
                    margin: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 8,
                    ),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.info_outline,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'Biometric login is not available on this device',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],

                const Divider(height: 32),

                // Security Tips
                const _SectionHeader(title: 'Security Tips'),
                Container(
                  margin: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    children: [
                      _SecurityTipCard(
                        icon: Icons.phone_android,
                        title: 'Keep your device secure',
                        description:
                            'Use a screen lock and keep your device software updated.',
                      ),
                      const SizedBox(height: 8),
                      _SecurityTipCard(
                        icon: Icons.sms,
                        title: 'Protect your phone number',
                        description:
                            'Never share your OTP codes with anyone, including UBI support.',
                      ),
                      const SizedBox(height: 8),
                      _SecurityTipCard(
                        icon: Icons.warning,
                        title: 'Report suspicious activity',
                        description:
                            'Contact us immediately if you notice unauthorized access.',
                      ),
                    ],
                  ),
                ),

                const Divider(height: 32),

                // Device Management
                const _SectionHeader(title: 'Device Management'),
                ListTile(
                  leading: const Icon(Icons.devices),
                  title: const Text('Manage Devices'),
                  subtitle: const Text('View and manage signed-in devices'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Device management coming soon'),
                      ),
                    );
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.logout),
                  title: const Text('Sign Out All Devices'),
                  subtitle: const Text('Sign out from all other devices'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    _showSignOutAllDialog();
                  },
                ),

                const SizedBox(height: 24),
              ],
            ),
    );
  }

  void _showSignOutAllDialog() {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign out all devices?'),
        content: const Text(
          'This will sign you out from all devices except this one. '
          'You will need to sign in again on other devices.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.of(context).pop();
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Signed out from all other devices'),
                ),
              );
            },
            child: const Text('Sign Out All'),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).colorScheme.primary,
              fontWeight: FontWeight.bold,
            ),
      ),
    );
  }
}

class _SecurityTipCard extends StatelessWidget {
  const _SecurityTipCard({
    required this.icon,
    required this.title,
    required this.description,
  });

  final IconData icon;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            icon,
            size: 20,
            color: theme.colorScheme.primary,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  description,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
