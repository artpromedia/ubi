import '../../core/result/result.dart';
import '../entities/user.dart';

/// Authentication repository interface.
///
/// The contract is driven by the presentation layer (auth BLoC) and the
/// authentication use cases: OTP request/verify, registration, social
/// sign-in, and session management. Implementations live in the data layer.
abstract class AuthRepository {
  /// Request an OTP challenge for the given phone number.
  Future<Result<void>> requestOtp({
    required String phoneNumber,
    required String countryCode,
  });

  /// Verify an OTP code and return the authenticated user.
  Future<Result<User>> verifyOtp({
    required String phoneNumber,
    required String countryCode,
    required String code,
  });

  /// Register a new user after their phone number has been verified.
  Future<Result<User>> register({
    required String phoneNumber,
    required String countryCode,
    required String firstName,
    required String lastName,
    String? email,
  });

  /// Sign in with a Google ID token.
  Future<Result<User>> signInWithGoogle(String idToken);

  /// Sign in with Apple credentials.
  Future<Result<User>> signInWithApple({
    required String identityToken,
    required String authorizationCode,
    String? firstName,
    String? lastName,
  });

  /// Log out the current user and clear the session.
  Future<Result<void>> logout();

  /// Get the current authenticated user, or null when signed out.
  Future<Result<User?>> getCurrentUser();

  /// Refresh the access token, returning the new token.
  Future<Result<String>> refreshToken();

  /// Stream of the authenticated user; emits null when signed out.
  Stream<User?> authStateChanges();
}
