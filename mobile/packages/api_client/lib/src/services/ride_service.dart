/// Ride Service
///
/// API service for ride-hailing endpoints.
library;

import 'package:dio/dio.dart';
import 'package:json_annotation/json_annotation.dart';
import 'package:retrofit/retrofit.dart';

part 'ride_service.g.dart';

/// Ride API Service
///
/// Handles all ride-related API calls including:
/// - Fare estimates
/// - Ride requests
/// - Ride tracking
/// - Ratings
@RestApi()
abstract class RideService {
  factory RideService(Dio dio, {String baseUrl}) = _RideService;

  /// Get fare estimates for a route
  @POST('/rides/estimate')
  Future<List<RideEstimateDto>> getEstimates(@Body() RideEstimateRequestDto request);

  /// Request a new ride
  @POST('/rides/request')
  Future<RideDto> requestRide(@Body() RideRequestDto request);

  /// Get ride by ID
  @GET('/rides/{id}')
  Future<RideDto> getRideById(@Path('id') String id);

  /// Cancel a ride
  @POST('/rides/{id}/cancel')
  Future<RideDto> cancelRide(
    @Path('id') String id,
    @Body() CancelRideDto request,
  );

  /// Rate a completed ride
  @POST('/rides/{id}/rate')
  Future<void> rateRide(
    @Path('id') String id,
    @Body() RateRideDto request,
  );

  /// Add tip to a completed ride
  @POST('/rides/{id}/tip')
  Future<void> addTip(
    @Path('id') String id,
    @Body() AddTipDto request,
  );

  /// Get nearby drivers
  @GET('/rides/nearby-drivers')
  Future<List<NearbyDriverDto>> getNearbyDrivers(
    @Query('latitude') double latitude,
    @Query('longitude') double longitude,
    @Query('vehicleType') String? vehicleType,
  );

  /// Get active ride (if any)
  @GET('/rides/active')
  Future<RideDto?> getActiveRide();

  /// Search places
  @GET('/places/search')
  Future<List<PlaceSearchResultDto>> searchPlaces(
    @Query('query') String query,
    @Query('latitude') double? latitude,
    @Query('longitude') double? longitude,
    @Query('limit') int? limit,
  );

  /// Autocomplete places
  @GET('/places/autocomplete')
  Future<List<PlaceAutocompleteDto>> autocompletePlaces(
    @Query('query') String query,
    @Query('latitude') double? latitude,
    @Query('longitude') double? longitude,
    @Query('sessionToken') String? sessionToken,
  );

  /// Get place details
  @GET('/places/{id}')
  Future<PlaceDetailsDto> getPlaceDetails(
    @Path('id') String id,
    @Query('sessionToken') String? sessionToken,
  );

  /// Reverse geocode coordinates
  @GET('/places/reverse-geocode')
  Future<ReverseGeocodeDto> reverseGeocode(
    @Query('latitude') double latitude,
    @Query('longitude') double longitude,
  );
}

// === Estimate DTOs ===

@JsonSerializable()
class RideEstimateRequestDto {
  const RideEstimateRequestDto({
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.dropoffLatitude,
    required this.dropoffLongitude,
    this.vehicleTypes,
    this.scheduledTime,
  });

  factory RideEstimateRequestDto.fromJson(Map<String, dynamic> json) =>
      _$RideEstimateRequestDtoFromJson(json);

  final double pickupLatitude;
  final double pickupLongitude;
  final double dropoffLatitude;
  final double dropoffLongitude;
  final List<String>? vehicleTypes;
  final DateTime? scheduledTime;

  Map<String, dynamic> toJson() => _$RideEstimateRequestDtoToJson(this);
}

@JsonSerializable()
class RideEstimateDto {
  const RideEstimateDto({
    required this.vehicleType,
    required this.vehicleName,
    required this.minFare,
    required this.maxFare,
    required this.currency,
    required this.estimatedDuration,
    required this.estimatedDistance,
    required this.eta,
    this.surgeMultiplier,
    this.vehicleImageUrl,
    this.capacity,
    this.features,
  });

  factory RideEstimateDto.fromJson(Map<String, dynamic> json) =>
      _$RideEstimateDtoFromJson(json);

  final String vehicleType;
  final String vehicleName;
  final double minFare;
  final double maxFare;
  final String currency;
  final int estimatedDuration; // in seconds
  final double estimatedDistance; // in meters
  final int eta; // in seconds
  final double? surgeMultiplier;
  final String? vehicleImageUrl;
  final int? capacity;
  final List<String>? features;

  Map<String, dynamic> toJson() => _$RideEstimateDtoToJson(this);
}

// === Ride Request DTOs ===

@JsonSerializable()
class RideRequestDto {
  const RideRequestDto({
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.pickupAddress,
    required this.dropoffLatitude,
    required this.dropoffLongitude,
    required this.dropoffAddress,
    required this.vehicleType,
    required this.paymentMethodId,
    this.scheduledTime,
    this.notes,
    this.promoCode,
  });

  factory RideRequestDto.fromJson(Map<String, dynamic> json) =>
      _$RideRequestDtoFromJson(json);

  final double pickupLatitude;
  final double pickupLongitude;
  final String pickupAddress;
  final double dropoffLatitude;
  final double dropoffLongitude;
  final String dropoffAddress;
  final String vehicleType;
  final String paymentMethodId;
  final DateTime? scheduledTime;
  final String? notes;
  final String? promoCode;

  Map<String, dynamic> toJson() => _$RideRequestDtoToJson(this);
}

@JsonSerializable()
class RideDto {
  const RideDto({
    required this.id,
    required this.status,
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.pickupAddress,
    required this.dropoffLatitude,
    required this.dropoffLongitude,
    required this.dropoffAddress,
    required this.vehicleType,
    required this.currency,
    required this.createdAt,
    this.driver,
    this.vehicle,
    this.estimatedFare,
    this.finalFare,
    this.distance,
    this.duration,
    this.eta,
    this.surgeMultiplier,
    this.paymentMethodId,
    this.paymentStatus,
    this.scheduledTime,
    this.startedAt,
    this.completedAt,
    this.cancelledAt,
    this.cancellationReason,
    this.rating,
    this.driverRating,
    this.notes,
    this.route,
  });

  factory RideDto.fromJson(Map<String, dynamic> json) =>
      _$RideDtoFromJson(json);

  final String id;
  final String status;
  final double pickupLatitude;
  final double pickupLongitude;
  final String pickupAddress;
  final double dropoffLatitude;
  final double dropoffLongitude;
  final String dropoffAddress;
  final String vehicleType;
  final String currency;
  final DateTime createdAt;
  final DriverDto? driver;
  final VehicleDto? vehicle;
  final double? estimatedFare;
  final double? finalFare;
  final double? distance;
  final int? duration;
  final int? eta;
  final double? surgeMultiplier;
  final String? paymentMethodId;
  final String? paymentStatus;
  final DateTime? scheduledTime;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final DateTime? cancelledAt;
  final String? cancellationReason;
  final int? rating;
  final int? driverRating;
  final String? notes;
  final RouteDto? route;

  Map<String, dynamic> toJson() => _$RideDtoToJson(this);
}

@JsonSerializable()
class DriverDto {
  const DriverDto({
    required this.id,
    required this.firstName,
    required this.lastName,
    this.profileImageUrl,
    this.phoneNumber,
    this.rating,
    this.totalRides,
    this.currentLatitude,
    this.currentLongitude,
    this.heading,
  });

  factory DriverDto.fromJson(Map<String, dynamic> json) =>
      _$DriverDtoFromJson(json);

  final String id;
  final String firstName;
  final String lastName;
  final String? profileImageUrl;
  final String? phoneNumber;
  final double? rating;
  final int? totalRides;
  final double? currentLatitude;
  final double? currentLongitude;
  final double? heading;

  String get fullName => '$firstName $lastName';

  Map<String, dynamic> toJson() => _$DriverDtoToJson(this);
}

@JsonSerializable()
class VehicleDto {
  const VehicleDto({
    required this.id,
    required this.make,
    required this.model,
    required this.year,
    required this.color,
    required this.licensePlate,
    this.imageUrl,
  });

  factory VehicleDto.fromJson(Map<String, dynamic> json) =>
      _$VehicleDtoFromJson(json);

  final String id;
  final String make;
  final String model;
  final int year;
  final String color;
  final String licensePlate;
  final String? imageUrl;

  String get displayName => '$make $model';

  Map<String, dynamic> toJson() => _$VehicleDtoToJson(this);
}

@JsonSerializable()
class RouteDto {
  const RouteDto({
    required this.polyline,
    required this.distance,
    required this.duration,
    this.steps,
  });

  factory RouteDto.fromJson(Map<String, dynamic> json) =>
      _$RouteDtoFromJson(json);

  final String polyline; // Encoded polyline
  final double distance; // in meters
  final int duration; // in seconds
  final List<RouteStepDto>? steps;

  Map<String, dynamic> toJson() => _$RouteDtoToJson(this);
}

@JsonSerializable()
class RouteStepDto {
  const RouteStepDto({
    required this.instruction,
    required this.distance,
    required this.duration,
    this.maneuver,
  });

  factory RouteStepDto.fromJson(Map<String, dynamic> json) =>
      _$RouteStepDtoFromJson(json);

  final String instruction;
  final double distance;
  final int duration;
  final String? maneuver;

  Map<String, dynamic> toJson() => _$RouteStepDtoToJson(this);
}

// === Nearby Drivers DTO ===

@JsonSerializable()
class NearbyDriverDto {
  const NearbyDriverDto({
    required this.id,
    required this.latitude,
    required this.longitude,
    required this.vehicleType,
    this.heading,
    this.eta,
  });

  factory NearbyDriverDto.fromJson(Map<String, dynamic> json) =>
      _$NearbyDriverDtoFromJson(json);

  final String id;
  final double latitude;
  final double longitude;
  final String vehicleType;
  final double? heading;
  final int? eta;

  Map<String, dynamic> toJson() => _$NearbyDriverDtoToJson(this);
}

// === Cancel & Rate DTOs ===

@JsonSerializable()
class CancelRideDto {
  const CancelRideDto({
    required this.reason,
    this.otherReason,
  });

  factory CancelRideDto.fromJson(Map<String, dynamic> json) =>
      _$CancelRideDtoFromJson(json);

  final String reason;
  final String? otherReason;

  Map<String, dynamic> toJson() => _$CancelRideDtoToJson(this);
}

@JsonSerializable()
class RateRideDto {
  const RateRideDto({
    required this.rating,
    this.comment,
    this.tags,
  });

  factory RateRideDto.fromJson(Map<String, dynamic> json) =>
      _$RateRideDtoFromJson(json);

  final int rating; // 1-5
  final String? comment;
  final List<String>? tags;

  Map<String, dynamic> toJson() => _$RateRideDtoToJson(this);
}

@JsonSerializable()
class AddTipDto {
  const AddTipDto({
    required this.amount,
    required this.currency,
  });

  factory AddTipDto.fromJson(Map<String, dynamic> json) =>
      _$AddTipDtoFromJson(json);

  final double amount;
  final String currency;

  Map<String, dynamic> toJson() => _$AddTipDtoToJson(this);
}

// === Places DTOs ===

@JsonSerializable()
class PlaceSearchResultDto {
  const PlaceSearchResultDto({
    required this.placeId,
    required this.name,
    required this.address,
    this.latitude,
    this.longitude,
    this.types,
    this.distance,
  });

  factory PlaceSearchResultDto.fromJson(Map<String, dynamic> json) =>
      _$PlaceSearchResultDtoFromJson(json);

  final String placeId;
  final String name;
  final String address;
  final double? latitude;
  final double? longitude;
  final List<String>? types;
  final double? distance;

  Map<String, dynamic> toJson() => _$PlaceSearchResultDtoToJson(this);
}

@JsonSerializable()
class PlaceAutocompleteDto {
  const PlaceAutocompleteDto({
    required this.placeId,
    required this.mainText,
    required this.secondaryText,
    this.types,
  });

  factory PlaceAutocompleteDto.fromJson(Map<String, dynamic> json) =>
      _$PlaceAutocompleteDtoFromJson(json);

  final String placeId;
  final String mainText;
  final String secondaryText;
  final List<String>? types;

  Map<String, dynamic> toJson() => _$PlaceAutocompleteDtoToJson(this);
}

@JsonSerializable()
class PlaceDetailsDto {
  const PlaceDetailsDto({
    required this.placeId,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    this.formattedAddress,
    this.phoneNumber,
    this.website,
    this.types,
    this.openingHours,
  });

  factory PlaceDetailsDto.fromJson(Map<String, dynamic> json) =>
      _$PlaceDetailsDtoFromJson(json);

  final String placeId;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final String? formattedAddress;
  final String? phoneNumber;
  final String? website;
  final List<String>? types;
  final List<String>? openingHours;

  Map<String, dynamic> toJson() => _$PlaceDetailsDtoToJson(this);
}

@JsonSerializable()
class ReverseGeocodeDto {
  const ReverseGeocodeDto({
    required this.address,
    this.name,
    this.street,
    this.city,
    this.state,
    this.country,
    this.postalCode,
  });

  factory ReverseGeocodeDto.fromJson(Map<String, dynamic> json) =>
      _$ReverseGeocodeDtoFromJson(json);

  final String address;
  final String? name;
  final String? street;
  final String? city;
  final String? state;
  final String? country;
  final String? postalCode;

  Map<String, dynamic> toJson() => _$ReverseGeocodeDtoToJson(this);
}
