import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Payment methods page
class PaymentMethodsPage extends StatefulWidget {
  const PaymentMethodsPage({super.key});

  @override
  State<PaymentMethodsPage> createState() => _PaymentMethodsPageState();
}

class _PaymentMethodsPageState extends State<PaymentMethodsPage> {
  final _paymentMethods = [
    _PaymentMethod(
      id: '1',
      type: 'mpesa',
      name: 'M-Pesa',
      details: '+254 712 345 678',
      icon: Icons.phone_android,
      isDefault: true,
    ),
    _PaymentMethod(
      id: '2',
      type: 'mtn',
      name: 'MTN Mobile Money',
      details: '+256 777 123 456',
      icon: Icons.phone_android,
      isDefault: false,
    ),
    _PaymentMethod(
      id: '3',
      type: 'card',
      name: 'Visa',
      details: '**** **** **** 1234',
      icon: Icons.credit_card,
      isDefault: false,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Payment Methods'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Payment methods list
          ...List.generate(_paymentMethods.length, (index) {
            final method = _paymentMethods[index];
            return _PaymentMethodTile(
              method: method,
              onSetDefault: () => _setDefault(method),
              onDelete: () => _deleteMethod(method),
            );
          }),

          const SizedBox(height: 24),

          // Add payment method
          Text(
            'Add Payment Method',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          const SizedBox(height: 12),

          _AddPaymentOption(
            icon: Icons.phone_android,
            title: 'M-Pesa',
            subtitle: 'Pay with M-Pesa',
            onTap: () => _addMpesa(),
          ),
          _AddPaymentOption(
            icon: Icons.phone_android,
            title: 'MTN Mobile Money',
            subtitle: 'Pay with MTN MoMo',
            onTap: () => _addMtn(),
          ),
          _AddPaymentOption(
            icon: Icons.credit_card,
            title: 'Credit/Debit Card',
            subtitle: 'Visa, Mastercard',
            onTap: () => _addCard(),
          ),
          _AddPaymentOption(
            icon: Icons.money,
            title: 'Cash',
            subtitle: 'Pay cash to driver',
            onTap: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Cash is always available')),
              );
            },
          ),
        ],
      ),
    );
  }

  void _setDefault(_PaymentMethod method) {
    setState(() {
      for (var m in _paymentMethods) {
        m.isDefault = m.id == method.id;
      }
    });
  }

  void _deleteMethod(_PaymentMethod method) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove Payment Method'),
        content: Text('Remove ${method.name} (${method.details})?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              setState(() {
                _paymentMethods.removeWhere((m) => m.id == method.id);
              });
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
  }

  void _addMpesa() {
    _showAddPhoneSheet('M-Pesa', '+254');
  }

  void _addMtn() {
    _showAddPhoneSheet('MTN Mobile Money', '+256');
  }

  void _showAddPhoneSheet(String name, String prefix) {
    final controller = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Container(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Add $name',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: controller,
                keyboardType: TextInputType.phone,
                decoration: InputDecoration(
                  labelText: 'Phone Number',
                  prefixText: '$prefix ',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    if (controller.text.isNotEmpty) {
                      setState(() {
                        _paymentMethods.add(_PaymentMethod(
                          id: DateTime.now().toString(),
                          type: name == 'M-Pesa' ? 'mpesa' : 'mtn',
                          name: name,
                          details: '$prefix ${controller.text}',
                          icon: Icons.phone_android,
                          isDefault: _paymentMethods.isEmpty,
                        ));
                      });
                      Navigator.pop(context);
                    }
                  },
                  child: const Text('Add'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _addCard() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom,
        ),
        child: Container(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Add Card',
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 16),
              TextField(
                keyboardType: TextInputType.number,
                decoration: InputDecoration(
                  labelText: 'Card Number',
                  hintText: '1234 5678 9012 3456',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      decoration: InputDecoration(
                        labelText: 'Expiry',
                        hintText: 'MM/YY',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      obscureText: true,
                      decoration: InputDecoration(
                        labelText: 'CVV',
                        hintText: '123',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    setState(() {
                      _paymentMethods.add(_PaymentMethod(
                        id: DateTime.now().toString(),
                        type: 'card',
                        name: 'Visa',
                        details: '**** **** **** ${DateTime.now().millisecond}',
                        icon: Icons.credit_card,
                        isDefault: _paymentMethods.isEmpty,
                      ));
                    });
                    Navigator.pop(context);
                  },
                  child: const Text('Add Card'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PaymentMethod {
  final String id;
  final String type;
  final String name;
  final String details;
  final IconData icon;
  bool isDefault;

  _PaymentMethod({
    required this.id,
    required this.type,
    required this.name,
    required this.details,
    required this.icon,
    required this.isDefault,
  });
}

class _PaymentMethodTile extends StatelessWidget {
  final _PaymentMethod method;
  final VoidCallback onSetDefault;
  final VoidCallback onDelete;

  const _PaymentMethodTile({
    required this.method,
    required this.onSetDefault,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: Theme.of(context).primaryColor.withOpacity(0.1),
          child: Icon(
            method.icon,
            color: Theme.of(context).primaryColor,
          ),
        ),
        title: Row(
          children: [
            Text(
              method.name,
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            if (method.isDefault) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 2,
                ),
                decoration: BoxDecoration(
                  color: Colors.green.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Text(
                  'Default',
                  style: TextStyle(
                    color: Colors.green,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ],
        ),
        subtitle: Text(method.details),
        trailing: PopupMenuButton(
          itemBuilder: (context) => [
            if (!method.isDefault)
              const PopupMenuItem(
                value: 'default',
                child: Row(
                  children: [
                    Icon(Icons.check),
                    SizedBox(width: 8),
                    Text('Set as Default'),
                  ],
                ),
              ),
            const PopupMenuItem(
              value: 'delete',
              child: Row(
                children: [
                  Icon(Icons.delete, color: Colors.red),
                  SizedBox(width: 8),
                  Text('Remove', style: TextStyle(color: Colors.red)),
                ],
              ),
            ),
          ],
          onSelected: (value) {
            if (value == 'default') {
              onSetDefault();
            } else if (value == 'delete') {
              onDelete();
            }
          },
        ),
      ),
    );
  }
}

class _AddPaymentOption extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _AddPaymentOption({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(icon),
        title: Text(title),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.add),
        onTap: onTap,
      ),
    );
  }
}
