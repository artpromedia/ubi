import 'package:flutter/material.dart';

import 'skeleton_primitives.dart';
import 'ubi_shimmer_wrapper.dart';

/// A skeleton placeholder for the UbiVehicleOptionCard component.
///
/// Matches the exact layout and dimensions of UbiVehicleOptionCard to prevent
/// layout shifts when data loads.
class VehicleOptionSkeleton extends StatelessWidget {
  const VehicleOptionSkeleton({super.key});

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
        child: const Row(
          children: [
            // Vehicle icon placeholder
            UbiSkeletonBox(width: 64, height: 40, borderRadius: 8),
            SizedBox(width: 16),

            // Vehicle info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Name row with capacity
                  Row(
                    children: [
                      UbiSkeletonText(width: 70, height: 16),
                      SizedBox(width: 8),
                      UbiSkeletonText(width: 30, height: 14),
                    ],
                  ),
                  SizedBox(height: 4),
                  // Description
                  UbiSkeletonText(width: 100, height: 12),
                ],
              ),
            ),

            // Price and ETA
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                UbiSkeletonText(width: 70, height: 18),
                SizedBox(height: 4),
                UbiSkeletonText(width: 50, height: 12),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A list of vehicle option skeletons for loading states.
class VehicleOptionSkeletonList extends StatelessWidget {
  const VehicleOptionSkeletonList({
    super.key,
    this.itemCount = 4,
    this.padding = const EdgeInsets.all(16),
    this.spacing = 8.0,
  });

  final int itemCount;
  final EdgeInsets padding;
  final double spacing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Column(
        children: List.generate(
          itemCount,
          (index) => Padding(
            padding: EdgeInsets.only(bottom: index < itemCount - 1 ? spacing : 0),
            child: const VehicleOptionSkeleton(),
          ),
        ),
      ),
    );
  }
}
