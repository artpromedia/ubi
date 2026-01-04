import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_typography.dart';
import '../../theme/ubi_spacing.dart';

/// UBI Badge Variant
enum UbiBadgeVariant {
  /// Primary green badge
  primary,
  
  /// Secondary gray badge
  secondary,
  
  /// Success badge
  success,
  
  /// Error/danger badge
  error,
  
  /// Warning badge
  warning,
  
  /// Info badge
  info,
  
  /// Ride service badge
  ride,
  
  /// Food service badge
  food,
  
  /// Delivery service badge
  delivery,
}

/// UBI Badge Size
enum UbiBadgeSize {
  /// Small badge
  small,
  
  /// Medium badge
  medium,
  
  /// Large badge
  large,
}

/// UBI Badge
///
/// A badge component for displaying status, counts, or labels.
class UbiBadge extends StatelessWidget {
  const UbiBadge({
    super.key,
    this.label,
    this.count,
    this.variant = UbiBadgeVariant.primary,
    this.size = UbiBadgeSize.medium,
    this.icon,
    this.isDot = false,
    this.isOutlined = false,
    this.maxCount = 99,
    this.backgroundColor,
    this.foregroundColor,
    this.borderColor,
    this.semanticsLabel,
  });

  /// Text label
  final String? label;

  /// Numeric count to display
  final int? count;

  /// Badge variant
  final UbiBadgeVariant variant;

  /// Badge size
  final UbiBadgeSize size;

  /// Optional icon
  final IconData? icon;

  /// Whether to show as a simple dot
  final bool isDot;

  /// Whether to show outlined style
  final bool isOutlined;

  /// Maximum count before showing +
  final int maxCount;

  /// Custom background color
  final Color? backgroundColor;

  /// Custom foreground color
  final Color? foregroundColor;

  /// Custom border color (for outlined)
  final Color? borderColor;

  /// Semantics label for accessibility
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    final colors = _getColors(isDark);
    final sizeConfig = _getSizeConfig();

    // Dot badge
    if (isDot) {
      return Semantics(
        label: semanticsLabel ?? 'Notification indicator',
        child: Container(
          width: sizeConfig.dotSize,
          height: sizeConfig.dotSize,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: colors.background,
            border: isOutlined
                ? Border.all(color: colors.border, width: 1)
                : null,
          ),
        ),
      );
    }

    // Determine content
    String? displayText;
    if (count != null) {
      displayText = count! > maxCount ? '$maxCount+' : count.toString();
    } else if (label != null) {
      displayText = label;
    }

    // Count badge (circular)
    if (count != null && label == null && icon == null) {
      return Semantics(
        label: semanticsLabel ?? 'Count: ${displayText ?? count}',
        child: Container(
          constraints: BoxConstraints(
            minWidth: sizeConfig.minCountSize,
            minHeight: sizeConfig.minCountSize,
          ),
          padding: EdgeInsets.symmetric(
            horizontal: displayText!.length > 2 ? sizeConfig.countPaddingH : 0,
          ),
          decoration: BoxDecoration(
            color: isOutlined ? Colors.transparent : colors.background,
            borderRadius: BorderRadius.circular(sizeConfig.minCountSize / 2),
            border: isOutlined
                ? Border.all(color: colors.border, width: 1.5)
                : null,
          ),
          alignment: Alignment.center,
          child: Text(
            displayText,
            style: sizeConfig.countTextStyle.copyWith(
              color: isOutlined ? colors.border : colors.foreground,
            ),
          ),
        ),
      );
    }

    // Label badge (pill shaped)
    return Semantics(
      label: semanticsLabel ?? label ?? 'Badge',
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: sizeConfig.paddingH,
          vertical: sizeConfig.paddingV,
        ),
        decoration: BoxDecoration(
          color: isOutlined ? Colors.transparent : colors.background,
          borderRadius: BorderRadius.circular(sizeConfig.borderRadius),
          border: isOutlined
              ? Border.all(color: colors.border, width: 1.5)
              : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(
                icon,
                size: sizeConfig.iconSize,
                color: isOutlined ? colors.border : colors.foreground,
              ),
              if (displayText != null) SizedBox(width: UbiSpacing.xxs),
            ],
            if (displayText != null)
              Text(
                displayText,
                style: sizeConfig.textStyle.copyWith(
                  color: isOutlined ? colors.border : colors.foreground,
                ),
              ),
          ],
        ),
      ),
    );
  }

  _BadgeColors _getColors(bool isDark) {
    Color bg;
    Color fg;
    Color border;

    switch (variant) {
      case UbiBadgeVariant.primary:
        bg = backgroundColor ?? UbiColors.ubiGreen;
        fg = foregroundColor ?? UbiColors.white;
        border = borderColor ?? UbiColors.ubiGreen;
        break;
      case UbiBadgeVariant.secondary:
        bg = backgroundColor ?? (isDark ? UbiColors.gray700 : UbiColors.gray200);
        fg = foregroundColor ?? (isDark ? UbiColors.textPrimaryDark : UbiColors.textPrimary);
        border = borderColor ?? (isDark ? UbiColors.gray600 : UbiColors.gray400);
        break;
      case UbiBadgeVariant.success:
        bg = backgroundColor ?? (isDark ? UbiColors.successDark : UbiColors.success);
        fg = foregroundColor ?? UbiColors.white;
        border = borderColor ?? (isDark ? UbiColors.successDark : UbiColors.success);
        break;
      case UbiBadgeVariant.error:
        bg = backgroundColor ?? UbiColors.error;
        fg = foregroundColor ?? UbiColors.white;
        border = borderColor ?? UbiColors.error;
        break;
      case UbiBadgeVariant.warning:
        bg = backgroundColor ?? UbiColors.warning;
        fg = foregroundColor ?? UbiColors.white;
        border = borderColor ?? UbiColors.warning;
        break;
      case UbiBadgeVariant.info:
        bg = backgroundColor ?? UbiColors.info;
        fg = foregroundColor ?? UbiColors.white;
        border = borderColor ?? UbiColors.info;
        break;
      case UbiBadgeVariant.ride:
        bg = backgroundColor ?? UbiColors.serviceRide;
        fg = foregroundColor ?? UbiColors.white;
        border = borderColor ?? UbiColors.serviceRide;
        break;
      case UbiBadgeVariant.food:
        bg = backgroundColor ?? UbiColors.serviceFood;
        fg = foregroundColor ?? UbiColors.white;
        border = borderColor ?? UbiColors.serviceFood;
        break;
      case UbiBadgeVariant.delivery:
        bg = backgroundColor ?? UbiColors.serviceDelivery;
        fg = foregroundColor ?? UbiColors.white;
        border = borderColor ?? UbiColors.serviceDelivery;
        break;
    }

    return _BadgeColors(background: bg, foreground: fg, border: border);
  }

  _BadgeSizeConfig _getSizeConfig() {
    switch (size) {
      case UbiBadgeSize.small:
        return _BadgeSizeConfig(
          paddingH: 6,
          paddingV: 2,
          borderRadius: 4,
          iconSize: 12,
          textStyle: UbiTypography.caption.copyWith(
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
          countTextStyle: UbiTypography.caption.copyWith(
            fontSize: 10,
            fontWeight: FontWeight.w700,
          ),
          dotSize: 6,
          minCountSize: 16,
          countPaddingH: 4,
        );
      case UbiBadgeSize.medium:
        return _BadgeSizeConfig(
          paddingH: 8,
          paddingV: 4,
          borderRadius: 6,
          iconSize: 14,
          textStyle: UbiTypography.caption.copyWith(
            fontWeight: FontWeight.w600,
          ),
          countTextStyle: UbiTypography.caption.copyWith(
            fontWeight: FontWeight.w700,
          ),
          dotSize: 8,
          minCountSize: 20,
          countPaddingH: 6,
        );
      case UbiBadgeSize.large:
        return _BadgeSizeConfig(
          paddingH: 12,
          paddingV: 6,
          borderRadius: 8,
          iconSize: 16,
          textStyle: UbiTypography.body2.copyWith(
            fontWeight: FontWeight.w600,
          ),
          countTextStyle: UbiTypography.body2.copyWith(
            fontWeight: FontWeight.w700,
          ),
          dotSize: 10,
          minCountSize: 24,
          countPaddingH: 8,
        );
    }
  }
}

class _BadgeColors {
  final Color background;
  final Color foreground;
  final Color border;

  const _BadgeColors({
    required this.background,
    required this.foreground,
    required this.border,
  });
}

class _BadgeSizeConfig {
  final double paddingH;
  final double paddingV;
  final double borderRadius;
  final double iconSize;
  final TextStyle textStyle;
  final TextStyle countTextStyle;
  final double dotSize;
  final double minCountSize;
  final double countPaddingH;

  const _BadgeSizeConfig({
    required this.paddingH,
    required this.paddingV,
    required this.borderRadius,
    required this.iconSize,
    required this.textStyle,
    required this.countTextStyle,
    required this.dotSize,
    required this.minCountSize,
    required this.countPaddingH,
  });
}

/// UBI Status Badge
///
/// A specialized badge for status indicators.
class UbiStatusBadge extends StatelessWidget {
  const UbiStatusBadge({
    super.key,
    required this.status,
    this.size = UbiBadgeSize.medium,
    this.showDot = true,
  });

  /// Status type
  final UbiStatus status;

  /// Badge size
  final UbiBadgeSize size;

  /// Whether to show status dot
  final bool showDot;

  @override
  Widget build(BuildContext context) {
    return UbiBadge(
      label: status.label,
      variant: status.variant,
      size: size,
      icon: showDot ? Icons.circle : null,
    );
  }
}

/// Status types with pre-defined labels and variants
enum UbiStatus {
  pending('Pending', UbiBadgeVariant.warning),
  active('Active', UbiBadgeVariant.success),
  completed('Completed', UbiBadgeVariant.primary),
  cancelled('Cancelled', UbiBadgeVariant.error),
  inProgress('In Progress', UbiBadgeVariant.info),
  scheduled('Scheduled', UbiBadgeVariant.secondary),
  online('Online', UbiBadgeVariant.success),
  offline('Offline', UbiBadgeVariant.secondary),
  busy('Busy', UbiBadgeVariant.warning);

  const UbiStatus(this.label, this.variant);

  final String label;
  final UbiBadgeVariant variant;
}
