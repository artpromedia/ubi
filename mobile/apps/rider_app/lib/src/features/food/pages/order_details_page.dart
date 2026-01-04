import 'package:flutter/material.dart';

/// Page showing completed food order details
class OrderDetailsPage extends StatelessWidget {
  const OrderDetailsPage({
    super.key,
    required this.orderId,
  });

  final String orderId;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text('Order #${orderId.substring(0, 8).toUpperCase()}'),
        actions: [
          IconButton(
            icon: const Icon(Icons.receipt_long_outlined),
            onPressed: () {
              // Download receipt
            },
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Order status badge
            _buildStatusBadge(context),
            const SizedBox(height: 24),

            // Restaurant info
            _buildRestaurantCard(context),
            const SizedBox(height: 16),

            // Order items
            _buildOrderItems(context),
            const SizedBox(height: 16),

            // Delivery info
            _buildDeliveryInfo(context),
            const SizedBox(height: 16),

            // Payment summary
            _buildPaymentSummary(context),
            const SizedBox(height: 16),

            // Rating section
            _buildRatingSection(context),
            const SizedBox(height: 24),

            // Action buttons
            _buildActionButtons(context),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _buildStatusBadge(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.green.shade50,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.green.shade200),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: Colors.green,
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Icon(
              Icons.check,
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
                  'Order Delivered',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: Colors.green.shade700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Dec 15, 2024 at 7:45 PM',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: Colors.green.shade600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRestaurantCard(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            // Restaurant image
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Container(
                width: 64,
                height: 64,
                color: Colors.orange.shade100,
                child: Icon(
                  Icons.restaurant,
                  color: Colors.orange.shade700,
                  size: 32,
                ),
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Java House',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Westlands, Nairobi',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(
                        Icons.star,
                        size: 16,
                        color: Colors.amber.shade600,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '4.5',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: () {
                // View restaurant
              },
              child: const Text('View Menu'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOrderItems(BuildContext context) {
    final theme = Theme.of(context);

    // Sample order items
    final items = [
      _OrderItem(
        name: 'Grilled Chicken Burger',
        quantity: 2,
        price: 650,
        notes: 'Extra cheese, no onions',
      ),
      _OrderItem(
        name: 'Classic Fries',
        quantity: 1,
        price: 250,
        notes: null,
      ),
      _OrderItem(
        name: 'Fresh Orange Juice',
        quantity: 2,
        price: 180,
        notes: 'No sugar',
      ),
    ];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Order Items',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            ...items.map((item) => _buildOrderItemRow(context, item)),
          ],
        ),
      ),
    );
  }

  Widget _buildOrderItemRow(BuildContext context, _OrderItem item) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: theme.colorScheme.primaryContainer,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              '${item.quantity}x',
              style: theme.textTheme.bodySmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: theme.colorScheme.onPrimaryContainer,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.name,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (item.notes != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    item.notes!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ],
            ),
          ),
          Text(
            'KES ${(item.price * item.quantity).toStringAsFixed(0)}',
            style: theme.textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDeliveryInfo(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Delivery Details',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            // Delivery address
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.location_on,
                  size: 20,
                  color: theme.colorScheme.primary,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Delivered to',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '123 Kilimani Road, Nairobi',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            // Delivery rider
            Row(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: Colors.grey.shade200,
                  child: const Icon(Icons.person, color: Colors.grey),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Joseph Kamau',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Row(
                        children: [
                          Icon(
                            Icons.star,
                            size: 14,
                            color: Colors.amber.shade600,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '4.9',
                            style: theme.textTheme.bodySmall,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            '• Delivery Partner',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const Divider(height: 24),
            // Delivery time
            Row(
              children: [
                Icon(
                  Icons.access_time,
                  size: 20,
                  color: theme.colorScheme.primary,
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Delivery Time',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '28 minutes',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPaymentSummary(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Payment Summary',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            _buildSummaryRow(context, 'Subtotal', 'KES 1,910'),
            const SizedBox(height: 8),
            _buildSummaryRow(context, 'Delivery Fee', 'KES 100'),
            const SizedBox(height: 8),
            _buildSummaryRow(context, 'Service Fee', 'KES 50'),
            const SizedBox(height: 8),
            _buildSummaryRow(
              context,
              'Promo Applied',
              '-KES 100',
              valueColor: Colors.green,
            ),
            const Divider(height: 24),
            _buildSummaryRow(
              context,
              'Total Paid',
              'KES 1,960',
              isBold: true,
            ),
            const Divider(height: 24),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Colors.green.shade50,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(
                    Icons.phone_android,
                    color: Colors.green.shade700,
                    size: 20,
                  ),
                ),
                const SizedBox(width: 12),
                Text(
                  'Paid via M-Pesa',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const Spacer(),
                Icon(
                  Icons.check_circle,
                  color: Colors.green,
                  size: 20,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryRow(
    BuildContext context,
    String label,
    String value, {
    bool isBold = false,
    Color? valueColor,
  }) {
    final theme = Theme.of(context);

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: isBold
              ? theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.bold)
              : theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
        ),
        Text(
          value,
          style: isBold
              ? theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.bold)
              : theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                  color: valueColor,
                ),
        ),
      ],
    );
  }

  Widget _buildRatingSection(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Your Rating',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                TextButton(
                  onPressed: () {
                    // Edit rating
                  },
                  child: const Text('Edit'),
                ),
              ],
            ),
            const SizedBox(height: 8),
            // Food rating
            Row(
              children: [
                Text(
                  'Food:',
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(width: 8),
                ...List.generate(5, (index) {
                  return Icon(
                    index < 4 ? Icons.star : Icons.star_border,
                    color: Colors.amber.shade600,
                    size: 20,
                  );
                }),
              ],
            ),
            const SizedBox(height: 8),
            // Delivery rating
            Row(
              children: [
                Text(
                  'Delivery:',
                  style: theme.textTheme.bodyMedium,
                ),
                const SizedBox(width: 8),
                ...List.generate(5, (index) {
                  return Icon(
                    index < 5 ? Icons.star : Icons.star_border,
                    color: Colors.amber.shade600,
                    size: 20,
                  );
                }),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActionButtons(BuildContext context) {
    return Column(
      children: [
        FilledButton.icon(
          onPressed: () {
            // Reorder
          },
          icon: const Icon(Icons.replay),
          label: const Text('Order Again'),
          style: FilledButton.styleFrom(
            minimumSize: const Size(double.infinity, 48),
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () {
            // Get help
          },
          icon: const Icon(Icons.help_outline),
          label: const Text('Get Help'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(double.infinity, 48),
          ),
        ),
      ],
    );
  }
}

class _OrderItem {
  final String name;
  final int quantity;
  final double price;
  final String? notes;

  _OrderItem({
    required this.name,
    required this.quantity,
    required this.price,
    this.notes,
  });
}
