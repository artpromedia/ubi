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
          onTap: () {},
        ),
        ListTile(
          leading: const Icon(Icons.language),
          title: const Text('Language'),
          subtitle: const Text('English'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {},
        ),
        ListTile(
          leading: const Icon(Icons.map),
          title: const Text('Map Type'),
          subtitle: const Text('Normal'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {},
        ),
      ],
    );
  }

  Widget _buildPrivacySettings(BuildContext context) {
    return Column(
      children: [
        ListTile(
          leading: const Icon(Icons.lock),
          title: const Text('Change Password'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {
            // Navigate to change password
          },
        ),
        ListTile(
          leading: const Icon(Icons.fingerprint),
          title: const Text('Biometric Login'),
          trailing: Switch(
            value: false,
            onChanged: (value) {},
          ),
        ),
        ListTile(
          leading: const Icon(Icons.location_on),
          title: const Text('Location Permissions'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {
            // Open location settings
          },
        ),
        ListTile(
          leading: const Icon(Icons.privacy_tip),
          title: const Text('Privacy Policy'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {
            // Open privacy policy
          },
        ),
        ListTile(
          leading: const Icon(Icons.description),
          title: const Text('Terms of Service'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {
            // Open terms of service
          },
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
          onTap: () {
            // Open help
          },
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
}

extension StringExtension on String {
  String capitalize() {
    if (isEmpty) return this;
    return '${this[0].toUpperCase()}${substring(1)}';
  }
}
