import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_typography.dart';
import '../../theme/ubi_spacing.dart';

/// UBI Button Variants
enum UbiButtonVariant {
  /// Primary filled button with brand color
  primary,
  
  /// Secondary filled button with black
  secondary,
  
  /// Outlined button
  outlined,
  
  /// Text only button
  text,
  
  /// Destructive/danger button
  danger,
  
  /// Success button
  success,
  
  /// Ghost button (transparent background)
  ghost,
}

/// UBI Button Sizes
enum UbiButtonSize {
  /// Small button (height: 36)
  small,
  
  /// Medium button (height: 44)
  medium,
  
  /// Large button (height: 52)
  large,
  
  /// Extra large button (height: 60)
  extraLarge,
}

/// UBI Button
///
/// A customizable button component that follows the UBI design system.
/// Supports multiple variants, sizes, and states.
class UbiButton extends StatelessWidget {
  const UbiButton({
    super.key,
    required this.label,
    this.onPressed,
    this.variant = UbiButtonVariant.primary,
    this.size = UbiButtonSize.large,
    this.isLoading = false,
    this.isExpanded = false,
    this.leadingIcon,
    this.trailingIcon,
    this.loadingWidget,
    this.disabled = false,
    this.elevation,
    this.borderRadius,
    this.padding,
    this.semanticsLabel,
  });

  /// Button label text
  final String label;

  /// Callback when button is pressed
  final VoidCallback? onPressed;

  /// Button style variant
  final UbiButtonVariant variant;

  /// Button size
  final UbiButtonSize size;

  /// Whether the button is in loading state
  final bool isLoading;

  /// Whether the button should expand to fill available width
  final bool isExpanded;

  /// Optional leading icon
  final IconData? leadingIcon;

  /// Optional trailing icon
  final IconData? trailingIcon;

  /// Custom loading widget
  final Widget? loadingWidget;

  /// Whether the button is disabled
  final bool disabled;

  /// Custom elevation
  final double? elevation;

  /// Custom border radius
  final BorderRadius? borderRadius;

  /// Custom padding
  final EdgeInsets? padding;

  /// Semantics label for accessibility
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    final isDisabled = disabled || isLoading || onPressed == null;
    
    final colors = _getColors(isDark);
    final sizeConfig = _getSizeConfig();
    
    Widget content = Row(
      mainAxisSize: isExpanded ? MainAxisSize.max : MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        if (isLoading) ...[
          loadingWidget ?? SizedBox(
            width: sizeConfig.iconSize,
            height: sizeConfig.iconSize,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              valueColor: AlwaysStoppedAnimation(colors.foreground),
            ),
          ),
          SizedBox(width: UbiSpacing.sm),
        ] else if (leadingIcon != null) ...[
          Icon(
            leadingIcon,
            size: sizeConfig.iconSize,
            color: isDisabled ? colors.disabledForeground : colors.foreground,
          ),
          SizedBox(width: UbiSpacing.sm),
        ],
        Text(
          label,
          style: sizeConfig.textStyle.copyWith(
            color: isDisabled ? colors.disabledForeground : colors.foreground,
          ),
        ),
        if (!isLoading && trailingIcon != null) ...[
          SizedBox(width: UbiSpacing.sm),
          Icon(
            trailingIcon,
            size: sizeConfig.iconSize,
            color: isDisabled ? colors.disabledForeground : colors.foreground,
          ),
        ],
      ],
    );

    final effectivePadding = padding ?? EdgeInsets.symmetric(
      horizontal: sizeConfig.horizontalPadding,
      vertical: sizeConfig.verticalPadding,
    );
    
    final effectiveBorderRadius = borderRadius ?? UbiRadius.buttonRadius;
    
    Widget button;
    
    switch (variant) {
      case UbiButtonVariant.primary:
      case UbiButtonVariant.secondary:
      case UbiButtonVariant.danger:
      case UbiButtonVariant.success:
        button = ElevatedButton(
          onPressed: isDisabled ? null : onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: isDisabled ? colors.disabledBackground : colors.background,
            foregroundColor: colors.foreground,
            elevation: elevation ?? (isDisabled ? 0 : 2),
            padding: effectivePadding,
            minimumSize: Size(0, sizeConfig.height),
            shape: RoundedRectangleBorder(borderRadius: effectiveBorderRadius),
            disabledBackgroundColor: colors.disabledBackground,
            disabledForegroundColor: colors.disabledForeground,
          ),
          child: content,
        );
        break;
        
      case UbiButtonVariant.outlined:
        button = OutlinedButton(
          onPressed: isDisabled ? null : onPressed,
          style: OutlinedButton.styleFrom(
            foregroundColor: colors.foreground,
            padding: effectivePadding,
            minimumSize: Size(0, sizeConfig.height),
            shape: RoundedRectangleBorder(borderRadius: effectiveBorderRadius),
            side: BorderSide(
              color: isDisabled ? colors.disabledBorder : colors.border,
              width: 1.5,
            ),
            disabledForegroundColor: colors.disabledForeground,
          ),
          child: content,
        );
        break;
        
      case UbiButtonVariant.text:
      case UbiButtonVariant.ghost:
        button = TextButton(
          onPressed: isDisabled ? null : onPressed,
          style: TextButton.styleFrom(
            foregroundColor: colors.foreground,
            backgroundColor: variant == UbiButtonVariant.ghost 
                ? Colors.transparent 
                : null,
            padding: effectivePadding,
            minimumSize: Size(0, sizeConfig.height),
            shape: RoundedRectangleBorder(borderRadius: effectiveBorderRadius),
            disabledForegroundColor: colors.disabledForeground,
          ),
          child: content,
        );
        break;
    }

    if (isExpanded) {
      button = SizedBox(
        width: double.infinity,
        child: button,
      );
    }

    return Semantics(
      label: semanticsLabel ?? label,
      button: true,
      enabled: !isDisabled,
      child: button,
    );
  }

  _ButtonColors _getColors(bool isDark) {
    switch (variant) {
      case UbiButtonVariant.primary:
        return _ButtonColors(
          background: UbiColors.ubiGreen,
          foreground: UbiColors.white,
          border: UbiColors.ubiGreen,
          disabledBackground: isDark ? UbiColors.gray700 : UbiColors.gray200,
          disabledForeground: isDark ? UbiColors.gray500 : UbiColors.gray400,
          disabledBorder: isDark ? UbiColors.gray700 : UbiColors.gray200,
        );
        
      case UbiButtonVariant.secondary:
        return _ButtonColors(
          background: UbiColors.ubiBlack,
          foreground: UbiColors.white,
          border: UbiColors.ubiBlack,
          disabledBackground: isDark ? UbiColors.gray700 : UbiColors.gray200,
          disabledForeground: isDark ? UbiColors.gray500 : UbiColors.gray400,
          disabledBorder: isDark ? UbiColors.gray700 : UbiColors.gray200,
        );
        
      case UbiButtonVariant.outlined:
        return _ButtonColors(
          background: Colors.transparent,
          foreground: isDark ? UbiColors.ubiGreen : UbiColors.ubiGreen,
          border: UbiColors.ubiGreen,
          disabledBackground: Colors.transparent,
          disabledForeground: isDark ? UbiColors.gray500 : UbiColors.gray400,
          disabledBorder: isDark ? UbiColors.gray600 : UbiColors.gray300,
        );
        
      case UbiButtonVariant.text:
        return _ButtonColors(
          background: Colors.transparent,
          foreground: UbiColors.ubiGreen,
          border: Colors.transparent,
          disabledBackground: Colors.transparent,
          disabledForeground: isDark ? UbiColors.gray500 : UbiColors.gray400,
          disabledBorder: Colors.transparent,
        );
        
      case UbiButtonVariant.ghost:
        return _ButtonColors(
          background: Colors.transparent,
          foreground: isDark ? UbiColors.textPrimaryDark : UbiColors.textPrimary,
          border: Colors.transparent,
          disabledBackground: Colors.transparent,
          disabledForeground: isDark ? UbiColors.gray500 : UbiColors.gray400,
          disabledBorder: Colors.transparent,
        );
        
      case UbiButtonVariant.danger:
        return _ButtonColors(
          background: UbiColors.error,
          foreground: UbiColors.white,
          border: UbiColors.error,
          disabledBackground: isDark ? UbiColors.gray700 : UbiColors.gray200,
          disabledForeground: isDark ? UbiColors.gray500 : UbiColors.gray400,
          disabledBorder: isDark ? UbiColors.gray700 : UbiColors.gray200,
        );
        
      case UbiButtonVariant.success:
        return _ButtonColors(
          background: UbiColors.success,
          foreground: UbiColors.white,
          border: UbiColors.success,
          disabledBackground: isDark ? UbiColors.gray700 : UbiColors.gray200,
          disabledForeground: isDark ? UbiColors.gray500 : UbiColors.gray400,
          disabledBorder: isDark ? UbiColors.gray700 : UbiColors.gray200,
        );
    }
  }

  _ButtonSizeConfig _getSizeConfig() {
    switch (size) {
      case UbiButtonSize.small:
        return _ButtonSizeConfig(
          height: 36,
          horizontalPadding: 12,
          verticalPadding: 8,
          iconSize: 16,
          textStyle: UbiTypography.body2.copyWith(fontWeight: FontWeight.w600),
        );
        
      case UbiButtonSize.medium:
        return _ButtonSizeConfig(
          height: 44,
          horizontalPadding: 16,
          verticalPadding: 12,
          iconSize: 18,
          textStyle: UbiTypography.button,
        );
        
      case UbiButtonSize.large:
        return _ButtonSizeConfig(
          height: 52,
          horizontalPadding: 24,
          verticalPadding: 14,
          iconSize: 20,
          textStyle: UbiTypography.button,
        );
        
      case UbiButtonSize.extraLarge:
        return _ButtonSizeConfig(
          height: 60,
          horizontalPadding: 32,
          verticalPadding: 18,
          iconSize: 24,
          textStyle: UbiTypography.button.copyWith(fontSize: 18),
        );
    }
  }
}

class _ButtonColors {
  final Color background;
  final Color foreground;
  final Color border;
  final Color disabledBackground;
  final Color disabledForeground;
  final Color disabledBorder;

  const _ButtonColors({
    required this.background,
    required this.foreground,
    required this.border,
    required this.disabledBackground,
    required this.disabledForeground,
    required this.disabledBorder,
  });
}

class _ButtonSizeConfig {
  final double height;
  final double horizontalPadding;
  final double verticalPadding;
  final double iconSize;
  final TextStyle textStyle;

  const _ButtonSizeConfig({
    required this.height,
    required this.horizontalPadding,
    required this.verticalPadding,
    required this.iconSize,
    required this.textStyle,
  });
}

/// UBI Icon Button
///
/// A circular icon button that follows the UBI design system.
class UbiIconButton extends StatelessWidget {
  const UbiIconButton({
    super.key,
    required this.icon,
    this.onPressed,
    this.variant = UbiButtonVariant.ghost,
    this.size = 48,
    this.iconSize = 24,
    this.backgroundColor,
    this.iconColor,
    this.tooltip,
    this.disabled = false,
    this.semanticsLabel,
  });

  /// Icon to display
  final IconData icon;

  /// Callback when button is pressed
  final VoidCallback? onPressed;

  /// Button style variant
  final UbiButtonVariant variant;

  /// Button size (width and height)
  final double size;

  /// Icon size
  final double iconSize;

  /// Custom background color
  final Color? backgroundColor;

  /// Custom icon color
  final Color? iconColor;

  /// Tooltip text
  final String? tooltip;

  /// Whether the button is disabled
  final bool disabled;

  /// Semantics label for accessibility
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    final isDisabled = disabled || onPressed == null;

    Color effectiveBackgroundColor;
    Color effectiveIconColor;

    switch (variant) {
      case UbiButtonVariant.primary:
        effectiveBackgroundColor = backgroundColor ?? UbiColors.ubiGreen;
        effectiveIconColor = iconColor ?? UbiColors.white;
        break;
      case UbiButtonVariant.secondary:
        effectiveBackgroundColor = backgroundColor ?? UbiColors.ubiBlack;
        effectiveIconColor = iconColor ?? UbiColors.white;
        break;
      case UbiButtonVariant.outlined:
        effectiveBackgroundColor = backgroundColor ?? Colors.transparent;
        effectiveIconColor = iconColor ?? UbiColors.ubiGreen;
        break;
      case UbiButtonVariant.danger:
        effectiveBackgroundColor = backgroundColor ?? UbiColors.error;
        effectiveIconColor = iconColor ?? UbiColors.white;
        break;
      case UbiButtonVariant.success:
        effectiveBackgroundColor = backgroundColor ?? UbiColors.success;
        effectiveIconColor = iconColor ?? UbiColors.white;
        break;
      case UbiButtonVariant.text:
      case UbiButtonVariant.ghost:
        effectiveBackgroundColor = backgroundColor ?? Colors.transparent;
        effectiveIconColor = iconColor ?? 
            (isDark ? UbiColors.textPrimaryDark : UbiColors.textPrimary);
        break;
    }

    if (isDisabled) {
      effectiveBackgroundColor = isDark ? UbiColors.gray800 : UbiColors.gray100;
      effectiveIconColor = isDark ? UbiColors.gray600 : UbiColors.gray400;
    }

    Widget button = Material(
      color: effectiveBackgroundColor,
      shape: variant == UbiButtonVariant.outlined
          ? CircleBorder(
              side: BorderSide(
                color: isDisabled 
                    ? (isDark ? UbiColors.gray600 : UbiColors.gray300)
                    : UbiColors.ubiGreen,
                width: 1.5,
              ),
            )
          : const CircleBorder(),
      child: InkWell(
        onTap: isDisabled ? null : onPressed,
        customBorder: const CircleBorder(),
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(
            icon,
            size: iconSize,
            color: effectiveIconColor,
          ),
        ),
      ),
    );

    if (tooltip != null) {
      button = Tooltip(
        message: tooltip!,
        child: button,
      );
    }

    return Semantics(
      label: semanticsLabel ?? tooltip,
      button: true,
      enabled: !isDisabled,
      child: button,
    );
  }
}
