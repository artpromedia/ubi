import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';

/// Order tracking page showing live delivery status
class OrderTrackingPage extends StatefulWidget {
  final String orderId;

  const OrderTrackingPage({
    super.key,
    required this.orderId,
  });

  @override
  State<OrderTrackingPage> createState() => _OrderTrackingPageState();
}

class _OrderTrackingPageState extends State<OrderTrackingPage> {
  final _orderSteps = [
    _OrderStep(
      title: 'Order Confirmed',
      subtitle: 'Your order has been received',
      time: '2:30 PM',
      isCompleted: true,
      isActive: false,
    ),
    _OrderStep(
      title: 'Preparing',
      subtitle: 'Restaurant is preparing your food',
      time: '2:35 PM',
      isCompleted: true,
      isActive: false,
    ),
    _OrderStep(
      title: 'On the Way',
      subtitle: 'Rider is heading to you',
      time: '2:50 PM',
      isCompleted: false,
      isActive: true,
    ),
    _OrderStep(
      title: 'Delivered',
      subtitle: 'Enjoy your meal!',
      time: null,
      isCompleted: false,
      isActive: false,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Track Order'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go(Routes.foodRestaurants),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Estimated time
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    const Text(
                      'Estimated Delivery',
                      style: TextStyle(color: Colors.grey),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '15-20 min',
                      style:
                          Theme.of(context).textTheme.headlineMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.blue.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.delivery_dining,
                            size: 16,
                            color: Colors.blue,
                          ),
                          SizedBox(width: 4),
                          Text(
                            'On the way',
                            style: TextStyle(
                              color: Colors.blue,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Order progress
            Text(
              'Order Progress',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 16),
            ...List.generate(_orderSteps.length, (index) {
              final step = _orderSteps[index];
              final isLast = index == _orderSteps.length - 1;
              return _OrderStepTile(step: step, isLast: isLast);
            }),

            const SizedBox(height: 24),

            // Rider info
            Text(
              'Your Rider',
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
                            'James Mwangi',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                            ),
                          ),
                          Row(
                            children: [
                              Icon(Icons.star, size: 16, color: Colors.amber),
                              Text(' 4.9'),
                            ],
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () {
                        // Call rider
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
                    IconButton(
                      onPressed: () {
                        // Message rider
                      },
                      icon: CircleAvatar(
                        backgroundColor:
                            Theme.of(context).primaryColor.withOpacity(0.1),
                        child: Icon(
                          Icons.message,
                          color: Theme.of(context).primaryColor,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: 24),

            // Order details
            Text(
              'Order Details',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Row(
                      children: [
                        Icon(Icons.restaurant, size: 20),
                        SizedBox(width: 8),
                        Text(
                          'Restaurant Name',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                    const Divider(height: 24),
                    _buildOrderItem('1x', 'Nyama Choma', 'KES 350'),
                    _buildOrderItem('2x', 'Ugali', 'KES 200'),
                    _buildOrderItem('1x', 'Sukuma Wiki', 'KES 50'),
                    const Divider(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Subtotal'),
                        const Text('KES 600'),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Delivery'),
                        const Text('KES 100'),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Total',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                        const Text(
                          'KES 700',
                          style: TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                  ],
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
                label: const Text('Get Help'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOrderItem(String qty, String name, String price) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text(qty, style: TextStyle(color: Colors.grey[600])),
          const SizedBox(width: 12),
          Expanded(child: Text(name)),
          Text(price),
        ],
      ),
    );
  }
}

class _OrderStep {
  final String title;
  final String subtitle;
  final String? time;
  final bool isCompleted;
  final bool isActive;

  _OrderStep({
    required this.title,
    required this.subtitle,
    this.time,
    required this.isCompleted,
    required this.isActive,
  });
}

class _OrderStepTile extends StatelessWidget {
  final _OrderStep step;
  final bool isLast;

  const _OrderStepTile({
    required this.step,
    required this.isLast,
  });

  @override
  Widget build(BuildContext context) {
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
                color: step.isCompleted
                    ? Colors.green
                    : step.isActive
                        ? Theme.of(context).primaryColor
                        : Colors.grey[300],
              ),
              child: step.isCompleted
                  ? const Icon(Icons.check, size: 16, color: Colors.white)
                  : step.isActive
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
                color: step.isCompleted ? Colors.green : Colors.grey[300],
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
                        step.title,
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          color: step.isCompleted || step.isActive
                              ? null
                              : Colors.grey,
                        ),
                      ),
                    ),
                    if (step.time != null)
                      Text(
                        step.time!,
                        style: TextStyle(
                          color: Colors.grey[600],
                          fontSize: 12,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  step.subtitle,
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
}
