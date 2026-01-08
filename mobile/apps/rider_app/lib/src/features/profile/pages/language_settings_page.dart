import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/services/speech_recognition_service.dart';

/// Language settings page for app and voice search language selection
class LanguageSettingsPage extends StatefulWidget {
  const LanguageSettingsPage({super.key});

  @override
  State<LanguageSettingsPage> createState() => _LanguageSettingsPageState();
}

class _LanguageSettingsPageState extends State<LanguageSettingsPage> {
  final _speechService = SpeechRecognitionService.instance;

  String _appLanguage = 'en';
  SpeechLanguage _voiceLanguage = SpeechLanguage.english;
  bool _autoDetectVoice = true;
  bool _speechAvailable = false;
  List<SpeechLanguage> _availableVoiceLanguages = [];

  @override
  void initState() {
    super.initState();
    _initSpeech();
  }

  Future<void> _initSpeech() async {
    final available = await _speechService.initialize();
    if (mounted) {
      setState(() {
        _speechAvailable = available;
        _availableVoiceLanguages = _speechService.availableLanguages;
        _voiceLanguage = _speechService.currentLanguage;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Language Settings'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: ListView(
        children: [
          // App Language Section
          const _SectionHeader(
            title: 'App Language',
            subtitle: 'Choose the language for the app interface',
          ),
          ...AppLanguage.values.map((lang) => _LanguageTile(
                title: lang.displayName,
                subtitle: lang.nativeName,
                isSelected: _appLanguage == lang.code,
                onTap: () => _setAppLanguage(lang.code),
              )),

          const Divider(height: 32),

          // Voice Search Language Section
          _SectionHeader(
            title: 'Voice Search Language',
            subtitle: _speechAvailable
                ? 'Choose the language for voice search'
                : 'Voice search not available on this device',
          ),

          if (_speechAvailable) ...[
            // Auto-detect toggle
            SwitchListTile(
              title: const Text('Auto-detect language'),
              subtitle: const Text('Use the same language as the app'),
              value: _autoDetectVoice,
              onChanged: (value) {
                setState(() => _autoDetectVoice = value);
                if (value) {
                  _syncVoiceLanguageWithApp();
                }
              },
            ),

            // Manual language selection
            if (!_autoDetectVoice) ...[
              const SizedBox(height: 8),
              ...SpeechLanguage.values.map((lang) {
                final isAvailable = _availableVoiceLanguages.contains(lang);
                return _LanguageTile(
                  title: lang.displayName,
                  subtitle: isAvailable
                      ? 'Available for voice search'
                      : 'Not available on this device',
                  isSelected: _voiceLanguage == lang,
                  isEnabled: isAvailable,
                  trailing: isAvailable
                      ? null
                      : Icon(
                          Icons.cloud_off,
                          size: 20,
                          color: colorScheme.outline,
                        ),
                  onTap: isAvailable ? () => _setVoiceLanguage(lang) : null,
                );
              }),
            ],
          ] else ...[
            // Voice search unavailable message
            Padding(
              padding: const EdgeInsets.all(16),
              child: Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: colorScheme.errorContainer.withOpacity(0.3),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.mic_off,
                      color: colorScheme.error,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Voice search requires speech recognition support which is not available on this device.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: colorScheme.onErrorContainer,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],

          const Divider(height: 32),

          // Supported Languages Info
          const _SectionHeader(
            title: 'Supported Languages',
            subtitle: 'Languages available for voice search in target markets',
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: SpeechLanguage.values.map((lang) {
                final isAvailable = _availableVoiceLanguages.contains(lang);
                return Chip(
                  avatar: Icon(
                    isAvailable ? Icons.check_circle : Icons.circle_outlined,
                    size: 18,
                    color: isAvailable
                        ? colorScheme.primary
                        : colorScheme.outline,
                  ),
                  label: Text(lang.displayName),
                  backgroundColor: isAvailable
                      ? colorScheme.primaryContainer.withOpacity(0.3)
                      : colorScheme.surfaceContainerHighest,
                );
              }).toList(),
            ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }

  void _setAppLanguage(String code) {
    setState(() => _appLanguage = code);
    // TODO: Persist and apply app language change
    if (_autoDetectVoice) {
      _syncVoiceLanguageWithApp();
    }
  }

  void _setVoiceLanguage(SpeechLanguage lang) {
    setState(() => _voiceLanguage = lang);
    _speechService.setLanguage(lang);
  }

  void _syncVoiceLanguageWithApp() {
    final voiceLang = SpeechLanguage.fromLanguageCode(_appLanguage);
    if (_availableVoiceLanguages.contains(voiceLang)) {
      _setVoiceLanguage(voiceLang);
    }
  }
}

/// App languages supported
enum AppLanguage {
  english('en', 'English', 'English'),
  swahili('sw', 'Swahili', 'Kiswahili'),
  french('fr', 'French', 'Français'),
  hausa('ha', 'Hausa', 'Hausa'),
  yoruba('yo', 'Yoruba', 'Yorùbá'),
  igbo('ig', 'Igbo', 'Igbo');

  const AppLanguage(this.code, this.displayName, this.nativeName);

  final String code;
  final String displayName;
  final String nativeName;
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.title,
    required this.subtitle,
  });

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

class _LanguageTile extends StatelessWidget {
  const _LanguageTile({
    required this.title,
    required this.subtitle,
    required this.isSelected,
    this.isEnabled = true,
    this.trailing,
    this.onTap,
  });

  final String title;
  final String subtitle;
  final bool isSelected;
  final bool isEnabled;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return ListTile(
      enabled: isEnabled,
      title: Text(
        title,
        style: TextStyle(
          fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
          color: isEnabled ? null : colorScheme.outline,
        ),
      ),
      subtitle: Text(
        subtitle,
        style: TextStyle(
          color: isEnabled
              ? colorScheme.onSurfaceVariant
              : colorScheme.outline.withOpacity(0.7),
        ),
      ),
      trailing: trailing ??
          (isSelected
              ? Icon(
                  Icons.check_circle,
                  color: colorScheme.primary,
                )
              : null),
      onTap: onTap,
    );
  }
}
