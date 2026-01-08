import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_recognition_result.dart';
import 'package:speech_to_text/speech_to_text.dart';

/// Supported languages for speech recognition in target markets
enum SpeechLanguage {
  english('en_US', 'English', 'en'),
  swahili('sw_KE', 'Kiswahili', 'sw'),
  french('fr_FR', 'Français', 'fr'),
  hausa('ha_NG', 'Hausa', 'ha'),
  yoruba('yo_NG', 'Yorùbá', 'yo'),
  igbo('ig_NG', 'Igbo', 'ig');

  const SpeechLanguage(this.localeId, this.displayName, this.languageCode);

  /// The locale ID used by speech_to_text (e.g., 'en_US')
  final String localeId;

  /// Human-readable display name
  final String displayName;

  /// ISO 639-1 language code
  final String languageCode;

  /// Get language from locale ID
  static SpeechLanguage? fromLocaleId(String localeId) {
    final code = localeId.split('_').first.toLowerCase();
    return SpeechLanguage.values.cast<SpeechLanguage?>().firstWhere(
          (lang) => lang?.languageCode == code,
          orElse: () => null,
        );
  }

  /// Get language from language code
  static SpeechLanguage fromLanguageCode(String code) {
    return SpeechLanguage.values.firstWhere(
      (lang) => lang.languageCode == code,
      orElse: () => SpeechLanguage.english,
    );
  }
}

/// State of the speech recognition service
enum SpeechState {
  /// Service not initialized
  uninitialized,

  /// Ready to listen
  ready,

  /// Currently listening for speech
  listening,

  /// Processing speech after listening stopped
  processing,

  /// Error occurred
  error,

  /// Permission denied
  permissionDenied,

  /// Speech recognition not available on device
  notAvailable,
}

/// Result from speech recognition
class SpeechResult {
  const SpeechResult({
    required this.text,
    required this.confidence,
    required this.isFinal,
    this.alternates = const [],
  });

  /// The recognized text
  final String text;

  /// Confidence score (0.0 - 1.0)
  final double confidence;

  /// Whether this is the final result
  final bool isFinal;

  /// Alternative transcriptions
  final List<String> alternates;

  @override
  String toString() =>
      'SpeechResult(text: $text, confidence: $confidence, isFinal: $isFinal)';
}

/// Error from speech recognition
class SpeechError {
  const SpeechError({
    required this.message,
    required this.isRetryable,
    this.errorCode,
  });

  final String message;
  final bool isRetryable;
  final String? errorCode;

  /// User-friendly error messages
  static SpeechError fromErrorCode(String errorCode) {
    switch (errorCode) {
      case 'error_no_match':
        return const SpeechError(
          message: "Couldn't hear you, please try again",
          isRetryable: true,
          errorCode: 'error_no_match',
        );
      case 'error_speech_timeout':
        return const SpeechError(
          message: "Didn't hear anything, please try again",
          isRetryable: true,
          errorCode: 'error_speech_timeout',
        );
      case 'error_audio':
        return const SpeechError(
          message: 'Microphone error, please check permissions',
          isRetryable: true,
          errorCode: 'error_audio',
        );
      case 'error_network':
        return const SpeechError(
          message: 'Network error, trying offline mode',
          isRetryable: true,
          errorCode: 'error_network',
        );
      case 'error_permission':
        return const SpeechError(
          message: 'Microphone permission required',
          isRetryable: false,
          errorCode: 'error_permission',
        );
      default:
        return SpeechError(
          message: 'Voice search unavailable, please try again',
          isRetryable: true,
          errorCode: errorCode,
        );
    }
  }
}

/// Service for speech-to-text recognition
///
/// Provides voice input functionality for location search with support
/// for multiple languages common in target markets.
class SpeechRecognitionService {
  SpeechRecognitionService._();

  static final SpeechRecognitionService instance = SpeechRecognitionService._();

  final SpeechToText _speech = SpeechToText();

  SpeechState _state = SpeechState.uninitialized;
  SpeechLanguage _currentLanguage = SpeechLanguage.english;
  List<SpeechLanguage> _availableLanguages = [];

  // Stream controllers
  final _stateController = StreamController<SpeechState>.broadcast();
  final _resultController = StreamController<SpeechResult>.broadcast();
  final _errorController = StreamController<SpeechError>.broadcast();
  final _soundLevelController = StreamController<double>.broadcast();

  /// Current state of the service
  SpeechState get state => _state;

  /// Stream of state changes
  Stream<SpeechState> get stateStream => _stateController.stream;

  /// Stream of speech recognition results
  Stream<SpeechResult> get resultStream => _resultController.stream;

  /// Stream of errors
  Stream<SpeechError> get errorStream => _errorController.stream;

  /// Stream of sound levels (0.0 - 1.0) for waveform visualization
  Stream<double> get soundLevelStream => _soundLevelController.stream;

  /// Currently selected language
  SpeechLanguage get currentLanguage => _currentLanguage;

  /// Available languages on this device
  List<SpeechLanguage> get availableLanguages => _availableLanguages;

  /// Whether the service is currently listening
  bool get isListening => _state == SpeechState.listening;

  /// Whether the service is ready to use
  bool get isReady => _state == SpeechState.ready;

  /// Initialize the speech recognition service
  ///
  /// This does NOT request microphone permission - that happens on first use.
  Future<bool> initialize() async {
    if (_state != SpeechState.uninitialized) {
      return _state != SpeechState.notAvailable;
    }

    try {
      final available = await _speech.initialize(
        onError: _handleError,
        onStatus: _handleStatus,
        debugLogging: kDebugMode,
      );

      if (!available) {
        _updateState(SpeechState.notAvailable);
        return false;
      }

      // Get available locales and map to our supported languages
      final locales = await _speech.locales();
      _availableLanguages = SpeechLanguage.values.where((lang) {
        return locales.any((locale) =>
            locale.localeId.toLowerCase().startsWith(lang.languageCode));
      }).toList();

      // If current language not available, fall back to English
      if (!_availableLanguages.contains(_currentLanguage)) {
        _currentLanguage = _availableLanguages.isNotEmpty
            ? _availableLanguages.first
            : SpeechLanguage.english;
      }

      _updateState(SpeechState.ready);
      return true;
    } catch (e) {
      debugPrint('SpeechRecognitionService: Initialize failed: $e');
      _updateState(SpeechState.notAvailable);
      return false;
    }
  }

  /// Request microphone permission
  ///
  /// Called automatically on first use, but can be called explicitly
  /// to show permission dialog before user tries to use voice search.
  Future<bool> requestPermission() async {
    final status = await Permission.microphone.request();

    if (status.isGranted) {
      return true;
    } else if (status.isPermanentlyDenied) {
      _updateState(SpeechState.permissionDenied);
      _errorController.add(SpeechError.fromErrorCode('error_permission'));
      return false;
    }

    return false;
  }

  /// Check if microphone permission is granted
  Future<bool> hasPermission() async {
    return await Permission.microphone.isGranted;
  }

  /// Set the language for speech recognition
  void setLanguage(SpeechLanguage language) {
    if (_availableLanguages.contains(language)) {
      _currentLanguage = language;
    }
  }

  /// Start listening for speech
  ///
  /// Returns true if listening started successfully.
  Future<bool> startListening({
    SpeechLanguage? language,
    Duration? listenFor,
    Duration? pauseFor,
  }) async {
    // Check permission first
    if (!await hasPermission()) {
      final granted = await requestPermission();
      if (!granted) {
        return false;
      }
    }

    // Initialize if needed
    if (_state == SpeechState.uninitialized) {
      final initialized = await initialize();
      if (!initialized) {
        return false;
      }
    }

    if (_state == SpeechState.notAvailable ||
        _state == SpeechState.permissionDenied) {
      return false;
    }

    // Stop any existing session
    if (_state == SpeechState.listening) {
      await stopListening();
    }

    final lang = language ?? _currentLanguage;

    try {
      _updateState(SpeechState.listening);

      await _speech.listen(
        onResult: _handleResult,
        localeId: lang.localeId,
        listenFor: listenFor ?? const Duration(seconds: 30),
        pauseFor: pauseFor ?? const Duration(seconds: 3),
        onSoundLevelChange: _handleSoundLevel,
        listenOptions: SpeechListenOptions(
          partialResults: true,
          cancelOnError: false,
          listenMode: ListenMode.search,
        ),
      );

      return true;
    } catch (e) {
      debugPrint('SpeechRecognitionService: Start listening failed: $e');
      _updateState(SpeechState.error);
      _errorController.add(const SpeechError(
        message: 'Could not start voice search',
        isRetryable: true,
      ));
      return false;
    }
  }

  /// Stop listening for speech
  Future<void> stopListening() async {
    if (_state != SpeechState.listening) return;

    try {
      _updateState(SpeechState.processing);
      await _speech.stop();
      _updateState(SpeechState.ready);
    } catch (e) {
      debugPrint('SpeechRecognitionService: Stop listening failed: $e');
      _updateState(SpeechState.ready);
    }
  }

  /// Cancel listening without processing
  Future<void> cancelListening() async {
    try {
      await _speech.cancel();
      _updateState(SpeechState.ready);
    } catch (e) {
      debugPrint('SpeechRecognitionService: Cancel listening failed: $e');
      _updateState(SpeechState.ready);
    }
  }

  /// Handle speech recognition result
  void _handleResult(SpeechRecognitionResult result) {
    final speechResult = SpeechResult(
      text: result.recognizedWords,
      confidence: result.confidence,
      isFinal: result.finalResult,
      alternates: result.alternates.map((a) => a.recognizedWords).toList(),
    );

    _resultController.add(speechResult);

    if (result.finalResult) {
      _updateState(SpeechState.ready);
    }
  }

  /// Handle speech recognition error
  void _handleError(SpeechRecognitionError error) {
    debugPrint('SpeechRecognitionService: Error: ${error.errorMsg}');

    final speechError = SpeechError.fromErrorCode(error.errorMsg);
    _errorController.add(speechError);

    if (!speechError.isRetryable) {
      _updateState(SpeechState.error);
    } else {
      _updateState(SpeechState.ready);
    }
  }

  /// Handle status changes
  void _handleStatus(String status) {
    debugPrint('SpeechRecognitionService: Status: $status');

    switch (status) {
      case 'listening':
        _updateState(SpeechState.listening);
      case 'notListening':
        if (_state == SpeechState.listening) {
          _updateState(SpeechState.processing);
        }
      case 'done':
        _updateState(SpeechState.ready);
    }
  }

  /// Handle sound level changes for waveform visualization
  void _handleSoundLevel(double level) {
    // Normalize to 0.0 - 1.0 range
    // Speech-to-text returns dB values, typically -2 to 10
    final normalized = ((level + 2) / 12).clamp(0.0, 1.0);
    _soundLevelController.add(normalized);
  }

  void _updateState(SpeechState newState) {
    if (_state != newState) {
      _state = newState;
      _stateController.add(newState);
    }
  }

  /// Dispose of resources
  void dispose() {
    _speech.cancel();
    _stateController.close();
    _resultController.close();
    _errorController.close();
    _soundLevelController.close();
  }
}

/// Extension for easy access to speech recognition
extension SpeechRecognitionContext on SpeechRecognitionService {
  /// Quick method to listen and get a single result
  Future<String?> listenOnce({
    SpeechLanguage? language,
    Duration timeout = const Duration(seconds: 10),
  }) async {
    final completer = Completer<String?>();
    StreamSubscription<SpeechResult>? resultSub;
    StreamSubscription<SpeechError>? errorSub;
    Timer? timeoutTimer;

    void cleanup() {
      resultSub?.cancel();
      errorSub?.cancel();
      timeoutTimer?.cancel();
    }

    resultSub = resultStream.listen((result) {
      if (result.isFinal && result.text.isNotEmpty) {
        cleanup();
        if (!completer.isCompleted) {
          completer.complete(result.text);
        }
      }
    });

    errorSub = errorStream.listen((error) {
      if (!error.isRetryable) {
        cleanup();
        if (!completer.isCompleted) {
          completer.complete(null);
        }
      }
    });

    timeoutTimer = Timer(timeout, () {
      cleanup();
      stopListening();
      if (!completer.isCompleted) {
        completer.complete(null);
      }
    });

    final started = await startListening(language: language);
    if (!started) {
      cleanup();
      return null;
    }

    return completer.future;
  }
}
