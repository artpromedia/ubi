/// UBI UI Kit - Design System
///
/// A comprehensive design system for UBI mobile applications.
/// Provides consistent theming, components, and utilities across
/// both the Rider and Driver apps.
library ubi_ui_kit;

// Theme
export 'src/theme/ubi_theme.dart';
export 'src/theme/ubi_colors.dart';
export 'src/theme/ubi_typography.dart';
export 'src/theme/ubi_spacing.dart';
export 'src/theme/ubi_shadows.dart';
export 'src/theme/ubi_radius.dart';

// Atoms (Basic building blocks)
export 'src/atoms/buttons/ubi_button.dart';
export 'src/atoms/inputs/ubi_text_field.dart';
export 'src/atoms/badges/ubi_badge.dart';
export 'src/atoms/avatars/ubi_avatar.dart';
export 'src/atoms/loaders/ubi_loading.dart';
export 'src/atoms/logos/ubi_logo.dart';

// Molecules (Combinations of atoms)
export 'src/molecules/cards/ubi_card.dart';
export 'src/molecules/list_tiles/ubi_list_tile.dart';
export 'src/molecules/search/ubi_search_bar.dart';
export 'src/molecules/chips/ubi_chip.dart';
export 'src/molecules/toast/ubi_toast.dart';
export 'src/molecules/rating/ubi_rating.dart';

// Organisms (Complex components)
export 'src/organisms/app_bar/ubi_app_bar.dart';
export 'src/organisms/bottom_sheet/ubi_bottom_sheet.dart';
export 'src/organisms/navigation/ubi_bottom_nav.dart';
export 'src/organisms/states/ubi_states.dart';
export 'src/organisms/dialogs/ubi_dialogs.dart';

// Feature Components (Domain-specific)
export 'src/features/ride/ride_card.dart';
export 'src/features/food/food_card.dart';
// TODO: Implement additional feature components
// export 'src/features/payment/payment_method_tile.dart';
// export 'src/features/address/address_tile.dart';

// Map Components
// TODO: Implement map components
// export 'src/maps/ubi_map.dart';
// export 'src/maps/ubi_marker.dart';
// export 'src/maps/ubi_route_polyline.dart';
// export 'src/maps/ubi_driver_marker.dart';

// Utilities
export 'src/utils/responsive.dart';
export 'src/utils/extensions.dart';
export 'src/utils/formatters.dart';
