/// Connectivity Interceptor
///
/// Checks network connectivity before making requests
/// and provides offline-first functionality.
library;

import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';

import '../client/api_client.dart';

/// Interceptor that checks connectivity before requests
///
/// - Fails fast if offline (prevents timeout waits)
/// - Can optionally queue requests for later
/// - Provides offline detection for UI
class ConnectivityInterceptor extends Interceptor {
  ConnectivityInterceptor({
    required this.connectivityChecker,
    this.failOnOffline = true,
  });

  final ConnectivityChecker connectivityChecker;

  /// Whether to fail immediately when offline
  /// If false, requests will proceed and potentially timeout
  final bool failOnOffline;

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // Skip connectivity check for cached requests
    if (options.extra['offlineAllowed'] == true) {
      handler.next(options);
      return;
    }

    // Check connectivity
    final hasConnection = await connectivityChecker.hasConnection();

    if (!hasConnection && failOnOffline) {
      handler.reject(
        DioException(
          requestOptions: options,
          error: const OfflineException(),
          type: DioExceptionType.connectionError,
        ),
      );
      return;
    }

    handler.next(options);
  }
}

/// Exception thrown when device is offline
class OfflineException implements Exception {
  const OfflineException([this.message = 'No internet connection']);

  final String message;

  @override
  String toString() => 'OfflineException: $message';
}

/// Default implementation of ConnectivityChecker using dart:io
class DefaultConnectivityChecker implements ConnectivityChecker {
  DefaultConnectivityChecker({
    this.checkInterval = const Duration(seconds: 5),
    this.checkUrl = 'google.com',
  }) {
    _startPeriodicCheck();
  }

  final Duration checkInterval;
  final String checkUrl;

  final _connectivityController = StreamController<bool>.broadcast();
  bool _lastKnownState = true;
  Timer? _timer;

  @override
  Future<bool> hasConnection() async {
    try {
      final result = await InternetAddress.lookup(checkUrl);
      final connected = result.isNotEmpty && result[0].rawAddress.isNotEmpty;
      _updateState(connected);
      return connected;
    } on SocketException catch (_) {
      _updateState(false);
      return false;
    }
  }

  @override
  Stream<bool> get connectivityStream => _connectivityController.stream;

  void _startPeriodicCheck() {
    _timer = Timer.periodic(checkInterval, (_) async {
      await hasConnection();
    });
  }

  void _updateState(bool connected) {
    if (_lastKnownState != connected) {
      _lastKnownState = connected;
      _connectivityController.add(connected);
    }
  }

  void dispose() {
    _timer?.cancel();
    _connectivityController.close();
  }
}

/// Extension for offline-first request options
extension OfflineOptionsExtension on RequestOptions {
  /// Mark request as allowed to proceed offline
  /// (e.g., will use cached data)
  RequestOptions withOfflineAllowed() {
    extra['offlineAllowed'] = true;
    return this;
  }
}
