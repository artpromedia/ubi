import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';

/// UBI App Bar Variant
enum UbiAppBarVariant {
  /// Standard app bar with title
  standard,

  /// Large title style (iOS style)
  largeTitle,

  /// Search app bar with integrated search field
  search,

  /// Transparent app bar for overlay on images/maps
  transparent,
}

/// UBI App Bar
///
/// A customizable app bar component following UBI design system.
/// Supports various layouts, actions, and styling options.
class UbiAppBar extends StatelessWidget implements PreferredSizeWidget {
  const UbiAppBar({
    super.key,
    this.title,
    this.titleWidget,
    this.variant = UbiAppBarVariant.standard,
    this.leading,
    this.showBackButton = true,
    this.onBackPressed,
    this.actions,
    this.bottom,
    this.backgroundColor,
    this.foregroundColor,
    this.elevation = 0,
    this.centerTitle = true,
    this.systemOverlayStyle,
    this.scrolledUnderElevation,
    this.toolbarHeight,
    // Search variant specific
    this.searchController,
    this.searchHint,
    this.onSearchChanged,
    this.onSearchSubmitted,
  });

  /// Title text
  final String? title;

  /// Custom title widget (overrides title)
  final Widget? titleWidget;

  /// App bar variant
  final UbiAppBarVariant variant;

  /// Custom leading widget (overrides back button)
  final Widget? leading;

  /// Whether to show back button
  final bool showBackButton;

  /// Callback for back button press
  final VoidCallback? onBackPressed;

  /// Action widgets
  final List<Widget>? actions;

  /// Bottom widget (e.g., TabBar)
  final PreferredSizeWidget? bottom;

  /// Background color
  final Color? backgroundColor;

  /// Foreground color (icons and text)
  final Color? foregroundColor;

  /// Shadow elevation
  final double elevation;

  /// Whether to center the title
  final bool centerTitle;

  /// System UI overlay style
  final SystemUiOverlayStyle? systemOverlayStyle;

  /// Elevation when scrolled under
  final double? scrolledUnderElevation;

  /// Custom toolbar height
  final double? toolbarHeight;

  // Search variant properties
  final TextEditingController? searchController;
  final String? searchHint;
  final ValueChanged<String>? onSearchChanged;
  final ValueChanged<String>? onSearchSubmitted;

  @override
  Size get preferredSize {
    double height = toolbarHeight ?? kToolbarHeight;
    if (variant == UbiAppBarVariant.largeTitle) {
      height = 112;
    }
    if (bottom != null) {
      height += bottom!.preferredSize.height;
    }
    return Size.fromHeight(height);
  }

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final effectiveBackgroundColor = backgroundColor ??
        (variant == UbiAppBarVariant.transparent
            ? Colors.transparent
            : (isDark ? UbiColors.gray900 : UbiColors.ubiWhite));

    final effectiveForegroundColor = foregroundColor ??
        (variant == UbiAppBarVariant.transparent
            ? UbiColors.ubiWhite
            : (isDark ? UbiColors.ubiWhite : UbiColors.gray900));

    final effectiveSystemOverlayStyle = systemOverlayStyle ??
        (isDark || variant == UbiAppBarVariant.transparent
            ? SystemUiOverlayStyle.light
            : SystemUiOverlayStyle.dark);

    Widget? effectiveLeading;
    if (leading != null) {
      effectiveLeading = leading;
    } else if (showBackButton && Navigator.of(context).canPop()) {
      effectiveLeading = _UbiBackButton(
        onPressed: onBackPressed ?? () => Navigator.of(context).pop(),
        color: effectiveForegroundColor,
      );
    }

    if (variant == UbiAppBarVariant.search) {
      return _buildSearchAppBar(
        context,
        effectiveBackgroundColor,
        effectiveForegroundColor,
        effectiveLeading,
        effectiveSystemOverlayStyle,
      );
    }

    if (variant == UbiAppBarVariant.largeTitle) {
      return _buildLargeTitleAppBar(
        context,
        effectiveBackgroundColor,
        effectiveForegroundColor,
        effectiveLeading,
        effectiveSystemOverlayStyle,
      );
    }

    return AppBar(
      title: titleWidget ?? (title != null
          ? Text(
              title!,
              style: UbiTypography.headingSmall.copyWith(
                color: effectiveForegroundColor,
              ),
            )
          : null),
      leading: effectiveLeading,
      actions: actions != null
          ? [
              ...actions!,
              SizedBox(width: UbiSpacing.xs),
            ]
          : null,
      bottom: bottom,
      backgroundColor: effectiveBackgroundColor,
      foregroundColor: effectiveForegroundColor,
      elevation: elevation,
      scrolledUnderElevation: scrolledUnderElevation ?? elevation,
      centerTitle: centerTitle,
      systemOverlayStyle: effectiveSystemOverlayStyle,
      toolbarHeight: toolbarHeight,
    );
  }

  Widget _buildSearchAppBar(
    BuildContext context,
    Color backgroundColor,
    Color foregroundColor,
    Widget? leading,
    SystemUiOverlayStyle overlayStyle,
  ) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return AppBar(
      backgroundColor: backgroundColor,
      foregroundColor: foregroundColor,
      elevation: elevation,
      scrolledUnderElevation: scrolledUnderElevation ?? elevation,
      systemOverlayStyle: overlayStyle,
      leading: leading,
      title: Container(
        height: 40,
        padding: EdgeInsets.symmetric(horizontal: UbiSpacing.md),
        decoration: BoxDecoration(
          color: isDark ? UbiColors.gray800 : UbiColors.gray100,
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          children: [
            Icon(
              Icons.search,
              color: UbiColors.gray500,
              size: 20,
            ),
            SizedBox(width: UbiSpacing.sm),
            Expanded(
              child: TextField(
                controller: searchController,
                onChanged: onSearchChanged,
                onSubmitted: onSearchSubmitted,
                style: UbiTypography.bodyMedium.copyWith(
                  color: foregroundColor,
                ),
                decoration: InputDecoration(
                  hintText: searchHint ?? 'Search',
                  hintStyle: UbiTypography.bodyMedium.copyWith(
                    color: UbiColors.gray500,
                  ),
                  border: InputBorder.none,
                  isDense: true,
                  contentPadding: EdgeInsets.zero,
                ),
              ),
            ),
          ],
        ),
      ),
      actions: actions,
      bottom: bottom,
    );
  }

  Widget _buildLargeTitleAppBar(
    BuildContext context,
    Color backgroundColor,
    Color foregroundColor,
    Widget? leading,
    SystemUiOverlayStyle overlayStyle,
  ) {
    return SliverAppBar(
      backgroundColor: backgroundColor,
      foregroundColor: foregroundColor,
      elevation: elevation,
      scrolledUnderElevation: scrolledUnderElevation ?? elevation,
      systemOverlayStyle: overlayStyle,
      leading: leading,
      actions: actions,
      pinned: true,
      expandedHeight: 112,
      flexibleSpace: FlexibleSpaceBar(
        titlePadding: EdgeInsets.only(
          left: UbiSpacing.lg,
          bottom: UbiSpacing.md,
        ),
        title: Text(
          title ?? '',
          style: UbiTypography.headingLarge.copyWith(
            color: foregroundColor,
          ),
        ),
        centerTitle: false,
      ),
      bottom: bottom,
    );
  }
}

/// Back button widget
class _UbiBackButton extends StatelessWidget {
  const _UbiBackButton({
    required this.onPressed,
    required this.color,
  });

  final VoidCallback onPressed;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onPressed,
      icon: Icon(Icons.arrow_back_ios, color: color, size: 22),
      tooltip: MaterialLocalizations.of(context).backButtonTooltip,
    );
  }
}

/// UBI App Bar Action Button
///
/// A standardized action button for use in app bar actions.
class UbiAppBarAction extends StatelessWidget {
  const UbiAppBarAction({
    super.key,
    required this.icon,
    required this.onPressed,
    this.badge,
    this.tooltip,
    this.color,
  });

  final IconData icon;
  final VoidCallback onPressed;
  final int? badge;
  final String? tooltip;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    final iconColor = color ?? (isDark ? UbiColors.ubiWhite : UbiColors.gray900);

    Widget iconWidget = Icon(icon, color: iconColor, size: 24);

    if (badge != null && badge! > 0) {
      iconWidget = Stack(
        clipBehavior: Clip.none,
        children: [
          iconWidget,
          Positioned(
            right: -4,
            top: -4,
            child: Container(
              padding: EdgeInsets.all(badge! > 9 ? 3 : 5),
              decoration: BoxDecoration(
                color: UbiColors.ubiBitesColor,
                shape: BoxShape.circle,
              ),
              constraints: BoxConstraints(minWidth: 18, minHeight: 18),
              child: Text(
                badge! > 99 ? '99+' : badge.toString(),
                style: UbiTypography.caption.copyWith(
                  color: UbiColors.ubiWhite,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                ),
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ],
      );
    }

    return IconButton(
      onPressed: onPressed,
      icon: iconWidget,
      tooltip: tooltip,
    );
  }
}
