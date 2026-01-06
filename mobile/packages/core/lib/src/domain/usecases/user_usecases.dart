/// User Use Cases
///
/// Business logic for user profile operations.
library;

import '../../core/result/result.dart';
import '../entities/user.dart';
import '../entities/location.dart';
import '../entities/ride.dart';
import '../entities/food_order.dart';
import '../entities/delivery.dart';
import '../entities/payment.dart';
import '../repositories/user_repository.dart';
import 'use_case.dart';

/// Get current user
class GetCurrentUserUseCase implements UseCase<User, NoParams> {
  const GetCurrentUserUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<User>> call(NoParams params) {
    return repository.getCurrentUser();
  }
}

/// Update user profile
class UpdateProfileUseCase implements UseCase<User, UpdateProfileParams> {
  const UpdateProfileUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<User>> call(UpdateProfileParams params) {
    return repository.updateProfile(
      firstName: params.firstName,
      lastName: params.lastName,
      email: params.email,
      profileImageUrl: params.profileImageUrl,
    );
  }
}

class UpdateProfileParams {
  const UpdateProfileParams({
    this.firstName,
    this.lastName,
    this.email,
    this.profileImageUrl,
  });

  final String? firstName;
  final String? lastName;
  final String? email;
  final String? profileImageUrl;
}

/// Update profile image
class UpdateProfileImageUseCase implements UseCase<String, String> {
  const UpdateProfileImageUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<String>> call(String imagePath) {
    return repository.updateProfileImage(imagePath);
  }
}

/// Get user preferences
class GetUserPreferencesUseCase implements UseCase<UserPreferences, NoParams> {
  const GetUserPreferencesUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<UserPreferences>> call(NoParams params) {
    return repository.getPreferences();
  }
}

/// Update user preferences
class UpdateUserPreferencesUseCase implements UseCase<UserPreferences, UserPreferences> {
  const UpdateUserPreferencesUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<UserPreferences>> call(UserPreferences preferences) {
    return repository.updatePreferences(preferences);
  }
}

/// Get saved places
class GetSavedPlacesUseCase implements UseCase<List<SavedPlace>, NoParams> {
  const GetSavedPlacesUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<List<SavedPlace>>> call(NoParams params) {
    return repository.getSavedPlaces();
  }
}

/// Add a saved place
class AddSavedPlaceUseCase implements UseCase<SavedPlace, SavedPlace> {
  const AddSavedPlaceUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<SavedPlace>> call(SavedPlace place) {
    return repository.addSavedPlace(place);
  }
}

/// Update a saved place
class UpdateSavedPlaceUseCase implements UseCase<SavedPlace, SavedPlace> {
  const UpdateSavedPlaceUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<SavedPlace>> call(SavedPlace place) {
    return repository.updateSavedPlace(place);
  }
}

/// Delete a saved place
class DeleteSavedPlaceUseCase implements UseCase<void, String> {
  const DeleteSavedPlaceUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<void>> call(String placeId) {
    return repository.deleteSavedPlace(placeId);
  }
}

/// Get payment methods
class GetPaymentMethodsUseCase implements UseCase<List<PaymentMethod>, NoParams> {
  const GetPaymentMethodsUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<List<PaymentMethod>>> call(NoParams params) {
    return repository.getPaymentMethods();
  }
}

/// Add a payment method
class AddPaymentMethodUseCase implements UseCase<PaymentMethod, AddPaymentMethodParams> {
  const AddPaymentMethodUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<PaymentMethod>> call(AddPaymentMethodParams params) {
    return repository.addPaymentMethod(
      type: params.type,
      details: params.details,
    );
  }
}

class AddPaymentMethodParams {
  const AddPaymentMethodParams({
    required this.type,
    required this.details,
  });

  final PaymentMethodType type;
  final Map<String, dynamic> details;
}

/// Delete a payment method
class DeletePaymentMethodUseCase implements UseCase<void, String> {
  const DeletePaymentMethodUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<void>> call(String methodId) {
    return repository.deletePaymentMethod(methodId);
  }
}

/// Set default payment method
class SetDefaultPaymentMethodUseCase implements UseCase<void, String> {
  const SetDefaultPaymentMethodUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<void>> call(String methodId) {
    return repository.setDefaultPaymentMethod(methodId);
  }
}

/// Get ride history
class GetRideHistoryUseCase implements UseCase<List<Ride>, GetHistoryParams> {
  const GetRideHistoryUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<List<Ride>>> call(GetHistoryParams params) {
    return repository.getRideHistory(
      page: params.page,
      perPage: params.perPage,
      startDate: params.startDate,
      endDate: params.endDate,
    );
  }
}

/// Get food order history
class GetOrderHistoryUseCase implements UseCase<List<FoodOrder>, GetHistoryParams> {
  const GetOrderHistoryUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<List<FoodOrder>>> call(GetHistoryParams params) {
    return repository.getOrderHistory(
      page: params.page,
      perPage: params.perPage,
      startDate: params.startDate,
      endDate: params.endDate,
    );
  }
}

class GetHistoryParams {
  const GetHistoryParams({
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

/// Get user wallet
class GetUserWalletUseCase implements UseCase<Wallet, NoParams> {
  const GetUserWalletUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<Wallet>> call(NoParams params) {
    return repository.getWallet();
  }
}

/// Delete user account
class DeleteAccountUseCase implements UseCase<void, String?> {
  const DeleteAccountUseCase(this.repository);

  final UserRepository repository;

  @override
  Future<Result<void>> call(String? reason) {
    return repository.deleteAccount(reason: reason);
  }
}

