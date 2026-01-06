import 'package:flutter/material.dart';

/// UBI Brand Colors
///
/// The official UBI color palette designed for African markets.
/// Colors are optimized for:
/// - High contrast on low-brightness screens
/// - Accessibility (WCAG AA compliance)
/// - Cultural appropriateness across African regions
abstract final class UbiColors {
  // === Primary Brand Colors ===
  
  /// UBI Black - Primary brand color
  /// Used for: App bars, primary text, buttons
  static const Color ubiBlack = Color(0xFF191414);
  
  /// UBI Green - Accent color representing growth and movement
  /// Used for: CTAs, success states, highlights
  static const Color ubiGreen = Color(0xFF1DB954);
  
  /// UBI White - Background and contrast color
  /// Used for: Backgrounds, cards, inverted text
  static const Color ubiWhite = Color(0xFFFFFFFF);
  
  // === Common Aliases ===

  /// White alias for convenience
  static const Color white = ubiWhite;

  /// Black alias for convenience
  static const Color black = ubiBlack;

  // === Service Colors ===

  /// UBI Move (Ride-hailing) - Same as brand green
  /// Represents mobility and eco-friendliness
  static const Color ubiMoveColor = ubiGreen;

  /// UBI Bites (Food Delivery) - Warm orange
  /// Evokes appetite and warmth
  static const Color ubiBitesColor = Color(0xFFFF7545);

  /// UBI Send (Package Delivery) - Teal
  /// Represents reliability and efficiency
  static const Color ubiSendColor = Color(0xFF10AEBA);

  /// CEERION (EV Financing) - Electric blue
  /// Represents innovation and sustainability
  static const Color ceerionColor = Color(0xFF3B82F6);

  /// Service color aliases
  static const Color serviceRide = ubiMoveColor;
  static const Color serviceFood = ubiBitesColor;
  static const Color serviceDelivery = ubiSendColor;
  static const Color serviceCeerion = ceerionColor;

  // === Green Variants ===

  /// Light green for backgrounds and containers
  static const Color greenLight = Color(0xFFD1FAE5);

  /// Dark green for text on light backgrounds
  static const Color greenDark = Color(0xFF065F46);

  // === Food Variants ===

  /// Light food color for backgrounds
  static const Color foodLight = Color(0xFFFFEDE7);

  /// Dark food color for text
  static const Color foodDark = Color(0xFF9A3412);
  
  // === Neutral Colors ===
  
  /// Gray scale for text and UI elements
  static const Color gray900 = Color(0xFF111827);
  static const Color gray800 = Color(0xFF1F2937);
  static const Color gray700 = Color(0xFF374151);
  static const Color gray600 = Color(0xFF4B5563);
  static const Color gray500 = Color(0xFF6B7280);
  static const Color gray400 = Color(0xFF9CA3AF);
  static const Color gray300 = Color(0xFFD1D5DB);
  static const Color gray200 = Color(0xFFE5E7EB);
  static const Color gray100 = Color(0xFFF3F4F6);
  static const Color gray50 = Color(0xFFF9FAFB);
  
  // === Semantic Colors ===
  
  /// Success - Green tones
  static const Color success = Color(0xFF10B981);
  static const Color successLight = Color(0xFFD1FAE5);
  static const Color successDark = Color(0xFF065F46);
  
  /// Error - Red tones
  static const Color error = Color(0xFFEF4444);
  static const Color errorLight = Color(0xFFFEE2E2);
  static const Color errorDark = Color(0xFF991B1B);
  
  /// Warning - Amber tones
  static const Color warning = Color(0xFFF59E0B);
  static const Color warningLight = Color(0xFFFEF3C7);
  static const Color warningDark = Color(0xFF92400E);
  
  /// Info - Blue tones
  static const Color info = Color(0xFF3B82F6);
  static const Color infoLight = Color(0xFFDBEAFE);
  static const Color infoDark = Color(0xFF1E40AF);
  
  // === Surface Colors ===

  /// Background colors
  static const Color backgroundPrimary = Color(0xFFFAFAFA);
  static const Color backgroundSecondary = Color(0xFFF5F5F5);
  static const Color backgroundTertiary = Color(0xFFEEEEEE);

  /// Card/Surface colors
  static const Color surfaceWhite = Color(0xFFFFFFFF);
  static const Color surfaceElevated = Color(0xFFFFFFFF);

  /// Light mode surface alias
  static const Color surface = surfaceWhite;

  // === Light Mode Text Colors ===

  /// Primary text - for headings and important text
  static const Color textPrimary = gray900;

  /// Secondary text - for body text
  static const Color textSecondary = gray600;

  /// Tertiary text - for hints and disabled text
  static const Color textTertiary = gray400;

  // === Light Mode Border/Divider Colors ===

  /// Border color for inputs and cards
  static const Color border = gray200;

  /// Divider color for separators
  static const Color divider = gray100;

  // === Dark Mode Colors ===

  /// Dark mode background
  static const Color darkBackground = Color(0xFF121212);
  static const Color darkSurface = Color(0xFF1E1E1E);
  static const Color darkSurfaceElevated = Color(0xFF2D2D2D);

  /// Dark mode surface alias
  static const Color surfaceDark = darkSurface;

  /// Dark mode card color
  static const Color cardDark = darkSurfaceElevated;

  // === Dark Mode Text Colors ===

  /// Primary text for dark mode
  static const Color textPrimaryDark = gray100;

  /// Secondary text for dark mode
  static const Color textSecondaryDark = gray400;

  /// Tertiary text for dark mode
  static const Color textTertiaryDark = gray500;

  // === Dark Mode Border/Divider Colors ===

  /// Border color for dark mode
  static const Color borderDark = gray700;

  /// Divider color for dark mode
  static const Color dividerDark = gray800;
  
  // === Gradient Colors ===
  
  /// Primary gradient (for premium features)
  static const List<Color> primaryGradient = [
    Color(0xFF1DB954),
    Color(0xFF169C46),
  ];
  
  /// Ride gradient
  static const List<Color> rideGradient = [
    Color(0xFF1DB954),
    Color(0xFF10AEBA),
  ];
  
  /// Food gradient
  static const List<Color> foodGradient = [
    Color(0xFFFF7545),
    Color(0xFFFF9A76),
  ];
  
  /// Delivery gradient
  static const List<Color> deliveryGradient = [
    Color(0xFF10AEBA),
    Color(0xFF3B82F6),
  ];
  
  // === Overlay Colors ===

  /// Black overlays for modals and sheets
  static const Color overlayLight = Color(0x1A000000); // 10%
  static const Color overlayMedium = Color(0x4D000000); // 30%
  static const Color overlayDark = Color(0x80000000); // 50%
  static const Color overlayDarker = Color(0xB3000000); // 70%
  static const Color overlay60 = Color(0x99000000); // 60%
  static const Color overlay80 = Color(0xCC000000); // 80%

  /// Map overlay
  static const Color mapOverlay = Color(0xE6FFFFFF); // 90%
  
  // === Utility Methods ===
  
  /// Get service color by type
  static Color getServiceColor(ServiceType type) {
    switch (type) {
      case ServiceType.ride:
        return ubiMoveColor;
      case ServiceType.food:
        return ubiBitesColor;
      case ServiceType.delivery:
        return ubiSendColor;
      case ServiceType.ceerion:
        return ceerionColor;
    }
  }
  
  /// Get color with opacity
  static Color withOpacity(Color color, double opacity) {
    return color.withOpacity(opacity);
  }
  
  /// Darken a color
  static Color darken(Color color, [double amount = 0.1]) {
    assert(amount >= 0 && amount <= 1);
    final hsl = HSLColor.fromColor(color);
    final hslDark = hsl.withLightness((hsl.lightness - amount).clamp(0.0, 1.0));
    return hslDark.toColor();
  }
  
  /// Lighten a color
  static Color lighten(Color color, [double amount = 0.1]) {
    assert(amount >= 0 && amount <= 1);
    final hsl = HSLColor.fromColor(color);
    final hslLight = hsl.withLightness((hsl.lightness + amount).clamp(0.0, 1.0));
    return hslLight.toColor();
  }
}

/// Service types for color selection
enum ServiceType {
  ride,
  food,
  delivery,
  ceerion,
}

/// Extension for easy color access in widgets
extension UbiColorsExtension on BuildContext {
  /// Access UBI colors from context
  UbiColorsData get ubiColors {
    final brightness = Theme.of(this).brightness;
    return brightness == Brightness.dark ? UbiColorsData.dark : UbiColorsData.light;
  }
}

/// Color data class for context-aware colors as a ThemeExtension
class UbiColorsData extends ThemeExtension<UbiColorsData> {
  final Brightness brightness;
  final Color primary;
  final Color onPrimary;
  final Color background;
  final Color surface;
  final Color surfaceElevated;
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;
  final Color border;
  final Color divider;

  const UbiColorsData({
    required this.brightness,
    required this.primary,
    required this.onPrimary,
    required this.background,
    required this.surface,
    required this.surfaceElevated,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    required this.border,
    required this.divider,
  });

  /// Light theme colors
  static const light = UbiColorsData(
    brightness: Brightness.light,
    primary: UbiColors.ubiGreen,
    onPrimary: UbiColors.ubiWhite,
    background: UbiColors.backgroundPrimary,
    surface: UbiColors.surfaceWhite,
    surfaceElevated: UbiColors.surfaceElevated,
    textPrimary: UbiColors.gray900,
    textSecondary: UbiColors.gray600,
    textTertiary: UbiColors.gray400,
    border: UbiColors.gray200,
    divider: UbiColors.gray100,
  );

  /// Dark theme colors
  static const dark = UbiColorsData(
    brightness: Brightness.dark,
    primary: UbiColors.ubiGreen,
    onPrimary: UbiColors.ubiWhite,
    background: UbiColors.darkBackground,
    surface: UbiColors.darkSurface,
    surfaceElevated: UbiColors.darkSurfaceElevated,
    textPrimary: UbiColors.gray100,
    textSecondary: UbiColors.gray400,
    textTertiary: UbiColors.gray500,
    border: UbiColors.gray700,
    divider: UbiColors.gray800,
  );

  bool get isDark => brightness == Brightness.dark;

  @override
  UbiColorsData copyWith({
    Brightness? brightness,
    Color? primary,
    Color? onPrimary,
    Color? background,
    Color? surface,
    Color? surfaceElevated,
    Color? textPrimary,
    Color? textSecondary,
    Color? textTertiary,
    Color? border,
    Color? divider,
  }) {
    return UbiColorsData(
      brightness: brightness ?? this.brightness,
      primary: primary ?? this.primary,
      onPrimary: onPrimary ?? this.onPrimary,
      background: background ?? this.background,
      surface: surface ?? this.surface,
      surfaceElevated: surfaceElevated ?? this.surfaceElevated,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textTertiary: textTertiary ?? this.textTertiary,
      border: border ?? this.border,
      divider: divider ?? this.divider,
    );
  }

  @override
  UbiColorsData lerp(UbiColorsData? other, double t) {
    if (other == null) return this;
    return UbiColorsData(
      brightness: t < 0.5 ? brightness : other.brightness,
      primary: Color.lerp(primary, other.primary, t)!,
      onPrimary: Color.lerp(onPrimary, other.onPrimary, t)!,
      background: Color.lerp(background, other.background, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceElevated: Color.lerp(surfaceElevated, other.surfaceElevated, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textTertiary: Color.lerp(textTertiary, other.textTertiary, t)!,
      border: Color.lerp(border, other.border, t)!,
      divider: Color.lerp(divider, other.divider, t)!,
    );
  }
}
