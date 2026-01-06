/// Geocoding Service
///
/// Provides address-to-coordinates and coordinates-to-address conversion.
library;

import 'package:geocoding/geocoding.dart' as geo;
import 'package:injectable/injectable.dart';
import 'package:ubi_core/ubi_core.dart';

/// Service for geocoding and reverse geocoding
@lazySingleton
class GeocodingService {
  /// Convert address string to coordinates
  Future<Result<GeoLocation>> geocode(String address) async {
    try {
      final locations = await geo.locationFromAddress(address);

      if (locations.isEmpty) {
        return Result.failure(const Failure.server(message: 'No location found for address'));
      }

      final location = locations.first;
      return Result.success(GeoLocation(
        latitude: location.latitude,
        longitude: location.longitude,
      ));
    } on geo.NoResultFoundException {
      return Result.failure(const Failure.server(message: 'No location found for address'));
    } catch (e) {
      return Result.failure(Failure.server(message: 'Geocoding failed: $e'));
    }
  }

  /// Convert coordinates to address (reverse geocoding)
  Future<Result<PlaceDetails>> reverseGeocode({
    required double latitude,
    required double longitude,
  }) async {
    try {
      final placemarks = await geo.placemarkFromCoordinates(latitude, longitude);

      if (placemarks.isEmpty) {
        return Result.failure(const Failure.server(message: 'No address found for location'));
      }

      final placemark = placemarks.first;
      final formattedAddress = _formatAddress(placemark);

      return Result.success(PlaceDetails(
        placeId: '${latitude}_$longitude',
        name: placemark.name ?? formattedAddress,
        formattedAddress: formattedAddress,
        location: GeoLocation(
          latitude: latitude,
          longitude: longitude,
        ),
        addressComponents: _extractComponents(placemark),
      ));
    } on geo.NoResultFoundException {
      return Result.failure(const Failure.server(message: 'No address found for location'));
    } catch (e) {
      return Result.failure(Failure.server(message: 'Reverse geocoding failed: $e'));
    }
  }

  /// Format placemark into human-readable address
  String _formatAddress(geo.Placemark placemark) {
    final parts = <String>[];

    if (placemark.street?.isNotEmpty == true) {
      parts.add(placemark.street!);
    }
    if (placemark.subLocality?.isNotEmpty == true) {
      parts.add(placemark.subLocality!);
    }
    if (placemark.locality?.isNotEmpty == true) {
      parts.add(placemark.locality!);
    }
    if (placemark.administrativeArea?.isNotEmpty == true) {
      parts.add(placemark.administrativeArea!);
    }
    if (placemark.postalCode?.isNotEmpty == true) {
      parts.add(placemark.postalCode!);
    }
    if (placemark.country?.isNotEmpty == true) {
      parts.add(placemark.country!);
    }

    return parts.join(', ');
  }

  /// Extract address components from placemark
  List<AddressComponent> _extractComponents(geo.Placemark placemark) {
    final components = <AddressComponent>[];

    if (placemark.street?.isNotEmpty == true) {
      components.add(AddressComponent(
        longName: placemark.street!,
        shortName: placemark.street!,
        types: ['route'],
      ));
    }
    if (placemark.subLocality?.isNotEmpty == true) {
      components.add(AddressComponent(
        longName: placemark.subLocality!,
        shortName: placemark.subLocality!,
        types: ['sublocality'],
      ));
    }
    if (placemark.locality?.isNotEmpty == true) {
      components.add(AddressComponent(
        longName: placemark.locality!,
        shortName: placemark.locality!,
        types: ['locality'],
      ));
    }
    if (placemark.administrativeArea?.isNotEmpty == true) {
      components.add(AddressComponent(
        longName: placemark.administrativeArea!,
        shortName: placemark.administrativeArea!,
        types: ['administrative_area_level_1'],
      ));
    }
    if (placemark.postalCode?.isNotEmpty == true) {
      components.add(AddressComponent(
        longName: placemark.postalCode!,
        shortName: placemark.postalCode!,
        types: ['postal_code'],
      ));
    }
    if (placemark.country?.isNotEmpty == true) {
      components.add(AddressComponent(
        longName: placemark.country!,
        shortName: placemark.isoCountryCode ?? placemark.country!,
        types: ['country'],
      ));
    }

    return components;
  }
}
