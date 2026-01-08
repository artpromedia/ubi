import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../../../core/services/geocoding_service.dart';

part 'map_picker_state.dart';

/// Cubit for managing the map location picker state
class MapPickerCubit extends Cubit<MapPickerState> {
  MapPickerCubit({
    GeocodingService? geocodingService,
    LatLng? initialLocation,
  })  : _geocodingService = geocodingService ?? GeocodingService(),
        super(MapPickerState(
          pinLocation: initialLocation ?? const LatLng(-1.2921, 36.8219),
          isDragging: false,
          isGeocoding: false,
        ));

  final GeocodingService _geocodingService;

  /// Called when user starts dragging the pin
  void startDragging() {
    emit(state.copyWith(
      isDragging: true,
      geocodingError: null,
    ));
  }

  /// Called when user stops dragging and releases the pin
  Future<void> stopDragging(LatLng newLocation) async {
    emit(state.copyWith(
      isDragging: false,
      isGeocoding: true,
      pinLocation: newLocation,
      geocodingError: null,
    ));

    await _reverseGeocode(newLocation);
  }

  /// Called when camera moves (for camera-centered pin mode)
  void onCameraMove(LatLng center) {
    if (!state.isDragging) {
      emit(state.copyWith(
        isDragging: true,
        pinLocation: center,
      ));
    } else {
      emit(state.copyWith(pinLocation: center));
    }
  }

  /// Called when camera becomes idle
  Future<void> onCameraIdle(LatLng center) async {
    emit(state.copyWith(
      isDragging: false,
      isGeocoding: true,
      pinLocation: center,
      geocodingError: null,
    ));

    await _reverseGeocode(center);
  }

  /// Set initial location (e.g., from current location or search result)
  Future<void> setInitialLocation(LatLng location) async {
    emit(state.copyWith(
      pinLocation: location,
      isGeocoding: true,
    ));

    await _reverseGeocode(location);
  }

  /// Reverse geocode the given location
  Future<void> _reverseGeocode(LatLng location) async {
    try {
      final result = await _geocodingService.reverseGeocode(location);

      // Only update if still at the same location (user might have moved again)
      if (state.pinLocation == location) {
        emit(state.copyWith(
          isGeocoding: false,
          geocodingResult: result,
          geocodingError: null,
        ));
      }
    } catch (e) {
      if (state.pinLocation == location) {
        emit(state.copyWith(
          isGeocoding: false,
          geocodingResult: GeocodingResult.droppedPin(location),
          geocodingError: 'Could not determine address',
        ));
      }
    }
  }

  /// Confirm the current location selection
  void confirmLocation() {
    if (state.geocodingResult != null) {
      emit(state.copyWith(isConfirmed: true));
    }
  }

  /// Reset confirmation state (if user wants to adjust)
  void resetConfirmation() {
    emit(state.copyWith(isConfirmed: false));
  }

  @override
  Future<void> close() {
    _geocodingService.dispose();
    return super.close();
  }
}
