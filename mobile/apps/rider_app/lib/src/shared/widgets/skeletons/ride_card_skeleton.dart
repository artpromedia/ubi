import 'package:flutter/material.dart';

import 'skeleton_primitives.dart';
import 'ubi_shimmer_wrapper.dart';

/// A skeleton placeholder for the UbiRideCard component.
///
/// Matches the exact layout and dimensions of UbiRideCard to prevent
/// layout shifts when data loads.
class RideCardSkeleton extends StatelessWidget {
  const RideCardSkeleton({
    super.key,
    this.showDriver = false,
    this.showRoute = true,
  });

  /// Whether to show the driver info section.
  final bool showDriver;

  /// Whether to show the route visualization section.
  final bool showRoute;

  @override
  Widget build(BuildContext context) {
    return UbiShimmerWrapper(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: Colors.grey.shade200,
            width: 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header with status and vehicle type
            const Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                UbiSkeletonText(width: 80, height: 20),
                UbiSkeletonText(width: 60, height: 20),
              ],
            ),
            const SizedBox(height: 16),

            // Route section
            if (showRoute) ...[
              // Pickup location row
              const Row(
                children: [
                  UbiSkeletonIcon(size: 20),
                  SizedBox(width: 12),
                  Expanded(
                    child: UbiSkeletonText(height: 16),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              // Route line
              Padding(
                padding: const EdgeInsets.only(left: 9),
                child: Container(
                  width: 2,
                  height: 24,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(1),
                  ),
                ),
              ),
              const SizedBox(height: 4),
              // Dropoff location row
              const Row(
                children: [
                  UbiSkeletonIcon(size: 20),
                  SizedBox(width: 12),
                  Expanded(
                    child: UbiSkeletonText(height: 16),
                  ),
                ],
              ),
              const SizedBox(height: 16),
            ],

            // Price and details row
            const Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                // Price
                UbiSkeletonText(width: 100, height: 24),
                // ETA and distance
                Row(
                  children: [
                    UbiSkeletonText(width: 50, height: 14),
                    SizedBox(width: 8),
                    UbiSkeletonText(width: 50, height: 14),
                  ],
                ),
              ],
            ),

            // Driver info section
            if (showDriver) ...[
              const SizedBox(height: 16),
              const UbiSkeletonDivider(),
              const SizedBox(height: 16),
              const Row(
                children: [
                  UbiSkeletonAvatar(size: 48),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        UbiSkeletonText(width: 120, height: 16),
                        SizedBox(height: 4),
                        UbiSkeletonText(width: 80, height: 14),
                      ],
                    ),
                  ),
                  UbiSkeletonButton(width: 80, height: 36),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A list of ride card skeletons for loading states.
class RideCardSkeletonList extends StatelessWidget {
  const RideCardSkeletonList({
    super.key,
    this.itemCount = 3,
    this.showDriver = false,
    this.padding = const EdgeInsets.all(16),
    this.spacing = 12.0,
  });

  final int itemCount;
  final bool showDriver;
  final EdgeInsets padding;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: padding,
      physics: const NeverScrollableScrollPhysics(),
      shrinkWrap: true,
      itemCount: itemCount,
      separatorBuilder: (_, __) => SizedBox(height: spacing),
      itemBuilder: (_, __) => RideCardSkeleton(showDriver: showDriver),
    );
  }
}
