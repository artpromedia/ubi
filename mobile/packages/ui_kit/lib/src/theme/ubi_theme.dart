import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'ubi_colors.dart';
import 'ubi_typography.dart';
import 'ubi_radius.dart';

/// UBI Theme
///
/// Main theme configuration combining all design system elements
class UbiTheme {
  UbiTheme._();

  // === Light Theme ===
  
  static ThemeData get light => ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    
    // Colors
    colorScheme: _lightColorScheme,
    scaffoldBackgroundColor: UbiColors.surface,
    canvasColor: UbiColors.surface,
    cardColor: UbiColors.white,
    dividerColor: UbiColors.divider,
    
    // Typography
    textTheme: UbiTypography.textTheme,
    fontFamily: GoogleFonts.inter().fontFamily,
    
    // AppBar
    appBarTheme: _lightAppBarTheme,
    
    // Buttons
    elevatedButtonTheme: _elevatedButtonTheme,
    filledButtonTheme: _filledButtonTheme,
    outlinedButtonTheme: _outlinedButtonTheme,
    textButtonTheme: _textButtonTheme,
    iconButtonTheme: _iconButtonTheme,
    
    // Input
    inputDecorationTheme: _lightInputDecorationTheme,
    
    // Card
    cardTheme: _lightCardTheme,
    
    // Bottom Navigation
    bottomNavigationBarTheme: _lightBottomNavTheme,
    navigationBarTheme: _lightNavigationBarTheme,
    
    // Bottom Sheet
    bottomSheetTheme: _lightBottomSheetTheme,
    
    // Dialog
    dialogTheme: _dialogTheme,
    
    // Chip
    chipTheme: _lightChipTheme,
    
    // Floating Action Button
    floatingActionButtonTheme: _fabTheme,
    
    // Snackbar
    snackBarTheme: _snackBarTheme,
    
    // Progress Indicator
    progressIndicatorTheme: _progressIndicatorTheme,
    
    // Switch
    switchTheme: _switchTheme,
    
    // Checkbox
    checkboxTheme: _checkboxTheme,
    
    // Radio
    radioTheme: _radioTheme,
    
    // Slider
    sliderTheme: _sliderTheme,
    
    // Tab Bar
    tabBarTheme: _lightTabBarTheme,
    
    // Divider
    dividerTheme: _dividerTheme,
    
    // List Tile
    listTileTheme: _lightListTileTheme,
    
    // Expansion Tile
    expansionTileTheme: _lightExpansionTileTheme,
    
    // Extensions
    extensions: const [
      UbiColorsData.light,
    ],
  );

  // === Dark Theme ===
  
  static ThemeData get dark => ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    
    // Colors
    colorScheme: _darkColorScheme,
    scaffoldBackgroundColor: UbiColors.surfaceDark,
    canvasColor: UbiColors.surfaceDark,
    cardColor: UbiColors.cardDark,
    dividerColor: UbiColors.dividerDark,
    
    // Typography
    textTheme: UbiTypography.textThemeDark,
    fontFamily: GoogleFonts.inter().fontFamily,
    
    // AppBar
    appBarTheme: _darkAppBarTheme,
    
    // Buttons
    elevatedButtonTheme: _elevatedButtonThemeDark,
    filledButtonTheme: _filledButtonThemeDark,
    outlinedButtonTheme: _outlinedButtonThemeDark,
    textButtonTheme: _textButtonThemeDark,
    iconButtonTheme: _iconButtonThemeDark,
    
    // Input
    inputDecorationTheme: _darkInputDecorationTheme,
    
    // Card
    cardTheme: _darkCardTheme,
    
    // Bottom Navigation
    bottomNavigationBarTheme: _darkBottomNavTheme,
    navigationBarTheme: _darkNavigationBarTheme,
    
    // Bottom Sheet
    bottomSheetTheme: _darkBottomSheetTheme,
    
    // Dialog
    dialogTheme: _dialogThemeDark,
    
    // Chip
    chipTheme: _darkChipTheme,
    
    // Floating Action Button
    floatingActionButtonTheme: _fabTheme,
    
    // Snackbar
    snackBarTheme: _snackBarThemeDark,
    
    // Progress Indicator
    progressIndicatorTheme: _progressIndicatorTheme,
    
    // Switch
    switchTheme: _switchTheme,
    
    // Checkbox
    checkboxTheme: _checkboxTheme,
    
    // Radio
    radioTheme: _radioTheme,
    
    // Slider
    sliderTheme: _sliderTheme,
    
    // Tab Bar
    tabBarTheme: _darkTabBarTheme,
    
    // Divider
    dividerTheme: _dividerThemeDark,
    
    // List Tile
    listTileTheme: _darkListTileTheme,
    
    // Expansion Tile
    expansionTileTheme: _darkExpansionTileTheme,
    
    // Extensions
    extensions: const [
      UbiColorsData.dark,
    ],
  );

  // === Color Schemes ===
  
  static const _lightColorScheme = ColorScheme(
    brightness: Brightness.light,
    primary: UbiColors.ubiGreen,
    onPrimary: UbiColors.white,
    primaryContainer: UbiColors.greenLight,
    onPrimaryContainer: UbiColors.greenDark,
    secondary: UbiColors.ubiBlack,
    onSecondary: UbiColors.white,
    secondaryContainer: UbiColors.gray100,
    onSecondaryContainer: UbiColors.gray900,
    tertiary: UbiColors.serviceFood,
    onTertiary: UbiColors.white,
    tertiaryContainer: UbiColors.foodLight,
    onTertiaryContainer: UbiColors.foodDark,
    error: UbiColors.error,
    onError: UbiColors.white,
    errorContainer: UbiColors.errorLight,
    onErrorContainer: UbiColors.errorDark,
    surface: UbiColors.surface,
    onSurface: UbiColors.textPrimary,
    surfaceContainerHighest: UbiColors.gray100,
    onSurfaceVariant: UbiColors.textSecondary,
    outline: UbiColors.border,
    outlineVariant: UbiColors.divider,
    shadow: UbiColors.black,
    scrim: UbiColors.overlay60,
    inverseSurface: UbiColors.gray900,
    onInverseSurface: UbiColors.white,
    inversePrimary: UbiColors.greenLight,
  );

  static const _darkColorScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: UbiColors.ubiGreen,
    onPrimary: UbiColors.white,
    primaryContainer: UbiColors.greenDark,
    onPrimaryContainer: UbiColors.greenLight,
    secondary: UbiColors.white,
    onSecondary: UbiColors.ubiBlack,
    secondaryContainer: UbiColors.gray800,
    onSecondaryContainer: UbiColors.gray100,
    tertiary: UbiColors.serviceFood,
    onTertiary: UbiColors.white,
    tertiaryContainer: UbiColors.foodDark,
    onTertiaryContainer: UbiColors.foodLight,
    error: UbiColors.errorLight,
    onError: UbiColors.black,
    errorContainer: UbiColors.errorDark,
    onErrorContainer: UbiColors.errorLight,
    surface: UbiColors.surfaceDark,
    onSurface: UbiColors.textPrimaryDark,
    surfaceContainerHighest: UbiColors.gray800,
    onSurfaceVariant: UbiColors.textSecondaryDark,
    outline: UbiColors.borderDark,
    outlineVariant: UbiColors.dividerDark,
    shadow: UbiColors.black,
    scrim: UbiColors.overlay80,
    inverseSurface: UbiColors.gray100,
    onInverseSurface: UbiColors.gray900,
    inversePrimary: UbiColors.greenDark,
  );

  // === AppBar ===
  
  static final _lightAppBarTheme = AppBarTheme(
    elevation: 0,
    scrolledUnderElevation: 1,
    backgroundColor: UbiColors.surface,
    foregroundColor: UbiColors.textPrimary,
    surfaceTintColor: Colors.transparent,
    centerTitle: true,
    titleTextStyle: UbiTypography.headline3,
    iconTheme: const IconThemeData(
      color: UbiColors.textPrimary,
      size: 24,
    ),
  );

  static final _darkAppBarTheme = AppBarTheme(
    elevation: 0,
    scrolledUnderElevation: 1,
    backgroundColor: UbiColors.surfaceDark,
    foregroundColor: UbiColors.textPrimaryDark,
    surfaceTintColor: Colors.transparent,
    centerTitle: true,
    titleTextStyle: UbiTypography.headline3.copyWith(
      color: UbiColors.textPrimaryDark,
    ),
    iconTheme: const IconThemeData(
      color: UbiColors.textPrimaryDark,
      size: 24,
    ),
  );

  // === Buttons ===
  
  static final _elevatedButtonTheme = ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      elevation: 2,
      backgroundColor: UbiColors.ubiGreen,
      foregroundColor: UbiColors.white,
      disabledBackgroundColor: UbiColors.gray200,
      disabledForegroundColor: UbiColors.gray400,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      minimumSize: const Size(88, 52),
      shape: RoundedRectangleBorder(
        borderRadius: UbiRadius.buttonRadius,
      ),
      textStyle: UbiTypography.button,
    ),
  );

  static final _elevatedButtonThemeDark = ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      elevation: 2,
      backgroundColor: UbiColors.ubiGreen,
      foregroundColor: UbiColors.white,
      disabledBackgroundColor: UbiColors.gray700,
      disabledForegroundColor: UbiColors.gray500,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      minimumSize: const Size(88, 52),
      shape: RoundedRectangleBorder(
        borderRadius: UbiRadius.buttonRadius,
      ),
      textStyle: UbiTypography.button,
    ),
  );

  static final _filledButtonTheme = FilledButtonThemeData(
    style: FilledButton.styleFrom(
      backgroundColor: UbiColors.ubiGreen,
      foregroundColor: UbiColors.white,
      disabledBackgroundColor: UbiColors.gray200,
      disabledForegroundColor: UbiColors.gray400,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      minimumSize: const Size(88, 52),
      shape: RoundedRectangleBorder(
        borderRadius: UbiRadius.buttonRadius,
      ),
      textStyle: UbiTypography.button,
    ),
  );

  static final _filledButtonThemeDark = FilledButtonThemeData(
    style: FilledButton.styleFrom(
      backgroundColor: UbiColors.ubiGreen,
      foregroundColor: UbiColors.white,
      disabledBackgroundColor: UbiColors.gray700,
      disabledForegroundColor: UbiColors.gray500,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      minimumSize: const Size(88, 52),
      shape: RoundedRectangleBorder(
        borderRadius: UbiRadius.buttonRadius,
      ),
      textStyle: UbiTypography.button,
    ),
  );

  static final _outlinedButtonTheme = OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      foregroundColor: UbiColors.ubiGreen,
      disabledForegroundColor: UbiColors.gray400,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      minimumSize: const Size(88, 52),
      shape: RoundedRectangleBorder(
        borderRadius: UbiRadius.buttonRadius,
      ),
      side: const BorderSide(color: UbiColors.ubiGreen, width: 1.5),
      textStyle: UbiTypography.button.copyWith(color: UbiColors.ubiGreen),
    ),
  );

  static final _outlinedButtonThemeDark = OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      foregroundColor: UbiColors.ubiGreen,
      disabledForegroundColor: UbiColors.gray500,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
      minimumSize: const Size(88, 52),
      shape: RoundedRectangleBorder(
        borderRadius: UbiRadius.buttonRadius,
      ),
      side: const BorderSide(color: UbiColors.ubiGreen, width: 1.5),
      textStyle: UbiTypography.button.copyWith(color: UbiColors.ubiGreen),
    ),
  );

  static final _textButtonTheme = TextButtonThemeData(
    style: TextButton.styleFrom(
      foregroundColor: UbiColors.ubiGreen,
      disabledForegroundColor: UbiColors.gray400,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      minimumSize: const Size(64, 44),
      shape: RoundedRectangleBorder(
        borderRadius: UbiRadius.buttonRadius,
      ),
      textStyle: UbiTypography.button.copyWith(color: UbiColors.ubiGreen),
    ),
  );

  static final _textButtonThemeDark = TextButtonThemeData(
    style: TextButton.styleFrom(
      foregroundColor: UbiColors.ubiGreen,
      disabledForegroundColor: UbiColors.gray500,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      minimumSize: const Size(64, 44),
      shape: RoundedRectangleBorder(
        borderRadius: UbiRadius.buttonRadius,
      ),
      textStyle: UbiTypography.button.copyWith(color: UbiColors.ubiGreen),
    ),
  );

  static const _iconButtonTheme = IconButtonThemeData(
    style: ButtonStyle(
      iconSize: WidgetStatePropertyAll(24),
      padding: WidgetStatePropertyAll(EdgeInsets.all(12)),
      minimumSize: WidgetStatePropertyAll(Size(48, 48)),
    ),
  );

  static const _iconButtonThemeDark = IconButtonThemeData(
    style: ButtonStyle(
      iconSize: WidgetStatePropertyAll(24),
      padding: WidgetStatePropertyAll(EdgeInsets.all(12)),
      minimumSize: WidgetStatePropertyAll(Size(48, 48)),
    ),
  );

  // === Input ===
  
  static final _lightInputDecorationTheme = InputDecorationTheme(
    filled: true,
    fillColor: UbiColors.gray50,
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    border: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.border, width: 1),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.border, width: 1),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.ubiGreen, width: 2),
    ),
    errorBorder: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.error, width: 1),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.error, width: 2),
    ),
    disabledBorder: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.gray200, width: 1),
    ),
    labelStyle: UbiTypography.body1.copyWith(color: UbiColors.textSecondary),
    hintStyle: UbiTypography.body1.copyWith(color: UbiColors.textTertiary),
    errorStyle: UbiTypography.caption.copyWith(color: UbiColors.error),
    helperStyle: UbiTypography.caption.copyWith(color: UbiColors.textSecondary),
    prefixIconColor: UbiColors.textSecondary,
    suffixIconColor: UbiColors.textSecondary,
  );

  static final _darkInputDecorationTheme = InputDecorationTheme(
    filled: true,
    fillColor: UbiColors.gray800,
    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    border: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.borderDark, width: 1),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.borderDark, width: 1),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.ubiGreen, width: 2),
    ),
    errorBorder: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.errorLight, width: 1),
    ),
    focusedErrorBorder: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.errorLight, width: 2),
    ),
    disabledBorder: OutlineInputBorder(
      borderRadius: UbiRadius.inputRadius,
      borderSide: const BorderSide(color: UbiColors.gray700, width: 1),
    ),
    labelStyle: UbiTypography.body1.copyWith(color: UbiColors.textSecondaryDark),
    hintStyle: UbiTypography.body1.copyWith(color: UbiColors.textTertiaryDark),
    errorStyle: UbiTypography.caption.copyWith(color: UbiColors.errorLight),
    helperStyle: UbiTypography.caption.copyWith(color: UbiColors.textSecondaryDark),
    prefixIconColor: UbiColors.textSecondaryDark,
    suffixIconColor: UbiColors.textSecondaryDark,
  );

  // === Card ===
  
  static final _lightCardTheme = CardTheme(
    elevation: 0,
    color: UbiColors.white,
    surfaceTintColor: Colors.transparent,
    shape: RoundedRectangleBorder(
      borderRadius: UbiRadius.cardRadius,
      side: const BorderSide(color: UbiColors.border, width: 1),
    ),
    margin: EdgeInsets.zero,
  );

  static final _darkCardTheme = CardTheme(
    elevation: 0,
    color: UbiColors.cardDark,
    surfaceTintColor: Colors.transparent,
    shape: RoundedRectangleBorder(
      borderRadius: UbiRadius.cardRadius,
      side: const BorderSide(color: UbiColors.borderDark, width: 1),
    ),
    margin: EdgeInsets.zero,
  );

  // === Bottom Navigation ===
  
  static const _lightBottomNavTheme = BottomNavigationBarThemeData(
    type: BottomNavigationBarType.fixed,
    backgroundColor: UbiColors.white,
    selectedItemColor: UbiColors.ubiGreen,
    unselectedItemColor: UbiColors.textTertiary,
    elevation: 8,
    showSelectedLabels: true,
    showUnselectedLabels: true,
    selectedLabelStyle: TextStyle(
      fontFamily: 'Inter',
      fontSize: 12,
      fontWeight: FontWeight.w600,
    ),
    unselectedLabelStyle: TextStyle(
      fontFamily: 'Inter',
      fontSize: 12,
      fontWeight: FontWeight.w400,
    ),
  );

  static const _darkBottomNavTheme = BottomNavigationBarThemeData(
    type: BottomNavigationBarType.fixed,
    backgroundColor: UbiColors.cardDark,
    selectedItemColor: UbiColors.ubiGreen,
    unselectedItemColor: UbiColors.textTertiaryDark,
    elevation: 8,
    showSelectedLabels: true,
    showUnselectedLabels: true,
    selectedLabelStyle: TextStyle(
      fontFamily: 'Inter',
      fontSize: 12,
      fontWeight: FontWeight.w600,
    ),
    unselectedLabelStyle: TextStyle(
      fontFamily: 'Inter',
      fontSize: 12,
      fontWeight: FontWeight.w400,
    ),
  );

  static final _lightNavigationBarTheme = NavigationBarThemeData(
    backgroundColor: UbiColors.white,
    indicatorColor: UbiColors.greenLight,
    surfaceTintColor: Colors.transparent,
    elevation: 0,
    height: 80,
    labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
    iconTheme: WidgetStateProperty.resolveWith((states) {
      if (states.contains(WidgetState.selected)) {
        return const IconThemeData(color: UbiColors.ubiGreen, size: 24);
      }
      return const IconThemeData(color: UbiColors.textTertiary, size: 24);
    }),
  );

  static final _darkNavigationBarTheme = NavigationBarThemeData(
    backgroundColor: UbiColors.cardDark,
    indicatorColor: UbiColors.greenDark.withValues(alpha: 0.3),
    surfaceTintColor: Colors.transparent,
    elevation: 0,
    height: 80,
    labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
    iconTheme: WidgetStateProperty.resolveWith((states) {
      if (states.contains(WidgetState.selected)) {
        return const IconThemeData(color: UbiColors.ubiGreen, size: 24);
      }
      return const IconThemeData(color: UbiColors.textTertiaryDark, size: 24);
    }),
  );

  // === Bottom Sheet ===
  
  static final _lightBottomSheetTheme = BottomSheetThemeData(
    backgroundColor: UbiColors.white,
    surfaceTintColor: Colors.transparent,
    elevation: 16,
    shape: RoundedRectangleBorder(
      borderRadius: UbiRadius.bottomSheetRadius,
    ),
    showDragHandle: true,
    dragHandleColor: UbiColors.gray300,
    dragHandleSize: const Size(40, 4),
  );

  static final _darkBottomSheetTheme = BottomSheetThemeData(
    backgroundColor: UbiColors.cardDark,
    surfaceTintColor: Colors.transparent,
    elevation: 16,
    shape: RoundedRectangleBorder(
      borderRadius: UbiRadius.bottomSheetRadius,
    ),
    showDragHandle: true,
    dragHandleColor: UbiColors.gray600,
    dragHandleSize: const Size(40, 4),
  );

  // === Dialog ===
  
  static final _dialogTheme = DialogTheme(
    backgroundColor: UbiColors.white,
    surfaceTintColor: Colors.transparent,
    elevation: 16,
    shape: RoundedRectangleBorder(
      borderRadius: UbiRadius.dialogRadius,
    ),
    titleTextStyle: UbiTypography.headline3,
    contentTextStyle: UbiTypography.body1,
  );

  static final _dialogThemeDark = DialogTheme(
    backgroundColor: UbiColors.cardDark,
    surfaceTintColor: Colors.transparent,
    elevation: 16,
    shape: RoundedRectangleBorder(
      borderRadius: UbiRadius.dialogRadius,
    ),
    titleTextStyle: UbiTypography.headline3.copyWith(
      color: UbiColors.textPrimaryDark,
    ),
    contentTextStyle: UbiTypography.body1.copyWith(
      color: UbiColors.textPrimaryDark,
    ),
  );

  // === Chip ===
  
  static final _lightChipTheme = ChipThemeData(
    backgroundColor: UbiColors.gray100,
    selectedColor: UbiColors.greenLight,
    disabledColor: UbiColors.gray100,
    deleteIconColor: UbiColors.textSecondary,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    labelPadding: const EdgeInsets.symmetric(horizontal: 4),
    shape: RoundedRectangleBorder(
      borderRadius: UbiRadius.chipRadius,
    ),
    side: BorderSide.none,
    labelStyle: UbiTypography.body2.copyWith(color: UbiColors.textPrimary),
    secondaryLabelStyle: UbiTypography.body2.copyWith(color: UbiColors.ubiGreen),
  );

  static final _darkChipTheme = ChipThemeData(
    backgroundColor: UbiColors.gray800,
    selectedColor: UbiColors.greenDark.withValues(alpha: 0.3),
    disabledColor: UbiColors.gray700,
    deleteIconColor: UbiColors.textSecondaryDark,
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    labelPadding: const EdgeInsets.symmetric(horizontal: 4),
    shape: RoundedRectangleBorder(
      borderRadius: UbiRadius.chipRadius,
    ),
    side: BorderSide.none,
    labelStyle: UbiTypography.body2.copyWith(color: UbiColors.textPrimaryDark),
    secondaryLabelStyle: UbiTypography.body2.copyWith(color: UbiColors.ubiGreen),
  );

  // === FAB ===
  
  static final _fabTheme = FloatingActionButtonThemeData(
    backgroundColor: UbiColors.ubiGreen,
    foregroundColor: UbiColors.white,
    elevation: 6,
    focusElevation: 8,
    hoverElevation: 8,
    highlightElevation: 12,
    shape: RoundedRectangleBorder(
      borderRadius: UbiRadius.dfRadius,
    ),
    largeSizeConstraints: const BoxConstraints.tightFor(width: 96, height: 96),
    extendedPadding: const EdgeInsets.symmetric(horizontal: 24),
  );

  // === Snackbar ===
  
  static const _snackBarTheme = SnackBarThemeData(
    backgroundColor: UbiColors.gray900,
    contentTextStyle: TextStyle(
      fontFamily: 'Inter',
      fontSize: 14,
      fontWeight: FontWeight.w400,
      color: UbiColors.white,
    ),
    behavior: SnackBarBehavior.floating,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(8)),
    ),
    actionTextColor: UbiColors.ubiGreen,
    elevation: 6,
  );

  static const _snackBarThemeDark = SnackBarThemeData(
    backgroundColor: UbiColors.gray100,
    contentTextStyle: TextStyle(
      fontFamily: 'Inter',
      fontSize: 14,
      fontWeight: FontWeight.w400,
      color: UbiColors.gray900,
    ),
    behavior: SnackBarBehavior.floating,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(8)),
    ),
    actionTextColor: UbiColors.greenDark,
    elevation: 6,
  );

  // === Progress Indicator ===
  
  static const _progressIndicatorTheme = ProgressIndicatorThemeData(
    color: UbiColors.ubiGreen,
    linearTrackColor: UbiColors.gray200,
    circularTrackColor: UbiColors.gray200,
  );

  // === Switch ===
  
  static final _switchTheme = SwitchThemeData(
    thumbColor: WidgetStateProperty.resolveWith((states) {
      if (states.contains(WidgetState.selected)) {
        return UbiColors.ubiGreen;
      }
      return UbiColors.gray400;
    }),
    trackColor: WidgetStateProperty.resolveWith((states) {
      if (states.contains(WidgetState.selected)) {
        return UbiColors.greenLight;
      }
      return UbiColors.gray200;
    }),
    trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
  );

  // === Checkbox ===
  
  static final _checkboxTheme = CheckboxThemeData(
    fillColor: WidgetStateProperty.resolveWith((states) {
      if (states.contains(WidgetState.selected)) {
        return UbiColors.ubiGreen;
      }
      return Colors.transparent;
    }),
    checkColor: WidgetStateProperty.all(UbiColors.white),
    side: const BorderSide(color: UbiColors.gray400, width: 2),
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(4),
    ),
  );

  // === Radio ===
  
  static final _radioTheme = RadioThemeData(
    fillColor: WidgetStateProperty.resolveWith((states) {
      if (states.contains(WidgetState.selected)) {
        return UbiColors.ubiGreen;
      }
      return UbiColors.gray400;
    }),
  );

  // === Slider ===
  
  static const _sliderTheme = SliderThemeData(
    activeTrackColor: UbiColors.ubiGreen,
    inactiveTrackColor: UbiColors.gray200,
    thumbColor: UbiColors.ubiGreen,
    overlayColor: Color(0x1A1DB954),
    valueIndicatorColor: UbiColors.ubiGreen,
    trackHeight: 4,
    thumbShape: RoundSliderThumbShape(enabledThumbRadius: 12),
  );

  // === Tab Bar ===
  
  static const _lightTabBarTheme = TabBarTheme(
    labelColor: UbiColors.ubiGreen,
    unselectedLabelColor: UbiColors.textTertiary,
    indicatorColor: UbiColors.ubiGreen,
    indicatorSize: TabBarIndicatorSize.tab,
    labelStyle: TextStyle(
      fontFamily: 'Inter',
      fontSize: 14,
      fontWeight: FontWeight.w600,
    ),
    unselectedLabelStyle: TextStyle(
      fontFamily: 'Inter',
      fontSize: 14,
      fontWeight: FontWeight.w400,
    ),
  );

  static const _darkTabBarTheme = TabBarTheme(
    labelColor: UbiColors.ubiGreen,
    unselectedLabelColor: UbiColors.textTertiaryDark,
    indicatorColor: UbiColors.ubiGreen,
    indicatorSize: TabBarIndicatorSize.tab,
    labelStyle: TextStyle(
      fontFamily: 'Inter',
      fontSize: 14,
      fontWeight: FontWeight.w600,
    ),
    unselectedLabelStyle: TextStyle(
      fontFamily: 'Inter',
      fontSize: 14,
      fontWeight: FontWeight.w400,
    ),
  );

  // === Divider ===
  
  static const _dividerTheme = DividerThemeData(
    color: UbiColors.divider,
    thickness: 1,
    space: 1,
  );

  static const _dividerThemeDark = DividerThemeData(
    color: UbiColors.dividerDark,
    thickness: 1,
    space: 1,
  );

  // === List Tile ===
  
  static const _lightListTileTheme = ListTileThemeData(
    contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    minLeadingWidth: 24,
    horizontalTitleGap: 16,
    minVerticalPadding: 12,
    iconColor: UbiColors.textSecondary,
    textColor: UbiColors.textPrimary,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(12)),
    ),
  );

  static const _darkListTileTheme = ListTileThemeData(
    contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
    minLeadingWidth: 24,
    horizontalTitleGap: 16,
    minVerticalPadding: 12,
    iconColor: UbiColors.textSecondaryDark,
    textColor: UbiColors.textPrimaryDark,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.all(Radius.circular(12)),
    ),
  );

  // === Expansion Tile ===
  
  static const _lightExpansionTileTheme = ExpansionTileThemeData(
    backgroundColor: Colors.transparent,
    collapsedBackgroundColor: Colors.transparent,
    iconColor: UbiColors.textSecondary,
    collapsedIconColor: UbiColors.textTertiary,
    textColor: UbiColors.textPrimary,
    collapsedTextColor: UbiColors.textPrimary,
    tilePadding: EdgeInsets.symmetric(horizontal: 16),
    childrenPadding: EdgeInsets.all(16),
  );

  static const _darkExpansionTileTheme = ExpansionTileThemeData(
    backgroundColor: Colors.transparent,
    collapsedBackgroundColor: Colors.transparent,
    iconColor: UbiColors.textSecondaryDark,
    collapsedIconColor: UbiColors.textTertiaryDark,
    textColor: UbiColors.textPrimaryDark,
    collapsedTextColor: UbiColors.textPrimaryDark,
    tilePadding: EdgeInsets.symmetric(horizontal: 16),
    childrenPadding: EdgeInsets.all(16),
  );
}

/// Extension to access UBI colors from context
extension UbiThemeExtension on BuildContext {
  /// Get UBI colors from theme
  UbiColorsData get ubiColors {
    return Theme.of(this).extension<UbiColorsData>() ?? UbiColorsData.light;
  }
  
  /// Check if current theme is dark
  bool get isDarkMode => Theme.of(this).brightness == Brightness.dark;
}
