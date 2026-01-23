import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';

/// UBI List Tile Variants
enum UbiListTileVariant {
  /// Default list tile
  standard,

  /// Compact list tile with reduced padding
  compact,

  /// Large list tile with expanded content area
  large,

  /// Navigation style with chevron
  navigation,
}

/// UBI List Tile
///
/// A versatile list tile component for displaying items in lists.
/// Supports leading/trailing widgets, subtitles, and various states.
class UbiListTile extends StatelessWidget {
  const UbiListTile({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.variant = UbiListTileVariant.standard,
    this.onTap,
    this.onLongPress,
    this.isSelected = false,
    this.isDisabled = false,
    this.showDivider = false,
    this.backgroundColor,
    this.selectedColor,
    this.padding,
    this.borderRadius,
    this.semanticsLabel,
  });

  /// Primary text content
  final String title;

  /// Secondary text content
  final String? subtitle;

  /// Widget displayed at the start
  final Widget? leading;

  /// Widget displayed at the end
  final Widget? trailing;

  /// Tile variant
  final UbiListTileVariant variant;

  /// Callback when tile is tapped
  final VoidCallback? onTap;

  /// Callback when tile is long pressed
  final VoidCallback? onLongPress;

  /// Whether the tile is selected
  final bool isSelected;

  /// Whether the tile is disabled
  final bool isDisabled;

  /// Whether to show a bottom divider
  final bool showDivider;

  /// Custom background color
  final Color? backgroundColor;

  /// Color when selected
  final Color? selectedColor;

  /// Custom padding
  final EdgeInsets? padding;

  /// Custom border radius
  final BorderRadius? borderRadius;

  /// Accessibility label
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final effectivePadding = padding ?? _getPaddingForVariant();
    final effectiveBorderRadius = borderRadius ?? UbiRadius.smRadius;

    // Determine background color
    Color effectiveBackgroundColor;
    if (isSelected) {
      effectiveBackgroundColor = selectedColor ?? 
        UbiColors.ubiGreen.withValues(alpha: 0.1);
    } else {
      effectiveBackgroundColor = backgroundColor ?? 
        (isDark ? UbiColors.gray900 : UbiColors.ubiWhite);
    }

    // Determine text colors
    final titleColor = isDisabled
        ? UbiColors.gray500
        : (isDark ? UbiColors.ubiWhite : UbiColors.gray900);
    final subtitleColor = isDisabled
        ? UbiColors.gray400
        : UbiColors.gray500;

    // Build trailing widget based on variant
    Widget? effectiveTrailing = trailing;
    if (variant == UbiListTileVariant.navigation && trailing == null) {
      effectiveTrailing = Icon(
        Icons.chevron_right,
        color: isDisabled ? UbiColors.gray400 : UbiColors.gray500,
        size: 24,
      );
    }

    Widget content = Container(
      padding: effectivePadding,
      decoration: BoxDecoration(
        color: effectiveBackgroundColor,
        borderRadius: effectiveBorderRadius,
        border: isSelected
            ? Border.all(color: UbiColors.ubiGreen, width: 1.5)
            : null,
      ),
      child: Row(
        children: [
          if (leading != null) ...[
            leading!,
            SizedBox(width: UbiSpacing.md),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: _getTitleStyle().copyWith(color: titleColor),
                  maxLines: variant == UbiListTileVariant.large ? 2 : 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null) ...[
                  SizedBox(height: UbiSpacing.xxs),
                  Text(
                    subtitle!,
                    style: UbiTypography.bodySmall.copyWith(color: subtitleColor),
                    maxLines: variant == UbiListTileVariant.large ? 3 : 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
          if (effectiveTrailing != null) ...[
            SizedBox(width: UbiSpacing.sm),
            effectiveTrailing,
          ],
        ],
      ),
    );

    // Wrap with gesture detector if interactive
    if (onTap != null || onLongPress != null) {
      content = Semantics(
        label: semanticsLabel ?? title,
        enabled: !isDisabled,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: isDisabled ? null : onTap,
            onLongPress: isDisabled ? null : onLongPress,
            borderRadius: effectiveBorderRadius,
            child: content,
          ),
        ),
      );
    }

    // Add divider if needed
    if (showDivider) {
      content = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          content,
          Divider(
            height: 1,
            thickness: 1,
            color: isDark ? UbiColors.gray800 : UbiColors.gray200,
            indent: leading != null ? (effectivePadding.left + 40 + UbiSpacing.md) : effectivePadding.left,
            endIndent: effectivePadding.right,
          ),
        ],
      );
    }

    return content;
  }

  EdgeInsets _getPaddingForVariant() {
    switch (variant) {
      case UbiListTileVariant.compact:
        return EdgeInsets.symmetric(
          horizontal: UbiSpacing.md,
          vertical: UbiSpacing.sm,
        );
      case UbiListTileVariant.large:
        return EdgeInsets.all(UbiSpacing.lg);
      case UbiListTileVariant.standard:
      case UbiListTileVariant.navigation:
      default:
        return EdgeInsets.symmetric(
          horizontal: UbiSpacing.md,
          vertical: UbiSpacing.sm + UbiSpacing.xs,
        );
    }
  }

  TextStyle _getTitleStyle() {
    switch (variant) {
      case UbiListTileVariant.compact:
        return UbiTypography.bodySmall.copyWith(fontWeight: FontWeight.w500);
      case UbiListTileVariant.large:
        return UbiTypography.bodyLarge.copyWith(fontWeight: FontWeight.w600);
      case UbiListTileVariant.standard:
      case UbiListTileVariant.navigation:
      default:
        return UbiTypography.bodyMedium.copyWith(fontWeight: FontWeight.w500);
    }
  }
}

/// UBI Selectable List Tile
///
/// A list tile with built-in selection support (checkbox/radio).
class UbiSelectableListTile extends StatelessWidget {
  const UbiSelectableListTile({
    super.key,
    required this.title,
    required this.isSelected,
    required this.onChanged,
    this.subtitle,
    this.leading,
    this.selectionType = SelectionType.checkbox,
    this.isDisabled = false,
    this.showDivider = false,
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final bool isSelected;
  final ValueChanged<bool> onChanged;
  final SelectionType selectionType;
  final bool isDisabled;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    Widget selectionWidget;
    if (selectionType == SelectionType.checkbox) {
      selectionWidget = Checkbox(
        value: isSelected,
        onChanged: isDisabled ? null : (value) => onChanged(value ?? false),
        activeColor: UbiColors.ubiGreen,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
      );
    } else {
      selectionWidget = Radio<bool>(
        value: true,
        groupValue: isSelected ? true : false,
        onChanged: isDisabled ? null : (value) => onChanged(value ?? false),
        activeColor: UbiColors.ubiGreen,
      );
    }

    return UbiListTile(
      title: title,
      subtitle: subtitle,
      leading: leading,
      trailing: selectionWidget,
      isSelected: isSelected,
      isDisabled: isDisabled,
      showDivider: showDivider,
      onTap: isDisabled ? null : () => onChanged(!isSelected),
    );
  }
}

enum SelectionType { checkbox, radio }
