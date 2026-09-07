/// Flag gating for tiles and deep links (CLAUDE.md rule 5 and rule 8).
///
/// A tile renders only when its flag is on. A deep link into a vertical that is
/// off lands on [FeatureUnavailablePage] — an honest screen that says so —
/// rather than a broken page or a silent no-op.
library;

import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../testing/test_ids.dart';
import 'config_cubit.dart';
import 'feature_flags.dart';

/// Renders [child] only while [flag] is on.
///
/// While config has not loaded the flag is off, so this shows [fallback] (or
/// nothing) rather than flashing a feature that may not exist here.
class FlagGate extends StatelessWidget {
  const FlagGate({
    required this.flag,
    required this.child,
    super.key,
    this.fallback,
  });

  final UbiFlag flag;
  final Widget child;

  /// Shown when the flag is off. Null renders nothing, which is right for a
  /// home tile: an absent tile is honest, an empty one is not.
  final Widget? fallback;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ConfigCubit, ConfigState>(
      buildWhen: (ConfigState previous, ConfigState current) =>
          previous.flags != current.flags,
      builder: (BuildContext context, ConfigState state) {
        if (state.isEnabled(flag)) {
          return child;
        }
        return fallback ?? const SizedBox.shrink();
      },
    );
  }
}

/// Wraps a whole route. Use this for every deep-linkable vertical.
class FlagGatedRoute extends StatelessWidget {
  const FlagGatedRoute({
    required this.flag,
    required this.featureName,
    required this.child,
    super.key,
    this.onDismiss,
  });

  final UbiFlag flag;

  /// How the feature is named to the user, e.g. `UBI Bites`.
  final String featureName;

  final Widget child;

  /// Where "Go back" should take the user. Null hides the action.
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ConfigCubit, ConfigState>(
      builder: (BuildContext context, ConfigState state) {
        if (state.isEnabled(flag)) {
          return child;
        }
        return FeatureUnavailablePage(
          featureName: featureName,
          couldNotCheck: state.flagsUnverified,
          onDismiss: onDismiss,
        );
      },
    );
  }
}

/// The honest "not available here" screen.
///
/// testID: `common.flagOff.screen`.
class FeatureUnavailablePage extends StatelessWidget {
  const FeatureUnavailablePage({
    required this.featureName,
    super.key,
    this.couldNotCheck = false,
    this.onDismiss,
  });

  final String featureName;

  /// True when flags are off because the service could not be reached, rather
  /// than because the city does not run the feature. The two are different
  /// facts and the copy says which one it is.
  final bool couldNotCheck;

  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final String title =
        couldNotCheck ? 'We could not check this' : 'Not available here';
    final String body = couldNotCheck
        ? '$featureName needs a connection to confirm it is available in your '
            'city. Check your connection and try again.'
        : '$featureName has not launched in your city yet. Nothing has been '
            'lost — you can still use everything on your home screen.';

    return Scaffold(
      key: testKey(TestIds.commonFlagOffScreen),
      appBar: AppBar(
        leading: onDismiss == null
            ? null
            : IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: onDismiss,
                tooltip: 'Go back',
              ),
        title: Text(featureName),
      ),
      body: Semantics(
        container: true,
        label: '$title. $body',
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: <Widget>[
                Icon(
                  couldNotCheck ? Icons.wifi_off : Icons.map_outlined,
                  size: 48,
                  color: theme.colorScheme.onSurface,
                ),
                const SizedBox(height: 16),
                Text(
                  title,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                Text(
                  body,
                  textAlign: TextAlign.center,
                  style: theme.textTheme.bodyMedium,
                ),
                if (onDismiss != null) ...<Widget>[
                  const SizedBox(height: 24),
                  OutlinedButton(
                    onPressed: onDismiss,
                    child: const Text('Go back'),
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
