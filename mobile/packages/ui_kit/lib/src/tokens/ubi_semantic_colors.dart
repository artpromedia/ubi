/// Semantic colour tokens, transcribed from `contracts/semantic-tokens.json`.
///
/// Every value below is a token from that file. Two roles have no counterpart
/// in one of the themes; both reuse an existing token rather than inventing a
/// colour, and each one says which token it reuses.
///
/// Carried on [ThemeData.extensions] so a widget reads
/// `UbiSemanticColors.of(context)` and gets the right theme automatically.
library;

import 'package:flutter/material.dart';

@immutable
class UbiSemanticColors extends ThemeExtension<UbiSemanticColors> {
  const UbiSemanticColors({
    required this.bg,
    required this.bg2,
    required this.surface,
    required this.border,
    required this.borderStrong,
    required this.divider,
    required this.ink,
    required this.text2,
    required this.text3,
    required this.move,
    required this.moveInk,
    required this.moveTint,
    required this.link,
    required this.warn,
    required this.warnInk,
    required this.warnTint,
    required this.error,
    required this.errorInk,
    required this.errorTint,
    required this.travel,
    required this.travelInk,
    required this.travelTint,
    required this.bites,
    required this.bitesInk,
    required this.bitesTint,
    required this.send,
    required this.sendInk,
    required this.sendTint,
    required this.primaryButton,
    required this.onPrimaryButton,
    required this.primaryButtonDisabled,
    required this.onPrimaryButtonDisabled,
  });

  /// `light` block of the token file.
  static const UbiSemanticColors light = UbiSemanticColors(
    bg: Color(0xFFFFFFFF),
    bg2: Color(0xFFF5F5F5),
    // Light has no separate card token; cards sit on `bg`.
    surface: Color(0xFFFFFFFF),
    border: Color(0xFFE5E5E5),
    // Light has no `border2`; the strong border reuses the `text3` token.
    borderStrong: Color(0xFF999999),
    divider: Color(0xFFF0F0F0),
    ink: Color(0xFF191414),
    text2: Color(0xFF666666),
    text3: Color(0xFF999999),
    move: Color(0xFF1DB954),
    moveInk: Color(0xFF148F3D),
    moveTint: Color(0xFFE8F8EE),
    link: Color(0xFF18A349),
    warn: Color(0xFFF5A623),
    warnInk: Color(0xFFB8860B),
    warnTint: Color(0xFFFEF6E8),
    error: Color(0xFFE53E3E),
    errorInk: Color(0xFFC53030),
    errorTint: Color(0xFFFDE8E8),
    travel: Color(0xFF3182CE),
    travelInk: Color(0xFF2B6CB0),
    travelTint: Color(0xFFEBF4FF),
    bites: Color(0xFFFF7545),
    bitesInk: Color(0xFFC2410C),
    bitesTint: Color(0xFFFFF1EB),
    send: Color(0xFF10AEBA),
    sendInk: Color(0xFF0E7F88),
    sendTint: Color(0xFFE6F7F8),
    primaryButton: Color(0xFF1DB954),
    onPrimaryButton: Color(0xFF191414),
    primaryButtonDisabled: Color(0x661DB954),
    onPrimaryButtonDisabled: Color(0xFF737373),
  );

  /// `dark` block of the token file. Tints are the token file's
  /// `rgba(r,g,b,.15)` values expressed as 0x26 alpha.
  static const UbiSemanticColors dark = UbiSemanticColors(
    bg: Color(0xFF0A0A0A),
    bg2: Color(0xFF171717),
    surface: Color(0xFF1A1A1A),
    border: Color(0xFF262626),
    borderStrong: Color(0xFF404040),
    // Dark has no separate divider token; it reuses `border`.
    divider: Color(0xFF262626),
    ink: Color(0xFFFFFFFF),
    text2: Color(0xFFA3A3A3),
    text3: Color(0xFF737373),
    move: Color(0xFF22D66A),
    moveInk: Color(0xFF22D66A),
    moveTint: Color(0x2622D66A),
    link: Color(0xFF63B3ED),
    warn: Color(0xFFFBB034),
    warnInk: Color(0xFFFBB034),
    warnTint: Color(0x26FBB034),
    error: Color(0xFFF87171),
    errorInk: Color(0xFFF87171),
    errorTint: Color(0x26F87171),
    travel: Color(0xFF63B3ED),
    travelInk: Color(0xFF63B3ED),
    travelTint: Color(0x2663B3ED),
    // Dark defines no Bites/Send pair; both reuse the brand token with the
    // same 15% tint the other dark statuses use.
    bites: Color(0xFFFF7545),
    bitesInk: Color(0xFFFF7545),
    bitesTint: Color(0x26FF7545),
    send: Color(0xFF10AEBA),
    sendInk: Color(0xFF10AEBA),
    sendTint: Color(0x2610AEBA),
    primaryButton: Color(0xFF1DB954),
    onPrimaryButton: Color(0xFF191414),
    primaryButtonDisabled: Color(0x661DB954),
    onPrimaryButtonDisabled: Color(0xFF737373),
  );

  /// Page background.
  final Color bg;

  /// Recessed background (grouped rows, completed status).
  final Color bg2;

  /// Card / sheet surface.
  final Color surface;

  final Color border;
  final Color borderStrong;
  final Color divider;

  /// Primary text.
  final Color ink;

  /// Secondary text.
  final Color text2;

  /// Tertiary text.
  final Color text3;

  /// UBI Move accent, its readable ink, and its tint.
  final Color move;
  final Color moveInk;
  final Color moveTint;

  final Color link;

  final Color warn;
  final Color warnInk;
  final Color warnTint;

  final Color error;
  final Color errorInk;
  final Color errorTint;

  final Color travel;
  final Color travelInk;
  final Color travelTint;

  final Color bites;
  final Color bitesInk;
  final Color bitesTint;

  final Color send;
  final Color sendInk;
  final Color sendTint;

  final Color primaryButton;
  final Color onPrimaryButton;
  final Color primaryButtonDisabled;
  final Color onPrimaryButtonDisabled;

  /// The token set for the current theme.
  ///
  /// Falls back on brightness rather than throwing, so a widget rendered
  /// outside a UBI theme (a golden test, a host app) still gets tokens instead
  /// of a crash.
  static UbiSemanticColors of(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return theme.extension<UbiSemanticColors>() ??
        (theme.brightness == Brightness.dark ? dark : light);
  }

  @override
  UbiSemanticColors copyWith({
    Color? bg,
    Color? bg2,
    Color? surface,
    Color? border,
    Color? borderStrong,
    Color? divider,
    Color? ink,
    Color? text2,
    Color? text3,
    Color? move,
    Color? moveInk,
    Color? moveTint,
    Color? link,
    Color? warn,
    Color? warnInk,
    Color? warnTint,
    Color? error,
    Color? errorInk,
    Color? errorTint,
    Color? travel,
    Color? travelInk,
    Color? travelTint,
    Color? bites,
    Color? bitesInk,
    Color? bitesTint,
    Color? send,
    Color? sendInk,
    Color? sendTint,
    Color? primaryButton,
    Color? onPrimaryButton,
    Color? primaryButtonDisabled,
    Color? onPrimaryButtonDisabled,
  }) {
    return UbiSemanticColors(
      bg: bg ?? this.bg,
      bg2: bg2 ?? this.bg2,
      surface: surface ?? this.surface,
      border: border ?? this.border,
      borderStrong: borderStrong ?? this.borderStrong,
      divider: divider ?? this.divider,
      ink: ink ?? this.ink,
      text2: text2 ?? this.text2,
      text3: text3 ?? this.text3,
      move: move ?? this.move,
      moveInk: moveInk ?? this.moveInk,
      moveTint: moveTint ?? this.moveTint,
      link: link ?? this.link,
      warn: warn ?? this.warn,
      warnInk: warnInk ?? this.warnInk,
      warnTint: warnTint ?? this.warnTint,
      error: error ?? this.error,
      errorInk: errorInk ?? this.errorInk,
      errorTint: errorTint ?? this.errorTint,
      travel: travel ?? this.travel,
      travelInk: travelInk ?? this.travelInk,
      travelTint: travelTint ?? this.travelTint,
      bites: bites ?? this.bites,
      bitesInk: bitesInk ?? this.bitesInk,
      bitesTint: bitesTint ?? this.bitesTint,
      send: send ?? this.send,
      sendInk: sendInk ?? this.sendInk,
      sendTint: sendTint ?? this.sendTint,
      primaryButton: primaryButton ?? this.primaryButton,
      onPrimaryButton: onPrimaryButton ?? this.onPrimaryButton,
      primaryButtonDisabled:
          primaryButtonDisabled ?? this.primaryButtonDisabled,
      onPrimaryButtonDisabled:
          onPrimaryButtonDisabled ?? this.onPrimaryButtonDisabled,
    );
  }

  @override
  UbiSemanticColors lerp(covariant UbiSemanticColors? other, double t) {
    if (other == null) {
      return this;
    }
    return UbiSemanticColors(
      bg: Color.lerp(bg, other.bg, t)!,
      bg2: Color.lerp(bg2, other.bg2, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderStrong: Color.lerp(borderStrong, other.borderStrong, t)!,
      divider: Color.lerp(divider, other.divider, t)!,
      ink: Color.lerp(ink, other.ink, t)!,
      text2: Color.lerp(text2, other.text2, t)!,
      text3: Color.lerp(text3, other.text3, t)!,
      move: Color.lerp(move, other.move, t)!,
      moveInk: Color.lerp(moveInk, other.moveInk, t)!,
      moveTint: Color.lerp(moveTint, other.moveTint, t)!,
      link: Color.lerp(link, other.link, t)!,
      warn: Color.lerp(warn, other.warn, t)!,
      warnInk: Color.lerp(warnInk, other.warnInk, t)!,
      warnTint: Color.lerp(warnTint, other.warnTint, t)!,
      error: Color.lerp(error, other.error, t)!,
      errorInk: Color.lerp(errorInk, other.errorInk, t)!,
      errorTint: Color.lerp(errorTint, other.errorTint, t)!,
      travel: Color.lerp(travel, other.travel, t)!,
      travelInk: Color.lerp(travelInk, other.travelInk, t)!,
      travelTint: Color.lerp(travelTint, other.travelTint, t)!,
      bites: Color.lerp(bites, other.bites, t)!,
      bitesInk: Color.lerp(bitesInk, other.bitesInk, t)!,
      bitesTint: Color.lerp(bitesTint, other.bitesTint, t)!,
      send: Color.lerp(send, other.send, t)!,
      sendInk: Color.lerp(sendInk, other.sendInk, t)!,
      sendTint: Color.lerp(sendTint, other.sendTint, t)!,
      primaryButton: Color.lerp(primaryButton, other.primaryButton, t)!,
      onPrimaryButton: Color.lerp(onPrimaryButton, other.onPrimaryButton, t)!,
      primaryButtonDisabled:
          Color.lerp(primaryButtonDisabled, other.primaryButtonDisabled, t)!,
      onPrimaryButtonDisabled: Color.lerp(
        onPrimaryButtonDisabled,
        other.onPrimaryButtonDisabled,
        t,
      )!,
    );
  }
}
