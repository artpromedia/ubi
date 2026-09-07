/// Light and dark [ThemeData] built entirely from the semantic tokens.
///
/// The rider app ships light-default, the driver app dark-default, and both
/// are switchable (CLAUDE.md rule 10). Nothing here reads a colour that is not
/// in [UbiSemanticColors].
library;

import 'package:flutter/material.dart';

import 'ubi_semantic_colors.dart';
import 'ubi_token_scale.dart';
import 'ubi_token_typography.dart';

/// Which app's default a [ThemeMode] should fall back to.
enum UbiApp {
  /// Rider ships light-default.
  rider(ThemeMode.light),

  /// Driver ships dark-default.
  driver(ThemeMode.dark);

  const UbiApp(this.defaultThemeMode);

  final ThemeMode defaultThemeMode;
}

abstract final class UbiTokenTheme {
  static ThemeData get light => _build(UbiSemanticColors.light, Brightness.light);

  static ThemeData get dark => _build(UbiSemanticColors.dark, Brightness.dark);

  /// The theme for a [Brightness], so a switcher does not need a conditional.
  static ThemeData forBrightness(Brightness brightness) =>
      brightness == Brightness.dark ? dark : light;

  static ThemeData _build(UbiSemanticColors c, Brightness brightness) {
    final ColorScheme scheme = brightness == Brightness.dark
        ? ColorScheme.dark(
            primary: c.move,
            onPrimary: c.onPrimaryButton,
            secondary: c.travel,
            onSecondary: c.ink,
            error: c.error,
            onError: c.bg,
            surface: c.surface,
            onSurface: c.ink,
          )
        : ColorScheme.light(
            primary: c.move,
            onPrimary: c.onPrimaryButton,
            secondary: c.travel,
            onSecondary: c.bg,
            error: c.error,
            onError: c.bg,
            surface: c.surface,
            onSurface: c.ink,
          );

    final TextTheme text = UbiTokenTypography.textTheme(c.ink);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: c.bg,
      canvasColor: c.bg,
      dividerColor: c.divider,
      textTheme: text,
      primaryColor: c.move,
      extensions: <ThemeExtension<dynamic>>[c],
      appBarTheme: AppBarTheme(
        backgroundColor: c.bg,
        foregroundColor: c.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: UbiTokenTypography.headlineSmall.copyWith(color: c.ink),
      ),
      dividerTheme: DividerThemeData(
        color: c.divider,
        thickness: 1,
        space: 1,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: c.surface,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: c.surface,
        showDragHandle: true,
        // iOS radius by default; a sheet that knows its platform should use
        // UbiRadii.sheetBorder(Theme.of(context).platform).
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(UbiRadii.sheet),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.bg2,
        hintStyle: UbiTokenTypography.bodyMedium.copyWith(color: c.text3),
        labelStyle: UbiTokenTypography.bodyMedium.copyWith(color: c.text2),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: UbiSpace.x4,
          vertical: UbiSpace.x4,
        ),
        border: OutlineInputBorder(
          borderRadius: UbiRadii.controlBorder,
          borderSide: BorderSide(color: c.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: UbiRadii.controlBorder,
          borderSide: BorderSide(color: c.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: UbiRadii.controlBorder,
          borderSide: BorderSide(color: c.move, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: UbiRadii.controlBorder,
          borderSide: BorderSide(color: c.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: UbiRadii.controlBorder,
          borderSide: BorderSide(color: c.error, width: 2),
        ),
        errorStyle: UbiTokenTypography.bodySmall.copyWith(color: c.errorInk),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: c.primaryButton,
          foregroundColor: c.onPrimaryButton,
          disabledBackgroundColor: c.primaryButtonDisabled,
          disabledForegroundColor: c.onPrimaryButtonDisabled,
          minimumSize: const Size(UbiTargets.android, UbiTargets.primaryButton),
          textStyle: UbiTokenTypography.labelLarge,
          shape: const RoundedRectangleBorder(
            borderRadius: UbiRadii.controlBorder,
          ),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: c.primaryButton,
          foregroundColor: c.onPrimaryButton,
          disabledBackgroundColor: c.primaryButtonDisabled,
          disabledForegroundColor: c.onPrimaryButtonDisabled,
          elevation: 0,
          minimumSize: const Size(UbiTargets.android, UbiTargets.primaryButton),
          textStyle: UbiTokenTypography.labelLarge,
          shape: const RoundedRectangleBorder(
            borderRadius: UbiRadii.controlBorder,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: c.ink,
          side: BorderSide(color: c.border),
          minimumSize:
              const Size(UbiTargets.android, UbiTargets.primaryButtonCompact),
          textStyle: UbiTokenTypography.labelLarge,
          shape: const RoundedRectangleBorder(
            borderRadius: UbiRadii.controlBorder,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: c.link,
          minimumSize: Size(UbiTargets.android, UbiTargets.android),
          textStyle: UbiTokenTypography.labelLarge,
        ),
      ),
      listTileTheme: ListTileThemeData(
        minVerticalPadding: UbiSpace.x3,
        iconColor: c.text2,
        textColor: c.ink,
        subtitleTextStyle:
            UbiTokenTypography.bodySmall.copyWith(color: c.text2),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: c.surface,
        contentTextStyle:
            UbiTokenTypography.bodyMedium.copyWith(color: c.ink),
        behavior: SnackBarBehavior.floating,
        shape: const RoundedRectangleBorder(
          borderRadius: UbiRadii.cardBorder,
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: c.move),
    );
  }
}
