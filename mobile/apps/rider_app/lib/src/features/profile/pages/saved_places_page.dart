import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';

/// Saved places page
class SavedPlacesPage extends StatefulWidget {
  const SavedPlacesPage({super.key});

  @override
  State<SavedPlacesPage> createState() => _SavedPlacesPageState();
}

class _SavedPlacesPageState extends State<SavedPlacesPage> {
  final _places = [
    _SavedPlace(
      id: '1',
      name: 'Home',
      address: '123 Main Street, Westlands, Nairobi',
      icon: Icons.home,
    ),
    _SavedPlace(
      id: '2',
      name: 'Work',
      address: 'KICC, City Hall Way, Nairobi CBD',
      icon: Icons.work,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Saved Places'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Add new place buttons
          Row(
            children: [
              Expanded(
                child: _AddPlaceButton(
                  icon: Icons.home,
                  label: 'Add Home',
                  isSet: _places.any((p) => p.name == 'Home'),
                  onTap: () => _addPlace('Home'),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: _AddPlaceButton(
                  icon: Icons.work,
                  label: 'Add Work',
                  isSet: _places.any((p) => p.name == 'Work'),
                  onTap: () => _addPlace('Work'),
                ),
              ),
            ],
          ),

          const SizedBox(height: 24),

          // Saved places list
          if (_places.isEmpty)
            Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.bookmark_outline,
                    size: 64,
                    color: Colors.grey[400],
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'No saved places yet',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Add your favorite places for quick access',
                    style: TextStyle(color: Colors.grey[600]),
                  ),
                ],
              ),
            )
          else
            ...List.generate(_places.length, (index) {
              final place = _places[index];
              return _SavedPlaceTile(
                place: place,
                onEdit: () => _editPlace(place),
                onDelete: () => _deletePlace(place),
              );
            }),

          const SizedBox(height: 16),

          // Add another place
          OutlinedButton.icon(
            onPressed: () => _addPlace(null),
            icon: const Icon(Icons.add),
            label: const Text('Add Another Place'),
          ),
        ],
      ),
    );
  }

  void _addPlace(String? type) {
    // Navigate to place search
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => _AddPlaceSheet(
        type: type,
        onSave: (name, address) {
          setState(() {
            _places.add(_SavedPlace(
              id: DateTime.now().toString(),
              name: name,
              address: address,
              icon: name == 'Home'
                  ? Icons.home
                  : name == 'Work'
                      ? Icons.work
                      : Icons.bookmark,
            ));
          });
        },
      ),
    );
  }

  void _editPlace(_SavedPlace place) {
    // Edit place
  }

  void _deletePlace(_SavedPlace place) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Place'),
        content: Text('Are you sure you want to delete "${place.name}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              Navigator.pop(context);
              setState(() {
                _places.removeWhere((p) => p.id == place.id);
              });
            },
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}

class _SavedPlace {
  final String id;
  final String name;
  final String address;
  final IconData icon;

  _SavedPlace({
    required this.id,
    required this.name,
    required this.address,
    required this.icon,
  });
}

class _AddPlaceButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isSet;
  final VoidCallback onTap;

  const _AddPlaceButton({
    required this.icon,
    required this.label,
    required this.isSet,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Icon(
                icon,
                size: 32,
                color: isSet
                    ? Theme.of(context).primaryColor
                    : Colors.grey,
              ),
              const SizedBox(height: 8),
              Text(
                isSet ? label.replaceFirst('Add ', '') : label,
                style: TextStyle(
                  fontWeight: isSet ? FontWeight.bold : FontWeight.normal,
                ),
              ),
              if (isSet)
                const Icon(
                  Icons.check_circle,
                  size: 16,
                  color: Colors.green,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SavedPlaceTile extends StatelessWidget {
  final _SavedPlace place;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _SavedPlaceTile({
    required this.place,
    required this.onEdit,
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
            place.icon,
            color: Theme.of(context).primaryColor,
          ),
        ),
        title: Text(
          place.name,
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text(
          place.address,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: PopupMenuButton(
          itemBuilder: (context) => [
            const PopupMenuItem(
              value: 'edit',
              child: Row(
                children: [
                  Icon(Icons.edit),
                  SizedBox(width: 8),
                  Text('Edit'),
                ],
              ),
            ),
            const PopupMenuItem(
              value: 'delete',
              child: Row(
                children: [
                  Icon(Icons.delete, color: Colors.red),
                  SizedBox(width: 8),
                  Text('Delete', style: TextStyle(color: Colors.red)),
                ],
              ),
            ),
          ],
          onSelected: (value) {
            if (value == 'edit') {
              onEdit();
            } else if (value == 'delete') {
              onDelete();
            }
          },
        ),
      ),
    );
  }
}

class _AddPlaceSheet extends StatefulWidget {
  final String? type;
  final Function(String name, String address) onSave;

  const _AddPlaceSheet({
    this.type,
    required this.onSave,
  });

  @override
  State<_AddPlaceSheet> createState() => _AddPlaceSheetState();
}

class _AddPlaceSheetState extends State<_AddPlaceSheet> {
  final _searchController = TextEditingController();
  String? _selectedName;

  @override
  void initState() {
    super.initState();
    _selectedName = widget.type;
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.9,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
          ),
          child: Column(
            children: [
              // Handle
              Container(
                margin: const EdgeInsets.symmetric(vertical: 8),
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.grey[300],
                  borderRadius: BorderRadius.circular(2),
                ),
              ),

              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.type != null
                          ? 'Set ${widget.type}'
                          : 'Add New Place',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                    const SizedBox(height: 16),

                    // Name input (if custom)
                    if (widget.type == null) ...[
                      TextField(
                        decoration: InputDecoration(
                          labelText: 'Place Name',
                          hintText: 'e.g., Gym, School',
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                        ),
                        onChanged: (value) {
                          setState(() {
                            _selectedName = value;
                          });
                        },
                      ),
                      const SizedBox(height: 16),
                    ],

                    // Search field
                    TextField(
                      controller: _searchController,
                      decoration: InputDecoration(
                        hintText: 'Search for address',
                        prefixIcon: const Icon(Icons.search),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // Results
              Expanded(
                child: ListView.builder(
                  controller: scrollController,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: 5,
                  itemBuilder: (context, index) {
                    return ListTile(
                      leading: const Icon(Icons.location_on_outlined),
                      title: Text('Address ${index + 1}'),
                      subtitle: Text('Full address details ${index + 1}'),
                      onTap: () {
                        widget.onSave(
                          _selectedName ?? widget.type ?? 'Place',
                          'Full address details ${index + 1}',
                        );
                        Navigator.pop(context);
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
