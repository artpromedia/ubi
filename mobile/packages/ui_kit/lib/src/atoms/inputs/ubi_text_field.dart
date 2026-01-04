import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_typography.dart';
import '../../theme/ubi_spacing.dart';

/// UBI Text Field
///
/// A customizable text field component that follows the UBI design system.
class UbiTextField extends StatefulWidget {
  const UbiTextField({
    super.key,
    this.controller,
    this.initialValue,
    this.label,
    this.hint,
    this.helperText,
    this.errorText,
    this.prefixIcon,
    this.suffixIcon,
    this.prefix,
    this.suffix,
    this.keyboardType,
    this.textInputAction,
    this.obscureText = false,
    this.enabled = true,
    this.readOnly = false,
    this.autofocus = false,
    this.maxLines = 1,
    this.minLines,
    this.maxLength,
    this.onChanged,
    this.onSubmitted,
    this.onTap,
    this.validator,
    this.inputFormatters,
    this.focusNode,
    this.autovalidateMode,
    this.textCapitalization = TextCapitalization.none,
    this.showCounter = false,
    this.filled = true,
    this.fillColor,
    this.borderColor,
    this.focusedBorderColor,
    this.borderRadius,
    this.contentPadding,
    this.semanticsLabel,
  });

  /// Text editing controller
  final TextEditingController? controller;

  /// Initial value (if controller is not provided)
  final String? initialValue;

  /// Label text displayed above the field
  final String? label;

  /// Hint text displayed when field is empty
  final String? hint;

  /// Helper text displayed below the field
  final String? helperText;

  /// Error text displayed below the field (shows error state)
  final String? errorText;

  /// Icon displayed at the start of the field
  final IconData? prefixIcon;

  /// Icon displayed at the end of the field
  final IconData? suffixIcon;

  /// Widget displayed at the start (replaces prefixIcon)
  final Widget? prefix;

  /// Widget displayed at the end (replaces suffixIcon)
  final Widget? suffix;

  /// Keyboard type
  final TextInputType? keyboardType;

  /// Text input action button
  final TextInputAction? textInputAction;

  /// Whether to obscure text (for passwords)
  final bool obscureText;

  /// Whether the field is enabled
  final bool enabled;

  /// Whether the field is read-only
  final bool readOnly;

  /// Whether to autofocus
  final bool autofocus;

  /// Maximum number of lines
  final int? maxLines;

  /// Minimum number of lines
  final int? minLines;

  /// Maximum character length
  final int? maxLength;

  /// Called when text changes
  final ValueChanged<String>? onChanged;

  /// Called when user submits
  final ValueChanged<String>? onSubmitted;

  /// Called when field is tapped
  final VoidCallback? onTap;

  /// Validator function
  final String? Function(String?)? validator;

  /// Input formatters
  final List<TextInputFormatter>? inputFormatters;

  /// Focus node
  final FocusNode? focusNode;

  /// Auto-validate mode
  final AutovalidateMode? autovalidateMode;

  /// Text capitalization
  final TextCapitalization textCapitalization;

  /// Whether to show character counter
  final bool showCounter;

  /// Whether to fill background
  final bool filled;

  /// Custom fill color
  final Color? fillColor;

  /// Custom border color
  final Color? borderColor;

  /// Custom focused border color
  final Color? focusedBorderColor;

  /// Custom border radius
  final BorderRadius? borderRadius;

  /// Custom content padding
  final EdgeInsets? contentPadding;

  /// Semantics label for accessibility
  final String? semanticsLabel;

  @override
  State<UbiTextField> createState() => _UbiTextFieldState();
}

class _UbiTextFieldState extends State<UbiTextField> {
  late FocusNode _focusNode;
  bool _isFocused = false;
  bool _obscureText = false;

  @override
  void initState() {
    super.initState();
    _focusNode = widget.focusNode ?? FocusNode();
    _focusNode.addListener(_handleFocusChange);
    _obscureText = widget.obscureText;
  }

  @override
  void dispose() {
    if (widget.focusNode == null) {
      _focusNode.dispose();
    } else {
      _focusNode.removeListener(_handleFocusChange);
    }
    super.dispose();
  }

  void _handleFocusChange() {
    setState(() {
      _isFocused = _focusNode.hasFocus;
    });
  }

  void _toggleObscureText() {
    setState(() {
      _obscureText = !_obscureText;
    });
  }

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    final hasError = widget.errorText != null && widget.errorText!.isNotEmpty;

    final effectiveFillColor = widget.fillColor ??
        (isDark ? UbiColors.gray800 : UbiColors.gray50);

    final effectiveBorderColor = widget.borderColor ??
        (isDark ? UbiColors.borderDark : UbiColors.border);

    final effectiveFocusedBorderColor = widget.focusedBorderColor ??
        UbiColors.ubiGreen;

    final effectiveBorderRadius = widget.borderRadius ?? UbiRadius.inputRadius;

    final effectiveContentPadding = widget.contentPadding ??
        const EdgeInsets.symmetric(horizontal: 16, vertical: 16);

    // Build suffix widget
    Widget? effectiveSuffix = widget.suffix;
    if (widget.obscureText) {
      effectiveSuffix = GestureDetector(
        onTap: _toggleObscureText,
        child: Icon(
          _obscureText ? Icons.visibility_off_outlined : Icons.visibility_outlined,
          color: isDark ? UbiColors.textSecondaryDark : UbiColors.textSecondary,
          size: 20,
        ),
      );
    } else if (widget.suffixIcon != null) {
      effectiveSuffix = Icon(
        widget.suffixIcon,
        color: isDark ? UbiColors.textSecondaryDark : UbiColors.textSecondary,
        size: 20,
      );
    }

    // Build prefix widget
    Widget? effectivePrefix = widget.prefix;
    if (widget.prefixIcon != null) {
      effectivePrefix = Icon(
        widget.prefixIcon,
        color: isDark ? UbiColors.textSecondaryDark : UbiColors.textSecondary,
        size: 20,
      );
    }

    return Semantics(
      label: widget.semanticsLabel ?? widget.label,
      textField: true,
      enabled: widget.enabled,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Label
          if (widget.label != null) ...[
            Text(
              widget.label!,
              style: UbiTypography.body2.copyWith(
                color: hasError
                    ? UbiColors.error
                    : isDark
                        ? UbiColors.textSecondaryDark
                        : UbiColors.textSecondary,
                fontWeight: FontWeight.w500,
              ),
            ),
            SizedBox(height: UbiSpacing.xs),
          ],

          // Text field
          TextFormField(
            controller: widget.controller,
            initialValue: widget.controller == null ? widget.initialValue : null,
            focusNode: _focusNode,
            keyboardType: widget.keyboardType,
            textInputAction: widget.textInputAction,
            obscureText: _obscureText,
            enabled: widget.enabled,
            readOnly: widget.readOnly,
            autofocus: widget.autofocus,
            maxLines: widget.obscureText ? 1 : widget.maxLines,
            minLines: widget.minLines,
            maxLength: widget.maxLength,
            onChanged: widget.onChanged,
            onFieldSubmitted: widget.onSubmitted,
            onTap: widget.onTap,
            validator: widget.validator,
            inputFormatters: widget.inputFormatters,
            autovalidateMode: widget.autovalidateMode,
            textCapitalization: widget.textCapitalization,
            style: UbiTypography.body1.copyWith(
              color: widget.enabled
                  ? (isDark ? UbiColors.textPrimaryDark : UbiColors.textPrimary)
                  : (isDark ? UbiColors.textTertiaryDark : UbiColors.textTertiary),
            ),
            cursorColor: UbiColors.ubiGreen,
            decoration: InputDecoration(
              hintText: widget.hint,
              hintStyle: UbiTypography.body1.copyWith(
                color: isDark ? UbiColors.textTertiaryDark : UbiColors.textTertiary,
              ),
              filled: widget.filled,
              fillColor: widget.enabled
                  ? effectiveFillColor
                  : (isDark ? UbiColors.gray900 : UbiColors.gray100),
              contentPadding: effectiveContentPadding,
              prefixIcon: effectivePrefix != null
                  ? Padding(
                      padding: const EdgeInsets.only(left: 16, right: 12),
                      child: effectivePrefix,
                    )
                  : null,
              prefixIconConstraints: const BoxConstraints(
                minWidth: 0,
                minHeight: 0,
              ),
              suffixIcon: effectiveSuffix != null
                  ? Padding(
                      padding: const EdgeInsets.only(left: 12, right: 16),
                      child: effectiveSuffix,
                    )
                  : null,
              suffixIconConstraints: const BoxConstraints(
                minWidth: 0,
                minHeight: 0,
              ),
              counterText: widget.showCounter ? null : '',
              border: OutlineInputBorder(
                borderRadius: effectiveBorderRadius,
                borderSide: BorderSide(color: effectiveBorderColor, width: 1),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: effectiveBorderRadius,
                borderSide: BorderSide(color: effectiveBorderColor, width: 1),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: effectiveBorderRadius,
                borderSide: BorderSide(
                  color: hasError ? UbiColors.error : effectiveFocusedBorderColor,
                  width: 2,
                ),
              ),
              errorBorder: OutlineInputBorder(
                borderRadius: effectiveBorderRadius,
                borderSide: const BorderSide(color: UbiColors.error, width: 1),
              ),
              focusedErrorBorder: OutlineInputBorder(
                borderRadius: effectiveBorderRadius,
                borderSide: const BorderSide(color: UbiColors.error, width: 2),
              ),
              disabledBorder: OutlineInputBorder(
                borderRadius: effectiveBorderRadius,
                borderSide: BorderSide(
                  color: isDark ? UbiColors.gray700 : UbiColors.gray200,
                  width: 1,
                ),
              ),
              // Don't show error text here, we handle it below
              errorStyle: const TextStyle(height: 0, fontSize: 0),
            ),
          ),

          // Helper or error text
          if (widget.errorText != null || widget.helperText != null) ...[
            SizedBox(height: UbiSpacing.xs),
            Text(
              widget.errorText ?? widget.helperText ?? '',
              style: UbiTypography.caption.copyWith(
                color: hasError
                    ? UbiColors.error
                    : isDark
                        ? UbiColors.textTertiaryDark
                        : UbiColors.textTertiary,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// UBI Search Field
///
/// A specialized text field for search functionality.
class UbiSearchField extends StatelessWidget {
  const UbiSearchField({
    super.key,
    this.controller,
    this.hint = 'Search',
    this.onChanged,
    this.onSubmitted,
    this.onClear,
    this.autofocus = false,
    this.enabled = true,
    this.focusNode,
    this.showClearButton = true,
    this.semanticsLabel,
  });

  /// Text editing controller
  final TextEditingController? controller;

  /// Hint text
  final String hint;

  /// Called when text changes
  final ValueChanged<String>? onChanged;

  /// Called when user submits
  final ValueChanged<String>? onSubmitted;

  /// Called when clear button is pressed
  final VoidCallback? onClear;

  /// Whether to autofocus
  final bool autofocus;

  /// Whether the field is enabled
  final bool enabled;

  /// Focus node
  final FocusNode? focusNode;

  /// Whether to show clear button when text is present
  final bool showClearButton;

  /// Semantics label for accessibility
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller ?? TextEditingController(),
      builder: (context, value, child) {
        final hasText = value.text.isNotEmpty;

        return UbiTextField(
          controller: controller,
          hint: hint,
          prefixIcon: Icons.search,
          suffix: showClearButton && hasText
              ? GestureDetector(
                  onTap: () {
                    controller?.clear();
                    onClear?.call();
                    onChanged?.call('');
                  },
                  child: Icon(
                    Icons.close,
                    size: 20,
                    color: isDark
                        ? UbiColors.textSecondaryDark
                        : UbiColors.textSecondary,
                  ),
                )
              : null,
          onChanged: onChanged,
          onSubmitted: onSubmitted,
          autofocus: autofocus,
          enabled: enabled,
          focusNode: focusNode,
          keyboardType: TextInputType.text,
          textInputAction: TextInputAction.search,
          semanticsLabel: semanticsLabel ?? 'Search field',
        );
      },
    );
  }
}

/// UBI Phone Field
///
/// A specialized text field for phone numbers.
class UbiPhoneField extends StatelessWidget {
  const UbiPhoneField({
    super.key,
    this.controller,
    this.label = 'Phone Number',
    this.hint = 'Enter phone number',
    this.countryCode = '+234',
    this.onCountryCodeTap,
    this.onChanged,
    this.onSubmitted,
    this.errorText,
    this.enabled = true,
    this.autofocus = false,
    this.focusNode,
    this.validator,
    this.semanticsLabel,
  });

  /// Text editing controller
  final TextEditingController? controller;

  /// Label text
  final String label;

  /// Hint text
  final String hint;

  /// Country code
  final String countryCode;

  /// Called when country code is tapped
  final VoidCallback? onCountryCodeTap;

  /// Called when text changes
  final ValueChanged<String>? onChanged;

  /// Called when user submits
  final ValueChanged<String>? onSubmitted;

  /// Error text
  final String? errorText;

  /// Whether the field is enabled
  final bool enabled;

  /// Whether to autofocus
  final bool autofocus;

  /// Focus node
  final FocusNode? focusNode;

  /// Validator function
  final String? Function(String?)? validator;

  /// Semantics label for accessibility
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return UbiTextField(
      controller: controller,
      label: label,
      hint: hint,
      prefix: GestureDetector(
        onTap: onCountryCodeTap,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              countryCode,
              style: UbiTypography.body1.copyWith(
                color: isDark ? UbiColors.textPrimaryDark : UbiColors.textPrimary,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              Icons.keyboard_arrow_down,
              size: 20,
              color: isDark ? UbiColors.textSecondaryDark : UbiColors.textSecondary,
            ),
            const SizedBox(width: 8),
            Container(
              width: 1,
              height: 24,
              color: isDark ? UbiColors.borderDark : UbiColors.border,
            ),
          ],
        ),
      ),
      onChanged: onChanged,
      onSubmitted: onSubmitted,
      errorText: errorText,
      enabled: enabled,
      autofocus: autofocus,
      focusNode: focusNode,
      validator: validator,
      keyboardType: TextInputType.phone,
      textInputAction: TextInputAction.done,
      inputFormatters: [
        FilteringTextInputFormatter.digitsOnly,
        LengthLimitingTextInputFormatter(10),
      ],
      semanticsLabel: semanticsLabel ?? 'Phone number input',
    );
  }
}
