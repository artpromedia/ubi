/// Delivery Use Cases
///
/// Business logic for package delivery operations.
library;

import '../../../core.dart';

/// Get delivery estimate
class GetDeliveryEstimateUseCase implements UseCase<DeliveryEstimate, GetDeliveryEstimateParams> {
  const GetDeliveryEstimateUseCase(this.repository);

  final DeliveryRepository repository;

  @override
  Future<Result<DeliveryEstimate>> call(GetDeliveryEstimateParams params) {
    return repository.getEstimate(
      pickupLocation: params.pickupLocation,
      dropoffLocation: params.dropoffLocation,
      packageSize: params.packageSize,
      pickupAddress: params.pickupAddress,
      dropoffAddress: params.dropoffAddress,
    );
  }
}

class GetDeliveryEstimateParams {
  const GetDeliveryEstimateParams({
    required this.pickupLocation,
    required this.dropoffLocation,
    required this.packageSize,
    this.pickupAddress,
    this.dropoffAddress,
  });

  final GeoLocation pickupLocation;
  final GeoLocation dropoffLocation;
  final PackageSize packageSize;
  final String? pickupAddress;
  final String? dropoffAddress;
}

/// Request a delivery
class RequestDeliveryUseCase implements UseCase<Delivery, DeliveryRequest> {
  const RequestDeliveryUseCase(this.repository);

  final DeliveryRepository repository;

  @override
  Future<Result<Delivery>> call(DeliveryRequest request) {
    return repository.requestDelivery(request: request);
  }
}

/// Get delivery details
class GetDeliveryDetailsUseCase implements UseCase<Delivery, String> {
  const GetDeliveryDetailsUseCase(this.repository);

  final DeliveryRepository repository;

  @override
  Future<Result<Delivery>> call(String deliveryId) {
    return repository.getDeliveryById(deliveryId);
  }
}

/// Get active deliveries
class GetActiveDeliveriesUseCase implements UseCase<List<Delivery>, NoParams> {
  const GetActiveDeliveriesUseCase(this.repository);

  final DeliveryRepository repository;

  @override
  Future<Result<List<Delivery>>> call(NoParams params) {
    return repository.getActiveDeliveries();
  }
}

/// Get delivery history
class GetDeliveryHistoryUseCase implements UseCase<List<Delivery>, GetDeliveryHistoryParams> {
  const GetDeliveryHistoryUseCase(this.repository);

  final DeliveryRepository repository;

  @override
  Future<Result<List<Delivery>>> call(GetDeliveryHistoryParams params) {
    return repository.getDeliveryHistory(
      page: params.page,
      perPage: params.perPage,
      startDate: params.startDate,
      endDate: params.endDate,
    );
  }
}

class GetDeliveryHistoryParams {
  const GetDeliveryHistoryParams({
    this.page = 1,
    this.perPage = 20,
    this.startDate,
    this.endDate,
  });

  final int page;
  final int perPage;
  final DateTime? startDate;
  final DateTime? endDate;
}

/// Cancel a delivery
class CancelDeliveryUseCase implements UseCase<Delivery, CancelDeliveryParams> {
  const CancelDeliveryUseCase(this.repository);

  final DeliveryRepository repository;

  @override
  Future<Result<Delivery>> call(CancelDeliveryParams params) {
    return repository.cancelDelivery(
      params.deliveryId,
      reason: params.reason,
    );
  }
}

class CancelDeliveryParams {
  const CancelDeliveryParams({
    required this.deliveryId,
    this.reason,
  });

  final String deliveryId;
  final String? reason;
}

/// Rate a delivery
class RateDeliveryUseCase implements UseCase<void, RateDeliveryParams> {
  const RateDeliveryUseCase(this.repository);

  final DeliveryRepository repository;

  @override
  Future<Result<void>> call(RateDeliveryParams params) {
    return repository.rateDelivery(
      deliveryId: params.deliveryId,
      rating: params.rating,
      review: params.review,
    );
  }
}

class RateDeliveryParams {
  const RateDeliveryParams({
    required this.deliveryId,
    required this.rating,
    this.review,
  });

  final String deliveryId;
  final int rating;
  final String? review;
}

/// Add tip to a delivery
class AddDeliveryTipUseCase implements UseCase<Delivery, AddDeliveryTipParams> {
  const AddDeliveryTipUseCase(this.repository);

  final DeliveryRepository repository;

  @override
  Future<Result<Delivery>> call(AddDeliveryTipParams params) {
    return repository.addTip(
      deliveryId: params.deliveryId,
      amount: params.amount,
    );
  }
}

class AddDeliveryTipParams {
  const AddDeliveryTipParams({
    required this.deliveryId,
    required this.amount,
  });

  final String deliveryId;
  final double amount;
}

/// Watch delivery updates in real-time
class WatchDeliveryUseCase implements StreamUseCase<Delivery, String> {
  const WatchDeliveryUseCase(this.repository);

  final DeliveryRepository repository;

  @override
  Stream<Delivery> call(String deliveryId) {
    return repository.watchDelivery(deliveryId);
  }
}

/// Watch courier location updates
class WatchCourierLocationUseCase implements StreamUseCase<GeoLocation, String> {
  const WatchCourierLocationUseCase(this.repository);

  final DeliveryRepository repository;

  @override
  Stream<GeoLocation> call(String deliveryId) {
    return repository.watchCourierLocation(deliveryId);
  }
}
