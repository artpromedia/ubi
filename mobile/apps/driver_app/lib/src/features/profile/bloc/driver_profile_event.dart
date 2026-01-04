part of 'driver_profile_bloc.dart';

/// Base class for all driver profile events
sealed class DriverProfileEvent extends Equatable {
  const DriverProfileEvent();

  @override
  List<Object?> get props => [];
}

/// Load driver profile
class DriverProfileLoaded extends DriverProfileEvent {
  const DriverProfileLoaded();
}

/// Update basic profile info
class DriverProfileUpdated extends DriverProfileEvent {
  const DriverProfileUpdated({
    this.firstName,
    this.lastName,
    this.email,
    this.phoneNumber,
    this.photoUrl,
  });

  final String? firstName;
  final String? lastName;
  final String? email;
  final String? phoneNumber;
  final String? photoUrl;

  @override
  List<Object?> get props => [firstName, lastName, email, phoneNumber, photoUrl];
}

/// Update profile photo
class DriverProfilePhotoUpdated extends DriverProfileEvent {
  const DriverProfilePhotoUpdated({required this.photoPath});

  final String photoPath;

  @override
  List<Object?> get props => [photoPath];
}

/// Load vehicle info
class DriverVehicleLoaded extends DriverProfileEvent {
  const DriverVehicleLoaded();
}

/// Update vehicle info
class DriverVehicleUpdated extends DriverProfileEvent {
  const DriverVehicleUpdated({required this.vehicle});

  final DriverVehicle vehicle;

  @override
  List<Object?> get props => [vehicle];
}

/// Update vehicle photo
class DriverVehiclePhotoUpdated extends DriverProfileEvent {
  const DriverVehiclePhotoUpdated({required this.photoPath});

  final String photoPath;

  @override
  List<Object?> get props => [photoPath];
}

/// Load documents
class DriverDocumentsLoaded extends DriverProfileEvent {
  const DriverDocumentsLoaded();
}

/// Upload document
class DriverDocumentUploaded extends DriverProfileEvent {
  const DriverDocumentUploaded({
    required this.documentType,
    required this.filePath,
    this.expiryDate,
  });

  final DocumentType documentType;
  final String filePath;
  final DateTime? expiryDate;

  @override
  List<Object?> get props => [documentType, filePath, expiryDate];
}

/// Delete document
class DriverDocumentDeleted extends DriverProfileEvent {
  const DriverDocumentDeleted({required this.documentId});

  final String documentId;

  @override
  List<Object?> get props => [documentId];
}

/// Load ratings and reviews
class DriverRatingsLoaded extends DriverProfileEvent {
  const DriverRatingsLoaded({this.page = 1});

  final int page;

  @override
  List<Object?> get props => [page];
}

/// Update notification settings
class DriverNotificationSettingsUpdated extends DriverProfileEvent {
  const DriverNotificationSettingsUpdated({
    this.pushEnabled,
    this.emailEnabled,
    this.smsEnabled,
    this.tripAlerts,
    this.promoAlerts,
    this.earningsAlerts,
  });

  final bool? pushEnabled;
  final bool? emailEnabled;
  final bool? smsEnabled;
  final bool? tripAlerts;
  final bool? promoAlerts;
  final bool? earningsAlerts;

  @override
  List<Object?> get props => [
        pushEnabled,
        emailEnabled,
        smsEnabled,
        tripAlerts,
        promoAlerts,
        earningsAlerts,
      ];
}

/// Update app settings
class DriverAppSettingsUpdated extends DriverProfileEvent {
  const DriverAppSettingsUpdated({
    this.language,
    this.darkMode,
    this.soundEnabled,
    this.vibrationEnabled,
    this.navigationVoice,
    this.autoAcceptTrips,
    this.showEarningsOnHome,
  });

  final String? language;
  final bool? darkMode;
  final bool? soundEnabled;
  final bool? vibrationEnabled;
  final bool? navigationVoice;
  final bool? autoAcceptTrips;
  final bool? showEarningsOnHome;

  @override
  List<Object?> get props => [
        language,
        darkMode,
        soundEnabled,
        vibrationEnabled,
        navigationVoice,
        autoAcceptTrips,
        showEarningsOnHome,
      ];
}

/// Change password
class DriverPasswordChanged extends DriverProfileEvent {
  const DriverPasswordChanged({
    required this.currentPassword,
    required this.newPassword,
  });

  final String currentPassword;
  final String newPassword;

  @override
  List<Object?> get props => [currentPassword, newPassword];
}

/// Request account deletion
class DriverAccountDeletionRequested extends DriverProfileEvent {
  const DriverAccountDeletionRequested({required this.reason});

  final String reason;

  @override
  List<Object?> get props => [reason];
}

/// Logout
class DriverLoggedOut extends DriverProfileEvent {
  const DriverLoggedOut();
}

/// Reset profile state
class DriverProfileReset extends DriverProfileEvent {
  const DriverProfileReset();
}

// Enums
enum DocumentType {
  driverLicense,
  nationalId,
  vehicleRegistration,
  insurance,
  goodConduct,
  psvBadge,
  vehicleInspection,
  profilePhoto,
}

enum DocumentStatus {
  pending,
  approved,
  rejected,
  expired,
  expiringSoon,
}

// Models
class DriverProfile extends Equatable {
  const DriverProfile({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.email,
    required this.phoneNumber,
    required this.rating,
    required this.totalTrips,
    required this.memberSince,
    required this.isVerified,
    required this.isActive,
    this.photoUrl,
    this.referralCode,
    this.serviceTypes = const [],
    this.languages = const [],
  });

  final String id;
  final String firstName;
  final String lastName;
  final String email;
  final String phoneNumber;
  final double rating;
  final int totalTrips;
  final DateTime memberSince;
  final bool isVerified;
  final bool isActive;
  final String? photoUrl;
  final String? referralCode;
  final List<String> serviceTypes;
  final List<String> languages;

  String get fullName => '$firstName $lastName';

  @override
  List<Object?> get props => [
        id,
        firstName,
        lastName,
        email,
        phoneNumber,
        rating,
        totalTrips,
        memberSince,
        isVerified,
        isActive,
        photoUrl,
        referralCode,
        serviceTypes,
        languages,
      ];
}

class DriverVehicle extends Equatable {
  const DriverVehicle({
    required this.id,
    required this.make,
    required this.model,
    required this.year,
    required this.color,
    required this.licensePlate,
    required this.vehicleType,
    this.photoUrl,
    this.capacity,
    this.features = const [],
  });

  final String id;
  final String make;
  final String model;
  final int year;
  final String color;
  final String licensePlate;
  final String vehicleType;
  final String? photoUrl;
  final int? capacity;
  final List<String> features;

  String get displayName => '$year $make $model';
  String get displayColor => color.substring(0, 1).toUpperCase() + color.substring(1);

  @override
  List<Object?> get props => [
        id,
        make,
        model,
        year,
        color,
        licensePlate,
        vehicleType,
        photoUrl,
        capacity,
        features,
      ];
}

class DriverDocument extends Equatable {
  const DriverDocument({
    required this.id,
    required this.type,
    required this.status,
    required this.uploadedAt,
    this.documentUrl,
    this.expiryDate,
    this.rejectionReason,
  });

  final String id;
  final DocumentType type;
  final DocumentStatus status;
  final DateTime uploadedAt;
  final String? documentUrl;
  final DateTime? expiryDate;
  final String? rejectionReason;

  bool get isExpired =>
      expiryDate != null && DateTime.now().isAfter(expiryDate!);
  bool get isExpiringSoon =>
      expiryDate != null &&
      DateTime.now().isAfter(expiryDate!.subtract(const Duration(days: 30)));

  String get typeName {
    switch (type) {
      case DocumentType.driverLicense:
        return "Driver's License";
      case DocumentType.nationalId:
        return 'National ID';
      case DocumentType.vehicleRegistration:
        return 'Vehicle Registration';
      case DocumentType.insurance:
        return 'Insurance';
      case DocumentType.goodConduct:
        return 'Good Conduct Certificate';
      case DocumentType.psvBadge:
        return 'PSV Badge';
      case DocumentType.vehicleInspection:
        return 'Vehicle Inspection';
      case DocumentType.profilePhoto:
        return 'Profile Photo';
    }
  }

  @override
  List<Object?> get props => [
        id,
        type,
        status,
        uploadedAt,
        documentUrl,
        expiryDate,
        rejectionReason,
      ];
}

class DriverRating extends Equatable {
  const DriverRating({
    required this.id,
    required this.rating,
    required this.tripId,
    required this.tripType,
    required this.createdAt,
    this.comment,
    this.riderName,
  });

  final String id;
  final int rating;
  final String tripId;
  final String tripType;
  final DateTime createdAt;
  final String? comment;
  final String? riderName;

  @override
  List<Object?> get props => [
        id,
        rating,
        tripId,
        tripType,
        createdAt,
        comment,
        riderName,
      ];
}

class RatingSummary extends Equatable {
  const RatingSummary({
    required this.averageRating,
    required this.totalRatings,
    required this.fiveStarCount,
    required this.fourStarCount,
    required this.threeStarCount,
    required this.twoStarCount,
    required this.oneStarCount,
  });

  final double averageRating;
  final int totalRatings;
  final int fiveStarCount;
  final int fourStarCount;
  final int threeStarCount;
  final int twoStarCount;
  final int oneStarCount;

  double get fiveStarPercent =>
      totalRatings > 0 ? fiveStarCount / totalRatings * 100 : 0;
  double get fourStarPercent =>
      totalRatings > 0 ? fourStarCount / totalRatings * 100 : 0;
  double get threeStarPercent =>
      totalRatings > 0 ? threeStarCount / totalRatings * 100 : 0;
  double get twoStarPercent =>
      totalRatings > 0 ? twoStarCount / totalRatings * 100 : 0;
  double get oneStarPercent =>
      totalRatings > 0 ? oneStarCount / totalRatings * 100 : 0;

  @override
  List<Object?> get props => [
        averageRating,
        totalRatings,
        fiveStarCount,
        fourStarCount,
        threeStarCount,
        twoStarCount,
        oneStarCount,
      ];
}

class NotificationSettings extends Equatable {
  const NotificationSettings({
    this.pushEnabled = true,
    this.emailEnabled = true,
    this.smsEnabled = true,
    this.tripAlerts = true,
    this.promoAlerts = true,
    this.earningsAlerts = true,
  });

  final bool pushEnabled;
  final bool emailEnabled;
  final bool smsEnabled;
  final bool tripAlerts;
  final bool promoAlerts;
  final bool earningsAlerts;

  NotificationSettings copyWith({
    bool? pushEnabled,
    bool? emailEnabled,
    bool? smsEnabled,
    bool? tripAlerts,
    bool? promoAlerts,
    bool? earningsAlerts,
  }) {
    return NotificationSettings(
      pushEnabled: pushEnabled ?? this.pushEnabled,
      emailEnabled: emailEnabled ?? this.emailEnabled,
      smsEnabled: smsEnabled ?? this.smsEnabled,
      tripAlerts: tripAlerts ?? this.tripAlerts,
      promoAlerts: promoAlerts ?? this.promoAlerts,
      earningsAlerts: earningsAlerts ?? this.earningsAlerts,
    );
  }

  @override
  List<Object?> get props => [
        pushEnabled,
        emailEnabled,
        smsEnabled,
        tripAlerts,
        promoAlerts,
        earningsAlerts,
      ];
}

class AppSettings extends Equatable {
  const AppSettings({
    this.language = 'en',
    this.darkMode = false,
    this.soundEnabled = true,
    this.vibrationEnabled = true,
    this.navigationVoice = true,
    this.autoAcceptTrips = false,
    this.showEarningsOnHome = true,
  });

  final String language;
  final bool darkMode;
  final bool soundEnabled;
  final bool vibrationEnabled;
  final bool navigationVoice;
  final bool autoAcceptTrips;
  final bool showEarningsOnHome;

  AppSettings copyWith({
    String? language,
    bool? darkMode,
    bool? soundEnabled,
    bool? vibrationEnabled,
    bool? navigationVoice,
    bool? autoAcceptTrips,
    bool? showEarningsOnHome,
  }) {
    return AppSettings(
      language: language ?? this.language,
      darkMode: darkMode ?? this.darkMode,
      soundEnabled: soundEnabled ?? this.soundEnabled,
      vibrationEnabled: vibrationEnabled ?? this.vibrationEnabled,
      navigationVoice: navigationVoice ?? this.navigationVoice,
      autoAcceptTrips: autoAcceptTrips ?? this.autoAcceptTrips,
      showEarningsOnHome: showEarningsOnHome ?? this.showEarningsOnHome,
    );
  }

  @override
  List<Object?> get props => [
        language,
        darkMode,
        soundEnabled,
        vibrationEnabled,
        navigationVoice,
        autoAcceptTrips,
        showEarningsOnHome,
      ];
}
