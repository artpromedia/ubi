import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';

/// UBI Rating
///
/// A star-based rating component for displaying or collecting ratings.
/// Supports half-star ratings and interactive selection.
class UbiRating extends StatefulWidget {
  const UbiRating({
    super.key,
    required this.value,
    this.maxValue = 5,
    this.onChanged,
    this.readOnly = false,
    this.size = UbiRatingSize.medium,
    this.filledColor,
    this.emptyColor,
    this.showValue = false,
    this.valuePosition = UbiRatingValuePosition.trailing,
    this.allowHalfRating = true,
    this.itemPadding = 2.0,
    this.semanticsLabel,
  });

  /// Current rating value
  final double value;

  /// Maximum rating value
  final int maxValue;

  /// Callback when rating changes
  final ValueChanged<double>? onChanged;

  /// Whether the rating is read-only
  final bool readOnly;

  /// Size of the rating stars
  final UbiRatingSize size;

  /// Color of filled stars
  final Color? filledColor;

  /// Color of empty stars
  final Color? emptyColor;

  /// Whether to show numeric value
  final bool showValue;

  /// Position of numeric value
  final UbiRatingValuePosition valuePosition;

  /// Whether half-star ratings are allowed
  final bool allowHalfRating;

  /// Padding between stars
  final double itemPadding;

  /// Accessibility label
  final String? semanticsLabel;

  @override
  State<UbiRating> createState() => _UbiRatingState();
}

class _UbiRatingState extends State<UbiRating> {
  double _hoverValue = 0;
  bool _isHovering = false;

  @override
  Widget build(BuildContext context) {
    final starSize = _getStarSize();
    final effectiveFilledColor = widget.filledColor ?? const Color(0xFFFBBF24);
    final effectiveEmptyColor = widget.emptyColor ?? UbiColors.gray300;

    final displayValue = _isHovering ? _hoverValue : widget.value;

    Widget starsRow = Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(widget.maxValue, (index) {
        final starValue = index + 1;
        final fillAmount = (displayValue - index).clamp(0.0, 1.0);

        return Padding(
          padding: EdgeInsets.symmetric(horizontal: widget.itemPadding / 2),
          child: widget.readOnly
              ? _buildStar(
                  starSize,
                  fillAmount,
                  effectiveFilledColor,
                  effectiveEmptyColor,
                )
              : GestureDetector(
                  onTapDown: (details) => _handleTap(details, index, starSize),
                  onHorizontalDragUpdate: (details) =>
                      _handleDrag(details, starSize),
                  onHorizontalDragEnd: (_) => _endInteraction(),
                  child: MouseRegion(
                    onEnter: (_) => setState(() => _isHovering = true),
                    onExit: (_) => setState(() {
                      _isHovering = false;
                      _hoverValue = 0;
                    }),
                    onHover: (event) => _handleHover(event, index, starSize),
                    child: _buildStar(
                      starSize,
                      fillAmount,
                      effectiveFilledColor,
                      effectiveEmptyColor,
                    ),
                  ),
                ),
        );
      }),
    );

    if (widget.showValue) {
      final valueText = Text(
        widget.value.toStringAsFixed(1),
        style: _getValueTextStyle(),
      );

      if (widget.valuePosition == UbiRatingValuePosition.leading) {
        starsRow = Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            valueText,
            SizedBox(width: UbiSpacing.sm),
            starsRow,
          ],
        );
      } else {
        starsRow = Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            starsRow,
            SizedBox(width: UbiSpacing.sm),
            valueText,
          ],
        );
      }
    }

    return Semantics(
      label: widget.semanticsLabel ??
          'Rating: ${widget.value} out of ${widget.maxValue} stars',
      value: widget.value.toString(),
      child: starsRow,
    );
  }

  Widget _buildStar(
    double size,
    double fillAmount,
    Color filledColor,
    Color emptyColor,
  ) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        children: [
          Icon(
            Icons.star,
            size: size,
            color: emptyColor,
          ),
          ClipRect(
            clipper: _StarClipper(fillAmount),
            child: Icon(
              Icons.star,
              size: size,
              color: filledColor,
            ),
          ),
        ],
      ),
    );
  }

  void _handleTap(TapDownDetails details, int starIndex, double starSize) {
    if (widget.readOnly) return;

    final localX = details.localPosition.dx;
    double newValue;

    if (widget.allowHalfRating) {
      final halfStar = localX < starSize / 2;
      newValue = starIndex + (halfStar ? 0.5 : 1.0);
    } else {
      newValue = (starIndex + 1).toDouble();
    }

    widget.onChanged?.call(newValue);
  }

  void _handleDrag(DragUpdateDetails details, double starSize) {
    if (widget.readOnly) return;

    // Calculate based on total width
    final totalWidth = widget.maxValue * (starSize + widget.itemPadding);
    final ratio = details.localPosition.dx / totalWidth;
    double newValue = (ratio * widget.maxValue).clamp(0.0, widget.maxValue.toDouble());

    if (!widget.allowHalfRating) {
      newValue = newValue.ceilToDouble();
    } else {
      newValue = (newValue * 2).round() / 2;
    }

    widget.onChanged?.call(newValue);
  }

  void _handleHover(PointerEvent event, int starIndex, double starSize) {
    if (widget.readOnly) return;

    final localX = event.localPosition.dx;
    double hoverValue;

    if (widget.allowHalfRating) {
      final halfStar = localX < starSize / 2;
      hoverValue = starIndex + (halfStar ? 0.5 : 1.0);
    } else {
      hoverValue = (starIndex + 1).toDouble();
    }

    setState(() => _hoverValue = hoverValue);
  }

  void _endInteraction() {
    setState(() {
      _isHovering = false;
      _hoverValue = 0;
    });
  }

  double _getStarSize() {
    switch (widget.size) {
      case UbiRatingSize.small:
        return 16;
      case UbiRatingSize.medium:
        return 24;
      case UbiRatingSize.large:
        return 32;
      case UbiRatingSize.extraLarge:
        return 40;
    }
  }

  TextStyle _getValueTextStyle() {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    final color = isDark ? UbiColors.ubiWhite : UbiColors.gray900;

    switch (widget.size) {
      case UbiRatingSize.small:
        return UbiTypography.caption.copyWith(
          color: color,
          fontWeight: FontWeight.w600,
        );
      case UbiRatingSize.medium:
        return UbiTypography.bodySmall.copyWith(
          color: color,
          fontWeight: FontWeight.w600,
        );
      case UbiRatingSize.large:
        return UbiTypography.bodyMedium.copyWith(
          color: color,
          fontWeight: FontWeight.w600,
        );
      case UbiRatingSize.extraLarge:
        return UbiTypography.bodyLarge.copyWith(
          color: color,
          fontWeight: FontWeight.w700,
        );
    }
  }
}

/// Custom clipper for partial star fill
class _StarClipper extends CustomClipper<Rect> {
  final double fillAmount;

  _StarClipper(this.fillAmount);

  @override
  Rect getClip(Size size) {
    return Rect.fromLTWH(0, 0, size.width * fillAmount, size.height);
  }

  @override
  bool shouldReclip(_StarClipper oldClipper) {
    return fillAmount != oldClipper.fillAmount;
  }
}

/// UBI Rating Sizes
enum UbiRatingSize {
  /// Small size (16px stars)
  small,

  /// Medium size (24px stars)
  medium,

  /// Large size (32px stars)
  large,

  /// Extra large size (40px stars)
  extraLarge,
}

/// UBI Rating Value Position
enum UbiRatingValuePosition {
  /// Value displayed before stars
  leading,

  /// Value displayed after stars
  trailing,
}

/// UBI Rating Bar
///
/// A compact rating display with progress bar visualization.
/// Useful for rating breakdowns and statistics.
class UbiRatingBar extends StatelessWidget {
  const UbiRatingBar({
    super.key,
    required this.rating,
    required this.count,
    required this.totalCount,
    this.barColor,
    this.backgroundColor,
    this.showPercentage = false,
  });

  /// Star rating (1-5)
  final int rating;

  /// Number of ratings with this value
  final int count;

  /// Total number of ratings
  final int totalCount;

  /// Color of the filled bar
  final Color? barColor;

  /// Color of the empty bar background
  final Color? backgroundColor;

  /// Whether to show percentage instead of count
  final bool showPercentage;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final effectiveBarColor = barColor ?? const Color(0xFFFBBF24);
    final effectiveBackgroundColor = backgroundColor ??
        (isDark ? UbiColors.gray700 : UbiColors.gray200);

    final percentage = totalCount > 0 ? count / totalCount : 0.0;

    return Row(
      children: [
        SizedBox(
          width: 16,
          child: Text(
            rating.toString(),
            style: UbiTypography.caption.copyWith(
              color: UbiColors.gray500,
            ),
          ),
        ),
        Icon(
          Icons.star,
          size: 14,
          color: effectiveBarColor,
        ),
        SizedBox(width: UbiSpacing.sm),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: percentage,
              minHeight: 8,
              backgroundColor: effectiveBackgroundColor,
              valueColor: AlwaysStoppedAnimation<Color>(effectiveBarColor),
            ),
          ),
        ),
        SizedBox(width: UbiSpacing.sm),
        SizedBox(
          width: 40,
          child: Text(
            showPercentage
                ? '${(percentage * 100).toInt()}%'
                : count.toString(),
            style: UbiTypography.caption.copyWith(
              color: isDark ? UbiColors.gray400 : UbiColors.gray600,
            ),
            textAlign: TextAlign.end,
          ),
        ),
      ],
    );
  }
}
