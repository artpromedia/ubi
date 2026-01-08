part of 'auth_bloc.dart';

/// Auth events
abstract class AuthEvent extends Equatable {
  const AuthEvent();

  @override
  List<Object?> get props => [];
}

/// Check if user is authenticated on app start
class AuthCheckRequested extends AuthEvent {
  const AuthCheckRequested();
}

/// Login with phone number
class AuthPhoneLoginRequested extends AuthEvent {
  const AuthPhoneLoginRequested({
    required this.phoneNumber,
    required this.countryCode,
  });

  final String phoneNumber;
  final String countryCode;

  @override
  List<Object?> get props => [phoneNumber, countryCode];
}

/// Verify OTP code
class AuthOtpVerified extends AuthEvent {
  const AuthOtpVerified({
    required this.phoneNumber,
    required this.countryCode,
    required this.code,
  });

  final String phoneNumber;
  final String countryCode;
  final String code;

  @override
  List<Object?> get props => [phoneNumber, countryCode, code];
}

/// Register new user
class AuthRegisterRequested extends AuthEvent {
  const AuthRegisterRequested({
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

  @override
  List<Object?> get props => [phoneNumber, countryCode, firstName, lastName, email];
}

/// Login with Google
class AuthGoogleLoginRequested extends AuthEvent {
  const AuthGoogleLoginRequested();
}

/// Login with Apple
class AuthAppleLoginRequested extends AuthEvent {
  const AuthAppleLoginRequested();
}

/// Login with biometrics (Face ID, Touch ID, Fingerprint)
class AuthBiometricLoginRequested extends AuthEvent {
  const AuthBiometricLoginRequested();
}

/// Enable biometric authentication for the current user
class AuthEnableBiometricRequested extends AuthEvent {
  const AuthEnableBiometricRequested();
}

/// Disable biometric authentication
class AuthDisableBiometricRequested extends AuthEvent {
  const AuthDisableBiometricRequested();
}

/// Skip biometric setup prompt
class AuthSkipBiometricSetup extends AuthEvent {
  const AuthSkipBiometricSetup();
}

/// Check biometric availability and enrollment status
class AuthCheckBiometricStatus extends AuthEvent {
  const AuthCheckBiometricStatus();
}

/// Logout
class AuthLogoutRequested extends AuthEvent {
  const AuthLogoutRequested();
}

/// User updated (e.g., profile change)
class AuthUserUpdated extends AuthEvent {
  const AuthUserUpdated(this.user);

  final User user;

  @override
  List<Object?> get props => [user];
}
