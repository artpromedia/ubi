import 'package:flutter/material.dart';

import '../theme/ubi_spacing.dart';

/// UBI Responsive Breakpoints
///
/// Screen size breakpoints for responsive design.
abstract final class UbiBreakpoints {
  /// Mobile: 0 - 599px
  static const double mobile = 0;

  /// Tablet: 600 - 1023px
  static const double tablet = 600;

  /// Desktop: 1024px+
  static const double desktop = 1024;

  /// Large desktop: 1440px+
  static const double largeDesktop = 1440;
}

/// UBI Screen Size
enum UbiScreenSize {
  mobile,
  tablet,
  desktop,
  largeDesktop,
}

/// UBI Responsive
///
/// Utility class for responsive design in Flutter.
/// Provides methods to adapt UI based on screen size.
class UbiResponsive {
  UbiResponsive._();

  /// Gets the current screen size category
  static UbiScreenSize getScreenSize(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    if (width >= UbiBreakpoints.largeDesktop) {
      return UbiScreenSize.largeDesktop;
    } else if (width >= UbiBreakpoints.desktop) {
      return UbiScreenSize.desktop;
    } else if (width >= UbiBreakpoints.tablet) {
      return UbiScreenSize.tablet;
    }
    return UbiScreenSize.mobile;
  }

  /// Checks if the current screen is mobile
  static bool isMobile(BuildContext context) {
    return MediaQuery.of(context).size.width < UbiBreakpoints.tablet;
  }

  /// Checks if the current screen is tablet
  static bool isTablet(BuildContext context) {
    final width = MediaQuery.of(context).size.width;
    return width >= UbiBreakpoints.tablet && width < UbiBreakpoints.desktop;
  }

  /// Checks if the current screen is desktop
  static bool isDesktop(BuildContext context) {
    return MediaQuery.of(context).size.width >= UbiBreakpoints.desktop;
  }

  /// Gets a value based on screen size
  static T value<T>(
    BuildContext context, {
    required T mobile,
    T? tablet,
    T? desktop,
    T? largeDesktop,
  }) {
    final screenSize = getScreenSize(context);
    switch (screenSize) {
      case UbiScreenSize.largeDesktop:
        return largeDesktop ?? desktop ?? tablet ?? mobile;
      case UbiScreenSize.desktop:
        return desktop ?? tablet ?? mobile;
      case UbiScreenSize.tablet:
        return tablet ?? mobile;
      case UbiScreenSize.mobile:
      default:
        return mobile;
    }
  }

  /// Gets responsive padding based on screen size
  static EdgeInsets padding(BuildContext context) {
    return value(
      context,
      mobile: EdgeInsets.symmetric(horizontal: UbiSpacing.md),
      tablet: EdgeInsets.symmetric(horizontal: UbiSpacing.lg),
      desktop: EdgeInsets.symmetric(horizontal: UbiSpacing.xl),
    );
  }

  /// Gets the number of grid columns based on screen size
  static int gridColumns(BuildContext context) {
    return value(
      context,
      mobile: 2,
      tablet: 3,
      desktop: 4,
      largeDesktop: 6,
    );
  }

  /// Gets maximum content width for centering content on large screens
  static double? maxContentWidth(BuildContext context) {
    return value<double?>(
      context,
      mobile: null,
      tablet: 720,
      desktop: 960,
      largeDesktop: 1200,
    );
  }
}

/// UBI Responsive Builder
///
/// A widget that rebuilds based on screen size changes.
class UbiResponsiveBuilder extends StatelessWidget {
  const UbiResponsiveBuilder({
    super.key,
    required this.builder,
    this.mobile,
    this.tablet,
    this.desktop,
  });

  /// Builder function that receives the current screen size
  final Widget Function(BuildContext context, UbiScreenSize screenSize)? builder;

  /// Widget to display on mobile screens
  final Widget? mobile;

  /// Widget to display on tablet screens
  final Widget? tablet;

  /// Widget to display on desktop screens
  final Widget? desktop;

  @override
  Widget build(BuildContext context) {
    final screenSize = UbiResponsive.getScreenSize(context);

    if (builder != null) {
      return builder!(context, screenSize);
    }

    switch (screenSize) {
      case UbiScreenSize.largeDesktop:
      case UbiScreenSize.desktop:
        return desktop ?? tablet ?? mobile ?? SizedBox.shrink();
      case UbiScreenSize.tablet:
        return tablet ?? mobile ?? SizedBox.shrink();
      case UbiScreenSize.mobile:
      default:
        return mobile ?? SizedBox.shrink();
    }
  }
}

/// UBI Responsive Padding
///
/// A widget that applies responsive padding.
class UbiResponsivePadding extends StatelessWidget {
  const UbiResponsivePadding({
    super.key,
    required this.child,
    this.mobilePadding,
    this.tabletPadding,
    this.desktopPadding,
  });

  final Widget child;
  final EdgeInsets? mobilePadding;
  final EdgeInsets? tabletPadding;
  final EdgeInsets? desktopPadding;

  @override
  Widget build(BuildContext context) {
    final padding = UbiResponsive.value(
      context,
      mobile: mobilePadding ?? EdgeInsets.all(UbiSpacing.md),
      tablet: tabletPadding,
      desktop: desktopPadding,
    );

    return Padding(padding: padding, child: child);
  }
}

/// UBI Safe Area Padding
///
/// Returns safe area values for the current platform.
class UbiSafeArea {
  UbiSafeArea._();

  static EdgeInsets of(BuildContext context) {
    return MediaQuery.of(context).padding;
  }

  static double top(BuildContext context) {
    return MediaQuery.of(context).padding.top;
  }

  static double bottom(BuildContext context) {
    return MediaQuery.of(context).padding.bottom;
  }

  static double left(BuildContext context) {
    return MediaQuery.of(context).padding.left;
  }

  static double right(BuildContext context) {
    return MediaQuery.of(context).padding.right;
  }
}
