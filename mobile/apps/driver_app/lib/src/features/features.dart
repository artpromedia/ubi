// Driver App Features Barrel Export
// This file exports all features for easy importing throughout the app

// Auth Feature
export 'auth/presentation/pages/login_page.dart';
export 'auth/presentation/pages/register_page.dart';
export 'auth/presentation/pages/otp_verification_page.dart';

// Driver Feature
export 'driver/bloc/driver_bloc.dart' hide DriverVehicleUpdated, DriverProfileLoaded;

// Home Feature
export 'home/presentation/pages/home_page.dart';

// Splash Feature
export 'splash/presentation/pages/splash_page.dart';

// Onboarding Feature
export 'onboarding/presentation/pages/onboarding_page.dart';

// Trips Feature
export 'trips/bloc/trips_bloc.dart' hide LatLng, CustomerInfo;
export 'trips/presentation/pages/trip_request_page.dart';
export 'trips/presentation/pages/active_trip_page.dart';

// Navigation Feature
export 'navigation/bloc/navigation_bloc.dart';
export 'navigation/presentation/pages/navigation_page.dart';

// Earnings Feature
export 'earnings/bloc/earnings_bloc.dart' hide CustomerInfo;
export 'earnings/presentation/pages/earnings_page.dart';
export 'earnings/presentation/pages/trip_history_page.dart';
export 'earnings/presentation/pages/trip_details_page.dart';
export 'earnings/presentation/pages/payout_history_page.dart';

// Profile Feature
export 'profile/bloc/driver_profile_bloc.dart';
export 'profile/presentation/pages/profile_page.dart';
export 'profile/presentation/pages/edit_profile_page.dart';
export 'profile/presentation/pages/vehicle_page.dart';
export 'profile/presentation/pages/settings_page.dart';

// Documents Feature
export 'documents/presentation/pages/documents_page.dart';
export 'documents/presentation/pages/upload_document_page.dart';

// Ratings Feature
export 'ratings/presentation/pages/ratings_page.dart';
