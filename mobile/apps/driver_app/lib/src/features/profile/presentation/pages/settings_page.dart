import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../bloc/driver_profile_bloc.dart';

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
    context.read<DriverProfileBloc>().add(const SettingsLoaded());
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

          if (state is SettingsLoadedState) {
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
          value: settings.tripRequests,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  NotificationSettingsUpdated(
                    settings.copyWith(tripRequests: value),
                  ),
                );
          },
        ),
        SwitchListTile(
          title: const Text('Earnings Updates'),
          subtitle: const Text('Daily and weekly earnings summaries'),
          value: settings.earningsUpdates,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  NotificationSettingsUpdated(
                    settings.copyWith(earningsUpdates: value),
                  ),
                );
          },
        ),
        SwitchListTile(
          title: const Text('Promotions'),
          subtitle: const Text('Special offers and incentives'),
          value: settings.promotions,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  NotificationSettingsUpdated(
                    settings.copyWith(promotions: value),
                  ),
                );
          },
        ),
        SwitchListTile(
          title: const Text('News & Updates'),
          subtitle: const Text('App updates and announcements'),
          value: settings.newsUpdates,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  NotificationSettingsUpdated(
                    settings.copyWith(newsUpdates: value),
                  ),
                );
          },
        ),
        SwitchListTile(
          title: const Text('Sounds'),
          subtitle: const Text('Play notification sounds'),
          value: settings.sounds,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  NotificationSettingsUpdated(
                    settings.copyWith(sounds: value),
                  ),
                );
          },
        ),
        SwitchListTile(
          title: const Text('Vibration'),
          subtitle: const Text('Vibrate on notifications'),
          value: settings.vibration,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  NotificationSettingsUpdated(
                    settings.copyWith(vibration: value),
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
        ListTile(
          leading: const Icon(Icons.palette),
          title: const Text('Theme'),
          subtitle: Text(settings.theme.name.capitalize()),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showThemeDialog(context, settings),
        ),
        // Language
        ListTile(
          leading: const Icon(Icons.language),
          title: const Text('Language'),
          subtitle: Text(settings.language),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showLanguageDialog(context, settings),
        ),
        // Map type
        ListTile(
          leading: const Icon(Icons.map),
          title: const Text('Map Type'),
          subtitle: Text(settings.mapType.capitalize()),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showMapTypeDialog(context, settings),
        ),
        // Distance unit
        ListTile(
          leading: const Icon(Icons.straighten),
          title: const Text('Distance Unit'),
          subtitle: Text(settings.distanceUnit),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _showDistanceUnitDialog(context, settings),
        ),
        // Navigation voice
        SwitchListTile(
          secondary: const Icon(Icons.record_voice_over),
          title: const Text('Navigation Voice'),
          subtitle: const Text('Voice guidance during navigation'),
          value: settings.navigationVoice,
          onChanged: (value) {
            context.read<DriverProfileBloc>().add(
                  AppSettingsUpdated(
                    settings.copyWith(navigationVoice: value),
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
                  AppSettingsUpdated(
                    settings.copyWith(autoAcceptTrips: value),
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

  Widget _buildAboutSection(BuildContext context) {
    return Column(
      children: [
        ListTile(
          leading: const Icon(Icons.info),
          title: const Text('App Version'),
          subtitle: const Text('1.0.0 (Build 1)'),
        ),
        ListTile(
          leading: const Icon(Icons.help),
          title: const Text('Help Center'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {
            // Open help center
          },
        ),
        ListTile(
          leading: const Icon(Icons.feedback),
          title: const Text('Send Feedback'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {
            // Open feedback form
          },
        ),
        ListTile(
          leading: const Icon(Icons.star),
          title: const Text('Rate the App'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () {
            // Open app store
          },
        ),
      ],
    );
  }

  void _showThemeDialog(BuildContext context, AppSettings settings) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Select Theme'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            RadioListTile<ThemeOption>(
              title: const Text('System'),
              value: ThemeOption.system,
              groupValue: settings.theme,
              onChanged: (value) {
                context.read<DriverProfileBloc>().add(
                      AppSettingsUpdated(settings.copyWith(theme: value)),
                    );
                Navigator.pop(context);
              },
            ),
            RadioListTile<ThemeOption>(
              title: const Text('Light'),
              value: ThemeOption.light,
              groupValue: settings.theme,
              onChanged: (value) {
                context.read<DriverProfileBloc>().add(
                      AppSettingsUpdated(settings.copyWith(theme: value)),
                    );
                Navigator.pop(context);
              },
            ),
            RadioListTile<ThemeOption>(
              title: const Text('Dark'),
              value: ThemeOption.dark,
              groupValue: settings.theme,
              onChanged: (value) {
                context.read<DriverProfileBloc>().add(
                      AppSettingsUpdated(settings.copyWith(theme: value)),
                    );
                Navigator.pop(context);
              },
            ),
          ],
        ),
      ),
    );
  }

  void _showLanguageDialog(BuildContext context, AppSettings settings) {
    final languages = ['English', 'Swahili', 'French', 'Arabic'];

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Select Language'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: languages
              .map((lang) => RadioListTile<String>(
                    title: Text(lang),
                    value: lang,
                    groupValue: settings.language,
                    onChanged: (value) {
                      context.read<DriverProfileBloc>().add(
                            AppSettingsUpdated(
                                settings.copyWith(language: value)),
                          );
                      Navigator.pop(context);
                    },
                  ))
              .toList(),
        ),
      ),
    );
  }

  void _showMapTypeDialog(BuildContext context, AppSettings settings) {
    final mapTypes = ['normal', 'satellite', 'terrain', 'hybrid'];

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Select Map Type'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: mapTypes
              .map((type) => RadioListTile<String>(
                    title: Text(type.capitalize()),
                    value: type,
                    groupValue: settings.mapType,
                    onChanged: (value) {
                      context.read<DriverProfileBloc>().add(
                            AppSettingsUpdated(
                                settings.copyWith(mapType: value)),
                          );
                      Navigator.pop(context);
                    },
                  ))
              .toList(),
        ),
      ),
    );
  }

  void _showDistanceUnitDialog(BuildContext context, AppSettings settings) {
    final units = ['km', 'miles'];

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Select Distance Unit'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: units
              .map((unit) => RadioListTile<String>(
                    title: Text(unit == 'km' ? 'Kilometers' : 'Miles'),
                    value: unit,
                    groupValue: settings.distanceUnit,
                    onChanged: (value) {
                      context.read<DriverProfileBloc>().add(
                            AppSettingsUpdated(
                                settings.copyWith(distanceUnit: value)),
                          );
                      Navigator.pop(context);
                    },
                  ))
              .toList(),
        ),
      ),
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
