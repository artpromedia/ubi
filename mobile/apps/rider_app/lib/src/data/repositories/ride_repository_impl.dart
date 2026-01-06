import 'package:ubi_api_client/ubi_api_client.dart';
import 'package:ubi_core/ubi_core.dart';

/// Implementation of RideRepository using API client
class RideRepositoryImpl implements RideRepository {
  RideRepositoryImpl({
    required RideService rideService,
  }) : _rideService = rideService;

  final RideService _rideService;

  @override
  Future<Result<List<RideEstimate>>> getEstimates({
    required GeoLocation pickup,
    required GeoLocation dropoff,
  }) async {
    try {
      final response = await _rideService.getEstimates(
        RideEstimateRequestDto(
          pickupLatitude: pickup.latitude,
          pickupLongitude: pickup.longitude,
          dropoffLatitude: dropoff.latitude,
          dropoffLongitude: dropoff.longitude,
        ),
      );
      
      final estimates = response.map((e) => RideEstimate(
        vehicleType: _parseVehicleType(e.vehicleType),
        estimatedFare: (e.minFare + e.maxFare) / 2,
        currency: e.currency,
        estimatedDurationMinutes: (e.estimatedDuration / 60).round(),
        estimatedDistanceKm: e.estimatedDistance / 1000,
        etaMinutes: (e.eta / 60).round(),
        surgePriceMultiplier: e.surgeMultiplier,
      )).toList();
      
      return Result.success(estimates);
    } catch (e) {
      return Result.failure(Failure.server(message: e.toString()));
    }
  }

  @override
  Future<Result<Ride>> requestRide({required RideRequest request}) async {
    try {
      final response = await _rideService.requestRide(
        RideRequestDto(
          pickupLatitude: request.pickupLocation.latitude,
          pickupLongitude: request.pickupLocation.longitude,
          pickupAddress: request.pickupAddress,
          dropoffLatitude: request.dropoffLocation.latitude,
          dropoffLongitude: request.dropoffLocation.longitude,
          dropoffAddress: request.dropoffAddress,
          vehicleType: request.vehicleType.name,
          paymentMethodId: request.paymentMethodId ?? 'cash',
          promoCode: request.promoCode,
        ),
      );
      
      return Result.success(_mapRideDto(response));
    } catch (e) {
      return Result.failure(Failure.server(message: e.toString()));
    }
  }

  @override
  Future<Result<Ride>> getRideById(String rideId) async {
    try {
      final response = await _rideService.getRideById(rideId);
      return Result.success(_mapRideDto(response));
    } catch (e) {
      return Result.failure(Failure.notFound(message: 'Ride not found'));
    }
  }

  @override
  Future<Result<Ride?>> getActiveRide() async {
    try {
      final response = await _rideService.getActiveRide();
      if (response == null) {
        return const Result.success(null);
      }
      return Result.success(_mapRideDto(response));
    } catch (e) {
      return const Result.success(null);
    }
  }

  @override
  Future<Result<List<Ride>>> getRideHistory({
    int page = 1,
    int limit = 20,
  }) async {
    // Note: RideService doesn't have getRideHistory - would need to add or handle differently
    return const Result.success([]);
  }

  @override
  Future<Result<Ride>> cancelRide(
    String rideId, {
    CancellationReason? reason,
    String? note,
  }) async {
    try {
      final response = await _rideService.cancelRide(
        rideId,
        CancelRideDto(
          reason: reason?.name ?? 'user_cancelled',
          otherReason: note,
        ),
      );
      return Result.success(_mapRideDto(response));
    } catch (e) {
      return Result.failure(Failure.server(message: e.toString()));
    }
  }

  @override
  Future<Result<void>> rateRide({
    required String rideId,
    required int rating,
    String? review,
  }) async {
    try {
      await _rideService.rateRide(
        rideId,
        RateRideDto(rating: rating, comment: review),
      );
      return const Result.success(null);
    } catch (e) {
      return Result.failure(Failure.server(message: e.toString()));
    }
  }

  @override
  Future<Result<Ride>> addTip({
    required String rideId,
    required double amount,
  }) async {
    try {
      await _rideService.addTip(
        rideId,
        AddTipDto(amount: amount, currency: 'NGN'),
      );
      // Fetch updated ride after tip
      return getRideById(rideId);
    } catch (e) {
      return Result.failure(Failure.server(message: e.toString()));
    }
  }

  @override
  Future<Result<List<Driver>>> getNearbyDrivers({
    required GeoLocation location,
    VehicleType? vehicleType,
  }) async {
    try {
      final response = await _rideService.getNearbyDrivers(
        location.latitude,
        location.longitude,
        vehicleType?.name,
      );
      
      final drivers = response.map((d) => Driver(
        id: d.id,
        name: 'Driver',
        currentLocation: GeoLocation(
          latitude: d.latitude,
          longitude: d.longitude,
        ),
        etaMinutes: d.eta != null ? (d.eta! / 60).round() : null,
      )).toList();
      
      return Result.success(drivers);
    } catch (e) {
      return Result.failure(Failure.server(message: e.toString()));
    }
  }

  @override
  Stream<Ride> watchRide(String rideId) {
    // This would connect to WebSocket or polling
    return const Stream.empty();
  }

  @override
  Stream<GeoLocation> watchDriverLocation(String rideId) {
    // This would connect to WebSocket or polling
    return const Stream.empty();
  }

  @override
  Stream<Result<GeoLocation>> getDriverLocationStream(String rideId) {
    return watchDriverLocation(rideId).map((location) => Result.success(location));
  }

  @override
  Stream<Result<Ride>> getRideStatusStream(String rideId) {
    return watchRide(rideId).map((ride) => Result.success(ride));
  }

  @override
  Future<Result<List<SavedPlace>>> getSavedPlaces() async {
    // RideService doesn't have saved places - would need separate endpoint
    return const Result.success([]);
  }

  @override
  Future<Result<SavedPlace>> addSavedPlace(SavedPlace place) async {
    // RideService doesn't have saved places - would need separate endpoint
    return Result.failure(const Failure.server(message: 'Not implemented'));
  }

  @override
  Future<Result<void>> removeSavedPlace(String placeId) async {
    // RideService doesn't have saved places - would need separate endpoint
    return const Result.success(null);
  }

  @override
  Future<Result<List<PlaceSearchResult>>> searchPlaces({
    required String query,
    GeoLocation? location,
  }) async {
    try {
      final response = await _rideService.searchPlaces(
        query,
        location?.latitude,
        location?.longitude,
        null,
      );
      
      final places = response.map((p) => PlaceSearchResult(
        placeId: p.placeId,
        name: p.name,
        address: p.address,
        location: p.latitude != null && p.longitude != null
            ? GeoLocation(latitude: p.latitude!, longitude: p.longitude!)
            : null,
      )).toList();
      
      return Result.success(places);
    } catch (e) {
      return Result.failure(Failure.server(message: e.toString()));
    }
  }

  @override
  Future<Result<List<PlaceSearchResult>>> autocompletePlaces({
    required String input,
    required String sessionToken,
    GeoLocation? location,
  }) async {
    try {
      final response = await _rideService.autocompletePlaces(
        input,
        location?.latitude,
        location?.longitude,
        sessionToken,
      );
      
      final places = response.map((p) => PlaceSearchResult(
        placeId: p.placeId,
        name: p.mainText,
        secondaryText: p.secondaryText,
      )).toList();
      
      return Result.success(places);
    } catch (e) {
      return Result.failure(Failure.server(message: e.toString()));
    }
  }

  @override
  Future<Result<PlaceDetails>> getPlaceDetails(String placeId) async {
    try {
      final response = await _rideService.getPlaceDetails(placeId, null);
      return Result.success(PlaceDetails(
        placeId: response.placeId,
        name: response.name,
        location: GeoLocation(latitude: response.latitude, longitude: response.longitude),
        formattedAddress: response.formattedAddress ?? response.address,
      ));
    } catch (e) {
      return Result.failure(Failure.notFound(message: 'Place not found'));
    }
  }

  @override
  Future<Result<PlaceDetails>> reverseGeocode(GeoLocation location) async {
    try {
      final response = await _rideService.reverseGeocode(
        location.latitude,
        location.longitude,
      );
      return Result.success(PlaceDetails(
        placeId: '',
        name: response.name ?? 'Unknown Location',
        location: location,
        formattedAddress: response.address,
      ));
    } catch (e) {
      return Result.failure(Failure.server(message: e.toString()));
    }
  }

  @override
  Future<Result<List<GeoLocation>>> getRoutePolyline(
    GeoLocation pickup,
    GeoLocation dropoff,
  ) async {
    // RideService doesn't have route endpoint - would need to add
    return const Result.success([]);
  }

  VehicleType _parseVehicleType(String type) {
    return switch (type.toLowerCase()) {
      'ubi_x' || 'ubix' => VehicleType.ubiX,
      'ubi_comfort' || 'ubicomfort' => VehicleType.ubiComfort,
      'ubi_xl' || 'ubixl' => VehicleType.ubiXL,
      'ubi_lux' || 'ubilux' => VehicleType.ubiLux,
      'ubi_moto' || 'ubimoto' => VehicleType.ubiMoto,
      _ => VehicleType.ubiX,
    };
  }

  RideStatus _parseRideStatus(String status) {
    return switch (status.toLowerCase()) {
      'pending' => RideStatus.pending,
      'searching' => RideStatus.searching,
      'driver_assigned' => RideStatus.driverAssigned,
      'driver_arriving' => RideStatus.driverArriving,
      'driver_arrived' => RideStatus.driverArrived,
      'in_progress' => RideStatus.inProgress,
      'completed' => RideStatus.completed,
      'cancelled' => RideStatus.cancelled,
      'no_drivers' => RideStatus.noDrivers,
      _ => RideStatus.pending,
    };
  }

  Ride _mapRideDto(RideDto dto) {
    return Ride(
      id: dto.id,
      riderId: '', // Not in DTO
      pickupLocation: GeoLocation(
        latitude: dto.pickupLatitude,
        longitude: dto.pickupLongitude,
      ),
      dropoffLocation: GeoLocation(
        latitude: dto.dropoffLatitude,
        longitude: dto.dropoffLongitude,
      ),
      pickupAddress: dto.pickupAddress,
      dropoffAddress: dto.dropoffAddress,
      vehicleType: _parseVehicleType(dto.vehicleType),
      status: _parseRideStatus(dto.status),
      driver: dto.driver != null ? _mapDriverDto(dto.driver!) : null,
      vehicle: dto.vehicle != null ? _mapVehicleDto(dto.vehicle!) : null,
      estimatedFare: dto.estimatedFare,
      actualFare: dto.finalFare,
      currency: dto.currency,
      estimatedDurationMinutes: dto.duration != null ? (dto.duration! / 60).round() : null,
      estimatedDistanceKm: dto.distance != null ? dto.distance! / 1000 : null,
    );
  }

  Driver _mapDriverDto(DriverDto dto) {
    return Driver(
      id: dto.id,
      name: dto.fullName,
      currentLocation: dto.currentLatitude != null && dto.currentLongitude != null
          ? GeoLocation(latitude: dto.currentLatitude!, longitude: dto.currentLongitude!)
          : null,
      rating: dto.rating,
      profileImageUrl: dto.profileImageUrl,
      phoneNumber: dto.phoneNumber,
    );
  }

  Vehicle _mapVehicleDto(VehicleDto dto) {
    return Vehicle(
      id: dto.id,
      make: dto.make,
      model: dto.model,
      year: dto.year,
      color: dto.color,
      plateNumber: dto.licensePlate,
      imageUrl: dto.imageUrl,
    );
  }
}
