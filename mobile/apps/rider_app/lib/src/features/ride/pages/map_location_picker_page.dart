import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../bloc/map_picker_cubit.dart';
import '../widgets/draggable_map_pin.dart';
import '../../../core/services/geocoding_service.dart';

/// Result returned from the map location picker
class MapPickerResult {
  const MapPickerResult({
    required this.location,
    required this.address,
    this.placeId,
  });

  /// Selected coordinates
  final LatLng location;

  /// Formatted address (or 'Dropped pin' if geocoding unavailable)
  final String address;

  /// Google Place ID if available
  final String? placeId;
}

/// Full-screen map for choosing a location by dragging a pin
class MapLocationPickerPage extends StatefulWidget {
  const MapLocationPickerPage({
    super.key,
    this.initialLocation,
    this.isPickup = true,
    this.title,
  });

  /// Initial location to center the map
  final LatLng? initialLocation;

  /// Whether selecting pickup (green pin) or dropoff (red pin)
  final bool isPickup;

  /// Custom title for the app bar
  final String? title;

  /// Show the map picker and return the selected location
  static Future<MapPickerResult?> show(
    BuildContext context, {
    LatLng? initialLocation,
    bool isPickup = true,
    String? title,
  }) async {
    return Navigator.of(context).push<MapPickerResult>(
      MaterialPageRoute(
        builder: (context) => MapLocationPickerPage(
          initialLocation: initialLocation,
          isPickup: isPickup,
          title: title,
        ),
      ),
    );
  }

  @override
  State<MapLocationPickerPage> createState() => _MapLocationPickerPageState();
}

class _MapLocationPickerPageState extends State<MapLocationPickerPage> {
  GoogleMapController? _mapController;
  late MapPickerCubit _cubit;

  // Default to Nairobi (common for African markets)
  static const _defaultLocation = LatLng(-1.2921, 36.8219);

  @override
  void initState() {
    super.initState();
    _cubit = MapPickerCubit(
      geocodingService: GeocodingService(),
      initialLocation: widget.initialLocation ?? _defaultLocation,
    );

    // Trigger initial geocoding
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _cubit.setInitialLocation(widget.initialLocation ?? _defaultLocation);
    });
  }

  @override
  void dispose() {
    _mapController?.dispose();
    _cubit.close();
    super.dispose();
  }

  void _onMapCreated(GoogleMapController controller) {
    _mapController = controller;
  }

  void _onCameraMove(CameraPosition position) {
    _cubit.onCameraMove(position.target);
  }

  void _onCameraIdle() {
    final state = _cubit.state;
    _cubit.onCameraIdle(state.pinLocation);
  }

  Future<void> _centerOnCurrentLocation() async {
    // In a real app, this would get the user's current location
    // using the location package. For now, we'll just recenter.
    if (_mapController != null) {
      await _mapController!.animateCamera(
        CameraUpdate.newLatLng(_defaultLocation),
      );
    }
  }

  void _confirmLocation() {
    final state = _cubit.state;
    if (state.geocodingResult != null) {
      Navigator.of(context).pop(MapPickerResult(
        location: state.pinLocation,
        address: state.geocodingResult!.formattedAddress,
        placeId: state.geocodingResult!.placeId,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _cubit,
      child: Scaffold(
        extendBodyBehindAppBar: true,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          elevation: 0,
          leading: _buildBackButton(context),
          title: Text(
            widget.title ??
                (widget.isPickup ? 'Set pickup location' : 'Set drop-off location'),
            style: const TextStyle(
              color: Colors.black,
              fontWeight: FontWeight.w600,
            ),
          ),
          centerTitle: true,
        ),
        body: Stack(
          children: [
            // Map
            _buildMap(),

            // Center pin (stays fixed while map moves)
            _buildCenterPin(),

            // Address card at bottom
            _buildAddressCard(),

            // My location button
            _buildMyLocationButton(),
          ],
        ),
      ),
    );
  }

  Widget _buildBackButton(BuildContext context) {
    return Container(
      margin: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: IconButton(
        icon: const Icon(Icons.arrow_back, color: Colors.black),
        onPressed: () => Navigator.of(context).pop(),
      ),
    );
  }

  Widget _buildMap() {
    return BlocBuilder<MapPickerCubit, MapPickerState>(
      builder: (context, state) {
        return GoogleMap(
          onMapCreated: _onMapCreated,
          initialCameraPosition: CameraPosition(
            target: widget.initialLocation ?? _defaultLocation,
            zoom: 16,
          ),
          onCameraMove: _onCameraMove,
          onCameraIdle: _onCameraIdle,
          myLocationEnabled: true,
          myLocationButtonEnabled: false,
          zoomControlsEnabled: false,
          mapToolbarEnabled: false,
          compassEnabled: false,
          // Disable markers since we use a centered pin widget
          markers: const {},
        );
      },
    );
  }

  Widget _buildCenterPin() {
    return BlocBuilder<MapPickerCubit, MapPickerState>(
      buildWhen: (prev, curr) => prev.isDragging != curr.isDragging,
      builder: (context, state) {
        return Center(
          child: Padding(
            // Offset to account for pin height (pointer at bottom)
            padding: const EdgeInsets.only(bottom: 48),
            child: DraggableMapPin(
              isDragging: state.isDragging,
              isPickup: widget.isPickup,
              size: 48,
            ),
          ),
        );
      },
    );
  }

  Widget _buildAddressCard() {
    return Positioned(
      left: 16,
      right: 16,
      bottom: 32,
      child: BlocBuilder<MapPickerCubit, MapPickerState>(
        builder: (context, state) {
          return _AddressPreviewCard(
            address: state.displayAddress,
            shortAddress: state.shortAddress,
            isLoading: state.isGeocoding,
            canConfirm: state.canConfirm,
            hasResolvedAddress: state.hasResolvedAddress,
            onConfirm: _confirmLocation,
            isPickup: widget.isPickup,
          );
        },
      ),
    );
  }

  Widget _buildMyLocationButton() {
    return Positioned(
      right: 16,
      bottom: 200,
      child: FloatingActionButton(
        mini: true,
        heroTag: 'my_location',
        backgroundColor: Colors.white,
        onPressed: _centerOnCurrentLocation,
        child: const Icon(Icons.my_location, color: Colors.black87),
      ),
    );
  }
}

/// Card showing the address preview with confirm button
class _AddressPreviewCard extends StatelessWidget {
  const _AddressPreviewCard({
    required this.address,
    required this.shortAddress,
    required this.isLoading,
    required this.canConfirm,
    required this.hasResolvedAddress,
    required this.onConfirm,
    required this.isPickup,
  });

  final String address;
  final String shortAddress;
  final bool isLoading;
  final bool canConfirm;
  final bool hasResolvedAddress;
  final VoidCallback onConfirm;
  final bool isPickup;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      elevation: 8,
      shadowColor: Colors.black.withOpacity(0.2),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Location type indicator
            Row(
              children: [
                Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: isPickup ? Colors.green : Colors.red,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  isPickup ? 'Pickup location' : 'Drop-off location',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: Colors.grey[600],
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Address with loading indicator
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Main address
                      Text(
                        shortAddress,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (hasResolvedAddress && shortAddress != address) ...[
                        const SizedBox(height: 4),
                        Text(
                          address,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: Colors.grey[600],
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
                if (isLoading)
                  const Padding(
                    padding: EdgeInsets.only(left: 12),
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 16),

            // Confirm button
            ElevatedButton(
              onPressed: canConfirm ? onConfirm : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: theme.primaryColor,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                disabledBackgroundColor: Colors.grey[300],
              ),
              child: Text(
                canConfirm
                    ? 'Confirm location'
                    : (isLoading ? 'Finding address...' : 'Move pin to select'),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),

            // Hint text
            if (!hasResolvedAddress && !isLoading) ...[
              const SizedBox(height: 8),
              Text(
                'Drag the map to adjust pin position',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: Colors.grey[500],
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
