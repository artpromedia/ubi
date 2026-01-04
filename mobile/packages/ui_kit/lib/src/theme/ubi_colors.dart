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
  
  // === Dark Mode Colors ===
  
  /// Dark mode background
  static const Color darkBackground = Color(0xFF121212);
  static const Color darkSurface = Color(0xFF1E1E1E);
  static const Color darkSurfaceElevated = Color(0xFF2D2D2D);
  
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
    return UbiColorsData(brightness);
  }
}

/// Color data class for context-aware colors
class UbiColorsData {
  final Brightness brightness;
  
  const UbiColorsData(this.brightness);
  
  bool get isDark => brightness == Brightness.dark;
  
  Color get primary => UbiColors.ubiGreen;
  Color get onPrimary => UbiColors.ubiWhite;
  
  Color get background => isDark 
      ? UbiColors.darkBackground 
      : UbiColors.backgroundPrimary;
      
  Color get surface => isDark 
      ? UbiColors.darkSurface 
      : UbiColors.surfaceWhite;
      
  Color get surfaceElevated => isDark 
      ? UbiColors.darkSurfaceElevated 
      : UbiColors.surfaceElevated;
      
  Color get textPrimary => isDark 
      ? UbiColors.gray100 
      : UbiColors.gray900;
      
  Color get textSecondary => isDark 
      ? UbiColors.gray400 
      : UbiColors.gray600;
      
  Color get textTertiary => isDark 
      ? UbiColors.gray500 
      : UbiColors.gray400;
      
  Color get border => isDark 
      ? UbiColors.gray700 
      : UbiColors.gray200;
      
  Color get divider => isDark 
      ? UbiColors.gray800 
      : UbiColors.gray100;
}
