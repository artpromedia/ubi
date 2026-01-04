import '../../core/result/result.dart';
import '../entities/ride.dart';
import '../entities/location.dart';

/// Ride repository interface
abstract class RideRepository {
  /// Get ride estimates for a route
  Future<Result<List<RideEstimate>>> getEstimates({
    required GeoLocation pickup,
    required GeoLocation dropoff,
  });

  /// Request a new ride
  Future<Result<Ride>> requestRide(RideRequest request);

  /// Get ride by ID
  Future<Result<Ride>> getRideById(String rideId);

  /// Get current active ride
  Future<Result<Ride?>> getCurrentRide();

  /// Get ride history
  Future<Result<List<Ride>>> getRideHistory({
    int page = 1,
    int limit = 20,
  });

  /// Cancel a ride
  Future<Result<Ride>> cancelRide(
    String rideId, {
    CancellationReason? reason,
    String? note,
  });

  /// Rate a completed ride
  Future<Result<Ride>> rateRide(
    String rideId, {
    required double rating,
    String? review,
  });

  /// Update ride tip
  Future<Result<Ride>> updateTip(String rideId, double tipAmount);

  /// Get driver location stream
  Stream<Result<GeoLocation>> getDriverLocationStream(String rideId);

  /// Get ride status stream
  Stream<Result<Ride>> getRideStatusStream(String rideId);

  /// Get saved places
  Future<Result<List<SavedPlace>>> getSavedPlaces();

  /// Add saved place
  Future<Result<SavedPlace>> addSavedPlace(SavedPlace place);

  /// Remove saved place
  Future<Result<void>> removeSavedPlace(String placeId);

  /// Search places
  Future<Result<List<PlaceSearchResult>>> searchPlaces(
    String query, {
    GeoLocation? nearLocation,
  });

  /// Get place details
  Future<Result<PlaceDetails>> getPlaceDetails(String placeId);

  /// Reverse geocode location
  Future<Result<String>> reverseGeocode(GeoLocation location);

  /// Get route polyline
  Future<Result<List<GeoLocation>>> getRoutePolyline(
    GeoLocation pickup,
    GeoLocation dropoff,
  );
}

/// Saved place entity
class SavedPlace {
  final String id;
  final String name;
  final String address;
  final GeoLocation location;
  final SavedPlaceType type;
  final DateTime? createdAt;

  const SavedPlace({
    required this.id,
    required this.name,
    required this.address,
    required this.location,
    required this.type,
    this.createdAt,
  });
}

/// Saved place types
enum SavedPlaceType {
  home,
  work,
  other,
}

/// Place search result
class PlaceSearchResult {
  final String placeId;
  final String name;
  final String address;
  final String? secondaryText;
  final double? distanceMeters;

  const PlaceSearchResult({
    required this.placeId,
    required this.name,
    required this.address,
    this.secondaryText,
    this.distanceMeters,
  });
}

/// Place details
class PlaceDetails {
  final String placeId;
  final String name;
  final String address;
  final GeoLocation location;
  final String? formattedAddress;
  final String? phoneNumber;
  final String? website;
  final List<String>? types;

  const PlaceDetails({
    required this.placeId,
    required this.name,
    required this.address,
    required this.location,
    this.formattedAddress,
    this.phoneNumber,
    this.website,
    this.types,
  });
}
