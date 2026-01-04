import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';

part 'profile_event.dart';
part 'profile_state.dart';

/// BLoC for managing user profile
class ProfileBloc extends Bloc<ProfileEvent, ProfileState> {
  ProfileBloc() : super(const ProfileInitial()) {
    on<ProfileRequested>(_onProfileRequested);
    on<ProfileUpdated>(_onProfileUpdated);
    on<ProfilePhotoUpdated>(_onProfilePhotoUpdated);
    on<ProfilePhotoDeleted>(_onProfilePhotoDeleted);
    on<SavedPlacesRequested>(_onSavedPlacesRequested);
    on<SavedPlaceAdded>(_onSavedPlaceAdded);
    on<SavedPlaceUpdated>(_onSavedPlaceUpdated);
    on<SavedPlaceDeleted>(_onSavedPlaceDeleted);
    on<SavedPlaceSetDefault>(_onSavedPlaceSetDefault);
    on<PaymentMethodsRequested>(_onPaymentMethodsRequested);
    on<PaymentMethodAdded>(_onPaymentMethodAdded);
    on<PaymentMethodDeleted>(_onPaymentMethodDeleted);
    on<PaymentMethodSetDefault>(_onPaymentMethodSetDefault);
    on<UserStatsRequested>(_onUserStatsRequested);
    on<TransactionHistoryRequested>(_onTransactionHistoryRequested);
    on<SettingsRequested>(_onSettingsRequested);
    on<SettingsUpdated>(_onSettingsUpdated);
    on<LocalDataCleared>(_onLocalDataCleared);
    on<DataExportRequested>(_onDataExportRequested);
    on<AccountDeletionRequested>(_onAccountDeletionRequested);
    on<NotificationsRequested>(_onNotificationsRequested);
    on<NotificationMarkedAsRead>(_onNotificationMarkedAsRead);
    on<AllNotificationsMarkedAsRead>(_onAllNotificationsMarkedAsRead);
    on<NotificationDeleted>(_onNotificationDeleted);
    on<PromotionsRequested>(_onPromotionsRequested);
    on<PromoCodeSubmitted>(_onPromoCodeSubmitted);
    on<PhoneVerificationRequested>(_onPhoneVerificationRequested);
    on<EmailVerificationRequested>(_onEmailVerificationRequested);
    on<LogoutRequested>(_onLogoutRequested);
  }

  static const _uuid = Uuid();

  // Sample data
  UserProfile _currentUser = const UserProfile(
    id: 'user-123',
    phoneNumber: '+254 712 345 678',
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@example.com',
    isEmailVerified: true,
    isPhoneVerified: true,
  );

  UserSettings _currentSettings = const UserSettings();

  final List<SavedPlace> _savedPlaces = [
    SavedPlace(
      id: '1',
      name: 'Home',
      address: '123 Kilimani Road, Nairobi',
      latitude: -1.2864,
      longitude: 36.8172,
      type: 'home',
      isDefault: true,
    ),
    SavedPlace(
      id: '2',
      name: 'Work',
      address: 'Westlands Business Park, Nairobi',
      latitude: -1.2673,
      longitude: 36.8114,
      type: 'work',
    ),
  ];

  final List<PaymentMethod> _paymentMethods = [
    PaymentMethod(
      id: '1',
      type: PaymentMethodType.mpesa,
      displayName: 'M-Pesa',
      lastFour: '5678',
      isDefault: true,
    ),
    PaymentMethod(
      id: '2',
      type: PaymentMethodType.card,
      displayName: 'Visa •••• 4242',
      lastFour: '4242',
      isDefault: false,
    ),
  ];

  Future<void> _onProfileRequested(
    ProfileRequested event,
    Emitter<ProfileState> emit,
  ) async {
    emit(const ProfileLoading());

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final stats = UserStats(
        totalRides: 23,
        totalFoodOrders: 15,
        totalDeliveries: 8,
        totalSpent: 45600,
        rating: 4.9,
        memberSince: DateTime(2023, 1, 15),
      );

      emit(ProfileLoaded(user: _currentUser, stats: stats));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onProfileUpdated(
    ProfileUpdated event,
    Emitter<ProfileState> emit,
  ) async {
    emit(const ProfileUpdating());

    try {
      await Future.delayed(const Duration(milliseconds: 800));

      _currentUser = _currentUser.copyWith(
        firstName: event.firstName,
        lastName: event.lastName,
        email: event.email,
        photoUrl: event.photoUrl,
        isEmailVerified:
            event.email != _currentUser.email ? false : _currentUser.isEmailVerified,
      );

      emit(ProfileUpdateSuccess(
        user: _currentUser,
        message: 'Profile updated successfully',
      ));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onProfilePhotoUpdated(
    ProfilePhotoUpdated event,
    Emitter<ProfileState> emit,
  ) async {
    emit(const ProfilePhotoUploading(progress: 0));

    try {
      // Simulate upload progress
      for (var i = 1; i <= 10; i++) {
        await Future.delayed(const Duration(milliseconds: 100));
        emit(ProfilePhotoUploading(progress: i / 10));
      }

      _currentUser = _currentUser.copyWith(
        photoUrl: event.imagePath,
      );

      emit(ProfileUpdateSuccess(
        user: _currentUser,
        message: 'Photo updated',
      ));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onProfilePhotoDeleted(
    ProfilePhotoDeleted event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      _currentUser = UserProfile(
        id: _currentUser.id,
        phoneNumber: _currentUser.phoneNumber,
        firstName: _currentUser.firstName,
        lastName: _currentUser.lastName,
        email: _currentUser.email,
        photoUrl: null,
        isEmailVerified: _currentUser.isEmailVerified,
        isPhoneVerified: _currentUser.isPhoneVerified,
      );

      emit(ProfileUpdateSuccess(
        user: _currentUser,
        message: 'Photo removed',
      ));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onSavedPlacesRequested(
    SavedPlacesRequested event,
    Emitter<ProfileState> emit,
  ) async {
    emit(const SavedPlacesLoading());

    try {
      await Future.delayed(const Duration(milliseconds: 300));
      emit(SavedPlacesLoaded(places: List.from(_savedPlaces)));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onSavedPlaceAdded(
    SavedPlaceAdded event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      final place = SavedPlace(
        id: _uuid.v4(),
        name: event.name,
        address: event.address,
        latitude: event.latitude,
        longitude: event.longitude,
        type: event.type,
      );

      _savedPlaces.add(place);

      emit(SavedPlaceAddedState(place: place));
      emit(SavedPlacesLoaded(places: List.from(_savedPlaces)));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onSavedPlaceUpdated(
    SavedPlaceUpdated event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      final index = _savedPlaces.indexWhere((p) => p.id == event.placeId);
      if (index != -1) {
        _savedPlaces[index] = _savedPlaces[index].copyWith(
          name: event.name,
          address: event.address,
          latitude: event.latitude,
          longitude: event.longitude,
        );
      }

      emit(SavedPlacesLoaded(places: List.from(_savedPlaces)));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onSavedPlaceDeleted(
    SavedPlaceDeleted event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      _savedPlaces.removeWhere((p) => p.id == event.placeId);

      emit(SavedPlaceDeletedState(placeId: event.placeId));
      emit(SavedPlacesLoaded(places: List.from(_savedPlaces)));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onSavedPlaceSetDefault(
    SavedPlaceSetDefault event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      for (var i = 0; i < _savedPlaces.length; i++) {
        _savedPlaces[i] = _savedPlaces[i].copyWith(
          isDefault: _savedPlaces[i].id == event.placeId,
        );
      }

      emit(SavedPlacesLoaded(places: List.from(_savedPlaces)));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onPaymentMethodsRequested(
    PaymentMethodsRequested event,
    Emitter<ProfileState> emit,
  ) async {
    emit(const PaymentMethodsLoading());

    try {
      await Future.delayed(const Duration(milliseconds: 300));
      emit(PaymentMethodsLoaded(paymentMethods: List.from(_paymentMethods)));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onPaymentMethodAdded(
    PaymentMethodAdded event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));

      String displayName;
      String? lastFour;

      switch (event.type) {
        case PaymentMethodType.mpesa:
          final phone = event.details['phoneNumber'] as String?;
          lastFour = phone?.substring(phone.length - 4);
          displayName = 'M-Pesa •••• $lastFour';
          break;
        case PaymentMethodType.mtnMomo:
          final phone = event.details['phoneNumber'] as String?;
          lastFour = phone?.substring(phone.length - 4);
          displayName = 'MTN •••• $lastFour';
          break;
        case PaymentMethodType.card:
          lastFour = event.details['cardNumber']?.toString().substring(
                    (event.details['cardNumber'] as String).length - 4,
                  ) ??
              '0000';
          displayName = 'Card •••• $lastFour';
          break;
        case PaymentMethodType.cash:
          displayName = 'Cash';
          break;
        default:
          displayName = event.type.displayName;
      }

      final paymentMethod = PaymentMethod(
        id: _uuid.v4(),
        type: event.type,
        displayName: displayName,
        details: event.details,
        lastFour: lastFour,
        isDefault: event.isDefault || _paymentMethods.isEmpty,
      );

      if (event.isDefault) {
        // Remove default from others
        for (var i = 0; i < _paymentMethods.length; i++) {
          _paymentMethods[i] = PaymentMethod(
            id: _paymentMethods[i].id,
            type: _paymentMethods[i].type,
            displayName: _paymentMethods[i].displayName,
            details: _paymentMethods[i].details,
            lastFour: _paymentMethods[i].lastFour,
            isDefault: false,
          );
        }
      }

      _paymentMethods.add(paymentMethod);

      emit(PaymentMethodAddedState(paymentMethod: paymentMethod));
      emit(PaymentMethodsLoaded(paymentMethods: List.from(_paymentMethods)));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onPaymentMethodDeleted(
    PaymentMethodDeleted event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      _paymentMethods.removeWhere((m) => m.id == event.paymentMethodId);

      emit(PaymentMethodDeletedState(paymentMethodId: event.paymentMethodId));
      emit(PaymentMethodsLoaded(paymentMethods: List.from(_paymentMethods)));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onPaymentMethodSetDefault(
    PaymentMethodSetDefault event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      for (var i = 0; i < _paymentMethods.length; i++) {
        _paymentMethods[i] = PaymentMethod(
          id: _paymentMethods[i].id,
          type: _paymentMethods[i].type,
          displayName: _paymentMethods[i].displayName,
          details: _paymentMethods[i].details,
          lastFour: _paymentMethods[i].lastFour,
          isDefault: _paymentMethods[i].id == event.paymentMethodId,
        );
      }

      emit(PaymentMethodsLoaded(paymentMethods: List.from(_paymentMethods)));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onUserStatsRequested(
    UserStatsRequested event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      final stats = UserStats(
        totalRides: 23,
        totalFoodOrders: 15,
        totalDeliveries: 8,
        totalSpent: 45600,
        rating: 4.9,
        memberSince: DateTime(2023, 1, 15),
      );

      emit(UserStatsLoaded(stats: stats));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onTransactionHistoryRequested(
    TransactionHistoryRequested event,
    Emitter<ProfileState> emit,
  ) async {
    emit(const TransactionHistoryLoading());

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final transactions = List.generate(
        10,
        (i) => Transaction(
          id: _uuid.v4(),
          type: TransactionType.values[i % TransactionType.values.length],
          amount: 500 + (i * 150),
          currency: 'KES',
          description: _getTransactionDescription(
            TransactionType.values[i % TransactionType.values.length],
          ),
          createdAt: DateTime.now().subtract(Duration(days: i)),
          status: 'completed',
        ),
      );

      emit(TransactionHistoryLoaded(
        transactions: transactions,
        hasMore: event.page < 3,
        currentPage: event.page,
      ));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  String _getTransactionDescription(TransactionType type) {
    switch (type) {
      case TransactionType.ride:
        return 'Ride to Westlands';
      case TransactionType.food:
        return 'Order from Java House';
      case TransactionType.delivery:
        return 'Package delivery';
      case TransactionType.topUp:
        return 'Wallet top-up';
      case TransactionType.refund:
        return 'Refund - cancelled order';
      case TransactionType.promotion:
        return 'Promotional credit';
    }
  }

  Future<void> _onSettingsRequested(
    SettingsRequested event,
    Emitter<ProfileState> emit,
  ) async {
    emit(const SettingsLoading());

    try {
      await Future.delayed(const Duration(milliseconds: 300));
      emit(SettingsLoaded(settings: _currentSettings));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onSettingsUpdated(
    SettingsUpdated event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));

      _currentSettings = _currentSettings.copyWith(
        language: event.language,
        currency: event.currency,
        pushNotifications: event.pushNotifications,
        emailNotifications: event.emailNotifications,
        smsNotifications: event.smsNotifications,
        darkMode: event.darkMode,
        biometricAuth: event.biometricAuth,
      );

      emit(SettingsUpdatedState(settings: _currentSettings));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onLocalDataCleared(
    LocalDataCleared event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));
      emit(const LocalDataClearedState());
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onDataExportRequested(
    DataExportRequested event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(seconds: 2));
      emit(const DataExportRequestedState(
        message:
            'Your data export is being prepared. You will receive an email when it is ready.',
      ));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onAccountDeletionRequested(
    AccountDeletionRequested event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(seconds: 1));
      emit(const AccountDeletionRequestedState(
        message:
            'Your account deletion request has been submitted. Your account will be deleted within 30 days.',
      ));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onNotificationsRequested(
    NotificationsRequested event,
    Emitter<ProfileState> emit,
  ) async {
    emit(const NotificationsLoading());

    try {
      await Future.delayed(const Duration(milliseconds: 300));

      final notifications = [
        AppNotification(
          id: '1',
          title: 'Your ride is arriving!',
          body: 'Your driver will arrive in 2 minutes',
          createdAt: DateTime.now().subtract(const Duration(minutes: 5)),
          type: 'ride',
          isRead: false,
        ),
        AppNotification(
          id: '2',
          title: 'Order delivered',
          body: 'Your order from Java House has been delivered',
          createdAt: DateTime.now().subtract(const Duration(hours: 2)),
          type: 'food',
          isRead: true,
        ),
        AppNotification(
          id: '3',
          title: 'Special offer!',
          body: 'Get 20% off your next ride. Use code: SAVE20',
          createdAt: DateTime.now().subtract(const Duration(days: 1)),
          type: 'promotion',
          isRead: false,
        ),
      ];

      emit(NotificationsLoaded(notifications: notifications));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onNotificationMarkedAsRead(
    NotificationMarkedAsRead event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 100));
      // Update notification status
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onAllNotificationsMarkedAsRead(
    AllNotificationsMarkedAsRead event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 100));
      // Mark all as read
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onNotificationDeleted(
    NotificationDeleted event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 100));
      // Delete notification
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onPromotionsRequested(
    PromotionsRequested event,
    Emitter<ProfileState> emit,
  ) async {
    emit(const PromotionsLoading());

    try {
      await Future.delayed(const Duration(milliseconds: 300));

      final promotions = [
        Promotion(
          id: '1',
          code: 'SAVE20',
          title: '20% Off Your Next Ride',
          description: 'Get 20% discount on your next ride. Maximum KES 200 off.',
          discountType: 'percentage',
          discountValue: 20,
          maximumDiscount: 200,
          validUntil: DateTime.now().add(const Duration(days: 7)),
          applicableServices: ['ride'],
        ),
        Promotion(
          id: '2',
          code: 'FOODFREE',
          title: 'Free Delivery',
          description: 'Get free delivery on your next food order above KES 500.',
          discountType: 'fixed',
          discountValue: 100,
          minimumAmount: 500,
          validUntil: DateTime.now().add(const Duration(days: 14)),
          applicableServices: ['food'],
        ),
      ];

      emit(PromotionsLoaded(promotions: promotions));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onPromoCodeSubmitted(
    PromoCodeSubmitted event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));

      if (event.code.toUpperCase() == 'NEWUSER') {
        final promotion = Promotion(
          id: _uuid.v4(),
          code: 'NEWUSER',
          title: 'Welcome Bonus',
          description: 'KES 100 off your first ride!',
          discountType: 'fixed',
          discountValue: 100,
          validUntil: DateTime.now().add(const Duration(days: 30)),
        );

        emit(PromoCodeSubmittedState(promotion: promotion));
      } else {
        emit(const PromoCodeInvalidState(
          message: 'Invalid or expired promo code',
        ));
      }
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onPhoneVerificationRequested(
    PhoneVerificationRequested event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));
      emit(VerificationSentState(
        verificationType: 'phone',
        destination: event.phoneNumber,
      ));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onEmailVerificationRequested(
    EmailVerificationRequested event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 500));
      emit(VerificationSentState(
        verificationType: 'email',
        destination: event.email,
      ));
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  Future<void> _onLogoutRequested(
    LogoutRequested event,
    Emitter<ProfileState> emit,
  ) async {
    try {
      await Future.delayed(const Duration(milliseconds: 300));
      emit(const LoggedOutState());
    } catch (e) {
      emit(ProfileError(message: e.toString()));
    }
  }

  /// Get current user
  UserProfile get currentUser => _currentUser;

  /// Get current settings
  UserSettings get settings => _currentSettings;
}
