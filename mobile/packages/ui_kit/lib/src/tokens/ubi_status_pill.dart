/// Status pill. Colour is never the only carrier of meaning: the label is a
/// required argument, so a status can not be rendered as a bare coloured dot
/// (CLAUDE.md rule 10, slice 12 accessibility).
library;

import 'package:flutter/material.dart';

import 'ubi_semantic_colors.dart';
import 'ubi_token_scale.dart';
import 'ubi_token_typography.dart';

/// The `statusBadges` map in `contracts/semantic-tokens.json`.
enum UbiStatusTone {
  /// warnTint / warnInk — looking for a driver.
  searching,

  /// travelTint / travelInk — driver assigned, en route.
  assigned,

  /// moveTint / moveInk — trip under way.
  inTrip,

  /// bg2 / text2 — finished.
  completed,

  /// errorTint / errorInk — cancelled.
  cancelled,

  /// error / bg — safety hold, the one tone that inverts.
  safetyHold,
}

@immutable
class UbiStatusPill extends StatelessWidget {
  const UbiStatusPill({
    required this.tone,
    required this.label,
    super.key,
    this.icon,
    this.semanticsLabel,
  });

  /// Which token pair to use.
  final UbiStatusTone tone;

  /// The status in words. Required — this is what makes the pill readable
  /// without colour.
  final String label;

  /// Optional leading glyph. Decorative only; it never replaces [label].
  final IconData? icon;

  /// Announced instead of [label] when the visible copy is abbreviated.
  final String? semanticsLabel;

  _PillColors _colorsFor(UbiSemanticColors c) {
    switch (tone) {
      case UbiStatusTone.searching:
        return _PillColors(c.warnTint, c.warnInk);
      case UbiStatusTone.assigned:
        return _PillColors(c.travelTint, c.travelInk);
      case UbiStatusTone.inTrip:
        return _PillColors(c.moveTint, c.moveInk);
      case UbiStatusTone.completed:
        return _PillColors(c.bg2, c.text2);
      case UbiStatusTone.cancelled:
        return _PillColors(c.errorTint, c.errorInk);
      case UbiStatusTone.safetyHold:
        return _PillColors(c.error, c.bg);
    }
  }

  @override
  Widget build(BuildContext context) {
    final UbiSemanticColors colors = UbiSemanticColors.of(context);
    final _PillColors pill = _colorsFor(colors);

    return Semantics(
      container: true,
      label: semanticsLabel ?? label,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: UbiSpace.x6),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: pill.background,
            borderRadius: UbiRadii.chipBorder,
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: UbiSpace.x3,
              vertical: UbiSpace.x1,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (icon != null) ...<Widget>[
                  Icon(icon, size: UbiSpace.x4, color: pill.foreground),
                  const SizedBox(width: UbiSpace.x1),
                ],
                Flexible(
                  child: Text(
                    label,
                    overflow: TextOverflow.ellipsis,
                    style: UbiTokenTypography.labelMedium
                        .copyWith(color: pill.foreground),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

@immutable
class _PillColors {
  const _PillColors(this.background, this.foreground);

  final Color background;
  final Color foreground;
}
