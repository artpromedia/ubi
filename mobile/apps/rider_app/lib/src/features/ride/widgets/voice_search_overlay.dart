import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/services/haptic_service.dart';
import '../../../core/services/speech_recognition_service.dart';

/// Full-screen voice search overlay with waveform visualization
///
/// Shows real-time transcription and audio waveform while listening.
class VoiceSearchOverlay extends StatefulWidget {
  const VoiceSearchOverlay({
    super.key,
    required this.onResult,
    this.onCancel,
    this.language,
    this.hintText = 'Say your destination...',
  });

  /// Called when a final speech result is received
  final void Function(String text) onResult;

  /// Called when user cancels voice search
  final VoidCallback? onCancel;

  /// Language for speech recognition
  final SpeechLanguage? language;

  /// Hint text shown before user starts speaking
  final String hintText;

  /// Show the voice search overlay as a modal
  static Future<String?> show(
    BuildContext context, {
    SpeechLanguage? language,
    String? hintText,
  }) async {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => VoiceSearchOverlay(
        language: language,
        hintText: hintText ?? 'Say your destination...',
        onResult: (text) => Navigator.of(context).pop(text),
        onCancel: () => Navigator.of(context).pop(),
      ),
    );
  }

  @override
  State<VoiceSearchOverlay> createState() => _VoiceSearchOverlayState();
}

class _VoiceSearchOverlayState extends State<VoiceSearchOverlay>
    with TickerProviderStateMixin {
  final _speechService = SpeechRecognitionService.instance;

  late AnimationController _waveController;
  late AnimationController _pulseController;

  StreamSubscription<SpeechState>? _stateSub;
  StreamSubscription<SpeechResult>? _resultSub;
  StreamSubscription<SpeechError>? _errorSub;
  StreamSubscription<double>? _soundLevelSub;

  SpeechState _state = SpeechState.uninitialized;
  String _transcription = '';
  String? _errorMessage;
  double _soundLevel = 0.0;
  final List<double> _soundLevelHistory = List.filled(30, 0.0);

  @override
  void initState() {
    super.initState();

    _waveController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 100),
    );

    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat(reverse: true);

    _setupListeners();
    _startListening();
  }

  void _setupListeners() {
    _stateSub = _speechService.stateStream.listen((state) {
      setState(() => _state = state);
    });

    _resultSub = _speechService.resultStream.listen((result) {
      setState(() {
        _transcription = result.text;
        _errorMessage = null;
      });

      if (result.isFinal && result.text.isNotEmpty) {
        HapticService.instance.trigger(HapticType.success);
        widget.onResult(result.text);
      }
    });

    _errorSub = _speechService.errorStream.listen((error) {
      setState(() => _errorMessage = error.message);
      HapticService.instance.trigger(HapticType.error);

      if (error.isRetryable) {
        // Auto-retry after a short delay
        Future.delayed(const Duration(seconds: 2), () {
          if (mounted && _state != SpeechState.listening) {
            _startListening();
          }
        });
      }
    });

    _soundLevelSub = _speechService.soundLevelStream.listen((level) {
      setState(() {
        _soundLevel = level;
        _soundLevelHistory.removeAt(0);
        _soundLevelHistory.add(level);
      });
    });
  }

  Future<void> _startListening() async {
    setState(() {
      _transcription = '';
      _errorMessage = null;
    });

    await _speechService.startListening(language: widget.language);
  }

  Future<void> _stopListening() async {
    await _speechService.stopListening();
  }

  void _cancel() {
    _speechService.cancelListening();
    widget.onCancel?.call();
  }

  void _retry() {
    setState(() => _errorMessage = null);
    _startListening();
  }

  @override
  void dispose() {
    _waveController.dispose();
    _pulseController.dispose();
    _stateSub?.cancel();
    _resultSub?.cancel();
    _errorSub?.cancel();
    _soundLevelSub?.cancel();
    _speechService.cancelListening();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;
    final size = MediaQuery.of(context).size;

    return Container(
      height: size.height * 0.6,
      decoration: BoxDecoration(
        color: colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SafeArea(
        child: Column(
          children: [
            // Handle bar
            Container(
              margin: const EdgeInsets.only(top: 12),
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: colorScheme.outlineVariant,
                borderRadius: BorderRadius.circular(2),
              ),
            ),

            // Header
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Voice Search',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  IconButton(
                    onPressed: _cancel,
                    icon: const Icon(Icons.close),
                    style: IconButton.styleFrom(
                      backgroundColor: colorScheme.surfaceContainerHighest,
                    ),
                  ),
                ],
              ),
            ),

            // Main content area
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Waveform visualization
                  _WaveformVisualizer(
                    soundLevels: _soundLevelHistory,
                    isListening: _state == SpeechState.listening,
                    primaryColor: colorScheme.primary,
                  ),

                  const SizedBox(height: 32),

                  // Transcription or hint
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 200),
                      child: _errorMessage != null
                          ? _ErrorDisplay(
                              message: _errorMessage!,
                              onRetry: _retry,
                            )
                          : Text(
                              _transcription.isEmpty
                                  ? widget.hintText
                                  : _transcription,
                              key: ValueKey(_transcription.isEmpty),
                              textAlign: TextAlign.center,
                              style: theme.textTheme.headlineSmall?.copyWith(
                                color: _transcription.isEmpty
                                    ? colorScheme.onSurfaceVariant
                                    : colorScheme.onSurface,
                                fontWeight: _transcription.isEmpty
                                    ? FontWeight.normal
                                    : FontWeight.w500,
                              ),
                            ),
                    ),
                  ),

                  const SizedBox(height: 32),

                  // Status indicator
                  _StatusIndicator(state: _state),
                ],
              ),
            ),

            // Bottom controls
            Padding(
              padding: const EdgeInsets.all(24),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Cancel button
                  TextButton(
                    onPressed: _cancel,
                    child: const Text('Cancel'),
                  ),

                  const SizedBox(width: 32),

                  // Mic button
                  _PulsingMicButton(
                    isListening: _state == SpeechState.listening,
                    pulseController: _pulseController,
                    soundLevel: _soundLevel,
                    onTap: () {
                      HapticService.instance.trigger(HapticType.medium);
                      if (_state == SpeechState.listening) {
                        _stopListening();
                      } else {
                        _startListening();
                      }
                    },
                  ),

                  const SizedBox(width: 32),

                  // Language indicator
                  _LanguageChip(
                    language: widget.language ?? _speechService.currentLanguage,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Animated waveform visualization
class _WaveformVisualizer extends StatelessWidget {
  const _WaveformVisualizer({
    required this.soundLevels,
    required this.isListening,
    required this.primaryColor,
  });

  final List<double> soundLevels;
  final bool isListening;
  final Color primaryColor;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 80,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(soundLevels.length, (index) {
          final level = soundLevels[index];
          final height = isListening ? 20 + (level * 60) : 20.0;

          return AnimatedContainer(
            duration: const Duration(milliseconds: 100),
            margin: const EdgeInsets.symmetric(horizontal: 2),
            width: 4,
            height: height,
            decoration: BoxDecoration(
              color: isListening
                  ? primaryColor.withOpacity(0.3 + (level * 0.7))
                  : primaryColor.withOpacity(0.2),
              borderRadius: BorderRadius.circular(2),
            ),
          );
        }),
      ),
    );
  }
}

/// Pulsing microphone button with sound level indicator
class _PulsingMicButton extends StatelessWidget {
  const _PulsingMicButton({
    required this.isListening,
    required this.pulseController,
    required this.soundLevel,
    required this.onTap,
  });

  final bool isListening;
  final AnimationController pulseController;
  final double soundLevel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;

    return GestureDetector(
      onTap: onTap,
      child: AnimatedBuilder(
        animation: pulseController,
        builder: (context, child) {
          final pulseScale = isListening
              ? 1.0 + (pulseController.value * 0.1) + (soundLevel * 0.2)
              : 1.0;

          return Transform.scale(
            scale: pulseScale,
            child: Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: isListening
                    ? colorScheme.primary
                    : colorScheme.surfaceContainerHighest,
                shape: BoxShape.circle,
                boxShadow: isListening
                    ? [
                        BoxShadow(
                          color: colorScheme.primary.withOpacity(0.4),
                          blurRadius: 20 + (soundLevel * 10),
                          spreadRadius: 2 + (soundLevel * 5),
                        ),
                      ]
                    : null,
              ),
              child: Icon(
                isListening ? Icons.mic : Icons.mic_none,
                size: 36,
                color: isListening
                    ? colorScheme.onPrimary
                    : colorScheme.onSurfaceVariant,
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Status indicator showing current speech recognition state
class _StatusIndicator extends StatelessWidget {
  const _StatusIndicator({required this.state});

  final SpeechState state;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    String text;
    Color color;

    switch (state) {
      case SpeechState.listening:
        text = 'Listening...';
        color = colorScheme.primary;
      case SpeechState.processing:
        text = 'Processing...';
        color = colorScheme.secondary;
      case SpeechState.ready:
        text = 'Tap mic to speak';
        color = colorScheme.onSurfaceVariant;
      case SpeechState.error:
        text = 'Error occurred';
        color = colorScheme.error;
      case SpeechState.permissionDenied:
        text = 'Microphone permission required';
        color = colorScheme.error;
      case SpeechState.notAvailable:
        text = 'Voice search not available';
        color = colorScheme.error;
      case SpeechState.uninitialized:
        text = 'Initializing...';
        color = colorScheme.onSurfaceVariant;
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (state == SpeechState.listening)
          Container(
            margin: const EdgeInsets.only(right: 8),
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: colorScheme.primary,
              shape: BoxShape.circle,
            ),
          ),
        Text(
          text,
          style: theme.textTheme.bodyMedium?.copyWith(color: color),
        ),
      ],
    );
  }
}

/// Error display with retry button
class _ErrorDisplay extends StatelessWidget {
  const _ErrorDisplay({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          Icons.error_outline,
          size: 48,
          color: colorScheme.error,
        ),
        const SizedBox(height: 16),
        Text(
          message,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyLarge?.copyWith(
            color: colorScheme.error,
          ),
        ),
        const SizedBox(height: 16),
        FilledButton.tonal(
          onPressed: onRetry,
          child: const Text('Try Again'),
        ),
      ],
    );
  }
}

/// Chip showing current language
class _LanguageChip extends StatelessWidget {
  const _LanguageChip({required this.language});

  final SpeechLanguage language;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.language,
            size: 16,
            color: colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 4),
          Text(
            language.languageCode.toUpperCase(),
            style: theme.textTheme.labelSmall?.copyWith(
              color: colorScheme.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
