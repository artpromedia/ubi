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
      riderId: '', // Not available in DTO, set empty
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
      actualFare: dto.finalFare,
      currency: dto.currency,
      estimatedDurationMinutes: dto.duration != null 
          ? (dto.duration! / 60).round() 
          : null,
      estimatedDistanceKm: dto.distance != null 
          ? dto.distance! / 1000 
          : null,
      startedAt: dto.startedAt,
      completedAt: dto.completedAt,
      cancelledAt: dto.cancelledAt,
      cancellationReason: dto.cancellationReason != null
          ? _mapCancellationReason(dto.cancellationReason!)
          : null,
    );
  }

  /// Map DriverDto to Driver entity
  static Driver fromDriverDto(DriverDto dto) {
    return Driver(
      id: dto.id,
      name: dto.fullName,
      profileImageUrl: dto.profileImageUrl,
      phoneNumber: dto.phoneNumber,
      rating: dto.rating,
      totalTrips: dto.totalRides,
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
      plateNumber: dto.licensePlate,
      imageUrl: dto.imageUrl,
    );
  }

  /// Map RideEstimateDto to RideEstimate entity
  static RideEstimate fromRideEstimateDto(RideEstimateDto dto) {
    return RideEstimate(
      vehicleType: _mapVehicleType(dto.vehicleType),
      estimatedFare: (dto.minFare + dto.maxFare) / 2,
      currency: dto.currency,
      estimatedDurationMinutes: (dto.estimatedDuration / 60).round(),
      estimatedDistanceKm: dto.estimatedDistance / 1000,
      etaMinutes: (dto.eta / 60).round(),
      surgePriceMultiplier: dto.surgeMultiplier,
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
      distance: dto.distance,
    );
  }

  /// Map PlaceDetailsDto to PlaceDetails entity
  static PlaceDetails fromPlaceDetailsDto(PlaceDetailsDto dto) {
    return PlaceDetails(
      placeId: dto.placeId,
      name: dto.name,
      formattedAddress: dto.formattedAddress ?? dto.address,
      location: GeoLocation(
        latitude: dto.latitude,
        longitude: dto.longitude,
      ),
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
      vehicleType: request.vehicleType.name,
      paymentMethodId: request.paymentMethodId ?? 'cash',
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
      case 'driver_assigned':
      case 'accepted':
        return RideStatus.driverAssigned;
      case 'driver_arriving':
      case 'arriving':
        return RideStatus.driverArriving;
      case 'driver_arrived':
      case 'arrived':
        return RideStatus.driverArrived;
      case 'in_progress':
      case 'inprogress':
        return RideStatus.inProgress;
      case 'completed':
        return RideStatus.completed;
      case 'cancelled':
        return RideStatus.cancelled;
      case 'no_drivers':
        return RideStatus.noDrivers;
      default:
        return RideStatus.pending;
    }
  }

  /// Map vehicle type string to VehicleType enum
  static VehicleType _mapVehicleType(String type) {
    switch (type.toLowerCase()) {
      case 'ubi_x':
      case 'ubix':
      case 'economy':
        return VehicleType.ubiX;
      case 'ubi_comfort':
      case 'ubicomfort':
      case 'comfort':
        return VehicleType.ubiComfort;
      case 'ubi_xl':
      case 'ubixl':
      case 'xl':
        return VehicleType.ubiXL;
      case 'ubi_lux':
      case 'ubilux':
      case 'premium':
        return VehicleType.ubiLux;
      case 'ubi_moto':
      case 'ubimoto':
      case 'moto':
        return VehicleType.ubiMoto;
      default:
        return VehicleType.ubiX;
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
      case 'wrong_pickup':
      case 'wrong_location':
        return CancellationReason.wrongPickup;
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