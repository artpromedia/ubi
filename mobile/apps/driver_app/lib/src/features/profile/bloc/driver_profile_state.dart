part of 'driver_profile_bloc.dart';

/// Base class for all driver profile states
sealed class DriverProfileState extends Equatable {
  const DriverProfileState();

  @override
  List<Object?> get props => [];
}

/// Initial state
class DriverProfileInitial extends DriverProfileState {
  const DriverProfileInitial();
}

/// Loading state
class DriverProfileLoading extends DriverProfileState {
  const DriverProfileLoading({this.message});

  final String? message;

  @override
  List<Object?> get props => [message];
}

/// Profile loaded
class DriverProfileLoaded extends DriverProfileState {
  const DriverProfileLoaded({
    required this.profile,
    required this.vehicle,
    required this.documents,
    required this.notificationSettings,
    required this.appSettings,
  });

  final DriverProfile profile;
  final DriverVehicle? vehicle;
  final List<DriverDocument> documents;
  final NotificationSettings notificationSettings;
  final AppSettings appSettings;

  bool get hasVehicle => vehicle != null;
  bool get allDocumentsApproved =>
      documents.every((d) => d.status == DocumentStatus.approved);
  bool get hasExpiredDocuments =>
      documents.any((d) => d.status == DocumentStatus.expired || d.isExpired);
  bool get hasPendingDocuments =>
      documents.any((d) => d.status == DocumentStatus.pending);

  List<DriverDocument> get pendingDocuments =>
      documents.where((d) => d.status == DocumentStatus.pending).toList();
  List<DriverDocument> get expiredDocuments =>
      documents.where((d) => d.status == DocumentStatus.expired || d.isExpired).toList();
  List<DriverDocument> get expiringSoonDocuments =>
      documents.where((d) => d.isExpiringSoon && !d.isExpired).toList();

  DriverProfileLoaded copyWith({
    DriverProfile? profile,
    DriverVehicle? vehicle,
    List<DriverDocument>? documents,
    NotificationSettings? notificationSettings,
    AppSettings? appSettings,
  }) {
    return DriverProfileLoaded(
      profile: profile ?? this.profile,
      vehicle: vehicle ?? this.vehicle,
      documents: documents ?? this.documents,
      notificationSettings: notificationSettings ?? this.notificationSettings,
      appSettings: appSettings ?? this.appSettings,
    );
  }

  @override
  List<Object?> get props => [
        profile,
        vehicle,
        documents,
        notificationSettings,
        appSettings,
      ];
}

/// Vehicle info loaded separately
class DriverVehicleLoadedState extends DriverProfileState {
  const DriverVehicleLoadedState({required this.vehicle});

  final DriverVehicle vehicle;

  @override
  List<Object?> get props => [vehicle];
}

/// Documents loaded
class DriverDocumentsLoaded extends DriverProfileState {
  const DriverDocumentsLoaded({
    required this.documents,
    required this.requiredDocuments,
    required this.completionPercent,
  });

  final List<DriverDocument> documents;
  final List<DocumentType> requiredDocuments;
  final double completionPercent;

  List<DocumentType> get missingDocuments {
    final uploadedTypes = documents.map((d) => d.type).toSet();
    return requiredDocuments.where((t) => !uploadedTypes.contains(t)).toList();
  }

  @override
  List<Object?> get props => [documents, requiredDocuments, completionPercent];
}

/// Document uploaded successfully
class DriverDocumentUploaded extends DriverProfileState {
  const DriverDocumentUploaded({
    required this.document,
    required this.message,
  });

  final DriverDocument document;
  final String message;

  @override
  List<Object?> get props => [document, message];
}

/// Ratings loaded
class DriverRatingsLoadedState extends DriverProfileState {
  const DriverRatingsLoadedState({
    required this.summary,
    required this.ratings,
    required this.currentPage,
    required this.hasMore,
  });

  final RatingSummary summary;
  final List<DriverRating> ratings;
  final int currentPage;
  final bool hasMore;

  @override
  List<Object?> get props => [summary, ratings, currentPage, hasMore];
}

/// Settings updated
class DriverSettingsUpdated extends DriverProfileState {
  const DriverSettingsUpdated({
    this.notificationSettings,
    this.appSettings,
    required this.message,
  });

  final NotificationSettings? notificationSettings;
  final AppSettings? appSettings;
  final String message;

  @override
  List<Object?> get props => [notificationSettings, appSettings, message];
}

/// Password changed
class DriverPasswordChangedState extends DriverProfileState {
  const DriverPasswordChangedState({required this.message});

  final String message;

  @override
  List<Object?> get props => [message];
}

/// Logged out
class DriverLoggedOutState extends DriverProfileState {
  const DriverLoggedOutState();
}

/// Account deletion requested
class DriverAccountDeletionPending extends DriverProfileState {
  const DriverAccountDeletionPending({
    required this.scheduledDeletion,
    required this.message,
  });

  final DateTime scheduledDeletion;
  final String message;

  @override
  List<Object?> get props => [scheduledDeletion, message];
}

/// Error state
class DriverProfileError extends DriverProfileState {
  const DriverProfileError({
    required this.message,
    this.previousState,
  });

  final String message;
  final DriverProfileState? previousState;

  @override
  List<Object?> get props => [message, previousState];
}
