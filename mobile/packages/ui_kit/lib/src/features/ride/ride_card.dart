import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';
import '../../atoms/avatars/ubi_avatar.dart';
import '../../atoms/badges/ubi_badge.dart';
import '../../molecules/cards/ubi_card.dart';

/// UBI Ride Card
///
/// A card component for displaying ride information.
class UbiRideCard extends StatelessWidget {
  const UbiRideCard({
    super.key,
    required this.pickupAddress,
    required this.dropoffAddress,
    required this.vehicleType,
    required this.price,
    this.eta,
    this.distance,
    this.duration,
    this.driverName,
    this.driverImageUrl,
    this.driverRating,
    this.vehicleInfo,
    this.status,
    this.onTap,
    this.isSelected = false,
    this.showRoute = true,
  });

  /// Pickup address
  final String pickupAddress;

  /// Dropoff address
  final String dropoffAddress;

  /// Vehicle type (e.g., "UBI X", "UBI Comfort")
  final String vehicleType;

  /// Price display
  final String price;

  /// Estimated time of arrival
  final String? eta;

  /// Distance display
  final String? distance;

  /// Duration display
  final String? duration;

  /// Driver name
  final String? driverName;

  /// Driver profile image URL
  final String? driverImageUrl;

  /// Driver rating
  final double? driverRating;

  /// Vehicle info (make, model, plate)
  final String? vehicleInfo;

  /// Ride status
  final UbiRideStatus? status;

  /// Callback when card is tapped
  final VoidCallback? onTap;

  /// Whether the card is selected
  final bool isSelected;

  /// Whether to show route visualization
  final bool showRoute;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return UbiInteractiveCard(
      onTap: onTap,
      borderColor: isSelected ? UbiColors.serviceRide : null,
      backgroundColor: isSelected
          ? UbiColors.serviceRide.withOpacity(isDark ? 0.15 : 0.05)
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header with status and vehicle type
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                vehicleType,
                style: UbiTypography.headline3.copyWith(
                  color: isDark
                      ? UbiColors.textPrimaryDark
                      : UbiColors.textPrimary,
                ),
              ),
              if (status != null)
                UbiBadge(
                  label: status!.label,
                  variant: status!.badgeVariant,
                  size: UbiBadgeSize.small,
                ),
            ],
          ),

          SizedBox(height: UbiSpacing.md),

          // Route visualization
          if (showRoute) ...[
            _buildRouteVisualization(isDark),
            SizedBox(height: UbiSpacing.md),
          ],

          // Trip details
          Row(
            children: [
              if (eta != null) ...[
                _buildInfoChip(
                  icon: Icons.access_time,
                  label: eta!,
                  isDark: isDark,
                ),
                SizedBox(width: UbiSpacing.sm),
              ],
              if (distance != null) ...[
                _buildInfoChip(
                  icon: Icons.straighten,
                  label: distance!,
                  isDark: isDark,
                ),
                SizedBox(width: UbiSpacing.sm),
              ],
              if (duration != null)
                _buildInfoChip(
                  icon: Icons.timer_outlined,
                  label: duration!,
                  isDark: isDark,
                ),
              const Spacer(),
              Text(
                price,
                style: UbiTypography.price(
                  color: UbiColors.serviceRide,
                ),
              ),
            ],
          ),

          // Driver info (if assigned)
          if (driverName != null) ...[
            SizedBox(height: UbiSpacing.md),
            Divider(
              color: isDark ? UbiColors.dividerDark : UbiColors.divider,
            ),
            SizedBox(height: UbiSpacing.md),
            _buildDriverInfo(isDark),
          ],
        ],
      ),
    );
  }

  Widget _buildRouteVisualization(bool isDark) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Route dots
        Column(
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: UbiColors.serviceRide,
              ),
            ),
            Container(
              width: 2,
              height: 32,
              color: isDark ? UbiColors.gray600 : UbiColors.gray300,
            ),
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                shape: BoxShape.rectangle,
                borderRadius: BorderRadius.circular(2),
                color: UbiColors.ubiBlack,
              ),
            ),
          ],
        ),
        SizedBox(width: UbiSpacing.md),
        // Addresses
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                pickupAddress,
                style: UbiTypography.body2.copyWith(
                  color: isDark
                      ? UbiColors.textPrimaryDark
                      : UbiColors.textPrimary,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              SizedBox(height: UbiSpacing.lg),
              Text(
                dropoffAddress,
                style: UbiTypography.body2.copyWith(
                  color: isDark
                      ? UbiColors.textPrimaryDark
                      : UbiColors.textPrimary,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildInfoChip({
    required IconData icon,
    required String label,
    required bool isDark,
  }) {
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: UbiSpacing.sm,
        vertical: UbiSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: isDark ? UbiColors.gray800 : UbiColors.gray100,
        borderRadius: UbiRadius.chipRadius,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 14,
            color: isDark
                ? UbiColors.textSecondaryDark
                : UbiColors.textSecondary,
          ),
          SizedBox(width: UbiSpacing.xxs),
          Text(
            label,
            style: UbiTypography.caption.copyWith(
              color: isDark
                  ? UbiColors.textSecondaryDark
                  : UbiColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDriverInfo(bool isDark) {
    return Row(
      children: [
        UbiAvatar(
          imageUrl: driverImageUrl,
          name: driverName,
          size: UbiAvatarSize.medium,
        ),
        SizedBox(width: UbiSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                driverName!,
                style: UbiTypography.body1.copyWith(
                  fontWeight: FontWeight.w600,
                  color: isDark
                      ? UbiColors.textPrimaryDark
                      : UbiColors.textPrimary,
                ),
              ),
              if (vehicleInfo != null)
                Text(
                  vehicleInfo!,
                  style: UbiTypography.caption.copyWith(
                    color: isDark
                        ? UbiColors.textSecondaryDark
                        : UbiColors.textSecondary,
                  ),
                ),
            ],
          ),
        ),
        if (driverRating != null)
          Row(
            children: [
              const Icon(
                Icons.star,
                size: 18,
                color: UbiColors.warning,
              ),
              SizedBox(width: UbiSpacing.xxs),
              Text(
                driverRating!.toStringAsFixed(1),
                style: UbiTypography.body2.copyWith(
                  fontWeight: FontWeight.w600,
                  color: isDark
                      ? UbiColors.textPrimaryDark
                      : UbiColors.textPrimary,
                ),
              ),
            ],
          ),
      ],
    );
  }
}

/// Ride status enum
enum UbiRideStatus {
  searching('Searching', UbiBadgeVariant.info),
  driverAssigned('Driver Assigned', UbiBadgeVariant.info),
  arriving('Arriving', UbiBadgeVariant.warning),
  arrived('Arrived', UbiBadgeVariant.success),
  inProgress('In Progress', UbiBadgeVariant.primary),
  completed('Completed', UbiBadgeVariant.success),
  cancelled('Cancelled', UbiBadgeVariant.error);

  const UbiRideStatus(this.label, this.badgeVariant);

  final String label;
  final UbiBadgeVariant badgeVariant;
}

/// UBI Vehicle Option Card
///
/// A card for selecting vehicle type during ride booking.
class UbiVehicleOptionCard extends StatelessWidget {
  const UbiVehicleOptionCard({
    super.key,
    required this.name,
    required this.description,
    required this.price,
    required this.eta,
    required this.iconWidget,
    this.capacity,
    this.promo,
    this.onTap,
    this.isSelected = false,
    this.isAvailable = true,
  });

  /// Vehicle name (e.g., "UBI X")
  final String name;

  /// Vehicle description
  final String description;

  /// Price display
  final String price;

  /// ETA display
  final String eta;

  /// Vehicle icon or image widget
  final Widget iconWidget;

  /// Passenger capacity
  final int? capacity;

  /// Promo text (if any)
  final String? promo;

  /// Callback when card is tapped
  final VoidCallback? onTap;

  /// Whether this option is selected
  final bool isSelected;

  /// Whether this option is available
  final bool isAvailable;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return Opacity(
      opacity: isAvailable ? 1.0 : 0.5,
      child: UbiInteractiveCard(
        onTap: isAvailable ? onTap : null,
        isDisabled: !isAvailable,
        borderColor: isSelected ? UbiColors.serviceRide : null,
        backgroundColor: isSelected
            ? UbiColors.serviceRide.withOpacity(isDark ? 0.15 : 0.05)
            : null,
        padding: EdgeInsets.all(UbiSpacing.md),
        child: Row(
          children: [
            // Vehicle icon
            SizedBox(
              width: 64,
              height: 40,
              child: iconWidget,
            ),
            SizedBox(width: UbiSpacing.md),

            // Vehicle info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        name,
                        style: UbiTypography.body1.copyWith(
                          fontWeight: FontWeight.w600,
                          color: isDark
                              ? UbiColors.textPrimaryDark
                              : UbiColors.textPrimary,
                        ),
                      ),
                      if (capacity != null) ...[
                        SizedBox(width: UbiSpacing.xs),
                        Row(
                          children: [
                            Icon(
                              Icons.person,
                              size: 14,
                              color: isDark
                                  ? UbiColors.textTertiaryDark
                                  : UbiColors.textTertiary,
                            ),
                            Text(
                              '$capacity',
                              style: UbiTypography.caption.copyWith(
                                color: isDark
                                    ? UbiColors.textTertiaryDark
                                    : UbiColors.textTertiary,
                              ),
                            ),
                          ],
                        ),
                      ],
                      if (promo != null) ...[
                        SizedBox(width: UbiSpacing.xs),
                        UbiBadge(
                          label: promo!,
                          variant: UbiBadgeVariant.success,
                          size: UbiBadgeSize.small,
                        ),
                      ],
                    ],
                  ),
                  SizedBox(height: UbiSpacing.xxs),
                  Text(
                    description,
                    style: UbiTypography.caption.copyWith(
                      color: isDark
                          ? UbiColors.textSecondaryDark
                          : UbiColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),

            // Price and ETA
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  price,
                  style: UbiTypography.body1.copyWith(
                    fontWeight: FontWeight.w700,
                    color: isDark
                        ? UbiColors.textPrimaryDark
                        : UbiColors.textPrimary,
                  ),
                ),
                SizedBox(height: UbiSpacing.xxs),
                Row(
                  children: [
                    Icon(
                      Icons.access_time,
                      size: 12,
                      color: UbiColors.serviceRide,
                    ),
                    SizedBox(width: UbiSpacing.xxs),
                    Text(
                      eta,
                      style: UbiTypography.caption.copyWith(
                        color: UbiColors.serviceRide,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// UBI Driver Info Card
///
/// A detailed card showing driver information.
class UbiDriverInfoCard extends StatelessWidget {
  const UbiDriverInfoCard({
    super.key,
    required this.name,
    required this.rating,
    required this.totalTrips,
    required this.vehicleMake,
    required this.vehicleModel,
    required this.vehicleColor,
    required this.plateNumber,
    this.imageUrl,
    this.phoneNumber,
    this.onCallPressed,
    this.onChatPressed,
  });

  /// Driver name
  final String name;

  /// Driver rating
  final double rating;

  /// Total completed trips
  final int totalTrips;

  /// Vehicle make
  final String vehicleMake;

  /// Vehicle model
  final String vehicleModel;

  /// Vehicle color
  final String vehicleColor;

  /// License plate number
  final String plateNumber;

  /// Driver profile image URL
  final String? imageUrl;

  /// Driver phone number
  final String? phoneNumber;

  /// Callback when call button is pressed
  final VoidCallback? onCallPressed;

  /// Callback when chat button is pressed
  final VoidCallback? onChatPressed;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return UbiCard(
      variant: UbiCardVariant.elevated,
      child: Column(
        children: [
          // Driver info row
          Row(
            children: [
              UbiAvatar(
                imageUrl: imageUrl,
                name: name,
                size: UbiAvatarSize.large,
              ),
              SizedBox(width: UbiSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: UbiTypography.headline3.copyWith(
                        color: isDark
                            ? UbiColors.textPrimaryDark
                            : UbiColors.textPrimary,
                      ),
                    ),
                    SizedBox(height: UbiSpacing.xxs),
                    Row(
                      children: [
                        const Icon(
                          Icons.star,
                          size: 16,
                          color: UbiColors.warning,
                        ),
                        SizedBox(width: UbiSpacing.xxs),
                        Text(
                          rating.toStringAsFixed(1),
                          style: UbiTypography.body2.copyWith(
                            fontWeight: FontWeight.w600,
                            color: isDark
                                ? UbiColors.textPrimaryDark
                                : UbiColors.textPrimary,
                          ),
                        ),
                        SizedBox(width: UbiSpacing.sm),
                        Text(
                          '•',
                          style: TextStyle(
                            color: isDark
                                ? UbiColors.textTertiaryDark
                                : UbiColors.textTertiary,
                          ),
                        ),
                        SizedBox(width: UbiSpacing.sm),
                        Text(
                          '$totalTrips trips',
                          style: UbiTypography.body2.copyWith(
                            color: isDark
                                ? UbiColors.textSecondaryDark
                                : UbiColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              // Action buttons
              Row(
                children: [
                  if (onChatPressed != null)
                    IconButton(
                      onPressed: onChatPressed,
                      icon: Icon(
                        Icons.chat_bubble_outline,
                        color: UbiColors.serviceRide,
                      ),
                      style: IconButton.styleFrom(
                        backgroundColor: UbiColors.serviceRide.withOpacity(0.1),
                      ),
                    ),
                  if (onCallPressed != null) ...[
                    SizedBox(width: UbiSpacing.sm),
                    IconButton(
                      onPressed: onCallPressed,
                      icon: Icon(
                        Icons.phone,
                        color: UbiColors.serviceRide,
                      ),
                      style: IconButton.styleFrom(
                        backgroundColor: UbiColors.serviceRide.withOpacity(0.1),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),

          SizedBox(height: UbiSpacing.md),
          Divider(color: isDark ? UbiColors.dividerDark : UbiColors.divider),
          SizedBox(height: UbiSpacing.md),

          // Vehicle info row
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$vehicleColor $vehicleMake $vehicleModel',
                      style: UbiTypography.body1.copyWith(
                        fontWeight: FontWeight.w600,
                        color: isDark
                            ? UbiColors.textPrimaryDark
                            : UbiColors.textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(
                  horizontal: UbiSpacing.md,
                  vertical: UbiSpacing.sm,
                ),
                decoration: BoxDecoration(
                  color: isDark ? UbiColors.gray800 : UbiColors.gray100,
                  borderRadius: UbiRadius.smRadius,
                  border: Border.all(
                    color: isDark ? UbiColors.borderDark : UbiColors.border,
                  ),
                ),
                child: Text(
                  plateNumber,
                  style: UbiTypography.body1.copyWith(
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.5,
                    color: isDark
                        ? UbiColors.textPrimaryDark
                        : UbiColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
