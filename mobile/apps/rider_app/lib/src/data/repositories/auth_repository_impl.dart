import 'package:ubi_api_client/ubi_api_client.dart';
import 'package:ubi_core/ubi_core.dart';
import 'package:ubi_storage/ubi_storage.dart' as storage;

/// Implementation of AuthRepository using API client
class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl({
    required AuthService authService,
    required storage.TokenStorage tokenStorage,
  })  : _authService = authService,
        _tokenStorage = tokenStorage;

  final AuthService _authService;
  final storage.TokenStorage _tokenStorage;

  @override
  Future<Result<void>> requestOtp({
    required String phoneNumber,
    required String countryCode,
  }) async {
    try {
      await _authService.requestOtp(
        PhoneLoginRequestDto(
          phoneNumber: phoneNumber,
          countryCode: countryCode,
        ),
      );
      return const Result.success(null);
    } catch (e) {
      return Result.failure(Failure.unknown(message: e.toString()));
    }
  }

  @override
  Future<Result<User>> verifyOtp({
    required String phoneNumber,
    required String countryCode,
    required String code,
  }) async {
    try {
      final response = await _authService.verifyOtp(
        VerifyOtpRequestDto(
          phoneNumber: phoneNumber,
          countryCode: countryCode,
          otp: code,
        ),
      );
      
      // Save tokens
      await _tokenStorage.saveTokens(
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
      );
      
      return Result.success(_mapAuthUser(response.user));
    } catch (e) {
      return Result.failure(Failure.authentication(message: e.toString()));
    }
  }

  @override
  Future<Result<void>> resendOtp({
    required String phoneNumber,
    required String countryCode,
  }) async {
    try {
      await _authService.resendOtp(
        ResendOtpRequestDto(
          phoneNumber: phoneNumber,
          countryCode: countryCode,
        ),
      );
      return const Result.success(null);
    } catch (e) {
      return Result.failure(Failure.unknown(message: e.toString()));
    }
  }

  @override
  Future<Result<User>> register({
    required String phoneNumber,
    required String countryCode,
    required String firstName,
    required String lastName,
    String? email,
  }) async {
    try {
      final response = await _authService.register(
        RegisterRequestDto(
          phoneNumber: phoneNumber,
          countryCode: countryCode,
          firstName: firstName,
          lastName: lastName,
          email: email,
        ),
      );
      
      await _tokenStorage.saveTokens(
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
      );
      
      return Result.success(_mapAuthUser(response.user));
    } catch (e) {
      return Result.failure(Failure.unknown(message: e.toString()));
    }
  }

  @override
  Future<Result<User>> signInWithGoogle(String idToken) async {
    try {
      final response = await _authService.signInWithGoogle(
        GoogleAuthRequestDto(idToken: idToken),
      );
      
      await _tokenStorage.saveTokens(
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
      );
      
      return Result.success(_mapAuthUser(response.user));
    } catch (e) {
      return Result.failure(Failure.authentication(message: e.toString()));
    }
  }

  @override
  Future<Result<User>> signInWithApple({
    required String identityToken,
    required String authorizationCode,
    String? firstName,
    String? lastName,
  }) async {
    try {
      final fullName = firstName != null && lastName != null 
          ? '$firstName $lastName' 
          : firstName ?? lastName;
      final response = await _authService.signInWithApple(
        AppleAuthRequestDto(
          identityToken: identityToken,
          authorizationCode: authorizationCode,
          fullName: fullName,
        ),
      );
      
      await _tokenStorage.saveTokens(
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
      );
      
      return Result.success(_mapAuthUser(response.user));
    } catch (e) {
      return Result.failure(Failure.authentication(message: e.toString()));
    }
  }

  @override
  Future<Result<void>> logout() async {
    try {
      await _authService.logout();
      await _tokenStorage.clearTokens();
      return const Result.success(null);
    } catch (e) {
      // Still clear local tokens even if remote logout fails
      await _tokenStorage.clearTokens();
      return const Result.success(null);
    }
  }

  @override
  Future<Result<User?>> getCurrentUser() async {
    try {
      final hasToken = await _tokenStorage.isLoggedIn();
      if (!hasToken) {
        return const Result.success(null);
      }
      
      // TODO: Add getCurrentUser endpoint to AuthService if needed
      // For now, return cached user from tokens
      return const Result.success(null);
    } catch (e) {
      return Result.failure(Failure.authentication(message: e.toString()));
    }
  }

  @override
  Future<Result<bool>> isAuthenticated() async {
    try {
      final hasToken = await _tokenStorage.isLoggedIn();
      return Result.success(hasToken);
    } catch (e) {
      return const Result.success(false);
    }
  }

  @override
  Future<Result<void>> refreshToken() async {
    try {
      final refreshToken = await _tokenStorage.getRefreshToken();
      if (refreshToken == null) {
        return Result.failure(const Failure.authentication(message: 'No refresh token'));
      }
      
      final response = await _authService.refreshToken(
        RefreshTokenRequestDto(refreshToken: refreshToken),
      );
      
      await _tokenStorage.saveTokens(
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
      );
      
      return const Result.success(null);
    } catch (e) {
      return Result.failure(Failure.authentication(message: e.toString()));
    }
  }

  @override
  Future<Result<String?>> getAuthToken() async {
    try {
      final token = await _tokenStorage.getAccessToken();
      return Result.success(token);
    } catch (e) {
      return Result.failure(Failure.cache(message: e.toString()));
    }
  }

  @override
  Stream<User?> authStateChanges() {
    // This would typically connect to a stream from the auth service
    // For now, return an empty stream
    return const Stream.empty();
  }

  @override
  Future<Result<void>> deleteAccount() async {
    try {
      // TODO: Add deleteAccount endpoint to AuthService if needed
      await _tokenStorage.clearTokens();
      return const Result.success(null);
    } catch (e) {
      return Result.failure(Failure.unknown(message: e.toString()));
    }
  }

  /// Map API auth user to domain User entity
  User _mapAuthUser(AuthUserDto apiUser) {
    return User(
      id: apiUser.id,
      phoneNumber: apiUser.phoneNumber,
      firstName: apiUser.firstName ?? '',
      lastName: apiUser.lastName ?? '',
      email: apiUser.email,
      profileImageUrl: apiUser.profileImageUrl,
      createdAt: apiUser.createdAt ?? DateTime.now(),
    );
  }
}
