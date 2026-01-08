import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:http/http.dart' as http;

/// Result of a reverse geocoding operation
class GeocodingResult {
  const GeocodingResult({
    required this.formattedAddress,
    required this.location,
    this.placeId,
    this.streetAddress,
    this.locality,
    this.administrativeArea,
    this.country,
    this.postalCode,
  });

  /// Full formatted address
  final String formattedAddress;

  /// The coordinates
  final LatLng location;

  /// Google Place ID (for further details lookup)
  final String? placeId;

  /// Street address (e.g., "123 Main St")
  final String? streetAddress;

  /// City/locality
  final String? locality;

  /// State/province
  final String? administrativeArea;

  /// Country name
  final String? country;

  /// Postal/ZIP code
  final String? postalCode;

  /// Create a dropped pin result when geocoding is unavailable
  factory GeocodingResult.droppedPin(LatLng location) {
    return GeocodingResult(
      formattedAddress: 'Dropped pin',
      location: location,
    );
  }

  /// Get a shortened display address
  String get shortAddress {
    if (streetAddress != null && locality != null) {
      return '$streetAddress, $locality';
    }
    if (locality != null) {
      return locality!;
    }
    return formattedAddress;
  }

  @override
  String toString() => 'GeocodingResult(address: $formattedAddress)';
}

/// Service for geocoding and reverse geocoding operations
class GeocodingService {
  GeocodingService({
    String? apiKey,
    http.Client? httpClient,
  })  : _apiKey = apiKey ?? const String.fromEnvironment('GOOGLE_MAPS_API_KEY'),
        _httpClient = httpClient ?? http.Client();

  final String _apiKey;
  final http.Client _httpClient;

  static const _baseUrl = 'https://maps.googleapis.com/maps/api/geocode/json';

  /// Debounce timer for rapid requests
  Timer? _debounceTimer;

  /// Cache for recent geocoding results
  final Map<String, GeocodingResult> _cache = {};

  /// Generate cache key from coordinates (rounded to ~10m precision)
  String _cacheKey(LatLng location) {
    final lat = (location.latitude * 10000).round() / 10000;
    final lng = (location.longitude * 10000).round() / 10000;
    return '$lat,$lng';
  }

  /// Reverse geocode coordinates to an address
  ///
  /// Returns a [GeocodingResult] with the address information.
  /// If geocoding fails or is unavailable, returns a "Dropped pin" result.
  Future<GeocodingResult> reverseGeocode(LatLng location) async {
    // Check cache first
    final cacheKey = _cacheKey(location);
    if (_cache.containsKey(cacheKey)) {
      return _cache[cacheKey]!;
    }

    // If no API key, return dropped pin
    if (_apiKey.isEmpty) {
      debugPrint('GeocodingService: No API key configured');
      return GeocodingResult.droppedPin(location);
    }

    try {
      final url = Uri.parse(_baseUrl).replace(queryParameters: {
        'latlng': '${location.latitude},${location.longitude}',
        'key': _apiKey,
        'result_type': 'street_address|route|premise|point_of_interest',
        'language': 'en',
      });

      final response = await _httpClient
          .get(url)
          .timeout(const Duration(seconds: 5));

      if (response.statusCode != 200) {
        debugPrint('GeocodingService: HTTP ${response.statusCode}');
        return GeocodingResult.droppedPin(location);
      }

      final json = jsonDecode(response.body) as Map<String, dynamic>;
      final status = json['status'] as String?;

      if (status != 'OK') {
        debugPrint('GeocodingService: Status $status');
        return GeocodingResult.droppedPin(location);
      }

      final results = json['results'] as List<dynamic>?;
      if (results == null || results.isEmpty) {
        return GeocodingResult.droppedPin(location);
      }

      // Parse the first result
      final firstResult = results.first as Map<String, dynamic>;
      final result = _parseResult(firstResult, location);

      // Cache the result
      _cache[cacheKey] = result;

      // Limit cache size
      if (_cache.length > 100) {
        _cache.remove(_cache.keys.first);
      }

      return result;
    } catch (e) {
      debugPrint('GeocodingService: Error $e');
      return GeocodingResult.droppedPin(location);
    }
  }

  /// Reverse geocode with debouncing for rapid pin movement
  ///
  /// [delay] defaults to 300ms as per acceptance criteria
  Future<GeocodingResult> reverseGeocodeDebounced(
    LatLng location, {
    Duration delay = const Duration(milliseconds: 300),
  }) async {
    _debounceTimer?.cancel();

    final completer = Completer<GeocodingResult>();

    _debounceTimer = Timer(delay, () async {
      final result = await reverseGeocode(location);
      if (!completer.isCompleted) {
        completer.complete(result);
      }
    });

    return completer.future;
  }

  /// Parse a geocoding API result into our model
  GeocodingResult _parseResult(Map<String, dynamic> result, LatLng location) {
    final addressComponents =
        result['address_components'] as List<dynamic>? ?? [];

    String? streetNumber;
    String? route;
    String? locality;
    String? administrativeArea;
    String? country;
    String? postalCode;

    for (final component in addressComponents) {
      final types = (component['types'] as List<dynamic>?)?.cast<String>() ?? [];
      final longName = component['long_name'] as String?;

      if (types.contains('street_number')) {
        streetNumber = longName;
      } else if (types.contains('route')) {
        route = longName;
      } else if (types.contains('locality') ||
          types.contains('sublocality_level_1')) {
        locality ??= longName;
      } else if (types.contains('administrative_area_level_1')) {
        administrativeArea = longName;
      } else if (types.contains('country')) {
        country = longName;
      } else if (types.contains('postal_code')) {
        postalCode = longName;
      }
    }

    // Build street address
    String? streetAddress;
    if (streetNumber != null && route != null) {
      streetAddress = '$streetNumber $route';
    } else if (route != null) {
      streetAddress = route;
    }

    return GeocodingResult(
      formattedAddress: result['formatted_address'] as String? ?? 'Unknown address',
      location: location,
      placeId: result['place_id'] as String?,
      streetAddress: streetAddress,
      locality: locality,
      administrativeArea: administrativeArea,
      country: country,
      postalCode: postalCode,
    );
  }

  /// Clear the geocoding cache
  void clearCache() {
    _cache.clear();
  }

  /// Dispose of resources
  void dispose() {
    _debounceTimer?.cancel();
  }
}
