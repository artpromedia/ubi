/// Token Storage
///
/// Manages authentication tokens securely.
library;

import 'dart:convert';

import 'package:injectable/injectable.dart';

import 'secure_storage.dart';

/// Keys for token storage
abstract class TokenStorageKeys {
  static const accessToken = 'access_token';
  static const refreshToken = 'refresh_token';
  static const tokenExpiry = 'token_expiry';
  static const userId = 'user_id';
}

/// Token data model
class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    this.expiresAt,
    this.userId,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime? expiresAt;
  final String? userId;

  /// Check if token is expired (with 5 minute buffer)
  bool get isExpired {
    if (expiresAt == null) return false;
    return DateTime.now().isAfter(expiresAt!.subtract(const Duration(minutes: 5)));
  }

  /// Create from JSON
  factory AuthTokens.fromJson(Map<String, dynamic> json) {
    return AuthTokens(
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
      expiresAt: json['expiresAt'] != null
          ? DateTime.parse(json['expiresAt'] as String)
          : null,
      userId: json['userId'] as String?,
    );
  }

  /// Convert to JSON
  Map<String, dynamic> toJson() {
    return {
      'accessToken': accessToken,
      'refreshToken': refreshToken,
      'expiresAt': expiresAt?.toIso8601String(),
      'userId': userId,
    };
  }
}

/// Secure storage specifically for authentication tokens
@lazySingleton
class TokenStorage {
  TokenStorage(this._secureStorage);

  final SecureStorage _secureStorage;

  // In-memory cache for quick access
  AuthTokens? _cachedTokens;

  /// Get current auth tokens
  Future<AuthTokens?> getTokens() async {
    // Return cached if available
    if (_cachedTokens != null) {
      return _cachedTokens;
    }

    // Load from secure storage
    final accessToken = await _secureStorage.read(TokenStorageKeys.accessToken);
    final refreshToken = await _secureStorage.read(TokenStorageKeys.refreshToken);

    if (accessToken == null || refreshToken == null) {
      return null;
    }

    final expiryStr = await _secureStorage.read(TokenStorageKeys.tokenExpiry);
    final userId = await _secureStorage.read(TokenStorageKeys.userId);

    _cachedTokens = AuthTokens(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: expiryStr != null ? DateTime.tryParse(expiryStr) : null,
      userId: userId,
    );

    return _cachedTokens;
  }

  /// Get access token only
  Future<String?> getAccessToken() async {
    final tokens = await getTokens();
    return tokens?.accessToken;
  }

  /// Get refresh token only
  Future<String?> getRefreshToken() async {
    final tokens = await getTokens();
    return tokens?.refreshToken;
  }

  /// Save auth tokens
  Future<void> saveTokens(AuthTokens tokens) async {
    await Future.wait([
      _secureStorage.write(TokenStorageKeys.accessToken, tokens.accessToken),
      _secureStorage.write(TokenStorageKeys.refreshToken, tokens.refreshToken),
      if (tokens.expiresAt != null)
        _secureStorage.write(
          TokenStorageKeys.tokenExpiry,
          tokens.expiresAt!.toIso8601String(),
        ),
      if (tokens.userId != null)
        _secureStorage.write(TokenStorageKeys.userId, tokens.userId!),
    ]);

    _cachedTokens = tokens;
  }

  /// Update only the access token (after refresh)
  Future<void> updateAccessToken(String accessToken, {DateTime? expiresAt}) async {
    await _secureStorage.write(TokenStorageKeys.accessToken, accessToken);

    if (expiresAt != null) {
      await _secureStorage.write(
        TokenStorageKeys.tokenExpiry,
        expiresAt.toIso8601String(),
      );
    }

    // Update cache
    if (_cachedTokens != null) {
      _cachedTokens = AuthTokens(
        accessToken: accessToken,
        refreshToken: _cachedTokens!.refreshToken,
        expiresAt: expiresAt ?? _cachedTokens!.expiresAt,
        userId: _cachedTokens!.userId,
      );
    }
  }

  /// Clear all tokens (logout)
  Future<void> clearTokens() async {
    await Future.wait([
      _secureStorage.delete(TokenStorageKeys.accessToken),
      _secureStorage.delete(TokenStorageKeys.refreshToken),
      _secureStorage.delete(TokenStorageKeys.tokenExpiry),
      _secureStorage.delete(TokenStorageKeys.userId),
    ]);

    _cachedTokens = null;
  }

  /// Check if user is logged in
  Future<bool> isLoggedIn() async {
    final tokens = await getTokens();
    return tokens != null && tokens.accessToken.isNotEmpty;
  }

  /// Check if tokens need refresh
  Future<bool> needsRefresh() async {
    final tokens = await getTokens();
    if (tokens == null) return false;
    return tokens.isExpired;
  }

  /// Get user ID
  Future<String?> getUserId() async {
    return await _secureStorage.read(TokenStorageKeys.userId);
  }
}
