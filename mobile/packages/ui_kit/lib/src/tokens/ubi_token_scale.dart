/// Spacing, radius and target-size scales, generated from
/// `contracts/semantic-tokens.json` (`grid`, `radius`, `targets`).
///
/// These are the *only* geometry numbers a screen is allowed to use. Anything
/// that is not on this scale is a design bug, not a local decision.
library;

import 'package:flutter/widgets.dart';

/// The 4px spacing grid (`"grid": "4px"`).
///
/// Named by multiples of the base unit so the grid stays visible at the call
/// site: `UbiSpace.x4` is 4 * 4 = 16.
abstract final class UbiSpace {
  /// The base unit every other value is a multiple of.
  static const double unit = 4;

  static const double x1 = unit; // 4
  static const double x2 = unit * 2; // 8
  static const double x3 = unit * 3; // 12
  static const double x4 = unit * 4; // 16
  static const double x5 = unit * 5; // 20
  static const double x6 = unit * 6; // 24
  static const double x8 = unit * 8; // 32
  static const double x10 = unit * 10; // 40
  static const double x12 = unit * 12; // 48
  static const double x16 = unit * 16; // 64

  /// Snaps an arbitrary value onto the 4px grid. Used by responsive helpers so
  /// a computed size can never land off-grid.
  static double snap(double value) => (value / unit).roundToDouble() * unit;
}

/// Corner radii (`"radius"` in the token file).
abstract final class UbiRadii {
  /// Pills and chips.
  static const double chip = 999;

  /// Buttons, inputs, segmented controls.
  static const double control = 12;

  /// Standard content card.
  static const double card = 14;

  /// Large / hero card.
  static const double cardLg = 16;

  /// Bottom sheet on iOS.
  static const double sheet = 24;

  /// Bottom sheet on Android (slice 12: sheets are 28 and clear the 24dp nav
  /// area).
  static const double sheetAndroid = 28;

  /// The sheet radius for the platform the app is actually running on.
  static double sheetFor(TargetPlatform platform) =>
      platform == TargetPlatform.android ? sheetAndroid : sheet;

  static const Radius chipRadius = Radius.circular(chip);
  static const Radius controlRadius = Radius.circular(control);
  static const Radius cardRadius = Radius.circular(card);
  static const Radius cardLgRadius = Radius.circular(cardLg);

  static const BorderRadius controlBorder = BorderRadius.all(controlRadius);
  static const BorderRadius cardBorder = BorderRadius.all(cardRadius);
  static const BorderRadius cardLgBorder = BorderRadius.all(cardLgRadius);
  static const BorderRadius chipBorder = BorderRadius.all(chipRadius);

  /// Top-only radius for a bottom sheet on [platform].
  static BorderRadius sheetBorder(TargetPlatform platform) =>
      BorderRadius.vertical(top: Radius.circular(sheetFor(platform)));
}

/// Minimum hit targets (`"targets"` in the token file) and the type floor from
/// CLAUDE.md rule 11.
abstract final class UbiTargets {
  /// 44pt minimum on iOS.
  static const double ios = 44;

  /// 48dp minimum on Android.
  static const double android = 48;

  /// Primary buttons are 54-56; we ship the top of the range so Android's 48dp
  /// row minimum is comfortably cleared.
  static const double primaryButton = 56;

  /// Bottom of the allowed primary-button range, for dense sheets.
  static const double primaryButtonCompact = 54;

  /// List rows are >= 56 (slice 12).
  static const double row = 56;

  /// Body text never goes below 12.5px on phones (CLAUDE.md rule 11).
  static const double minBodyFontSize = 12.5;

  /// Android reserves 24dp for the gesture-navigation pill; sheets must clear
  /// it (slice 12).
  static const double androidNavInset = 24;

  /// The minimum tappable edge for the platform the app is running on.
  static double minimumFor(TargetPlatform platform) =>
      platform == TargetPlatform.android ? android : ios;

  /// A square [Size] at the platform minimum, for `minimumSize` on buttons.
  static Size minimumSizeFor(TargetPlatform platform) {
    final double edge = minimumFor(platform);
    return Size(edge, edge);
  }
}
