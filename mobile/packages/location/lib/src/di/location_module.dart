/// Location Module
///
/// Dependency injection module for location services.
library;

import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';

import '../providers/location_provider.dart';
import '../services/geocoding_service.dart';
import '../services/location_service.dart';
import '../services/permission_service.dart';
import '../services/places_service.dart';

/// Injectable module for location services
@module
abstract class LocationModule {
  @lazySingleton
  PermissionService get permissionService => PermissionService();

  @lazySingleton
  GeocodingService get geocodingService => GeocodingService();

  @lazySingleton
  PlacesService get placesService => PlacesService();

  @lazySingleton
  LocationService locationService(PermissionService permissionService) =>
      LocationService(permissionService);

  @lazySingleton
  LocationProvider locationProvider(
    LocationService locationService,
    PermissionService permissionService,
    GeocodingService geocodingService,
    PlacesService placesService,
  ) =>
      LocationProvider(
        locationService: locationService,
        permissionService: permissionService,
        geocodingService: geocodingService,
        placesService: placesService,
      );
}

/// Register location services manually
void registerLocationModule(GetIt getIt) {
  // Services
  if (!getIt.isRegistered<PermissionService>()) {
    getIt.registerLazySingleton<PermissionService>(() => PermissionService());
  }

  if (!getIt.isRegistered<GeocodingService>()) {
    getIt.registerLazySingleton<GeocodingService>(() => GeocodingService());
  }

  if (!getIt.isRegistered<PlacesService>()) {
    getIt.registerLazySingleton<PlacesService>(() => PlacesService());
  }

  if (!getIt.isRegistered<LocationService>()) {
    getIt.registerLazySingleton<LocationService>(
      () => LocationService(getIt<PermissionService>()),
    );
  }

  // Provider
  if (!getIt.isRegistered<LocationProvider>()) {
    getIt.registerLazySingleton<LocationProvider>(
      () => LocationProvider(
        locationService: getIt<LocationService>(),
        permissionService: getIt<PermissionService>(),
        geocodingService: getIt<GeocodingService>(),
        placesService: getIt<PlacesService>(),
      ),
    );
  }
}
