import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../core/router/app_router.dart';

/// New delivery request page
class DeliveryNewPage extends StatefulWidget {
  const DeliveryNewPage({super.key});

  @override
  State<DeliveryNewPage> createState() => _DeliveryNewPageState();
}

class _DeliveryNewPageState extends State<DeliveryNewPage> {
  final _formKey = GlobalKey<FormState>();
  final _pickupController = TextEditingController();
  final _dropoffController = TextEditingController();
  final _recipientNameController = TextEditingController();
  final _recipientPhoneController = TextEditingController();
  final _packageDescriptionController = TextEditingController();

  String _selectedSize = 'small';

  final _sizes = [
    _PackageSize(
      id: 'small',
      name: 'Small',
      description: 'Documents, phones, small items',
      icon: Icons.inventory_2_outlined,
      price: 150,
    ),
    _PackageSize(
      id: 'medium',
      name: 'Medium',
      description: 'Shoes, books, food packages',
      icon: Icons.shopping_bag_outlined,
      price: 250,
    ),
    _PackageSize(
      id: 'large',
      name: 'Large',
      description: 'Boxes, electronics, clothing',
      icon: Icons.all_inbox_outlined,
      price: 400,
    ),
  ];

  @override
  void dispose() {
    _pickupController.dispose();
    _dropoffController.dispose();
    _recipientNameController.dispose();
    _recipientPhoneController.dispose();
    _packageDescriptionController.dispose();
    super.dispose();
  }

  void _onSubmit() {
    if (_formKey.currentState?.validate() ?? false) {
      // Request delivery
      context.go('${Routes.deliveryTracking}/delivery123');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Send Package'),
      ),
      body: Form(
        key: _formKey,
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Mini map
              Container(
                height: 150,
                decoration: BoxDecoration(
                  color: Colors.grey[300],
                  borderRadius: BorderRadius.circular(12),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: const Center(
                    child: Icon(
                      Icons.map,
                      size: 48,
                      color: Colors.grey,
                    ),
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Pickup location
              Text(
                'Pickup Location',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _pickupController,
                decoration: InputDecoration(
                  hintText: 'Enter pickup address',
                  prefixIcon: const Icon(Icons.my_location, color: Colors.green),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter pickup location';
                  }
                  return null;
                },
              ),

              const SizedBox(height: 16),

              // Dropoff location
              Text(
                'Dropoff Location',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _dropoffController,
                decoration: InputDecoration(
                  hintText: 'Enter delivery address',
                  prefixIcon: const Icon(Icons.location_on, color: Colors.red),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter delivery location';
                  }
                  return null;
                },
              ),

              const SizedBox(height: 24),

              // Recipient info
              Text(
                'Recipient Details',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _recipientNameController,
                decoration: InputDecoration(
                  hintText: 'Recipient name',
                  prefixIcon: const Icon(Icons.person_outline),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter recipient name';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _recipientPhoneController,
                keyboardType: TextInputType.phone,
                decoration: InputDecoration(
                  hintText: 'Recipient phone number',
                  prefixIcon: const Icon(Icons.phone_outlined),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Please enter recipient phone';
                  }
                  return null;
                },
              ),

              const SizedBox(height: 24),

              // Package size
              Text(
                'Package Size',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 12),
              ...List.generate(_sizes.length, (index) {
                final size = _sizes[index];
                return _PackageSizeOption(
                  size: size,
                  isSelected: _selectedSize == size.id,
                  onTap: () => setState(() => _selectedSize = size.id),
                );
              }),

              const SizedBox(height: 16),

              // Package description
              Text(
                'Package Description',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _packageDescriptionController,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: 'Describe what you are sending (optional)',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Summary
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Distance'),
                          const Text('5.2 km'),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Estimated Time'),
                          const Text('20-30 min'),
                        ],
                      ),
                      const Divider(height: 24),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Total',
                            style: TextStyle(fontWeight: FontWeight.bold),
                          ),
                          Text(
                            'KES ${_sizes.firstWhere((s) => s.id == _selectedSize).price}',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 18,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Submit button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _onSubmit,
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: const Text('Request Pickup'),
                ),
              ),

              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
    );
  }
}

class _PackageSize {
  final String id;
  final String name;
  final String description;
  final IconData icon;
  final int price;

  _PackageSize({
    required this.id,
    required this.name,
    required this.description,
    required this.icon,
    required this.price,
  });
}

class _PackageSizeOption extends StatelessWidget {
  final _PackageSize size;
  final bool isSelected;
  final VoidCallback onTap;

  const _PackageSizeOption({
    required this.size,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: isSelected
              ? Theme.of(context).primaryColor
              : Colors.transparent,
          width: 2,
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(
                size.icon,
                size: 32,
                color: isSelected
                    ? Theme.of(context).primaryColor
                    : Colors.grey,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      size.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    Text(
                      size.description,
                      style: TextStyle(
                        color: Colors.grey[600],
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                'KES ${size.price}',
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: isSelected
                      ? Theme.of(context).primaryColor
                      : null,
                ),
              ),
              if (isSelected) ...[
                const SizedBox(width: 8),
                Icon(
                  Icons.check_circle,
                  color: Theme.of(context).primaryColor,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
