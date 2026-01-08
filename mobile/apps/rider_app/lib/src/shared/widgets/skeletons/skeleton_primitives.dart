import 'package:flutter/material.dart';

/// A skeleton placeholder for text content.
///
/// Matches the height of text with the given style while displaying
/// a rounded rectangle placeholder.
class UbiSkeletonText extends StatelessWidget {
  const UbiSkeletonText({
    super.key,
    this.width,
    this.height,
    this.borderRadius = 4.0,
    this.lines = 1,
    this.lineSpacing = 8.0,
    this.lastLineWidth = 0.7,
  });

  /// Fixed width. If null, expands to fill available space.
  final double? width;

  /// Fixed height. Defaults to 16 for single line text.
  final double? height;

  /// Border radius of the skeleton rectangle.
  final double borderRadius;

  /// Number of text lines to display.
  final int lines;

  /// Spacing between lines.
  final double lineSpacing;

  /// Width multiplier for the last line (0.0 - 1.0).
  /// Creates a more natural look for multi-line text.
  final double lastLineWidth;

  @override
  Widget build(BuildContext context) {
    final lineHeight = height ?? 16.0;

    if (lines == 1) {
      return _SkeletonLine(
        width: width,
        height: lineHeight,
        borderRadius: borderRadius,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: List.generate(lines, (index) {
        final isLastLine = index == lines - 1;
        return Padding(
          padding: EdgeInsets.only(
            bottom: isLastLine ? 0 : lineSpacing,
          ),
          child: _SkeletonLine(
            width: isLastLine && width == null
                ? null
                : isLastLine
                    ? (width ?? double.infinity) * lastLineWidth
                    : width,
            height: lineHeight,
            borderRadius: borderRadius,
            widthFactor: isLastLine && width == null ? lastLineWidth : null,
          ),
        );
      }),
    );
  }
}

/// A skeleton placeholder for a circular avatar.
class UbiSkeletonAvatar extends StatelessWidget {
  const UbiSkeletonAvatar({
    super.key,
    this.size = 48.0,
    this.shape = BoxShape.circle,
    this.borderRadius,
  });

  /// The size of the avatar.
  final double size;

  /// The shape of the avatar skeleton.
  final BoxShape shape;

  /// Border radius for rounded rectangle shape.
  final BorderRadius? borderRadius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: Colors.white,
        shape: shape,
        borderRadius: shape == BoxShape.rectangle ? borderRadius : null,
      ),
    );
  }
}

/// A skeleton placeholder for an icon.
class UbiSkeletonIcon extends StatelessWidget {
  const UbiSkeletonIcon({
    super.key,
    this.size = 24.0,
  });

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }
}

/// A skeleton placeholder for a rectangular container/card.
class UbiSkeletonBox extends StatelessWidget {
  const UbiSkeletonBox({
    super.key,
    required this.width,
    required this.height,
    this.borderRadius = 8.0,
  });

  final double width;
  final double height;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(borderRadius),
      ),
    );
  }
}

/// A skeleton placeholder for a button.
class UbiSkeletonButton extends StatelessWidget {
  const UbiSkeletonButton({
    super.key,
    this.width = 120,
    this.height = 48,
    this.borderRadius = 24,
  });

  final double width;
  final double height;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(borderRadius),
      ),
    );
  }
}

/// A skeleton placeholder for a divider line.
class UbiSkeletonDivider extends StatelessWidget {
  const UbiSkeletonDivider({
    super.key,
    this.height = 1.0,
    this.indent = 0,
    this.endIndent = 0,
  });

  final double height;
  final double indent;
  final double endIndent;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: indent, right: endIndent),
      child: Container(
        height: height,
        color: Colors.white,
      ),
    );
  }
}

/// Internal helper for a single skeleton line.
class _SkeletonLine extends StatelessWidget {
  const _SkeletonLine({
    this.width,
    required this.height,
    required this.borderRadius,
    this.widthFactor,
  });

  final double? width;
  final double height;
  final double borderRadius;
  final double? widthFactor;

  @override
  Widget build(BuildContext context) {
    Widget line = Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(borderRadius),
      ),
    );

    if (widthFactor != null) {
      line = FractionallySizedBox(
        alignment: Alignment.centerLeft,
        widthFactor: widthFactor,
        child: Container(
          height: height,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(borderRadius),
          ),
        ),
      );
    }

    return line;
  }
}
