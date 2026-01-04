import 'package:get_it/get_it.dart';
import 'package:ubi_api_client/ubi_api_client.dart';
import 'package:ubi_location/ubi_location.dart';
import 'package:ubi_storage/ubi_storage.dart';

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
  // Initialize storage first (async)
  await initializeStorage(getIt);

  // Register API module
  registerApiModule(getIt);

  // Register location module
  registerLocationModule(getIt);

  // Configure API client with token storage
  final tokenStorage = getIt<TokenStorage>();
  final apiConfig = ApiConfig.development();

  getIt.registerSingleton<ApiClient>(
    ApiClient(
      config: apiConfig,
      tokenStorage: _TokenStorageAdapter(tokenStorage),
    ),
  );

  // Configure places service
  getIt<PlacesService>().configure(
    const PlacesConfig(
      apiKey: String.fromEnvironment('GOOGLE_PLACES_API_KEY'),
      language: 'en',
    ),
  );

  // Register BLoCs
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

/// Adapter to bridge TokenStorage with API client interface
class _TokenStorageAdapter implements TokenStorageInterface {
  _TokenStorageAdapter(this._tokenStorage);

  final TokenStorage _tokenStorage;

  @override
  Future<String?> getAccessToken() => _tokenStorage.getAccessToken();

  @override
  Future<String?> getRefreshToken() => _tokenStorage.getRefreshToken();

  @override
  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _tokenStorage.saveTokens(AuthTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
    ));
  }

  @override
  Future<void> clearTokens() => _tokenStorage.clearTokens();
}

/// Interface expected by API client for token storage
abstract class TokenStorageInterface {
  Future<String?> getAccessToken();
  Future<String?> getRefreshToken();
  Future<void> saveTokens({required String accessToken, required String refreshToken});
  Future<void> clearTokens();
}
