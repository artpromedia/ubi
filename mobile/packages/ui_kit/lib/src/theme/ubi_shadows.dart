import 'package:flutter/material.dart';

import 'ubi_colors.dart';

/// UBI Shadows
///
/// Elevation system using subtle shadows optimized for:
/// - Performance on low-end devices
/// - Visual hierarchy
/// - Material Design principles
abstract final class UbiShadows {
  // === Elevation Levels ===
  
  /// No shadow (elevation 0)
  static const List<BoxShadow> none = [];
  
  /// Extra small shadow (elevation 1)
  /// Use for: Subtle lift, cards on similar backgrounds
  static const List<BoxShadow> xs = [
    BoxShadow(
      color: Color(0x0A000000),
      blurRadius: 2,
      offset: Offset(0, 1),
    ),
  ];
  
  /// Small shadow (elevation 2)
  /// Use for: Cards, buttons
  static const List<BoxShadow> sm = [
    BoxShadow(
      color: Color(0x0D000000),
      blurRadius: 4,
      offset: Offset(0, 2),
    ),
    BoxShadow(
      color: Color(0x0A000000),
      blurRadius: 2,
      offset: Offset(0, 1),
    ),
  ];
  
  /// Medium shadow (elevation 4)
  /// Use for: Raised cards, dropdowns
  static const List<BoxShadow> md = [
    BoxShadow(
      color: Color(0x0F000000),
      blurRadius: 8,
      offset: Offset(0, 4),
    ),
    BoxShadow(
      color: Color(0x0A000000),
      blurRadius: 4,
      offset: Offset(0, 2),
    ),
  ];
  
  /// Large shadow (elevation 8)
  /// Use for: Modals, dialogs
  static const List<BoxShadow> lg = [
    BoxShadow(
      color: Color(0x14000000),
      blurRadius: 16,
      offset: Offset(0, 8),
    ),
    BoxShadow(
      color: Color(0x0A000000),
      blurRadius: 8,
      offset: Offset(0, 4),
    ),
  ];
  
  /// Extra large shadow (elevation 16)
  /// Use for: Bottom sheets, navigation drawers
  static const List<BoxShadow> xl = [
    BoxShadow(
      color: Color(0x1A000000),
      blurRadius: 24,
      offset: Offset(0, 12),
    ),
    BoxShadow(
      color: Color(0x0D000000),
      blurRadius: 12,
      offset: Offset(0, 6),
    ),
  ];
  
  /// Extra extra large shadow (elevation 24)
  /// Use for: Full-screen modals
  static const List<BoxShadow> xxl = [
    BoxShadow(
      color: Color(0x1F000000),
      blurRadius: 32,
      offset: Offset(0, 16),
    ),
    BoxShadow(
      color: Color(0x0F000000),
      blurRadius: 16,
      offset: Offset(0, 8),
    ),
  ];
  
  // === Special Purpose Shadows ===
  
  /// Card shadow
  static const List<BoxShadow> card = sm;
  
  /// Button shadow
  static const List<BoxShadow> button = xs;
  
  /// Pressed button shadow (smaller)
  static const List<BoxShadow> buttonPressed = [
    BoxShadow(
      color: Color(0x08000000),
      blurRadius: 1,
      offset: Offset(0, 1),
    ),
  ];
  
  /// FAB shadow
  static const List<BoxShadow> fab = [
    BoxShadow(
      color: Color(0x26000000),
      blurRadius: 12,
      offset: Offset(0, 6),
    ),
    BoxShadow(
      color: Color(0x14000000),
      blurRadius: 4,
      offset: Offset(0, 2),
    ),
  ];
  
  /// Bottom navigation shadow
  static const List<BoxShadow> bottomNav = [
    BoxShadow(
      color: Color(0x0A000000),
      blurRadius: 8,
      offset: Offset(0, -2),
    ),
  ];
  
  /// Top app bar shadow
  static const List<BoxShadow> appBar = [
    BoxShadow(
      color: Color(0x0A000000),
      blurRadius: 4,
      offset: Offset(0, 2),
    ),
  ];
  
  /// Bottom sheet shadow
  static const List<BoxShadow> bottomSheet = [
    BoxShadow(
      color: Color(0x1A000000),
      blurRadius: 24,
      offset: Offset(0, -8),
    ),
  ];
  
  /// Sticky header shadow
  static const List<BoxShadow> stickyHeader = [
    BoxShadow(
      color: Color(0x0D000000),
      blurRadius: 4,
      offset: Offset(0, 2),
    ),
  ];
  
  /// Inner shadow (for inputs)
  static const List<BoxShadow> inner = [
    BoxShadow(
      color: Color(0x08000000),
      blurRadius: 2,
      offset: Offset(0, 1),
      spreadRadius: -1,
    ),
  ];
  
  // === Colored Shadows ===
  
  /// Green glow (for primary actions)
  static List<BoxShadow> primaryGlow({double intensity = 0.3}) => [
    BoxShadow(
      color: UbiColors.ubiGreen.withOpacity(intensity),
      blurRadius: 16,
      offset: const Offset(0, 4),
    ),
  ];
  
  /// Error glow
  static List<BoxShadow> errorGlow({double intensity = 0.3}) => [
    BoxShadow(
      color: UbiColors.error.withOpacity(intensity),
      blurRadius: 16,
      offset: const Offset(0, 4),
    ),
  ];
  
  /// Service-specific glow
  static List<BoxShadow> serviceGlow(
    ServiceType service, {
    double intensity = 0.3,
  }) {
    final color = UbiColors.getServiceColor(service);
    return [
      BoxShadow(
        color: color.withOpacity(intensity),
        blurRadius: 16,
        offset: const Offset(0, 4),
      ),
    ];
  }
  
  // === Dark Mode Shadows ===
  
  /// Dark mode shadows (more subtle)
  static const List<BoxShadow> darkSm = [
    BoxShadow(
      color: Color(0x40000000),
      blurRadius: 4,
      offset: Offset(0, 2),
    ),
  ];
  
  static const List<BoxShadow> darkMd = [
    BoxShadow(
      color: Color(0x50000000),
      blurRadius: 8,
      offset: Offset(0, 4),
    ),
  ];
  
  static const List<BoxShadow> darkLg = [
    BoxShadow(
      color: Color(0x60000000),
      blurRadius: 16,
      offset: Offset(0, 8),
    ),
  ];
  
  // === Utility Methods ===
  
  /// Get shadow by elevation level
  static List<BoxShadow> byElevation(int elevation) {
    return switch (elevation) {
      0 => none,
      1 => xs,
      2 => sm,
      <= 4 => md,
      <= 8 => lg,
      <= 16 => xl,
      _ => xxl,
    };
  }
  
  /// Get shadow for dark mode
  static List<BoxShadow> forBrightness(
    List<BoxShadow> shadow,
    Brightness brightness,
  ) {
    if (brightness == Brightness.light) return shadow;
    
    // Increase shadow opacity for dark mode
    return shadow.map((s) {
      return BoxShadow(
        color: s.color.withOpacity(s.color.opacity * 2),
        blurRadius: s.blurRadius,
        offset: s.offset,
        spreadRadius: s.spreadRadius,
      );
    }).toList();
  }
}
