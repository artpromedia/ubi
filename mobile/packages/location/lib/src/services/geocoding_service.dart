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
        return Result.failure(const ServerFailure('No location found for address'));
      }

      final location = locations.first;
      return Result.success(GeoLocation(
        latitude: location.latitude,
        longitude: location.longitude,
      ));
    } on geo.NoResultFoundException {
      return Result.failure(const ServerFailure('No location found for address'));
    } catch (e) {
      return Result.failure(ServerFailure('Geocoding failed: $e'));
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
        return Result.failure(const ServerFailure('No address found for location'));
      }

      final placemark = placemarks.first;
      final formattedAddress = _formatAddress(placemark);

      return Result.success(PlaceDetails(
        placeId: '${latitude}_$longitude',
        name: placemark.name ?? formattedAddress,
        address: formattedAddress,
        location: GeoLocation(
          latitude: latitude,
          longitude: longitude,
        ),
        addressComponents: _extractComponents(placemark),
      ));
    } on geo.NoResultFoundException {
      return Result.failure(const ServerFailure('No address found for location'));
    } catch (e) {
      return Result.failure(ServerFailure('Reverse geocoding failed: $e'));
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
  Map<String, String> _extractComponents(geo.Placemark placemark) {
    final components = <String, String>{};

    if (placemark.street?.isNotEmpty == true) {
      components['street'] = placemark.street!;
    }
    if (placemark.subLocality?.isNotEmpty == true) {
      components['subLocality'] = placemark.subLocality!;
    }
    if (placemark.locality?.isNotEmpty == true) {
      components['city'] = placemark.locality!;
    }
    if (placemark.administrativeArea?.isNotEmpty == true) {
      components['state'] = placemark.administrativeArea!;
    }
    if (placemark.postalCode?.isNotEmpty == true) {
      components['postalCode'] = placemark.postalCode!;
    }
    if (placemark.country?.isNotEmpty == true) {
      components['country'] = placemark.country!;
    }
    if (placemark.isoCountryCode?.isNotEmpty == true) {
      components['countryCode'] = placemark.isoCountryCode!;
    }

    return components;
  }
}
