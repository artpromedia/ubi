import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';

/// Delivery tracking page
class DeliveryTrackingPage extends StatelessWidget {
  final String deliveryId;

  const DeliveryTrackingPage({
    super.key,
    required this.deliveryId,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Track Delivery'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go(Routes.deliveryNew),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Status card
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    const Icon(
                      Icons.local_shipping,
                      size: 48,
                      color: Colors.blue,
                    ),
                    const SizedBox(height: 12),
                    const Text(
                      'Package in Transit',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'ETA: 15-20 minutes',
                      style: TextStyle(color: Colors.grey[600]),
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Progress tracker
            Text(
              'Delivery Progress',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 16),
            _buildProgressStep(
              context,
              'Pickup',
              'Package collected from sender',
              '2:30 PM',
              isCompleted: true,
              isActive: false,
            ),
            _buildProgressStep(
              context,
              'In Transit',
              'On the way to destination',
              '2:45 PM',
              isCompleted: false,
              isActive: true,
            ),
            _buildProgressStep(
              context,
              'Delivered',
              'Package delivered to recipient',
              null,
              isCompleted: false,
              isActive: false,
              isLast: true,
            ),

            const SizedBox(height: 24),

            // Courier info
            Text(
              'Courier',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    const CircleAvatar(
                      radius: 28,
                      child: Icon(Icons.person, size: 32),
                    ),
                    const SizedBox(width: 16),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Peter Kamau',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                            ),
                          ),
                          Row(
                            children: [
                              Icon(Icons.star, size: 16, color: Colors.amber),
                              Text(' 4.9 • 500+ deliveries'),
                            ],
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () {
                        // Call courier
                      },
                      icon: CircleAvatar(
                        backgroundColor:
                            Theme.of(context).primaryColor.withOpacity(0.1),
                        child: Icon(
                          Icons.phone,
                          color: Theme.of(context).primaryColor,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Package details
            Text(
              'Package Details',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    _buildDetailRow('Package ID', '#DEL-${deliveryId.toUpperCase()}'),
                    const Divider(height: 24),
                    _buildDetailRow('Size', 'Small'),
                    const Divider(height: 24),
                    _buildDetailRow('Description', 'Documents'),
                    const Divider(height: 24),
                    _buildDetailRow('Payment', 'KES 150 (M-Pesa)'),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Locations
            Text(
              'Route',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 12,
                          height: 12,
                          decoration: const BoxDecoration(
                            color: Colors.green,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Pickup',
                                style: TextStyle(color: Colors.grey),
                              ),
                              Text(
                                'Westlands, Nairobi',
                                style: TextStyle(fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    Container(
                      margin: const EdgeInsets.only(left: 5),
                      height: 24,
                      width: 2,
                      color: Colors.grey[300],
                    ),
                    Row(
                      children: [
                        Container(
                          width: 12,
                          height: 12,
                          decoration: const BoxDecoration(
                            color: Colors.red,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 12),
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Dropoff',
                                style: TextStyle(color: Colors.grey),
                              ),
                              Text(
                                'KICC, Nairobi CBD',
                                style: TextStyle(fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Recipient
            Text(
              'Recipient',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 12),
            Card(
              child: ListTile(
                leading: const CircleAvatar(
                  child: Icon(Icons.person_outline),
                ),
                title: const Text('John Doe'),
                subtitle: const Text('+254 712 345 678'),
                trailing: IconButton(
                  icon: const Icon(Icons.phone_outlined),
                  onPressed: () {
                    // Call recipient
                  },
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Help button
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: () {
                  // Get help
                },
                icon: const Icon(Icons.help_outline),
                label: const Text('Need Help?'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProgressStep(
    BuildContext context,
    String title,
    String subtitle,
    String? time, {
    required bool isCompleted,
    required bool isActive,
    bool isLast = false,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Container(
              width: 24,
              height: 24,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: isCompleted
                    ? Colors.green
                    : isActive
                        ? Theme.of(context).primaryColor
                        : Colors.grey[300],
              ),
              child: isCompleted
                  ? const Icon(Icons.check, size: 16, color: Colors.white)
                  : isActive
                      ? const Center(
                          child: SizedBox(
                            width: 12,
                            height: 12,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          ),
                        )
                      : null,
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 40,
                color: isCompleted ? Colors.green : Colors.grey[300],
              ),
          ],
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: isCompleted || isActive ? null : Colors.grey,
                        ),
                      ),
                    ),
                    if (time != null)
                      Text(
                        time,
                        style: TextStyle(
                          color: Colors.grey[600],
                          fontSize: 12,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(
                    color: Colors.grey[600],
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(color: Colors.grey),
        ),
        Text(
          value,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
      ],
    );
  }
}
