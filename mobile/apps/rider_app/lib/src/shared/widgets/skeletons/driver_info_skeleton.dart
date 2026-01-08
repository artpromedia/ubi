import 'package:flutter/material.dart';

import 'skeleton_primitives.dart';
import 'ubi_shimmer_wrapper.dart';

/// A skeleton placeholder for the UbiDriverInfoCard component.
///
/// Matches the exact layout and dimensions of UbiDriverInfoCard to prevent
/// layout shifts when data loads.
class DriverInfoSkeleton extends StatelessWidget {
  const DriverInfoSkeleton({
    super.key,
    this.showActions = true,
    this.showVehicle = true,
  });

  /// Whether to show action button placeholders.
  final bool showActions;

  /// Whether to show vehicle info section.
  final bool showVehicle;

  @override
  Widget build(BuildContext context) {
    return UbiShimmerWrapper(
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.1),
          borderRadius: BorderRadius.circular(12),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.05),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          children: [
            // Driver info row
            Row(
              children: [
                // Avatar
                const UbiSkeletonAvatar(size: 56),
                const SizedBox(width: 16),

                // Name and rating
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      UbiSkeletonText(width: 120, height: 20),
                      SizedBox(height: 4),
                      Row(
                        children: [
                          UbiSkeletonIcon(size: 16),
                          SizedBox(width: 4),
                          UbiSkeletonText(width: 30, height: 14),
                          SizedBox(width: 8),
                          UbiSkeletonText(width: 60, height: 14),
                        ],
                      ),
                    ],
                  ),
                ),

                // Action buttons
                if (showActions)
                  const Row(
                    children: [
                      UbiSkeletonAvatar(
                        size: 40,
                        shape: BoxShape.rectangle,
                        borderRadius: BorderRadius.all(Radius.circular(8)),
                      ),
                      SizedBox(width: 8),
                      UbiSkeletonAvatar(
                        size: 40,
                        shape: BoxShape.rectangle,
                        borderRadius: BorderRadius.all(Radius.circular(8)),
                      ),
                    ],
                  ),
              ],
            ),

            // Vehicle info section
            if (showVehicle) ...[
              const SizedBox(height: 16),
              const UbiSkeletonDivider(),
              const SizedBox(height: 16),
              const Row(
                children: [
                  // Vehicle icon
                  UbiSkeletonIcon(size: 24),
                  SizedBox(width: 12),

                  // Vehicle details
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        UbiSkeletonText(width: 150, height: 16),
                        SizedBox(height: 4),
                        UbiSkeletonText(width: 100, height: 14),
                      ],
                    ),
                  ),

                  // Plate number
                  UbiSkeletonBox(width: 80, height: 28, borderRadius: 4),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// A compact driver skeleton for inline use.
class DriverInfoCompactSkeleton extends StatelessWidget {
  const DriverInfoCompactSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return const UbiShimmerWrapper(
      child: Row(
        children: [
          UbiSkeletonAvatar(size: 40),
          SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                UbiSkeletonText(width: 100, height: 14),
                SizedBox(height: 4),
                UbiSkeletonText(width: 60, height: 12),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
