import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';

/// Service for automatic SMS OTP detection using Android SMS Retriever API.
/// 
/// This service uses the SMS Retriever API which:
/// - Does not require any runtime permissions
/// - Works on Android 8+ (API 26+)
/// - Automatically detects SMS containing the app's hash
/// - Times out after 5 minutes
/// 
/// SMS Format Expected: "Your UBI verification code is: XXXXXX"
class SmsRetrieverService {
  static const MethodChannel _channel = MethodChannel('com.ubi.sms_retriever');
  static const EventChannel _smsEventChannel = EventChannel('com.ubi.sms_retriever/sms_events');

  StreamSubscription<dynamic>? _smsSubscription;
  final StreamController<SmsRetrievalResult> _smsController = 
      StreamController<SmsRetrievalResult>.broadcast();

  /// Stream of SMS retrieval results
  Stream<SmsRetrievalResult> get smsStream => _smsController.stream;

  /// Whether SMS Retriever is available on this device
  bool get isAvailable => Platform.isAndroid;

  /// Starts listening for incoming SMS containing OTP.
  /// 
  /// Returns the app signature hash that should be included in SMS for auto-detection.
  /// Returns null if the platform doesn't support SMS Retriever.
  Future<String?> startListening() async {
    if (!Platform.isAndroid) {
      _smsController.add(SmsRetrievalResult.failure(
        'SMS Retriever is only available on Android',
      ));
      return null;
    }

    try {
      // Get app signature hash (needed by SMS gateway to include in message)
      final String? appSignature = await _channel.invokeMethod<String>('getAppSignature');
      
      // Start SMS Retriever
      final bool? started = await _channel.invokeMethod<bool>('startSmsRetriever');
      
      if (started == true) {
        // Listen for SMS events
        _smsSubscription?.cancel();
        _smsSubscription = _smsEventChannel
            .receiveBroadcastStream()
            .listen(
              _handleSmsEvent,
              onError: _handleSmsError,
            );
      }

      return appSignature;
    } on PlatformException catch (e) {
      _smsController.add(SmsRetrievalResult.failure(
        'Failed to start SMS Retriever: ${e.message}',
      ));
      return null;
    }
  }

  /// Stops listening for SMS
  Future<void> stopListening() async {
    _smsSubscription?.cancel();
    _smsSubscription = null;

    if (Platform.isAndroid) {
      try {
        await _channel.invokeMethod<void>('stopSmsRetriever');
      } catch (_) {
        // Ignore errors when stopping
      }
    }
  }

  /// Extracts OTP code from SMS message
  /// 
  /// Supports formats:
  /// - "Your UBI verification code is: 123456"
  /// - "UBI code: 123456"
  /// - "123456 is your UBI verification code"
  /// - Any 6-digit number in the message
  static String? extractOtpFromMessage(String message) {
    // Try specific patterns first
    final patterns = [
      RegExp(r'verification code is[:\s]*(\d{6})', caseSensitive: false),
      RegExp(r'code[:\s]*(\d{6})', caseSensitive: false),
      RegExp(r'(\d{6}) is your', caseSensitive: false),
      RegExp(r'OTP[:\s]*(\d{6})', caseSensitive: false),
      // Fallback: any 6-digit number
      RegExp(r'(\d{6})'),
    ];

    for (final pattern in patterns) {
      final match = pattern.firstMatch(message);
      if (match != null && match.groupCount >= 1) {
        return match.group(1);
      }
    }

    return null;
  }

  void _handleSmsEvent(dynamic event) {
    if (event is Map) {
      final status = event['status'] as String?;
      final message = event['message'] as String?;

      if (status == 'success' && message != null) {
        final otp = extractOtpFromMessage(message);
        if (otp != null) {
          _smsController.add(SmsRetrievalResult.success(otp, message));
        } else {
          _smsController.add(SmsRetrievalResult.failure(
            'Could not extract OTP from message',
          ));
        }
      } else if (status == 'timeout') {
        _smsController.add(SmsRetrievalResult.timeout());
      } else {
        _smsController.add(SmsRetrievalResult.failure(
          event['error'] as String? ?? 'Unknown error',
        ));
      }
    }
  }

  void _handleSmsError(dynamic error) {
    _smsController.add(SmsRetrievalResult.failure(
      error?.toString() ?? 'Unknown error occurred',
    ));
  }

  /// Disposes the service and releases resources
  void dispose() {
    stopListening();
    _smsController.close();
  }
}

/// Result of SMS retrieval operation
class SmsRetrievalResult {
  final SmsRetrievalStatus status;
  final String? otp;
  final String? fullMessage;
  final String? errorMessage;

  const SmsRetrievalResult._({
    required this.status,
    this.otp,
    this.fullMessage,
    this.errorMessage,
  });

  factory SmsRetrievalResult.success(String otp, String fullMessage) {
    return SmsRetrievalResult._(
      status: SmsRetrievalStatus.success,
      otp: otp,
      fullMessage: fullMessage,
    );
  }

  factory SmsRetrievalResult.failure(String error) {
    return SmsRetrievalResult._(
      status: SmsRetrievalStatus.failure,
      errorMessage: error,
    );
  }

  factory SmsRetrievalResult.timeout() {
    return const SmsRetrievalResult._(
      status: SmsRetrievalStatus.timeout,
      errorMessage: 'SMS retrieval timed out',
    );
  }

  bool get isSuccess => status == SmsRetrievalStatus.success;
  bool get isFailure => status == SmsRetrievalStatus.failure;
  bool get isTimeout => status == SmsRetrievalStatus.timeout;
}

/// Status of SMS retrieval
enum SmsRetrievalStatus {
  success,
  failure,
  timeout,
}
