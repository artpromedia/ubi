import 'dart:async';
import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';

/// UBI Toast Types
enum UbiToastType {
  /// Success message
  success,

  /// Error message
  error,

  /// Warning message
  warning,

  /// Informational message
  info,

  /// Neutral message
  neutral,
}

/// UBI Toast Position
enum UbiToastPosition {
  /// Top of the screen
  top,

  /// Bottom of the screen
  bottom,
}

/// UBI Toast
///
/// A brief, non-intrusive message that appears temporarily.
/// Used for feedback, notifications, and status updates.
class UbiToast extends StatefulWidget {
  const UbiToast({
    super.key,
    required this.message,
    this.type = UbiToastType.neutral,
    this.duration = const Duration(seconds: 3),
    this.icon,
    this.action,
    this.actionLabel,
    this.onAction,
    this.onDismiss,
    this.showCloseButton = false,
    this.position = UbiToastPosition.bottom,
  });

  /// Toast message text
  final String message;

  /// Toast type for styling
  final UbiToastType type;

  /// Duration before auto-dismiss
  final Duration duration;

  /// Custom icon (overrides type default)
  final IconData? icon;

  /// Action button widget (overrides actionLabel)
  final Widget? action;

  /// Action button label
  final String? actionLabel;

  /// Callback when action is tapped
  final VoidCallback? onAction;

  /// Callback when toast is dismissed
  final VoidCallback? onDismiss;

  /// Whether to show close button
  final bool showCloseButton;

  /// Position on screen
  final UbiToastPosition position;

  @override
  State<UbiToast> createState() => _UbiToastState();

  /// Shows a toast using an overlay
  static void show(
    BuildContext context, {
    required String message,
    UbiToastType type = UbiToastType.neutral,
    Duration duration = const Duration(seconds: 3),
    IconData? icon,
    String? actionLabel,
    VoidCallback? onAction,
    UbiToastPosition position = UbiToastPosition.bottom,
  }) {
    final overlay = Overlay.of(context);
    late OverlayEntry entry;

    entry = OverlayEntry(
      builder: (context) => _ToastOverlay(
        message: message,
        type: type,
        duration: duration,
        icon: icon,
        actionLabel: actionLabel,
        onAction: onAction,
        position: position,
        onDismiss: () => entry.remove(),
      ),
    );

    overlay.insert(entry);
  }

  /// Convenience method for success toast
  static void success(BuildContext context, String message) {
    show(context, message: message, type: UbiToastType.success);
  }

  /// Convenience method for error toast
  static void error(BuildContext context, String message) {
    show(context, message: message, type: UbiToastType.error);
  }

  /// Convenience method for warning toast
  static void warning(BuildContext context, String message) {
    show(context, message: message, type: UbiToastType.warning);
  }

  /// Convenience method for info toast
  static void info(BuildContext context, String message) {
    show(context, message: message, type: UbiToastType.info);
  }
}

class _UbiToastState extends State<UbiToast> with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<Offset> _slideAnimation;
  late Animation<double> _fadeAnimation;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );

    final slideBegin = widget.position == UbiToastPosition.top
        ? const Offset(0, -1)
        : const Offset(0, 1);

    _slideAnimation = Tween<Offset>(
      begin: slideBegin,
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeOutCubic));

    _fadeAnimation = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOut),
    );

    _controller.forward();
    _startTimer();
  }

  void _startTimer() {
    _timer = Timer(widget.duration, _dismiss);
  }

  void _dismiss() {
    _timer?.cancel();
    _controller.reverse().then((_) {
      widget.onDismiss?.call();
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SlideTransition(
      position: _slideAnimation,
      child: FadeTransition(
        opacity: _fadeAnimation,
        child: _buildToastContent(context),
      ),
    );
  }

  Widget _buildToastContent(BuildContext context) {
    final colors = _getColorsForType();
    final icon = widget.icon ?? _getDefaultIcon();

    return Container(
      margin: EdgeInsets.symmetric(horizontal: UbiSpacing.md),
      padding: EdgeInsets.symmetric(
        horizontal: UbiSpacing.md,
        vertical: UbiSpacing.sm + UbiSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: UbiRadius.mdRadius,
        boxShadow: [
          BoxShadow(
            color: UbiColors.ubiBlack.withValues(alpha: 0.15),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null)
            Icon(icon, color: colors.icon, size: 20),
          if (icon != null) SizedBox(width: UbiSpacing.sm),
          Flexible(
            child: Text(
              widget.message,
              style: UbiTypography.bodySmall.copyWith(
                color: colors.text,
                fontWeight: FontWeight.w500,
              ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (widget.action != null) ...[
            SizedBox(width: UbiSpacing.sm),
            widget.action!,
          ] else if (widget.actionLabel != null) ...[
            SizedBox(width: UbiSpacing.sm),
            GestureDetector(
              onTap: () {
                widget.onAction?.call();
                _dismiss();
              },
              child: Text(
                widget.actionLabel!,
                style: UbiTypography.bodySmall.copyWith(
                  color: colors.action,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
          if (widget.showCloseButton) ...[
            SizedBox(width: UbiSpacing.xs),
            GestureDetector(
              onTap: _dismiss,
              child: Icon(
                Icons.close,
                color: colors.text.withValues(alpha: 0.7),
                size: 18,
              ),
            ),
          ],
        ],
      ),
    );
  }

  IconData? _getDefaultIcon() {
    switch (widget.type) {
      case UbiToastType.success:
        return Icons.check_circle;
      case UbiToastType.error:
        return Icons.error;
      case UbiToastType.warning:
        return Icons.warning;
      case UbiToastType.info:
        return Icons.info;
      case UbiToastType.neutral:
        return null;
    }
  }

  _ToastColors _getColorsForType() {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    switch (widget.type) {
      case UbiToastType.success:
        return _ToastColors(
          background: isDark ? const Color(0xFF064E3B) : const Color(0xFFD1FAE5),
          text: isDark ? UbiColors.greenLight : UbiColors.greenDark,
          icon: UbiColors.ubiGreen,
          action: UbiColors.ubiGreen,
        );
      case UbiToastType.error:
        return _ToastColors(
          background: isDark ? const Color(0xFF7F1D1D) : const Color(0xFFFEE2E2),
          text: isDark ? const Color(0xFFFECACA) : const Color(0xFF991B1B),
          icon: const Color(0xFFEF4444),
          action: const Color(0xFFEF4444),
        );
      case UbiToastType.warning:
        return _ToastColors(
          background: isDark ? const Color(0xFF78350F) : const Color(0xFFFEF3C7),
          text: isDark ? const Color(0xFFFDE68A) : const Color(0xFF92400E),
          icon: const Color(0xFFF59E0B),
          action: const Color(0xFFF59E0B),
        );
      case UbiToastType.info:
        return _ToastColors(
          background: isDark ? const Color(0xFF1E3A5F) : const Color(0xFFDBEAFE),
          text: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1E40AF),
          icon: const Color(0xFF3B82F6),
          action: const Color(0xFF3B82F6),
        );
      case UbiToastType.neutral:
        return _ToastColors(
          background: isDark ? UbiColors.gray800 : UbiColors.gray900,
          text: UbiColors.ubiWhite,
          icon: UbiColors.gray400,
          action: UbiColors.ubiGreen,
        );
    }
  }
}

class _ToastColors {
  final Color background;
  final Color text;
  final Color icon;
  final Color action;

  const _ToastColors({
    required this.background,
    required this.text,
    required this.icon,
    required this.action,
  });
}

/// Overlay implementation for toast display
class _ToastOverlay extends StatefulWidget {
  const _ToastOverlay({
    required this.message,
    required this.type,
    required this.duration,
    required this.position,
    required this.onDismiss,
    this.icon,
    this.actionLabel,
    this.onAction,
  });

  final String message;
  final UbiToastType type;
  final Duration duration;
  final UbiToastPosition position;
  final VoidCallback onDismiss;
  final IconData? icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  State<_ToastOverlay> createState() => _ToastOverlayState();
}

class _ToastOverlayState extends State<_ToastOverlay> {
  @override
  Widget build(BuildContext context) {
    final mediaQuery = MediaQuery.of(context);
    final topPadding = mediaQuery.padding.top + UbiSpacing.lg;
    final bottomPadding = mediaQuery.padding.bottom + UbiSpacing.lg;

    return Positioned(
      left: 0,
      right: 0,
      top: widget.position == UbiToastPosition.top ? topPadding : null,
      bottom: widget.position == UbiToastPosition.bottom ? bottomPadding : null,
      child: SafeArea(
        child: Center(
          child: UbiToast(
            message: widget.message,
            type: widget.type,
            duration: widget.duration,
            icon: widget.icon,
            actionLabel: widget.actionLabel,
            onAction: widget.onAction,
            position: widget.position,
            onDismiss: widget.onDismiss,
          ),
        ),
      ),
    );
  }
}
