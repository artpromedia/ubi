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
  const AuthAuthenticated(this.user);

  final User user;

  @override
  List<Object?> get props => [user];
}

/// User is not authenticated
class AuthUnauthenticated extends AuthState {
  const AuthUnauthenticated();
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

/// Auth error occurred
class AuthError extends AuthState {
  const AuthError(this.message);

  final String message;

  @override
  List<Object?> get props => [message];
}
