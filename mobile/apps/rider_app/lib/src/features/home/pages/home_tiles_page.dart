/// Rider home (board 6a).
///
/// The service tiles are rendered from evaluated flags: a vertical that is off
/// in this city has no tile at all (CLAUDE.md rule 5). When every flag is off
/// the screen says so rather than showing an empty rail, and it distinguishes
/// "not launched here" from "we could not check" (rule 8).
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ubi_core/ubi_config.dart';
import 'package:ubi_core/ubi_test_ids.dart';
import 'package:ubi_ui_kit/ubi_tokens.dart';

/// One service tile and the flag that decides whether it exists.
class HomeTile {
  const HomeTile({
    required this.flag,
    required this.label,
    required this.icon,
    required this.accent,
    required this.tint,
  });

  final UbiFlag flag;
  final String label;
  final IconData icon;

  /// Reads the accent for this vertical off the semantic tokens.
  final Color Function(UbiSemanticColors colors) accent;
  final Color Function(UbiSemanticColors colors) tint;
}

class HomeTilesPage extends StatelessWidget {
  const HomeTilesPage({
    required this.onOpenSearch,
    required this.onOpenSavedPlaces,
    required this.onOpenVertical,
    super.key,
    this.onOpenActiveTrip,
    this.activeTripLabel,
  });

  /// Every tile the rider app can show, in board order. Presence here is not
  /// availability — the flag decides that.
  static const List<HomeTile> tiles = <HomeTile>[
    HomeTile(
      flag: UbiFlag.move,
      label: 'Move',
      icon: Icons.local_taxi_outlined,
      accent: _moveAccent,
      tint: _moveTint,
    ),
    HomeTile(
      flag: UbiFlag.bites,
      label: 'Bites',
      icon: Icons.restaurant_outlined,
      accent: _bitesAccent,
      tint: _bitesTint,
    ),
    HomeTile(
      flag: UbiFlag.send,
      label: 'Send',
      icon: Icons.local_shipping_outlined,
      accent: _sendAccent,
      tint: _sendTint,
    ),
    // Travel and Stays tiles are added by slices 08 and 10, when the screens
    // they open exist. A tile whose flag is on but whose destination is not
    // built would be a dead end, which is worse than no tile.
  ];

  static Color _moveAccent(UbiSemanticColors c) => c.moveInk;
  static Color _moveTint(UbiSemanticColors c) => c.moveTint;
  static Color _bitesAccent(UbiSemanticColors c) => c.bitesInk;
  static Color _bitesTint(UbiSemanticColors c) => c.bitesTint;
  static Color _sendAccent(UbiSemanticColors c) => c.sendInk;
  static Color _sendTint(UbiSemanticColors c) => c.sendTint;

  final VoidCallback onOpenSearch;
  final VoidCallback onOpenSavedPlaces;
  final void Function(UbiFlag vertical) onOpenVertical;

  /// Only supplied when there really is a trip in progress. Nothing on this
  /// screen invents one.
  final VoidCallback? onOpenActiveTrip;
  final String? activeTripLabel;

  @override
  Widget build(BuildContext context) {
    final UbiSemanticColors colors = UbiSemanticColors.of(context);

    return Scaffold(
      body: SafeArea(
        child: BlocBuilder<ConfigCubit, ConfigState>(
          builder: (BuildContext context, ConfigState state) {
            final List<HomeTile> visible = tiles
                .where((HomeTile tile) => state.isEnabled(tile.flag))
                .toList();

            return ListView(
              padding: const EdgeInsets.symmetric(
                horizontal: UbiSpace.x4,
                vertical: UbiSpace.x4,
              ),
              children: <Widget>[
                if (state.isStale)
                  _StaleBanner(state: state, colors: colors),
                _WhereToField(onTap: onOpenSearch, colors: colors),
                const SizedBox(height: UbiSpace.x3),
                _SavedPlacesRow(onTap: onOpenSavedPlaces, colors: colors),
                if (onOpenActiveTrip != null &&
                    activeTripLabel != null) ...<Widget>[
                  const SizedBox(height: UbiSpace.x4),
                  _ActiveTripCard(
                    label: activeTripLabel!,
                    onTap: onOpenActiveTrip!,
                    colors: colors,
                  ),
                ],
                const SizedBox(height: UbiSpace.x6),
                if (visible.isEmpty)
                  _NothingAvailable(state: state, colors: colors)
                else
                  _ServiceSwitcher(
                    tiles: visible,
                    colors: colors,
                    onOpenVertical: onOpenVertical,
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _WhereToField extends StatelessWidget {
  const _WhereToField({required this.onTap, required this.colors});

  final VoidCallback onTap;
  final UbiSemanticColors colors;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Where to? Search for a destination',
      child: InkWell(
        key: testKey(TestIds.riderHomeWhereTo),
        onTap: onTap,
        borderRadius: UbiRadii.cardLgBorder,
        child: Container(
          constraints: const BoxConstraints(minHeight: UbiTargets.row),
          padding: const EdgeInsets.symmetric(
            horizontal: UbiSpace.x4,
            vertical: UbiSpace.x3,
          ),
          decoration: BoxDecoration(
            color: colors.bg2,
            borderRadius: UbiRadii.cardLgBorder,
            border: Border.all(color: colors.border),
          ),
          child: Row(
            children: <Widget>[
              Icon(Icons.search, color: colors.text2),
              const SizedBox(width: UbiSpace.x3),
              Expanded(
                child: Text(
                  'Where to?',
                  style: UbiTokenTypography.titleMedium
                      .copyWith(color: colors.text2),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SavedPlacesRow extends StatelessWidget {
  const _SavedPlacesRow({required this.onTap, required this.colors});

  final VoidCallback onTap;
  final UbiSemanticColors colors;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Saved places',
      child: InkWell(
        key: testKey(TestIds.riderHomeSavedPlaces),
        onTap: onTap,
        borderRadius: UbiRadii.controlBorder,
        child: Container(
          constraints: const BoxConstraints(minHeight: UbiTargets.android),
          padding: const EdgeInsets.symmetric(
            horizontal: UbiSpace.x3,
            vertical: UbiSpace.x2,
          ),
          child: Row(
            children: <Widget>[
              Icon(Icons.bookmark_border, size: UbiSpace.x5, color: colors.text2),
              const SizedBox(width: UbiSpace.x2),
              Text(
                'Saved places',
                style:
                    UbiTokenTypography.bodyMedium.copyWith(color: colors.text2),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActiveTripCard extends StatelessWidget {
  const _ActiveTripCard({
    required this.label,
    required this.onTap,
    required this.colors,
  });

  final String label;
  final VoidCallback onTap;
  final UbiSemanticColors colors;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      key: testKey(TestIds.riderHomeActiveTrip),
      onTap: onTap,
      borderRadius: UbiRadii.cardBorder,
      child: Container(
        constraints: const BoxConstraints(minHeight: UbiTargets.row),
        padding: const EdgeInsets.all(UbiSpace.x4),
        decoration: BoxDecoration(
          color: colors.moveTint,
          borderRadius: UbiRadii.cardBorder,
        ),
        child: Row(
          children: <Widget>[
            const UbiStatusPill(tone: UbiStatusTone.inTrip, label: 'In trip'),
            const SizedBox(width: UbiSpace.x3),
            Expanded(
              child: Text(
                label,
                style: UbiTokenTypography.bodyMedium
                    .copyWith(color: colors.moveInk),
              ),
            ),
            Icon(Icons.chevron_right, color: colors.moveInk),
          ],
        ),
      ),
    );
  }
}

class _ServiceSwitcher extends StatelessWidget {
  const _ServiceSwitcher({
    required this.tiles,
    required this.colors,
    required this.onOpenVertical,
  });

  final List<HomeTile> tiles;
  final UbiSemanticColors colors;
  final void Function(UbiFlag vertical) onOpenVertical;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'Services available in your city',
      child: Wrap(
        key: testKey(TestIds.riderHomeServiceSwitcher),
        spacing: UbiSpace.x3,
        runSpacing: UbiSpace.x3,
        children: <Widget>[
          for (final HomeTile tile in tiles)
            _ServiceTile(
              tile: tile,
              colors: colors,
              onTap: () => onOpenVertical(tile.flag),
            ),
        ],
      ),
    );
  }
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile({
    required this.tile,
    required this.colors,
    required this.onTap,
  });

  final HomeTile tile;
  final UbiSemanticColors colors;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color accent = tile.accent(colors);
    return Semantics(
      button: true,
      label: tile.label,
      child: InkWell(
        onTap: onTap,
        borderRadius: UbiRadii.cardBorder,
        child: Container(
          width: 104,
          constraints: const BoxConstraints(minHeight: 88),
          padding: const EdgeInsets.all(UbiSpace.x3),
          decoration: BoxDecoration(
            color: tile.tint(colors),
            borderRadius: UbiRadii.cardBorder,
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(tile.icon, color: accent, size: UbiSpace.x6),
              const SizedBox(height: UbiSpace.x2),
              Text(
                tile.label,
                style: UbiTokenTypography.labelMedium.copyWith(color: accent),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Shown when no vertical is enabled. Says which of the two reasons applies.
class _NothingAvailable extends StatelessWidget {
  const _NothingAvailable({required this.state, required this.colors});

  final ConfigState state;
  final UbiSemanticColors colors;

  @override
  Widget build(BuildContext context) {
    final bool couldNotCheck = state.flagsUnverified;
    final String title =
        couldNotCheck ? 'We could not check what is available' : 'Coming soon';
    final String body = couldNotCheck
        ? 'You are offline, so we cannot confirm which services run in your '
            'city. Nothing has been hidden — reconnect and pull to refresh.'
        : 'No UBI services have launched in your city yet.';

    return Container(
      padding: const EdgeInsets.all(UbiSpace.x4),
      decoration: BoxDecoration(
        color: colors.bg2,
        borderRadius: UbiRadii.cardBorder,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            title,
            style: UbiTokenTypography.titleMedium.copyWith(color: colors.ink),
          ),
          const SizedBox(height: UbiSpace.x2),
          Text(
            body,
            style: UbiTokenTypography.bodyMedium.copyWith(color: colors.text2),
          ),
        ],
      ),
    );
  }
}

/// Offline / stale-config banner (testIDs `rider.offline.banner` and
/// `rider.offline.staleTimestamp`).
class _StaleBanner extends StatelessWidget {
  const _StaleBanner({required this.state, required this.colors});

  final ConfigState state;
  final UbiSemanticColors colors;

  @override
  Widget build(BuildContext context) {
    final DateTime? storedAt = state.configStoredAt;
    final UbiDateTimeFormatter? dates = state.dates;

    return Padding(
      padding: const EdgeInsets.only(bottom: UbiSpace.x3),
      child: Container(
        key: testKey(TestIds.riderOfflineBanner),
        padding: const EdgeInsets.all(UbiSpace.x3),
        decoration: BoxDecoration(
          color: colors.warnTint,
          borderRadius: UbiRadii.controlBorder,
        ),
        child: Row(
          children: <Widget>[
            Icon(Icons.wifi_off, size: UbiSpace.x5, color: colors.warnInk),
            const SizedBox(width: UbiSpace.x2),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    'Showing saved information',
                    style: UbiTokenTypography.labelMedium
                        .copyWith(color: colors.warnInk),
                  ),
                  if (storedAt != null && dates != null)
                    Text(
                      'Last updated ${dates.timestamp(storedAt)}',
                      key: testKey(TestIds.riderOfflineStaleTimestamp),
                      style: UbiTokenTypography.bodySmall
                          .copyWith(color: colors.warnInk),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
