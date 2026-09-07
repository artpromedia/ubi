import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:ubi_core/ubi_config.dart';
import 'package:ubi_core/ubi_test_ids.dart';
import 'package:ubi_ui_kit/ubi_tokens.dart';

import '../../../core/router/app_router.dart';
import '../../driver/bloc/driver_bloc.dart';
import '../../earnings/bloc/earnings_bloc.dart';

/// Main home page for drivers with map, online/offline toggle, and stats
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> with TickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    )..repeat(reverse: true);

    _pulseAnimation = Tween<double>(
      begin: 1.0,
      end: 1.2,
    ).animate(CurvedAnimation(
      parent: _pulseController,
      curve: Curves.easeInOut,
    ));

    // Load initial data
    context.read<DriverBloc>().add(const DriverInitialized());
    context.read<EarningsBloc>().add(const LoadTodayEarnings());
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // Map placeholder
          Container(
            width: double.infinity,
            height: double.infinity,
            color: Colors.grey.shade200,
            child: const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.map,
                    size: 64,
                    color: Colors.grey,
                  ),
                  SizedBox(height: 16),
                  Text(
                    'Map View',
                    style: TextStyle(
                      color: Colors.grey,
                      fontSize: 18,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Top bar
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  // Menu button
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.1),
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: IconButton(
                      icon: const Icon(Icons.menu),
                      onPressed: () => _showMenu(context),
                    ),
                  ),
                  const Spacer(),
                  // Earnings preview
                  BlocBuilder<EarningsBloc, EarningsState>(
                    builder: (context, state) {
                      // Today's total is shown on the earnings screen, which
                      // renders it from the server's Money (amount + currency)
                      // through the city-config formatter. This chip used to
                      // print a hard-coded "KES" in front of a bare double,
                      // which named a market the config never chose
                      // (CLAUDE.md rule 6).
                      const earnings = 'Earnings';
                      return GestureDetector(
                        onTap: () => context.push(AppRoutes.earnings),
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 12,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(12),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.1),
                                blurRadius: 8,
                                offset: const Offset(0, 2),
                              ),
                            ],
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.account_balance_wallet,
                                color: Theme.of(context).primaryColor,
                                size: 20,
                              ),
                              const SizedBox(width: 8),
                              Text(
                                earnings,
                                style: UbiTokenTypography.labelLarge,
                              ),
                              const SizedBox(width: 4),
                              const Icon(
                                Icons.chevron_right,
                                size: 20,
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
          ),

          // Bottom sheet
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: BlocBuilder<DriverBloc, DriverState>(
              builder: (context, state) {
                return Container(
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(24),
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.1),
                        blurRadius: 16,
                        offset: const Offset(0, -4),
                      ),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Handle
                      Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(
                          color: Colors.grey.shade300,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                      const SizedBox(height: 24),

                      // Status card
                      _buildStatusCard(context, state),
                      const SizedBox(height: 24),

                      // Going online is gated on the city's driver_online
                      // flag: where UBI has not launched driver supply, the
                      // button is not shown and the reason is (rule 5/8).
                      FlagGate(
                        flag: UbiFlag.driverOnline,
                        fallback: _buildOnlineUnavailable(context),
                        child: _buildToggleButton(context, state),
                      ),
                      const SizedBox(height: 16),

                      // Stats row
                      if (state is DriverOnline || state is DriverBusy)
                        _buildStatsRow(context, state),
                    ],
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusCard(BuildContext context, DriverState state) {
    IconData icon;
    String title;
    String subtitle;
    Color color;

    final tokens = UbiSemanticColors.of(context);

    if (state is DriverOnline) {
      icon = Icons.wifi_tethering;
      title = 'You are Online';
      subtitle = 'Waiting for trip requests...';
      color = tokens.moveInk;
    } else if (state is DriverBusy) {
      icon = Icons.directions_car;
      title = 'On a Trip';
      subtitle = 'Complete your current trip';
      color = tokens.warnInk;
    } else if (state is DriverOnBreak) {
      icon = Icons.coffee;
      title = 'On Break';
      subtitle = 'Take your time';
      color = tokens.travelInk;
    } else if (state is DriverRequestPending) {
      icon = Icons.notifications_active;
      title = 'New Request!';
      subtitle = 'Tap to view details';
      color = tokens.move;
    } else {
      icon = Icons.wifi_off;
      title = 'You are Offline';
      subtitle = 'Go online to receive trips';
      color = tokens.text3;
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: color.withOpacity(0.3),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon,
              color: Colors.white,
              size: 24,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: color,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: Colors.grey.shade600,
                  ),
                ),
              ],
            ),
          ),
          if (state is DriverOnline)
            AnimatedBuilder(
              animation: _pulseAnimation,
              builder: (context, child) {
                return Transform.scale(
                  scale: _pulseAnimation.value,
                  child: Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      color: color,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: color.withOpacity(0.5),
                          blurRadius: 8,
                          spreadRadius: 2,
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  /// Shown in place of the go-online button when the city does not run driver
  /// supply, or when we could not check.
  Widget _buildOnlineUnavailable(BuildContext context) {
    final tokens = UbiSemanticColors.of(context);
    return BlocBuilder<ConfigCubit, ConfigState>(
      builder: (context, config) {
        final couldNotCheck = config.flagsUnverified;
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(UbiSpace.x4),
          decoration: BoxDecoration(
            color: tokens.bg2,
            borderRadius: UbiRadii.cardLgBorder,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                couldNotCheck
                    ? 'We could not check if you can go online'
                    : 'Going online is not available here yet',
                style: UbiTokenTypography.titleMedium
                    .copyWith(color: tokens.ink),
              ),
              const SizedBox(height: UbiSpace.x2),
              Text(
                couldNotCheck
                    ? 'You are offline, so we cannot confirm your city allows '
                        'driver sign-on. Reconnect and try again.'
                    : 'UBI has not opened driver sign-on in your city. Nothing '
                        'is wrong with your account.',
                style: UbiTokenTypography.bodyMedium
                    .copyWith(color: tokens.text2),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildToggleButton(BuildContext context, DriverState state) {
    final isOnline = state is DriverOnline || state is DriverBusy;

    final tokens = UbiSemanticColors.of(context);

    return SizedBox(
      width: double.infinity,
      height: UbiTargets.primaryButton,
      child: ElevatedButton(
        key: testKey(
          isOnline ? TestIds.driverHomeGoOffline : TestIds.driverHomeGoOnline,
        ),
        onPressed: () {
          if (isOnline) {
            context.read<DriverBloc>().add(const DriverWentOffline());
          } else {
            context.read<DriverBloc>().add(const DriverWentOnline());
          }
        },
        style: ElevatedButton.styleFrom(
          backgroundColor: isOnline ? tokens.error : tokens.primaryButton,
          foregroundColor:
              isOnline ? tokens.bg : tokens.onPrimaryButton,
          shape: const RoundedRectangleBorder(
            borderRadius: UbiRadii.cardLgBorder,
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(isOnline ? Icons.power_settings_new : Icons.play_arrow),
            const SizedBox(width: UbiSpace.x2),
            Text(
              isOnline ? 'Go Offline' : 'Go Online',
              style: UbiTokenTypography.labelLarge.copyWith(fontSize: 18),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatsRow(BuildContext context, DriverState state) {
    // Get stats from state if available
    int trips = 0;
    double hours = 0;
    double rating = 0;

    if (state is DriverOnline) {
      trips = state.stats?.completedTrips ?? 0;
      hours = state.stats?.hoursOnline ?? 0;
      rating = state.stats?.rating ?? 0;
    }

    return Row(
      children: [
        Expanded(
          child: _buildStatItem(
            context,
            Icons.route,
            '$trips',
            'Trips',
          ),
        ),
        Expanded(
          child: _buildStatItem(
            context,
            Icons.schedule,
            hours.toStringAsFixed(1),
            'Hours',
          ),
        ),
        Expanded(
          child: _buildStatItem(
            context,
            Icons.star,
            rating > 0 ? rating.toStringAsFixed(1) : '-',
            'Rating',
          ),
        ),
      ],
    );
  }

  Widget _buildStatItem(
    BuildContext context,
    IconData icon,
    String value,
    String label,
  ) {
    return Column(
      children: [
        Icon(
          icon,
          color: Theme.of(context).primaryColor,
          size: 24,
        ),
        const SizedBox(height: 8),
        Text(
          value,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            color: Colors.grey.shade600,
            fontSize: 12,
          ),
        ),
      ],
    );
  }

  void _showMenu(BuildContext context) {
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 24),
            ListTile(
              leading: CircleAvatar(
                backgroundColor: Theme.of(context).primaryColor.withOpacity(0.1),
                child: Icon(
                  Icons.person,
                  color: Theme.of(context).primaryColor,
                ),
              ),
              title: const Text('Profile'),
              subtitle: const Text('View and edit your profile'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () {
                Navigator.pop(context);
                context.push(AppRoutes.profile);
              },
            ),
            ListTile(
              leading: CircleAvatar(
                backgroundColor: Colors.green.withOpacity(0.1),
                child: const Icon(
                  Icons.attach_money,
                  color: Colors.green,
                ),
              ),
              title: const Text('Earnings'),
              subtitle: const Text('Track your earnings'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () {
                Navigator.pop(context);
                context.push(AppRoutes.earnings);
              },
            ),
            ListTile(
              leading: CircleAvatar(
                backgroundColor: Colors.blue.withOpacity(0.1),
                child: const Icon(
                  Icons.history,
                  color: Colors.blue,
                ),
              ),
              title: const Text('Trip History'),
              subtitle: const Text('View past trips'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () {
                Navigator.pop(context);
                context.push(AppRoutes.tripHistory);
              },
            ),
            ListTile(
              leading: CircleAvatar(
                backgroundColor: Colors.orange.withOpacity(0.1),
                child: const Icon(
                  Icons.folder_outlined,
                  color: Colors.orange,
                ),
              ),
              title: const Text('Documents'),
              subtitle: const Text('Manage your documents'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () {
                Navigator.pop(context);
                context.push(AppRoutes.documents);
              },
            ),
            ListTile(
              leading: CircleAvatar(
                backgroundColor: Colors.grey.withOpacity(0.1),
                child: const Icon(
                  Icons.settings,
                  color: Colors.grey,
                ),
              ),
              title: const Text('Settings'),
              subtitle: const Text('App preferences'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () {
                Navigator.pop(context);
                context.push(AppRoutes.settings);
              },
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}
