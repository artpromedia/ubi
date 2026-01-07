import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:get_it/get_it.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:ubi_api_client/ubi_api_client.dart';
import 'package:ubi_api_client/ubi_api_client.dart' as api_client;
import 'package:ubi_location/ubi_location.dart';
import 'package:ubi_storage/ubi_storage.dart' as storage;

import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/connectivity/bloc/connectivity_bloc.dart';
import '../../features/driver/bloc/driver_bloc.dart';
import '../../features/earnings/bloc/earnings_bloc.dart';
import '../../features/navigation/bloc/navigation_bloc.dart';
import '../../features/profile/bloc/driver_profile_bloc.dart';
import '../../features/trips/bloc/trips_bloc.dart';

final getIt = GetIt.instance;

/// Configure all dependencies
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

  // === BLoC Layer ===
  _registerBlocs();
}

/// Register all BLoCs
void _registerBlocs() {
  // Auth BLoC - singleton for app-wide auth state
  getIt.registerLazySingleton<AuthBloc>(() => AuthBloc());

  // Connectivity BLoC - singleton for network monitoring
  getIt.registerLazySingleton<ConnectivityBloc>(() => ConnectivityBloc());

  // Driver BLoC - singleton for online/offline status
  getIt.registerLazySingleton<DriverBloc>(() => DriverBloc());

  // Feature BLoCs - factories for fresh instances
  getIt.registerFactory<TripsBloc>(() => TripsBloc());
  getIt.registerFactory<EarningsBloc>(() => EarningsBloc());
  getIt.registerFactory<NavigationBloc>(() => NavigationBloc());
  getIt.registerFactory<DriverProfileBloc>(() => DriverProfileBloc());
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
