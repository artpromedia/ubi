/// Dependency Injection Setup
///
/// Core DI configuration using GetIt and Injectable.
library;

import 'package:get_it/get_it.dart';

/// Global GetIt instance
final getIt = GetIt.instance;

/// Initialize dependency injection
///
/// Call this in main() before runApp()
Future<void> configureDependencies() async {
  // Core dependencies will be registered here
  // Each package should have its own module that registers its dependencies
}

/// Reset all dependencies (useful for testing)
Future<void> resetDependencies() async {
  await getIt.reset();
}

/// Check if a dependency is registered
bool isRegistered<T extends Object>() {
  return getIt.isRegistered<T>();
}
