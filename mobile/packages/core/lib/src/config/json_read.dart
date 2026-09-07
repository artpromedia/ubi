/// Strict JSON readers.
///
/// City config drives money, policy and safety copy, so a field that is absent
/// or the wrong type is a hard failure, never a default. Guessing a currency, a
/// fraction digit count or an emergency number would break CLAUDE.md rule 6.
library;

/// Thrown when a config document does not match the contract.
///
/// Carries the field path only — never the value — so it is safe to log.
class ConfigFormatException implements Exception {
  const ConfigFormatException(this.field, this.expected);

  /// Dotted path of the offending field, e.g. `fares.go.baseMinor`.
  final String field;

  /// What the contract requires there, e.g. `int`.
  final String expected;

  @override
  String toString() => 'ConfigFormatException: $field must be $expected';
}

String readString(Map<String, dynamic> json, String field) {
  final Object? value = json[field];
  if (value is String && value.isNotEmpty) {
    return value;
  }
  throw ConfigFormatException(field, 'a non-empty string');
}

int readInt(Map<String, dynamic> json, String field) {
  final Object? value = json[field];
  if (value is int) {
    return value;
  }
  if (value is num && value == value.roundToDouble()) {
    return value.toInt();
  }
  throw ConfigFormatException(field, 'an integer');
}

double readDouble(Map<String, dynamic> json, String field) {
  final Object? value = json[field];
  if (value is num) {
    return value.toDouble();
  }
  throw ConfigFormatException(field, 'a number');
}

bool readBool(Map<String, dynamic> json, String field) {
  final Object? value = json[field];
  if (value is bool) {
    return value;
  }
  throw ConfigFormatException(field, 'a boolean');
}

Map<String, dynamic> readObject(Map<String, dynamic> json, String field) {
  final Object? value = json[field];
  if (value is Map<String, dynamic>) {
    return value;
  }
  throw ConfigFormatException(field, 'an object');
}

List<dynamic> readArray(Map<String, dynamic> json, String field) {
  final Object? value = json[field];
  if (value is List) {
    return value;
  }
  throw ConfigFormatException(field, 'an array');
}

/// Reads an array of objects and maps each one, prefixing any nested failure
/// with the array index so the message points at the exact element.
List<T> readObjectArray<T>(
  Map<String, dynamic> json,
  String field,
  T Function(Map<String, dynamic> element) parse,
) {
  final List<dynamic> raw = readArray(json, field);
  final List<T> out = <T>[];
  for (int i = 0; i < raw.length; i++) {
    final Object? element = raw[i];
    if (element is! Map<String, dynamic>) {
      throw ConfigFormatException('$field[$i]', 'an object');
    }
    out.add(parse(element));
  }
  return out;
}

List<String> readStringArray(Map<String, dynamic> json, String field) {
  final List<dynamic> raw = readArray(json, field);
  final List<String> out = <String>[];
  for (int i = 0; i < raw.length; i++) {
    final Object? element = raw[i];
    if (element is! String || element.isEmpty) {
      throw ConfigFormatException('$field[$i]', 'a non-empty string');
    }
    out.add(element);
  }
  return out;
}

/// Reads a `Record<string, T>` — used for fare tables, taxes and airport doors.
Map<String, T> readObjectMap<T>(
  Map<String, dynamic> json,
  String field,
  T Function(String key, Object? value) parse,
) {
  final Map<String, dynamic> raw = readObject(json, field);
  final Map<String, T> out = <String, T>{};
  raw.forEach((String key, Object? value) {
    out[key] = parse(key, value);
  });
  return out;
}
