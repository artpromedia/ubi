import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:get_it/get_it.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:ubi_api_client/ubi_api_client.dart';
import 'package:ubi_api_client/ubi_api_client.dart' as api_client;
import 'package:ubi_core/ubi_core.dart';
import 'package:ubi_location/ubi_location.dart';
import 'package:ubi_storage/ubi_storage.dart' as storage;

import '../../data/repositories/auth_repository_impl.dart';
import '../../data/repositories/ride_repository_impl.dart';
import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/connectivity/bloc/connectivity_bloc.dart';
import '../../features/delivery/bloc/delivery_bloc.dart';
import '../../features/food/bloc/food_bloc.dart';
import '../../features/profile/bloc/profile_bloc.dart';
import '../../features/ride/bloc/ride_bloc.dart';

import '../../data/repositories/auth_repository_impl.dart';
import '../../data/repositories/ride_repository_impl.dart';
import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/connectivity/bloc/connectivity_bloc.dart';
import '../../features/delivery/bloc/delivery_bloc.dart';
import '../../features/food/bloc/food_bloc.dart';
import '../../features/profile/bloc/profile_bloc.dart';
import '../../features/ride/bloc/ride_bloc.dart';

final getIt = GetIt.instance;

Future<void> configureDependencies() async {
  // === External Dependencies ===
  
  // Connectivity checker
  getIt.registerLazySingleton<ConnectivityChecker>(
    () => _ConnectivityCheckerImpl(),
  );
  
  // Google Sign In
  getIt.registerLazySingleton<GoogleSignIn>(
    () => GoogleSignIn(scopes: ['email', 'profile']),
  );

  // === Storage Layer ===
  await storage.initializeStorage(getIt);

  // === API Layer ===
  final storageTokenStorage = getIt<storage.TokenStorage>();
  final apiTokenStorage = _TokenStorageAdapter(storageTokenStorage);
  final connectivityChecker = getIt<ConnectivityChecker>();
  
  registerApiModule(
    getIt,
    tokenStorage: apiTokenStorage,
    connectivityChecker: connectivityChecker,
    config: ApiConfig.development(),
  );

  // === Location Layer ===
  registerLocationModule(getIt);

  // Configure places service
  getIt<PlacesService>().configure(
    const PlacesConfig(
      apiKey: String.fromEnvironment('GOOGLE_PLACES_API_KEY'),
      language: 'en',
    ),
  );

  // === Repository Layer ===
  _registerRepositories();

  // === Use Cases Layer ===
  _registerUseCases();

  // === BLoC Layer ===
  _registerBlocs();
}

/// Register repository implementations
void _registerRepositories() {
  // Auth Repository
  getIt.registerLazySingleton<AuthRepository>(
    () => AuthRepositoryImpl(
      authService: getIt<AuthService>(),
      tokenStorage: getIt<storage.TokenStorage>(),
    ),
  );

  // Ride Repository
  getIt.registerLazySingleton<RideRepository>(
    () => RideRepositoryImpl(
      rideService: getIt<RideService>(),
    ),
  );
}

/// Register use cases
void _registerUseCases() {
  final rideRepo = getIt<RideRepository>();

  // Ride Use Cases
  getIt.registerLazySingleton<GetRideEstimates>(
    () => GetRideEstimatesUseCase(rideRepo),
  );
  getIt.registerLazySingleton<RequestRide>(
    () => RequestRideUseCase(rideRepo),
  );
  getIt.registerLazySingleton<CancelRide>(
    () => CancelRideUseCase(rideRepo),
  );
  getIt.registerLazySingleton<RateRide>(
    () => RateRideUseCase(rideRepo),
  );
  getIt.registerLazySingleton<AddRideTip>(
    () => AddRideTipUseCase(rideRepo),
  );
  getIt.registerLazySingleton<WatchRideStatus>(
    () => WatchRideStatus(rideRepo),
  );
  getIt.registerLazySingleton<WatchDriverLocation>(
    () => WatchDriverLocation(rideRepo),
  );
  getIt.registerLazySingleton<GetNearbyDrivers>(
    () => GetNearbyDriversUseCase(rideRepo),
  );
  getIt.registerLazySingleton<SearchPlaces>(
    () => SearchPlacesUseCase(rideRepo),
  );
}

/// Register all BLoCs
void _registerBlocs() {
  // Auth BLoC - singleton for app-wide auth state
  // In debug mode, demo login works even without a backend
  getIt.registerLazySingleton<AuthBloc>(
    () => AuthBloc(
      // Pass repository if registered, otherwise demo mode will be used
      authRepository: getIt.isRegistered<AuthRepository>() 
          ? getIt<AuthRepository>() 
          : null,
      tokenStorage: getIt.isRegistered<storage.TokenStorage>()
          ? getIt<storage.TokenStorage>()
          : null,
      googleSignIn: getIt<GoogleSignIn>(),
      enableDemoMode: true, // Enable demo mode for development
    ),
  );

  // Connectivity BLoC - singleton for network monitoring
  getIt.registerLazySingleton<ConnectivityBloc>(() => ConnectivityBloc());

  // Ride BLoC - factory for fresh instances per screen
  getIt.registerFactory<RideBloc>(
    () => RideBloc(
      getRideEstimates: getIt<GetRideEstimates>(),
      requestRide: getIt<RequestRide>(),
      cancelRide: getIt<CancelRide>(),
      rateRide: getIt<RateRide>(),
      addRideTip: getIt<AddRideTip>(),
      watchRideStatus: getIt<WatchRideStatus>(),
      watchDriverLocation: getIt<WatchDriverLocation>(),
      getNearbyDrivers: getIt<GetNearbyDrivers>(),
      searchPlaces: getIt<SearchPlaces>(),
    ),
  );

  // Feature BLoCs - factories for fresh instances per screen
  getIt.registerFactory<FoodBloc>(() => FoodBloc());
  getIt.registerFactory<DeliveryBloc>(() => DeliveryBloc());
  getIt.registerFactory<ProfileBloc>(() => ProfileBloc());
}

/// Simple connectivity checker implementation
class _ConnectivityCheckerImpl implements ConnectivityChecker {
  final Connectivity _connectivity = Connectivity();

  @override
  Future<bool> hasConnection() async {
    final result = await _connectivity.checkConnectivity();
    return result != ConnectivityResult.none;
  }

  @override
  Stream<bool> get connectivityStream {
    return _connectivity.onConnectivityChanged.map(
      (result) => result != ConnectivityResult.none,
    );
  }
}

/// Adapter to bridge storage.TokenStorage to api_client.TokenStorage interface
class _TokenStorageAdapter implements api_client.TokenStorage {
  _TokenStorageAdapter(this._storage);
  
  final storage.TokenStorage _storage;
  
  @override
  Future<String?> getAccessToken() => _storage.getAccessToken();
  
  @override
  Future<String?> getRefreshToken() => _storage.getRefreshToken();
  
  @override
  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) => _storage.saveTokens(
    accessToken: accessToken,
    refreshToken: refreshToken,
  );
  
  @override
  Future<void> clearTokens() => _storage.clearTokens();
}