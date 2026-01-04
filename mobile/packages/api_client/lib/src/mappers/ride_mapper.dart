/// Ride Mapper
///
/// Maps between Ride DTOs and domain entities.
library;

import 'package:ubi_core/ubi_core.dart';

import '../services/ride_service.dart';

/// Mapper for Ride-related DTOs to domain entities
class RideMapper {
  const RideMapper._();

  /// Map RideDto to Ride entity
  static Ride fromRideDto(RideDto dto) {
    return Ride(
      id: dto.id,
      status: _mapRideStatus(dto.status),
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
      vehicleType: _mapVehicleType(dto.vehicleType),
      driver: dto.driver != null ? fromDriverDto(dto.driver!) : null,
      vehicle: dto.vehicle != null ? fromVehicleDto(dto.vehicle!) : null,
      estimatedFare: dto.estimatedFare,
      finalFare: dto.finalFare,
      currency: dto.currency,
      estimatedDuration: dto.duration != null 
          ? Duration(seconds: dto.duration!) 
          : null,
      estimatedDistance: dto.distance,
      scheduledTime: dto.scheduledTime,
      startedAt: dto.startedAt,
      completedAt: dto.completedAt,
      cancelledAt: dto.cancelledAt,
      cancellationReason: dto.cancellationReason != null
          ? _mapCancellationReason(dto.cancellationReason!)
          : null,
      rating: dto.rating,
      createdAt: dto.createdAt,
    );
  }

  /// Map DriverDto to Driver entity
  static Driver fromDriverDto(DriverDto dto) {
    return Driver(
      id: dto.id,
      firstName: dto.firstName,
      lastName: dto.lastName,
      profileImageUrl: dto.profileImageUrl,
      phoneNumber: dto.phoneNumber,
      rating: dto.rating,
      totalRides: dto.totalRides,
      currentLocation: dto.currentLatitude != null && dto.currentLongitude != null
          ? GeoLocation(
              latitude: dto.currentLatitude!,
              longitude: dto.currentLongitude!,
              heading: dto.heading,
            )
          : null,
    );
  }

  /// Map VehicleDto to Vehicle entity
  static Vehicle fromVehicleDto(VehicleDto dto) {
    return Vehicle(
      id: dto.id,
      make: dto.make,
      model: dto.model,
      year: dto.year,
      color: dto.color,
      licensePlate: dto.licensePlate,
      imageUrl: dto.imageUrl,
    );
  }

  /// Map RideEstimateDto to RideEstimate entity
  static RideEstimate fromRideEstimateDto(RideEstimateDto dto) {
    return RideEstimate(
      vehicleType: _mapVehicleType(dto.vehicleType),
      vehicleName: dto.vehicleName,
      minFare: dto.minFare,
      maxFare: dto.maxFare,
      currency: dto.currency,
      estimatedDuration: Duration(seconds: dto.estimatedDuration),
      estimatedDistance: dto.estimatedDistance,
      eta: Duration(seconds: dto.eta),
      surgeMultiplier: dto.surgeMultiplier,
      vehicleImageUrl: dto.vehicleImageUrl,
      capacity: dto.capacity,
      features: dto.features,
    );
  }

  /// Map PlaceSearchResultDto to PlaceSearchResult entity
  static PlaceSearchResult fromPlaceSearchResultDto(PlaceSearchResultDto dto) {
    return PlaceSearchResult(
      placeId: dto.placeId,
      name: dto.name,
      address: dto.address,
      location: dto.latitude != null && dto.longitude != null
          ? GeoLocation(latitude: dto.latitude!, longitude: dto.longitude!)
          : null,
      types: dto.types,
      distance: dto.distance,
    );
  }

  /// Map PlaceDetailsDto to PlaceDetails entity
  static PlaceDetails fromPlaceDetailsDto(PlaceDetailsDto dto) {
    return PlaceDetails(
      placeId: dto.placeId,
      name: dto.name,
      address: dto.address,
      formattedAddress: dto.formattedAddress,
      location: GeoLocation(
        latitude: dto.latitude,
        longitude: dto.longitude,
      ),
      phoneNumber: dto.phoneNumber,
      website: dto.website,
      types: dto.types,
    );
  }

  /// Map RideRequest entity to RideRequestDto
  static RideRequestDto toRideRequestDto(RideRequest request) {
    return RideRequestDto(
      pickupLatitude: request.pickupLocation.latitude,
      pickupLongitude: request.pickupLocation.longitude,
      pickupAddress: request.pickupAddress,
      dropoffLatitude: request.dropoffLocation.latitude,
      dropoffLongitude: request.dropoffLocation.longitude,
      dropoffAddress: request.dropoffAddress,
      vehicleType: request.vehicleType.value,
      paymentMethodId: request.paymentMethodId,
      scheduledTime: request.scheduledTime,
      notes: request.notes,
      promoCode: request.promoCode,
    );
  }

  /// Map status string to RideStatus enum
  static RideStatus _mapRideStatus(String status) {
    switch (status.toLowerCase()) {
      case 'pending':
        return RideStatus.pending;
      case 'searching':
        return RideStatus.searching;
      case 'accepted':
        return RideStatus.accepted;
      case 'arriving':
        return RideStatus.arriving;
      case 'arrived':
        return RideStatus.arrived;
      case 'in_progress':
      case 'inprogress':
        return RideStatus.inProgress;
      case 'completed':
        return RideStatus.completed;
      case 'cancelled':
        return RideStatus.cancelled;
      default:
        return RideStatus.pending;
    }
  }

  /// Map vehicle type string to VehicleType enum
  static VehicleType _mapVehicleType(String type) {
    switch (type.toLowerCase()) {
      case 'economy':
        return VehicleType.economy;
      case 'comfort':
        return VehicleType.comfort;
      case 'premium':
        return VehicleType.premium;
      case 'xl':
        return VehicleType.xl;
      case 'moto':
        return VehicleType.moto;
      case 'tuktuk':
        return VehicleType.tuktuk;
      default:
        return VehicleType.economy;
    }
  }

  /// Map cancellation reason string to CancellationReason enum
  static CancellationReason _mapCancellationReason(String reason) {
    switch (reason.toLowerCase()) {
      case 'changed_mind':
      case 'changedmind':
        return CancellationReason.changedMind;
      case 'driver_too_far':
      case 'drivertooFar':
        return CancellationReason.driverTooFar;
      case 'wrong_location':
      case 'wronglocation':
        return CancellationReason.wrongLocation;
      case 'price_too_high':
      case 'pricetoohigh':
        return CancellationReason.priceTooHigh;
      case 'found_alternative':
      case 'foundalternative':
        return CancellationReason.foundAlternative;
      case 'driver_asked':
      case 'driverasked':
        return CancellationReason.driverAsked;
      case 'other':
      default:
        return CancellationReason.other;
    }
  }
}

/// Extension for convenient mapping
extension RideDtoExtension on RideDto {
  Ride toRide() => RideMapper.fromRideDto(this);
}

extension DriverDtoExtension on DriverDto {
  Driver toDriver() => RideMapper.fromDriverDto(this);
}

extension VehicleDtoExtension on VehicleDto {
  Vehicle toVehicle() => RideMapper.fromVehicleDto(this);
}

extension RideEstimateDtoExtension on RideEstimateDto {
  RideEstimate toRideEstimate() => RideMapper.fromRideEstimateDto(this);
}

extension PlaceSearchResultDtoExtension on PlaceSearchResultDto {
  PlaceSearchResult toPlaceSearchResult() => RideMapper.fromPlaceSearchResultDto(this);
}

extension PlaceDetailsDtoExtension on PlaceDetailsDto {
  PlaceDetails toPlaceDetails() => RideMapper.fromPlaceDetailsDto(this);
}

extension RideRequestExtension on RideRequest {
  RideRequestDto toDto() => RideMapper.toRideRequestDto(this);
}
