import 'package:flutter/material.dart';

import '../../atoms/buttons/ubi_button.dart';
import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';

/// UBI Empty State
///
/// A component for displaying empty or zero-state views.
/// Provides consistent messaging and optional call-to-action.
class UbiEmptyState extends StatelessWidget {
  const UbiEmptyState({
    super.key,
    required this.title,
    this.description,
    this.icon,
    this.iconWidget,
    this.illustration,
    this.actionLabel,
    this.onAction,
    this.secondaryActionLabel,
    this.onSecondaryAction,
    this.compact = false,
    this.padding,
  });

  /// Main title text
  final String title;

  /// Description text
  final String? description;

  /// Icon to display
  final IconData? icon;

  /// Custom icon widget (overrides icon)
  final Widget? iconWidget;

  /// Illustration widget (overrides icon and iconWidget)
  final Widget? illustration;

  /// Primary action button label
  final String? actionLabel;

  /// Callback for primary action
  final VoidCallback? onAction;

  /// Secondary action button label
  final String? secondaryActionLabel;

  /// Callback for secondary action
  final VoidCallback? onSecondaryAction;

  /// Whether to use compact layout
  final bool compact;

  /// Custom padding
  final EdgeInsets? padding;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final iconSize = compact ? 48.0 : 80.0;
    final effectivePadding = padding ?? EdgeInsets.all(UbiSpacing.xl);

    return Padding(
      padding: effectivePadding,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Illustration or Icon
          if (illustration != null)
            illustration!
          else if (iconWidget != null)
            iconWidget!
          else if (icon != null)
            Container(
              width: iconSize + 24,
              height: iconSize + 24,
              decoration: BoxDecoration(
                color: (isDark ? UbiColors.gray800 : UbiColors.gray100),
                shape: BoxShape.circle,
              ),
              child: Icon(
                icon,
                size: iconSize,
                color: isDark ? UbiColors.gray600 : UbiColors.gray400,
              ),
            ),

          SizedBox(height: compact ? UbiSpacing.md : UbiSpacing.lg),

          // Title
          Text(
            title,
            style: (compact ? UbiTypography.bodyLarge : UbiTypography.headingSmall).copyWith(
              color: isDark ? UbiColors.ubiWhite : UbiColors.gray900,
              fontWeight: FontWeight.w600,
            ),
            textAlign: TextAlign.center,
          ),

          // Description
          if (description != null) ...[
            SizedBox(height: UbiSpacing.sm),
            Text(
              description!,
              style: UbiTypography.bodyMedium.copyWith(
                color: UbiColors.gray500,
              ),
              textAlign: TextAlign.center,
            ),
          ],

          // Actions
          if (actionLabel != null || secondaryActionLabel != null) ...[
            SizedBox(height: compact ? UbiSpacing.md : UbiSpacing.lg),
            if (actionLabel != null)
              UbiButton(
                label: actionLabel!,
                onPressed: onAction,
                variant: UbiButtonVariant.primary,
                size: compact ? UbiButtonSize.medium : UbiButtonSize.large,
              ),
            if (secondaryActionLabel != null) ...[
              SizedBox(height: UbiSpacing.sm),
              UbiButton(
                label: secondaryActionLabel!,
                onPressed: onSecondaryAction,
                variant: UbiButtonVariant.text,
                size: compact ? UbiButtonSize.medium : UbiButtonSize.large,
              ),
            ],
          ],
        ],
      ),
    );
  }
}

/// UBI Error State
///
/// A component for displaying error states with retry option.
class UbiErrorState extends StatelessWidget {
  const UbiErrorState({
    super.key,
    this.title = 'Something went wrong',
    this.description,
    this.error,
    this.icon,
    this.onRetry,
    this.retryLabel = 'Try again',
    this.showErrorDetails = false,
    this.compact = false,
    this.padding,
  });

  /// Error title
  final String title;

  /// Error description
  final String? description;

  /// Error object for details
  final Object? error;

  /// Custom icon
  final IconData? icon;

  /// Callback for retry action
  final VoidCallback? onRetry;

  /// Retry button label
  final String retryLabel;

  /// Whether to show technical error details
  final bool showErrorDetails;

  /// Whether to use compact layout
  final bool compact;

  /// Custom padding
  final EdgeInsets? padding;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final iconSize = compact ? 48.0 : 64.0;
    final effectivePadding = padding ?? EdgeInsets.all(UbiSpacing.xl);

    return Padding(
      padding: effectivePadding,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Error icon
          Container(
            width: iconSize + 24,
            height: iconSize + 24,
            decoration: BoxDecoration(
              color: const Color(0xFFFEE2E2),
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon ?? Icons.error_outline,
              size: iconSize,
              color: const Color(0xFFEF4444),
            ),
          ),

          SizedBox(height: compact ? UbiSpacing.md : UbiSpacing.lg),

          // Title
          Text(
            title,
            style: (compact ? UbiTypography.bodyLarge : UbiTypography.headingSmall).copyWith(
              color: isDark ? UbiColors.ubiWhite : UbiColors.gray900,
              fontWeight: FontWeight.w600,
            ),
            textAlign: TextAlign.center,
          ),

          // Description
          if (description != null) ...[
            SizedBox(height: UbiSpacing.sm),
            Text(
              description!,
              style: UbiTypography.bodyMedium.copyWith(
                color: UbiColors.gray500,
              ),
              textAlign: TextAlign.center,
            ),
          ],

          // Error details
          if (showErrorDetails && error != null) ...[
            SizedBox(height: UbiSpacing.md),
            Container(
              padding: EdgeInsets.all(UbiSpacing.md),
              decoration: BoxDecoration(
                color: isDark ? UbiColors.gray800 : UbiColors.gray100,
                borderRadius: UbiRadius.smRadius,
              ),
              child: Text(
                error.toString(),
                style: UbiTypography.caption.copyWith(
                  color: UbiColors.gray500,
                  fontFamily: 'monospace',
                ),
                textAlign: TextAlign.left,
              ),
            ),
          ],

          // Retry button
          if (onRetry != null) ...[
            SizedBox(height: compact ? UbiSpacing.md : UbiSpacing.lg),
            UbiButton(
              label: retryLabel,
              onPressed: onRetry,
              variant: UbiButtonVariant.primary,
              size: compact ? UbiButtonSize.medium : UbiButtonSize.large,
              leadingIcon: Icons.refresh,
            ),
          ],
        ],
      ),
    );
  }
}

/// UBI Loading State
///
/// A component for displaying loading states with progress indication.
class UbiLoadingState extends StatelessWidget {
  const UbiLoadingState({
    super.key,
    this.message,
    this.progress,
    this.compact = false,
    this.color,
  });

  /// Loading message
  final String? message;

  /// Progress value (0.0 to 1.0)
  final double? progress;

  /// Whether to use compact layout
  final bool compact;

  /// Custom indicator color
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    final effectiveColor = color ?? UbiColors.ubiGreen;

    return Center(
      child: Padding(
        padding: EdgeInsets.all(UbiSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (progress != null)
              SizedBox(
                width: compact ? 40 : 60,
                height: compact ? 40 : 60,
                child: CircularProgressIndicator(
                  value: progress,
                  strokeWidth: 4,
                  valueColor: AlwaysStoppedAnimation<Color>(effectiveColor),
                  backgroundColor: isDark ? UbiColors.gray700 : UbiColors.gray200,
                ),
              )
            else
              SizedBox(
                width: compact ? 32 : 48,
                height: compact ? 32 : 48,
                child: CircularProgressIndicator(
                  strokeWidth: 3,
                  valueColor: AlwaysStoppedAnimation<Color>(effectiveColor),
                ),
              ),
            if (message != null) ...[
              SizedBox(height: UbiSpacing.md),
              Text(
                message!,
                style: UbiTypography.bodyMedium.copyWith(
                  color: UbiColors.gray500,
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
