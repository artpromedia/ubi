/// Secure Storage
///
/// Platform-secure key-value storage for sensitive data.
library;

import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:injectable/injectable.dart';

/// Secure storage for sensitive data (tokens, credentials, etc.)
@lazySingleton
class SecureStorage {
  SecureStorage({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(
                encryptedSharedPreferences: true,
              ),
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
              ),
            );

  final FlutterSecureStorage _storage;

  /// Read a string value
  Future<String?> read(String key) async {
    try {
      return await _storage.read(key: key);
    } catch (e) {
      // Handle potential keychain errors gracefully
      return null;
    }
  }

  /// Write a string value
  Future<void> write(String key, String value) async {
    await _storage.write(key: key, value: value);
  }

  /// Delete a value
  Future<void> delete(String key) async {
    await _storage.delete(key: key);
  }

  /// Delete all values
  Future<void> deleteAll() async {
    await _storage.deleteAll();
  }

  /// Check if a key exists
  Future<bool> containsKey(String key) async {
    return await _storage.containsKey(key: key);
  }

  /// Read all key-value pairs
  Future<Map<String, String>> readAll() async {
    return await _storage.readAll();
  }

  /// Read a JSON object
  Future<Map<String, dynamic>?> readJson(String key) async {
    final value = await read(key);
    if (value == null) return null;
    try {
      return json.decode(value) as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }

  /// Write a JSON object
  Future<void> writeJson(String key, Map<String, dynamic> value) async {
    await write(key, json.encode(value));
  }

  /// Read a list of strings
  Future<List<String>?> readStringList(String key) async {
    final value = await read(key);
    if (value == null) return null;
    try {
      final list = json.decode(value) as List<dynamic>;
      return list.cast<String>();
    } catch (e) {
      return null;
    }
  }

  /// Write a list of strings
  Future<void> writeStringList(String key, List<String> value) async {
    await write(key, json.encode(value));
  }
}
