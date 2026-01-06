import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_radius.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';
import '../../atoms/avatars/ubi_avatar.dart';
import '../../atoms/badges/ubi_badge.dart';
import '../../molecules/cards/ubi_card.dart';

/// UBI Food Order Card
///
/// A card component for displaying food order information.
class UbiFoodOrderCard extends StatelessWidget {
  const UbiFoodOrderCard({
    super.key,
    required this.restaurantName,
    required this.items,
    required this.totalAmount,
    this.restaurantImageUrl,
    this.deliveryAddress,
    this.status,
    this.orderNumber,
    this.estimatedDelivery,
    this.driverName,
    this.driverImageUrl,
    this.onTap,
    this.onTrackOrder,
  });

  /// Restaurant name
  final String restaurantName;

  /// List of order items
  final List<UbiOrderItem> items;

  /// Total order amount
  final String totalAmount;

  /// Restaurant image URL
  final String? restaurantImageUrl;

  /// Delivery address
  final String? deliveryAddress;

  /// Order status
  final UbiFoodOrderStatus? status;

  /// Order number
  final String? orderNumber;

  /// Estimated delivery time
  final String? estimatedDelivery;

  /// Assigned driver name
  final String? driverName;

  /// Driver profile image URL
  final String? driverImageUrl;

  /// Callback when card is tapped
  final VoidCallback? onTap;

  /// Callback when track order is pressed
  final VoidCallback? onTrackOrder;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return UbiInteractiveCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Row(
            children: [
              if (restaurantImageUrl != null)
                ClipRRect(
                  borderRadius: UbiRadius.smRadius,
                  child: Image.network(
                    restaurantImageUrl!,
                    width: 48,
                    height: 48,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      width: 48,
                      height: 48,
                      color: isDark ? UbiColors.gray700 : UbiColors.gray200,
                      child: Icon(
                        Icons.restaurant,
                        color: isDark
                            ? UbiColors.textSecondaryDark
                            : UbiColors.textSecondary,
                      ),
                    ),
                  ),
                )
              else
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: UbiColors.serviceFood.withOpacity(0.1),
                    borderRadius: UbiRadius.smRadius,
                  ),
                  child: Icon(
                    Icons.restaurant,
                    color: UbiColors.serviceFood,
                  ),
                ),
              SizedBox(width: UbiSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      restaurantName,
                      style: UbiTypography.body1.copyWith(
                        fontWeight: FontWeight.w600,
                        color: isDark
                            ? UbiColors.textPrimaryDark
                            : UbiColors.textPrimary,
                      ),
                    ),
                    if (orderNumber != null)
                      Text(
                        'Order #$orderNumber',
                        style: UbiTypography.caption.copyWith(
                          color: isDark
                              ? UbiColors.textTertiaryDark
                              : UbiColors.textTertiary,
                        ),
                      ),
                  ],
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
          Divider(color: isDark ? UbiColors.dividerDark : UbiColors.divider),
          SizedBox(height: UbiSpacing.md),

          // Order items
          ...items.take(3).map((item) => Padding(
            padding: EdgeInsets.only(bottom: UbiSpacing.sm),
            child: Row(
              children: [
                Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    color: UbiColors.serviceFood.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    '${item.quantity}x',
                    style: UbiTypography.caption.copyWith(
                      fontWeight: FontWeight.w600,
                      color: UbiColors.serviceFood,
                    ),
                  ),
                ),
                SizedBox(width: UbiSpacing.sm),
                Expanded(
                  child: Text(
                    item.name,
                    style: UbiTypography.body2.copyWith(
                      color: isDark
                          ? UbiColors.textPrimaryDark
                          : UbiColors.textPrimary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Text(
                  item.price,
                  style: UbiTypography.body2.copyWith(
                    color: isDark
                        ? UbiColors.textSecondaryDark
                        : UbiColors.textSecondary,
                  ),
                ),
              ],
            ),
          )),

          if (items.length > 3) ...[
            Text(
              '+${items.length - 3} more items',
              style: UbiTypography.caption.copyWith(
                color: UbiColors.serviceFood,
                fontWeight: FontWeight.w500,
              ),
            ),
            SizedBox(height: UbiSpacing.sm),
          ],

          // Total
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Total',
                style: UbiTypography.body1.copyWith(
                  fontWeight: FontWeight.w600,
                  color: isDark
                      ? UbiColors.textPrimaryDark
                      : UbiColors.textPrimary,
                ),
              ),
              Text(
                totalAmount,
                style: UbiTypography.price(
                  color: UbiColors.serviceFood,
                ),
              ),
            ],
          ),

          // Delivery info
          if (estimatedDelivery != null || driverName != null) ...[
            SizedBox(height: UbiSpacing.md),
            Divider(color: isDark ? UbiColors.dividerDark : UbiColors.divider),
            SizedBox(height: UbiSpacing.md),

            if (driverName != null)
              Row(
                children: [
                  UbiAvatar(
                    imageUrl: driverImageUrl,
                    name: driverName,
                    size: UbiAvatarSize.small,
                  ),
                  SizedBox(width: UbiSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          driverName!,
                          style: UbiTypography.body2.copyWith(
                            fontWeight: FontWeight.w500,
                            color: isDark
                                ? UbiColors.textPrimaryDark
                                : UbiColors.textPrimary,
                          ),
                        ),
                        Text(
                          'Your delivery partner',
                          style: UbiTypography.caption.copyWith(
                            color: isDark
                                ? UbiColors.textTertiaryDark
                                : UbiColors.textTertiary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (estimatedDelivery != null)
                    Container(
                      padding: EdgeInsets.symmetric(
                        horizontal: UbiSpacing.sm,
                        vertical: UbiSpacing.xs,
                      ),
                      decoration: BoxDecoration(
                        color: UbiColors.serviceFood.withOpacity(0.1),
                        borderRadius: UbiRadius.chipRadius,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.access_time,
                            size: 14,
                            color: UbiColors.serviceFood,
                          ),
                          SizedBox(width: UbiSpacing.xxs),
                          Text(
                            estimatedDelivery!,
                            style: UbiTypography.caption.copyWith(
                              fontWeight: FontWeight.w600,
                              color: UbiColors.serviceFood,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
          ],

          // Track order button
          if (onTrackOrder != null && status != null && status!.isTrackable) ...[
            SizedBox(height: UbiSpacing.md),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton.icon(
                onPressed: onTrackOrder,
                icon: const Icon(Icons.location_on_outlined),
                label: const Text('Track Order'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: UbiColors.serviceFood,
                  side: const BorderSide(color: UbiColors.serviceFood),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Order item data class
class UbiOrderItem {
  const UbiOrderItem({
    required this.name,
    required this.quantity,
    required this.price,
    this.options,
  });

  final String name;
  final int quantity;
  final String price;
  final String? options;
}

/// Food order status enum
enum UbiFoodOrderStatus {
  pending('Pending', UbiBadgeVariant.secondary, false),
  confirmed('Confirmed', UbiBadgeVariant.info, false),
  preparing('Preparing', UbiBadgeVariant.warning, false),
  readyForPickup('Ready', UbiBadgeVariant.success, true),
  outForDelivery('On the way', UbiBadgeVariant.primary, true),
  delivered('Delivered', UbiBadgeVariant.success, false),
  cancelled('Cancelled', UbiBadgeVariant.error, false);

  const UbiFoodOrderStatus(this.label, this.badgeVariant, this.isTrackable);

  final String label;
  final UbiBadgeVariant badgeVariant;
  final bool isTrackable;
}

/// UBI Restaurant Card
///
/// A card component for displaying restaurant information.
class UbiRestaurantCard extends StatelessWidget {
  const UbiRestaurantCard({
    super.key,
    required this.name,
    required this.rating,
    required this.cuisine,
    this.imageUrl,
    this.deliveryTime,
    this.deliveryFee,
    this.distance,
    this.promo,
    this.isOpen = true,
    this.onTap,
  });

  /// Restaurant name
  final String name;

  /// Restaurant rating
  final double rating;

  /// Cuisine type
  final String cuisine;

  /// Restaurant image URL
  final String? imageUrl;

  /// Estimated delivery time
  final String? deliveryTime;

  /// Delivery fee
  final String? deliveryFee;

  /// Distance from user
  final String? distance;

  /// Promo text
  final String? promo;

  /// Whether restaurant is open
  final bool isOpen;

  /// Callback when card is tapped
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return UbiInteractiveCard(
      onTap: isOpen ? onTap : null,
      isDisabled: !isOpen,
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Image
          Stack(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(UbiRadius.card),
                  topRight: Radius.circular(UbiRadius.card),
                ),
                child: imageUrl != null
                    ? Image.network(
                        imageUrl!,
                        height: 140,
                        width: double.infinity,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => _buildPlaceholderImage(isDark),
                      )
                    : _buildPlaceholderImage(isDark),
              ),
              if (!isOpen)
                Positioned.fill(
                  child: Container(
                    decoration: BoxDecoration(
                      color: Colors.black54,
                      borderRadius: BorderRadius.only(
                        topLeft: Radius.circular(UbiRadius.card),
                        topRight: Radius.circular(UbiRadius.card),
                      ),
                    ),
                    alignment: Alignment.center,
                    child: const Text(
                      'Currently Closed',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              if (promo != null)
                Positioned(
                  top: UbiSpacing.sm,
                  left: UbiSpacing.sm,
                  child: Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: UbiSpacing.sm,
                      vertical: UbiSpacing.xs,
                    ),
                    decoration: BoxDecoration(
                      color: UbiColors.serviceFood,
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Text(
                      promo!,
                      style: UbiTypography.caption.copyWith(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
            ],
          ),

          // Info
          Padding(
            padding: EdgeInsets.all(UbiSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        name,
                        style: UbiTypography.body1.copyWith(
                          fontWeight: FontWeight.w600,
                          color: isDark
                              ? UbiColors.textPrimaryDark
                              : UbiColors.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
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
                      ],
                    ),
                  ],
                ),
                SizedBox(height: UbiSpacing.xxs),
                Text(
                  cuisine,
                  style: UbiTypography.caption.copyWith(
                    color: isDark
                        ? UbiColors.textSecondaryDark
                        : UbiColors.textSecondary,
                  ),
                ),
                SizedBox(height: UbiSpacing.sm),
                Row(
                  children: [
                    if (deliveryTime != null)
                      _buildInfoTag(
                        Icons.access_time,
                        deliveryTime!,
                        isDark,
                      ),
                    if (deliveryFee != null) ...[
                      SizedBox(width: UbiSpacing.sm),
                      _buildInfoTag(
                        Icons.delivery_dining,
                        deliveryFee!,
                        isDark,
                      ),
                    ],
                    if (distance != null) ...[
                      SizedBox(width: UbiSpacing.sm),
                      _buildInfoTag(
                        Icons.location_on_outlined,
                        distance!,
                        isDark,
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPlaceholderImage(bool isDark) {
    return Container(
      height: 140,
      color: isDark ? UbiColors.gray700 : UbiColors.gray200,
      child: Center(
        child: Icon(
          Icons.restaurant,
          size: 48,
          color: isDark ? UbiColors.gray600 : UbiColors.gray400,
        ),
      ),
    );
  }

  Widget _buildInfoTag(IconData icon, String text, bool isDark) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          icon,
          size: 14,
          color: isDark
              ? UbiColors.textTertiaryDark
              : UbiColors.textTertiary,
        ),
        SizedBox(width: UbiSpacing.xxs),
        Text(
          text,
          style: UbiTypography.caption.copyWith(
            color: isDark
                ? UbiColors.textTertiaryDark
                : UbiColors.textTertiary,
          ),
        ),
      ],
    );
  }
}

/// UBI Menu Item Card
///
/// A card for displaying food menu items.
class UbiMenuItemCard extends StatelessWidget {
  const UbiMenuItemCard({
    super.key,
    required this.name,
    required this.price,
    this.description,
    this.imageUrl,
    this.originalPrice,
    this.isPopular = false,
    this.isAvailable = true,
    this.onTap,
    this.onAddToCart,
  });

  /// Item name
  final String name;

  /// Item price
  final String price;

  /// Item description
  final String? description;

  /// Item image URL
  final String? imageUrl;

  /// Original price (if on sale)
  final String? originalPrice;

  /// Whether item is popular
  final bool isPopular;

  /// Whether item is available
  final bool isAvailable;

  /// Callback when card is tapped
  final VoidCallback? onTap;

  /// Callback when add to cart is pressed
  final VoidCallback? onAddToCart;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    return Opacity(
      opacity: isAvailable ? 1.0 : 0.5,
      child: UbiInteractiveCard(
        onTap: isAvailable ? onTap : null,
        isDisabled: !isAvailable,
        padding: EdgeInsets.all(UbiSpacing.md),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (isPopular)
                    Padding(
                      padding: EdgeInsets.only(bottom: UbiSpacing.xs),
                      child: UbiBadge(
                        label: 'Popular',
                        variant: UbiBadgeVariant.food,
                        size: UbiBadgeSize.small,
                      ),
                    ),
                  Text(
                    name,
                    style: UbiTypography.body1.copyWith(
                      fontWeight: FontWeight.w600,
                      color: isDark
                          ? UbiColors.textPrimaryDark
                          : UbiColors.textPrimary,
                    ),
                  ),
                  if (description != null) ...[
                    SizedBox(height: UbiSpacing.xxs),
                    Text(
                      description!,
                      style: UbiTypography.caption.copyWith(
                        color: isDark
                            ? UbiColors.textSecondaryDark
                            : UbiColors.textSecondary,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  SizedBox(height: UbiSpacing.sm),
                  Row(
                    children: [
                      Text(
                        price,
                        style: UbiTypography.body1.copyWith(
                          fontWeight: FontWeight.w700,
                          color: UbiColors.serviceFood,
                        ),
                      ),
                      if (originalPrice != null) ...[
                        SizedBox(width: UbiSpacing.sm),
                        Text(
                          originalPrice!,
                          style: UbiTypography.caption.copyWith(
                            color: isDark
                                ? UbiColors.textTertiaryDark
                                : UbiColors.textTertiary,
                            decoration: TextDecoration.lineThrough,
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),

            SizedBox(width: UbiSpacing.md),

            // Image and add button
            Stack(
              alignment: Alignment.bottomRight,
              children: [
                ClipRRect(
                  borderRadius: UbiRadius.smRadius,
                  child: imageUrl != null
                      ? Image.network(
                          imageUrl!,
                          width: 100,
                          height: 100,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => _buildPlaceholder(isDark),
                        )
                      : _buildPlaceholder(isDark),
                ),
                if (onAddToCart != null && isAvailable)
                  Positioned(
                    right: -8,
                    bottom: -8,
                    child: FloatingActionButton.small(
                      onPressed: onAddToCart,
                      backgroundColor: UbiColors.serviceFood,
                      child: const Icon(
                        Icons.add,
                        color: Colors.white,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPlaceholder(bool isDark) {
    return Container(
      width: 100,
      height: 100,
      color: isDark ? UbiColors.gray700 : UbiColors.gray200,
      child: Icon(
        Icons.fastfood,
        color: isDark ? UbiColors.gray600 : UbiColors.gray400,
      ),
    );
  }
}
