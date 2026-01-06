// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ride.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$RideImpl _$$RideImplFromJson(Map<String, dynamic> json) => _$RideImpl(
      id: json['id'] as String,
      riderId: json['riderId'] as String,
      pickupLocation:
          GeoLocation.fromJson(json['pickupLocation'] as Map<String, dynamic>),
      dropoffLocation:
          GeoLocation.fromJson(json['dropoffLocation'] as Map<String, dynamic>),
      pickupAddress: json['pickupAddress'] as String,
      dropoffAddress: json['dropoffAddress'] as String,
      vehicleType: $enumDecode(_$VehicleTypeEnumMap, json['vehicleType']),
      status: $enumDecode(_$RideStatusEnumMap, json['status']),
      driverId: json['driverId'] as String?,
      driver: json['driver'] == null
          ? null
          : Driver.fromJson(json['driver'] as Map<String, dynamic>),
      vehicle: json['vehicle'] == null
          ? null
          : Vehicle.fromJson(json['vehicle'] as Map<String, dynamic>),
      estimatedFare: (json['estimatedFare'] as num?)?.toDouble(),
      actualFare: (json['actualFare'] as num?)?.toDouble(),
      currency: json['currency'] as String?,
      estimatedDurationMinutes:
          (json['estimatedDurationMinutes'] as num?)?.toInt(),
      estimatedDistanceKm: (json['estimatedDistanceKm'] as num?)?.toDouble(),
      actualDurationMinutes: (json['actualDurationMinutes'] as num?)?.toInt(),
      actualDistanceKm: (json['actualDistanceKm'] as num?)?.toDouble(),
      requestedAt: json['requestedAt'] == null
          ? null
          : DateTime.parse(json['requestedAt'] as String),
      acceptedAt: json['acceptedAt'] == null
          ? null
          : DateTime.parse(json['acceptedAt'] as String),
      arrivedAt: json['arrivedAt'] == null
          ? null
          : DateTime.parse(json['arrivedAt'] as String),
      startedAt: json['startedAt'] == null
          ? null
          : DateTime.parse(json['startedAt'] as String),
      completedAt: json['completedAt'] == null
          ? null
          : DateTime.parse(json['completedAt'] as String),
      cancelledAt: json['cancelledAt'] == null
          ? null
          : DateTime.parse(json['cancelledAt'] as String),
      cancellationReason: $enumDecodeNullable(
          _$CancellationReasonEnumMap, json['cancellationReason']),
      cancellationNote: json['cancellationNote'] as String?,
      cancelledBy: json['cancelledBy'] as String?,
      driverRating: (json['driverRating'] as num?)?.toDouble(),
      driverReview: json['driverReview'] as String?,
      riderRating: (json['riderRating'] as num?)?.toDouble(),
      riderReview: json['riderReview'] as String?,
      paymentMethodId: json['paymentMethodId'] as String?,
      paymentId: json['paymentId'] as String?,
      routePolyline: (json['routePolyline'] as List<dynamic>?)
          ?.map((e) => GeoLocation.fromJson(e as Map<String, dynamic>))
          .toList(),
      metadata: json['metadata'] as Map<String, dynamic>?,
    );

Map<String, dynamic> _$$RideImplToJson(_$RideImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'riderId': instance.riderId,
      'pickupLocation': instance.pickupLocation,
      'dropoffLocation': instance.dropoffLocation,
      'pickupAddress': instance.pickupAddress,
      'dropoffAddress': instance.dropoffAddress,
      'vehicleType': _$VehicleTypeEnumMap[instance.vehicleType]!,
      'status': _$RideStatusEnumMap[instance.status]!,
      'driverId': instance.driverId,
      'driver': instance.driver,
      'vehicle': instance.vehicle,
      'estimatedFare': instance.estimatedFare,
      'actualFare': instance.actualFare,
      'currency': instance.currency,
      'estimatedDurationMinutes': instance.estimatedDurationMinutes,
      'estimatedDistanceKm': instance.estimatedDistanceKm,
      'actualDurationMinutes': instance.actualDurationMinutes,
      'actualDistanceKm': instance.actualDistanceKm,
      'requestedAt': instance.requestedAt?.toIso8601String(),
      'acceptedAt': instance.acceptedAt?.toIso8601String(),
      'arrivedAt': instance.arrivedAt?.toIso8601String(),
      'startedAt': instance.startedAt?.toIso8601String(),
      'completedAt': instance.completedAt?.toIso8601String(),
      'cancelledAt': instance.cancelledAt?.toIso8601String(),
      'cancellationReason':
          _$CancellationReasonEnumMap[instance.cancellationReason],
      'cancellationNote': instance.cancellationNote,
      'cancelledBy': instance.cancelledBy,
      'driverRating': instance.driverRating,
      'driverReview': instance.driverReview,
      'riderRating': instance.riderRating,
      'riderReview': instance.riderReview,
      'paymentMethodId': instance.paymentMethodId,
      'paymentId': instance.paymentId,
      'routePolyline': instance.routePolyline,
      'metadata': instance.metadata,
    };

const _$VehicleTypeEnumMap = {
  VehicleType.ubiX: 'ubi_x',
  VehicleType.ubiComfort: 'ubi_comfort',
  VehicleType.ubiXL: 'ubi_xl',
  VehicleType.ubiLux: 'ubi_lux',
  VehicleType.ubiMoto: 'ubi_moto',
};

const _$RideStatusEnumMap = {
  RideStatus.pending: 'pending',
  RideStatus.searching: 'searching',
  RideStatus.driverAssigned: 'driver_assigned',
  RideStatus.driverArriving: 'driver_arriving',
  RideStatus.driverArrived: 'driver_arrived',
  RideStatus.inProgress: 'in_progress',
  RideStatus.completed: 'completed',
  RideStatus.cancelled: 'cancelled',
  RideStatus.noDrivers: 'no_drivers',
};

const _$CancellationReasonEnumMap = {
  CancellationReason.changedMind: 'changed_mind',
  CancellationReason.driverTooFar: 'driver_too_far',
  CancellationReason.wrongPickup: 'wrong_pickup',
  CancellationReason.driverAsked: 'driver_asked',
  CancellationReason.other: 'other',
};

_$DriverImpl _$$DriverImplFromJson(Map<String, dynamic> json) => _$DriverImpl(
      id: json['id'] as String,
      name: json['name'] as String,
      phoneNumber: json['phoneNumber'] as String?,
      profileImageUrl: json['profileImageUrl'] as String?,
      rating: (json['rating'] as num?)?.toDouble(),
      totalTrips: (json['totalTrips'] as num?)?.toInt(),
      currentLocation: json['currentLocation'] == null
          ? null
          : GeoLocation.fromJson(
              json['currentLocation'] as Map<String, dynamic>),
      etaMinutes: (json['etaMinutes'] as num?)?.toInt(),
    );

Map<String, dynamic> _$$DriverImplToJson(_$DriverImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'phoneNumber': instance.phoneNumber,
      'profileImageUrl': instance.profileImageUrl,
      'rating': instance.rating,
      'totalTrips': instance.totalTrips,
      'currentLocation': instance.currentLocation,
      'etaMinutes': instance.etaMinutes,
    };

_$VehicleImpl _$$VehicleImplFromJson(Map<String, dynamic> json) =>
    _$VehicleImpl(
      id: json['id'] as String,
      make: json['make'] as String,
      model: json['model'] as String,
      color: json['color'] as String,
      plateNumber: json['plateNumber'] as String,
      year: (json['year'] as num?)?.toInt(),
      type: $enumDecodeNullable(_$VehicleTypeEnumMap, json['type']),
      imageUrl: json['imageUrl'] as String?,
    );

Map<String, dynamic> _$$VehicleImplToJson(_$VehicleImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'make': instance.make,
      'model': instance.model,
      'color': instance.color,
      'plateNumber': instance.plateNumber,
      'year': instance.year,
      'type': _$VehicleTypeEnumMap[instance.type],
      'imageUrl': instance.imageUrl,
    };

_$RideEstimateImpl _$$RideEstimateImplFromJson(Map<String, dynamic> json) =>
    _$RideEstimateImpl(
      vehicleType: $enumDecode(_$VehicleTypeEnumMap, json['vehicleType']),
      estimatedFare: (json['estimatedFare'] as num).toDouble(),
      currency: json['currency'] as String,
      estimatedDurationMinutes:
          (json['estimatedDurationMinutes'] as num).toInt(),
      estimatedDistanceKm: (json['estimatedDistanceKm'] as num).toDouble(),
      etaMinutes: (json['etaMinutes'] as num).toInt(),
      surgePriceMultiplier: (json['surgePriceMultiplier'] as num?)?.toDouble(),
      promoCode: json['promoCode'] as String?,
      discount: (json['discount'] as num?)?.toDouble(),
      isAvailable: json['isAvailable'] as bool?,
      unavailableReason: json['unavailableReason'] as String?,
    );

Map<String, dynamic> _$$RideEstimateImplToJson(_$RideEstimateImpl instance) =>
    <String, dynamic>{
      'vehicleType': _$VehicleTypeEnumMap[instance.vehicleType]!,
      'estimatedFare': instance.estimatedFare,
      'currency': instance.currency,
      'estimatedDurationMinutes': instance.estimatedDurationMinutes,
      'estimatedDistanceKm': instance.estimatedDistanceKm,
      'etaMinutes': instance.etaMinutes,
      'surgePriceMultiplier': instance.surgePriceMultiplier,
      'promoCode': instance.promoCode,
      'discount': instance.discount,
      'isAvailable': instance.isAvailable,
      'unavailableReason': instance.unavailableReason,
    };

_$RideRequestImpl _$$RideRequestImplFromJson(Map<String, dynamic> json) =>
    _$RideRequestImpl(
      pickupLocation:
          GeoLocation.fromJson(json['pickupLocation'] as Map<String, dynamic>),
      dropoffLocation:
          GeoLocation.fromJson(json['dropoffLocation'] as Map<String, dynamic>),
      pickupAddress: json['pickupAddress'] as String,
      dropoffAddress: json['dropoffAddress'] as String,
      vehicleType: $enumDecode(_$VehicleTypeEnumMap, json['vehicleType']),
      paymentMethodId: json['paymentMethodId'] as String?,
      promoCode: json['promoCode'] as String?,
      note: json['note'] as String?,
      stops: (json['stops'] as List<dynamic>?)
          ?.map((e) => GeoLocation.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$$RideRequestImplToJson(_$RideRequestImpl instance) =>
    <String, dynamic>{
      'pickupLocation': instance.pickupLocation,
      'dropoffLocation': instance.dropoffLocation,
      'pickupAddress': instance.pickupAddress,
      'dropoffAddress': instance.dropoffAddress,
      'vehicleType': _$VehicleTypeEnumMap[instance.vehicleType]!,
      'paymentMethodId': instance.paymentMethodId,
      'promoCode': instance.promoCode,
      'note': instance.note,
      'stops': instance.stops,
    };
