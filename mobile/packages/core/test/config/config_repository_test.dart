import 'package:flutter_test/flutter_test.dart';
import 'package:ubi_core/ubi_config.dart';

import 'config_fixtures.dart';

void main() {
  final Map<String, dynamic> raw = cityConfigJson();
  final CityConfig config = CityConfig.fromJson(raw);

  ConfigPayload<FlagSet> flagPayload(
    Map<String, dynamic> json, {
    String? etag,
  }) {
    return ConfigPayload<FlagSet>(
      value: FlagSet.fromJson(json),
      raw: json,
      etag: etag,
    );
  }

  group('flags fail closed', () {
    test('every transport failure denies all flags', () async {
      for (final ConfigUnavailableReason reason
          in ConfigUnavailableReason.values) {
        final ScriptedConfigSource source = ScriptedConfigSource(
          cityResponses: <ConfigResponse<CityConfig>>[
            ConfigFailure<CityConfig>(reason),
          ],
          flagResponses: <ConfigResponse<FlagSet>>[
            ConfigFailure<FlagSet>(reason),
          ],
        );
        final ConfigRepository repository = ConfigRepository(source: source);

        final FlagOutcome outcome = await repository.loadFlags('TESTCITY');

        expect(outcome.flags.isDenyAll, isTrue, reason: reason.code);
        expect(outcome.reason, reason);
      }
    });

    test('a previously enabled flag is denied once the service goes away',
        () async {
      final ScriptedConfigSource source = ScriptedConfigSource(
        cityResponses: <ConfigResponse<CityConfig>>[],
        flagResponses: <ConfigResponse<FlagSet>>[
          flagPayload(<String, dynamic>{'bites': true}, etag: 'W/"1"'),
          ConfigFailure<FlagSet>(ConfigUnavailableReason.offline),
        ],
      );
      final ConfigRepository repository = ConfigRepository(source: source);

      final FlagOutcome first = await repository.loadFlags('TESTCITY');
      expect(first.flags.isEnabled(UbiFlag.bites), isTrue);

      final FlagOutcome second = await repository.loadFlags('TESTCITY');
      expect(second.flags.isEnabled(UbiFlag.bites), isFalse);
      expect(second.reason, ConfigUnavailableReason.offline);
    });

    test('304 keeps the evaluation the service already confirmed', () async {
      final ScriptedConfigSource source = ScriptedConfigSource(
        cityResponses: <ConfigResponse<CityConfig>>[],
        flagResponses: <ConfigResponse<FlagSet>>[
          flagPayload(<String, dynamic>{'move': true}, etag: 'W/"7"'),
          const ConfigNotModified<FlagSet>(),
        ],
      );
      final ConfigRepository repository = ConfigRepository(source: source);

      await repository.loadFlags('TESTCITY');
      final FlagOutcome revalidated = await repository.loadFlags('TESTCITY');

      expect(revalidated.flags.isEnabled(UbiFlag.move), isTrue);
      expect(revalidated.reason, isNull);
      // The second call must have been conditional.
      expect(source.flagEtagsSeen, <String?>[null, 'W/"7"']);
    });

    test('304 with nothing to revalidate denies all', () async {
      final ScriptedConfigSource source = ScriptedConfigSource(
        cityResponses: <ConfigResponse<CityConfig>>[],
        flagResponses: <ConfigResponse<FlagSet>>[
          const ConfigNotModified<FlagSet>(),
        ],
      );
      final ConfigRepository repository = ConfigRepository(source: source);

      final FlagOutcome outcome = await repository.loadFlags('TESTCITY');

      expect(outcome.flags.isDenyAll, isTrue);
      expect(outcome.reason, ConfigUnavailableReason.malformed);
    });

    test('signing out drops the evaluation so it cannot be revalidated',
        () async {
      final ScriptedConfigSource source = ScriptedConfigSource(
        cityResponses: <ConfigResponse<CityConfig>>[],
        flagResponses: <ConfigResponse<FlagSet>>[
          flagPayload(<String, dynamic>{'fleet': true}, etag: 'W/"3"'),
          const ConfigNotModified<FlagSet>(),
        ],
      );
      final ConfigRepository repository = ConfigRepository(source: source);

      await repository.loadFlags('TESTCITY');
      repository.forgetSession();
      final FlagOutcome afterSignOut = await repository.loadFlags('TESTCITY');

      expect(afterSignOut.flags.isDenyAll, isTrue);
      // No ETag on the second call: a new session re-evaluates from scratch.
      expect(source.flagEtagsSeen, <String?>[null, null]);
    });
  });

  group('city config', () {
    test('a fresh document is returned and is not stale', () async {
      final ScriptedConfigSource source = ScriptedConfigSource(
        cityResponses: <ConfigResponse<CityConfig>>[
          ConfigPayload<CityConfig>(value: config, raw: raw, etag: 'W/"9"'),
        ],
        flagResponses: <ConfigResponse<FlagSet>>[],
      );
      final ConfigRepository repository = ConfigRepository(source: source);

      final CityConfigOutcome outcome =
          await repository.loadCityConfig('TESTCITY');

      expect(outcome.config?.currency, 'XTS');
      expect(outcome.isStale, isFalse);
      expect(outcome.reason, isNull);
    });

    test('an unreachable service with no cache yields no config at all',
        () async {
      final ScriptedConfigSource source = ScriptedConfigSource(
        cityResponses: <ConfigResponse<CityConfig>>[
          ConfigFailure<CityConfig>(ConfigUnavailableReason.offline),
        ],
        flagResponses: <ConfigResponse<FlagSet>>[],
      );
      final ConfigRepository repository = ConfigRepository(source: source);

      final CityConfigOutcome outcome =
          await repository.loadCityConfig('TESTCITY');

      expect(outcome.config, isNull);
      expect(outcome.isUsable, isFalse);
      expect(outcome.reason, ConfigUnavailableReason.offline);
    });
  });
}
