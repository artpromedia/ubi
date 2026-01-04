import 'package:flutter/material.dart';

/// UBI Border Radius
///
/// Consistent corner radius system
abstract final class UbiRadius {
  // === Base Values ===
  
  /// No radius (0px)
  static const double none = 0;
  
  /// Extra small (4px)
  static const double xs = 4;
  
  /// Small (8px)
  static const double sm = 8;
  
  /// Medium (12px)
  static const double md = 12;
  
  /// Default (16px)
  static const double df = 16;
  
  /// Large (20px)
  static const double lg = 20;
  
  /// Extra large (24px)
  static const double xl = 24;
  
  /// Extra extra large (32px)
  static const double xxl = 32;
  
  /// Full/Circular (9999px)
  static const double full = 9999;
  
  // === Semantic Values ===
  
  /// Button radius
  static const double button = md;
  
  /// Card radius
  static const double card = df;
  
  /// Input field radius
  static const double input = md;
  
  /// Chip radius
  static const double chip = full;
  
  /// Bottom sheet radius (top corners)
  static const double bottomSheet = xl;
  
  /// Dialog radius
  static const double dialog = df;
  
  /// Avatar radius (circular)
  static const double avatar = full;
  
  /// Badge radius
  static const double badge = sm;
  
  /// Thumbnail radius
  static const double thumbnail = sm;
  
  /// Map marker radius
  static const double marker = md;
  
  // === BorderRadius Helpers ===
  
  /// All corners same radius
  static BorderRadius all(double radius) => BorderRadius.circular(radius);
  
  /// Only top corners
  static BorderRadius top(double radius) => BorderRadius.only(
    topLeft: Radius.circular(radius),
    topRight: Radius.circular(radius),
  );
  
  /// Only bottom corners
  static BorderRadius bottom(double radius) => BorderRadius.only(
    bottomLeft: Radius.circular(radius),
    bottomRight: Radius.circular(radius),
  );
  
  /// Only left corners
  static BorderRadius left(double radius) => BorderRadius.only(
    topLeft: Radius.circular(radius),
    bottomLeft: Radius.circular(radius),
  );
  
  /// Only right corners
  static BorderRadius right(double radius) => BorderRadius.only(
    topRight: Radius.circular(radius),
    bottomRight: Radius.circular(radius),
  );
  
  /// Only specific corners
  static BorderRadius only({
    double topLeft = 0,
    double topRight = 0,
    double bottomLeft = 0,
    double bottomRight = 0,
  }) => BorderRadius.only(
    topLeft: Radius.circular(topLeft),
    topRight: Radius.circular(topRight),
    bottomLeft: Radius.circular(bottomLeft),
    bottomRight: Radius.circular(bottomRight),
  );
  
  // === Pre-defined BorderRadius ===
  
  /// Zero radius
  static const BorderRadius zeroRadius = BorderRadius.zero;
  
  /// Extra small radius (4px)
  static final BorderRadius xsRadius = BorderRadius.circular(xs);
  
  /// Small radius (8px)
  static final BorderRadius smRadius = BorderRadius.circular(sm);
  
  /// Medium radius (12px)
  static final BorderRadius mdRadius = BorderRadius.circular(md);
  
  /// Default radius (16px)
  static final BorderRadius dfRadius = BorderRadius.circular(df);
  
  /// Large radius (20px)
  static final BorderRadius lgRadius = BorderRadius.circular(lg);
  
  /// Extra large radius (24px)
  static final BorderRadius xlRadius = BorderRadius.circular(xl);
  
  /// Extra extra large radius (32px)
  static final BorderRadius xxlRadius = BorderRadius.circular(xxl);
  
  /// Full/Circular radius
  static final BorderRadius fullRadius = BorderRadius.circular(full);
  
  // === Component-specific BorderRadius ===
  
  /// Button border radius
  static final BorderRadius buttonRadius = BorderRadius.circular(button);
  
  /// Card border radius
  static final BorderRadius cardRadius = BorderRadius.circular(card);
  
  /// Input field border radius
  static final BorderRadius inputRadius = BorderRadius.circular(input);
  
  /// Chip border radius
  static final BorderRadius chipRadius = BorderRadius.circular(chip);
  
  /// Bottom sheet border radius (top only)
  static final BorderRadius bottomSheetRadius = BorderRadius.only(
    topLeft: Radius.circular(bottomSheet),
    topRight: Radius.circular(bottomSheet),
  );
  
  /// Dialog border radius
  static final BorderRadius dialogRadius = BorderRadius.circular(dialog);
}

/// Extension for easy radius access
extension UbiRadiusExtension on num {
  /// Convert number to BorderRadius
  BorderRadius get borderRadius => BorderRadius.circular(toDouble());
  
  /// Convert number to Radius
  Radius get radius => Radius.circular(toDouble());
}
