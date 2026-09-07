/// Trip tracking (board: rider in-trip).
///
/// Everything on this screen comes from a server-supplied [TripSnapshot]. The
/// previous version hard-coded a driver name, a rating, a vehicle, a plate and
/// a 3-minute ETA and never read the ride id it was given; those personas are
/// gone (CLAUDE.md rule 12) and the screen now renders honest loading and
/// error states instead.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:ubi_core/ubi_config.dart';
import 'package:ubi_core/ubi_test_ids.dart';
import 'package:ubi_ui_kit/ubi_tokens.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/router/app_router.dart';

/// The server's view of the trip, as the screen needs it.
///
/// Every field is what the server sent. Nothing here is computed on the
/// client, and there are no defaults: a field we were not given is null and
/// renders as unknown.
@immutable
class TripSnapshot {
  const TripSnapshot({
    required this.rideId,
    required this.status,
    required this.statusLabel,
    this.etaLabel,
    this.driverName,
    this.driverRating,
    this.vehicleDescription,
    this.vehiclePlate,
    this.pin,
    this.driverPosition,
  });

  final String rideId;

  /// Drives the status pill's tone; [statusLabel] is what the rider reads, so
  /// colour is never the only signal.
  final UbiStatusTone status;
  final String statusLabel;

  /// Server-computed ETA, already formatted. The client never estimates.
  final String? etaLabel;

  final String? driverName;
  final String? driverRating;
  final String? vehicleDescription;
  final String? vehiclePlate;

  /// Start PIN, when the city requires one.
  final String? pin;

  final LatLng? driverPosition;
}

class RideTrackingPage extends StatelessWidget {
  const RideTrackingPage({
    required this.rideId,
    super.key,
    this.trip,
    this.errorMessage,
    this.onCancel,
    this.onCall,
    this.onChat,
    this.onShareTrip,
  });

  final String rideId;

  /// Null until the trip has been loaded. Nothing is invented meanwhile.
  final TripSnapshot? trip;

  /// Set when the trip could not be loaded.
  final String? errorMessage;

  final VoidCallback? onCancel;
  final VoidCallback? onCall;
  final VoidCallback? onChat;
  final VoidCallback? onShareTrip;

  @override
  Widget build(BuildContext context) {
    final TripSnapshot? snapshot = trip;
    assert(
      snapshot == null || snapshot.rideId == rideId,
      'RideTrackingPage was given a snapshot for a different ride',
    );
    final UbiSemanticColors colors = UbiSemanticColors.of(context);
    final LatLng? driverPosition = snapshot?.driverPosition;

    return Scaffold(
      body: Stack(
        children: <Widget>[
          if (driverPosition == null)
            Positioned.fill(child: ColoredBox(color: colors.bg2))
          else
            GoogleMap(
              initialCameraPosition:
                  CameraPosition(target: driverPosition, zoom: 14),
              myLocationEnabled: true,
              myLocationButtonEnabled: false,
              zoomControlsEnabled: false,
              mapToolbarEnabled: false,
            ),

          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(UbiSpace.x4),
              child: Row(
                children: <Widget>[
                  _CircleAction(
                    colors: colors,
                    icon: Icons.arrow_back,
                    tooltip: 'Back',
                    onPressed: () => context.go(Routes.rideSearch),
                  ),
                  const Spacer(),
                  _CircleAction(
                    key: testKey(TestIds.riderTripSafetyHub),
                    colors: colors,
                    icon: Icons.shield_outlined,
                    tooltip: 'Safety',
                    onPressed: () => _openSafetyHub(context),
                  ),
                ],
              ),
            ),
          ),

          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: colors.surface,
                borderRadius: UbiRadii.sheetBorder(Theme.of(context).platform),
                border: Border.all(color: colors.border),
              ),
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.all(UbiSpace.x5),
                  child: snapshot == null
                      ? _PendingTrip(colors: colors, message: errorMessage)
                      : _TripSheet(
                          snapshot: snapshot,
                          colors: colors,
                          onCancel: onCancel,
                          onCall: onCall,
                          onChat: onChat,
                          onShareTrip: onShareTrip,
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static void _openSafetyHub(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (BuildContext sheetContext) => const _SafetySheet(),
    );
  }
}

class _TripSheet extends StatelessWidget {
  const _TripSheet({
    required this.snapshot,
    required this.colors,
    required this.onCancel,
    required this.onCall,
    required this.onChat,
    required this.onShareTrip,
  });

  final TripSnapshot snapshot;
  final UbiSemanticColors colors;
  final VoidCallback? onCancel;
  final VoidCallback? onCall;
  final VoidCallback? onChat;
  final VoidCallback? onShareTrip;

  @override
  Widget build(BuildContext context) {
    final String? plate = snapshot.vehiclePlate;
    final String? vehicle = snapshot.vehicleDescription;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            UbiStatusPill(
              key: testKey(TestIds.riderTripStatus),
              tone: snapshot.status,
              label: snapshot.statusLabel,
            ),
            const Spacer(),
            Text(
              snapshot.etaLabel ?? 'ETA updating',
              key: testKey(TestIds.riderTripEta),
              semanticsLabel: snapshot.etaLabel == null
                  ? 'Arrival time updating'
                  : 'Arrives in ${snapshot.etaLabel}',
              style: UbiTokenTypography.money(
                fontSize: 18,
                color: colors.ink,
              ),
            ),
          ],
        ),

        if (snapshot.pin != null) ...<Widget>[
          const SizedBox(height: UbiSpace.x4),
          _PinRow(pin: snapshot.pin!, colors: colors),
        ],

        const SizedBox(height: UbiSpace.x5),

        Row(
          key: testKey(TestIds.riderAssignedDriverCard),
          children: <Widget>[
            CircleAvatar(
              radius: 28,
              backgroundColor: colors.bg2,
              child: Icon(Icons.person, size: 32, color: colors.text2),
            ),
            const SizedBox(width: UbiSpace.x4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    snapshot.driverName ?? 'Driver details loading',
                    style: UbiTokenTypography.titleMedium
                        .copyWith(color: colors.ink),
                  ),
                  if (snapshot.driverRating != null)
                    Row(
                      children: <Widget>[
                        Icon(Icons.star, size: 16, color: colors.warn),
                        const SizedBox(width: UbiSpace.x1),
                        Text(
                          snapshot.driverRating!,
                          semanticsLabel:
                              'Rated ${snapshot.driverRating} out of 5',
                          style: UbiTokenTypography.bodySmall
                              .copyWith(color: colors.text2),
                        ),
                      ],
                    ),
                ],
              ),
            ),
            _CircleAction(
              key: testKey(TestIds.riderAssignedCall),
              colors: colors,
              icon: Icons.phone,
              tooltip: 'Call driver',
              onPressed: onCall,
            ),
            const SizedBox(width: UbiSpace.x2),
            _CircleAction(
              key: testKey(TestIds.riderAssignedChat),
              colors: colors,
              icon: Icons.message,
              tooltip: 'Message driver',
              onPressed: onChat,
            ),
          ],
        ),

        if (vehicle != null || plate != null) ...<Widget>[
          const SizedBox(height: UbiSpace.x4),
          Semantics(
            container: true,
            label: <String>[
              if (vehicle != null) vehicle,
              if (plate != null) 'plate $plate',
            ].join(', '),
            child: Container(
              padding: const EdgeInsets.all(UbiSpace.x3),
              decoration: BoxDecoration(
                color: colors.bg2,
                borderRadius: UbiRadii.controlBorder,
              ),
              child: Row(
                children: <Widget>[
                  Icon(Icons.directions_car, color: colors.text2),
                  const SizedBox(width: UbiSpace.x3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        if (vehicle != null)
                          Text(
                            vehicle,
                            style: UbiTokenTypography.bodyMedium
                                .copyWith(color: colors.ink),
                          ),
                        if (plate != null) UbiPlateText(value: plate),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],

        const SizedBox(height: UbiSpace.x5),

        Row(
          children: <Widget>[
            Expanded(
              child: OutlinedButton.icon(
                key: testKey(TestIds.riderTripShareTrip),
                onPressed: onShareTrip,
                icon: const Icon(Icons.ios_share),
                label: const Text('Share trip'),
              ),
            ),
            const SizedBox(width: UbiSpace.x3),
            Expanded(
              child: OutlinedButton(
                key: testKey(TestIds.riderAssignedCancel),
                onPressed: onCancel == null
                    ? null
                    : () => _confirmCancel(context, onCancel!),
                style: OutlinedButton.styleFrom(
                  foregroundColor: colors.errorInk,
                  side: BorderSide(color: colors.error),
                ),
                child: const Text('Cancel ride'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  static Future<void> _confirmCancel(
    BuildContext context,
    VoidCallback onConfirm,
  ) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Cancel this ride?'),
        content: const Text(
          'A cancellation fee may apply once a driver has been assigned. The '
          'exact amount is set by your city and shown on the receipt.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Keep ride'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Cancel ride'),
          ),
        ],
      ),
    );
    if (confirmed ?? false) {
      onConfirm();
    }
  }
}

class _PinRow extends StatelessWidget {
  const _PinRow({required this.pin, required this.colors});

  final String pin;
  final UbiSemanticColors colors;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: testKey(TestIds.riderPinDisplay),
      padding: const EdgeInsets.all(UbiSpace.x3),
      decoration: BoxDecoration(
        color: colors.moveTint,
        borderRadius: UbiRadii.controlBorder,
      ),
      child: Row(
        children: <Widget>[
          Text(
            'Start PIN',
            style:
                UbiTokenTypography.labelMedium.copyWith(color: colors.moveInk),
          ),
          const Spacer(),
          UbiPlateText(
            value: pin,
            semanticsLabel: 'Start PIN ${pin.split('').join(' ')}',
            fontSize: 20,
            color: colors.moveInk,
          ),
        ],
      ),
    );
  }
}

/// Loading and error states. Nothing is filled in with an example.
class _PendingTrip extends StatelessWidget {
  const _PendingTrip({required this.colors, required this.message});

  final UbiSemanticColors colors;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final bool failed = message != null;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        UbiStatusPill(
          key: testKey(TestIds.riderTripStatus),
          tone: failed ? UbiStatusTone.cancelled : UbiStatusTone.searching,
          label: failed ? 'Not available' : 'Loading trip',
        ),
        const SizedBox(height: UbiSpace.x3),
        Text(
          message ?? 'Getting the latest from your driver.',
          style: UbiTokenTypography.bodyMedium.copyWith(color: colors.text2),
        ),
      ],
    );
  }
}

/// Safety sheet. The emergency number is read from city config — there is no
/// literal anywhere in the apps (CLAUDE.md rule 9).
class _SafetySheet extends StatelessWidget {
  const _SafetySheet();

  @override
  Widget build(BuildContext context) {
    final UbiSemanticColors colors = UbiSemanticColors.of(context);

    return BlocBuilder<ConfigCubit, ConfigState>(
      builder: (BuildContext context, ConfigState state) {
        final String? number = state.emergencyNumber;

        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(UbiSpace.x5),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  'Safety',
                  style: UbiTokenTypography.headlineSmall
                      .copyWith(color: colors.ink),
                ),
                const SizedBox(height: UbiSpace.x3),
                if (number == null)
                  Text(
                    'We could not load your city’s emergency number. Use your '
                    'phone’s own emergency dialler.',
                    style: UbiTokenTypography.bodyMedium
                        .copyWith(color: colors.text2),
                  )
                else
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    minVerticalPadding: UbiSpace.x3,
                    leading: Icon(Icons.emergency_outlined, color: colors.error),
                    title: Text(
                      'Call emergency services',
                      style: UbiTokenTypography.titleMedium
                          .copyWith(color: colors.ink),
                    ),
                    subtitle: UbiPlateText(
                      value: number,
                      semanticsLabel:
                          'Emergency number ${number.split('').join(' ')}',
                      color: colors.text2,
                    ),
                    onTap: () => _dial(number),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  static Future<void> _dial(String number) async {
    await launchUrl(Uri(scheme: 'tel', path: number));
  }
}

class _CircleAction extends StatelessWidget {
  const _CircleAction({
    required this.colors,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    super.key,
  });

  final UbiSemanticColors colors;
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: UbiTargets.android,
      height: UbiTargets.android,
      child: IconButton(
        tooltip: tooltip,
        onPressed: onPressed,
        style: IconButton.styleFrom(backgroundColor: colors.surface),
        icon: Icon(icon, color: colors.ink),
      ),
    );
  }
}
