/// Money and plate text.
///
/// Both take a string that has already been formatted from city config — the
/// kit never formats an amount, because it does not know the currency
/// (CLAUDE.md rule 6). Its job is the type treatment: tabular figures for
/// money, monospace for plates, and an accessible label for both (rule 11 and
/// slice 12).
library;

import 'package:flutter/material.dart';

import 'ubi_semantic_colors.dart';
import 'ubi_token_typography.dart';

/// Renders a pre-formatted amount with tabular figures.
class UbiMoneyText extends StatelessWidget {
  const UbiMoneyText({
    required this.value,
    required this.semanticsLabel,
    super.key,
    this.fontSize = 16,
    this.fontWeight = FontWeight.w600,
    this.color,
    this.textAlign,
  });

  /// The formatted amount, e.g. what `UbiMoneyFormatter.format` returned.
  final String value;

  /// Announced instead of [value] so money is always read with its currency.
  /// Use `UbiMoneyFormatter.semanticsLabel`.
  final String semanticsLabel;

  final double fontSize;
  final FontWeight fontWeight;
  final Color? color;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) {
    final UbiSemanticColors colors = UbiSemanticColors.of(context);
    return Text(
      value,
      textAlign: textAlign,
      semanticsLabel: semanticsLabel,
      style: UbiTokenTypography.money(
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color ?? colors.ink,
      ),
    );
  }
}

/// Renders a vehicle plate, booking reference, PNR or delivery code.
class UbiPlateText extends StatelessWidget {
  const UbiPlateText({
    required this.value,
    super.key,
    this.semanticsLabel,
    this.fontSize = 15,
    this.color,
  });

  /// The plate exactly as the server sent it. Never reformatted locally.
  final String value;

  /// Read the plate together with the vehicle as one label (slice 12), e.g.
  /// `Silver Toyota Corolla, plate LSR 244 GH`.
  final String? semanticsLabel;

  final double fontSize;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final UbiSemanticColors colors = UbiSemanticColors.of(context);
    return Text(
      value,
      semanticsLabel: semanticsLabel,
      style: UbiTokenTypography.mono(
        fontSize: fontSize,
        color: color ?? colors.ink,
      ),
    );
  }
}
