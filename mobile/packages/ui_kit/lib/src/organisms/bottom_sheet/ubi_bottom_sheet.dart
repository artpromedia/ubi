import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';

/// UBI Bottom Sheet
///
/// A draggable bottom sheet component with handle, header, and content areas.
/// Supports various configurations for different use cases.
class UbiBottomSheet extends StatelessWidget {
  const UbiBottomSheet({
    super.key,
    required this.child,
    this.title,
    this.titleWidget,
    this.leading,
    this.trailing,
    this.showHandle = true,
    this.showCloseButton = false,
    this.onClose,
    this.backgroundColor,
    this.handleColor,
    this.padding,
    this.borderRadius,
    this.maxHeight,
    this.minHeight,
    this.isScrollable = true,
  });

  /// Sheet content
  final Widget child;

  /// Header title text
  final String? title;

  /// Custom title widget (overrides title)
  final Widget? titleWidget;

  /// Leading widget in header
  final Widget? leading;

  /// Trailing widget in header
  final Widget? trailing;

  /// Whether to show drag handle
  final bool showHandle;

  /// Whether to show close button
  final bool showCloseButton;

  /// Callback when close button is pressed
  final VoidCallback? onClose;

  /// Background color
  final Color? backgroundColor;

  /// Handle indicator color
  final Color? handleColor;

  /// Content padding
  final EdgeInsets? padding;

  /// Border radius
  final BorderRadius? borderRadius;

  /// Maximum height (fraction of screen)
  final double? maxHeight;

  /// Minimum height
  final double? minHeight;

  /// Whether content is scrollable
  final bool isScrollable;

  /// Shows a modal bottom sheet with UBI styling
  static Future<T?> show<T>({
    required BuildContext context,
    required Widget child,
    String? title,
    Widget? titleWidget,
    Widget? leading,
    Widget? trailing,
    bool showHandle = true,
    bool showCloseButton = false,
    VoidCallback? onClose,
    Color? backgroundColor,
    EdgeInsets? padding,
    double? maxHeight,
    double? minHeight,
    bool isScrollable = true,
    bool isDismissible = true,
    bool enableDrag = true,
    bool useRootNavigator = false,
  }) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return showModalBottomSheet<T>(
      context: context,
      isDismissible: isDismissible,
      enableDrag: enableDrag,
      useRootNavigator: useRootNavigator,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => UbiBottomSheet(
        title: title,
        titleWidget: titleWidget,
        leading: leading,
        trailing: trailing,
        showHandle: showHandle,
        showCloseButton: showCloseButton,
        onClose: onClose ?? () => Navigator.of(context).pop(),
        backgroundColor: backgroundColor ??
            (isDark ? UbiColors.gray900 : UbiColors.ubiWhite),
        padding: padding,
        maxHeight: maxHeight,
        minHeight: minHeight,
        isScrollable: isScrollable,
        child: child,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    final mediaQuery = MediaQuery.of(context);

    final effectiveBackgroundColor = backgroundColor ??
        (isDark ? UbiColors.gray900 : UbiColors.ubiWhite);
    final effectiveHandleColor = handleColor ??
        (isDark ? UbiColors.gray600 : UbiColors.gray300);
    final effectiveBorderRadius = borderRadius ??
        BorderRadius.vertical(top: Radius.circular(24));
    final effectivePadding = padding ??
        EdgeInsets.all(UbiSpacing.lg);

    final effectiveMaxHeight = maxHeight ?? 0.9;
    final maxHeightPx = mediaQuery.size.height * effectiveMaxHeight;

    Widget content = child;

    if (isScrollable) {
      content = SingleChildScrollView(
        padding: effectivePadding,
        child: content,
      );
    } else {
      content = Padding(
        padding: effectivePadding,
        child: content,
      );
    }

    return Container(
      constraints: BoxConstraints(
        maxHeight: maxHeightPx,
        minHeight: minHeight ?? 0,
      ),
      decoration: BoxDecoration(
        color: effectiveBackgroundColor,
        borderRadius: effectiveBorderRadius,
        boxShadow: [
          BoxShadow(
            color: UbiColors.ubiBlack.withValues(alpha: 0.1),
            blurRadius: 20,
            offset: Offset(0, -4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          if (showHandle) _buildHandle(effectiveHandleColor),

          // Header
          if (_hasHeader) _buildHeader(context, isDark),

          // Content
          Flexible(child: content),

          // Bottom safe area
          SizedBox(height: mediaQuery.padding.bottom),
        ],
      ),
    );
  }

  Widget _buildHandle(Color color) {
    return Padding(
      padding: EdgeInsets.only(top: UbiSpacing.sm, bottom: UbiSpacing.xs),
      child: Container(
        width: 40,
        height: 4,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(2),
        ),
      ),
    );
  }

  bool get _hasHeader =>
      title != null ||
      titleWidget != null ||
      leading != null ||
      trailing != null ||
      showCloseButton;

  Widget _buildHeader(BuildContext context, bool isDark) {
    final textColor = isDark ? UbiColors.ubiWhite : UbiColors.gray900;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        UbiSpacing.lg,
        UbiSpacing.xs,
        UbiSpacing.lg,
        UbiSpacing.md,
      ),
      child: Row(
        children: [
          if (leading != null) ...[
            leading!,
            SizedBox(width: UbiSpacing.sm),
          ],
          Expanded(
            child: titleWidget ??
                (title != null
                    ? Text(
                        title!,
                        style: UbiTypography.headingSmall.copyWith(
                          color: textColor,
                        ),
                      )
                    : SizedBox.shrink()),
          ),
          if (trailing != null) trailing!,
          if (showCloseButton)
            IconButton(
              onPressed: onClose,
              icon: Icon(
                Icons.close,
                color: isDark ? UbiColors.gray400 : UbiColors.gray600,
              ),
              padding: EdgeInsets.zero,
              constraints: BoxConstraints(minWidth: 32, minHeight: 32),
            ),
        ],
      ),
    );
  }
}

/// UBI Draggable Bottom Sheet
///
/// A bottom sheet that can be dragged to different snap points.
class UbiDraggableBottomSheet extends StatefulWidget {
  const UbiDraggableBottomSheet({
    super.key,
    required this.builder,
    this.initialChildSize = 0.25,
    this.minChildSize = 0.1,
    this.maxChildSize = 0.9,
    this.snapSizes,
    this.snap = true,
    this.expand = true,
    this.backgroundColor,
    this.showHandle = true,
    this.controller,
  });

  /// Builder for sheet content
  final ScrollableWidgetBuilder builder;

  /// Initial size (fraction of screen)
  final double initialChildSize;

  /// Minimum size
  final double minChildSize;

  /// Maximum size
  final double maxChildSize;

  /// Snap positions
  final List<double>? snapSizes;

  /// Whether to snap to sizes
  final bool snap;

  /// Whether to expand to fill available space
  final bool expand;

  /// Background color
  final Color? backgroundColor;

  /// Whether to show drag handle
  final bool showHandle;

  /// Controller for programmatic control
  final DraggableScrollableController? controller;

  @override
  State<UbiDraggableBottomSheet> createState() => _UbiDraggableBottomSheetState();
}

class _UbiDraggableBottomSheetState extends State<UbiDraggableBottomSheet> {
  late DraggableScrollableController _controller;

  @override
  void initState() {
    super.initState();
    _controller = widget.controller ?? DraggableScrollableController();
  }

  @override
  void dispose() {
    if (widget.controller == null) {
      _controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final effectiveBackgroundColor = widget.backgroundColor ??
        (isDark ? UbiColors.gray900 : UbiColors.ubiWhite);

    return DraggableScrollableSheet(
      controller: _controller,
      initialChildSize: widget.initialChildSize,
      minChildSize: widget.minChildSize,
      maxChildSize: widget.maxChildSize,
      snap: widget.snap,
      snapSizes: widget.snapSizes,
      expand: widget.expand,
      builder: (context, scrollController) {
        return Container(
          decoration: BoxDecoration(
            color: effectiveBackgroundColor,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            boxShadow: [
              BoxShadow(
                color: UbiColors.ubiBlack.withValues(alpha: 0.1),
                blurRadius: 20,
                offset: Offset(0, -4),
              ),
            ],
          ),
          child: Column(
            children: [
              if (widget.showHandle)
                _DragHandle(isDark: isDark),
              Expanded(
                child: widget.builder(context, scrollController),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _DragHandle extends StatelessWidget {
  const _DragHandle({required this.isDark});

  final bool isDark;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: UbiSpacing.sm),
      child: Container(
        width: 40,
        height: 4,
        decoration: BoxDecoration(
          color: isDark ? UbiColors.gray600 : UbiColors.gray300,
          borderRadius: BorderRadius.circular(2),
        ),
      ),
    );
  }
}
