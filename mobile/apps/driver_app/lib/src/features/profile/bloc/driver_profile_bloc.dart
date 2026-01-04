import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

part 'driver_profile_event.dart';
part 'driver_profile_state.dart';

/// BLoC for managing driver profile, vehicle, and documents
class DriverProfileBloc extends Bloc<DriverProfileEvent, DriverProfileState> {
  DriverProfileBloc() : super(const DriverProfileInitial()) {
    on<DriverProfileLoaded>(_onProfileLoaded);
    on<DriverProfileUpdated>(_onProfileUpdated);
    on<DriverProfilePhotoUpdated>(_onProfilePhotoUpdated);
    on<DriverVehicleLoaded>(_onVehicleLoaded);
    on<DriverVehicleUpdated>(_onVehicleUpdated);
    on<DriverVehiclePhotoUpdated>(_onVehiclePhotoUpdated);
    on<DriverDocumentsLoaded>(_onDocumentsLoaded);
    on<DriverDocumentUploaded>(_onDocumentUploaded);
    on<DriverDocumentDeleted>(_onDocumentDeleted);
    on<DriverRatingsLoaded>(_onRatingsLoaded);
    on<DriverNotificationSettingsUpdated>(_onNotificationSettingsUpdated);
    on<DriverAppSettingsUpdated>(_onAppSettingsUpdated);
    on<DriverPasswordChanged>(_onPasswordChanged);
    on<DriverAccountDeletionRequested>(_onAccountDeletionRequested);
    on<DriverLoggedOut>(_onLoggedOut);
    on<DriverProfileReset>(_onReset);
  }

  // Ratings pagination cache
  List<DriverRating> _ratingsCache = [];
  int _ratingsPage = 1;

  Future<void> _onProfileLoaded(
    DriverProfileLoaded event,
    Emitter<DriverProfileState> emit,
  ) async {
    emit(const DriverProfileLoading(message: 'Loading profile...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      // Mock profile data
      final profile = DriverProfile(
        id: 'driver-1',
        firstName: 'John',
        lastName: 'Kamau',
        email: 'john.kamau@example.com',
        phoneNumber: '+254712345678',
        rating: 4.85,
        totalTrips: 1250,
        memberSince: DateTime(2023, 3, 15),
        isVerified: true,
        isActive: true,
        photoUrl: 'https://example.com/photos/driver1.jpg',
        referralCode: 'JOHN2023',
        serviceTypes: ['ride', 'food', 'delivery'],
        languages: ['English', 'Swahili'],
      );

      const vehicle = DriverVehicle(
        id: 'vehicle-1',
        make: 'Toyota',
        model: 'Camry',
        year: 2022,
        color: 'white',
        licensePlate: 'KCA 123X',
        vehicleType: 'sedan',
        capacity: 4,
        features: ['AC', 'USB Charging', 'Leather Seats'],
      );

      final documents = [
        DriverDocument(
          id: 'doc-1',
          type: DocumentType.driverLicense,
          status: DocumentStatus.approved,
          uploadedAt: DateTime.now().subtract(const Duration(days: 90)),
          expiryDate: DateTime.now().add(const Duration(days: 275)),
        ),
        DriverDocument(
          id: 'doc-2',
          type: DocumentType.nationalId,
          status: DocumentStatus.approved,
          uploadedAt: DateTime.now().subtract(const Duration(days: 90)),
        ),
        DriverDocument(
          id: 'doc-3',
          type: DocumentType.vehicleRegistration,
          status: DocumentStatus.approved,
          uploadedAt: DateTime.now().subtract(const Duration(days: 60)),
          expiryDate: DateTime.now().add(const Duration(days: 305)),
        ),
        DriverDocument(
          id: 'doc-4',
          type: DocumentType.insurance,
          status: DocumentStatus.expiringSoon,
          uploadedAt: DateTime.now().subtract(const Duration(days: 335)),
          expiryDate: DateTime.now().add(const Duration(days: 20)),
        ),
        DriverDocument(
          id: 'doc-5',
          type: DocumentType.goodConduct,
          status: DocumentStatus.approved,
          uploadedAt: DateTime.now().subtract(const Duration(days: 180)),
          expiryDate: DateTime.now().add(const Duration(days: 185)),
        ),
      ];

      emit(DriverProfileLoaded(
        profile: profile,
        vehicle: vehicle,
        documents: documents,
        notificationSettings: const NotificationSettings(),
        appSettings: const AppSettings(),
      ));
    } catch (e) {
      emit(DriverProfileError(message: 'Failed to load profile: $e'));
    }
  }

  Future<void> _onProfileUpdated(
    DriverProfileUpdated event,
    Emitter<DriverProfileState> emit,
  ) async {
    final currentState = state;

    if (currentState is DriverProfileLoaded) {
      emit(const DriverProfileLoading(message: 'Updating profile...'));

      try {
        await Future.delayed(const Duration(milliseconds: 500));

        final updatedProfile = DriverProfile(
          id: currentState.profile.id,
          firstName: event.firstName ?? currentState.profile.firstName,
          lastName: event.lastName ?? currentState.profile.lastName,
          email: event.email ?? currentState.profile.email,
          phoneNumber: event.phoneNumber ?? currentState.profile.phoneNumber,
          rating: currentState.profile.rating,
          totalTrips: currentState.profile.totalTrips,
          memberSince: currentState.profile.memberSince,
          isVerified: currentState.profile.isVerified,
          isActive: currentState.profile.isActive,
          photoUrl: event.photoUrl ?? currentState.profile.photoUrl,
          referralCode: currentState.profile.referralCode,
          serviceTypes: currentState.profile.serviceTypes,
          languages: currentState.profile.languages,
        );

        emit(currentState.copyWith(profile: updatedProfile));
      } catch (e) {
        emit(DriverProfileError(
          message: 'Failed to update profile: $e',
          previousState: currentState,
        ));
      }
    }
  }

  Future<void> _onProfilePhotoUpdated(
    DriverProfilePhotoUpdated event,
    Emitter<DriverProfileState> emit,
  ) async {
    final currentState = state;

    if (currentState is DriverProfileLoaded) {
      emit(const DriverProfileLoading(message: 'Uploading photo...'));

      try {
        await Future.delayed(const Duration(seconds: 1));

        // Mock upload and get URL
        final newPhotoUrl = 'https://example.com/photos/new-${DateTime.now().millisecondsSinceEpoch}.jpg';

        final updatedProfile = DriverProfile(
          id: currentState.profile.id,
          firstName: currentState.profile.firstName,
          lastName: currentState.profile.lastName,
          email: currentState.profile.email,
          phoneNumber: currentState.profile.phoneNumber,
          rating: currentState.profile.rating,
          totalTrips: currentState.profile.totalTrips,
          memberSince: currentState.profile.memberSince,
          isVerified: currentState.profile.isVerified,
          isActive: currentState.profile.isActive,
          photoUrl: newPhotoUrl,
          referralCode: currentState.profile.referralCode,
          serviceTypes: currentState.profile.serviceTypes,
          languages: currentState.profile.languages,
        );

        emit(currentState.copyWith(profile: updatedProfile));
      } catch (e) {
        emit(DriverProfileError(
          message: 'Failed to upload photo: $e',
          previousState: currentState,
        ));
      }
    }
  }

  Future<void> _onVehicleLoaded(
    DriverVehicleLoaded event,
    Emitter<DriverProfileState> emit,
  ) async {
    emit(const DriverProfileLoading(message: 'Loading vehicle...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      const vehicle = DriverVehicle(
        id: 'vehicle-1',
        make: 'Toyota',
        model: 'Camry',
        year: 2022,
        color: 'white',
        licensePlate: 'KCA 123X',
        vehicleType: 'sedan',
        capacity: 4,
        features: ['AC', 'USB Charging', 'Leather Seats'],
      );

      emit(const DriverVehicleLoaded(vehicle: vehicle));
    } catch (e) {
      emit(DriverProfileError(message: 'Failed to load vehicle: $e'));
    }
  }

  Future<void> _onVehicleUpdated(
    DriverVehicleUpdated event,
    Emitter<DriverProfileState> emit,
  ) async {
    final currentState = state;

    if (currentState is DriverProfileLoaded) {
      emit(const DriverProfileLoading(message: 'Updating vehicle...'));

      try {
        await Future.delayed(const Duration(milliseconds: 500));
        emit(currentState.copyWith(vehicle: event.vehicle));
      } catch (e) {
        emit(DriverProfileError(
          message: 'Failed to update vehicle: $e',
          previousState: currentState,
        ));
      }
    }
  }

  Future<void> _onVehiclePhotoUpdated(
    DriverVehiclePhotoUpdated event,
    Emitter<DriverProfileState> emit,
  ) async {
    final currentState = state;

    if (currentState is DriverProfileLoaded && currentState.vehicle != null) {
      emit(const DriverProfileLoading(message: 'Uploading vehicle photo...'));

      try {
        await Future.delayed(const Duration(seconds: 1));

        final newPhotoUrl = 'https://example.com/vehicles/new-${DateTime.now().millisecondsSinceEpoch}.jpg';

        final updatedVehicle = DriverVehicle(
          id: currentState.vehicle!.id,
          make: currentState.vehicle!.make,
          model: currentState.vehicle!.model,
          year: currentState.vehicle!.year,
          color: currentState.vehicle!.color,
          licensePlate: currentState.vehicle!.licensePlate,
          vehicleType: currentState.vehicle!.vehicleType,
          photoUrl: newPhotoUrl,
          capacity: currentState.vehicle!.capacity,
          features: currentState.vehicle!.features,
        );

        emit(currentState.copyWith(vehicle: updatedVehicle));
      } catch (e) {
        emit(DriverProfileError(
          message: 'Failed to upload vehicle photo: $e',
          previousState: currentState,
        ));
      }
    }
  }

  Future<void> _onDocumentsLoaded(
    DriverDocumentsLoaded event,
    Emitter<DriverProfileState> emit,
  ) async {
    emit(const DriverProfileLoading(message: 'Loading documents...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      final documents = [
        DriverDocument(
          id: 'doc-1',
          type: DocumentType.driverLicense,
          status: DocumentStatus.approved,
          uploadedAt: DateTime.now().subtract(const Duration(days: 90)),
          expiryDate: DateTime.now().add(const Duration(days: 275)),
        ),
        DriverDocument(
          id: 'doc-2',
          type: DocumentType.nationalId,
          status: DocumentStatus.approved,
          uploadedAt: DateTime.now().subtract(const Duration(days: 90)),
        ),
        DriverDocument(
          id: 'doc-3',
          type: DocumentType.vehicleRegistration,
          status: DocumentStatus.approved,
          uploadedAt: DateTime.now().subtract(const Duration(days: 60)),
          expiryDate: DateTime.now().add(const Duration(days: 305)),
        ),
        DriverDocument(
          id: 'doc-4',
          type: DocumentType.insurance,
          status: DocumentStatus.expiringSoon,
          uploadedAt: DateTime.now().subtract(const Duration(days: 335)),
          expiryDate: DateTime.now().add(const Duration(days: 20)),
        ),
      ];

      const requiredDocuments = [
        DocumentType.driverLicense,
        DocumentType.nationalId,
        DocumentType.vehicleRegistration,
        DocumentType.insurance,
        DocumentType.goodConduct,
      ];

      final uploadedTypes = documents.map((d) => d.type).toSet();
      final completedCount =
          requiredDocuments.where((t) => uploadedTypes.contains(t)).length;
      final completionPercent = completedCount / requiredDocuments.length * 100;

      emit(DriverDocumentsLoaded(
        documents: documents,
        requiredDocuments: requiredDocuments,
        completionPercent: completionPercent,
      ));
    } catch (e) {
      emit(DriverProfileError(message: 'Failed to load documents: $e'));
    }
  }

  Future<void> _onDocumentUploaded(
    DriverDocumentUploaded event,
    Emitter<DriverProfileState> emit,
  ) async {
    emit(const DriverProfileLoading(message: 'Uploading document...'));

    try {
      await Future.delayed(const Duration(seconds: 2));

      final newDocument = DriverDocument(
        id: 'doc-new-${DateTime.now().millisecondsSinceEpoch}',
        type: event.documentType,
        status: DocumentStatus.pending,
        uploadedAt: DateTime.now(),
        expiryDate: event.expiryDate,
      );

      emit(DriverDocumentUploaded(
        document: newDocument,
        message: 'Document uploaded successfully. Pending verification.',
      ));

      // Reload documents list
      add(const DriverDocumentsLoaded());
    } catch (e) {
      emit(DriverProfileError(message: 'Failed to upload document: $e'));
    }
  }

  Future<void> _onDocumentDeleted(
    DriverDocumentDeleted event,
    Emitter<DriverProfileState> emit,
  ) async {
    emit(const DriverProfileLoading(message: 'Deleting document...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));
      // Reload documents list
      add(const DriverDocumentsLoaded());
    } catch (e) {
      emit(DriverProfileError(message: 'Failed to delete document: $e'));
    }
  }

  Future<void> _onRatingsLoaded(
    DriverRatingsLoaded event,
    Emitter<DriverProfileState> emit,
  ) async {
    if (event.page == 1) {
      emit(const DriverProfileLoading(message: 'Loading ratings...'));
      _ratingsCache = [];
      _ratingsPage = 1;
    }

    try {
      await Future.delayed(const Duration(milliseconds: 500));

      const summary = RatingSummary(
        averageRating: 4.85,
        totalRatings: 892,
        fiveStarCount: 720,
        fourStarCount: 125,
        threeStarCount: 35,
        twoStarCount: 8,
        oneStarCount: 4,
      );

      // Generate mock ratings
      final newRatings = List.generate(10, (index) {
        final offset = (event.page - 1) * 10 + index;
        return DriverRating(
          id: 'rating-$offset',
          rating: 5 - (offset % 5 == 0 ? 1 : 0),
          tripId: 'trip-$offset',
          tripType: offset % 2 == 0 ? 'ride' : 'food',
          createdAt: DateTime.now().subtract(Duration(days: offset)),
          comment: offset % 3 == 0 ? 'Great driver!' : null,
          riderName: 'Customer ${offset + 1}',
        );
      });

      _ratingsCache.addAll(newRatings);
      _ratingsPage = event.page;

      emit(DriverRatingsLoaded(
        summary: summary,
        ratings: _ratingsCache,
        currentPage: event.page,
        hasMore: event.page < 5,
      ));
    } catch (e) {
      emit(DriverProfileError(message: 'Failed to load ratings: $e'));
    }
  }

  void _onNotificationSettingsUpdated(
    DriverNotificationSettingsUpdated event,
    Emitter<DriverProfileState> emit,
  ) {
    final currentState = state;

    if (currentState is DriverProfileLoaded) {
      final updatedSettings = currentState.notificationSettings.copyWith(
        pushEnabled: event.pushEnabled,
        emailEnabled: event.emailEnabled,
        smsEnabled: event.smsEnabled,
        tripAlerts: event.tripAlerts,
        promoAlerts: event.promoAlerts,
        earningsAlerts: event.earningsAlerts,
      );

      emit(currentState.copyWith(notificationSettings: updatedSettings));

      emit(DriverSettingsUpdated(
        notificationSettings: updatedSettings,
        message: 'Notification settings updated',
      ));
    }
  }

  void _onAppSettingsUpdated(
    DriverAppSettingsUpdated event,
    Emitter<DriverProfileState> emit,
  ) {
    final currentState = state;

    if (currentState is DriverProfileLoaded) {
      final updatedSettings = currentState.appSettings.copyWith(
        language: event.language,
        darkMode: event.darkMode,
        soundEnabled: event.soundEnabled,
        vibrationEnabled: event.vibrationEnabled,
        navigationVoice: event.navigationVoice,
        autoAcceptTrips: event.autoAcceptTrips,
        showEarningsOnHome: event.showEarningsOnHome,
      );

      emit(currentState.copyWith(appSettings: updatedSettings));

      emit(DriverSettingsUpdated(
        appSettings: updatedSettings,
        message: 'Settings updated',
      ));
    }
  }

  Future<void> _onPasswordChanged(
    DriverPasswordChanged event,
    Emitter<DriverProfileState> emit,
  ) async {
    emit(const DriverProfileLoading(message: 'Changing password...'));

    try {
      await Future.delayed(const Duration(seconds: 1));
      emit(const DriverPasswordChanged(
        message: 'Password changed successfully',
      ));
    } catch (e) {
      emit(DriverProfileError(message: 'Failed to change password: $e'));
    }
  }

  Future<void> _onAccountDeletionRequested(
    DriverAccountDeletionRequested event,
    Emitter<DriverProfileState> emit,
  ) async {
    emit(const DriverProfileLoading(message: 'Processing request...'));

    try {
      await Future.delayed(const Duration(seconds: 1));

      emit(DriverAccountDeletionPending(
        scheduledDeletion: DateTime.now().add(const Duration(days: 30)),
        message:
            'Your account deletion request has been received. Your account will be deleted in 30 days.',
      ));
    } catch (e) {
      emit(DriverProfileError(message: 'Failed to request deletion: $e'));
    }
  }

  Future<void> _onLoggedOut(
    DriverLoggedOut event,
    Emitter<DriverProfileState> emit,
  ) async {
    emit(const DriverProfileLoading(message: 'Logging out...'));

    try {
      await Future.delayed(const Duration(milliseconds: 500));
      emit(const DriverLoggedOut());
    } catch (e) {
      emit(DriverProfileError(message: 'Failed to logout: $e'));
    }
  }

  void _onReset(
    DriverProfileReset event,
    Emitter<DriverProfileState> emit,
  ) {
    _ratingsCache = [];
    _ratingsPage = 1;
    emit(const DriverProfileInitial());
  }
}
