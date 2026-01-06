/// Delivery Entity
///
/// Domain entities for package delivery.
library;

import 'package:equatable/equatable.dart';

import 'location.dart';
import 'ride.dart';

/// Status of a delivery
enum DeliveryStatus {
  pending('pending', 'Pending'),
  searching('searching', 'Finding Driver'),
  accepted('accepted', 'Driver Assigned'),
  pickingUp('picking_up', 'Picking Up Package'),
  pickedUp('picked_up', 'Package Collected'),
  delivering('delivering', 'On the Way'),
  delivered('delivered', 'Delivered'),
  cancelled('cancelled', 'Cancelled');

  const DeliveryStatus(this.value, this.displayName);

  final String value;
  final String displayName;

  bool get isActive => ![delivered, cancelled].contains(this);
  bool get canCancel => [pending, searching, accepted].contains(this);
}

/// Package size options
enum PackageSize {
  small('small', 'Small', 'Fits in a bag (max 5kg)'),
  medium('medium', 'Medium', 'Fits in a backpack (max 10kg)'),
  large('large', 'Large', 'Requires two hands (max 20kg)'),
  extraLarge('extra_large', 'Extra Large', 'May require special handling (max 50kg)');

  const PackageSize(this.value, this.label, this.description);

  final String value;
  final String label;
  final String description;
}

/// Delivery entity
class Delivery extends Equatable {
  const Delivery({
    required this.id,
    required this.status,
    required this.pickupLocation,
    required this.pickupAddress,
    required this.pickupContact,
    required this.dropoffLocation,
    required this.dropoffAddress,
    required this.dropoffContact,
    required this.packageSize,
    required this.packageDescription,
    required this.currency,
    required this.createdAt,
    this.driver,
    this.vehicle,
    this.packageWeight,
    this.isFragile = false,
    this.requiresSignature = false,
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

  final String id;
  final DeliveryStatus status;
  final GeoLocation pickupLocation;
  final String pickupAddress;
  final DeliveryContact pickupContact;
  final GeoLocation dropoffLocation;
  final String dropoffAddress;
  final DeliveryContact dropoffContact;
  final PackageSize packageSize;
  final String packageDescription;
  final String currency;
  final DateTime createdAt;
  final Driver? driver;
  final Vehicle? vehicle;
  final double? packageWeight;
  final bool isFragile;
  final bool requiresSignature;
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

  /// Whether the delivery can be cancelled
  bool get canCancel => status.canCancel;

  /// Whether the delivery is active
  bool get isActive => status.isActive;

  /// ETA as Duration
  Duration? get etaDuration => eta != null ? Duration(seconds: eta!) : null;

  /// Display fare (estimated or final)
  double? get displayFare => finalFare ?? estimatedFare;

  @override
  List<Object?> get props => [
        id,
        status,
        pickupLocation,
        pickupAddress,
        dropoffLocation,
        dropoffAddress,
        packageSize,
        createdAt,
      ];

  Delivery copyWith({
    String? id,
    DeliveryStatus? status,
    GeoLocation? pickupLocation,
    String? pickupAddress,
    DeliveryContact? pickupContact,
    GeoLocation? dropoffLocation,
    String? dropoffAddress,
    DeliveryContact? dropoffContact,
    PackageSize? packageSize,
    String? packageDescription,
    String? currency,
    DateTime? createdAt,
    Driver? driver,
    Vehicle? vehicle,
    double? packageWeight,
    bool? isFragile,
    bool? requiresSignature,
    double? estimatedFare,
    double? finalFare,
    double? distance,
    int? duration,
    int? eta,
    String? paymentMethodId,
    String? paymentStatus,
    DateTime? scheduledTime,
    String? pickupNotes,
    String? dropoffNotes,
    DateTime? pickedUpAt,
    DateTime? deliveredAt,
    DateTime? cancelledAt,
    String? cancellationReason,
    String? signatureImageUrl,
    String? proofOfDeliveryImageUrl,
    int? rating,
    String? trackingCode,
  }) {
    return Delivery(
      id: id ?? this.id,
      status: status ?? this.status,
      pickupLocation: pickupLocation ?? this.pickupLocation,
      pickupAddress: pickupAddress ?? this.pickupAddress,
      pickupContact: pickupContact ?? this.pickupContact,
      dropoffLocation: dropoffLocation ?? this.dropoffLocation,
      dropoffAddress: dropoffAddress ?? this.dropoffAddress,
      dropoffContact: dropoffContact ?? this.dropoffContact,
      packageSize: packageSize ?? this.packageSize,
      packageDescription: packageDescription ?? this.packageDescription,
      currency: currency ?? this.currency,
      createdAt: createdAt ?? this.createdAt,
      driver: driver ?? this.driver,
      vehicle: vehicle ?? this.vehicle,
      packageWeight: packageWeight ?? this.packageWeight,
      isFragile: isFragile ?? this.isFragile,
      requiresSignature: requiresSignature ?? this.requiresSignature,
      estimatedFare: estimatedFare ?? this.estimatedFare,
      finalFare: finalFare ?? this.finalFare,
      distance: distance ?? this.distance,
      duration: duration ?? this.duration,
      eta: eta ?? this.eta,
      paymentMethodId: paymentMethodId ?? this.paymentMethodId,
      paymentStatus: paymentStatus ?? this.paymentStatus,
      scheduledTime: scheduledTime ?? this.scheduledTime,
      pickupNotes: pickupNotes ?? this.pickupNotes,
      dropoffNotes: dropoffNotes ?? this.dropoffNotes,
      pickedUpAt: pickedUpAt ?? this.pickedUpAt,
      deliveredAt: deliveredAt ?? this.deliveredAt,
      cancelledAt: cancelledAt ?? this.cancelledAt,
      cancellationReason: cancellationReason ?? this.cancellationReason,
      signatureImageUrl: signatureImageUrl ?? this.signatureImageUrl,
      proofOfDeliveryImageUrl: proofOfDeliveryImageUrl ?? this.proofOfDeliveryImageUrl,
      rating: rating ?? this.rating,
      trackingCode: trackingCode ?? this.trackingCode,
    );
  }
}

/// Contact information for delivery
class DeliveryContact extends Equatable {
  const DeliveryContact({
    required this.name,
    required this.phoneNumber,
  });

  final String name;
  final String phoneNumber;

  @override
  List<Object?> get props => [name, phoneNumber];
}

/// Delivery request for creating new deliveries
class DeliveryRequest extends Equatable {
  const DeliveryRequest({
    required this.pickupLocation,
    required this.pickupAddress,
    required this.pickupContact,
    required this.dropoffLocation,
    required this.dropoffAddress,
    required this.dropoffContact,
    required this.packageSize,
    required this.packageDescription,
    required this.paymentMethodId,
    this.packageWeight,
    this.isFragile = false,
    this.requiresSignature = false,
    this.scheduledTime,
    this.pickupNotes,
    this.dropoffNotes,
    this.promoCode,
  });

  final GeoLocation pickupLocation;
  final String pickupAddress;
  final DeliveryContact pickupContact;
  final GeoLocation dropoffLocation;
  final String dropoffAddress;
  final DeliveryContact dropoffContact;
  final PackageSize packageSize;
  final String packageDescription;
  final String paymentMethodId;
  final double? packageWeight;
  final bool isFragile;
  final bool requiresSignature;
  final DateTime? scheduledTime;
  final String? pickupNotes;
  final String? dropoffNotes;
  final String? promoCode;

  @override
  List<Object?> get props => [
        pickupLocation,
        dropoffLocation,
        packageSize,
        packageDescription,
        paymentMethodId,
      ];
}

/// Delivery estimate
class DeliveryEstimate extends Equatable {
  const DeliveryEstimate({
    required this.estimatedFare,
    required this.currency,
    required this.estimatedDuration,
    required this.estimatedDistance,
    required this.eta,
    this.breakdown,
    this.surgeMultiplier,
  });

  final double estimatedFare;
  final String currency;
  final Duration estimatedDuration;
  final double estimatedDistance;
  final Duration eta;
  final DeliveryFareBreakdown? breakdown;
  final double? surgeMultiplier;

  @override
  List<Object?> get props => [
        estimatedFare,
        currency,
        estimatedDuration,
        estimatedDistance,
        eta,
      ];
}

/// Breakdown of delivery fare
class DeliveryFareBreakdown extends Equatable {
  const DeliveryFareBreakdown({
    required this.baseFare,
    required this.distanceFare,
    required this.sizeFare,
    this.weightFare,
    this.fragileFee,
    this.signatureFee,
    this.surgeFee,
  });

  final double baseFare;
  final double distanceFare;
  final double sizeFare;
  final double? weightFare;
  final double? fragileFee;
  final double? signatureFee;
  final double? surgeFee;

  double get total =>
      baseFare +
      distanceFare +
      sizeFare +
      (weightFare ?? 0) +
      (fragileFee ?? 0) +
      (signatureFee ?? 0) +
      (surgeFee ?? 0);

  @override
  List<Object?> get props => [baseFare, distanceFare, sizeFare];
}

