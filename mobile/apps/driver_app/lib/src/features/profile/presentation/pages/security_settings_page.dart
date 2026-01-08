import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../auth/bloc/auth_bloc.dart';
import '../../../auth/data/repositories/biometric_repository.dart';
import '../../../../core/services/biometric_auth_service.dart';

/// Security settings page for managing biometric login and other security options
class SecuritySettingsPage extends StatefulWidget {
  const SecuritySettingsPage({super.key});

  @override
  State<SecuritySettingsPage> createState() => _SecuritySettingsPageState();
}

class _SecuritySettingsPageState extends State<SecuritySettingsPage> {
  final BiometricAuthService _biometricService = BiometricAuthService();
  
  bool _biometricEnabled = false;
  bool _biometricAvailable = false;
  AppBiometricType _biometricType = AppBiometricType.fingerprint;
  bool _isLoading = true;
  DateTime? _biometricEnrolledAt;
  DateTime? _lastBiometricLogin;

  @override
  void initState() {
    super.initState();
    _loadBiometricStatus();
  }

  Future<void> _loadBiometricStatus() async {
    setState(() => _isLoading = true);

    // Check device capability
    final canUseBiometrics = await _biometricService.canCheckBiometrics();
    final biometricType = await _biometricService.getPrimaryBiometricType();

    // Note: In a real app, BiometricRepository would be injected via DI
    // For now, we'll get the status from the AuthBloc state
    final authState = context.read<AuthBloc>().state;
    final isAuthenticated = authState is AuthAuthenticated;

    if (mounted) {
      setState(() {
        _biometricAvailable = canUseBiometrics && biometricType != AppBiometricType.none;
        _biometricType = biometricType;
        _isLoading = false;
        // The actual enabled state would come from BiometricRepository
        // For now, simulate checking storage
      });
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

  String get _biometricDescription {
    if (!_biometricAvailable) {
      return 'Biometric authentication is not available on this device.';
    }
    if (_biometricEnabled) {
      return 'Use $_biometricName to quickly sign in to UBI.';
    }
    return 'Enable $_biometricName for faster and more secure sign in.';
  }

  Future<void> _toggleBiometric(bool enable) async {
    if (enable) {
      context.read<AuthBloc>().add(const AuthEnableBiometricRequested());
    } else {
      // Show confirmation dialog before disabling
      final confirmed = await _showDisableConfirmation();
      if (confirmed == true) {
        context.read<AuthBloc>().add(const AuthDisableBiometricRequested());
      }
    }
  }

  Future<bool?> _showDisableConfirmation() {
    return showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Disable Biometric Login?'),
        content: Text(
          'You will need to enter your phone number and verify with OTP to sign in next time.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Disable'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return BlocListener<AuthBloc, AuthState>(
      listener: (context, state) {
        if (state is AuthBiometricSetupResult) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(state.message ?? (state.success ? 'Success' : 'Failed')),
              backgroundColor: state.success ? Colors.green : Colors.red,
            ),
          );
          if (state.success) {
            setState(() {
              _biometricEnabled = !_biometricEnabled;
            });
          }
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Security'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.pop(),
          ),
        ),
        body: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                children: [
                  // Biometric login section
                  _buildSectionHeader('Quick Sign In'),
                  
                  // Biometric toggle
                  Container(
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: theme.cardColor,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.grey.shade200),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              width: 48,
                              height: 48,
                              decoration: BoxDecoration(
                                color: _biometricAvailable
                                    ? theme.primaryColor.withOpacity(0.1)
                                    : Colors.grey.shade100,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Icon(
                                _biometricIcon,
                                color: _biometricAvailable
                                    ? theme.primaryColor
                                    : Colors.grey,
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
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    _biometricDescription,
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      color: Colors.grey.shade600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Switch(
                              value: _biometricEnabled,
                              onChanged: _biometricAvailable ? _toggleBiometric : null,
                            ),
                          ],
                        ),
                        
                        // Last used info
                        if (_biometricEnabled && _lastBiometricLogin != null) ...[
                          const SizedBox(height: 12),
                          const Divider(),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Icon(
                                Icons.access_time,
                                size: 16,
                                color: Colors.grey.shade500,
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'Last used: ${_formatDate(_lastBiometricLogin!)}',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: Colors.grey.shade500,
                                ),
                              ),
                            ],
                          ),
                        ],

                        // Not available warning
                        if (!_biometricAvailable) ...[
                          const SizedBox(height: 12),
                          Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: Colors.orange.shade50,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  Icons.info_outline,
                                  size: 20,
                                  color: Colors.orange.shade700,
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    Platform.isIOS
                                        ? 'Set up Face ID or Touch ID in your device settings to enable this feature.'
                                        : 'Set up fingerprint or face unlock in your device settings to enable this feature.',
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      color: Colors.orange.shade700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),

                  const SizedBox(height: 24),
                  
                  // Security tips
                  _buildSectionHeader('Security Tips'),
                  _buildSecurityTip(
                    icon: Icons.smartphone,
                    title: 'Keep your device locked',
                    subtitle: 'Use a PIN, pattern, or biometric lock on your device.',
                  ),
                  _buildSecurityTip(
                    icon: Icons.update,
                    title: 'Keep the app updated',
                    subtitle: 'Updates include important security fixes.',
                  ),
                  _buildSecurityTip(
                    icon: Icons.warning_amber_rounded,
                    title: 'Never share your OTP',
                    subtitle: 'UBI will never ask for your verification code.',
                  ),

                  const SizedBox(height: 24),
                  
                  // Account security
                  _buildSectionHeader('Account Security'),
                  ListTile(
                    leading: const Icon(Icons.devices),
                    title: const Text('Logged in devices'),
                    subtitle: const Text('Manage devices with access to your account'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      // Navigate to device management
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Coming soon')),
                      );
                    },
                  ),
                  ListTile(
                    leading: const Icon(Icons.history),
                    title: const Text('Login history'),
                    subtitle: const Text('View recent sign in activity'),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      // Navigate to login history
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Coming soon')),
                      );
                    },
                  ),

                  const SizedBox(height: 32),
                ],
              ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              color: Theme.of(context).primaryColor,
              fontWeight: FontWeight.bold,
            ),
      ),
    );
  }

  Widget _buildSecurityTip({
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return ListTile(
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: Colors.blue.shade50,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: Colors.blue.shade700, size: 20),
      ),
      title: Text(title),
      subtitle: Text(subtitle),
    );
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);

    if (diff.inMinutes < 1) {
      return 'Just now';
    } else if (diff.inHours < 1) {
      return '${diff.inMinutes} min ago';
    } else if (diff.inDays < 1) {
      return '${diff.inHours} hours ago';
    } else if (diff.inDays < 7) {
      return '${diff.inDays} days ago';
    } else {
      return '${date.day}/${date.month}/${date.year}';
    }
  }
}
