/// Wiring for the config layer.
///
/// Deliberately does not depend on the apps' get_it graph: the config cubit has
/// to exist before anything else can decide what is available, and it must be
/// constructible from a test with nothing registered.
library;

import 'package:dio/dio.dart';

import 'city_source.dart';
import 'config_api.dart';
import 'config_cache.dart';
import 'config_cubit.dart';
import 'config_repository.dart';

abstract final class ConfigBootstrap {
  /// API host for this build, e.g.
  /// `--dart-define=UBI_API_BASE_URL=https://api.ubi.africa`.
  ///
  /// Empty when the flavour did not set one; the config layer then reports
  /// `not_configured` and every flag stays off rather than pointing at a
  /// guessed host.
  static const String baseUrlFromEnvironment =
      String.fromEnvironment('UBI_API_BASE_URL');

  /// A Dio for the config service. [accessToken] supplies the bearer the
  /// service evaluates flags against; the user is never sent as a parameter.
  static Dio dio({
    required String baseUrl,
    Future<String?> Function()? accessToken,
    Duration timeout = const Duration(seconds: 10),
  }) {
    final Dio client = Dio(
      BaseOptions(
        baseUrl: baseUrl,
        connectTimeout: timeout,
        receiveTimeout: timeout,
        sendTimeout: timeout,
        responseType: ResponseType.json,
      ),
    );
    if (accessToken != null) {
      client.interceptors.add(
        InterceptorsWrapper(
          onRequest: (
            RequestOptions options,
            RequestInterceptorHandler handler,
          ) async {
            final String? token = await accessToken();
            if (token != null && token.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $token';
            }
            handler.next(options);
          },
        ),
      );
    }
    return client;
  }

  /// Builds the cubit an app provides above its router.
  ///
  /// Nothing is fetched here; call [ConfigCubit.load] once the widget tree is
  /// up so the loading state is visible.
  static Future<ConfigCubit> createCubit({
    required Dio dio,
    CitySource? citySource,
    ConfigCache? cache,
  }) async {
    return ConfigCubit(
      repository: ConfigRepository(
        source: ConfigApi(dio),
        cache: cache ?? await ConfigCache.open(),
      ),
      citySource: citySource ?? await StoredCitySource.open(),
    );
  }
}
