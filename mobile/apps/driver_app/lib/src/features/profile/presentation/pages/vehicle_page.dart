import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../bloc/driver_profile_bloc.dart';

/// Vehicle management page showing vehicle details and photo
class VehiclePage extends StatefulWidget {
  const VehiclePage({super.key});

  @override
  State<VehiclePage> createState() => _VehiclePageState();
}

class _VehiclePageState extends State<VehiclePage> {
  @override
  void initState() {
    super.initState();
    context.read<DriverProfileBloc>().add(const VehicleLoaded());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Vehicle'),
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

          if (state is DriverVehicleLoaded) {
            return SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Vehicle photo
                  _buildVehiclePhoto(context, state.vehicle),
                  const SizedBox(height: 24),

                  // Vehicle info card
                  _buildVehicleInfoCard(context, state.vehicle),
                  const SizedBox(height: 24),

                  // Service types
                  _buildServiceTypes(context, state.vehicle),
                  const SizedBox(height: 24),

                  // Vehicle stats
                  _buildVehicleStats(context, state.vehicle),
                  const SizedBox(height: 24),

                  // Edit button
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: OutlinedButton.icon(
                      onPressed: () => _showEditVehicleSheet(context, state.vehicle),
                      icon: const Icon(Icons.edit),
                      label: const Text('Edit Vehicle Details'),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Support note
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.blue.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.info_outline, color: Colors.blue),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'To change your vehicle, please contact support with updated documents.',
                            style: TextStyle(
                              color: Colors.grey.shade700,
                              fontSize: 13,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          }

          return const Center(child: Text('No vehicle found'));
        },
      ),
    );
  }

  Widget _buildVehiclePhoto(BuildContext context, DriverVehicle vehicle) {
    return Container(
      height: 200,
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(16),
        image: vehicle.photoUrl != null
            ? DecorationImage(
                image: NetworkImage(vehicle.photoUrl!),
                fit: BoxFit.cover,
              )
            : null,
      ),
      child: vehicle.photoUrl == null
          ? Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.directions_car,
                  size: 64,
                  color: Colors.grey.shade400,
                ),
                const SizedBox(height: 12),
                ElevatedButton.icon(
                  onPressed: () => _pickVehiclePhoto(context),
                  icon: const Icon(Icons.add_a_photo, size: 18),
                  label: const Text('Add Photo'),
                ),
              ],
            )
          : Align(
              alignment: Alignment.bottomRight,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: FloatingActionButton.small(
                  onPressed: () => _pickVehiclePhoto(context),
                  backgroundColor: Colors.white,
                  foregroundColor: Theme.of(context).primaryColor,
                  child: const Icon(Icons.edit),
                ),
              ),
            ),
    );
  }

  Widget _buildVehicleInfoCard(BuildContext context, DriverVehicle vehicle) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Theme.of(context).primaryColor.withOpacity(0.1),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(context).primaryColor,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.directions_car,
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
                      '${vehicle.make} ${vehicle.model}',
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      vehicle.year.toString(),
                      style: TextStyle(
                        color: Colors.grey.shade600,
                        fontSize: 16,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          const Divider(),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _buildInfoItem(
                  label: 'License Plate',
                  value: vehicle.licensePlate,
                  icon: Icons.confirmation_number,
                ),
              ),
              Expanded(
                child: _buildInfoItem(
                  label: 'Color',
                  value: vehicle.color,
                  icon: Icons.color_lens,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _buildInfoItem(
                  label: 'Category',
                  value: vehicle.category,
                  icon: Icons.category,
                ),
              ),
              Expanded(
                child: _buildInfoItem(
                  label: 'Capacity',
                  value: '${vehicle.seatingCapacity} seats',
                  icon: Icons.people,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildInfoItem({
    required String label,
    required String value,
    required IconData icon,
  }) {
    return Row(
      children: [
        Icon(icon, size: 18, color: Colors.grey),
        const SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: TextStyle(
                color: Colors.grey.shade600,
                fontSize: 11,
              ),
            ),
            Text(
              value,
              style: const TextStyle(
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildServiceTypes(BuildContext context, DriverVehicle vehicle) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Available Services',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: vehicle.enabledServices.map((service) {
            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.green.withOpacity(0.1),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: Colors.green.withOpacity(0.3)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    _getServiceIcon(service),
                    size: 16,
                    color: Colors.green,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    service,
                    style: const TextStyle(
                      color: Colors.green,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  IconData _getServiceIcon(String service) {
    switch (service.toLowerCase()) {
      case 'ride':
        return Icons.directions_car;
      case 'delivery':
        return Icons.local_shipping;
      case 'food':
        return Icons.fastfood;
      default:
        return Icons.check_circle;
    }
  }

  Widget _buildVehicleStats(BuildContext context, DriverVehicle vehicle) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Vehicle Stats',
          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _buildStatCard(
                context,
                icon: Icons.route,
                value: '${vehicle.totalTrips}',
                label: 'Total Trips',
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildStatCard(
                context,
                icon: Icons.straighten,
                value: '${vehicle.totalDistanceKm.toStringAsFixed(0)} km',
                label: 'Distance',
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildStatCard(
    BuildContext context, {
    required IconData icon,
    required String value,
    required String label,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.grey.shade50,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Theme.of(context).primaryColor, size: 24),
          const SizedBox(height: 8),
          Text(
            value,
            style: const TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 18,
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
      ),
    );
  }

  void _pickVehiclePhoto(BuildContext context) {
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
            const Text(
              'Vehicle Photo',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 24),
            ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.blue.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.camera_alt, color: Colors.blue),
              ),
              title: const Text('Take Photo'),
              onTap: () {
                Navigator.pop(context);
                // TODO: Implement camera
              },
            ),
            ListTile(
              leading: Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.green.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.photo_library, color: Colors.green),
              ),
              title: const Text('Choose from Gallery'),
              onTap: () {
                Navigator.pop(context);
                // TODO: Implement gallery picker
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  void _showEditVehicleSheet(BuildContext context, DriverVehicle vehicle) {
    final colorController = TextEditingController(text: vehicle.color);
    final capacityController = TextEditingController(
      text: vehicle.seatingCapacity.toString(),
    );

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 24,
          bottom: MediaQuery.of(context).viewInsets.bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Edit Vehicle',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 24),
            TextField(
              controller: colorController,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Color',
                prefixIcon: Icon(Icons.color_lens),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: capacityController,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Seating Capacity',
                prefixIcon: Icon(Icons.people),
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: () {
                  final updatedVehicle = vehicle.copyWith(
                    color: colorController.text,
                    seatingCapacity:
                        int.tryParse(capacityController.text) ?? vehicle.seatingCapacity,
                  );
                  context
                      .read<DriverProfileBloc>()
                      .add(VehicleUpdated(updatedVehicle));
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Vehicle updated'),
                      backgroundColor: Colors.green,
                    ),
                  );
                },
                child: const Text('Save'),
              ),
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}
