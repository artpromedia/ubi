import 'package:flutter/material.dart';

/// A draggable map pin widget with bounce animation
///
/// This widget displays a pin marker that bounces when the user
/// starts/stops dragging the map. The pin stays centered on screen
/// while the map moves beneath it.
class DraggableMapPin extends StatefulWidget {
  const DraggableMapPin({
    super.key,
    this.isDragging = false,
    this.pinColor,
    this.shadowColor,
    this.size = 48.0,
    this.isPickup = true,
  });

  /// Whether the pin is currently being dragged
  final bool isDragging;

  /// Custom color for the pin (defaults to theme primary or red/green)
  final Color? pinColor;

  /// Custom shadow color
  final Color? shadowColor;

  /// Size of the pin
  final double size;

  /// Whether this is a pickup (green) or dropoff (red) pin
  final bool isPickup;

  @override
  State<DraggableMapPin> createState() => _DraggableMapPinState();
}

class _DraggableMapPinState extends State<DraggableMapPin>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _bounceAnimation;
  late Animation<double> _shadowAnimation;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 300),
    );

    // Bounce animation - pin lifts up when dragging
    _bounceAnimation = Tween<double>(
      begin: 0.0,
      end: 20.0,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutBack,
      reverseCurve: Curves.bounceOut,
    ));

    // Shadow animation - shadow scales when pin lifts
    _shadowAnimation = Tween<double>(
      begin: 1.0,
      end: 0.6,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOut,
    ));

    if (widget.isDragging) {
      _controller.forward();
    }
  }

  @override
  void didUpdateWidget(DraggableMapPin oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (widget.isDragging != oldWidget.isDragging) {
      if (widget.isDragging) {
        _controller.forward();
      } else {
        _controller.reverse();
      }
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Color get _pinColor {
    if (widget.pinColor != null) return widget.pinColor!;
    return widget.isPickup ? Colors.green : Colors.red;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) {
        return SizedBox(
          width: widget.size * 2,
          height: widget.size * 2,
          child: Stack(
            alignment: Alignment.center,
            children: [
              // Shadow beneath pin
              Positioned(
                bottom: widget.size * 0.3,
                child: Transform.scale(
                  scale: _shadowAnimation.value,
                  child: Container(
                    width: widget.size * 0.5,
                    height: widget.size * 0.15,
                    decoration: BoxDecoration(
                      color: (widget.shadowColor ?? Colors.black)
                          .withOpacity(0.3 * _shadowAnimation.value),
                      borderRadius: BorderRadius.circular(widget.size * 0.1),
                    ),
                  ),
                ),
              ),

              // Pin
              Positioned(
                bottom: widget.size * 0.3 + _bounceAnimation.value,
                child: _buildPin(theme),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildPin(ThemeData theme) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Pin head
        Container(
          width: widget.size,
          height: widget.size,
          decoration: BoxDecoration(
            color: _pinColor,
            shape: BoxShape.circle,
            border: Border.all(
              color: Colors.white,
              width: 3,
            ),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.3),
                blurRadius: 8,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Icon(
            widget.isPickup ? Icons.my_location : Icons.location_on,
            color: Colors.white,
            size: widget.size * 0.5,
          ),
        ),
        // Pin pointer
        CustomPaint(
          size: Size(widget.size * 0.4, widget.size * 0.3),
          painter: _PinPointerPainter(color: _pinColor),
        ),
      ],
    );
  }
}

/// Painter for the triangular pin pointer
class _PinPointerPainter extends CustomPainter {
  _PinPointerPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill;

    final path = Path()
      ..moveTo(0, 0)
      ..lineTo(size.width, 0)
      ..lineTo(size.width / 2, size.height)
      ..close();

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _PinPointerPainter oldDelegate) {
    return oldDelegate.color != color;
  }
}

/// A pulsing dot indicator for the center of the screen
/// when no specific pin is needed
class PulsingLocationDot extends StatefulWidget {
  const PulsingLocationDot({
    super.key,
    this.color,
    this.size = 20.0,
  });

  final Color? color;
  final double size;

  @override
  State<PulsingLocationDot> createState() => _PulsingLocationDotState();
}

class _PulsingLocationDotState extends State<PulsingLocationDot>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();

    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    )..repeat();

    _pulseAnimation = Tween<double>(
      begin: 1.0,
      end: 2.0,
    ).animate(CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOut,
    ));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.color ?? Theme.of(context).primaryColor;

    return SizedBox(
      width: widget.size * 3,
      height: widget.size * 3,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Pulsing ring
          AnimatedBuilder(
            animation: _pulseAnimation,
            builder: (context, _) {
              return Container(
                width: widget.size * _pulseAnimation.value,
                height: widget.size * _pulseAnimation.value,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: color.withOpacity(1 - (_pulseAnimation.value - 1)),
                    width: 2,
                  ),
                ),
              );
            },
          ),
          // Center dot
          Container(
            width: widget.size,
            height: widget.size,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(
                color: Colors.white,
                width: 3,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.2),
                  blurRadius: 4,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
