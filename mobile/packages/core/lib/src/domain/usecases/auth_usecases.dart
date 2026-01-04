/// Authentication Use Cases
///
/// Business logic for authentication operations.
library;

import '../../../core.dart';

/// Request OTP for phone number
class RequestOtpUseCase implements UseCase<void, RequestOtpParams> {
  const RequestOtpUseCase(this.repository);

  final AuthRepository repository;

  @override
  Future<Result<void>> call(RequestOtpParams params) {
    return repository.requestOtp(
      phoneNumber: params.phoneNumber,
      countryCode: params.countryCode,
    );
  }
}

class RequestOtpParams {
  const RequestOtpParams({
    required this.phoneNumber,
    required this.countryCode,
  });

  final String phoneNumber;
  final String countryCode;
}

/// Verify OTP code
class VerifyOtpUseCase implements UseCase<User, VerifyOtpParams> {
  const VerifyOtpUseCase(this.repository);

  final AuthRepository repository;

  @override
  Future<Result<User>> call(VerifyOtpParams params) {
    return repository.verifyOtp(
      phoneNumber: params.phoneNumber,
      countryCode: params.countryCode,
      code: params.code,
    );
  }
}

class VerifyOtpParams {
  const VerifyOtpParams({
    required this.phoneNumber,
    required this.countryCode,
    required this.code,
  });

  final String phoneNumber;
  final String countryCode;
  final String code;
}

/// Register new user
class RegisterUserUseCase implements UseCase<User, RegisterUserParams> {
  const RegisterUserUseCase(this.repository);

  final AuthRepository repository;

  @override
  Future<Result<User>> call(RegisterUserParams params) {
    return repository.register(
      phoneNumber: params.phoneNumber,
      countryCode: params.countryCode,
      firstName: params.firstName,
      lastName: params.lastName,
      email: params.email,
    );
  }
}

class RegisterUserParams {
  const RegisterUserParams({
    required this.phoneNumber,
    required this.countryCode,
    required this.firstName,
    required this.lastName,
    this.email,
  });

  final String phoneNumber;
  final String countryCode;
  final String firstName;
  final String lastName;
  final String? email;
}

/// Sign in with Google
class SignInWithGoogleUseCase implements UseCase<User, String> {
  const SignInWithGoogleUseCase(this.repository);

  final AuthRepository repository;

  @override
  Future<Result<User>> call(String idToken) {
    return repository.signInWithGoogle(idToken);
  }
}

/// Sign in with Apple
class SignInWithAppleUseCase implements UseCase<User, SignInWithAppleParams> {
  const SignInWithAppleUseCase(this.repository);

  final AuthRepository repository;

  @override
  Future<Result<User>> call(SignInWithAppleParams params) {
    return repository.signInWithApple(
      identityToken: params.identityToken,
      authorizationCode: params.authorizationCode,
      firstName: params.firstName,
      lastName: params.lastName,
    );
  }
}

class SignInWithAppleParams {
  const SignInWithAppleParams({
    required this.identityToken,
    required this.authorizationCode,
    this.firstName,
    this.lastName,
  });

  final String identityToken;
  final String authorizationCode;
  final String? firstName;
  final String? lastName;
}

/// Log out current user
class LogoutUseCase implements UseCase<void, NoParams> {
  const LogoutUseCase(this.repository);

  final AuthRepository repository;

  @override
  Future<Result<void>> call(NoParams params) {
    return repository.logout();
  }
}

/// Check if user is authenticated
class CheckAuthStatusUseCase implements UseCase<User?, NoParams> {
  const CheckAuthStatusUseCase(this.repository);

  final AuthRepository repository;

  @override
  Future<Result<User?>> call(NoParams params) {
    return repository.getCurrentUser();
  }
}

/// Stream auth state changes
class WatchAuthStateUseCase implements StreamUseCase<User?, NoParams> {
  const WatchAuthStateUseCase(this.repository);

  final AuthRepository repository;

  @override
  Stream<User?> call(NoParams params) {
    return repository.authStateChanges();
  }
}

/// Refresh auth tokens
class RefreshTokenUseCase implements UseCase<void, NoParams> {
  const RefreshTokenUseCase(this.repository);

  final AuthRepository repository;

  @override
  Future<Result<void>> call(NoParams params) {
    return repository.refreshToken();
  }
}
