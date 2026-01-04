/// Places Service
///
/// Provides place search and autocomplete functionality using Google Places API.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:injectable/injectable.dart';
import 'package:ubi_core/ubi_core.dart';

/// Configuration for Places service
class PlacesConfig {
  const PlacesConfig({
    required this.apiKey,
    this.language = 'en',
    this.region,
  });

  final String apiKey;
  final String language;
  final String? region;
}

/// Service for place search and autocomplete
@lazySingleton
class PlacesService {
  PlacesService({
    PlacesConfig? config,
    http.Client? httpClient,
  })  : _config = config,
        _httpClient = httpClient ?? http.Client();

  PlacesConfig? _config;
  final http.Client _httpClient;

  static const _baseUrl = 'https://maps.googleapis.com/maps/api/place';

  /// Initialize with API key
  void configure(PlacesConfig config) {
    _config = config;
  }

  /// Search places by query
  Future<Result<List<PlaceSearchResult>>> searchPlaces({
    required String query,
    GeoLocation? location,
    double? radiusMeters,
    String? type,
  }) async {
    _ensureConfigured();

    try {
      final params = <String, String>{
        'query': query,
        'key': _config!.apiKey,
        'language': _config!.language,
      };

      if (location != null) {
        params['location'] = '${location.latitude},${location.longitude}';
      }
      if (radiusMeters != null) {
        params['radius'] = radiusMeters.toString();
      }
      if (type != null) {
        params['type'] = type;
      }
      if (_config!.region != null) {
        params['region'] = _config!.region!;
      }

      final uri = Uri.parse('$_baseUrl/textsearch/json').replace(queryParameters: params);
      final response = await _httpClient.get(uri);

      if (response.statusCode != 200) {
        return Result.failure(ServerFailure('Places API error: ${response.statusCode}'));
      }

      final data = json.decode(response.body) as Map<String, dynamic>;
      final status = data['status'] as String;

      if (status != 'OK' && status != 'ZERO_RESULTS') {
        return Result.failure(ServerFailure('Places API error: $status'));
      }

      final results = (data['results'] as List<dynamic>?)
              ?.map((e) => _parsePlace(e as Map<String, dynamic>))
              .toList() ??
          [];

      return Result.success(results);
    } catch (e) {
      return Result.failure(ServerFailure('Place search failed: $e'));
    }
  }

  /// Autocomplete place input
  Future<Result<List<PlaceSearchResult>>> autocompletePlaces({
    required String input,
    required String sessionToken,
    GeoLocation? location,
    double? radiusMeters,
    List<String>? types,
    String? countryCode,
  }) async {
    _ensureConfigured();

    try {
      final params = <String, String>{
        'input': input,
        'key': _config!.apiKey,
        'sessiontoken': sessionToken,
        'language': _config!.language,
      };

      if (location != null) {
        params['location'] = '${location.latitude},${location.longitude}';
      }
      if (radiusMeters != null) {
        params['radius'] = radiusMeters.toString();
      }
      if (types != null && types.isNotEmpty) {
        params['types'] = types.join('|');
      }
      if (countryCode != null) {
        params['components'] = 'country:$countryCode';
      } else if (_config!.region != null) {
        params['components'] = 'country:${_config!.region}';
      }

      final uri = Uri.parse('$_baseUrl/autocomplete/json').replace(queryParameters: params);
      final response = await _httpClient.get(uri);

      if (response.statusCode != 200) {
        return Result.failure(ServerFailure('Autocomplete API error: ${response.statusCode}'));
      }

      final data = json.decode(response.body) as Map<String, dynamic>;
      final status = data['status'] as String;

      if (status != 'OK' && status != 'ZERO_RESULTS') {
        return Result.failure(ServerFailure('Autocomplete API error: $status'));
      }

      final predictions = (data['predictions'] as List<dynamic>?)
              ?.map((e) => _parsePrediction(e as Map<String, dynamic>))
              .toList() ??
          [];

      return Result.success(predictions);
    } catch (e) {
      return Result.failure(ServerFailure('Autocomplete failed: $e'));
    }
  }

  /// Get place details by place ID
  Future<Result<PlaceDetails>> getPlaceDetails(String placeId) async {
    _ensureConfigured();

    try {
      final params = <String, String>{
        'place_id': placeId,
        'key': _config!.apiKey,
        'language': _config!.language,
        'fields': 'place_id,name,formatted_address,geometry,address_components,types',
      };

      final uri = Uri.parse('$_baseUrl/details/json').replace(queryParameters: params);
      final response = await _httpClient.get(uri);

      if (response.statusCode != 200) {
        return Result.failure(ServerFailure('Place details API error: ${response.statusCode}'));
      }

      final data = json.decode(response.body) as Map<String, dynamic>;
      final status = data['status'] as String;

      if (status != 'OK') {
        return Result.failure(ServerFailure('Place details API error: $status'));
      }

      final result = data['result'] as Map<String, dynamic>;
      return Result.success(_parsePlaceDetails(result));
    } catch (e) {
      return Result.failure(ServerFailure('Get place details failed: $e'));
    }
  }

  /// Get nearby places
  Future<Result<List<PlaceSearchResult>>> getNearbyPlaces({
    required GeoLocation location,
    required double radiusMeters,
    String? type,
    String? keyword,
  }) async {
    _ensureConfigured();

    try {
      final params = <String, String>{
        'location': '${location.latitude},${location.longitude}',
        'radius': radiusMeters.toString(),
        'key': _config!.apiKey,
        'language': _config!.language,
      };

      if (type != null) {
        params['type'] = type;
      }
      if (keyword != null) {
        params['keyword'] = keyword;
      }

      final uri = Uri.parse('$_baseUrl/nearbysearch/json').replace(queryParameters: params);
      final response = await _httpClient.get(uri);

      if (response.statusCode != 200) {
        return Result.failure(ServerFailure('Nearby search API error: ${response.statusCode}'));
      }

      final data = json.decode(response.body) as Map<String, dynamic>;
      final status = data['status'] as String;

      if (status != 'OK' && status != 'ZERO_RESULTS') {
        return Result.failure(ServerFailure('Nearby search API error: $status'));
      }

      final results = (data['results'] as List<dynamic>?)
              ?.map((e) => _parsePlace(e as Map<String, dynamic>))
              .toList() ??
          [];

      return Result.success(results);
    } catch (e) {
      return Result.failure(ServerFailure('Nearby search failed: $e'));
    }
  }

  /// Ensure service is configured with API key
  void _ensureConfigured() {
    if (_config == null || _config!.apiKey.isEmpty) {
      throw StateError('PlacesService not configured. Call configure() with API key first.');
    }
  }

  /// Parse place search result
  PlaceSearchResult _parsePlace(Map<String, dynamic> data) {
    final geometry = data['geometry'] as Map<String, dynamic>?;
    final location = geometry?['location'] as Map<String, dynamic>?;

    return PlaceSearchResult(
      placeId: data['place_id'] as String,
      name: data['name'] as String? ?? '',
      address: data['formatted_address'] as String? ?? '',
      location: location != null
          ? GeoLocation(
              latitude: (location['lat'] as num).toDouble(),
              longitude: (location['lng'] as num).toDouble(),
            )
          : null,
      types: (data['types'] as List<dynamic>?)?.cast<String>(),
    );
  }

  /// Parse autocomplete prediction
  PlaceSearchResult _parsePrediction(Map<String, dynamic> data) {
    final structuredFormatting = data['structured_formatting'] as Map<String, dynamic>?;

    return PlaceSearchResult(
      placeId: data['place_id'] as String,
      name: structuredFormatting?['main_text'] as String? ?? data['description'] as String? ?? '',
      address: structuredFormatting?['secondary_text'] as String? ?? '',
      types: (data['types'] as List<dynamic>?)?.cast<String>(),
    );
  }

  /// Parse place details
  PlaceDetails _parsePlaceDetails(Map<String, dynamic> data) {
    final geometry = data['geometry'] as Map<String, dynamic>?;
    final location = geometry?['location'] as Map<String, dynamic>?;

    // Parse address components
    final addressComponentsList = data['address_components'] as List<dynamic>?;
    final components = <String, String>{};

    if (addressComponentsList != null) {
      for (final component in addressComponentsList) {
        final comp = component as Map<String, dynamic>;
        final types = (comp['types'] as List<dynamic>?)?.cast<String>() ?? [];
        final longName = comp['long_name'] as String?;
        final shortName = comp['short_name'] as String?;

        if (types.contains('street_number') && longName != null) {
          components['streetNumber'] = longName;
        }
        if (types.contains('route') && longName != null) {
          components['street'] = longName;
        }
        if (types.contains('sublocality') && longName != null) {
          components['subLocality'] = longName;
        }
        if (types.contains('locality') && longName != null) {
          components['city'] = longName;
        }
        if (types.contains('administrative_area_level_1') && longName != null) {
          components['state'] = longName;
        }
        if (types.contains('postal_code') && longName != null) {
          components['postalCode'] = longName;
        }
        if (types.contains('country')) {
          if (longName != null) components['country'] = longName;
          if (shortName != null) components['countryCode'] = shortName;
        }
      }
    }

    return PlaceDetails(
      placeId: data['place_id'] as String,
      name: data['name'] as String? ?? '',
      address: data['formatted_address'] as String? ?? '',
      location: location != null
          ? GeoLocation(
              latitude: (location['lat'] as num).toDouble(),
              longitude: (location['lng'] as num).toDouble(),
            )
          : const GeoLocation(latitude: 0, longitude: 0),
      addressComponents: components,
      types: (data['types'] as List<dynamic>?)?.cast<String>(),
    );
  }

  /// Dispose resources
  void dispose() {
    _httpClient.close();
  }
}
