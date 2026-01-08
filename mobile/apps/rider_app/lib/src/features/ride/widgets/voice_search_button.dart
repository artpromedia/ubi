import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/services/haptic_service.dart';
import '../../../core/services/speech_recognition_service.dart';

/// Animated microphone button for voice search
///
/// Shows a pulsing animation when listening, and responds to tap to
/// toggle voice search on/off.
class VoiceSearchButton extends StatefulWidget {
  const VoiceSearchButton({
    super.key,
    this.onResult,
    this.onError,
    this.onListeningChanged,
    this.size = 48.0,
    this.iconSize = 24.0,
    this.activeColor,
    this.inactiveColor,
    this.backgroundColor,
    this.language,
  });

  /// Called when speech recognition produces a result
  final void Function(String text, bool isFinal)? onResult;

  /// Called when an error occurs
  final void Function(SpeechError error)? onError;

  /// Called when listening state changes
  final void Function(bool isListening)? onListeningChanged;

  /// Size of the button
  final double size;

  /// Size of the microphone icon
  final double iconSize;

  /// Color when actively listening
  final Color? activeColor;

  /// Color when not listening
  final Color? inactiveColor;

  /// Background color of the button
  final Color? backgroundColor;

  /// Language to use for speech recognition
  final SpeechLanguage? language;

  @override
  State<VoiceSearchButton> createState() => _VoiceSearchButtonState();
}

class _VoiceSearchButtonState extends State<VoiceSearchButton>
    with SingleTickerProviderStateMixin {
  final _speechService = SpeechRecognitionService.instance;

  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  StreamSubscription<SpeechState>? _stateSub;
  StreamSubscription<SpeechResult>? _resultSub;
  StreamSubscription<SpeechError>? _errorSub;

  bool _isListening = false;
  bool _isInitializing = false;

  @override
  void initState() {
    super.initState();

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );

    _pulseAnimation = Tween<double>(begin: 1.0, end: 1.3).animate(
      CurvedAnimation(
        parent: _pulseController,
        curve: Curves.easeInOut,
      ),
    );

    _setupListeners();
  }

  void _setupListeners() {
    _stateSub = _speechService.stateStream.listen((state) {
      final listening = state == SpeechState.listening;
      if (listening != _isListening) {
        setState(() => _isListening = listening);
        widget.onListeningChanged?.call(listening);

        if (listening) {
          _pulseController.repeat(reverse: true);
        } else {
          _pulseController.stop();
          _pulseController.reset();
        }
      }
    });

    _resultSub = _speechService.resultStream.listen((result) {
      widget.onResult?.call(result.text, result.isFinal);
    });

    _errorSub = _speechService.errorStream.listen((error) {
      widget.onError?.call(error);
    });
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _stateSub?.cancel();
    _resultSub?.cancel();
    _errorSub?.cancel();
    super.dispose();
  }

  Future<void> _toggleListening() async {
    HapticService.instance.trigger(HapticType.light);

    if (_isListening) {
      await _speechService.stopListening();
    } else {
      setState(() => _isInitializing = true);

      final started = await _speechService.startListening(
        language: widget.language,
      );

      setState(() => _isInitializing = false);

      if (!started && mounted) {
        final state = _speechService.state;
        if (state == SpeechState.permissionDenied) {
          widget.onError?.call(SpeechError.fromErrorCode('error_permission'));
        } else if (state == SpeechState.notAvailable) {
          widget.onError?.call(const SpeechError(
            message: 'Voice search not available on this device',
            isRetryable: false,
          ));
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    final activeColor = widget.activeColor ?? colorScheme.primary;
    final inactiveColor =
        widget.inactiveColor ?? colorScheme.onSurfaceVariant;
    final backgroundColor = widget.backgroundColor ??
        (_isListening
            ? activeColor.withOpacity(0.1)
            : colorScheme.surfaceContainerHighest);

    return Semantics(
      label: _isListening ? 'Stop voice search' : 'Start voice search',
      button: true,
      child: GestureDetector(
        onTap: _isInitializing ? null : _toggleListening,
        child: AnimatedBuilder(
          animation: _pulseAnimation,
          builder: (context, child) {
            final scale = _isListening ? _pulseAnimation.value : 1.0;

            return Transform.scale(
              scale: scale,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                width: widget.size,
                height: widget.size,
                decoration: BoxDecoration(
                  color: backgroundColor,
                  shape: BoxShape.circle,
                  boxShadow: _isListening
                      ? [
                          BoxShadow(
                            color: activeColor.withOpacity(0.3),
                            blurRadius: 12,
                            spreadRadius: 2,
                          ),
                        ]
                      : null,
                ),
                child: Center(
                  child: _isInitializing
                      ? SizedBox(
                          width: widget.iconSize,
                          height: widget.iconSize,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: inactiveColor,
                          ),
                        )
                      : Icon(
                          _isListening ? Icons.mic : Icons.mic_none,
                          size: widget.iconSize,
                          color: _isListening ? activeColor : inactiveColor,
                        ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

/// A smaller inline voice search button for text fields
class VoiceSearchIconButton extends StatelessWidget {
  const VoiceSearchIconButton({
    super.key,
    required this.onTap,
    this.isListening = false,
    this.size = 24.0,
    this.activeColor,
    this.inactiveColor,
  });

  final VoidCallback onTap;
  final bool isListening;
  final double size;
  final Color? activeColor;
  final Color? inactiveColor;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    final active = activeColor ?? colorScheme.primary;
    final inactive = inactiveColor ?? colorScheme.onSurfaceVariant;

    return Semantics(
      label: isListening ? 'Stop voice search' : 'Voice search',
      button: true,
      child: GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: isListening ? active.withOpacity(0.1) : Colors.transparent,
            shape: BoxShape.circle,
          ),
          child: Icon(
            isListening ? Icons.mic : Icons.mic_none,
            size: size,
            color: isListening ? active : inactive,
          ),
        ),
      ),
    );
  }
}
