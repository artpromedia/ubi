import '../../core/result/result.dart';
import '../entities/user.dart';

/// Authentication repository interface
abstract class AuthRepository {
  /// Sign in with phone number (request OTP)
  Future<Result<void>> signInWithPhone(String phoneNumber);

  /// Verify OTP
  Future<Result<AuthResult>> verifyOtp(String phoneNumber, String otp);

  /// Resend OTP
  Future<Result<void>> resendOtp(String phoneNumber);

  /// Sign in with Google
  Future<Result<AuthResult>> signInWithGoogle();

  /// Sign in with Apple
  Future<Result<AuthResult>> signInWithApple();

  /// Sign out
  Future<Result<void>> signOut();

  /// Get current user
  Future<Result<User?>> getCurrentUser();

  /// Check if user is authenticated
  Future<Result<bool>> isAuthenticated();

  /// Refresh auth token
  Future<Result<String>> refreshToken();

  /// Get current auth token
  Future<Result<String?>> getAuthToken();

  /// Stream of auth state changes
  Stream<AuthState> get authStateChanges;

  /// Delete account
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

