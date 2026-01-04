import 'dart:async';
import 'dart:math';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

part 'delivery_event.dart';
part 'delivery_state.dart';

/// BLoC for managing package delivery
class DeliveryBloc extends Bloc<DeliveryEvent, DeliveryState> {
  DeliveryBloc() : super(const DeliveryInitial()) {
    on<DeliveryEstimateRequested>(_onDeliveryEstimateRequested);
    on<DeliveryRequested>(_onDeliveryRequested);
    on<DeliveryCancelled>(_onDeliveryCancelled);
    on<DeliveryDetailsRequested>(_onDeliveryDetailsRequested);
    on<DeliveryHistoryRequested>(_onDeliveryHistoryRequested);
    on<DeliveryStatusWatchStarted>(_onDeliveryStatusWatchStarted);
    on<DeliveryStatusWatchStopped>(_onDeliveryStatusWatchStopped);
    on<_DeliveryStatusUpdated>(_onDeliveryStatusUpdated);
    on<_CourierLocationUpdated>(_onCourierLocationUpdated);
    on<DeliveryRated>(_onDeliveryRated);
    on<DeliveryTipAdded>(_onDeliveryTipAdded);
    on<DeliveryPlaceSearchRequested>(_onDeliveryPlaceSearchRequested);
    on<SavedAddressesRequested>(_onSavedAddressesRequested);
    on<CourierContactRequested>(_onCourierContactRequested);
    on<PackagePickupConfirmed>(_onPackagePickupConfirmed);
    on<PackageDeliveryConfirmed>(_onPackageDeliveryConfirmed);
    on<DeliveryCleared>(_onDeliveryCleared);
  }

  static const _uuid = Uuid();
  StreamSubscription<Delivery>? _deliveryStatusSubscription;
  StreamSubscription<LatLng>? _courierLocationSubscription;

  // Sample data
  static final List<SavedAddress> _sampleAddresses = [
    SavedAddress(
      id: '1',
      name: 'Home',
      address: '123 Kilimani Road, Nairobi',
      latitude: -1.2864,
      longitude: 36.8172,
      type: 'home',
      isDefault: true,
    ),
    SavedAddress(
      id: '2',
      name: 'Office',
      address: 'Westlands Business Park, Nairobi',
      latitude: -1.2673,
      longitude: 36.8114,
      type: 'work',
    ),
    SavedAddress(
      id: '3',
      name: "Mom's Place",
      address: '45 Karen Road, Karen',
      latitude: -1.3226,
      longitude: 36.7140,
      type: 'other',
    ),
  ];

  @override
  Future<void> close() {
    _deliveryStatusSubscription?.cancel();
    _courierLocationSubscription?.cancel();
    return super.close();
  }

  Future<void> _onDeliveryEstimateRequested(
    DeliveryEstimateRequested event,
    Emitter<DeliveryState> emit,
  ) async {
    emit(const DeliveryEstimateLoading());

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      // Calculate distance using Haversine formula (simplified)
      final distanceKm = _calculateDistance(
        event.pickupLatitude,
        event.pickupLongitude,
        event.dropoffLatitude,
        event.dropoffLongitude,
      );

      // Calculate duration (assuming avg speed of 25 km/h in traffic)
      final durationMinutes = (distanceKm / 25 * 60).round();

      // Calculate fare
      final baseFare = event.packageSize.baseFare;
      final distanceFare = distanceKm * event.packageSize.perKmRate;
      final total = baseFare + distanceFare;

      final estimate = DeliveryEstimate(
        distanceKm: distanceKm,
        durationMinutes: durationMinutes,
        baseFare: baseFare,
        distanceFare: distanceFare,
        total: total,
        packageSize: event.packageSize,
      );

      emit(DeliveryEstimateLoaded(estimate: estimate));
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onDeliveryRequested(
    DeliveryRequested event,
    Emitter<DeliveryState> emit,
  ) async {
    emit(const DeliveryRequesting());

    try {
      await Future.delayed(const Duration(seconds: 1));

      final deliveryId = _uuid.v4();

      emit(DeliverySearchingCourier(deliveryId: deliveryId));

      // Simulate finding a courier
      await Future.delayed(const Duration(seconds: 3));

      // Calculate distance and fare
      final distanceKm = _calculateDistance(
        event.pickupLatitude,
        event.pickupLongitude,
        event.dropoffLatitude,
        event.dropoffLongitude,
      );

      final baseFare = event.packageSize.baseFare;
      final distanceFare = distanceKm * event.packageSize.perKmRate;

      final delivery = Delivery(
        id: deliveryId,
        status: DeliveryStatus.courierAssigned,
        pickupAddress: event.pickupAddress,
        pickupLatitude: event.pickupLatitude,
        pickupLongitude: event.pickupLongitude,
        dropoffAddress: event.dropoffAddress,
        dropoffLatitude: event.dropoffLatitude,
        dropoffLongitude: event.dropoffLongitude,
        recipientName: event.recipientName,
        recipientPhone: event.recipientPhone,
        packageSize: event.packageSize,
        baseFare: baseFare,
        distanceFare: distanceFare,
        total: baseFare + distanceFare,
        createdAt: DateTime.now(),
        courierName: 'Peter Mwangi',
        courierPhone: '+254 723 456 789',
        courierRating: 4.9,
        vehicleType: 'Honda PCX',
        vehiclePlate: 'KDD 123X',
        packageDescription: event.packageDescription,
        pickupInstructions: event.pickupInstructions,
        dropoffInstructions: event.dropoffInstructions,
        estimatedPickupTime: DateTime.now().add(const Duration(minutes: 10)),
        estimatedDeliveryTime: DateTime.now().add(const Duration(minutes: 40)),
        distanceKm: distanceKm,
        paymentMethod: 'M-Pesa',
      );

      emit(DeliveryCourierAssigned(delivery: delivery));
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onDeliveryCancelled(
    DeliveryCancelled event,
    Emitter<DeliveryState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));

      await _deliveryStatusSubscription?.cancel();
      await _courierLocationSubscription?.cancel();

      emit(DeliveryCancelledState(
        deliveryId: event.deliveryId,
        refundAmount: 0, // Calculate based on status
      ));
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onDeliveryDetailsRequested(
    DeliveryDetailsRequested event,
    Emitter<DeliveryState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final delivery = Delivery(
        id: event.deliveryId,
        status: DeliveryStatus.delivered,
        pickupAddress: 'Junction Mall, Ngong Road',
        pickupLatitude: -1.2864,
        pickupLongitude: 36.7586,
        dropoffAddress: 'Karen Office Park, Block B',
        dropoffLatitude: -1.3226,
        dropoffLongitude: 36.7140,
        recipientName: 'Jane Doe',
        recipientPhone: '+254 712 345 678',
        packageSize: PackageSize.medium,
        baseFare: 250,
        distanceFare: 250,
        total: 500,
        createdAt: DateTime.now().subtract(const Duration(hours: 2)),
        courierName: 'Peter Mwangi',
        courierPhone: '+254 723 456 789',
        courierRating: 4.9,
        vehicleType: 'Honda PCX',
        vehiclePlate: 'KDD 123X',
        packageDescription: 'Electronics - Laptop',
        distanceKm: 12.5,
        paymentMethod: 'M-Pesa',
        rating: 5,
        actualPickupTime:
            DateTime.now().subtract(const Duration(hours: 1, minutes: 45)),
        actualDeliveryTime:
            DateTime.now().subtract(const Duration(hours: 1, minutes: 10)),
      );

      emit(DeliveryDetailsLoaded(delivery: delivery));
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onDeliveryHistoryRequested(
    DeliveryHistoryRequested event,
    Emitter<DeliveryState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final deliveries = List.generate(
        5,
        (i) => Delivery(
          id: _uuid.v4(),
          status: DeliveryStatus.delivered,
          pickupAddress: 'Location ${i + 1}',
          pickupLatitude: -1.2864 + (i * 0.01),
          pickupLongitude: 36.7586 + (i * 0.01),
          dropoffAddress: 'Destination ${i + 1}',
          dropoffLatitude: -1.3226 + (i * 0.01),
          dropoffLongitude: 36.7140 + (i * 0.01),
          recipientName: 'Recipient ${i + 1}',
          recipientPhone: '+254 712 345 67${i}',
          packageSize: PackageSize.values[i % PackageSize.values.length],
          baseFare: 150 + (i * 50),
          distanceFare: 100 + (i * 30),
          total: 250 + (i * 80),
          createdAt: DateTime.now().subtract(Duration(days: i + 1)),
          distanceKm: 5 + (i * 2.5),
          paymentMethod: 'M-Pesa',
          rating: i % 2 == 0 ? 5 : 4,
        ),
      );

      emit(DeliveryHistoryLoaded(deliveries: deliveries));
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onDeliveryStatusWatchStarted(
    DeliveryStatusWatchStarted event,
    Emitter<DeliveryState> emit,
  ) async {
    await _deliveryStatusSubscription?.cancel();
    await _courierLocationSubscription?.cancel();

    // Simulate status updates
    var statusIndex = DeliveryStatus.courierAssigned.index;

    _deliveryStatusSubscription = Stream.periodic(
      const Duration(seconds: 15),
      (i) {
        if (statusIndex < DeliveryStatus.delivered.index) {
          statusIndex++;
        }
        return _createDeliveryWithStatus(
          event.deliveryId,
          DeliveryStatus.values[statusIndex],
        );
      },
    ).listen((delivery) {
      add(_DeliveryStatusUpdated(delivery));
    });

    // Simulate courier location updates
    _courierLocationSubscription = Stream.periodic(
      const Duration(seconds: 5),
      (i) => LatLng(
        -1.2864 + (i * 0.001),
        36.7586 + (i * 0.001),
      ),
    ).listen((location) {
      add(_CourierLocationUpdated(
        latitude: location.latitude,
        longitude: location.longitude,
      ));
    });
  }

  Future<void> _onDeliveryStatusWatchStopped(
    DeliveryStatusWatchStopped event,
    Emitter<DeliveryState> emit,
  ) async {
    await _deliveryStatusSubscription?.cancel();
    await _courierLocationSubscription?.cancel();
    _deliveryStatusSubscription = null;
    _courierLocationSubscription = null;
  }

  void _onDeliveryStatusUpdated(
    _DeliveryStatusUpdated event,
    Emitter<DeliveryState> emit,
  ) {
    if (event.delivery.status == DeliveryStatus.delivered) {
      emit(DeliveryCompleted(delivery: event.delivery));
    } else if (event.delivery.status == DeliveryStatus.inTransit ||
        event.delivery.status == DeliveryStatus.pickedUp) {
      final currentState = state;
      emit(DeliveryInTransit(
        delivery: event.delivery,
        courierLocation: currentState is DeliveryInTransit
            ? currentState.courierLocation
            : null,
      ));
    } else {
      emit(DeliveryCourierAssigned(delivery: event.delivery));
    }
  }

  void _onCourierLocationUpdated(
    _CourierLocationUpdated event,
    Emitter<DeliveryState> emit,
  ) {
    final currentState = state;
    if (currentState is DeliveryInTransit) {
      emit(currentState.copyWith(
        courierLocation: LatLng(event.latitude, event.longitude),
      ));
    }
  }

  Future<void> _onDeliveryRated(
    DeliveryRated event,
    Emitter<DeliveryState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));
      emit(DeliveryRatedState(deliveryId: event.deliveryId));
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onDeliveryTipAdded(
    DeliveryTipAdded event,
    Emitter<DeliveryState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));
      // Update delivery with tip
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onDeliveryPlaceSearchRequested(
    DeliveryPlaceSearchRequested event,
    Emitter<DeliveryState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      // Simulate place search results
      final places = [
        PlaceResult(
          id: '1',
          name: 'Junction Mall',
          address: 'Ngong Road, Nairobi',
          latitude: -1.2864,
          longitude: 36.7586,
          distance: 2.5,
        ),
        PlaceResult(
          id: '2',
          name: 'Westgate Mall',
          address: 'Westlands, Nairobi',
          latitude: -1.2673,
          longitude: 36.8030,
          distance: 3.8,
        ),
        PlaceResult(
          id: '3',
          name: 'The Hub Karen',
          address: 'Dagoretti Road, Karen',
          latitude: -1.3226,
          longitude: 36.7140,
          distance: 8.2,
        ),
      ]
          .where((p) =>
              p.name.toLowerCase().contains(event.query.toLowerCase()) ||
              p.address.toLowerCase().contains(event.query.toLowerCase()))
          .toList();

      emit(DeliveryPlaceSearchResults(places: places, query: event.query));
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onSavedAddressesRequested(
    SavedAddressesRequested event,
    Emitter<DeliveryState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));
      emit(SavedAddressesLoaded(addresses: _sampleAddresses));
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onCourierContactRequested(
    CourierContactRequested event,
    Emitter<DeliveryState> emit,
  ) async {
    try {
      // Launch phone or messaging app
      // This would typically use url_launcher
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onPackagePickupConfirmed(
    PackagePickupConfirmed event,
    Emitter<DeliveryState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));
      // Confirm pickup with backend
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  Future<void> _onPackageDeliveryConfirmed(
    PackageDeliveryConfirmed event,
    Emitter<DeliveryState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));
      // Confirm delivery with backend
    } catch (e) {
      emit(DeliveryError(message: e.toString()));
    }
  }

  void _onDeliveryCleared(
    DeliveryCleared event,
    Emitter<DeliveryState> emit,
  ) {
    emit(const DeliveryInitial());
  }

  // Helper methods

  double _calculateDistance(
    double lat1,
    double lon1,
    double lat2,
    double lon2,
  ) {
    const earthRadius = 6371.0; // km

    final dLat = _toRadians(lat2 - lat1);
    final dLon = _toRadians(lon2 - lon1);

    final a = sin(dLat / 2) * sin(dLat / 2) +
        cos(_toRadians(lat1)) *
            cos(_toRadians(lat2)) *
            sin(dLon / 2) *
            sin(dLon / 2);

    final c = 2 * atan2(sqrt(a), sqrt(1 - a));

    return earthRadius * c;
  }

  double _toRadians(double degrees) {
    return degrees * pi / 180;
  }

  Delivery _createDeliveryWithStatus(String deliveryId, DeliveryStatus status) {
    return Delivery(
      id: deliveryId,
      status: status,
      pickupAddress: 'Junction Mall, Ngong Road',
      pickupLatitude: -1.2864,
      pickupLongitude: 36.7586,
      dropoffAddress: 'Karen Office Park, Block B',
      dropoffLatitude: -1.3226,
      dropoffLongitude: 36.7140,
      recipientName: 'Jane Doe',
      recipientPhone: '+254 712 345 678',
      packageSize: PackageSize.medium,
      baseFare: 250,
      distanceFare: 250,
      total: 500,
      createdAt: DateTime.now(),
      courierName: 'Peter Mwangi',
      courierPhone: '+254 723 456 789',
      courierRating: 4.9,
      vehicleType: 'Honda PCX',
      vehiclePlate: 'KDD 123X',
      estimatedDeliveryTime: DateTime.now().add(const Duration(minutes: 25)),
      distanceKm: 12.5,
    );
  }
}
