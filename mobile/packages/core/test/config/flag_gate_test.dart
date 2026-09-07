import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ubi_core/ubi_config.dart';
import 'package:ubi_core/ubi_test_ids.dart';

import 'config_fixtures.dart';

void main() {
  final Map<String, dynamic> raw = cityConfigJson();
  final CityConfig config = CityConfig.fromJson(raw);

  Future<ConfigCubit> cubitWith(Map<String, dynamic> flags) async {
    final ScriptedConfigSource source = ScriptedConfigSource(
      cityResponses: <ConfigResponse<CityConfig>>[
        ConfigPayload<CityConfig>(value: config, raw: raw, etag: 'W/"1"'),
      ],
      flagResponses: <ConfigResponse<FlagSet>>[
        ConfigPayload<FlagSet>(
          value: FlagSet.fromJson(flags),
          raw: flags,
          etag: 'W/"1"',
        ),
      ],
    );
    final ConfigCubit cubit = ConfigCubit(
      repository: ConfigRepository(source: source),
      citySource: FakeCitySource('TESTCITY'),
    );
    await cubit.load();
    return cubit;
  }

  Widget host(ConfigCubit cubit, Widget child) {
    return BlocProvider<ConfigCubit>.value(
      value: cubit,
      child: MaterialApp(home: child),
    );
  }

  testWidgets('a tile renders only when its flag is on', (tester) async {
    final ConfigCubit cubit = await cubitWith(<String, dynamic>{
      'move': true,
      'bites': false,
    });
    addTearDown(cubit.close);

    await tester.pumpWidget(
      host(
        cubit,
        const Column(
          children: <Widget>[
            FlagGate(flag: UbiFlag.move, child: Text('Move tile')),
            FlagGate(flag: UbiFlag.bites, child: Text('Bites tile')),
          ],
        ),
      ),
    );

    expect(find.text('Move tile'), findsOneWidget);
    expect(find.text('Bites tile'), findsNothing);
  });

  testWidgets('a deep link into a disabled vertical shows the honest screen',
      (tester) async {
    final ConfigCubit cubit = await cubitWith(<String, dynamic>{'move': true});
    addTearDown(cubit.close);

    await tester.pumpWidget(
      host(
        cubit,
        const FlagGatedRoute(
          flag: UbiFlag.bites,
          featureName: 'UBI Bites',
          child: Text('Bites home'),
        ),
      ),
    );

    expect(find.text('Bites home'), findsNothing);
    expect(find.byKey(testKey(TestIds.commonFlagOffScreen)), findsOneWidget);
    expect(find.text('Not available here'), findsOneWidget);
  });

  testWidgets('an unreachable service says so rather than "not available"',
      (tester) async {
    final ScriptedConfigSource source = ScriptedConfigSource(
      cityResponses: <ConfigResponse<CityConfig>>[
        ConfigPayload<CityConfig>(value: config, raw: raw, etag: 'W/"1"'),
      ],
      flagResponses: <ConfigResponse<FlagSet>>[
        ConfigFailure<FlagSet>(ConfigUnavailableReason.offline),
      ],
    );
    final ConfigCubit cubit = ConfigCubit(
      repository: ConfigRepository(source: source),
      citySource: FakeCitySource('TESTCITY'),
    );
    addTearDown(cubit.close);
    await cubit.load();

    await tester.pumpWidget(
      host(
        cubit,
        const FlagGatedRoute(
          flag: UbiFlag.bites,
          featureName: 'UBI Bites',
          child: Text('Bites home'),
        ),
      ),
    );

    expect(find.byKey(testKey(TestIds.commonFlagOffScreen)), findsOneWidget);
    expect(find.text('We could not check this'), findsOneWidget);
  });

  testWidgets('no city means every flag is off', (tester) async {
    final ConfigCubit cubit = ConfigCubit(
      repository: ConfigRepository(
        source: ScriptedConfigSource(
          cityResponses: <ConfigResponse<CityConfig>>[],
          flagResponses: <ConfigResponse<FlagSet>>[],
        ),
      ),
      citySource: FakeCitySource(null),
    );
    addTearDown(cubit.close);
    await cubit.load();

    expect(cubit.state.status, ConfigStatus.unavailable);
    expect(cubit.state.flags.isDenyAll, isTrue);
    expect(cubit.state.configReason, ConfigUnavailableReason.noCity);
    expect(cubit.state.emergencyNumber, isNull);
  });
}
