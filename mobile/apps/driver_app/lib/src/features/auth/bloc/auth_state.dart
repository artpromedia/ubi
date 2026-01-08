part of 'auth_bloc.dart';

/// Auth states
abstract class AuthState extends Equatable {
  const AuthState();

  @override
  List<Object?> get props => [];
}

/// Initial state
class AuthInitial extends AuthState {
  const AuthInitial();
}

/// Checking auth status
class AuthLoading extends AuthState {
  const AuthLoading();
}

/// User is authenticated
class AuthAuthenticated extends AuthState {
  const AuthAuthenticated(
    this.user, {
    this.showBiometricPrompt = false,
    this.isFirstLogin = false,
  });

  final User user;
  final bool showBiometricPrompt;
  final bool isFirstLogin;

  @override
  List<Object?> get props => [user, showBiometricPrompt, isFirstLogin];

  AuthAuthenticated copyWith({
    User? user,
    bool? showBiometricPrompt,
    bool? isFirstLogin,
  }) {
    return AuthAuthenticated(
      user ?? this.user,
      showBiometricPrompt: showBiometricPrompt ?? this.showBiometricPrompt,
      isFirstLogin: isFirstLogin ?? this.isFirstLogin,
    );
  }
}

/// User is not authenticated
class AuthUnauthenticated extends AuthState {
  const AuthUnauthenticated({
    this.biometricAvailable = false,
    this.biometricType,
  });

  final bool biometricAvailable;
  final String? biometricType;

  @override
  List<Object?> get props => [biometricAvailable, biometricType];
}

/// OTP sent, awaiting verification
class AuthOtpSent extends AuthState {
  const AuthOtpSent({
    required this.phoneNumber,
    required this.countryCode,
  });

  final String phoneNumber;
  final String countryCode;

  @override
  List<Object?> get props => [phoneNumber, countryCode];
}

/// OTP verified, but user needs to register
class AuthNeedsRegistration extends AuthState {
  const AuthNeedsRegistration({
    required this.phoneNumber,
    required this.countryCode,
  });

  final String phoneNumber;
  final String countryCode;

  @override
  List<Object?> get props => [phoneNumber, countryCode];
}

/// Biometric authentication in progress
class AuthBiometricInProgress extends AuthState {
  const AuthBiometricInProgress();
}

/// Biometric authentication failed
class AuthBiometricFailed extends AuthState {
  const AuthBiometricFailed({
    required this.message,
    this.canRetry = true,
  });

  final String message;
  final bool canRetry;

  @override
  List<Object?> get props => [message, canRetry];
}

/// Biometric setup result
class AuthBiometricSetupResult extends AuthState {
  const AuthBiometricSetupResult({
    required this.success,
    required this.user,
    this.message,
  });

  final bool success;
  final User user;
  final String? message;

  @override
  List<Object?> get props => [success, user, message];
}

/// Auth error occurred
class AuthError extends AuthState {
  const AuthError(this.message);

  final String message;

  @override
  List<Object?> get props => [message];
}
