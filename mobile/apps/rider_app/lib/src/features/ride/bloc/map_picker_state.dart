part of 'map_picker_cubit.dart';

/// State for the map location picker
class MapPickerState extends Equatable {
  const MapPickerState({
    required this.pinLocation,
    required this.isDragging,
    required this.isGeocoding,
    this.geocodingResult,
    this.geocodingError,
    this.isConfirmed = false,
  });

  /// Current pin location
  final LatLng pinLocation;

  /// Whether user is currently dragging the pin/map
  final bool isDragging;

  /// Whether geocoding is in progress
  final bool isGeocoding;

  /// Result of reverse geocoding
  final GeocodingResult? geocodingResult;

  /// Error message if geocoding failed
  final String? geocodingError;

  /// Whether user has confirmed this location
  final bool isConfirmed;

  /// Address to display (or placeholder while loading)
  String get displayAddress {
    if (isGeocoding) {
      return 'Finding address...';
    }
    return geocodingResult?.formattedAddress ?? 'Dropped pin';
  }

  /// Short address for compact display
  String get shortAddress {
    if (isGeocoding) {
      return 'Finding address...';
    }
    return geocodingResult?.shortAddress ?? 'Dropped pin';
  }

  /// Whether the confirm button should be enabled
  bool get canConfirm {
    return !isDragging && !isGeocoding && geocodingResult != null;
  }

  /// Whether we have a valid resolved address (not just dropped pin)
  bool get hasResolvedAddress {
    return geocodingResult != null &&
        geocodingResult!.formattedAddress != 'Dropped pin';
  }

  MapPickerState copyWith({
    LatLng? pinLocation,
    bool? isDragging,
    bool? isGeocoding,
    GeocodingResult? geocodingResult,
    String? geocodingError,
    bool? isConfirmed,
  }) {
    return MapPickerState(
      pinLocation: pinLocation ?? this.pinLocation,
      isDragging: isDragging ?? this.isDragging,
      isGeocoding: isGeocoding ?? this.isGeocoding,
      geocodingResult: geocodingResult ?? this.geocodingResult,
      geocodingError: geocodingError ?? this.geocodingError,
      isConfirmed: isConfirmed ?? this.isConfirmed,
    );
  }

  @override
  List<Object?> get props => [
        pinLocation,
        isDragging,
        isGeocoding,
        geocodingResult,
        geocodingError,
        isConfirmed,
      ];
}
