import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';

import '../../theme/ubi_colors.dart';
import '../../theme/ubi_typography.dart';

/// UBI Avatar Size
enum UbiAvatarSize {
  /// Extra small (24px)
  xs,
  
  /// Small (32px)
  small,
  
  /// Medium (40px)
  medium,
  
  /// Large (56px)
  large,
  
  /// Extra large (80px)
  xl,
  
  /// Extra extra large (120px)
  xxl,
}

/// UBI Avatar
///
/// A customizable avatar component that supports images, initials, and icons.
class UbiAvatar extends StatelessWidget {
  const UbiAvatar({
    super.key,
    this.imageUrl,
    this.name,
    this.icon,
    this.size = UbiAvatarSize.medium,
    this.customSize,
    this.backgroundColor,
    this.foregroundColor,
    this.borderColor,
    this.borderWidth,
    this.onTap,
    this.badge,
    this.badgePosition = Alignment.bottomRight,
    this.isOnline,
    this.semanticsLabel,
  });

  /// Network image URL
  final String? imageUrl;

  /// Name to generate initials from
  final String? name;

  /// Icon to display (fallback if no image or name)
  final IconData? icon;

  /// Avatar size preset
  final UbiAvatarSize size;

  /// Custom size (overrides preset)
  final double? customSize;

  /// Background color
  final Color? backgroundColor;

  /// Foreground color (text/icon)
  final Color? foregroundColor;

  /// Border color
  final Color? borderColor;

  /// Border width
  final double? borderWidth;

  /// Callback when avatar is tapped
  final VoidCallback? onTap;

  /// Badge widget to overlay
  final Widget? badge;

  /// Badge position
  final Alignment badgePosition;

  /// Online status indicator
  final bool? isOnline;

  /// Semantics label for accessibility
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    
    final effectiveSize = customSize ?? _getSizeValue(size);
    final effectiveBackgroundColor = backgroundColor ??
        (isDark ? UbiColors.gray700 : UbiColors.gray200);
    final effectiveForegroundColor = foregroundColor ??
        (isDark ? UbiColors.textSecondaryDark : UbiColors.textSecondary);

    Widget content;

    // Priority: image > name initials > icon > default icon
    if (imageUrl != null && imageUrl!.isNotEmpty) {
      content = CachedNetworkImage(
        imageUrl: imageUrl!,
        fit: BoxFit.cover,
        width: effectiveSize,
        height: effectiveSize,
        placeholder: (context, url) => _buildPlaceholder(
          effectiveSize,
          effectiveBackgroundColor,
          effectiveForegroundColor,
          isDark,
        ),
        errorWidget: (context, url, error) => _buildPlaceholder(
          effectiveSize,
          effectiveBackgroundColor,
          effectiveForegroundColor,
          isDark,
        ),
      );
    } else if (name != null && name!.isNotEmpty) {
      content = _buildInitials(
        effectiveSize,
        effectiveBackgroundColor,
        effectiveForegroundColor,
      );
    } else {
      content = _buildPlaceholder(
        effectiveSize,
        effectiveBackgroundColor,
        effectiveForegroundColor,
        isDark,
      );
    }

    Widget avatar = Container(
      width: effectiveSize,
      height: effectiveSize,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: borderColor != null || borderWidth != null
            ? Border.all(
                color: borderColor ?? UbiColors.white,
                width: borderWidth ?? 2,
              )
            : null,
      ),
      child: ClipOval(child: content),
    );

    // Add online indicator
    if (isOnline != null) {
      avatar = Stack(
        children: [
          avatar,
          Positioned(
            right: 0,
            bottom: 0,
            child: _buildOnlineIndicator(effectiveSize, isOnline!),
          ),
        ],
      );
    }

    // Add badge
    if (badge != null) {
      avatar = Stack(
        children: [
          avatar,
          Positioned.fill(
            child: Align(
              alignment: badgePosition,
              child: badge,
            ),
          ),
        ],
      );
    }

    // Add tap gesture
    if (onTap != null) {
      avatar = GestureDetector(
        onTap: onTap,
        child: avatar,
      );
    }

    return Semantics(
      label: semanticsLabel ?? name ?? 'Avatar',
      image: imageUrl != null,
      child: avatar,
    );
  }

  Widget _buildInitials(
    double size,
    Color backgroundColor,
    Color foregroundColor,
  ) {
    final initials = _getInitials(name!);
    final fontSize = _getFontSize(this.size);

    return Container(
      width: size,
      height: size,
      color: backgroundColor,
      alignment: Alignment.center,
      child: Text(
        initials,
        style: UbiTypography.headline3.copyWith(
          fontSize: fontSize,
          color: foregroundColor,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  Widget _buildPlaceholder(
    double size,
    Color backgroundColor,
    Color foregroundColor,
    bool isDark,
  ) {
    final iconSize = size * 0.5;

    return Container(
      width: size,
      height: size,
      color: backgroundColor,
      alignment: Alignment.center,
      child: Icon(
        icon ?? Icons.person,
        size: iconSize,
        color: foregroundColor,
      ),
    );
  }

  Widget _buildOnlineIndicator(double avatarSize, bool isOnline) {
    final indicatorSize = avatarSize * 0.25;
    final minSize = 8.0;
    final effectiveSize = indicatorSize < minSize ? minSize : indicatorSize;

    return Container(
      width: effectiveSize,
      height: effectiveSize,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: isOnline ? UbiColors.success : UbiColors.gray400,
        border: Border.all(
          color: UbiColors.white,
          width: 2,
        ),
      ),
    );
  }

  String _getInitials(String name) {
    final parts = name.trim().split(' ').where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '';
    if (parts.length == 1) {
      return parts[0][0].toUpperCase();
    }
    return '${parts[0][0]}${parts[parts.length - 1][0]}'.toUpperCase();
  }

  double _getSizeValue(UbiAvatarSize size) {
    switch (size) {
      case UbiAvatarSize.xs:
        return 24;
      case UbiAvatarSize.small:
        return 32;
      case UbiAvatarSize.medium:
        return 40;
      case UbiAvatarSize.large:
        return 56;
      case UbiAvatarSize.xl:
        return 80;
      case UbiAvatarSize.xxl:
        return 120;
    }
  }

  double _getFontSize(UbiAvatarSize size) {
    switch (size) {
      case UbiAvatarSize.xs:
        return 10;
      case UbiAvatarSize.small:
        return 12;
      case UbiAvatarSize.medium:
        return 14;
      case UbiAvatarSize.large:
        return 18;
      case UbiAvatarSize.xl:
        return 28;
      case UbiAvatarSize.xxl:
        return 40;
    }
  }
}

/// UBI Avatar Group
///
/// A row of overlapping avatars.
class UbiAvatarGroup extends StatelessWidget {
  const UbiAvatarGroup({
    super.key,
    required this.avatars,
    this.size = UbiAvatarSize.small,
    this.maxCount = 4,
    this.overlap = 8,
    this.showOverflowCount = true,
    this.borderColor,
    this.borderWidth = 2,
    this.onTap,
  });

  /// List of avatar data
  final List<UbiAvatarData> avatars;

  /// Avatar size preset
  final UbiAvatarSize size;

  /// Maximum avatars to show
  final int maxCount;

  /// Overlap amount in pixels
  final double overlap;

  /// Whether to show overflow count
  final bool showOverflowCount;

  /// Border color for avatars
  final Color? borderColor;

  /// Border width
  final double borderWidth;

  /// Callback when group is tapped
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final brightness = Theme.of(context).brightness;
    final isDark = brightness == Brightness.dark;
    final effectiveBorderColor = borderColor ?? 
        (isDark ? UbiColors.surfaceDark : UbiColors.white);

    final displayAvatars = avatars.take(maxCount).toList();
    final overflow = avatars.length - maxCount;

    final avatarSize = _getSizeValue(size);
    final totalWidth = avatarSize + 
        (displayAvatars.length - 1) * (avatarSize - overlap) +
        (overflow > 0 && showOverflowCount ? avatarSize - overlap : 0);

    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        width: totalWidth,
        height: avatarSize,
        child: Stack(
          children: [
            ...displayAvatars.asMap().entries.map((entry) {
              final index = entry.key;
              final avatar = entry.value;
              return Positioned(
                left: index * (avatarSize - overlap),
                child: UbiAvatar(
                  imageUrl: avatar.imageUrl,
                  name: avatar.name,
                  size: size,
                  borderColor: effectiveBorderColor,
                  borderWidth: borderWidth,
                ),
              );
            }),
            if (overflow > 0 && showOverflowCount)
              Positioned(
                left: displayAvatars.length * (avatarSize - overlap),
                child: Container(
                  width: avatarSize,
                  height: avatarSize,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isDark ? UbiColors.gray700 : UbiColors.gray300,
                    border: Border.all(
                      color: effectiveBorderColor,
                      width: borderWidth,
                    ),
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    '+$overflow',
                    style: UbiTypography.caption.copyWith(
                      color: isDark ? UbiColors.textPrimaryDark : UbiColors.textPrimary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  double _getSizeValue(UbiAvatarSize size) {
    switch (size) {
      case UbiAvatarSize.xs:
        return 24;
      case UbiAvatarSize.small:
        return 32;
      case UbiAvatarSize.medium:
        return 40;
      case UbiAvatarSize.large:
        return 56;
      case UbiAvatarSize.xl:
        return 80;
      case UbiAvatarSize.xxl:
        return 120;
    }
  }
}

/// Data class for avatar information
class UbiAvatarData {
  const UbiAvatarData({
    this.imageUrl,
    this.name,
  });

  /// Network image URL
  final String? imageUrl;

  /// Name for initials
  final String? name;
}
