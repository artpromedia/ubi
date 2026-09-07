/// Type scale from `contracts/semantic-tokens.json` (`font`).
///
/// Poppins 600/700 for headings, Inter 400/500/600/700 for body, a monospace
/// face for plates, references and PNRs. Money is always tabular so digits do
/// not shift between frames (CLAUDE.md rule 11).
library;

import 'dart:ui' show FontFeature;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'ubi_token_scale.dart';

abstract final class UbiTokenTypography {
  /// Digits that occupy the same advance width whatever they are. Required for
  /// money, counters and timers.
  static const List<FontFeature> tabular = <FontFeature>[
    FontFeature.tabularFigures(),
  ];

  static TextStyle _heading(double size, FontWeight weight, double height) =>
      GoogleFonts.poppins(fontSize: size, fontWeight: weight, height: height);

  static TextStyle _body(double size, FontWeight weight, double height) =>
      GoogleFonts.inter(fontSize: size, fontWeight: weight, height: height);

  /// Poppins 700.
  static TextStyle get displayLarge => _heading(34, FontWeight.w700, 1.15);
  static TextStyle get displayMedium => _heading(28, FontWeight.w700, 1.18);
  static TextStyle get displaySmall => _heading(24, FontWeight.w600, 1.2);

  /// Poppins 600.
  static TextStyle get headlineLarge => _heading(22, FontWeight.w600, 1.25);
  static TextStyle get headlineMedium => _heading(20, FontWeight.w600, 1.27);
  static TextStyle get headlineSmall => _heading(18, FontWeight.w600, 1.3);

  static TextStyle get titleLarge => _heading(17, FontWeight.w600, 1.3);
  static TextStyle get titleMedium => _body(16, FontWeight.w600, 1.35);
  static TextStyle get titleSmall => _body(14, FontWeight.w600, 1.4);

  /// Inter 400/500.
  static TextStyle get bodyLarge => _body(16, FontWeight.w400, 1.5);
  static TextStyle get bodyMedium => _body(14, FontWeight.w400, 1.5);

  /// The floor from CLAUDE.md rule 11 — nothing below this ships.
  static TextStyle get bodySmall =>
      _body(UbiTargets.minBodyFontSize, FontWeight.w400, 1.45);

  static TextStyle get labelLarge => _body(15, FontWeight.w600, 1.2);
  static TextStyle get labelMedium => _body(13, FontWeight.w500, 1.2);
  static TextStyle get labelSmall =>
      _body(UbiTargets.minBodyFontSize, FontWeight.w500, 1.2);

  /// Money. Inter with tabular figures; the caller supplies the size so a fare
  /// headline and a receipt row share the same digit metrics.
  static TextStyle money({
    double fontSize = 16,
    FontWeight fontWeight = FontWeight.w600,
    Color? color,
  }) {
    return GoogleFonts.inter(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color,
      height: 1.3,
      fontFeatures: tabular,
    );
  }

  /// Plates, booking references, PNRs and delivery codes.
  ///
  /// Monospace with widened tracking so a plate is readable at a glance and
  /// reads as one unit to a screen reader.
  static TextStyle mono({
    double fontSize = 15,
    FontWeight fontWeight = FontWeight.w600,
    Color? color,
    double letterSpacing = 0.5,
  }) {
    return GoogleFonts.jetBrainsMono(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color,
      height: 1.25,
      letterSpacing: letterSpacing,
    );
  }

  /// Full text theme in one ink colour. [color] is the token `ink` for the
  /// theme; secondary colours are applied per widget.
  static TextTheme textTheme(Color color) {
    return TextTheme(
      displayLarge: displayLarge.copyWith(color: color),
      displayMedium: displayMedium.copyWith(color: color),
      displaySmall: displaySmall.copyWith(color: color),
      headlineLarge: headlineLarge.copyWith(color: color),
      headlineMedium: headlineMedium.copyWith(color: color),
      headlineSmall: headlineSmall.copyWith(color: color),
      titleLarge: titleLarge.copyWith(color: color),
      titleMedium: titleMedium.copyWith(color: color),
      titleSmall: titleSmall.copyWith(color: color),
      bodyLarge: bodyLarge.copyWith(color: color),
      bodyMedium: bodyMedium.copyWith(color: color),
      bodySmall: bodySmall.copyWith(color: color),
      labelLarge: labelLarge.copyWith(color: color),
      labelMedium: labelMedium.copyWith(color: color),
      labelSmall: labelSmall.copyWith(color: color),
    );
  }
}
