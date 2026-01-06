/// User Repository Interface
///
/// Contract for user-related data operations.
library;

import '../../core/result/result.dart';
import '../entities/user.dart';
import '../entities/location.dart';
import '../entities/ride.dart';
import '../entities/food_order.dart';
import '../entities/delivery.dart';
import '../entities/payment.dart';

/// Repository for user-related operations
abstract class UserRepository {
  /// Get the current authenticated user
  Future<Result<User>> getCurrentUser();

  /// Update user profile
  Future<Result<User>> updateProfile({
    String? firstName,
    String? lastName,
    String? email,
    String? profileImageUrl,
  });

  /// Update profile image
  Future<Result<String>> updateProfileImage(String imagePath);

  /// Get user preferences
  Future<Result<UserPreferences>> getPreferences();

  /// Update user preferences
  Future<Result<UserPreferences>> updatePreferences(UserPreferences preferences);

  /// Get saved places
  Future<Result<List<SavedPlace>>> getSavedPlaces();

  /// Add a saved place
  Future<Result<SavedPlace>> addSavedPlace(SavedPlace place);

  /// Update a saved place
  Future<Result<SavedPlace>> updateSavedPlace(SavedPlace place);

  /// Delete a saved place
  Future<Result<void>> deleteSavedPlace(String placeId);

  /// Get payment methods
  Future<Result<List<PaymentMethod>>> getPaymentMethods();

  /// Add a payment method
  Future<Result<PaymentMethod>> addPaymentMethod({
    required PaymentMethodType type,
    required Map<String, dynamic> details,
  });

  /// Delete a payment method
  Future<Result<void>> deletePaymentMethod(String methodId);

  /// Set default payment method
  Future<Result<void>> setDefaultPaymentMethod(String methodId);

  /// Get ride history with pagination
  Future<Result<List<Ride>>> getRideHistory({
    int page = 1,
    int perPage = 20,
    DateTime? startDate,
    DateTime? endDate,
  });

  /// Get food order history with pagination
  Future<Result<List<FoodOrder>>> getOrderHistory({
    int page = 1,
    int perPage = 20,
    DateTime? startDate,
    DateTime? endDate,
  });

  /// Get delivery history with pagination
  Future<Result<List<Delivery>>> getDeliveryHistory({
    int page = 1,
    int perPage = 20,
    DateTime? startDate,
    DateTime? endDate,
  });

  /// Get user wallet
  Future<Result<Wallet>> getWallet();

  /// Delete user account
  Future<Result<void>> deleteAccount({String? reason});
}

