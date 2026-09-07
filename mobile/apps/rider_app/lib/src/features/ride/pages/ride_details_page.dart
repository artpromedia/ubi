/// Completed-ride receipt.
///
/// Every number here is the server's. The previous version printed a fixed
/// Westlands-to-KICC route, a "John Doe / KDA 123A" driver and a KES 200/150/50
/// fare breakdown that no service ever produced, and paid it "with M-Pesa"
/// (CLAUDE.md rules 1, 6 and 12). All of it is gone; the screen renders what it
/// is handed and says plainly when it has not been handed anything.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:ubi_core/ubi_config.dart';
import 'package:ubi_core/ubi_test_ids.dart';
import 'package:ubi_ui_kit/ubi_tokens.dart';

import '../../../core/router/app_router.dart';

/// One line of the server-computed fare breakdown.
@immutable
class ReceiptLine {
  const ReceiptLine({required this.label, required this.amount});

  /// The server's own wording for the line, e.g. "Base fare".
  final String label;

  /// Server-signed amount. The client never adds these up.
  final Money amount;
}

/// The receipt as the server computed it.
@immutable
class RideReceipt {
  const RideReceipt({
    required this.rideId,
    required this.lines,
    required this.total,
    this.pickupAddress,
    this.dropoffAddress,
    this.distanceLabel,
    this.durationLabel,
    this.completedAt,
    this.driverName,
    this.driverRating,
    this.vehicleDescription,
    this.vehiclePlate,
    this.paymentMethodLabel,
  });

  final String rideId;

  /// Breakdown lines in the order the server sent them.
  final List<ReceiptLine> lines;

  /// The server's total. Not a sum of [lines] computed here.
  final Money total;

  final String? pickupAddress;
  final String? dropoffAddress;
  final String? distanceLabel;
  final String? durationLabel;
  final DateTime? completedAt;
  final String? driverName;
  final String? driverRating;
  final String? vehicleDescription;
  final String? vehiclePlate;
  final String? paymentMethodLabel;
}

class RideDetailsPage extends StatelessWidget {
  const RideDetailsPage({
    required this.rideId,
    super.key,
    this.receipt,
    this.errorMessage,
    this.onDownloadReceipt,
    this.onReportIssue,
  });

  final String rideId;

  /// Null until the receipt has loaded.
  final RideReceipt? receipt;

  /// Set when the receipt could not be loaded.
  final String? errorMessage;

  final VoidCallback? onDownloadReceipt;
  final VoidCallback? onReportIssue;

  @override
  Widget build(BuildContext context) {
    final RideReceipt? loaded = receipt;
    assert(
      loaded == null || loaded.rideId == rideId,
      'RideDetailsPage was given a receipt for a different ride',
    );
    final UbiSemanticColors colors = UbiSemanticColors.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Ride details'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go(Routes.rideSearch),
        ),
      ),
      body: loaded == null
          ? _Unavailable(colors: colors, message: errorMessage)
          : SingleChildScrollView(
              padding: const EdgeInsets.all(UbiSpace.x4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  _RouteCard(receipt: loaded, colors: colors),
                  const SizedBox(height: UbiSpace.x6),
                  if (loaded.driverName != null ||
                      loaded.vehiclePlate != null)
                    _DriverCard(receipt: loaded, colors: colors),
                  const SizedBox(height: UbiSpace.x6),
                  _PaymentCard(receipt: loaded, colors: colors),
                  const SizedBox(height: UbiSpace.x6),
                  Row(
                    children: <Widget>[
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: onDownloadReceipt,
                          icon: const Icon(Icons.receipt_long),
                          label: const Text('Receipt'),
                        ),
                      ),
                      const SizedBox(width: UbiSpace.x4),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: onReportIssue,
                          icon: const Icon(Icons.flag_outlined),
                          label: const Text('Report'),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
    );
  }
}

class _RouteCard extends StatelessWidget {
  const _RouteCard({required this.receipt, required this.colors});

  final RideReceipt receipt;
  final UbiSemanticColors colors;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      colors: colors,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _Endpoint(
            colors: colors,
            dotColor: colors.move,
            label: 'Pickup',
            value: receipt.pickupAddress,
          ),
          const SizedBox(height: UbiSpace.x3),
          _Endpoint(
            colors: colors,
            dotColor: colors.error,
            label: 'Drop-off',
            value: receipt.dropoffAddress,
          ),
          if (receipt.distanceLabel != null ||
              receipt.durationLabel != null) ...<Widget>[
            Divider(color: colors.divider, height: UbiSpace.x8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: <Widget>[
                if (receipt.distanceLabel != null)
                  _Stat(
                    colors: colors,
                    label: 'Distance',
                    value: receipt.distanceLabel!,
                  ),
                if (receipt.durationLabel != null)
                  _Stat(
                    colors: colors,
                    label: 'Duration',
                    value: receipt.durationLabel!,
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _DriverCard extends StatelessWidget {
  const _DriverCard({required this.receipt, required this.colors});

  final RideReceipt receipt;
  final UbiSemanticColors colors;

  @override
  Widget build(BuildContext context) {
    final String? plate = receipt.vehiclePlate;
    final String? vehicle = receipt.vehicleDescription;

    return _Panel(
      colors: colors,
      child: Row(
        children: <Widget>[
          CircleAvatar(
            radius: 28,
            backgroundColor: colors.bg2,
            child: Icon(Icons.person, size: 32, color: colors.text2),
          ),
          const SizedBox(width: UbiSpace.x4),
          Expanded(
            child: Semantics(
              container: true,
              label: <String>[
                if (receipt.driverName != null) receipt.driverName!,
                if (vehicle != null) vehicle,
                if (plate != null) 'plate $plate',
              ].join(', '),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    receipt.driverName ?? 'Driver',
                    style: UbiTokenTypography.titleMedium
                        .copyWith(color: colors.ink),
                  ),
                  if (vehicle != null)
                    Text(
                      vehicle,
                      style: UbiTokenTypography.bodySmall
                          .copyWith(color: colors.text2),
                    ),
                  if (plate != null) UbiPlateText(value: plate),
                ],
              ),
            ),
          ),
          if (receipt.driverRating != null)
            Row(
              children: <Widget>[
                Icon(Icons.star, color: colors.warn, size: 20),
                const SizedBox(width: UbiSpace.x1),
                Text(
                  receipt.driverRating!,
                  semanticsLabel: 'Rated ${receipt.driverRating} out of 5',
                  style: UbiTokenTypography.labelMedium
                      .copyWith(color: colors.ink),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _PaymentCard extends StatelessWidget {
  const _PaymentCard({required this.receipt, required this.colors});

  final RideReceipt receipt;
  final UbiSemanticColors colors;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ConfigCubit, ConfigState>(
      builder: (BuildContext context, ConfigState config) {
        final UbiMoneyFormatter? money = config.money;

        return _Panel(
          colors: colors,
          child: Column(
            key: testKey(TestIds.riderPayBreakdown),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                'Payment',
                style:
                    UbiTokenTypography.titleMedium.copyWith(color: colors.ink),
              ),
              const SizedBox(height: UbiSpace.x4),
              if (money == null)
                Text(
                  'We could not load your city settings, so amounts are not '
                  'shown. Reconnect to see the full breakdown.',
                  style: UbiTokenTypography.bodyMedium
                      .copyWith(color: colors.text2),
                )
              else ...<Widget>[
                for (final ReceiptLine line in receipt.lines)
                  Padding(
                    padding: const EdgeInsets.only(bottom: UbiSpace.x2),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: <Widget>[
                        Text(
                          line.label,
                          style: UbiTokenTypography.bodyMedium
                              .copyWith(color: colors.text2),
                        ),
                        UbiMoneyText(
                          value: money.format(line.amount),
                          semanticsLabel:
                              '${line.label} ${money.semanticsLabel(line.amount)}',
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                        ),
                      ],
                    ),
                  ),
                Divider(color: colors.divider, height: UbiSpace.x6),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: <Widget>[
                    Text(
                      'Total',
                      style: UbiTokenTypography.titleMedium
                          .copyWith(color: colors.ink),
                    ),
                    UbiMoneyText(
                      value: money.format(receipt.total),
                      semanticsLabel:
                          'Total ${money.semanticsLabel(receipt.total)}',
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ],
                ),
              ],
              if (receipt.paymentMethodLabel != null) ...<Widget>[
                const SizedBox(height: UbiSpace.x4),
                Row(
                  children: <Widget>[
                    Icon(Icons.payments_outlined, size: 20, color: colors.text2),
                    const SizedBox(width: UbiSpace.x2),
                    Text(
                      'Paid with ${receipt.paymentMethodLabel}',
                      style: UbiTokenTypography.bodyMedium
                          .copyWith(color: colors.text2),
                    ),
                  ],
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.colors, required this.child});

  final UbiSemanticColors colors;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(UbiSpace.x4),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: UbiRadii.cardBorder,
        border: Border.all(color: colors.border),
      ),
      child: child,
    );
  }
}

class _Endpoint extends StatelessWidget {
  const _Endpoint({
    required this.colors,
    required this.dotColor,
    required this.label,
    required this.value,
  });

  final UbiSemanticColors colors;
  final Color dotColor;
  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Container(
          margin: const EdgeInsets.only(top: UbiSpace.x1),
          width: UbiSpace.x3,
          height: UbiSpace.x3,
          decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
        ),
        const SizedBox(width: UbiSpace.x3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                label,
                style: UbiTokenTypography.bodySmall
                    .copyWith(color: colors.text3),
              ),
              Text(
                value ?? 'Address not recorded',
                style: UbiTokenTypography.bodyMedium.copyWith(
                  color: value == null ? colors.text3 : colors.ink,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({
    required this.colors,
    required this.label,
    required this.value,
  });

  final UbiSemanticColors colors;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        Text(
          value,
          style: UbiTokenTypography.titleMedium.copyWith(color: colors.ink),
        ),
        Text(
          label,
          style: UbiTokenTypography.bodySmall.copyWith(color: colors.text2),
        ),
      ],
    );
  }
}

class _Unavailable extends StatelessWidget {
  const _Unavailable({required this.colors, required this.message});

  final UbiSemanticColors colors;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(UbiSpace.x6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            UbiStatusPill(
              tone: message == null
                  ? UbiStatusTone.searching
                  : UbiStatusTone.cancelled,
              label: message == null ? 'Loading receipt' : 'Not available',
            ),
            const SizedBox(height: UbiSpace.x3),
            Text(
              message ?? 'Fetching the receipt for this ride.',
              textAlign: TextAlign.center,
              style: UbiTokenTypography.bodyMedium.copyWith(color: colors.text2),
            ),
          ],
        ),
      ),
    );
  }
}
