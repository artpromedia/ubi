/// Auth Service
///
/// API service for authentication endpoints.
library;

import 'package:dio/dio.dart';
import 'package:json_annotation/json_annotation.dart';
import 'package:retrofit/retrofit.dart';

part 'auth_service.g.dart';

/// Auth API Service
///
/// Handles all authentication-related API calls including:
/// - Phone number authentication (OTP)
/// - Social login (Google, Apple)
/// - Token refresh
/// - Logout
@RestApi()
abstract class AuthService {
  factory AuthService(Dio dio, {String baseUrl}) = _AuthService;

  /// Request OTP for phone authentication
  @POST('/auth/login')
  Future<OtpResponseDto> requestOtp(@Body() PhoneLoginRequestDto request);

  /// Verify OTP and get auth tokens
  @POST('/auth/verify-otp')
  Future<AuthResponseDto> verifyOtp(@Body() VerifyOtpRequestDto request);

  /// Resend OTP
  @POST('/auth/resend-otp')
  Future<OtpResponseDto> resendOtp(@Body() ResendOtpRequestDto request);

  /// Register new user
  @POST('/auth/register')
  Future<AuthResponseDto> register(@Body() RegisterRequestDto request);

  /// Sign in with Google
  @POST('/auth/google')
  Future<AuthResponseDto> signInWithGoogle(@Body() GoogleAuthRequestDto request);

  /// Sign in with Apple
  @POST('/auth/apple')
  Future<AuthResponseDto> signInWithApple(@Body() AppleAuthRequestDto request);

  /// Refresh access token
  @POST('/auth/refresh')
  Future<AuthResponseDto> refreshToken(@Body() RefreshTokenRequestDto request);

  /// Logout
  @POST('/auth/logout')
  Future<void> logout();

  /// Request password reset (for email-based auth)
  @POST('/auth/forgot-password')
  Future<void> forgotPassword(@Body() ForgotPasswordRequestDto request);

  /// Reset password
  @POST('/auth/reset-password')
  Future<void> resetPassword(@Body() ResetPasswordRequestDto request);
}

// === Request DTOs ===

@JsonSerializable()
class PhoneLoginRequestDto {
  const PhoneLoginRequestDto({
    required this.phoneNumber,
    required this.countryCode,
  });

  factory PhoneLoginRequestDto.fromJson(Map<String, dynamic> json) =>
      _$PhoneLoginRequestDtoFromJson(json);

  final String phoneNumber;
  final String countryCode;

  Map<String, dynamic> toJson() => _$PhoneLoginRequestDtoToJson(this);
}

@JsonSerializable()
class VerifyOtpRequestDto {
  const VerifyOtpRequestDto({
    required this.phoneNumber,
    required this.countryCode,
    required this.otp,
    this.deviceId,
    this.deviceName,
    this.fcmToken,
  });

  factory VerifyOtpRequestDto.fromJson(Map<String, dynamic> json) =>
      _$VerifyOtpRequestDtoFromJson(json);

  final String phoneNumber;
  final String countryCode;
  final String otp;
  final String? deviceId;
  final String? deviceName;
  final String? fcmToken;

  Map<String, dynamic> toJson() => _$VerifyOtpRequestDtoToJson(this);
}

@JsonSerializable()
class ResendOtpRequestDto {
  const ResendOtpRequestDto({
    required this.phoneNumber,
    required this.countryCode,
  });

  factory ResendOtpRequestDto.fromJson(Map<String, dynamic> json) =>
      _$ResendOtpRequestDtoFromJson(json);

  final String phoneNumber;
  final String countryCode;

  Map<String, dynamic> toJson() => _$ResendOtpRequestDtoToJson(this);
}

@JsonSerializable()
class RegisterRequestDto {
  const RegisterRequestDto({
    required this.phoneNumber,
    required this.countryCode,
    required this.firstName,
    required this.lastName,
    this.email,
    this.referralCode,
  });

  factory RegisterRequestDto.fromJson(Map<String, dynamic> json) =>
      _$RegisterRequestDtoFromJson(json);

  final String phoneNumber;
  final String countryCode;
  final String firstName;
  final String lastName;
  final String? email;
  final String? referralCode;

  Map<String, dynamic> toJson() => _$RegisterRequestDtoToJson(this);
}

@JsonSerializable()
class GoogleAuthRequestDto {
  const GoogleAuthRequestDto({
    required this.idToken,
    this.deviceId,
    this.deviceName,
    this.fcmToken,
  });

  factory GoogleAuthRequestDto.fromJson(Map<String, dynamic> json) =>
      _$GoogleAuthRequestDtoFromJson(json);

  final String idToken;
  final String? deviceId;
  final String? deviceName;
  final String? fcmToken;

  Map<String, dynamic> toJson() => _$GoogleAuthRequestDtoToJson(this);
}

@JsonSerializable()
class AppleAuthRequestDto {
  const AppleAuthRequestDto({
    required this.identityToken,
    required this.authorizationCode,
    this.fullName,
    this.email,
    this.deviceId,
    this.deviceName,
    this.fcmToken,
  });

  factory AppleAuthRequestDto.fromJson(Map<String, dynamic> json) =>
      _$AppleAuthRequestDtoFromJson(json);

  final String identityToken;
  final String authorizationCode;
  final String? fullName;
  final String? email;
  final String? deviceId;
  final String? deviceName;
  final String? fcmToken;

  Map<String, dynamic> toJson() => _$AppleAuthRequestDtoToJson(this);
}

@JsonSerializable()
class RefreshTokenRequestDto {
  const RefreshTokenRequestDto({required this.refreshToken});

  factory RefreshTokenRequestDto.fromJson(Map<String, dynamic> json) =>
      _$RefreshTokenRequestDtoFromJson(json);

  final String refreshToken;

  Map<String, dynamic> toJson() => _$RefreshTokenRequestDtoToJson(this);
}

@JsonSerializable()
class ForgotPasswordRequestDto {
  const ForgotPasswordRequestDto({required this.email});

  factory ForgotPasswordRequestDto.fromJson(Map<String, dynamic> json) =>
      _$ForgotPasswordRequestDtoFromJson(json);

  final String email;

  Map<String, dynamic> toJson() => _$ForgotPasswordRequestDtoToJson(this);
}

@JsonSerializable()
class ResetPasswordRequestDto {
  const ResetPasswordRequestDto({
    required this.token,
    required this.newPassword,
  });

  factory ResetPasswordRequestDto.fromJson(Map<String, dynamic> json) =>
      _$ResetPasswordRequestDtoFromJson(json);

  final String token;
  final String newPassword;

  Map<String, dynamic> toJson() => _$ResetPasswordRequestDtoToJson(this);
}

// === Response DTOs ===

@JsonSerializable()
class OtpResponseDto {
  const OtpResponseDto({
    required this.message,
    required this.expiresAt,
    this.isNewUser,
  });

  factory OtpResponseDto.fromJson(Map<String, dynamic> json) =>
      _$OtpResponseDtoFromJson(json);

  final String message;
  final DateTime expiresAt;
  final bool? isNewUser;

  Map<String, dynamic> toJson() => _$OtpResponseDtoToJson(this);
}

@JsonSerializable()
class AuthResponseDto {
  const AuthResponseDto({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
    required this.user,
    this.isNewUser,
  });

  factory AuthResponseDto.fromJson(Map<String, dynamic> json) =>
      _$AuthResponseDtoFromJson(json);

  final String accessToken;
  final String refreshToken;
  final int expiresIn;
  final AuthUserDto user;
  final bool? isNewUser;

  Map<String, dynamic> toJson() => _$AuthResponseDtoToJson(this);
}

@JsonSerializable()
class AuthUserDto {
  const AuthUserDto({
    required this.id,
    required this.phoneNumber,
    this.email,
    this.firstName,
    this.lastName,
    this.profileImageUrl,
    this.role,
    this.isVerified,
    this.createdAt,
  });

  factory AuthUserDto.fromJson(Map<String, dynamic> json) =>
      _$AuthUserDtoFromJson(json);

  final String id;
  final String phoneNumber;
  final String? email;
  final String? firstName;
  final String? lastName;
  final String? profileImageUrl;
  final String? role;
  final bool? isVerified;
  final DateTime? createdAt;

  Map<String, dynamic> toJson() => _$AuthUserDtoToJson(this);
}
