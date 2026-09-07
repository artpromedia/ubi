import 'package:flutter/material.dart';
import '../../theme/ubi_colors.dart';

/// Logo variant options
enum UbiLogoVariant {
  /// Black text on transparent (for light backgrounds)
  dark,
  /// White text on transparent (for dark backgrounds)
  light,
  /// Green text on transparent (special use)
  green,
}

/// Service-specific logo types
enum UbiService {
  /// Main UBI brand
  main,
  /// UBI Move (ride-hailing)
  move,
  /// UBI Bites (food delivery)
  bites,
  /// UBI Send (package delivery)
  send,
}

/// UBI Logo Widget
/// 
/// Renders the official UBI bouncy wordmark with the signature green dot.
/// Supports different size and color variants.
class UbiLogo extends StatelessWidget {
  const UbiLogo({
    super.key,
    this.size = 40,
    this.variant = UbiLogoVariant.dark,
  });

  /// Size multiplier (base height is 60)
  final double size;

  /// Color variant of the logo
  final UbiLogoVariant variant;

  Color get _strokeColor {
    switch (variant) {
      case UbiLogoVariant.light:
        return UbiColors.ubiWhite;
      case UbiLogoVariant.green:
        return UbiColors.ubiGreen;
      case UbiLogoVariant.dark:
        return UbiColors.ubiBlack;
    }
  }

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(size * 2, size),
      painter: _UbiLogoPainter(
        strokeColor: _strokeColor,
        dotColor: UbiColors.ubiGreen,
      ),
    );
  }
}

/// UBI Icon Widget
/// 
/// Compact stylized "U" with accent dot.
/// For app icons, avatars, and small spaces.
class UbiIcon extends StatelessWidget {
  const UbiIcon({
    super.key,
    this.size = 40,
    this.variant = UbiLogoVariant.light,
  });

  /// Icon size in pixels
  final double size;

  /// Color variant of the icon
  final UbiLogoVariant variant;

  Color get _strokeColor {
    switch (variant) {
      case UbiLogoVariant.light:
        return UbiColors.ubiWhite;
      case UbiLogoVariant.green:
        return UbiColors.ubiGreen;
      case UbiLogoVariant.dark:
        return UbiColors.ubiBlack;
    }
  }

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size(size, size),
      painter: _UbiIconPainter(
        strokeColor: _strokeColor,
        dotColor: UbiColors.ubiGreen,
      ),
    );
  }
}

/// UBI Logo Badge Widget
/// 
/// Rounded square with UBI icon inside.
/// For app icons and avatars.
class UbiLogoBadge extends StatelessWidget {
  const UbiLogoBadge({
    super.key,
    this.size = 60,
    this.backgroundColor,
    this.borderRadius = 16,
  });

  /// Badge size
  final double size;

  /// Background color (defaults to UBI black)
  final Color? backgroundColor;

  /// Border radius
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: backgroundColor ?? UbiColors.ubiBlack,
        borderRadius: BorderRadius.circular(borderRadius),
      ),
      child: Center(
        child: UbiIcon(
          size: size * 0.6,
          variant: UbiLogoVariant.light,
        ),
      ),
    );
  }
}

/// UBI Service Badge Widget
/// 
/// Service-specific badges with gradient backgrounds.
class UbiServiceBadge extends StatelessWidget {
  const UbiServiceBadge({
    super.key,
    required this.service,
    this.size = 60,
    this.borderRadius = 16,
  });

  /// Service type
  final UbiService service;

  /// Badge size
  final double size;

  /// Border radius
  final double borderRadius;

  List<Color> get _gradientColors {
    switch (service) {
      case UbiService.main:
      case UbiService.move:
        return const [Color(0xFF22C55E), Color(0xFF059669)];
      case UbiService.bites:
        return const [Color(0xFFF97316), Color(0xFFEF4444)];
      case UbiService.send:
        return const [Color(0xFF06B6D4), Color(0xFF0891B2)];
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: _gradientColors,
        ),
        borderRadius: BorderRadius.circular(borderRadius),
        boxShadow: [
          BoxShadow(
            color: _gradientColors.first.withOpacity(0.3),
            blurRadius: 12,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Center(
        child: UbiIcon(
          size: size * 0.55,
          variant: UbiLogoVariant.light,
        ),
      ),
    );
  }
}

/// Service Logo Widget
/// 
/// Full logo with service name (e.g., "Ubi Move", "Ubi Bites")
class UbiServiceLogo extends StatelessWidget {
  const UbiServiceLogo({
    super.key,
    required this.service,
    this.size = 32,
    this.variant = UbiLogoVariant.dark,
  });

  /// Service type
  final UbiService service;

  /// Size multiplier
  final double size;

  /// Color variant
  final UbiLogoVariant variant;

  String get _serviceName {
    switch (service) {
      case UbiService.main:
        return '';
      case UbiService.move:
        return 'Move';
      case UbiService.bites:
        return 'Bites';
      case UbiService.send:
        return 'Send';
    }
  }

  Color get _textColor {
    switch (variant) {
      case UbiLogoVariant.light:
        return UbiColors.ubiWhite;
      case UbiLogoVariant.green:
        return UbiColors.ubiGreen;
      case UbiLogoVariant.dark:
        return UbiColors.ubiBlack;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        UbiLogo(size: size, variant: variant),
        if (_serviceName.isNotEmpty) ...[
          SizedBox(width: size * 0.15),
          Text(
            _serviceName,
            style: TextStyle(
              fontSize: size * 0.6,
              fontWeight: FontWeight.w600,
              color: _textColor,
              fontFamily: 'System',
            ),
          ),
        ],
      ],
    );
  }
}

// === Custom Painters ===

class _UbiLogoPainter extends CustomPainter {
  _UbiLogoPainter({
    required this.strokeColor,
    required this.dotColor,
  });

  final Color strokeColor;
  final Color dotColor;

  @override
  void paint(Canvas canvas, Size size) {
    final double scale = size.height / 60;
    final strokePaint = Paint()
      ..color = strokeColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 9 * scale
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final dotPaint = Paint()
      ..color = dotColor
      ..style = PaintingStyle.fill;

    // U - sitting lower
    final uPath = Path();
    uPath.moveTo(8 * scale, 18 * scale);
    uPath.lineTo(8 * scale, 42 * scale);
    uPath.quadraticBezierTo(8 * scale, 54 * scale, 20 * scale, 54 * scale);
    uPath.quadraticBezierTo(32 * scale, 54 * scale, 32 * scale, 42 * scale);
    uPath.lineTo(32 * scale, 18 * scale);
    canvas.drawPath(uPath, strokePaint);

    // b - bounced up (stem)
    canvas.drawLine(
      Offset(46 * scale, 4 * scale),
      Offset(46 * scale, 44 * scale),
      strokePaint,
    );

    // b - bounced up (bowl)
    final bPath = Path();
    bPath.moveTo(46 * scale, 26 * scale);
    bPath.quadraticBezierTo(46 * scale, 18 * scale, 56 * scale, 18 * scale);
    bPath.quadraticBezierTo(68 * scale, 18 * scale, 68 * scale, 31 * scale);
    bPath.quadraticBezierTo(68 * scale, 44 * scale, 56 * scale, 44 * scale);
    bPath.quadraticBezierTo(46 * scale, 44 * scale, 46 * scale, 36 * scale);
    canvas.drawPath(bPath, strokePaint);

    // i - bounced down (stem)
    canvas.drawLine(
      Offset(84 * scale, 24 * scale),
      Offset(84 * scale, 52 * scale),
      strokePaint,
    );

    // i - green dot
    canvas.drawCircle(
      Offset(84 * scale, 12 * scale),
      6 * scale,
      dotPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _UbiLogoPainter oldDelegate) {
    return strokeColor != oldDelegate.strokeColor ||
        dotColor != oldDelegate.dotColor;
  }
}

class _UbiIconPainter extends CustomPainter {
  _UbiIconPainter({
    required this.strokeColor,
    required this.dotColor,
  });

  final Color strokeColor;
  final Color dotColor;

  @override
  void paint(Canvas canvas, Size size) {
    final double scale = size.width / 60;
    final strokePaint = Paint()
      ..color = strokeColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 10 * scale
      ..strokeCap = StrokeCap.round;

    final dotPaint = Paint()
      ..color = dotColor
      ..style = PaintingStyle.fill;

    // Stylized U with bounce
    final uPath = Path();
    uPath.moveTo(15 * scale, 12 * scale);
    uPath.lineTo(15 * scale, 38 * scale);
    uPath.quadraticBezierTo(15 * scale, 52 * scale, 30 * scale, 52 * scale);
    uPath.quadraticBezierTo(45 * scale, 52 * scale, 45 * scale, 38 * scale);
    uPath.lineTo(45 * scale, 12 * scale);
    canvas.drawPath(uPath, strokePaint);

    // Green dot accent
    canvas.drawCircle(
      Offset(45 * scale, 8 * scale),
      6 * scale,
      dotPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _UbiIconPainter oldDelegate) {
    return strokeColor != oldDelegate.strokeColor ||
        dotColor != oldDelegate.dotColor;
  }
}
