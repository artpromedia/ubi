/// HTTP access to the config service.
///
/// `GET /v1/config/cities/{cityId}` and `GET /v1/flags`
/// (`contracts/openapi/support-config.yaml`). Both are conditional requests:
/// the client sends `If-None-Match` and the service answers 304 when nothing
/// changed, which is the ETag poll slice 01 asks for on foreground.
///
/// The user is never sent as a parameter. Flags are evaluated server-side from
/// the bearer token; a client-supplied user id would be a trust boundary
/// violation (CLAUDE.md: server is authoritative).
library;

import 'package:dio/dio.dart';

import 'city_config.dart';
import 'config_failure.dart';
import 'feature_flags.dart';
import 'json_read.dart';

/// Result of one conditional GET.
sealed class ConfigResponse<T> {
  const ConfigResponse();
}

/// 200 — a fresh document, with the ETag to send next time.
final class ConfigPayload<T> extends ConfigResponse<T> {
  const ConfigPayload({
    required this.value,
    required this.raw,
    required this.etag,
  });

  /// The parsed document.
  final T value;

  /// The exact body the service sent. Cached verbatim so the stored ETag keeps
  /// matching and no field is lost to a model that is a version behind.
  final Map<String, dynamic> raw;

  final String? etag;
}

/// 304 — the service is reachable and the cached document is still current.
final class ConfigNotModified<T> extends ConfigResponse<T> {
  const ConfigNotModified();
}

/// Anything else. [reason] is a code, never a message from the wire.
final class ConfigFailure<T> extends ConfigResponse<T> {
  const ConfigFailure(this.reason);

  final ConfigUnavailableReason reason;
}

/// What the repository needs from the network. Separated from [ConfigApi] so a
/// test can substitute a source without a Dio or a server.
abstract interface class ConfigSource {
  Future<ConfigResponse<CityConfig>> fetchCityConfig({
    required String cityId,
    String? etag,
  });

  Future<ConfigResponse<FlagSet>> fetchFlags({
    required String cityId,
    String? etag,
  });
}

class ConfigApi implements ConfigSource {
  ConfigApi(this._dio);

  static const String cityConfigPath = '/v1/config/cities';
  static const String flagsPath = '/v1/flags';

  final Dio _dio;

  @override
  Future<ConfigResponse<CityConfig>> fetchCityConfig({
    required String cityId,
    String? etag,
  }) {
    return _conditionalGet<CityConfig>(
      path: '$cityConfigPath/${Uri.encodeComponent(cityId)}',
      query: null,
      etag: etag,
      parse: CityConfig.fromJson,
    );
  }

  @override
  Future<ConfigResponse<FlagSet>> fetchFlags({
    required String cityId,
    String? etag,
  }) {
    return _conditionalGet<FlagSet>(
      path: flagsPath,
      query: <String, dynamic>{'cityId': cityId},
      etag: etag,
      parse: FlagSet.fromJson,
    );
  }

  Future<ConfigResponse<T>> _conditionalGet<T>({
    required String path,
    required Map<String, dynamic>? query,
    required String? etag,
    required T Function(Map<String, dynamic> json) parse,
  }) async {
    if (_dio.options.baseUrl.isEmpty) {
      // No API host was built into this flavour. Say so instead of failing as
      // if the device were offline.
      return ConfigFailure<T>(ConfigUnavailableReason.notConfigured);
    }
    try {
      final Response<dynamic> response = await _dio.get<dynamic>(
        path,
        queryParameters: query,
        options: Options(
          headers: <String, dynamic>{
            if (etag != null && etag.isNotEmpty) 'If-None-Match': etag,
          },
          // 304 is a success for us, so it must not be thrown. 5xx still is.
          validateStatus: (int? status) => status != null && status < 500,
        ),
      );

      final int status = response.statusCode ?? 0;
      if (status == 304) {
        return ConfigNotModified<T>();
      }
      if (status == 401 || status == 403) {
        return ConfigFailure<T>(ConfigUnavailableReason.unauthorized);
      }
      if (status == 404) {
        return ConfigFailure<T>(ConfigUnavailableReason.unknownCity);
      }
      if (status != 200) {
        return ConfigFailure<T>(ConfigUnavailableReason.serverError);
      }

      final Object? body = response.data;
      if (body is! Map<String, dynamic>) {
        return ConfigFailure<T>(ConfigUnavailableReason.malformed);
      }

      return ConfigPayload<T>(
        value: parse(body),
        raw: body,
        etag: response.headers.value('etag'),
      );
    } on ConfigFormatException {
      return ConfigFailure<T>(ConfigUnavailableReason.malformed);
    } on FormatException {
      return ConfigFailure<T>(ConfigUnavailableReason.malformed);
    } on DioException catch (error) {
      return ConfigFailure<T>(_reasonFor(error));
    }
  }

  static ConfigUnavailableReason _reasonFor(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return ConfigUnavailableReason.timeout;
      case DioExceptionType.connectionError:
        return ConfigUnavailableReason.offline;
      case DioExceptionType.badCertificate:
        return ConfigUnavailableReason.serverError;
      case DioExceptionType.badResponse:
        return ConfigUnavailableReason.serverError;
      case DioExceptionType.cancel:
      case DioExceptionType.unknown:
        return ConfigUnavailableReason.offline;
    }
  }
}
