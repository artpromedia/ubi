/// Delivery Repository Interface
///
/// Contract for package delivery data operations.
library;

import '../../../core.dart';

/// Repository for package delivery operations
abstract class DeliveryRepository {
  /// Get delivery estimate
  Future<Result<DeliveryEstimate>> getEstimate({
    required GeoLocation pickupLocation,
    required GeoLocation dropoffLocation,
    required PackageSize packageSize,
    String? pickupAddress,
    String? dropoffAddress,
  });

  /// Request a delivery
  Future<Result<Delivery>> requestDelivery({
    required DeliveryRequest request,
  });

  /// Get delivery by ID
  Future<Result<Delivery>> getDeliveryById(String deliveryId);

  /// Get active deliveries
  Future<Result<List<Delivery>>> getActiveDeliveries();

  /// Get delivery history
  Future<Result<List<Delivery>>> getDeliveryHistory({
    int page = 1,
    int perPage = 20,
    DateTime? startDate,
    DateTime? endDate,
  });

  /// Cancel a delivery
  Future<Result<Delivery>> cancelDelivery(String deliveryId, {String? reason});

  /// Rate a delivery
  Future<Result<void>> rateDelivery({
    required String deliveryId,
    required int rating,
    String? review,
  });

  /// Add tip to a delivery
  Future<Result<Delivery>> addTip({
    required String deliveryId,
    required double amount,
  });

  /// Stream delivery updates in real-time
  Stream<Delivery> watchDelivery(String deliveryId);

  /// Stream courier location updates
  Stream<GeoLocation> watchCourierLocation(String deliveryId);
}
