import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';

/// UBI Search Bar
///
/// A search input component with built-in icons, clear button,
/// and voice search support. Follows UBI design system guidelines.
class UbiSearchBar extends StatefulWidget {
  const UbiSearchBar({
    super.key,
    this.controller,
    this.hintText = 'Search',
    this.onChanged,
    this.onSubmitted,
    this.onClear,
    this.onVoiceSearch,
    this.onFocusChanged,
    this.enabled = true,
    this.autofocus = false,
    this.showVoiceButton = false,
    this.showClearButton = true,
    this.prefixIcon,
    this.backgroundColor,
    this.borderColor,
    this.borderRadius,
    this.elevation = 0,
    this.padding,
    this.textInputAction = TextInputAction.search,
    this.inputFormatters,
    this.maxLength,
    this.semanticsLabel,
  });

  /// Text controller
  final TextEditingController? controller;

  /// Placeholder text
  final String hintText;

  /// Callback when text changes
  final ValueChanged<String>? onChanged;

  /// Callback when search is submitted
  final ValueChanged<String>? onSubmitted;

  /// Callback when clear button is pressed
  final VoidCallback? onClear;

  /// Callback for voice search button
  final VoidCallback? onVoiceSearch;

  /// Callback when focus changes
  final ValueChanged<bool>? onFocusChanged;

  /// Whether the search bar is enabled
  final bool enabled;

  /// Whether to autofocus on mount
  final bool autofocus;

  /// Whether to show voice search button
  final bool showVoiceButton;

  /// Whether to show clear button when text is present
  final bool showClearButton;

  /// Custom prefix icon
  final IconData? prefixIcon;

  /// Custom background color
  final Color? backgroundColor;

  /// Border color
  final Color? borderColor;

  /// Border radius
  final BorderRadius? borderRadius;

  /// Shadow elevation
  final double elevation;

  /// Internal padding
  final EdgeInsets? padding;

  /// Keyboard action type
  final TextInputAction textInputAction;

  /// Input formatters
  final List<TextInputFormatter>? inputFormatters;

  /// Maximum character length
  final int? maxLength;

  /// Accessibility label
  final String? semanticsLabel;

  @override
  State<UbiSearchBar> createState() => _UbiSearchBarState();
}

class _UbiSearchBarState extends State<UbiSearchBar> {
  late TextEditingController _controller;
  late FocusNode _focusNode;
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    _controller = widget.controller ?? TextEditingController();
    _focusNode = FocusNode();
    _hasText = _controller.text.isNotEmpty;
    
    _controller.addListener(_onTextChanged);
    _focusNode.addListener(_onFocusChanged);
  }

  @override
  void dispose() {
    _controller.removeListener(_onTextChanged);
    _focusNode.removeListener(_onFocusChanged);
    
    if (widget.controller == null) {
      _controller.dispose();
    }
    _focusNode.dispose();
    super.dispose();
  }

  void _onTextChanged() {
    final hasText = _controller.text.isNotEmpty;
    if (hasText != _hasText) {
      setState(() => _hasText = hasText);
    }
    widget.onChanged?.call(_controller.text);
  }

  void _onFocusChanged() {
    widget.onFocusChanged?.call(_focusNode.hasFocus);
  }

  void _handleClear() {
    _controller.clear();
    widget.onClear?.call();
    _focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final effectiveBackgroundColor = widget.backgroundColor ??
        (isDark ? UbiColors.gray800 : UbiColors.gray100);
    final effectiveBorderRadius = widget.borderRadius ?? UbiRadius.lgRadius;
    final effectivePadding = widget.padding ??
        EdgeInsets.symmetric(horizontal: UbiSpacing.md, vertical: UbiSpacing.xs);

    final iconColor = isDark ? UbiColors.gray400 : UbiColors.gray500;
    final textColor = isDark ? UbiColors.ubiWhite : UbiColors.gray900;
    final hintColor = UbiColors.gray500;

    return Semantics(
      label: widget.semanticsLabel ?? 'Search field',
      textField: true,
      child: Container(
        decoration: BoxDecoration(
          color: effectiveBackgroundColor,
          borderRadius: effectiveBorderRadius,
          border: widget.borderColor != null
              ? Border.all(color: widget.borderColor!)
              : null,
          boxShadow: widget.elevation > 0
              ? [
                  BoxShadow(
                    color: UbiColors.ubiBlack.withValues(alpha: 0.1),
                    blurRadius: widget.elevation * 2,
                    offset: Offset(0, widget.elevation),
                  ),
                ]
              : null,
        ),
        child: Row(
          children: [
            Padding(
              padding: EdgeInsets.only(left: UbiSpacing.md),
              child: Icon(
                widget.prefixIcon ?? Icons.search,
                color: iconColor,
                size: 22,
              ),
            ),
            Expanded(
              child: TextField(
                controller: _controller,
                focusNode: _focusNode,
                enabled: widget.enabled,
                autofocus: widget.autofocus,
                textInputAction: widget.textInputAction,
                inputFormatters: widget.inputFormatters,
                maxLength: widget.maxLength,
                style: UbiTypography.bodyMedium.copyWith(color: textColor),
                decoration: InputDecoration(
                  hintText: widget.hintText,
                  hintStyle: UbiTypography.bodyMedium.copyWith(color: hintColor),
                  border: InputBorder.none,
                  contentPadding: effectivePadding,
                  counterText: '',
                ),
                onSubmitted: widget.onSubmitted,
              ),
            ),
            if (_hasText && widget.showClearButton)
              _SearchBarIconButton(
                icon: Icons.close,
                onPressed: _handleClear,
                iconColor: iconColor,
                semanticsLabel: 'Clear search',
              ),
            if (widget.showVoiceButton && widget.onVoiceSearch != null)
              _SearchBarIconButton(
                icon: Icons.mic,
                onPressed: widget.onVoiceSearch!,
                iconColor: iconColor,
                semanticsLabel: 'Voice search',
              ),
            SizedBox(width: UbiSpacing.xs),
          ],
        ),
      ),
    );
  }
}

class _SearchBarIconButton extends StatelessWidget {
  const _SearchBarIconButton({
    required this.icon,
    required this.onPressed,
    required this.iconColor,
    required this.semanticsLabel,
  });

  final IconData icon;
  final VoidCallback onPressed;
  final Color iconColor;
  final String semanticsLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticsLabel,
      button: true,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: EdgeInsets.all(UbiSpacing.sm),
            child: Icon(icon, color: iconColor, size: 20),
          ),
        ),
      ),
    );
  }
}

/// UBI Location Search Bar
///
/// A specialized search bar for location input with pickup/destination styling.
class UbiLocationSearchBar extends StatelessWidget {
  const UbiLocationSearchBar({
    super.key,
    this.controller,
    required this.hintText,
    required this.locationType,
    this.onChanged,
    this.onTap,
    this.enabled = true,
    this.readOnly = false,
    this.value,
  });

  final TextEditingController? controller;
  final String hintText;
  final LocationType locationType;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onTap;
  final bool enabled;
  final bool readOnly;
  final String? value;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final dotColor = locationType == LocationType.pickup
        ? UbiColors.ubiGreen
        : UbiColors.ubiBitesColor;

    final backgroundColor = isDark ? UbiColors.gray800 : UbiColors.gray100;
    final textColor = isDark ? UbiColors.ubiWhite : UbiColors.gray900;

    return GestureDetector(
      onTap: readOnly ? onTap : null,
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: UbiSpacing.md,
          vertical: UbiSpacing.sm + UbiSpacing.xs,
        ),
        decoration: BoxDecoration(
          color: backgroundColor,
          borderRadius: UbiRadius.mdRadius,
        ),
        child: Row(
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                color: dotColor,
                shape: BoxShape.circle,
              ),
            ),
            SizedBox(width: UbiSpacing.md),
            Expanded(
              child: readOnly
                  ? Text(
                      value ?? hintText,
                      style: UbiTypography.bodyMedium.copyWith(
                        color: value != null ? textColor : UbiColors.gray500,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    )
                  : TextField(
                      controller: controller,
                      enabled: enabled,
                      onChanged: onChanged,
                      style: UbiTypography.bodyMedium.copyWith(color: textColor),
                      decoration: InputDecoration(
                        hintText: hintText,
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
    );
  }
}

enum LocationType { pickup, destination }
