import 'dart:async';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ubi_core/ubi_core.dart';

import 'ride_event.dart';
import 'ride_state.dart';

/// BLoC for managing ride booking flow
class RideBloc extends Bloc<RideEvent, RideState> {
  final GetRideEstimates _getRideEstimates;
  final RequestRide _requestRide;
  final CancelRide _cancelRide;
  final RateRide _rateRide;
  final AddRideTip _addRideTip;
  final WatchRideStatus _watchRideStatus;
  final WatchDriverLocation _watchDriverLocation;
  final GetNearbyDrivers _getNearbyDrivers;
  final SearchPlaces _searchPlaces;

  StreamSubscription? _rideSubscription;
  StreamSubscription? _driverLocationSubscription;

  RideBloc({
    required GetRideEstimates getRideEstimates,
    required RequestRide requestRide,
    required CancelRide cancelRide,
    required RateRide rateRide,
    required AddRideTip addRideTip,
    required WatchRideStatus watchRideStatus,
    required WatchDriverLocation watchDriverLocation,
    required GetNearbyDrivers getNearbyDrivers,
    required SearchPlaces searchPlaces,
  })  : _getRideEstimates = getRideEstimates,
        _requestRide = requestRide,
        _cancelRide = cancelRide,
        _rateRide = rateRide,
        _addRideTip = addRideTip,
        _watchRideStatus = watchRideStatus,
        _watchDriverLocation = watchDriverLocation,
        _getNearbyDrivers = getNearbyDrivers,
        _searchPlaces = searchPlaces,
        super(const RideInitial()) {
    on<RideEstimatesRequested>(_onEstimatesRequested);
    on<RideRequested>(_onRideRequested);
    on<RideCancelled>(_onRideCancelled);
    on<RideRated>(_onRideRated);
    on<RideTipAdded>(_onTipAdded);
    on<RideWatchStarted>(_onWatchStarted);
    on<RideWatchStopped>(_onWatchStopped);
    on<RideStatusUpdated>(_onStatusUpdated);
    on<DriverLocationUpdated>(_onDriverLocationUpdated);
    on<PlaceSearchRequested>(_onPlaceSearchRequested);
    on<NearbyDriversRequested>(_onNearbyDriversRequested);
    on<RideCleared>(_onCleared);
  }

  Future<void> _onEstimatesRequested(
    RideEstimatesRequested event,
    Emitter<RideState> emit,
  ) async {
    emit(const RideLoading());

    final result = await _getRideEstimates(
      GetRideEstimatesParams(
        pickup: event.pickup,
        dropoff: event.dropoff,
      ),
    );

    result.fold(
      onFailure: (failure) => emit(RideError(failure.userMessage)),
      onSuccess: (estimates) => emit(RideEstimatesLoaded(
        pickup: event.pickup,
        dropoff: event.dropoff,
        estimates: estimates
            .map((e) => RideEstimateUI(
                  vehicleType: e.vehicleType.name,
                  displayName: _getVehicleDisplayName(e.vehicleType),
                  price: e.estimatedFare,
                  currency: e.currency,
                  etaMinutes: e.etaMinutes,
                  surgeMultiplier: e.surgePriceMultiplier?.toString(),
                ))
            .toList(),
      )),
    );
  }

  /// Get display name for vehicle type
  String _getVehicleDisplayName(VehicleType type) {
    return switch (type) {
      VehicleType.ubiX => 'UBI X',
      VehicleType.ubiComfort => 'UBI Comfort',
      VehicleType.ubiXL => 'UBI XL',
      VehicleType.ubiLux => 'UBI Lux',
      VehicleType.ubiMoto => 'UBI Moto',
    };
  }

  Future<void> _onRideRequested(
    RideRequested event,
    Emitter<RideState> emit,
  ) async {
    emit(const RideLoading());

    final result = await _requestRide(
      RequestRideParams(
        pickup: event.pickup,
        dropoff: event.dropoff,
        vehicleType: event.vehicleType,
        promoCode: event.promoCode,
      ),
    );

    result.fold(
      onFailure: (failure) => emit(RideError(failure.userMessage)),
      onSuccess: (ride) {
        emit(RideSearchingDriver(ride));
        // Start watching ride status
        add(RideWatchStarted(rideId: ride.id));
      },
    );
  }

  Future<void> _onRideCancelled(
    RideCancelled event,
    Emitter<RideState> emit,
  ) async {
    emit(const RideLoading());

    final result = await _cancelRide(
      CancelRideParams(
        rideId: event.rideId,
        reason: event.reason,
      ),
    );

    result.fold(
      onFailure: (failure) => emit(RideError(failure.userMessage)),
      onSuccess: (_) {
        add(const RideWatchStopped());
        emit(RideCancelledState(
          rideId: event.rideId,
          reason: event.reason,
        ));
      },
    );
  }

  Future<void> _onRideRated(
    RideRated event,
    Emitter<RideState> emit,
  ) async {
    final currentState = state;
    if (currentState is! RideCompleted) return;

    final result = await _rateRide(
      RateRideParams(
        rideId: event.rideId,
        rating: event.rating,
        review: event.comment,
      ),
    );

    result.fold(
      onFailure: (failure) => emit(RideError(failure.userMessage)),
      onSuccess: (_) => emit(RideCompleted(ride: currentState.ride, rated: true)),
    );
  }

  Future<void> _onTipAdded(
    RideTipAdded event,
    Emitter<RideState> emit,
  ) async {
    final result = await _addRideTip(
      AddRideTipParams(
        rideId: event.rideId,
        amount: event.amount,
      ),
    );

    result.fold(
      onFailure: (failure) => emit(RideError(failure.userMessage)),
      onSuccess: (_) {
        // Tip added successfully, state remains the same
      },
    );
  }

  Future<void> _onWatchStarted(
    RideWatchStarted event,
    Emitter<RideState> emit,
  ) async {
    await _rideSubscription?.cancel();
    await _driverLocationSubscription?.cancel();

    // Watch ride status
    final rideResult = await _watchRideStatus(
      WatchRideStatusParams(rideId: event.rideId),
    );

    rideResult.fold(
      onFailure: (failure) => emit(RideError(failure.userMessage)),
      onSuccess: (rideStream) {
        _rideSubscription = rideStream.listen(
          (ride) => add(RideStatusUpdated(ride)),
          onError: (error) => add(RideCleared()),
        );
      },
    );

    // Watch driver location
    final locationResult = await _watchDriverLocation(
      WatchDriverLocationParams(rideId: event.rideId),
    );

    locationResult.fold(
      onFailure: (failure) {
        // Driver location not available yet, that's OK
      },
      onSuccess: (locationStream) {
        _driverLocationSubscription = locationStream.listen(
          (location) => add(DriverLocationUpdated(location)),
        );
      },
    );
  }

  Future<void> _onWatchStopped(
    RideWatchStopped event,
    Emitter<RideState> emit,
  ) async {
    await _rideSubscription?.cancel();
    await _driverLocationSubscription?.cancel();
    _rideSubscription = null;
    _driverLocationSubscription = null;
  }

  void _onStatusUpdated(
    RideStatusUpdated event,
    Emitter<RideState> emit,
  ) {
    final ride = event.ride;
    final currentDriverLocation = switch (state) {
      RideDriverAssigned s => s.driverLocation,
      RideInProgress s => s.driverLocation,
      _ => null,
    };

    switch (ride.status) {
      case RideStatus.pending:
      case RideStatus.searching:
        emit(RideSearchingDriver(ride));
      case RideStatus.driverAssigned:
      case RideStatus.driverArriving:
        emit(RideDriverAssigned(
          ride: ride,
          driverLocation: currentDriverLocation,
        ));
      case RideStatus.driverArrived:
        emit(RideDriverArrived(ride));
      case RideStatus.inProgress:
        emit(RideInProgress(
          ride: ride,
          driverLocation: currentDriverLocation,
        ));
      case RideStatus.completed:
        add(const RideWatchStopped());
        emit(RideCompleted(ride: ride));
      case RideStatus.cancelled:
      case RideStatus.noDrivers:
        add(const RideWatchStopped());
        emit(RideCancelledState(rideId: ride.id));
    }
  }

  void _onDriverLocationUpdated(
    DriverLocationUpdated event,
    Emitter<RideState> emit,
  ) {
    final currentState = state;

    if (currentState is RideDriverAssigned) {
      emit(RideDriverAssigned(
        ride: currentState.ride,
        driverLocation: event.location,
      ));
    } else if (currentState is RideInProgress) {
      emit(RideInProgress(
        ride: currentState.ride,
        driverLocation: event.location,
      ));
    }
  }

  Future<void> _onPlaceSearchRequested(
    PlaceSearchRequested event,
    Emitter<RideState> emit,
  ) async {
    if (event.query.length < 3) return;

    final result = await _searchPlaces(
      SearchPlacesParams(query: event.query),
    );

    result.fold(
      onFailure: (failure) {
        // Silently fail for search - don't show error state
      },
      onSuccess: (places) => emit(PlaceSearchResults(
        query: event.query,
        results: places
            .map((p) => PlaceResultUI(
                  placeId: p.placeId ?? '',
                  name: p.name,
                  address: p.address ?? '',
                  lat: p.location?.latitude ?? 0,
                  lng: p.location?.longitude ?? 0,
                ))
            .toList(),
      )),
    );
  }

  Future<void> _onNearbyDriversRequested(
    NearbyDriversRequested event,
    Emitter<RideState> emit,
  ) async {
    final result = await _getNearbyDrivers(
      GetNearbyDriversParams(location: event.location),
    );

    result.fold(
      onFailure: (failure) {
        // Silently fail - drivers on map is optional
      },
      onSuccess: (drivers) => emit(NearbyDriversLoaded(
        drivers.map((d) => d.currentLocation!).toList(),
      )),
    );
  }

  void _onCleared(
    RideCleared event,
    Emitter<RideState> emit,
  ) {
    emit(const RideInitial());
  }

  @override
  Future<void> close() {
    _rideSubscription?.cancel();
    _driverLocationSubscription?.cancel();
    return super.close();
  }
}
