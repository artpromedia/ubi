import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'ubi_colors.dart';

/// UBI Typography System
///
/// Typography designed for:
/// - Readability on various screen sizes
/// - Clear hierarchy
/// - African language support (Latin extended + Arabic script)
/// - Accessibility (minimum 16sp body text)
abstract final class UbiTypography {
  // === Font Families ===
  
  /// Headline font - Poppins (Bold, geometric, modern)
  static String get headlineFamily => GoogleFonts.poppins().fontFamily!;
  
  /// Body font - Inter (Highly legible, optimized for screens)
  static String get bodyFamily => GoogleFonts.inter().fontFamily!;
  
  /// Mono font - JetBrains Mono (For prices, codes)
  static String get monoFamily => GoogleFonts.jetBrainsMono().fontFamily!;
  
  // === Text Theme for Light Mode ===
  
  static TextTheme get lightTextTheme => TextTheme(
    // Display styles (for hero sections, splash screens)
    displayLarge: _displayLarge,
    displayMedium: _displayMedium,
    displaySmall: _displaySmall,
    
    // Headlines (for section headers)
    headlineLarge: _headlineLarge,
    headlineMedium: _headlineMedium,
    headlineSmall: _headlineSmall,
    
    // Titles (for cards, dialogs)
    titleLarge: _titleLarge,
    titleMedium: _titleMedium,
    titleSmall: _titleSmall,
    
    // Body text
    bodyLarge: _bodyLarge,
    bodyMedium: _bodyMedium,
    bodySmall: _bodySmall,
    
    // Labels (for buttons, captions)
    labelLarge: _labelLarge,
    labelMedium: _labelMedium,
    labelSmall: _labelSmall,
  );
  
  static TextTheme get darkTextTheme => lightTextTheme.apply(
    bodyColor: UbiColors.gray100,
    displayColor: UbiColors.gray100,
  );
  
  // === Display Styles ===
  
  static final TextStyle _displayLarge = GoogleFonts.poppins(
    fontSize: 57,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.25,
    height: 1.12,
    color: UbiColors.gray900,
  );
  
  static final TextStyle _displayMedium = GoogleFonts.poppins(
    fontSize: 45,
    fontWeight: FontWeight.w700,
    letterSpacing: 0,
    height: 1.16,
    color: UbiColors.gray900,
  );
  
  static final TextStyle _displaySmall = GoogleFonts.poppins(
    fontSize: 36,
    fontWeight: FontWeight.w600,
    letterSpacing: 0,
    height: 1.22,
    color: UbiColors.gray900,
  );
  
  // === Headline Styles ===
  
  static final TextStyle _headlineLarge = GoogleFonts.poppins(
    fontSize: 32,
    fontWeight: FontWeight.w600,
    letterSpacing: 0,
    height: 1.25,
    color: UbiColors.gray900,
  );
  
  static final TextStyle _headlineMedium = GoogleFonts.poppins(
    fontSize: 28,
    fontWeight: FontWeight.w600,
    letterSpacing: 0,
    height: 1.29,
    color: UbiColors.gray900,
  );
  
  static final TextStyle _headlineSmall = GoogleFonts.poppins(
    fontSize: 24,
    fontWeight: FontWeight.w600,
    letterSpacing: 0,
    height: 1.33,
    color: UbiColors.gray900,
  );
  
  // === Title Styles ===
  
  static final TextStyle _titleLarge = GoogleFonts.poppins(
    fontSize: 22,
    fontWeight: FontWeight.w600,
    letterSpacing: 0,
    height: 1.27,
    color: UbiColors.gray900,
  );
  
  static final TextStyle _titleMedium = GoogleFonts.inter(
    fontSize: 16,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.15,
    height: 1.5,
    color: UbiColors.gray900,
  );
  
  static final TextStyle _titleSmall = GoogleFonts.inter(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
    height: 1.43,
    color: UbiColors.gray900,
  );
  
  // === Body Styles ===
  
  static final TextStyle _bodyLarge = GoogleFonts.inter(
    fontSize: 16,
    fontWeight: FontWeight.w400,
    letterSpacing: 0.5,
    height: 1.5,
    color: UbiColors.gray700,
  );
  
  static final TextStyle _bodyMedium = GoogleFonts.inter(
    fontSize: 14,
    fontWeight: FontWeight.w400,
    letterSpacing: 0.25,
    height: 1.43,
    color: UbiColors.gray700,
  );
  
  static final TextStyle _bodySmall = GoogleFonts.inter(
    fontSize: 12,
    fontWeight: FontWeight.w400,
    letterSpacing: 0.4,
    height: 1.33,
    color: UbiColors.gray600,
  );
  
  // === Label Styles ===
  
  static final TextStyle _labelLarge = GoogleFonts.inter(
    fontSize: 14,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
    height: 1.43,
    color: UbiColors.gray900,
  );
  
  static final TextStyle _labelMedium = GoogleFonts.inter(
    fontSize: 12,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.5,
    height: 1.33,
    color: UbiColors.gray700,
  );
  
  static final TextStyle _labelSmall = GoogleFonts.inter(
    fontSize: 11,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.5,
    height: 1.45,
    color: UbiColors.gray600,
  );
  
  // === Custom Text Styles ===
  
  /// Price style - monospace for alignment
  static TextStyle price({
    double fontSize = 24,
    FontWeight fontWeight = FontWeight.w700,
    Color color = UbiColors.gray900,
  }) {
    return GoogleFonts.jetBrainsMono(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color,
      letterSpacing: -0.5,
    );
  }
  
  /// Currency symbol style
  static TextStyle currency({
    double fontSize = 16,
    Color color = UbiColors.gray600,
  }) {
    return GoogleFonts.inter(
      fontSize: fontSize,
      fontWeight: FontWeight.w500,
      color: color,
    );
  }
  
  /// Button text style
  static TextStyle button({
    double fontSize = 16,
    FontWeight fontWeight = FontWeight.w600,
    Color color = UbiColors.ubiWhite,
  }) {
    return GoogleFonts.inter(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color,
      letterSpacing: 0.5,
      height: 1.25,
    );
  }
  
  /// Link text style
  static TextStyle link({
    double fontSize = 14,
    Color color = UbiColors.ubiGreen,
  }) {
    return GoogleFonts.inter(
      fontSize: fontSize,
      fontWeight: FontWeight.w600,
      color: color,
      decoration: TextDecoration.underline,
      decorationColor: color,
    );
  }
  
  /// Caption style
  static TextStyle caption({
    Color color = UbiColors.gray500,
  }) {
    return GoogleFonts.inter(
      fontSize: 12,
      fontWeight: FontWeight.w400,
      color: color,
      letterSpacing: 0.4,
      height: 1.33,
    );
  }
  
  /// Overline style (all caps labels)
  static TextStyle overline({
    Color color = UbiColors.gray500,
  }) {
    return GoogleFonts.inter(
      fontSize: 10,
      fontWeight: FontWeight.w600,
      color: color,
      letterSpacing: 1.5,
      height: 1.6,
    );
  }
  
  /// ETA/Time style
  static TextStyle eta({
    double fontSize = 32,
    Color color = UbiColors.gray900,
  }) {
    return GoogleFonts.poppins(
      fontSize: fontSize,
      fontWeight: FontWeight.w700,
      color: color,
      letterSpacing: -0.5,
    );
  }
  
  /// Rating style
  static TextStyle rating({
    double fontSize = 14,
    Color color = UbiColors.gray900,
  }) {
    return GoogleFonts.inter(
      fontSize: fontSize,
      fontWeight: FontWeight.w600,
      color: color,
    );
  }
}

/// Extension for easy text style access
extension UbiTypographyExtension on BuildContext {
  /// Quick access to text theme
  TextTheme get textTheme => Theme.of(this).textTheme;
  
  /// Display large
  TextStyle get displayLarge => textTheme.displayLarge!;
  
  /// Display medium
  TextStyle get displayMedium => textTheme.displayMedium!;
  
  /// Display small
  TextStyle get displaySmall => textTheme.displaySmall!;
  
  /// Headline large
  TextStyle get headlineLarge => textTheme.headlineLarge!;
  
  /// Headline medium
  TextStyle get headlineMedium => textTheme.headlineMedium!;
  
  /// Headline small
  TextStyle get headlineSmall => textTheme.headlineSmall!;
  
  /// Title large
  TextStyle get titleLarge => textTheme.titleLarge!;
  
  /// Title medium
  TextStyle get titleMedium => textTheme.titleMedium!;
  
  /// Title small
  TextStyle get titleSmall => textTheme.titleSmall!;
  
  /// Body large
  TextStyle get bodyLarge => textTheme.bodyLarge!;
  
  /// Body medium
  TextStyle get bodyMedium => textTheme.bodyMedium!;
  
  /// Body small
  TextStyle get bodySmall => textTheme.bodySmall!;
  
  /// Label large
  TextStyle get labelLarge => textTheme.labelLarge!;
  
  /// Label medium
  TextStyle get labelMedium => textTheme.labelMedium!;
  
  /// Label small
  TextStyle get labelSmall => textTheme.labelSmall!;
}
