import '../../core/result/result.dart';
import '../entities/user.dart';

/// Authentication repository interface
abstract class AuthRepository {
  /// Request OTP for phone number authentication
  Future<Result<void>> requestOtp({
    required String phoneNumber,
    required String countryCode,
  });

  /// Verify OTP and authenticate user
  Future<Result<User>> verifyOtp({
    required String phoneNumber,
    required String countryCode,
    required String code,
  });

  /// Resend OTP to phone number
  Future<Result<void>> resendOtp({
    required String phoneNumber,
    required String countryCode,
  });

  /// Register new user after OTP verification
  Future<Result<User>> register({
    required String phoneNumber,
    required String countryCode,
    required String firstName,
    required String lastName,
    String? email,
  });

  /// Sign in with Google OAuth
  Future<Result<User>> signInWithGoogle(String idToken);

  /// Sign in with Apple Sign-In
  Future<Result<User>> signInWithApple({
    required String identityToken,
    required String authorizationCode,
    String? firstName,
    String? lastName,
  });

  /// Log out current user
  Future<Result<void>> logout();

  /// Get current authenticated user
  Future<Result<User?>> getCurrentUser();

  /// Check if user is currently authenticated
  Future<Result<bool>> isAuthenticated();

  /// Refresh authentication tokens
  Future<Result<void>> refreshToken();

  /// Get current access token
  Future<Result<String?>> getAuthToken();

  /// Stream of authentication state changes
  Stream<User?> authStateChanges();

  /// Delete user account
  Future<Result<void>> deleteAccount();
}

/// Authentication result
class AuthResult {
  final User user;
  final String accessToken;
  final String refreshToken;
  final bool isNewUser;

  const AuthResult({
    required this.user,
    required this.accessToken,
    required this.refreshToken,
    this.isNewUser = false,
  });
}

/// Authentication state
enum AuthState {
  unknown,
  authenticated,
  unauthenticated,
}

