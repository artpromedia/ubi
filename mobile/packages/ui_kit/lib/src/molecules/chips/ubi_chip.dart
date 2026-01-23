import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';

/// UBI Chip Variants
enum UbiChipVariant {
  /// Filled chip with solid background
  filled,

  /// Outlined chip with border
  outlined,

  /// Subtle chip with light background
  subtle,
}

/// UBI Chip Sizes
enum UbiChipSize {
  /// Small chip (height: 24)
  small,

  /// Medium chip (height: 32)
  medium,

  /// Large chip (height: 40)
  large,
}

/// UBI Chip
///
/// A compact element for displaying tags, filters, or selections.
/// Supports selection, deletion, and various visual styles.
class UbiChip extends StatelessWidget {
  const UbiChip({
    super.key,
    required this.label,
    this.variant = UbiChipVariant.outlined,
    this.size = UbiChipSize.medium,
    this.isSelected = false,
    this.isDisabled = false,
    this.leadingIcon,
    this.leadingWidget,
    this.onTap,
    this.onDelete,
    this.selectedColor,
    this.backgroundColor,
    this.textColor,
    this.borderColor,
    this.semanticsLabel,
  });

  /// Chip label text
  final String label;

  /// Chip variant style
  final UbiChipVariant variant;

  /// Chip size
  final UbiChipSize size;

  /// Whether the chip is selected
  final bool isSelected;

  /// Whether the chip is disabled
  final bool isDisabled;

  /// Optional leading icon
  final IconData? leadingIcon;

  /// Optional leading widget (overrides leadingIcon)
  final Widget? leadingWidget;

  /// Callback when chip is tapped
  final VoidCallback? onTap;

  /// Callback when delete button is pressed
  final VoidCallback? onDelete;

  /// Color when selected
  final Color? selectedColor;

  /// Custom background color
  final Color? backgroundColor;

  /// Custom text color
  final Color? textColor;

  /// Custom border color
  final Color? borderColor;

  /// Accessibility label
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final effectiveSelectedColor = selectedColor ?? UbiColors.ubiGreen;

    // Calculate colors based on variant and state
    Color effectiveBackgroundColor;
    Color effectiveTextColor;
    Color? effectiveBorderColor;

    if (isDisabled) {
      effectiveBackgroundColor = isDark ? UbiColors.gray800 : UbiColors.gray200;
      effectiveTextColor = UbiColors.gray500;
      effectiveBorderColor = variant == UbiChipVariant.outlined
          ? UbiColors.gray400
          : null;
    } else if (isSelected) {
      effectiveBackgroundColor = backgroundColor ?? effectiveSelectedColor;
      effectiveTextColor = textColor ?? UbiColors.ubiWhite;
      effectiveBorderColor = borderColor ?? effectiveSelectedColor;
    } else {
      switch (variant) {
        case UbiChipVariant.filled:
          effectiveBackgroundColor = backgroundColor ??
              (isDark ? UbiColors.gray700 : UbiColors.gray200);
          effectiveTextColor = textColor ??
              (isDark ? UbiColors.ubiWhite : UbiColors.gray900);
          break;
        case UbiChipVariant.outlined:
          effectiveBackgroundColor = Colors.transparent;
          effectiveTextColor = textColor ??
              (isDark ? UbiColors.ubiWhite : UbiColors.gray900);
          effectiveBorderColor = borderColor ??
              (isDark ? UbiColors.gray600 : UbiColors.gray300);
          break;
        case UbiChipVariant.subtle:
          effectiveBackgroundColor = backgroundColor ??
              (isDark
                  ? UbiColors.gray800.withValues(alpha: 0.5)
                  : UbiColors.gray100);
          effectiveTextColor = textColor ??
              (isDark ? UbiColors.ubiWhite : UbiColors.gray700);
          break;
      }
    }

    // Size-specific properties
    final chipHeight = _getHeight();
    final horizontalPadding = _getHorizontalPadding();
    final iconSize = _getIconSize();
    final textStyle = _getTextStyle();
    final borderRadius = _getBorderRadius();

    Widget content = Container(
      height: chipHeight,
      padding: EdgeInsets.symmetric(horizontal: horizontalPadding),
      decoration: BoxDecoration(
        color: effectiveBackgroundColor,
        borderRadius: borderRadius,
        border: effectiveBorderColor != null
            ? Border.all(color: effectiveBorderColor, width: 1)
            : null,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (leadingWidget != null) ...[
            leadingWidget!,
            SizedBox(width: UbiSpacing.xs),
          ] else if (leadingIcon != null) ...[
            Icon(
              leadingIcon,
              size: iconSize,
              color: effectiveTextColor,
            ),
            SizedBox(width: UbiSpacing.xs),
          ],
          Text(
            label,
            style: textStyle.copyWith(color: effectiveTextColor),
          ),
          if (onDelete != null) ...[
            SizedBox(width: UbiSpacing.xs),
            GestureDetector(
              onTap: isDisabled ? null : onDelete,
              child: Icon(
                Icons.close,
                size: iconSize,
                color: effectiveTextColor.withValues(alpha: 0.7),
              ),
            ),
          ],
        ],
      ),
    );

    if (onTap != null && !isDisabled) {
      content = Semantics(
        label: semanticsLabel ?? label,
        selected: isSelected,
        enabled: !isDisabled,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: onTap,
            borderRadius: borderRadius,
            child: content,
          ),
        ),
      );
    }

    return content;
  }

  double _getHeight() {
    switch (size) {
      case UbiChipSize.small:
        return 24;
      case UbiChipSize.medium:
        return 32;
      case UbiChipSize.large:
        return 40;
    }
  }

  double _getHorizontalPadding() {
    switch (size) {
      case UbiChipSize.small:
        return UbiSpacing.sm;
      case UbiChipSize.medium:
        return UbiSpacing.md;
      case UbiChipSize.large:
        return UbiSpacing.md + UbiSpacing.xs;
    }
  }

  double _getIconSize() {
    switch (size) {
      case UbiChipSize.small:
        return 14;
      case UbiChipSize.medium:
        return 16;
      case UbiChipSize.large:
        return 18;
    }
  }

  TextStyle _getTextStyle() {
    switch (size) {
      case UbiChipSize.small:
        return UbiTypography.caption;
      case UbiChipSize.medium:
        return UbiTypography.bodySmall;
      case UbiChipSize.large:
        return UbiTypography.bodyMedium;
    }
  }

  BorderRadius _getBorderRadius() {
    switch (size) {
      case UbiChipSize.small:
        return BorderRadius.circular(12);
      case UbiChipSize.medium:
        return BorderRadius.circular(16);
      case UbiChipSize.large:
        return BorderRadius.circular(20);
    }
  }
}

/// UBI Filter Chip Group
///
/// A horizontal scrollable group of filter chips with single or multi-select.
class UbiFilterChipGroup extends StatelessWidget {
  const UbiFilterChipGroup({
    super.key,
    required this.items,
    required this.selectedIndices,
    required this.onSelectionChanged,
    this.allowMultiple = false,
    this.variant = UbiChipVariant.outlined,
    this.size = UbiChipSize.medium,
    this.spacing = 8,
    this.scrollable = true,
    this.padding,
  });

  /// List of chip labels
  final List<String> items;

  /// Currently selected indices
  final Set<int> selectedIndices;

  /// Callback when selection changes
  final ValueChanged<Set<int>> onSelectionChanged;

  /// Whether multiple selection is allowed
  final bool allowMultiple;

  /// Chip variant
  final UbiChipVariant variant;

  /// Chip size
  final UbiChipSize size;

  /// Spacing between chips
  final double spacing;

  /// Whether the group is horizontally scrollable
  final bool scrollable;

  /// External padding
  final EdgeInsets? padding;

  @override
  Widget build(BuildContext context) {
    Widget content = Wrap(
      spacing: spacing,
      runSpacing: spacing,
      children: List.generate(items.length, (index) {
        final isSelected = selectedIndices.contains(index);
        return UbiChip(
          label: items[index],
          variant: variant,
          size: size,
          isSelected: isSelected,
          onTap: () {
            Set<int> newSelection;
            if (allowMultiple) {
              newSelection = Set.from(selectedIndices);
              if (isSelected) {
                newSelection.remove(index);
              } else {
                newSelection.add(index);
              }
            } else {
              newSelection = isSelected ? {} : {index};
            }
            onSelectionChanged(newSelection);
          },
        );
      }),
    );

    if (scrollable) {
      content = SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: padding ?? EdgeInsets.symmetric(horizontal: UbiSpacing.md),
        child: content,
      );
    } else if (padding != null) {
      content = Padding(padding: padding!, child: content);
    }

    return content;
  }
}
