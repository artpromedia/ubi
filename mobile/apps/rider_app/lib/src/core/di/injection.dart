import 'package:get_it/get_it.dart';
import 'package:injectable/injectable.dart';
import 'package:ubi_api_client/ubi_api_client.dart';
import 'package:ubi_location/ubi_location.dart';
import 'package:ubi_storage/ubi_storage.dart';

import '../../features/auth/bloc/auth_bloc.dart';
import '../../features/connectivity/bloc/connectivity_bloc.dart';
import '../../features/delivery/bloc/delivery_bloc.dart';
import '../../features/food/bloc/food_bloc.dart';
import '../../features/profile/bloc/profile_bloc.dart';
import '../../features/ride/bloc/ride_bloc.dart';
import 'injection.config.dart';

final getIt = GetIt.instance;

@InjectableInit(
  initializerName: 'init',
  preferRelativeImports: true,
  asExtension: true,
)
Future<void> configureDependencies() async {
  // Initialize storage first (async)
  await initializeStorage(getIt);

  // Register API module
  registerApiModule(getIt);

  // Register location module
  registerLocationModule(getIt);

  // Configure API client with token storage
  final tokenStorage = getIt<TokenStorage>();
  final apiConfig = ApiConfig.development(); // or staging/production

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

  // Initialize injectable modules
  getIt.init();
}

/// Register all BLoCs as lazy singletons
void _registerBlocs() {
  // Auth BLoC - singleton for app-wide auth state
  getIt.registerLazySingleton<AuthBloc>(() => AuthBloc());

  // Connectivity BLoC - singleton for network monitoring
  getIt.registerLazySingleton<ConnectivityBloc>(() => ConnectivityBloc());

  // Feature BLoCs - factories for fresh instances per screen
  getIt.registerFactory<RideBloc>(() => RideBloc());
  getIt.registerFactory<FoodBloc>(() => FoodBloc());
  getIt.registerFactory<DeliveryBloc>(() => DeliveryBloc());
  getIt.registerFactory<ProfileBloc>(() => ProfileBloc());
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
