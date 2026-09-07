/// Why config or flags could not be read.
///
/// A closed set of codes rather than an exception message, so nothing that
/// reaches a log line can carry a URL, a token or a user id (CLAUDE.md rule 7).
library;

enum ConfigUnavailableReason {
  /// No city has been selected yet, so there is nothing to fetch.
  noCity('no_city'),

  /// No API base URL was configured for this build.
  notConfigured('not_configured'),

  /// The device could not reach the service.
  offline('offline'),

  /// The service did not answer in time.
  timeout('timeout'),

  /// The session is not allowed to read config.
  unauthorized('unauthorized'),

  /// The city is not known to the service.
  unknownCity('unknown_city'),

  /// The service answered with a failure.
  serverError('server_error'),

  /// The service answered with something that is not the contract.
  malformed('malformed');

  const ConfigUnavailableReason(this.code);

  /// Stable, PII-free code. Safe to log and to send to analytics.
  final String code;
}
