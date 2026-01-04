/// UBI Storage Package
///
/// Provides local storage, caching, and secure storage for UBI mobile apps.
library ubi_storage;

// === Secure Storage ===
export 'src/secure/secure_storage.dart';
export 'src/secure/token_storage.dart';

// === Preferences ===
export 'src/preferences/app_preferences.dart';

// === Cache ===
export 'src/cache/cache_manager.dart';
export 'src/cache/cache_policy.dart';

// === Database ===
export 'src/database/database_service.dart';
export 'src/database/collections/user_collection.dart';
export 'src/database/collections/ride_collection.dart';
export 'src/database/collections/order_collection.dart';

// === DI ===
export 'src/di/storage_module.dart';
