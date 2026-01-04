part of 'delivery_bloc.dart';

/// Base class for delivery events
sealed class DeliveryEvent extends Equatable {
  const DeliveryEvent();

  @override
  List<Object?> get props => [];
}

/// Event to calculate delivery estimate
class DeliveryEstimateRequested extends DeliveryEvent {
  const DeliveryEstimateRequested({
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.dropoffLatitude,
    required this.dropoffLongitude,
    required this.packageSize,
  });

  final double pickupLatitude;
  final double pickupLongitude;
  final double dropoffLatitude;
  final double dropoffLongitude;
  final PackageSize packageSize;

  @override
  List<Object?> get props => [
        pickupLatitude,
        pickupLongitude,
        dropoffLatitude,
        dropoffLongitude,
        packageSize,
      ];
}

/// Event to create a new delivery request
class DeliveryRequested extends DeliveryEvent {
  const DeliveryRequested({
    required this.pickupAddress,
    required this.pickupLatitude,
    required this.pickupLongitude,
    required this.dropoffAddress,
    required this.dropoffLatitude,
    required this.dropoffLongitude,
    required this.recipientName,
    required this.recipientPhone,
    required this.packageSize,
    required this.paymentMethodId,
    this.packageDescription,
    this.pickupInstructions,
    this.dropoffInstructions,
    this.scheduledTime,
  });

  final String pickupAddress;
  final double pickupLatitude;
  final double pickupLongitude;
  final String dropoffAddress;
  final double dropoffLatitude;
  final double dropoffLongitude;
  final String recipientName;
  final String recipientPhone;
  final PackageSize packageSize;
  final String paymentMethodId;
  final String? packageDescription;
  final String? pickupInstructions;
  final String? dropoffInstructions;
  final DateTime? scheduledTime;

  @override
  List<Object?> get props => [
        pickupAddress,
        pickupLatitude,
        pickupLongitude,
        dropoffAddress,
        dropoffLatitude,
        dropoffLongitude,
        recipientName,
        recipientPhone,
        packageSize,
        paymentMethodId,
        packageDescription,
        pickupInstructions,
        dropoffInstructions,
        scheduledTime,
      ];
}

/// Event to cancel a delivery
class DeliveryCancelled extends DeliveryEvent {
  const DeliveryCancelled(this.deliveryId);

  final String deliveryId;

  @override
  List<Object?> get props => [deliveryId];
}

/// Event to load delivery details
class DeliveryDetailsRequested extends DeliveryEvent {
  const DeliveryDetailsRequested(this.deliveryId);

  final String deliveryId;

  @override
  List<Object?> get props => [deliveryId];
}

/// Event to load delivery history
class DeliveryHistoryRequested extends DeliveryEvent {
  const DeliveryHistoryRequested();
}

/// Event to start watching delivery status
class DeliveryStatusWatchStarted extends DeliveryEvent {
  const DeliveryStatusWatchStarted(this.deliveryId);

  final String deliveryId;

  @override
  List<Object?> get props => [deliveryId];
}

/// Event to stop watching delivery status
class DeliveryStatusWatchStopped extends DeliveryEvent {
  const DeliveryStatusWatchStopped();
}

/// Internal event for delivery status updates
class _DeliveryStatusUpdated extends DeliveryEvent {
  const _DeliveryStatusUpdated(this.delivery);

  final Delivery delivery;

  @override
  List<Object?> get props => [delivery];
}

/// Internal event for courier location updates
class _CourierLocationUpdated extends DeliveryEvent {
  const _CourierLocationUpdated({
    required this.latitude,
    required this.longitude,
  });

  final double latitude;
  final double longitude;

  @override
  List<Object?> get props => [latitude, longitude];
}

/// Event to rate a delivery
class DeliveryRated extends DeliveryEvent {
  const DeliveryRated({
    required this.deliveryId,
    required this.rating,
    this.comment,
    this.tip,
  });

  final String deliveryId;
  final int rating;
  final String? comment;
  final double? tip;

  @override
  List<Object?> get props => [deliveryId, rating, comment, tip];
}

/// Event to add tip to courier
class DeliveryTipAdded extends DeliveryEvent {
  const DeliveryTipAdded({
    required this.deliveryId,
    required this.tipAmount,
  });

  final String deliveryId;
  final double tipAmount;

  @override
  List<Object?> get props => [deliveryId, tipAmount];
}

/// Event to search for places
class DeliveryPlaceSearchRequested extends DeliveryEvent {
  const DeliveryPlaceSearchRequested(this.query);

  final String query;

  @override
  List<Object?> get props => [query];
}

/// Event to get saved addresses
class SavedAddressesRequested extends DeliveryEvent {
  const SavedAddressesRequested();
}

/// Event to contact courier
class CourierContactRequested extends DeliveryEvent {
  const CourierContactRequested({
    required this.deliveryId,
    required this.contactType,
  });

  final String deliveryId;
  final ContactType contactType;

  @override
  List<Object?> get props => [deliveryId, contactType];
}

/// Event to confirm package pickup
class PackagePickupConfirmed extends DeliveryEvent {
  const PackagePickupConfirmed(this.deliveryId);

  final String deliveryId;

  @override
  List<Object?> get props => [deliveryId];
}

/// Event to confirm package delivery
class PackageDeliveryConfirmed extends DeliveryEvent {
  const PackageDeliveryConfirmed({
    required this.deliveryId,
    this.signature,
    this.photoProof,
  });

  final String deliveryId;
  final String? signature;
  final String? photoProof;

  @override
  List<Object?> get props => [deliveryId, signature, photoProof];
}

/// Event to clear delivery state
class DeliveryCleared extends DeliveryEvent {
  const DeliveryCleared();
}

/// Contact type enum
enum ContactType {
  call,
  message,
}
