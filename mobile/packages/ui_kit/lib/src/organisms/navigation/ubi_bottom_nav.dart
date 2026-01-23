import 'package:flutter/material.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_spacing.dart';
import '../../theme/ubi_typography.dart';

/// UBI Bottom Navigation Item
class UbiBottomNavItem {
  const UbiBottomNavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    this.badge,
  });

  /// Default icon
  final IconData icon;

  /// Icon when selected
  final IconData activeIcon;

  /// Item label
  final String label;

  /// Optional badge count
  final int? badge;
}

/// UBI Bottom Navigation Bar
///
/// A bottom navigation bar following UBI design system guidelines.
/// Supports badges, custom styling, and smooth animations.
class UbiBottomNav extends StatelessWidget {
  const UbiBottomNav({
    super.key,
    required this.items,
    required this.currentIndex,
    required this.onTap,
    this.backgroundColor,
    this.selectedItemColor,
    this.unselectedItemColor,
    this.showLabels = true,
    this.elevation = 8,
    this.type = UbiBottomNavType.fixed,
    this.notchMargin = 8,
    this.showSelectedLabels = true,
    this.showUnselectedLabels = true,
  });

  /// Navigation items
  final List<UbiBottomNavItem> items;

  /// Currently selected index
  final int currentIndex;

  /// Callback when item is tapped
  final ValueChanged<int> onTap;

  /// Background color
  final Color? backgroundColor;

  /// Color for selected item
  final Color? selectedItemColor;

  /// Color for unselected items
  final Color? unselectedItemColor;

  /// Whether to show labels
  final bool showLabels;

  /// Shadow elevation
  final double elevation;

  /// Navigation bar type
  final UbiBottomNavType type;

  /// Notch margin for FAB
  final double notchMargin;

  /// Whether to show labels for selected items
  final bool showSelectedLabels;

  /// Whether to show labels for unselected items
  final bool showUnselectedLabels;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final effectiveBackgroundColor = backgroundColor ??
        (isDark ? UbiColors.gray900 : UbiColors.ubiWhite);
    final effectiveSelectedColor = selectedItemColor ?? UbiColors.ubiGreen;
    final effectiveUnselectedColor = unselectedItemColor ??
        (isDark ? UbiColors.gray500 : UbiColors.gray600);

    if (type == UbiBottomNavType.floating) {
      return _buildFloatingNav(
        context,
        effectiveBackgroundColor,
        effectiveSelectedColor,
        effectiveUnselectedColor,
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: effectiveBackgroundColor,
        boxShadow: elevation > 0
            ? [
                BoxShadow(
                  color: UbiColors.ubiBlack.withValues(alpha: 0.08),
                  blurRadius: elevation,
                  offset: Offset(0, -2),
                ),
              ]
            : null,
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: UbiSpacing.sm,
            vertical: UbiSpacing.xs,
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: List.generate(items.length, (index) {
              return _buildNavItem(
                context,
                index,
                effectiveSelectedColor,
                effectiveUnselectedColor,
              );
            }),
          ),
        ),
      ),
    );
  }

  Widget _buildFloatingNav(
    BuildContext context,
    Color backgroundColor,
    Color selectedColor,
    Color unselectedColor,
  ) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        UbiSpacing.lg,
        0,
        UbiSpacing.lg,
        MediaQuery.of(context).padding.bottom + UbiSpacing.md,
      ),
      child: Container(
        decoration: BoxDecoration(
          color: backgroundColor,
          borderRadius: BorderRadius.circular(32),
          boxShadow: [
            BoxShadow(
              color: UbiColors.ubiBlack.withValues(alpha: 0.15),
              blurRadius: 20,
              offset: Offset(0, 4),
            ),
          ],
        ),
        padding: EdgeInsets.symmetric(
          horizontal: UbiSpacing.md,
          vertical: UbiSpacing.sm,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: List.generate(items.length, (index) {
            return _buildNavItem(
              context,
              index,
              selectedColor,
              unselectedColor,
            );
          }),
        ),
      ),
    );
  }

  Widget _buildNavItem(
    BuildContext context,
    int index,
    Color selectedColor,
    Color unselectedColor,
  ) {
    final item = items[index];
    final isSelected = index == currentIndex;
    final color = isSelected ? selectedColor : unselectedColor;
    final icon = isSelected ? item.activeIcon : item.icon;

    final showLabel = showLabels &&
        (isSelected ? showSelectedLabels : showUnselectedLabels);

    Widget iconWidget = Icon(icon, color: color, size: 26);

    // Add badge if present
    if (item.badge != null && item.badge! > 0) {
      iconWidget = Stack(
        clipBehavior: Clip.none,
        children: [
          iconWidget,
          Positioned(
            right: -6,
            top: -4,
            child: Container(
              padding: EdgeInsets.all(item.badge! > 9 ? 3 : 4),
              decoration: BoxDecoration(
                color: UbiColors.ubiBitesColor,
                shape: BoxShape.circle,
                border: Border.all(
                  color: Theme.of(context).scaffoldBackgroundColor,
                  width: 1.5,
                ),
              ),
              constraints: BoxConstraints(minWidth: 16, minHeight: 16),
              child: Text(
                item.badge! > 99 ? '99+' : item.badge.toString(),
                style: UbiTypography.caption.copyWith(
                  color: UbiColors.ubiWhite,
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                ),
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ],
      );
    }

    return Expanded(
      child: Semantics(
        selected: isSelected,
        label: item.label,
        child: InkWell(
          onTap: () => onTap(index),
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: EdgeInsets.symmetric(
              vertical: UbiSpacing.xs,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AnimatedContainer(
                  duration: Duration(milliseconds: 200),
                  padding: EdgeInsets.symmetric(
                    horizontal: isSelected ? UbiSpacing.md : 0,
                    vertical: UbiSpacing.xs,
                  ),
                  decoration: isSelected
                      ? BoxDecoration(
                          color: selectedColor.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(16),
                        )
                      : null,
                  child: iconWidget,
                ),
                if (showLabel) ...[
                  SizedBox(height: UbiSpacing.xxs),
                  AnimatedDefaultTextStyle(
                    duration: Duration(milliseconds: 200),
                    style: UbiTypography.caption.copyWith(
                      color: color,
                      fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                    ),
                    child: Text(item.label),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// UBI Bottom Navigation Types
enum UbiBottomNavType {
  /// Standard fixed bottom navigation
  fixed,

  /// Floating navigation bar
  floating,

  /// With FAB notch
  notched,
}

/// UBI Tab Bar
///
/// A horizontal tab bar with UBI styling.
class UbiTabBar extends StatelessWidget implements PreferredSizeWidget {
  const UbiTabBar({
    super.key,
    required this.tabs,
    required this.controller,
    this.isScrollable = false,
    this.backgroundColor,
    this.selectedLabelColor,
    this.unselectedLabelColor,
    this.indicatorColor,
    this.indicatorWeight = 3,
    this.padding,
  });

  /// Tab labels
  final List<String> tabs;

  /// Tab controller
  final TabController controller;

  /// Whether tabs are scrollable
  final bool isScrollable;

  /// Background color
  final Color? backgroundColor;

  /// Color for selected tab label
  final Color? selectedLabelColor;

  /// Color for unselected tab labels
  final Color? unselectedLabelColor;

  /// Indicator color
  final Color? indicatorColor;

  /// Indicator weight
  final double indicatorWeight;

  /// External padding
  final EdgeInsets? padding;

  @override
  Size get preferredSize => Size.fromHeight(48);

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;

    final effectiveSelectedColor = selectedLabelColor ??
        (isDark ? UbiColors.ubiWhite : UbiColors.gray900);
    final effectiveUnselectedColor = unselectedLabelColor ?? UbiColors.gray500;
    final effectiveIndicatorColor = indicatorColor ?? UbiColors.ubiGreen;

    return Container(
      color: backgroundColor,
      padding: padding,
      child: TabBar(
        controller: controller,
        isScrollable: isScrollable,
        labelColor: effectiveSelectedColor,
        unselectedLabelColor: effectiveUnselectedColor,
        labelStyle: UbiTypography.bodySmall.copyWith(fontWeight: FontWeight.w600),
        unselectedLabelStyle: UbiTypography.bodySmall,
        indicatorColor: effectiveIndicatorColor,
        indicatorWeight: indicatorWeight,
        indicatorSize: TabBarIndicatorSize.label,
        dividerColor: isDark ? UbiColors.gray800 : UbiColors.gray200,
        tabs: tabs.map((label) => Tab(text: label)).toList(),
      ),
    );
  }
}
