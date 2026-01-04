import 'package:flutter/material.dart';

/// UBI Spacing System
///
/// Consistent spacing based on 4px base unit.
/// All spacing values are multiples of 4 for visual harmony.
abstract final class UbiSpacing {
  // === Base Unit ===
  
  /// Base spacing unit (4px)
  static const double base = 4.0;
  
  // === Named Spacing ===
  
  /// Extra extra small (2px)
  static const double xxs = 2.0;
  
  /// Extra small (4px)
  static const double xs = 4.0;
  
  /// Small (8px)
  static const double sm = 8.0;
  
  /// Medium (12px)
  static const double md = 12.0;
  
  /// Default (16px) - Body text spacing
  static const double df = 16.0;
  
  /// Large (20px)
  static const double lg = 20.0;
  
  /// Extra large (24px)
  static const double xl = 24.0;
  
  /// Extra extra large (32px)
  static const double xxl = 32.0;
  
  /// Extra extra extra large (40px)
  static const double xxxl = 40.0;
  
  /// Huge (48px)
  static const double huge = 48.0;
  
  /// Massive (64px)
  static const double massive = 64.0;
  
  // === Semantic Spacing ===
  
  /// Page horizontal padding
  static const double pageHorizontal = 16.0;
  
  /// Page vertical padding
  static const double pageVertical = 24.0;
  
  /// Card internal padding
  static const double cardPadding = 16.0;
  
  /// List item spacing
  static const double listItemSpacing = 12.0;
  
  /// Section spacing
  static const double sectionSpacing = 24.0;
  
  /// Input field spacing
  static const double inputSpacing = 16.0;
  
  /// Button spacing (between buttons)
  static const double buttonSpacing = 12.0;
  
  /// Icon-text gap
  static const double iconTextGap = 8.0;
  
  /// Bottom sheet top padding
  static const double bottomSheetTop = 12.0;
  
  /// App bar height
  static const double appBarHeight = 56.0;
  
  /// Bottom navigation height
  static const double bottomNavHeight = 64.0;
  
  /// FAB margin from edges
  static const double fabMargin = 16.0;
  
  // === EdgeInsets Helpers ===
  
  /// Zero insets
  static const EdgeInsets zero = EdgeInsets.zero;
  
  /// All sides same padding
  static EdgeInsets all(double value) => EdgeInsets.all(value);
  
  /// Horizontal padding only
  static EdgeInsets horizontal(double value) => 
      EdgeInsets.symmetric(horizontal: value);
  
  /// Vertical padding only
  static EdgeInsets vertical(double value) => 
      EdgeInsets.symmetric(vertical: value);
  
  /// Symmetric padding
  static EdgeInsets symmetric({
    double horizontal = 0,
    double vertical = 0,
  }) => EdgeInsets.symmetric(horizontal: horizontal, vertical: vertical);
  
  /// Only specific sides
  static EdgeInsets only({
    double left = 0,
    double top = 0,
    double right = 0,
    double bottom = 0,
  }) => EdgeInsets.only(left: left, top: top, right: right, bottom: bottom);
  
  // === Pre-defined EdgeInsets ===
  
  /// Page padding (horizontal)
  static const EdgeInsets pagePadding = EdgeInsets.symmetric(
    horizontal: pageHorizontal,
    vertical: pageVertical,
  );
  
  /// Page padding horizontal only
  static const EdgeInsets pageHorizontalPadding = EdgeInsets.symmetric(
    horizontal: pageHorizontal,
  );
  
  /// Card padding
  static const EdgeInsets cardInsets = EdgeInsets.all(cardPadding);
  
  /// List item padding
  static const EdgeInsets listItemPadding = EdgeInsets.symmetric(
    horizontal: df,
    vertical: md,
  );
  
  /// Button padding
  static const EdgeInsets buttonPadding = EdgeInsets.symmetric(
    horizontal: xl,
    vertical: md,
  );
  
  /// Compact button padding
  static const EdgeInsets buttonPaddingCompact = EdgeInsets.symmetric(
    horizontal: df,
    vertical: sm,
  );
  
  /// Input field content padding
  static const EdgeInsets inputContentPadding = EdgeInsets.symmetric(
    horizontal: df,
    vertical: md,
  );
  
  /// Chip padding
  static const EdgeInsets chipPadding = EdgeInsets.symmetric(
    horizontal: md,
    vertical: xs,
  );
  
  /// Dialog padding
  static const EdgeInsets dialogPadding = EdgeInsets.all(xl);
  
  /// Bottom sheet padding
  static const EdgeInsets bottomSheetPadding = EdgeInsets.fromLTRB(
    df,
    bottomSheetTop,
    df,
    df,
  );
  
  // === SizedBox Helpers ===
  
  /// Horizontal gap
  static SizedBox horizontalGap(double width) => SizedBox(width: width);
  
  /// Vertical gap
  static SizedBox verticalGap(double height) => SizedBox(height: height);
  
  // === Pre-defined SizedBoxes ===
  
  /// Extra small horizontal gap (4px)
  static const SizedBox hXs = SizedBox(width: xs);
  
  /// Small horizontal gap (8px)
  static const SizedBox hSm = SizedBox(width: sm);
  
  /// Medium horizontal gap (12px)
  static const SizedBox hMd = SizedBox(width: md);
  
  /// Default horizontal gap (16px)
  static const SizedBox hDf = SizedBox(width: df);
  
  /// Large horizontal gap (24px)
  static const SizedBox hLg = SizedBox(width: lg);
  
  /// Extra large horizontal gap (32px)
  static const SizedBox hXl = SizedBox(width: xl);
  
  /// Extra small vertical gap (4px)
  static const SizedBox vXs = SizedBox(height: xs);
  
  /// Small vertical gap (8px)
  static const SizedBox vSm = SizedBox(height: sm);
  
  /// Medium vertical gap (12px)
  static const SizedBox vMd = SizedBox(height: md);
  
  /// Default vertical gap (16px)
  static const SizedBox vDf = SizedBox(height: df);
  
  /// Large vertical gap (24px)
  static const SizedBox vLg = SizedBox(height: lg);
  
  /// Extra large vertical gap (32px)
  static const SizedBox vXl = SizedBox(height: xl);
  
  /// Extra extra large vertical gap (40px)
  static const SizedBox vXxl = SizedBox(height: xxl);
  
  /// Section vertical gap (48px)
  static const SizedBox vSection = SizedBox(height: huge);
}

/// Extension for easy spacing access
extension UbiSpacingExtension on num {
  /// Convert number to spacing multiple
  double get spacing => this * UbiSpacing.base;
  
  /// Create horizontal SizedBox
  SizedBox get horizontalSpace => SizedBox(width: toDouble());
  
  /// Create vertical SizedBox
  SizedBox get verticalSpace => SizedBox(height: toDouble());
  
  /// Create EdgeInsets with this value on all sides
  EdgeInsets get allInsets => EdgeInsets.all(toDouble());
  
  /// Create horizontal EdgeInsets
  EdgeInsets get horizontalInsets => 
      EdgeInsets.symmetric(horizontal: toDouble());
  
  /// Create vertical EdgeInsets
  EdgeInsets get verticalInsets => 
      EdgeInsets.symmetric(vertical: toDouble());
}
