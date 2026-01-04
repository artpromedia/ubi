import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../bloc/driver_profile_bloc.dart';

/// Driver profile page with overview, ratings, and menu options
class ProfilePage extends StatefulWidget {
  const ProfilePage({super.key});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  @override
  void initState() {
    super.initState();
    context.read<DriverProfileBloc>().add(const ProfileLoaded());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => context.push(AppRoutes.settings),
          ),
        ],
      ),
      body: BlocBuilder<DriverProfileBloc, DriverProfileState>(
        builder: (context, state) {
          if (state is DriverProfileLoading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state is DriverProfileLoaded) {
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  // Profile header
                  _buildProfileHeader(context, state.profile),
                  const SizedBox(height: 24),

                  // Rating summary
                  _buildRatingSummary(context, state.profile),
                  const SizedBox(height: 24),

                  // Menu options
                  _buildMenuSection(context),
                ],
              ),
            );
          }

          return const Center(child: Text('Failed to load profile'));
        },
      ),
    );
  }

  Widget _buildProfileHeader(BuildContext context, DriverProfile profile) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Theme.of(context).primaryColor.withOpacity(0.1),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        children: [
          Stack(
            children: [
              CircleAvatar(
                radius: 50,
                backgroundColor: Colors.grey.shade200,
                backgroundImage:
                    profile.photoUrl != null ? NetworkImage(profile.photoUrl!) : null,
                child: profile.photoUrl == null
                    ? const Icon(Icons.person, size: 50, color: Colors.grey)
                    : null,
              ),
              Positioned(
                bottom: 0,
                right: 0,
                child: GestureDetector(
                  onTap: () => context.push(AppRoutes.editProfile),
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: Theme.of(context).primaryColor,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 2),
                    ),
                    child: const Icon(
                      Icons.edit,
                      size: 16,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            profile.fullName,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            profile.phone,
            style: TextStyle(
              color: Colors.grey.shade600,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 8),
          if (profile.isVerified)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: Colors.green.withOpacity(0.1),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.verified, size: 16, color: Colors.green),
                  SizedBox(width: 4),
                  Text(
                    'Verified Driver',
                    style: TextStyle(
                      color: Colors.green,
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 16),
          // Stats row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildStatItem(
                context,
                '${profile.totalTrips}',
                'Trips',
              ),
              Container(
                width: 1,
                height: 30,
                color: Colors.grey.shade300,
              ),
              _buildStatItem(
                context,
                '${profile.yearsActive}',
                'Years',
              ),
              Container(
                width: 1,
                height: 30,
                color: Colors.grey.shade300,
              ),
              _buildStatItem(
                context,
                '${profile.acceptanceRate.toStringAsFixed(0)}%',
                'Acceptance',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatItem(BuildContext context, String value, String label) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
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

  Widget _buildRatingSummary(BuildContext context, DriverProfile profile) {
    return GestureDetector(
      onTap: () => context.push(AppRoutes.ratings),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: Colors.amber.withOpacity(0.1),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.amber.withOpacity(0.3)),
        ),
        child: Row(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: Colors.amber,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Center(
                child: Text(
                  profile.rating.toStringAsFixed(1),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: List.generate(
                      5,
                      (index) => Icon(
                        index < profile.rating.round()
                            ? Icons.star
                            : Icons.star_border,
                        color: Colors.amber,
                        size: 20,
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${profile.totalRatings} ratings',
                    style: TextStyle(
                      color: Colors.grey.shade600,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, color: Colors.grey),
          ],
        ),
      ),
    );
  }

  Widget _buildMenuSection(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Account',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        const SizedBox(height: 12),
        _buildMenuItem(
          context,
          icon: Icons.person_outline,
          title: 'Personal Information',
          subtitle: 'Edit your profile details',
          onTap: () => context.push(AppRoutes.editProfile),
        ),
        _buildMenuItem(
          context,
          icon: Icons.directions_car_outlined,
          title: 'Vehicle',
          subtitle: 'Manage your vehicle details',
          onTap: () => context.push(AppRoutes.vehicle),
        ),
        _buildMenuItem(
          context,
          icon: Icons.folder_outlined,
          title: 'Documents',
          subtitle: 'Upload and manage documents',
          onTap: () => context.push(AppRoutes.documents),
        ),
        const SizedBox(height: 24),
        Text(
          'Preferences',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        const SizedBox(height: 12),
        _buildMenuItem(
          context,
          icon: Icons.notifications_outlined,
          title: 'Notifications',
          subtitle: 'Manage notification preferences',
          onTap: () => context.push(AppRoutes.settings),
        ),
        _buildMenuItem(
          context,
          icon: Icons.language,
          title: 'Language',
          subtitle: 'English',
          onTap: () {
            // Show language picker
          },
        ),
        _buildMenuItem(
          context,
          icon: Icons.help_outline,
          title: 'Help & Support',
          subtitle: 'Get help or contact us',
          onTap: () {
            // Navigate to help
          },
        ),
        const SizedBox(height: 24),
        // Logout button
        SizedBox(
          width: double.infinity,
          height: 48,
          child: OutlinedButton.icon(
            onPressed: () => _showLogoutConfirmation(context),
            icon: const Icon(Icons.logout, color: Colors.red),
            label: const Text(
              'Sign Out',
              style: TextStyle(color: Colors.red),
            ),
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: Colors.red),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMenuItem(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: ListTile(
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: Theme.of(context).primaryColor.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(
            icon,
            color: Theme.of(context).primaryColor,
            size: 20,
          ),
        ),
        title: Text(
          title,
          style: const TextStyle(fontWeight: FontWeight.w500),
        ),
        subtitle: Text(
          subtitle,
          style: const TextStyle(fontSize: 12),
        ),
        trailing: const Icon(Icons.chevron_right, color: Colors.grey),
        onTap: onTap,
      ),
    );
  }

  void _showLogoutConfirmation(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign Out'),
        content: const Text('Are you sure you want to sign out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              context.read<DriverProfileBloc>().add(const LoggedOut());
              context.go(AppRoutes.login);
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );
  }
}
