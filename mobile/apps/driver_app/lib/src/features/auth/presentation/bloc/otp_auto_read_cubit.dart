import 'dart:async';

import 'package:equatable/equatable.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../../core/services/sms_retriever_service.dart';

/// Cubit for managing OTP auto-read state and operations.
/// 
/// Handles:
/// - SMS Retriever API for automatic OTP detection
/// - Clipboard paste detection as fallback
/// - Analytics events for tracking success/failure
class OtpAutoReadCubit extends Cubit<OtpAutoReadState> {
  final SmsRetrieverService _smsRetrieverService;
  StreamSubscription<SmsRetrievalResult>? _smsSubscription;
  Timer? _clipboardTimer;
  String? _lastClipboardContent;

  OtpAutoReadCubit({
    SmsRetrieverService? smsRetrieverService,
  })  : _smsRetrieverService = smsRetrieverService ?? SmsRetrieverService(),
        super(const OtpAutoReadInitial());

  /// Starts listening for OTP via SMS Retriever and clipboard
  Future<void> startListening() async {
    emit(const OtpAutoReadListening());

    // Start SMS Retriever
    if (_smsRetrieverService.isAvailable) {
      final appSignature = await _smsRetrieverService.startListening();
      
      if (appSignature != null) {
        // Log the app signature for SMS gateway configuration
        // In production, this should be configured on the backend
        print('SMS Retriever App Signature: $appSignature');
      }

      // Listen for SMS events
      _smsSubscription?.cancel();
      _smsSubscription = _smsRetrieverService.smsStream.listen(
        _handleSmsResult,
        onError: _handleSmsError,
      );
    }

    // Start clipboard monitoring as fallback
    _startClipboardMonitoring();
  }

  /// Stops all listening operations
  void stopListening() {
    _smsSubscription?.cancel();
    _smsSubscription = null;
    _clipboardTimer?.cancel();
    _clipboardTimer = null;
    _smsRetrieverService.stopListening();
  }

  void _handleSmsResult(SmsRetrievalResult result) {
    if (result.isSuccess && result.otp != null) {
      emit(OtpAutoReadSuccess(
        otp: result.otp!,
        source: OtpSource.smsRetriever,
      ));
      _logAnalytics('otp_auto_detected', {
        'success': true,
        'source': 'sms_retriever',
      });
      stopListening();
    } else if (result.isTimeout) {
      emit(const OtpAutoReadTimeout());
      _logAnalytics('otp_auto_detected', {
        'success': false,
        'reason': 'timeout',
      });
    } else if (result.isFailure) {
      // Don't emit failure state - just log and continue listening
      // Manual entry is always available as fallback
      _logAnalytics('otp_auto_detected', {
        'success': false,
        'reason': result.errorMessage ?? 'unknown',
      });
    }
  }

  void _handleSmsError(dynamic error) {
    _logAnalytics('otp_auto_detected', {
      'success': false,
      'reason': error.toString(),
    });
  }

  /// Starts monitoring clipboard for OTP codes
  void _startClipboardMonitoring() {
    _clipboardTimer?.cancel();
    
    // Check clipboard every 1.5 seconds
    _clipboardTimer = Timer.periodic(
      const Duration(milliseconds: 1500),
      (_) => _checkClipboard(),
    );
    
    // Also check immediately
    _checkClipboard();
  }

  Future<void> _checkClipboard() async {
    try {
      final clipboardData = await Clipboard.getData(Clipboard.kTextPlain);
      final text = clipboardData?.text;
      
      if (text == null || text == _lastClipboardContent) return;
      
      _lastClipboardContent = text;
      
      // Try to extract OTP from clipboard content
      final otp = SmsRetrieverService.extractOtpFromMessage(text);
      
      if (otp != null && state is! OtpAutoReadSuccess) {
        emit(OtpDetectedFromClipboard(otp: otp));
        _logAnalytics('otp_auto_detected', {
          'success': true,
          'source': 'clipboard',
        });
      }
    } catch (_) {
      // Ignore clipboard access errors
    }
  }

  /// Manually triggers OTP detection from clipboard
  Future<void> pasteFromClipboard() async {
    try {
      final clipboardData = await Clipboard.getData(Clipboard.kTextPlain);
      final text = clipboardData?.text;
      
      if (text == null) {
        emit(const OtpAutoReadError('Clipboard is empty'));
        return;
      }
      
      final otp = SmsRetrieverService.extractOtpFromMessage(text);
      
      if (otp != null) {
        emit(OtpAutoReadSuccess(
          otp: otp,
          source: OtpSource.clipboard,
        ));
        _logAnalytics('otp_auto_detected', {
          'success': true,
          'source': 'manual_paste',
        });
        stopListening();
      } else {
        emit(const OtpAutoReadError('No valid OTP found in clipboard'));
      }
    } catch (e) {
      emit(OtpAutoReadError('Failed to access clipboard: $e'));
    }
  }

  /// Clears the detected clipboard OTP (user dismissed)
  void dismissClipboardOtp() {
    if (state is OtpDetectedFromClipboard) {
      emit(const OtpAutoReadListening());
    }
  }

  /// Accepts the OTP detected from clipboard
  void acceptClipboardOtp(String otp) {
    emit(OtpAutoReadSuccess(
      otp: otp,
      source: OtpSource.clipboard,
    ));
    stopListening();
  }

  void _logAnalytics(String event, Map<String, dynamic> params) {
    // TODO: Integrate with actual analytics service (Firebase, etc.)
    // For now, just print for debugging
    print('Analytics Event: $event - $params');
  }

  @override
  Future<void> close() {
    stopListening();
    _smsRetrieverService.dispose();
    return super.close();
  }
}

// States

abstract class OtpAutoReadState extends Equatable {
  const OtpAutoReadState();

  @override
  List<Object?> get props => [];
}

class OtpAutoReadInitial extends OtpAutoReadState {
  const OtpAutoReadInitial();
}

class OtpAutoReadListening extends OtpAutoReadState {
  const OtpAutoReadListening();
}

class OtpAutoReadSuccess extends OtpAutoReadState {
  final String otp;
  final OtpSource source;

  const OtpAutoReadSuccess({
    required this.otp,
    required this.source,
  });

  @override
  List<Object?> get props => [otp, source];
}

/// State when OTP is detected from clipboard (user can accept or dismiss)
class OtpDetectedFromClipboard extends OtpAutoReadState {
  final String otp;

  const OtpDetectedFromClipboard({required this.otp});

  @override
  List<Object?> get props => [otp];
}

class OtpAutoReadTimeout extends OtpAutoReadState {
  const OtpAutoReadTimeout();
}

class OtpAutoReadError extends OtpAutoReadState {
  final String message;

  const OtpAutoReadError(this.message);

  @override
  List<Object?> get props => [message];
}

/// Source of the OTP detection
enum OtpSource {
  smsRetriever,
  clipboard,
}
