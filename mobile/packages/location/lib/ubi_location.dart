/// UBI Location Package
///
/// Provides location services, permissions handling, geocoding,
/// and place search functionality for UBI mobile apps.
library ubi_location;

// === Services ===
export 'src/services/location_service.dart';
export 'src/services/permission_service.dart';
export 'src/services/geocoding_service.dart';
export 'src/services/places_service.dart';

// === Providers ===
export 'src/providers/location_provider.dart';

// === DI ===
export 'src/di/location_module.dart';
