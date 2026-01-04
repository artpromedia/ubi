/// Storage Module
///
/// Dependency injection module for storage services.
library;

import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../cache/cache_manager.dart';
import '../database/database_service.dart';
import '../preferences/app_preferences.dart';
import '../secure/secure_storage.dart';
import '../secure/token_storage.dart';

/// Injectable module for storage services
@module
abstract class StorageModule {
  @preResolve
  Future<SharedPreferences> get sharedPreferences => SharedPreferences.getInstance();

  @lazySingleton
  SecureStorage get secureStorage => SecureStorage();

  @lazySingleton
  TokenStorage tokenStorage(SecureStorage secureStorage) => TokenStorage(secureStorage);

  @lazySingleton
  AppPreferences appPreferences(SharedPreferences prefs) => AppPreferences(prefs);

  @lazySingleton
  CacheManager cacheManager(SharedPreferences prefs) => CacheManager(prefs);

  @lazySingleton
  DatabaseService get databaseService => DatabaseService.instance;
}

/// Initialize storage services
Future<void> initializeStorage(GetIt getIt) async {
  // SharedPreferences (required for other services)
  final prefs = await SharedPreferences.getInstance();
  if (!getIt.isRegistered<SharedPreferences>()) {
    getIt.registerSingleton<SharedPreferences>(prefs);
  }

  // Secure Storage
  if (!getIt.isRegistered<SecureStorage>()) {
    getIt.registerLazySingleton<SecureStorage>(() => SecureStorage());
  }

  // Token Storage
  if (!getIt.isRegistered<TokenStorage>()) {
    getIt.registerLazySingleton<TokenStorage>(
      () => TokenStorage(getIt<SecureStorage>()),
    );
  }

  // App Preferences
  if (!getIt.isRegistered<AppPreferences>()) {
    getIt.registerLazySingleton<AppPreferences>(
      () => AppPreferences(getIt<SharedPreferences>()),
    );
  }

  // Cache Manager
  if (!getIt.isRegistered<CacheManager>()) {
    getIt.registerLazySingleton<CacheManager>(
      () => CacheManager(getIt<SharedPreferences>()),
    );
  }

  // Database Service
  if (!getIt.isRegistered<DatabaseService>()) {
    final dbService = DatabaseService.instance;
    await dbService.initialize();
    getIt.registerSingleton<DatabaseService>(dbService);
  }
}

/// Clean up storage resources
Future<void> disposeStorage(GetIt getIt) async {
  if (getIt.isRegistered<DatabaseService>()) {
    await getIt<DatabaseService>().close();
  }
}
