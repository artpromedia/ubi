import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../bloc/ride_bloc.dart';
import '../../../core/router/app_router.dart';

/// Ride search page with map and location selection
class RideSearchPage extends StatefulWidget {
  const RideSearchPage({super.key});

  @override
  State<RideSearchPage> createState() => _RideSearchPageState();
}

class _RideSearchPageState extends State<RideSearchPage> {
  GoogleMapController? _mapController;
  final TextEditingController _pickupController = TextEditingController();
  final TextEditingController _dropoffController = TextEditingController();

  // Default to Nairobi
  static const _initialPosition = LatLng(-1.2921, 36.8219);

  @override
  void dispose() {
    _mapController?.dispose();
    _pickupController.dispose();
    _dropoffController.dispose();
    super.dispose();
  }

  void _onMapCreated(GoogleMapController controller) {
    _mapController = controller;
    // Apply dark/light theme to map if needed
  }

  void _searchDestination() {
    // Open destination search
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => const _DestinationSearchSheet(),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // Map
          GoogleMap(
            onMapCreated: _onMapCreated,
            initialCameraPosition: const CameraPosition(
              target: _initialPosition,
              zoom: 14,
            ),
            myLocationEnabled: true,
            myLocationButtonEnabled: false,
            zoomControlsEnabled: false,
            mapToolbarEnabled: false,
          ),

          // Header with search
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  // Search card
                  Card(
                    elevation: 4,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          // Pickup field
                          Row(
                            children: [
                              Container(
                                width: 12,
                                height: 12,
                                decoration: BoxDecoration(
                                  color: Colors.green,
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: Colors.white,
                                    width: 2,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: TextField(
                                  controller: _pickupController,
                                  readOnly: true,
                                  decoration: const InputDecoration(
                                    hintText: 'Current location',
                                    border: InputBorder.none,
                                    contentPadding: EdgeInsets.zero,
                                  ),
                                  onTap: () {
                                    // Open pickup search
                                  },
                                ),
                              ),
                            ],
                          ),
                          const Divider(),
                          // Destination field
                          Row(
                            children: [
                              Container(
                                width: 12,
                                height: 12,
                                decoration: BoxDecoration(
                                  color: Colors.red,
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: Colors.white,
                                    width: 2,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: TextField(
                                  controller: _dropoffController,
                                  readOnly: true,
                                  decoration: const InputDecoration(
                                    hintText: 'Where to?',
                                    border: InputBorder.none,
                                    contentPadding: EdgeInsets.zero,
                                  ),
                                  onTap: _searchDestination,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Quick action buttons
          Positioned(
            bottom: 24,
            left: 16,
            right: 16,
            child: Column(
              children: [
                // Saved places
                Card(
                  elevation: 2,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        _QuickPlaceButton(
                          icon: Icons.home,
                          label: 'Home',
                          onTap: () {
                            // Set home as destination
                          },
                        ),
                        const SizedBox(width: 16),
                        _QuickPlaceButton(
                          icon: Icons.work,
                          label: 'Work',
                          onTap: () {
                            // Set work as destination
                          },
                        ),
                        const SizedBox(width: 16),
                        _QuickPlaceButton(
                          icon: Icons.history,
                          label: 'Recent',
                          onTap: () {
                            // Show recent places
                          },
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),

          // My location button
          Positioned(
            bottom: 140,
            right: 16,
            child: FloatingActionButton(
              mini: true,
              heroTag: 'location',
              onPressed: () {
                // Center map on user location
              },
              child: const Icon(Icons.my_location),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickPlaceButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _QuickPlaceButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).primaryColor.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(
                icon,
                color: Theme.of(context).primaryColor,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _DestinationSearchSheet extends StatefulWidget {
  const _DestinationSearchSheet();

  @override
  State<_DestinationSearchSheet> createState() => _DestinationSearchSheetState();
}

class _DestinationSearchSheetState extends State<_DestinationSearchSheet> {
  final _searchController = TextEditingController();
  List<String> _suggestions = [];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _onSearch(String query) {
    // Search for places
    // This would call the Places API
    setState(() {
      _suggestions = [
        'Kenyatta International Convention Centre',
        'Westgate Shopping Mall',
        'Jomo Kenyatta International Airport',
        'Nairobi National Museum',
        'The Hub Karen',
      ];
    });
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

              // Search field
              Padding(
                padding: const EdgeInsets.all(16),
                child: TextField(
                  controller: _searchController,
                  autofocus: true,
                  decoration: InputDecoration(
                    hintText: 'Search destination',
                    prefixIcon: const Icon(Icons.search),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onChanged: _onSearch,
                ),
              ),

              // Results
              Expanded(
                child: ListView.builder(
                  controller: scrollController,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: _suggestions.length,
                  itemBuilder: (context, index) {
                    final place = _suggestions[index];
                    return ListTile(
                      leading: const Icon(Icons.location_on_outlined),
                      title: Text(place),
                      onTap: () {
                        Navigator.pop(context);
                        // Navigate to ride options
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
