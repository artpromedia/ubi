import 'dart:developer' as developer;
import 'package:flutter/foundation.dart';

/// Logging utility
class Logger {
  Logger._();

  static const String _tag = 'UBI';

  /// Log debug message
  static void debug(String message, {String? tag}) {
    if (kDebugMode) {
      developer.log(
        message,
        name: tag ?? _tag,
        level: 500, // Debug level
      );
    }
  }

  /// Log info message
  static void info(String message, {String? tag}) {
    if (kDebugMode) {
      developer.log(
        message,
        name: tag ?? _tag,
        level: 800, // Info level
      );
    }
  }

  /// Log warning message
  static void warning(String message, {String? tag}) {
    developer.log(
      '⚠️ $message',
      name: tag ?? _tag,
      level: 900, // Warning level
    );
  }

  /// Log error message
  static void error(
    String message, {
    String? tag,
    Object? error,
    StackTrace? stackTrace,
  }) {
    developer.log(
      '❌ $message',
      name: tag ?? _tag,
      level: 1000, // Error level
      error: error,
      stackTrace: stackTrace,
    );
  }

  /// Log network request
  static void network(
    String method,
    String url, {
    int? statusCode,
    dynamic body,
    String? tag,
  }) {
    if (kDebugMode) {
      final buffer = StringBuffer()
        ..writeln('🌐 $method $url')
        ..writeln('   Status: ${statusCode ?? 'pending'}');
      
      if (body != null) {
        buffer.writeln('   Body: $body');
      }
      
      developer.log(
        buffer.toString(),
        name: tag ?? '$_tag/Network',
        level: 500,
      );
    }
  }

  /// Log state change (for bloc/state management)
  static void state(String event, {dynamic state, String? tag}) {
    if (kDebugMode) {
      developer.log(
        '📊 $event: ${state?.toString() ?? 'null'}',
        name: tag ?? '$_tag/State',
        level: 500,
      );
    }
  }

  /// Log navigation
  static void navigation(String route, {Map<String, dynamic>? params, String? tag}) {
    if (kDebugMode) {
      final paramsStr = params != null ? ' with params: $params' : '';
      developer.log(
        '🧭 Navigate to: $route$paramsStr',
        name: tag ?? '$_tag/Navigation',
        level: 500,
      );
    }
  }

  /// Log performance timing
  static void performance(String operation, int milliseconds, {String? tag}) {
    if (kDebugMode) {
      developer.log(
        '⏱️ $operation took ${milliseconds}ms',
        name: tag ?? '$_tag/Performance',
        level: 500,
      );
    }
  }
}
