import '../../core/result/result.dart';
import '../entities/ride.dart';
import '../entities/location.dart';

/// Ride repository interface.
///
/// The contract is aligned with the ride use cases: fare estimation, ride
/// lifecycle, live tracking streams, and place search. Implementations live
/// in the data layer.
abstract class RideRepository {
  /// Get ride estimates for a route, optionally filtered by vehicle type.
  Future<Result<List<RideEstimate>>> getEstimates({
    required GeoLocation pickup,
    required GeoLocation dropoff,
    VehicleType? vehicleType,
  });

  /// Request a new ride.
  Future<Result<Ride>> requestRide({required RideRequest request});

  /// Get ride by ID.
  Future<Result<Ride>> getRideById(String rideId);

  /// Get the current active ride, or null when there is none.
  Future<Result<Ride?>> getActiveRide();

  /// Get ride history.
  Future<Result<List<Ride>>> getRideHistory({
    int page = 1,
    int limit = 20,
  });

  /// Cancel a ride.
  Future<Result<Ride>> cancelRide(
    String rideId, {
    CancellationReason? reason,
    String? note,
  });

  /// Rate a completed ride.
  Future<Result<Ride>> rateRide({
    required String rideId,
    required double rating,
    String? review,
  });

  /// Add a tip to a ride.
  Future<Result<Ride>> addTip({
    required String rideId,
    required double amount,
  });

  /// Get nearby drivers for a location, optionally filtered by vehicle type.
  Future<Result<List<Driver>>> getNearbyDrivers({
    required GeoLocation location,
    VehicleType? vehicleType,
  });

  /// Watch ride updates in real time.
  Stream<Ride> watchRide(String rideId);

  /// Watch driver location updates in real time.
  Stream<GeoLocation> watchDriverLocation(String rideId);

  /// Get saved places.
  Future<Result<List<SavedPlace>>> getSavedPlaces();

  /// Add a saved place.
  Future<Result<SavedPlace>> addSavedPlace(SavedPlace place);

  /// Remove a saved place.
  Future<Result<void>> removeSavedPlace(String placeId);

  /// Search places by free-text query.
  Future<Result<List<PlaceSearchResult>>> searchPlaces({
    required String query,
    GeoLocation? location,
  });

  /// Autocomplete places for a search input.
  Future<Result<List<PlaceSearchResult>>> autocompletePlaces({
    required String input,
    required String sessionToken,
    GeoLocation? location,
  });

  /// Get place details.
  Future<Result<PlaceDetails>> getPlaceDetails(String placeId);

  /// Reverse geocode a location to place details.
  Future<Result<PlaceDetails>> reverseGeocode(GeoLocation location);

  /// Get route polyline between two points.
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
