import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_spacing.dart';

/// UBI Loading Indicator Size
enum UbiLoadingSize {
  /// Small (16px)
  small,
  
  /// Medium (24px)
  medium,
  
  /// Large (36px)
  large,
  
  /// Extra large (48px)
  extraLarge,
}

/// UBI Loading Indicator
///
/// A circular loading indicator with UBI branding.
class UbiLoadingIndicator extends StatelessWidget {
  const UbiLoadingIndicator({
    super.key,
    this.size = UbiLoadingSize.medium,
    this.customSize,
    this.color,
    this.strokeWidth,
    this.value,
    this.semanticsLabel = 'Loading',
  });

  /// Size preset
  final UbiLoadingSize size;

  /// Custom size (overrides preset)
  final double? customSize;

  /// Custom color
  final Color? color;

  /// Custom stroke width
  final double? strokeWidth;

  /// Progress value (0.0 to 1.0) for determinate indicator
  final double? value;

  /// Semantics label for accessibility
  final String semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final effectiveSize = customSize ?? _getSizeValue(size);
    final effectiveStrokeWidth = strokeWidth ?? _getStrokeWidth(size);
    final effectiveColor = color ?? UbiColors.ubiGreen;

    return Semantics(
      label: semanticsLabel,
      child: SizedBox(
        width: effectiveSize,
        height: effectiveSize,
        child: CircularProgressIndicator(
          value: value,
          strokeWidth: effectiveStrokeWidth,
          valueColor: AlwaysStoppedAnimation(effectiveColor),
          backgroundColor: effectiveColor.withOpacity(0.2),
        ),
      ),
    );
  }

  double _getSizeValue(UbiLoadingSize size) {
    switch (size) {
      case UbiLoadingSize.small:
        return 16;
      case UbiLoadingSize.medium:
        return 24;
      case UbiLoadingSize.large:
        return 36;
      case UbiLoadingSize.extraLarge:
        return 48;
    }
  }

  double _getStrokeWidth(UbiLoadingSize size) {
    switch (size) {
      case UbiLoadingSize.small:
        return 2;
      case UbiLoadingSize.medium:
        return 2.5;
      case UbiLoadingSize.large:
        return 3;
      case UbiLoadingSize.extraLarge:
        return 4;
    }
  }
}

/// UBI Loading Overlay
///
/// A full-screen loading overlay with backdrop.
class UbiLoadingOverlay extends StatelessWidget {
  const UbiLoadingOverlay({
    super.key,
    this.isLoading = true,
    this.message,
    this.color,
    this.backgroundColor,
    required this.child,
  });

  /// Whether loading is active
  final bool isLoading;

  /// Optional loading message
  final String? message;

  /// Loading indicator color
  final Color? color;

  /// Overlay background color
  final Color? backgroundColor;

  /// Child widget
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        child,
        if (isLoading)
          Positioned.fill(
            child: Container(
              color: backgroundColor ?? UbiColors.overlayMedium,
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    UbiLoadingIndicator(
                      size: UbiLoadingSize.large,
                      color: color,
                    ),
                    if (message != null) ...[
                      SizedBox(height: UbiSpacing.md),
                      Text(
                        message!,
                        style: TextStyle(
                          color: color ?? UbiColors.ubiGreen,
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// UBI Skeleton Loader
///
/// A shimmer effect placeholder for loading states.
class UbiSkeleton extends StatelessWidget {
  const UbiSkeleton({
    super.key,
    this.width,
    this.height,
    this.borderRadius,
    this.shape = BoxShape.rectangle,
  });

  /// Width of the skeleton
  final double? width;

  /// Height of the skeleton
  final double? height;

  /// Border radius
  final BorderRadius? borderRadius;

  /// Shape of the skeleton
  final BoxShape shape;

  /// Creates a circular skeleton
  const UbiSkeleton.circular({
    super.key,
    double size = 40,
  })  : width = size,
        height = size,
        borderRadius = null,
        shape = BoxShape.circle;

  /// Creates a text line skeleton
  const UbiSkeleton.text({
    super.key,
    this.width = double.infinity,
    double textHeight = 14,
  })  : height = textHeight,
        borderRadius = const BorderRadius.all(Radius.circular(4)),
        shape = BoxShape.rectangle;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final baseColor = isDark ? UbiColors.gray800 : UbiColors.gray200;
    final highlightColor = isDark ? UbiColors.gray700 : UbiColors.gray100;

    return Shimmer.fromColors(
      baseColor: baseColor,
      highlightColor: highlightColor,
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: baseColor,
          shape: shape,
          borderRadius: shape == BoxShape.rectangle ? borderRadius : null,
        ),
      ),
    );
  }
}

/// UBI Card Skeleton
///
/// A pre-built skeleton for card loading states.
class UbiCardSkeleton extends StatelessWidget {
  const UbiCardSkeleton({
    super.key,
    this.hasImage = true,
    this.imageHeight = 120,
    this.lines = 3,
  });

  /// Whether to show image placeholder
  final bool hasImage;

  /// Image placeholder height
  final double imageHeight;

  /// Number of text line placeholders
  final int lines;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return Container(
      padding: EdgeInsets.all(UbiSpacing.md),
      decoration: BoxDecoration(
        color: isDark ? UbiColors.cardDark : UbiColors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isDark ? UbiColors.borderDark : UbiColors.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (hasImage) ...[
            UbiSkeleton(
              height: imageHeight,
              borderRadius: BorderRadius.circular(12),
            ),
            SizedBox(height: UbiSpacing.md),
          ],
          ...List.generate(lines, (index) {
            final isLast = index == lines - 1;
            return Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : UbiSpacing.sm),
              child: UbiSkeleton.text(
                width: isLast ? 100 : double.infinity,
                textHeight: index == 0 ? 18 : 14,
              ),
            );
          }),
        ],
      ),
    );
  }
}

/// UBI List Item Skeleton
///
/// A pre-built skeleton for list item loading states.
class UbiListItemSkeleton extends StatelessWidget {
  const UbiListItemSkeleton({
    super.key,
    this.hasLeading = true,
    this.hasTrailing = false,
    this.leadingSize = 48,
  });

  /// Whether to show leading placeholder
  final bool hasLeading;

  /// Whether to show trailing placeholder
  final bool hasTrailing;

  /// Size of the leading placeholder
  final double leadingSize;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(
        horizontal: UbiSpacing.md,
        vertical: UbiSpacing.sm,
      ),
      child: Row(
        children: [
          if (hasLeading) ...[
            UbiSkeleton.circular(size: leadingSize),
            SizedBox(width: UbiSpacing.md),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const UbiSkeleton.text(width: 150, textHeight: 16),
                SizedBox(height: UbiSpacing.xs),
                const UbiSkeleton.text(width: 100, textHeight: 12),
              ],
            ),
          ),
          if (hasTrailing) ...[
            SizedBox(width: UbiSpacing.md),
            const UbiSkeleton(
              width: 60,
              height: 24,
              borderRadius: BorderRadius.all(Radius.circular(12)),
            ),
          ],
        ],
      ),
    );
  }
}

/// UBI Pulse Loader
///
/// A pulsating dot animation loader.
class UbiPulseLoader extends StatefulWidget {
  const UbiPulseLoader({
    super.key,
    this.dotCount = 3,
    this.dotSize = 8,
    this.dotSpacing = 4,
    this.color,
    this.duration = const Duration(milliseconds: 600),
  });

  /// Number of dots
  final int dotCount;

  /// Size of each dot
  final double dotSize;

  /// Spacing between dots
  final double dotSpacing;

  /// Dot color
  final Color? color;

  /// Animation duration per dot
  final Duration duration;

  @override
  State<UbiPulseLoader> createState() => _UbiPulseLoaderState();
}

class _UbiPulseLoaderState extends State<UbiPulseLoader>
    with TickerProviderStateMixin {
  late List<AnimationController> _controllers;
  late List<Animation<double>> _animations;

  @override
  void initState() {
    super.initState();
    _controllers = List.generate(
      widget.dotCount,
      (index) => AnimationController(
        vsync: this,
        duration: widget.duration,
      ),
    );

    _animations = _controllers.map((controller) {
      return Tween<double>(begin: 0.4, end: 1.0).animate(
        CurvedAnimation(parent: controller, curve: Curves.easeInOut),
      );
    }).toList();

    // Start animations with staggered delay
    for (var i = 0; i < widget.dotCount; i++) {
      Future.delayed(Duration(milliseconds: i * 150), () {
        if (mounted) {
          _controllers[i].repeat(reverse: true);
        }
      });
    }
  }

  @override
  void dispose() {
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? UbiColors.ubiGreen;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(widget.dotCount, (index) {
        return AnimatedBuilder(
          animation: _animations[index],
          builder: (context, child) {
            return Container(
              margin: EdgeInsets.only(
                right: index < widget.dotCount - 1 ? widget.dotSpacing : 0,
              ),
              width: widget.dotSize,
              height: widget.dotSize,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: color.withOpacity(_animations[index].value),
              ),
            );
          },
        );
      }),
    );
  }
}
