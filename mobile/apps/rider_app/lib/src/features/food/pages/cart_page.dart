import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';

/// Cart page showing order summary and checkout
class CartPage extends StatefulWidget {
  const CartPage({super.key});

  @override
  State<CartPage> createState() => _CartPageState();
}

class _CartPageState extends State<CartPage> {
  String _selectedPayment = 'mpesa';
  final _promoController = TextEditingController();

  // Demo cart items
  final _cartItems = [
    _CartItem(name: 'Nyama Choma', price: 350, quantity: 1),
    _CartItem(name: 'Ugali', price: 100, quantity: 2),
    _CartItem(name: 'Sukuma Wiki', price: 50, quantity: 1),
  ];

  @override
  void dispose() {
    _promoController.dispose();
    super.dispose();
  }

  int get _subtotal =>
      _cartItems.fold(0, (sum, item) => sum + item.price * item.quantity);

  int get _deliveryFee => 100;
  int get _total => _subtotal + _deliveryFee;

  void _updateQuantity(int index, int delta) {
    setState(() {
      final item = _cartItems[index];
      final newQuantity = item.quantity + delta;
      if (newQuantity <= 0) {
        _cartItems.removeAt(index);
      } else {
        _cartItems[index] = _CartItem(
          name: item.name,
          price: item.price,
          quantity: newQuantity,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your Cart'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: _cartItems.isEmpty
          ? _buildEmptyCart()
          : Column(
              children: [
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Restaurant name
                        Card(
                          child: Padding(
                            padding: const EdgeInsets.all(12),
                            child: Row(
                              children: [
                                Container(
                                  width: 40,
                                  height: 40,
                                  decoration: BoxDecoration(
                                    color: Colors.grey[300],
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: const Icon(
                                    Icons.restaurant,
                                    color: Colors.grey,
                                  ),
                                ),
                                const SizedBox(width: 12),
                                const Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Restaurant Name',
                                        style: TextStyle(
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      Text(
                                        'Westlands',
                                        style: TextStyle(color: Colors.grey),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),

                        const SizedBox(height: 16),

                        // Cart items
                        Text(
                          'Your Order',
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                        ),
                        const SizedBox(height: 12),
                        ...List.generate(_cartItems.length, (index) {
                          final item = _cartItems[index];
                          return _CartItemTile(
                            item: item,
                            onIncrement: () => _updateQuantity(index, 1),
                            onDecrement: () => _updateQuantity(index, -1),
                          );
                        }),

                        const SizedBox(height: 16),

                        // Add more items
                        TextButton.icon(
                          onPressed: () => context.pop(),
                          icon: const Icon(Icons.add),
                          label: const Text('Add more items'),
                        ),

                        const SizedBox(height: 16),

                        // Delivery address
                        Text(
                          'Delivery Address',
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                        ),
                        const SizedBox(height: 12),
                        Card(
                          child: ListTile(
                            leading: const Icon(Icons.location_on_outlined),
                            title: const Text('Home'),
                            subtitle: const Text('123 Main St, Westlands'),
                            trailing: TextButton(
                              onPressed: () {
                                // Change address
                              },
                              child: const Text('Change'),
                            ),
                          ),
                        ),

                        const SizedBox(height: 16),

                        // Promo code
                        Text(
                          'Promo Code',
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: _promoController,
                                decoration: InputDecoration(
                                  hintText: 'Enter promo code',
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  contentPadding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                    vertical: 12,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            ElevatedButton(
                              onPressed: () {
                                // Apply promo code
                              },
                              child: const Text('Apply'),
                            ),
                          ],
                        ),

                        const SizedBox(height: 16),

                        // Payment method
                        Text(
                          'Payment Method',
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                        ),
                        const SizedBox(height: 12),
                        _PaymentOption(
                          value: 'mpesa',
                          groupValue: _selectedPayment,
                          title: 'M-Pesa',
                          subtitle: '254712345678',
                          icon: Icons.phone_android,
                          onChanged: (v) => setState(() => _selectedPayment = v!),
                        ),
                        _PaymentOption(
                          value: 'card',
                          groupValue: _selectedPayment,
                          title: 'Credit/Debit Card',
                          subtitle: '**** **** **** 1234',
                          icon: Icons.credit_card,
                          onChanged: (v) => setState(() => _selectedPayment = v!),
                        ),
                        _PaymentOption(
                          value: 'cash',
                          groupValue: _selectedPayment,
                          title: 'Cash on Delivery',
                          subtitle: 'Pay when your order arrives',
                          icon: Icons.money,
                          onChanged: (v) => setState(() => _selectedPayment = v!),
                        ),

                        const SizedBox(height: 24),

                        // Order summary
                        Text(
                          'Order Summary',
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
                                _SummaryRow(
                                  label: 'Subtotal',
                                  value: 'KES $_subtotal',
                                ),
                                const SizedBox(height: 8),
                                _SummaryRow(
                                  label: 'Delivery Fee',
                                  value: 'KES $_deliveryFee',
                                ),
                                const Divider(height: 24),
                                _SummaryRow(
                                  label: 'Total',
                                  value: 'KES $_total',
                                  isBold: true,
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                // Checkout button
                SafeArea(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: ElevatedButton(
                      onPressed: () {
                        // Place order
                        context.go('${Routes.foodOrderTracking}/order123');
                      },
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        minimumSize: const Size.fromHeight(56),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: Text('Place Order - KES $_total'),
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildEmptyCart() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.shopping_cart_outlined,
            size: 80,
            color: Colors.grey[400],
          ),
          const SizedBox(height: 16),
          const Text(
            'Your cart is empty',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'Add items to get started',
            style: TextStyle(color: Colors.grey[600]),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: () => context.go(Routes.foodRestaurants),
            child: const Text('Browse Restaurants'),
          ),
        ],
      ),
    );
  }
}

class _CartItem {
  final String name;
  final int price;
  final int quantity;

  _CartItem({
    required this.name,
    required this.price,
    required this.quantity,
  });
}

class _CartItemTile extends StatelessWidget {
  final _CartItem item;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;

  const _CartItemTile({
    required this.item,
    required this.onIncrement,
    required this.onDecrement,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          children: [
            Container(
              width: 50,
              height: 50,
              decoration: BoxDecoration(
                color: Colors.grey[300],
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.fastfood, color: Colors.grey),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.name,
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                  Text(
                    'KES ${item.price}',
                    style: TextStyle(color: Colors.grey[600]),
                  ),
                ],
              ),
            ),
            Row(
              children: [
                IconButton(
                  onPressed: onDecrement,
                  icon: const Icon(Icons.remove_circle_outline),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Text(
                    '${item.quantity}',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
                IconButton(
                  onPressed: onIncrement,
                  icon: const Icon(Icons.add_circle_outline),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PaymentOption extends StatelessWidget {
  final String value;
  final String groupValue;
  final String title;
  final String subtitle;
  final IconData icon;
  final ValueChanged<String?> onChanged;

  const _PaymentOption({
    required this.value,
    required this.groupValue,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: RadioListTile<String>(
        value: value,
        groupValue: groupValue,
        onChanged: onChanged,
        title: Text(title),
        subtitle: Text(subtitle),
        secondary: Icon(icon),
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String label;
  final String value;
  final bool isBold;

  const _SummaryRow({
    required this.label,
    required this.value,
    this.isBold = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
            fontSize: isBold ? 16 : 14,
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
            fontSize: isBold ? 16 : 14,
          ),
        ),
      ],
    );
  }
}
