import 'package:flutter/material.dart';

import '../../atoms/buttons/ubi_button.dart';
import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';

/// UBI Confirmation Dialog
///
/// A standardized dialog for confirming user actions.
/// Supports different styles for various action types.
class UbiConfirmationDialog extends StatelessWidget {
  const UbiConfirmationDialog({
    super.key,
    required this.title,
    this.description,
    this.icon,
    this.iconWidget,
    this.confirmLabel = 'Confirm',
    this.cancelLabel = 'Cancel',
    this.onConfirm,
    this.onCancel,
    this.variant = UbiDialogVariant.standard,
    this.isLoading = false,
    this.showCloseButton = false,
  });

  /// Dialog title
  final String title;

  /// Dialog description
  final String? description;

  /// Icon to display
  final IconData? icon;

  /// Custom icon widget (overrides icon)
  final Widget? iconWidget;

  /// Confirm button label
  final String confirmLabel;

  /// Cancel button label
  final String cancelLabel;

  /// Callback for confirm action
  final VoidCallback? onConfirm;

  /// Callback for cancel action
  final VoidCallback? onCancel;

  /// Dialog variant
  final UbiDialogVariant variant;

  /// Whether confirm button is loading
  final bool isLoading;

  /// Whether to show close button in header
  final bool showCloseButton;

  /// Shows the dialog
  static Future<bool?> show({
    required BuildContext context,
    required String title,
    String? description,
    IconData? icon,
    Widget? iconWidget,
    String confirmLabel = 'Confirm',
    String cancelLabel = 'Cancel',
    UbiDialogVariant variant = UbiDialogVariant.standard,
    bool barrierDismissible = true,
  }) {
    return showDialog<bool>(
      context: context,
      barrierDismissible: barrierDismissible,
      builder: (context) => UbiConfirmationDialog(
        title: title,
        description: description,
        icon: icon,
        iconWidget: iconWidget,
        confirmLabel: confirmLabel,
        cancelLabel: cancelLabel,
        variant: variant,
        onConfirm: () => Navigator.of(context).pop(true),
        onCancel: () => Navigator.of(context).pop(false),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final backgroundColor = isDark ? UbiColors.gray900 : UbiColors.ubiWhite;
    final variantColors = _getVariantColors();

    return Dialog(
      backgroundColor: backgroundColor,
      shape: RoundedRectangleBorder(
        borderRadius: UbiRadius.lgRadius,
      ),
      child: Padding(
        padding: EdgeInsets.all(UbiSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // Close button
            if (showCloseButton)
              Align(
                alignment: Alignment.topRight,
                child: IconButton(
                  onPressed: onCancel,
                  icon: Icon(Icons.close, color: UbiColors.gray500),
                  padding: EdgeInsets.zero,
                  constraints: BoxConstraints(minWidth: 32, minHeight: 32),
                ),
              ),

            // Icon
            if (iconWidget != null || icon != null) ...[
              if (iconWidget != null)
                iconWidget!
              else
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(
                    color: variantColors.backgroundColor,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    icon,
                    size: 32,
                    color: variantColors.iconColor,
                  ),
                ),
              SizedBox(height: UbiSpacing.md),
            ],

            // Title
            Text(
              title,
              style: UbiTypography.headingSmall.copyWith(
                color: isDark ? UbiColors.ubiWhite : UbiColors.gray900,
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

            SizedBox(height: UbiSpacing.lg),

            // Buttons
            Row(
              children: [
                Expanded(
                  child: UbiButton(
                    label: cancelLabel,
                    onPressed: onCancel,
                    variant: UbiButtonVariant.outlined,
                    size: UbiButtonSize.medium,
                  ),
                ),
                SizedBox(width: UbiSpacing.md),
                Expanded(
                  child: UbiButton(
                    label: confirmLabel,
                    onPressed: onConfirm,
                    variant: _getConfirmButtonVariant(),
                    size: UbiButtonSize.medium,
                    isLoading: isLoading,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  _VariantColors _getVariantColors() {
    switch (variant) {
      case UbiDialogVariant.destructive:
        return _VariantColors(
          backgroundColor: const Color(0xFFFEE2E2),
          iconColor: const Color(0xFFEF4444),
        );
      case UbiDialogVariant.warning:
        return _VariantColors(
          backgroundColor: const Color(0xFFFEF3C7),
          iconColor: const Color(0xFFF59E0B),
        );
      case UbiDialogVariant.success:
        return _VariantColors(
          backgroundColor: UbiColors.greenLight,
          iconColor: UbiColors.ubiGreen,
        );
      case UbiDialogVariant.standard:
      default:
        return _VariantColors(
          backgroundColor: UbiColors.ubiGreen.withValues(alpha: 0.1),
          iconColor: UbiColors.ubiGreen,
        );
    }
  }

  UbiButtonVariant _getConfirmButtonVariant() {
    switch (variant) {
      case UbiDialogVariant.destructive:
        return UbiButtonVariant.danger;
      case UbiDialogVariant.success:
        return UbiButtonVariant.success;
      case UbiDialogVariant.warning:
      case UbiDialogVariant.standard:
      default:
        return UbiButtonVariant.primary;
    }
  }
}

class _VariantColors {
  final Color backgroundColor;
  final Color iconColor;

  const _VariantColors({
    required this.backgroundColor,
    required this.iconColor,
  });
}

/// UBI Dialog Variants
enum UbiDialogVariant {
  /// Standard dialog
  standard,

  /// Destructive/danger dialog
  destructive,

  /// Warning dialog
  warning,

  /// Success dialog
  success,
}

/// UBI Alert Dialog
///
/// A simple alert dialog with a single action.
class UbiAlertDialog extends StatelessWidget {
  const UbiAlertDialog({
    super.key,
    required this.title,
    this.description,
    this.buttonLabel = 'OK',
    this.onPressed,
  });

  final String title;
  final String? description;
  final String buttonLabel;
  final VoidCallback? onPressed;

  static Future<void> show({
    required BuildContext context,
    required String title,
    String? description,
    String buttonLabel = 'OK',
  }) {
    return showDialog<void>(
      context: context,
      builder: (context) => UbiAlertDialog(
        title: title,
        description: description,
        buttonLabel: buttonLabel,
        onPressed: () => Navigator.of(context).pop(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return Dialog(
      backgroundColor: isDark ? UbiColors.gray900 : UbiColors.ubiWhite,
      shape: RoundedRectangleBorder(borderRadius: UbiRadius.lgRadius),
      child: Padding(
        padding: EdgeInsets.all(UbiSpacing.lg),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              title,
              style: UbiTypography.headingSmall.copyWith(
                color: isDark ? UbiColors.ubiWhite : UbiColors.gray900,
              ),
              textAlign: TextAlign.center,
            ),
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
            SizedBox(height: UbiSpacing.lg),
            SizedBox(
              width: double.infinity,
              child: UbiButton(
                label: buttonLabel,
                onPressed: onPressed,
                variant: UbiButtonVariant.primary,
                size: UbiButtonSize.medium,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// UBI Input Dialog
///
/// A dialog with text input field.
class UbiInputDialog extends StatefulWidget {
  const UbiInputDialog({
    super.key,
    required this.title,
    this.description,
    this.hintText,
    this.initialValue,
    this.confirmLabel = 'Submit',
    this.cancelLabel = 'Cancel',
    this.onConfirm,
    this.onCancel,
    this.validator,
    this.keyboardType,
    this.maxLines = 1,
    this.maxLength,
  });

  final String title;
  final String? description;
  final String? hintText;
  final String? initialValue;
  final String confirmLabel;
  final String cancelLabel;
  final ValueChanged<String>? onConfirm;
  final VoidCallback? onCancel;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;
  final int maxLines;
  final int? maxLength;

  static Future<String?> show({
    required BuildContext context,
    required String title,
    String? description,
    String? hintText,
    String? initialValue,
    String confirmLabel = 'Submit',
    String cancelLabel = 'Cancel',
    String? Function(String?)? validator,
    TextInputType? keyboardType,
    int maxLines = 1,
    int? maxLength,
  }) {
    return showDialog<String>(
      context: context,
      builder: (context) => UbiInputDialog(
        title: title,
        description: description,
        hintText: hintText,
        initialValue: initialValue,
        confirmLabel: confirmLabel,
        cancelLabel: cancelLabel,
        validator: validator,
        keyboardType: keyboardType,
        maxLines: maxLines,
        maxLength: maxLength,
        onConfirm: (value) => Navigator.of(context).pop(value),
        onCancel: () => Navigator.of(context).pop(),
      ),
    );
  }

  @override
  State<UbiInputDialog> createState() => _UbiInputDialogState();
}

class _UbiInputDialogState extends State<UbiInputDialog> {
  late TextEditingController _controller;
  final _formKey = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialValue);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return Dialog(
      backgroundColor: isDark ? UbiColors.gray900 : UbiColors.ubiWhite,
      shape: RoundedRectangleBorder(borderRadius: UbiRadius.lgRadius),
      child: Padding(
        padding: EdgeInsets.all(UbiSpacing.lg),
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.title,
                style: UbiTypography.headingSmall.copyWith(
                  color: isDark ? UbiColors.ubiWhite : UbiColors.gray900,
                ),
              ),
              if (widget.description != null) ...[
                SizedBox(height: UbiSpacing.xs),
                Text(
                  widget.description!,
                  style: UbiTypography.bodySmall.copyWith(
                    color: UbiColors.gray500,
                  ),
                ),
              ],
              SizedBox(height: UbiSpacing.md),
              TextFormField(
                controller: _controller,
                validator: widget.validator,
                keyboardType: widget.keyboardType,
                maxLines: widget.maxLines,
                maxLength: widget.maxLength,
                style: UbiTypography.bodyMedium.copyWith(
                  color: isDark ? UbiColors.ubiWhite : UbiColors.gray900,
                ),
                decoration: InputDecoration(
                  hintText: widget.hintText,
                  hintStyle: UbiTypography.bodyMedium.copyWith(
                    color: UbiColors.gray500,
                  ),
                  filled: true,
                  fillColor: isDark ? UbiColors.gray800 : UbiColors.gray100,
                  border: OutlineInputBorder(
                    borderRadius: UbiRadius.mdRadius,
                    borderSide: BorderSide.none,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: UbiRadius.mdRadius,
                    borderSide: BorderSide.none,
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: UbiRadius.mdRadius,
                    borderSide: BorderSide(color: UbiColors.ubiGreen, width: 2),
                  ),
                  errorBorder: OutlineInputBorder(
                    borderRadius: UbiRadius.mdRadius,
                    borderSide: BorderSide(color: Color(0xFFEF4444), width: 1),
                  ),
                  contentPadding: EdgeInsets.symmetric(
                    horizontal: UbiSpacing.md,
                    vertical: UbiSpacing.sm,
                  ),
                ),
              ),
              SizedBox(height: UbiSpacing.lg),
              Row(
                children: [
                  Expanded(
                    child: UbiButton(
                      label: widget.cancelLabel,
                      onPressed: widget.onCancel,
                      variant: UbiButtonVariant.outlined,
                      size: UbiButtonSize.medium,
                    ),
                  ),
                  SizedBox(width: UbiSpacing.md),
                  Expanded(
                    child: UbiButton(
                      label: widget.confirmLabel,
                      onPressed: () {
                        if (_formKey.currentState?.validate() ?? false) {
                          widget.onConfirm?.call(_controller.text);
                        }
                      },
                      variant: UbiButtonVariant.primary,
                      size: UbiButtonSize.medium,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
