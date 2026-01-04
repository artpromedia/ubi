/// Delivery Service
///
/// API service for package delivery endpoints.
library;

import 'package:dio/dio.dart';
import 'package:json_annotation/json_annotation.dart';
import 'package:retrofit/retrofit.dart';

import 'ride_service.dart';

part 'delivery_service.g.dart';

/// Delivery API Service
///
/// Handles package delivery API calls including:
/// - Delivery estimates
/// - Delivery requests
/// - Tracking
@RestApi()
abstract class DeliveryService {
  factory DeliveryService(Dio dio, {String baseUrl}) = _DeliveryService;

  /// Get delivery estimate
  @POST('/deliveries/estimate')
  Future<DeliveryEstimateDto> getEstimate(@Body() DeliveryEstimateRequestDto request);

  /// Request a delivery
  @POST('/deliveries/request')
  Future<DeliveryDto> requestDelivery(@Body() DeliveryRequestDto request);

  /// Get delivery by ID
  @GET('/deliveries/{id}')
  Future<DeliveryDto> getDeliveryById(@Path('id') String id);

  /// Cancel delivery
  @POST('/deliveries/{id}/cancel')
  Future<DeliveryDto> cancelDelivery(
    @Path('id') String id,
    @Body() CancelDeliveryDto request,
  );

  /// Rate delivery
  @POST('/deliveries/{id}/rate')
  Future<void> rateDelivery(
    @Path('id') String id,
    @Body() RateDeliveryDto request,
  );

  /// Get active deliveries
  @GET('/deliveries/active')
  Future<List<DeliveryDto>> getActiveDeliveries();

  /// Get delivery history
  @GET('/deliveries/history')
  Future<List<DeliveryDto>> getDeliveryHistory(
    @Query('page') int page,
    @Query('limit') int limit,
  );
}

// === Estimate DTOs ===

@JsonSerializable()
class DeliveryEstimateRequestDto {
  const DeliveryEstimateRequestDto({
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.dropoffLatitude,
    required this.dropoffLongitude,
    required this.packageSize,
    this.packageWeight,
    this.isFragile,
    this.requiresSignature,
    this.scheduledTime,
  });

  factory DeliveryEstimateRequestDto.fromJson(Map<String, dynamic> json) =>
      _$DeliveryEstimateRequestDtoFromJson(json);

  final double pickupLatitude;
  final double pickupLongitude;
  final double dropoffLatitude;
  final double dropoffLongitude;
  final String packageSize; // 'small', 'medium', 'large', 'extra_large'
  final double? packageWeight; // in kg
  final bool? isFragile;
  final bool? requiresSignature;
  final DateTime? scheduledTime;

  Map<String, dynamic> toJson() => _$DeliveryEstimateRequestDtoToJson(this);
}

@JsonSerializable()
class DeliveryEstimateDto {
  const DeliveryEstimateDto({
    required this.estimatedFare,
    required this.currency,
    required this.estimatedDuration,
    required this.estimatedDistance,
    required this.eta,
    this.breakdown,
    this.surgeMultiplier,
  });

  factory DeliveryEstimateDto.fromJson(Map<String, dynamic> json) =>
      _$DeliveryEstimateDtoFromJson(json);

  final double estimatedFare;
  final String currency;
  final int estimatedDuration; // in seconds
  final double estimatedDistance; // in meters
  final int eta; // in seconds
  final DeliveryFareBreakdownDto? breakdown;
  final double? surgeMultiplier;

  Map<String, dynamic> toJson() => _$DeliveryEstimateDtoToJson(this);
}

@JsonSerializable()
class DeliveryFareBreakdownDto {
  const DeliveryFareBreakdownDto({
    required this.baseFare,
    required this.distanceFare,
    required this.sizeFare,
    this.weightFare,
    this.fragileFee,
    this.signatureFee,
    this.surgeFee,
  });

  factory DeliveryFareBreakdownDto.fromJson(Map<String, dynamic> json) =>
      _$DeliveryFareBreakdownDtoFromJson(json);

  final double baseFare;
  final double distanceFare;
  final double sizeFare;
  final double? weightFare;
  final double? fragileFee;
  final double? signatureFee;
  final double? surgeFee;

  Map<String, dynamic> toJson() => _$DeliveryFareBreakdownDtoToJson(this);
}

// === Delivery Request DTOs ===

@JsonSerializable()
class DeliveryRequestDto {
  const DeliveryRequestDto({
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.pickupAddress,
    required this.pickupContactName,
    required this.pickupContactPhone,
    required this.dropoffLatitude,
    required this.dropoffLongitude,
    required this.dropoffAddress,
    required this.dropoffContactName,
    required this.dropoffContactPhone,
    required this.packageSize,
    required this.packageDescription,
    required this.paymentMethodId,
    this.packageWeight,
    this.isFragile,
    this.requiresSignature,
    this.scheduledTime,
    this.pickupNotes,
    this.dropoffNotes,
    this.promoCode,
  });

  factory DeliveryRequestDto.fromJson(Map<String, dynamic> json) =>
      _$DeliveryRequestDtoFromJson(json);

  final double pickupLatitude;
  final double pickupLongitude;
  final String pickupAddress;
  final String pickupContactName;
  final String pickupContactPhone;
  final double dropoffLatitude;
  final double dropoffLongitude;
  final String dropoffAddress;
  final String dropoffContactName;
  final String dropoffContactPhone;
  final String packageSize;
  final String packageDescription;
  final String paymentMethodId;
  final double? packageWeight;
  final bool? isFragile;
  final bool? requiresSignature;
  final DateTime? scheduledTime;
  final String? pickupNotes;
  final String? dropoffNotes;
  final String? promoCode;

  Map<String, dynamic> toJson() => _$DeliveryRequestDtoToJson(this);
}

@JsonSerializable()
class DeliveryDto {
  const DeliveryDto({
    required this.id,
    required this.status,
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.pickupAddress,
    required this.pickupContactName,
    required this.pickupContactPhone,
    required this.dropoffLatitude,
    required this.dropoffLongitude,
    required this.dropoffAddress,
    required this.dropoffContactName,
    required this.dropoffContactPhone,
    required this.packageSize,
    required this.packageDescription,
    required this.currency,
    required this.createdAt,
    this.driver,
    this.vehicle,
    this.packageWeight,
    this.isFragile,
    this.requiresSignature,
    this.estimatedFare,
    this.finalFare,
    this.distance,
    this.duration,
    this.eta,
    this.paymentMethodId,
    this.paymentStatus,
    this.scheduledTime,
    this.pickupNotes,
    this.dropoffNotes,
    this.pickedUpAt,
    this.deliveredAt,
    this.cancelledAt,
    this.cancellationReason,
    this.signatureImageUrl,
    this.proofOfDeliveryImageUrl,
    this.rating,
    this.trackingCode,
  });

  factory DeliveryDto.fromJson(Map<String, dynamic> json) =>
      _$DeliveryDtoFromJson(json);

  final String id;
  final String status;
  final double pickupLatitude;
  final double pickupLongitude;
  final String pickupAddress;
  final String pickupContactName;
  final String pickupContactPhone;
  final double dropoffLatitude;
  final double dropoffLongitude;
  final String dropoffAddress;
  final String dropoffContactName;
  final String dropoffContactPhone;
  final String packageSize;
  final String packageDescription;
  final String currency;
  final DateTime createdAt;
  final DriverDto? driver;
  final VehicleDto? vehicle;
  final double? packageWeight;
  final bool? isFragile;
  final bool? requiresSignature;
  final double? estimatedFare;
  final double? finalFare;
  final double? distance;
  final int? duration;
  final int? eta;
  final String? paymentMethodId;
  final String? paymentStatus;
  final DateTime? scheduledTime;
  final String? pickupNotes;
  final String? dropoffNotes;
  final DateTime? pickedUpAt;
  final DateTime? deliveredAt;
  final DateTime? cancelledAt;
  final String? cancellationReason;
  final String? signatureImageUrl;
  final String? proofOfDeliveryImageUrl;
  final int? rating;
  final String? trackingCode;

  Map<String, dynamic> toJson() => _$DeliveryDtoToJson(this);
}

// === Cancel & Rate DTOs ===

@JsonSerializable()
class CancelDeliveryDto {
  const CancelDeliveryDto({
    required this.reason,
    this.otherReason,
  });

  factory CancelDeliveryDto.fromJson(Map<String, dynamic> json) =>
      _$CancelDeliveryDtoFromJson(json);

  final String reason;
  final String? otherReason;

  Map<String, dynamic> toJson() => _$CancelDeliveryDtoToJson(this);
}

@JsonSerializable()
class RateDeliveryDto {
  const RateDeliveryDto({
    required this.rating,
    this.comment,
    this.tags,
  });

  factory RateDeliveryDto.fromJson(Map<String, dynamic> json) =>
      _$RateDeliveryDtoFromJson(json);

  final int rating;
  final String? comment;
  final List<String>? tags;

  Map<String, dynamic> toJson() => _$RateDeliveryDtoToJson(this);
}

/// Package size enum for display
enum PackageSize {
  small('small', 'Small', 'Fits in a bag (max 5kg)'),
  medium('medium', 'Medium', 'Fits in a backpack (max 10kg)'),
  large('large', 'Large', 'Requires two hands (max 20kg)'),
  extraLarge('extra_large', 'Extra Large', 'May require special handling (max 50kg)');

  const PackageSize(this.value, this.label, this.description);

  final String value;
  final String label;
  final String description;

  static PackageSize fromValue(String value) {
    return PackageSize.values.firstWhere(
      (e) => e.value == value,
      orElse: () => PackageSize.medium,
    );
  }
}
