part of 'delivery_bloc.dart';

/// Base class for delivery states
sealed class DeliveryState extends Equatable {
  const DeliveryState();

  @override
  List<Object?> get props => [];
}

/// Initial state
class DeliveryInitial extends DeliveryState {
  const DeliveryInitial();
}

/// Loading delivery estimate
class DeliveryEstimateLoading extends DeliveryState {
  const DeliveryEstimateLoading();
}

/// Delivery estimate loaded
class DeliveryEstimateLoaded extends DeliveryState {
  const DeliveryEstimateLoaded({
    required this.estimate,
  });

  final DeliveryEstimate estimate;

  @override
  List<Object?> get props => [estimate];
}

/// Requesting delivery
class DeliveryRequesting extends DeliveryState {
  const DeliveryRequesting();
}

/// Delivery requested - searching for courier
class DeliverySearchingCourier extends DeliveryState {
  const DeliverySearchingCourier({
    required this.deliveryId,
  });

  final String deliveryId;

  @override
  List<Object?> get props => [deliveryId];
}

/// Courier assigned
class DeliveryCourierAssigned extends DeliveryState {
  const DeliveryCourierAssigned({
    required this.delivery,
  });

  final Delivery delivery;

  @override
  List<Object?> get props => [delivery];
}

/// Package picked up - in transit
class DeliveryInTransit extends DeliveryState {
  const DeliveryInTransit({
    required this.delivery,
    this.courierLocation,
  });

  final Delivery delivery;
  final LatLng? courierLocation;

  @override
  List<Object?> get props => [delivery, courierLocation];

  DeliveryInTransit copyWith({
    Delivery? delivery,
    LatLng? courierLocation,
  }) {
    return DeliveryInTransit(
      delivery: delivery ?? this.delivery,
      courierLocation: courierLocation ?? this.courierLocation,
    );
  }
}

/// Package delivered
class DeliveryCompleted extends DeliveryState {
  const DeliveryCompleted({
    required this.delivery,
  });

  final Delivery delivery;

  @override
  List<Object?> get props => [delivery];
}

/// Delivery cancelled
class DeliveryCancelledState extends DeliveryState {
  const DeliveryCancelledState({
    required this.deliveryId,
    this.refundAmount,
  });

  final String deliveryId;
  final double? refundAmount;

  @override
  List<Object?> get props => [deliveryId, refundAmount];
}

/// Delivery details loaded
class DeliveryDetailsLoaded extends DeliveryState {
  const DeliveryDetailsLoaded({
    required this.delivery,
  });

  final Delivery delivery;

  @override
  List<Object?> get props => [delivery];
}

/// Delivery history loaded
class DeliveryHistoryLoaded extends DeliveryState {
  const DeliveryHistoryLoaded({
    required this.deliveries,
  });

  final List<Delivery> deliveries;

  @override
  List<Object?> get props => [deliveries];
}

/// Delivery rated
class DeliveryRatedState extends DeliveryState {
  const DeliveryRatedState({
    required this.deliveryId,
  });

  final String deliveryId;

  @override
  List<Object?> get props => [deliveryId];
}

/// Place search results
class DeliveryPlaceSearchResults extends DeliveryState {
  const DeliveryPlaceSearchResults({
    required this.places,
    required this.query,
  });

  final List<PlaceResult> places;
  final String query;

  @override
  List<Object?> get props => [places, query];
}

/// Saved addresses loaded
class SavedAddressesLoaded extends DeliveryState {
  const SavedAddressesLoaded({
    required this.addresses,
  });

  final List<SavedAddress> addresses;

  @override
  List<Object?> get props => [addresses];
}

/// Error state
class DeliveryError extends DeliveryState {
  const DeliveryError({
    required this.message,
    this.previousState,
  });

  final String message;
  final DeliveryState? previousState;

  @override
  List<Object?> get props => [message, previousState];
}

// Supporting models

/// Package size enum
enum PackageSize {
  small,
  medium,
  large,
  extraLarge,
}

extension PackageSizeExtension on PackageSize {
  String get displayName {
    switch (this) {
      case PackageSize.small:
        return 'Small';
      case PackageSize.medium:
        return 'Medium';
      case PackageSize.large:
        return 'Large';
      case PackageSize.extraLarge:
        return 'Extra Large';
    }
  }

  String get description {
    switch (this) {
      case PackageSize.small:
        return 'Up to 5kg • Fits in a backpack';
      case PackageSize.medium:
        return 'Up to 10kg • Fits in a box';
      case PackageSize.large:
        return 'Up to 20kg • Requires motorcycle';
      case PackageSize.extraLarge:
        return 'Up to 50kg • Requires vehicle';
    }
  }

  double get baseFare {
    switch (this) {
      case PackageSize.small:
        return 150;
      case PackageSize.medium:
        return 250;
      case PackageSize.large:
        return 400;
      case PackageSize.extraLarge:
        return 700;
    }
  }

  double get perKmRate {
    switch (this) {
      case PackageSize.small:
        return 15;
      case PackageSize.medium:
        return 20;
      case PackageSize.large:
        return 30;
      case PackageSize.extraLarge:
        return 50;
    }
  }
}

/// Delivery estimate model
class DeliveryEstimate {
  const DeliveryEstimate({
    required this.distanceKm,
    required this.durationMinutes,
    required this.baseFare,
    required this.distanceFare,
    required this.total,
    required this.packageSize,
    this.surgeFactor,
  });

  final double distanceKm;
  final int durationMinutes;
  final double baseFare;
  final double distanceFare;
  final double total;
  final PackageSize packageSize;
  final double? surgeFactor;
}

/// Delivery status enum
enum DeliveryStatus {
  pending,
  confirmed,
  courierAssigned,
  courierEnRoute,
  atPickup,
  pickedUp,
  inTransit,
  nearDropoff,
  delivered,
  cancelled,
  failed,
}

extension DeliveryStatusExtension on DeliveryStatus {
  String get displayName {
    switch (this) {
      case DeliveryStatus.pending:
        return 'Pending';
      case DeliveryStatus.confirmed:
        return 'Confirmed';
      case DeliveryStatus.courierAssigned:
        return 'Courier Assigned';
      case DeliveryStatus.courierEnRoute:
        return 'Courier En Route';
      case DeliveryStatus.atPickup:
        return 'At Pickup';
      case DeliveryStatus.pickedUp:
        return 'Picked Up';
      case DeliveryStatus.inTransit:
        return 'In Transit';
      case DeliveryStatus.nearDropoff:
        return 'Near Dropoff';
      case DeliveryStatus.delivered:
        return 'Delivered';
      case DeliveryStatus.cancelled:
        return 'Cancelled';
      case DeliveryStatus.failed:
        return 'Failed';
    }
  }

  bool get isActive {
    return this != DeliveryStatus.delivered &&
        this != DeliveryStatus.cancelled &&
        this != DeliveryStatus.failed;
  }
}

/// Delivery model
class Delivery {
  const Delivery({
    required this.id,
    required this.status,
    required this.pickupAddress,
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.dropoffAddress,
    required this.dropoffLatitude,
    required this.dropoffLongitude,
    required this.recipientName,
    required this.recipientPhone,
    required this.packageSize,
    required this.baseFare,
    required this.distanceFare,
    required this.total,
    required this.createdAt,
    this.courierName,
    this.courierPhone,
    this.courierPhoto,
    this.courierRating,
    this.vehicleType,
    this.vehiclePlate,
    this.packageDescription,
    this.pickupInstructions,
    this.dropoffInstructions,
    this.estimatedPickupTime,
    this.estimatedDeliveryTime,
    this.actualPickupTime,
    this.actualDeliveryTime,
    this.distanceKm,
    this.paymentMethod,
    this.rating,
    this.tip,
    this.signature,
    this.photoProof,
    this.trackingUrl,
  });

  final String id;
  final DeliveryStatus status;
  final String pickupAddress;
  final double pickupLatitude;
  final double pickupLongitude;
  final String dropoffAddress;
  final double dropoffLatitude;
  final double dropoffLongitude;
  final String recipientName;
  final String recipientPhone;
  final PackageSize packageSize;
  final double baseFare;
  final double distanceFare;
  final double total;
  final DateTime createdAt;
  final String? courierName;
  final String? courierPhone;
  final String? courierPhoto;
  final double? courierRating;
  final String? vehicleType;
  final String? vehiclePlate;
  final String? packageDescription;
  final String? pickupInstructions;
  final String? dropoffInstructions;
  final DateTime? estimatedPickupTime;
  final DateTime? estimatedDeliveryTime;
  final DateTime? actualPickupTime;
  final DateTime? actualDeliveryTime;
  final double? distanceKm;
  final String? paymentMethod;
  final int? rating;
  final double? tip;
  final String? signature;
  final String? photoProof;
  final String? trackingUrl;

  Delivery copyWith({
    String? id,
    DeliveryStatus? status,
    String? pickupAddress,
    double? pickupLatitude,
    double? pickupLongitude,
    String? dropoffAddress,
    double? dropoffLatitude,
    double? dropoffLongitude,
    String? recipientName,
    String? recipientPhone,
    PackageSize? packageSize,
    double? baseFare,
    double? distanceFare,
    double? total,
    DateTime? createdAt,
    String? courierName,
    String? courierPhone,
    String? courierPhoto,
    double? courierRating,
    String? vehicleType,
    String? vehiclePlate,
    String? packageDescription,
    String? pickupInstructions,
    String? dropoffInstructions,
    DateTime? estimatedPickupTime,
    DateTime? estimatedDeliveryTime,
    DateTime? actualPickupTime,
    DateTime? actualDeliveryTime,
    double? distanceKm,
    String? paymentMethod,
    int? rating,
    double? tip,
    String? signature,
    String? photoProof,
    String? trackingUrl,
  }) {
    return Delivery(
      id: id ?? this.id,
      status: status ?? this.status,
      pickupAddress: pickupAddress ?? this.pickupAddress,
      pickupLatitude: pickupLatitude ?? this.pickupLatitude,
      pickupLongitude: pickupLongitude ?? this.pickupLongitude,
      dropoffAddress: dropoffAddress ?? this.dropoffAddress,
      dropoffLatitude: dropoffLatitude ?? this.dropoffLatitude,
      dropoffLongitude: dropoffLongitude ?? this.dropoffLongitude,
      recipientName: recipientName ?? this.recipientName,
      recipientPhone: recipientPhone ?? this.recipientPhone,
      packageSize: packageSize ?? this.packageSize,
      baseFare: baseFare ?? this.baseFare,
      distanceFare: distanceFare ?? this.distanceFare,
      total: total ?? this.total,
      createdAt: createdAt ?? this.createdAt,
      courierName: courierName ?? this.courierName,
      courierPhone: courierPhone ?? this.courierPhone,
      courierPhoto: courierPhoto ?? this.courierPhoto,
      courierRating: courierRating ?? this.courierRating,
      vehicleType: vehicleType ?? this.vehicleType,
      vehiclePlate: vehiclePlate ?? this.vehiclePlate,
      packageDescription: packageDescription ?? this.packageDescription,
      pickupInstructions: pickupInstructions ?? this.pickupInstructions,
      dropoffInstructions: dropoffInstructions ?? this.dropoffInstructions,
      estimatedPickupTime: estimatedPickupTime ?? this.estimatedPickupTime,
      estimatedDeliveryTime:
          estimatedDeliveryTime ?? this.estimatedDeliveryTime,
      actualPickupTime: actualPickupTime ?? this.actualPickupTime,
      actualDeliveryTime: actualDeliveryTime ?? this.actualDeliveryTime,
      distanceKm: distanceKm ?? this.distanceKm,
      paymentMethod: paymentMethod ?? this.paymentMethod,
      rating: rating ?? this.rating,
      tip: tip ?? this.tip,
      signature: signature ?? this.signature,
      photoProof: photoProof ?? this.photoProof,
      trackingUrl: trackingUrl ?? this.trackingUrl,
    );
  }
}

/// Place result for search
class PlaceResult {
  const PlaceResult({
    required this.id,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    this.distance,
  });

  final String id;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final double? distance;
}

/// Saved address model
class SavedAddress {
  const SavedAddress({
    required this.id,
    required this.name,
    required this.address,
    required this.latitude,
    required this.longitude,
    this.type,
    this.isDefault = false,
  });

  final String id;
  final String name;
  final String address;
  final double latitude;
  final double longitude;
  final String? type;
  final bool isDefault;
}

/// LatLng for location
class LatLng {
  const LatLng(this.latitude, this.longitude);

  final double latitude;
  final double longitude;

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is LatLng &&
        other.latitude == latitude &&
        other.longitude == longitude;
  }

  @override
  int get hashCode => latitude.hashCode ^ longitude.hashCode;
}
