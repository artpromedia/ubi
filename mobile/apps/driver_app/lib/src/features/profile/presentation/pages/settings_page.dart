import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../bloc/driver_profile_bloc.dart';

/// Settings page for driver app preferences
class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  @override
  void initState() {
    super.initState();
    context.read<DriverProfileBloc>().add(const LoadDriverProfile());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: BlocBuilder<DriverProfileBloc, DriverProfileState>(
        builder: (context, state) {
          if (state is DriverProfileLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state is DriverProfileLoaded) {
            return SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Notification settings
                  _buildSectionHeader(context, 'Notifications'),
                  _buildNotificationSettings(context, state.notificationSettings),
                  const Divider(height: 32),

                  // App settings
                  _buildSectionHeader(context, 'App Settings'),
                  _buildAppSettings(context, state.appSettings),
                  const Divider(height: 32),

                  // Privacy & Security
                  _buildSectionHeader(context, 'Privacy & Security'),
                  _buildPrivacySettings(context),
                  const Divider(height: 32),

                  // About
                  _buildSectionHeader(context, 'About'),
                  _buildAboutSection(context),
                  const SizedBox(height: 32),
                ],
              ),
            );
          }

          // Default settings if state not loaded
          return SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildSectionHeader(context, 'Notifications'),
                _buildDefaultNotificationSettings(context),
                const Divider(height: 32),
                _buildSectionHeader(context, 'App Settings'),
                _buildDefaultAppSettings(context),
                const Divider(height: 32),
                _buildSectionHeader(context, 'Privacy & Security'),
                _buildPrivacySettings(context),
                const Divider(height: 32),
                _buildSectionHeader(context, 'About'),
                _buildAboutSection(context),
                const SizedBox(height: 32),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildSectionHeader(BuildContext context, String title) {
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

  Widget _buildNotificationSettings(
      BuildContext context, NotificationSettings settings) {
    return Column(
      children: [
        SwitchListTile(
          title: const Text('Trip Requests'),
          subtitle: const Text('Notifications for new trip requests'),
          value: settings.tripAlerts,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverNotificationSettingsUpdated(
                    tripAlerts: value,
                  ),
                );
          },
        ),
        SwitchListTile(
          title: const Text('Earnings Updates'),
          subtitle: const Text('Daily and weekly earnings summaries'),
          value: settings.earningsAlerts,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverNotificationSettingsUpdated(
                    earningsAlerts: value,
                  ),
                );
          },
        ),
        SwitchListTile(
          title: const Text('Promotions'),
          subtitle: const Text('Special offers and incentives'),
          value: settings.promoAlerts,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverNotificationSettingsUpdated(
                    promoAlerts: value,
                  ),
                );
          },
        ),
        SwitchListTile(
          title: const Text('Push Notifications'),
          subtitle: const Text('Enable push notifications'),
          value: settings.pushEnabled,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverNotificationSettingsUpdated(
                    pushEnabled: value,
                  ),
                );
          },
        ),
        SwitchListTile(
          title: const Text('Email Notifications'),
          subtitle: const Text('Receive email notifications'),
          value: settings.emailEnabled,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverNotificationSettingsUpdated(
                    emailEnabled: value,
                  ),
                );
          },
        ),
        SwitchListTile(
          title: const Text('SMS Notifications'),
          subtitle: const Text('Receive SMS notifications'),
          value: settings.smsEnabled,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverNotificationSettingsUpdated(
                    smsEnabled: value,
                  ),
                );
          },
        ),
      ],
    );
  }

  Widget _buildDefaultNotificationSettings(BuildContext context) {
    return Column(
      children: [
        SwitchListTile(
          title: const Text('Trip Requests'),
          subtitle: const Text('Notifications for new trip requests'),
          value: true,
          onChanged: (value) {},
        ),
        SwitchListTile(
          title: const Text('Earnings Updates'),
          subtitle: const Text('Daily and weekly earnings summaries'),
          value: true,
          onChanged: (value) {},
        ),
        SwitchListTile(
          title: const Text('Promotions'),
          subtitle: const Text('Special offers and incentives'),
          value: true,
          onChanged: (value) {},
        ),
        SwitchListTile(
          title: const Text('News & Updates'),
          subtitle: const Text('App updates and announcements'),
          value: true,
          onChanged: (value) {},
        ),
      ],
    );
  }

  Widget _buildAppSettings(BuildContext context, AppSettings settings) {
    return Column(
      children: [
        // Theme
        SwitchListTile(
          secondary: const Icon(Icons.palette),
          title: const Text('Dark Mode'),
          subtitle: const Text('Enable dark theme'),
          value: settings.darkMode,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverAppSettingsUpdated(
                    darkMode: value,
                  ),
                );
          },
        ),
        // Language
        ListTile(
          leading: const Icon(Icons.language),
          title: const Text('Language'),
          subtitle: Text(settings.language),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showLanguageDialog(context, settings),
        ),
        // Sound
        SwitchListTile(
          secondary: const Icon(Icons.volume_up),
          title: const Text('Sound'),
          subtitle: const Text('Enable app sounds'),
          value: settings.soundEnabled,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverAppSettingsUpdated(
                    soundEnabled: value,
                  ),
                );
          },
        ),
        // Vibration
        SwitchListTile(
          secondary: const Icon(Icons.vibration),
          title: const Text('Vibration'),
          subtitle: const Text('Enable vibration feedback'),
          value: settings.vibrationEnabled,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverAppSettingsUpdated(
                    vibrationEnabled: value,
                  ),
                );
          },
        ),
        // Navigation voice
        SwitchListTile(
          secondary: const Icon(Icons.record_voice_over),
          title: const Text('Navigation Voice'),
          subtitle: const Text('Voice guidance during navigation'),
          value: settings.navigationVoice,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverAppSettingsUpdated(
                    navigationVoice: value,
                  ),
                );
          },
        ),
        // Auto-accept trips
        SwitchListTile(
          secondary: const Icon(Icons.auto_awesome),
          title: const Text('Auto-accept Trips'),
          subtitle: const Text('Automatically accept trip requests'),
          value: settings.autoAcceptTrips,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverAppSettingsUpdated(
                    autoAcceptTrips: value,
                  ),
                );
          },
        ),
        // Show earnings on home
        SwitchListTile(
          secondary: const Icon(Icons.attach_money),
          title: const Text('Show Earnings'),
          subtitle: const Text('Display earnings on home screen'),
          value: settings.showEarningsOnHome,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  DriverAppSettingsUpdated(
                    showEarningsOnHome: value,
                  ),
                );
          },
        ),
      ],
    );
  }

  Widget _buildDefaultAppSettings(BuildContext context) {
    return Column(
      children: [
        ListTile(
          leading: const Icon(Icons.palette),
          title: const Text('Theme'),
          subtitle: const Text('System'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showThemePicker(context),
        ),
        ListTile(
          leading: const Icon(Icons.language),
          title: const Text('Language'),
          subtitle: const Text('English'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showDefaultLanguagePicker(context),
        ),
        ListTile(
          leading: const Icon(Icons.map),
          title: const Text('Map Type'),
          subtitle: const Text('Normal'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showMapTypePicker(context),
        ),
      ],
    );
  }

  Widget _buildPrivacySettings(BuildContext context) {
    return Column(
      children: [
        ListTile(
          leading: const Icon(Icons.security),
          title: const Text('Security'),
          subtitle: const Text('Biometric login, device management'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => context.push('/profile/settings/security'),
        ),
        ListTile(
          leading: const Icon(Icons.lock),
          title: const Text('Change Password'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showChangePasswordDialog(context),
        ),
        ListTile(
          leading: const Icon(Icons.location_on),
          title: const Text('Location Permissions'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _openLocationSettings(context),
        ),
        ListTile(
          leading: const Icon(Icons.privacy_tip),
          title: const Text('Privacy Policy'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _openPrivacyPolicy(context),
        ),
        ListTile(
          leading: const Icon(Icons.description),
          title: const Text('Terms of Service'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _openTermsOfService(context),
        ),
        ListTile(
          leading: Icon(Icons.delete_forever, color: Colors.red.shade400),
          title: Text(
            'Delete Account',
            style: TextStyle(color: Colors.red.shade400),
          ),
          onTap: () => _showDeleteAccountDialog(context),
        ),
      ],
    );
  }

  void _showLanguageDialog(BuildContext context, AppSettings settings) {
    final languages = ['en', 'sw', 'fr', 'ar'];
    final languageNames = {'en': 'English', 'sw': 'Swahili', 'fr': 'French', 'ar': 'Arabic'};

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Select Language'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: languages
              .map((lang) => RadioListTile<String>(
                    title: Text(languageNames[lang] ?? lang),
                    value: lang,
                    groupValue: settings.language,
                    onChanged: (value) {
                      context.read<DriverProfileBloc>().add(
                            DriverAppSettingsUpdated(language: value),
                          );
                      Navigator.pop(dialogContext);
                    },
                  ))
              .toList(),
        ),
      ),
    );
  }

  Widget _buildAboutSection(BuildContext context) {
    return Column(
      children: [
        ListTile(
          leading: const Icon(Icons.info),
          title: const Text('About'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {
            // Show about dialog
            showAboutDialog(
              context: context,
              applicationName: 'Driver App',
              applicationVersion: '1.0.0',
            );
          },
        ),
        ListTile(
          leading: const Icon(Icons.help),
          title: const Text('Help & Support'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showHelpSupport(context),
        ),
      ],
    );
  }

  void _showDeleteAccountDialog(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Account'),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Are you sure you want to delete your account?',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
            SizedBox(height: 12),
            Text('This action cannot be undone. All your data will be permanently deleted including:'),
            SizedBox(height: 8),
            Text('• Trip history'),
            Text('• Earnings records'),
            Text('• Profile information'),
            Text('• Documents'),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              // Show confirmation
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Account deletion request submitted'),
                ),
              );
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }

  void _showThemePicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Select Theme',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              ListTile(
                leading: const Icon(Icons.brightness_auto),
                title: const Text('System'),
                trailing: const Icon(Icons.check, color: Colors.green),
                onTap: () => Navigator.pop(context),
              ),
              ListTile(
                leading: const Icon(Icons.light_mode),
                title: const Text('Light'),
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Light theme selected')),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.dark_mode),
                title: const Text('Dark'),
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Dark theme selected')),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showDefaultLanguagePicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Select Language',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              ListTile(
                title: const Text('English'),
                trailing: const Icon(Icons.check, color: Colors.green),
                onTap: () => Navigator.pop(context),
              ),
              ListTile(
                title: const Text('Kiswahili'),
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Language changed to Kiswahili')),
                  );
                },
              ),
              ListTile(
                title: const Text('Français'),
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Language changed to Français')),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showMapTypePicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Select Map Type',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              ListTile(
                leading: const Icon(Icons.map),
                title: const Text('Normal'),
                trailing: const Icon(Icons.check, color: Colors.green),
                onTap: () => Navigator.pop(context),
              ),
              ListTile(
                leading: const Icon(Icons.satellite),
                title: const Text('Satellite'),
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Map type changed to Satellite')),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.terrain),
                title: const Text('Terrain'),
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Map type changed to Terrain')),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showChangePasswordDialog(BuildContext context) {
    final currentPasswordController = TextEditingController();
    final newPasswordController = TextEditingController();
    final confirmPasswordController = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Change Password'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: currentPasswordController,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Current Password',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: newPasswordController,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'New Password',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: confirmPasswordController,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Confirm New Password',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Password changed successfully'),
                  backgroundColor: Colors.green,
                ),
              );
            },
            child: const Text('Change'),
          ),
        ],
      ),
    );
  }

  void _openLocationSettings(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Location Permissions'),
        content: const Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Your current location permission status:'),
            SizedBox(height: 16),
            Row(
              children: [
                Icon(Icons.check_circle, color: Colors.green),
                SizedBox(width: 8),
                Text('Location access: Enabled'),
              ],
            ),
            SizedBox(height: 8),
            Row(
              children: [
                Icon(Icons.check_circle, color: Colors.green),
                SizedBox(width: 8),
                Text('Background location: Enabled'),
              ],
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Opening system settings...')),
              );
            },
            child: const Text('System Settings'),
          ),
        ],
      ),
    );
  }

  void _openPrivacyPolicy(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Opening Privacy Policy...'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _openTermsOfService(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Opening Terms of Service...'),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _showHelpSupport(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Help & Support',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 24),
              ListTile(
                leading: const Icon(Icons.chat_bubble_outline),
                title: const Text('Live Chat'),
                subtitle: const Text('Chat with our support team'),
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Connecting to live chat...')),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.phone_outlined),
                title: const Text('Call Support'),
                subtitle: const Text('+254 700 123 456'),
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Opening phone dialer...')),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.email_outlined),
                title: const Text('Email Support'),
                subtitle: const Text('support@ubi.co.ke'),
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Opening email client...')),
                  );
                },
              ),
              ListTile(
                leading: const Icon(Icons.help_center_outlined),
                title: const Text('FAQ'),
                subtitle: const Text('Frequently asked questions'),
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Opening FAQ page...')),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

extension StringExtension on String {
  String capitalize() {
    if (isEmpty) return this;
    return '${this[0].toUpperCase()}${substring(1)}';
  }
}
