import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

/// A consistent shimmer animation wrapper for skeleton loading states.
///
/// Uses the shimmer package to create a smooth left-to-right shimmer animation
/// that runs at 60fps. Colors are configured per the acceptance criteria:
/// - Base color: #E5E5E5
/// - Highlight color: #F5F5F5
class UbiShimmerWrapper extends StatelessWidget {
  const UbiShimmerWrapper({
    super.key,
    required this.child,
    this.baseColor,
    this.highlightColor,
    this.enabled = true,
  });

  /// The skeleton content to animate.
  final Widget child;

  /// The base color of the shimmer effect.
  /// Defaults to #E5E5E5 for light mode.
  final Color? baseColor;

  /// The highlight color of the shimmer effect.
  /// Defaults to #F5F5F5 for light mode.
  final Color? highlightColor;

  /// Whether the shimmer animation is enabled.
  /// Set to false to show static skeleton.
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    // Colors per acceptance criteria
    final base = baseColor ??
        (isDark ? const Color(0xFF2A2A2A) : const Color(0xFFE5E5E5));
    final highlight = highlightColor ??
        (isDark ? const Color(0xFF3A3A3A) : const Color(0xFFF5F5F5));

    return Semantics(
      label: 'Loading',
      child: Shimmer.fromColors(
        baseColor: base,
        highlightColor: highlight,
        enabled: enabled,
        direction: ShimmerDirection.ltr,
        period: const Duration(milliseconds: 1500),
        child: child,
      ),
    );
  }
}

/// A shimmer wrapper that adapts to the current theme.
class UbiAdaptiveShimmer extends StatelessWidget {
  const UbiAdaptiveShimmer({
    super.key,
    required this.child,
    this.enabled = true,
  });

  final Widget child;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return UbiShimmerWrapper(
      enabled: enabled,
      child: child,
    );
  }
}
