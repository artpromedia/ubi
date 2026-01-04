import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_shadows.dart';
import '../../theme/ubi_spacing.dart';

/// UBI Card Variant
enum UbiCardVariant {
  /// Default card with subtle border
  outlined,
  
  /// Elevated card with shadow
  elevated,
  
  /// Filled card with background color
  filled,
  
  /// Flat card without border or shadow
  flat,
}

/// UBI Card
///
/// A versatile card component that follows the UBI design system.
class UbiCard extends StatelessWidget {
  const UbiCard({
    super.key,
    required this.child,
    this.variant = UbiCardVariant.outlined,
    this.padding,
    this.margin,
    this.backgroundColor,
    this.borderColor,
    this.borderRadius,
    this.elevation,
    this.shadowColor,
    this.onTap,
    this.onLongPress,
    this.isSelected = false,
    this.isDisabled = false,
    this.clipBehavior = Clip.antiAlias,
    this.semanticsLabel,
  });

  /// Card content
  final Widget child;

  /// Card variant
  final UbiCardVariant variant;

  /// Internal padding
  final EdgeInsets? padding;

  /// External margin
  final EdgeInsets? margin;

  /// Custom background color
  final Color? backgroundColor;

  /// Custom border color
  final Color? borderColor;

  /// Custom border radius
  final BorderRadius? borderRadius;

  /// Custom elevation (for elevated variant)
  final double? elevation;

  /// Custom shadow color
  final Color? shadowColor;

  /// Callback when card is tapped
  final VoidCallback? onTap;

  /// Callback when card is long pressed
  final VoidCallback? onLongPress;

  /// Whether the card is selected
  final bool isSelected;

  /// Whether the card is disabled
  final bool isDisabled;

  /// Clip behavior
  final Clip clipBehavior;

  /// Semantics label for accessibility
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final effectiveBorderRadius = borderRadius ?? UbiRadius.cardRadius;
    final effectivePadding = padding ?? EdgeInsets.all(UbiSpacing.md);
    final effectiveMargin = margin;

    // Determine colors based on variant and state
    Color effectiveBackgroundColor;
    Color? effectiveBorderColor;
    List<BoxShadow>? effectiveShadow;

    switch (variant) {
      case UbiCardVariant.outlined:
        effectiveBackgroundColor = backgroundColor ??
            (isDark ? UbiColors.cardDark : UbiColors.white);
        effectiveBorderColor = isSelected
            ? UbiColors.ubiGreen
            : (borderColor ?? (isDark ? UbiColors.borderDark : UbiColors.border));
        break;

      case UbiCardVariant.elevated:
        effectiveBackgroundColor = backgroundColor ??
            (isDark ? UbiColors.cardDark : UbiColors.white);
        effectiveShadow = isDark ? UbiShadows.cardDark : UbiShadows.card;
        if (isSelected) {
          effectiveBorderColor = UbiColors.ubiGreen;
        }
        break;

      case UbiCardVariant.filled:
        effectiveBackgroundColor = backgroundColor ??
            (isDark ? UbiColors.gray800 : UbiColors.gray50);
        if (isSelected) {
          effectiveBorderColor = UbiColors.ubiGreen;
        }
        break;

      case UbiCardVariant.flat:
        effectiveBackgroundColor = backgroundColor ?? Colors.transparent;
        if (isSelected) {
          effectiveBorderColor = UbiColors.ubiGreen;
        }
        break;
    }

    // Apply disabled state
    if (isDisabled) {
      effectiveBackgroundColor = effectiveBackgroundColor.withValues(alpha: 0.5);
    }

    Widget card = Container(
      margin: effectiveMargin,
      decoration: BoxDecoration(
        color: effectiveBackgroundColor,
        borderRadius: effectiveBorderRadius,
        border: effectiveBorderColor != null
            ? Border.all(
                color: effectiveBorderColor,
                width: isSelected ? 2 : 1,
              )
            : null,
        boxShadow: effectiveShadow,
      ),
      clipBehavior: clipBehavior,
      child: Padding(
        padding: effectivePadding,
        child: child,
      ),
    );

    // Add tap handling
    if (onTap != null || onLongPress != null) {
      card = Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: isDisabled ? null : onTap,
          onLongPress: isDisabled ? null : onLongPress,
          borderRadius: effectiveBorderRadius,
          child: card,
        ),
      );
    }

    return Semantics(
      label: semanticsLabel,
      button: onTap != null,
      enabled: !isDisabled,
      selected: isSelected,
      child: card,
    );
  }
}

/// UBI Interactive Card
///
/// A card with built-in press animation.
class UbiInteractiveCard extends StatefulWidget {
  const UbiInteractiveCard({
    super.key,
    required this.child,
    this.onTap,
    this.onLongPress,
    this.variant = UbiCardVariant.outlined,
    this.padding,
    this.margin,
    this.backgroundColor,
    this.borderColor,
    this.borderRadius,
    this.isDisabled = false,
    this.scaleOnPress = 0.98,
    this.semanticsLabel,
  });

  /// Card content
  final Widget child;

  /// Callback when card is tapped
  final VoidCallback? onTap;

  /// Callback when card is long pressed
  final VoidCallback? onLongPress;

  /// Card variant
  final UbiCardVariant variant;

  /// Internal padding
  final EdgeInsets? padding;

  /// External margin
  final EdgeInsets? margin;

  /// Custom background color
  final Color? backgroundColor;

  /// Custom border color
  final Color? borderColor;

  /// Custom border radius
  final BorderRadius? borderRadius;

  /// Whether the card is disabled
  final bool isDisabled;

  /// Scale factor when pressed
  final double scaleOnPress;

  /// Semantics label for accessibility
  final String? semanticsLabel;

  @override
  State<UbiInteractiveCard> createState() => _UbiInteractiveCardState();
}

class _UbiInteractiveCardState extends State<UbiInteractiveCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 100),
    );
    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: widget.scaleOnPress,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeInOut,
    ));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _handleTapDown(TapDownDetails details) {
    if (!widget.isDisabled) {
      _controller.forward();
    }
  }

  void _handleTapUp(TapUpDetails details) {
    _controller.reverse();
  }

  void _handleTapCancel() {
    _controller.reverse();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: _handleTapDown,
      onTapUp: _handleTapUp,
      onTapCancel: _handleTapCancel,
      onTap: widget.isDisabled ? null : widget.onTap,
      onLongPress: widget.isDisabled ? null : widget.onLongPress,
      child: ScaleTransition(
        scale: _scaleAnimation,
        child: UbiCard(
          variant: widget.variant,
          padding: widget.padding,
          margin: widget.margin,
          backgroundColor: widget.backgroundColor,
          borderColor: widget.borderColor,
          borderRadius: widget.borderRadius,
          isDisabled: widget.isDisabled,
          semanticsLabel: widget.semanticsLabel,
          child: widget.child,
        ),
      ),
    );
  }
}

/// UBI Service Card
///
/// A specialized card for service selection (Ride, Food, Delivery).
class UbiServiceCard extends StatelessWidget {
  const UbiServiceCard({
    super.key,
    required this.title,
    required this.icon,
    required this.serviceColor,
    this.subtitle,
    this.onTap,
    this.isSelected = false,
    this.isDisabled = false,
  });

  /// Service title
  final String title;

  /// Service icon
  final IconData icon;

  /// Service brand color
  final Color serviceColor;

  /// Optional subtitle
  final String? subtitle;

  /// Callback when card is tapped
  final VoidCallback? onTap;

  /// Whether the card is selected
  final bool isSelected;

  /// Whether the card is disabled
  final bool isDisabled;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return UbiInteractiveCard(
      onTap: isDisabled ? null : onTap,
      isDisabled: isDisabled,
      borderColor: isSelected ? serviceColor : null,
      backgroundColor: isSelected
          ? serviceColor.withValues(alpha: isDark ? 0.2 : 0.1)
          : null,
      padding: EdgeInsets.all(UbiSpacing.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: serviceColor.withValues(alpha: isDark ? 0.3 : 0.15),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(
              icon,
              size: 28,
              color: serviceColor,
            ),
          ),
          SizedBox(height: UbiSpacing.sm),
          Text(
            title,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: isDark ? UbiColors.textPrimaryDark : UbiColors.textPrimary,
            ),
          ),
          if (subtitle != null) ...[
            SizedBox(height: UbiSpacing.xxs),
            Text(
              subtitle!,
              style: TextStyle(
                fontSize: 12,
                color: isDark
                    ? UbiColors.textSecondaryDark
                    : UbiColors.textSecondary,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }
}

/// UBI Info Card
///
/// A card for displaying key-value information.
class UbiInfoCard extends StatelessWidget {
  const UbiInfoCard({
    super.key,
    required this.items,
    this.title,
    this.variant = UbiCardVariant.outlined,
    this.dividerBetweenItems = true,
  });

  /// List of info items
  final List<UbiInfoItem> items;

  /// Optional card title
  final String? title;

  /// Card variant
  final UbiCardVariant variant;

  /// Whether to show divider between items
  final bool dividerBetweenItems;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return UbiCard(
      variant: variant,
      padding: EdgeInsets.all(UbiSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Text(
              title!,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: isDark
                    ? UbiColors.textSecondaryDark
                    : UbiColors.textSecondary,
              ),
            ),
            SizedBox(height: UbiSpacing.md),
          ],
          ...items.asMap().entries.map((entry) {
            final index = entry.key;
            final item = entry.value;
            final isLast = index == items.length - 1;

            return Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    if (item.icon != null) ...[
                      Icon(
                        item.icon,
                        size: 20,
                        color: item.iconColor ??
                            (isDark
                                ? UbiColors.textSecondaryDark
                                : UbiColors.textSecondary),
                      ),
                      SizedBox(width: UbiSpacing.sm),
                    ],
                    Expanded(
                      child: Text(
                        item.label,
                        style: TextStyle(
                          fontSize: 14,
                          color: isDark
                              ? UbiColors.textSecondaryDark
                              : UbiColors.textSecondary,
                        ),
                      ),
                    ),
                    Text(
                      item.value,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: item.isHighlighted ? FontWeight.w600 : FontWeight.w500,
                        color: item.valueColor ??
                            (isDark
                                ? UbiColors.textPrimaryDark
                                : UbiColors.textPrimary),
                      ),
                    ),
                  ],
                ),
                if (!isLast && dividerBetweenItems) ...[
                  SizedBox(height: UbiSpacing.sm),
                  Divider(
                    color: isDark ? UbiColors.dividerDark : UbiColors.divider,
                  ),
                  SizedBox(height: UbiSpacing.sm),
                ] else if (!isLast) ...[
                  SizedBox(height: UbiSpacing.md),
                ],
              ],
            );
          }),
        ],
      ),
    );
  }
}

/// Data class for info card items
class UbiInfoItem {
  const UbiInfoItem({
    required this.label,
    required this.value,
    this.icon,
    this.iconColor,
    this.valueColor,
    this.isHighlighted = false,
  });

  /// Item label
  final String label;

  /// Item value
  final String value;

  /// Optional icon
  final IconData? icon;

  /// Icon color
  final Color? iconColor;

  /// Value text color
  final Color? valueColor;

  /// Whether value should be highlighted
  final bool isHighlighted;
}
