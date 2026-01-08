import 'package:equatable/equatable.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:injectable/injectable.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:ubi_core/ubi_core.dart';
import 'package:ubi_storage/ubi_storage.dart';

import '../../../core/services/biometric_auth_service.dart';
import '../data/repositories/biometric_repository.dart';

part 'auth_event.dart';
part 'auth_state.dart';

/// Authentication BLoC with demo mode support
/// In debug mode, if API calls fail, demo mode allows testing without backend
@lazySingleton
class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc({
    AuthRepository? authRepository,
    TokenStorage? tokenStorage,
    GoogleSignIn? googleSignIn,
    bool? enableDemoMode,
    BiometricAuthService? biometricAuthService,
    BiometricRepository? biometricRepository,
  })  : _authRepository = authRepository,
        _tokenStorage = tokenStorage,
        _enableDemoMode = enableDemoMode ?? kDebugMode,
        _googleSignIn = googleSignIn ?? GoogleSignIn(scopes: ['email']),
        _biometricAuthService = biometricAuthService ?? BiometricAuthService(),
        _biometricRepository = biometricRepository,
        super(const AuthInitial()) {
    on<AuthCheckRequested>(_onCheckRequested);
    on<AuthPhoneLoginRequested>(_onPhoneLoginRequested);
    on<AuthOtpVerified>(_onOtpVerified);
    on<AuthRegisterRequested>(_onRegisterRequested);
    on<AuthGoogleLoginRequested>(_onGoogleLoginRequested);
    on<AuthAppleLoginRequested>(_onAppleLoginRequested);
    on<AuthLogoutRequested>(_onLogoutRequested);
    on<AuthUserUpdated>(_onUserUpdated);
    // Biometric events
    on<AuthBiometricLoginRequested>(_onBiometricLoginRequested);
    on<AuthEnableBiometricRequested>(_onEnableBiometricRequested);
    on<AuthDisableBiometricRequested>(_onDisableBiometricRequested);
    on<AuthSkipBiometricSetup>(_onSkipBiometricSetup);
    on<AuthCheckBiometricStatus>(_onCheckBiometricStatus);
  }

  final AuthRepository? _authRepository;
  final TokenStorage? _tokenStorage;
  final GoogleSignIn _googleSignIn;
  final bool _enableDemoMode;
  final BiometricAuthService _biometricAuthService;
  final BiometricRepository? _biometricRepository;
  
  /// Demo user for testing without backend
  User get _demoUser => User(
    id: 'demo-user-123',
    firstName: 'Demo',
    lastName: 'Rider',
    email: 'demo@ubi.app',
    phoneNumber: '+254712345678',
    role: UserRole.rider,
    verificationStatus: VerificationStatus.verified,
  );

  Future<void> _onCheckRequested(
    AuthCheckRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    // If no storage or repository in demo mode, go to unauthenticated
    if (_tokenStorage == null || _authRepository == null) {
      await _emitUnauthenticatedWithBiometricStatus(emit);
      return;
    }

    // Check if we have stored tokens
    final isLoggedIn = await _tokenStorage!.isLoggedIn();

    if (!isLoggedIn) {
      await _emitUnauthenticatedWithBiometricStatus(emit);
      return;
    }

    // Try to get current user
    final result = await _authRepository!.getCurrentUser();

    result.when(
      success: (user) {
        if (user != null) {
          emit(AuthAuthenticated(user));
        } else {
          _emitUnauthenticatedWithBiometricStatus(emit);
        }
      },
      failure: (failure) async {
        // Token might be expired, clear and logout
        await _tokenStorage!.clearTokens();
        await _emitUnauthenticatedWithBiometricStatus(emit);
      },
    );
  }

  Future<void> _onPhoneLoginRequested(
    AuthPhoneLoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    // Demo mode - simulate OTP send without real API
    if (_enableDemoMode) {
      await Future.delayed(const Duration(milliseconds: 500));
      emit(AuthOtpSent(
        phoneNumber: event.phoneNumber,
        countryCode: event.countryCode,
      ));
      return;
    }

    if (_authRepository == null) {
      emit(const AuthError('Auth repository not initialized'));
      return;
    }

    final result = await _authRepository!.requestOtp(
      phoneNumber: event.phoneNumber,
      countryCode: event.countryCode,
    );

    result.when(
      success: (_) {
        emit(AuthOtpSent(
          phoneNumber: event.phoneNumber,
          countryCode: event.countryCode,
        ));
      },
      failure: (failure) {
        // In demo mode, allow login even if API fails
        if (_enableDemoMode) {
          emit(AuthOtpSent(
            phoneNumber: event.phoneNumber,
            countryCode: event.countryCode,
          ));
        } else {
          emit(AuthError(failure.message ?? 'Failed to send OTP'));
        }
      },
    );
  }

  Future<void> _onOtpVerified(
    AuthOtpVerified event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    // Demo mode - any 6-digit code works
    if (_enableDemoMode) {
      await Future.delayed(const Duration(milliseconds: 500));
      final showBiometricPrompt = await _shouldShowBiometricPrompt();
      emit(AuthAuthenticated(
        _demoUser,
        showBiometricPrompt: showBiometricPrompt,
        isFirstLogin: true,
      ));
      return;
    }

    if (_authRepository == null) {
      emit(const AuthError('Auth repository not initialized'));
      return;
    }

    final result = await _authRepository!.verifyOtp(
      phoneNumber: event.phoneNumber,
      countryCode: event.countryCode,
      code: event.code,
    );

    await result.when(
      success: (user) async {
        final showBiometricPrompt = await _shouldShowBiometricPrompt();
        emit(AuthAuthenticated(
          user,
          showBiometricPrompt: showBiometricPrompt,
          isFirstLogin: true,
        ));
      },
      failure: (failure) async {
        // In demo mode, allow login even if OTP verification fails
        if (_enableDemoMode) {
          final showBiometricPrompt = await _shouldShowBiometricPrompt();
          emit(AuthAuthenticated(
            _demoUser,
            showBiometricPrompt: showBiometricPrompt,
            isFirstLogin: true,
          ));
        } else {
          // Check if user needs to register
          if (failure is AuthFailure && (failure.message?.contains('not registered') ?? false)) {
            emit(AuthNeedsRegistration(
              phoneNumber: event.phoneNumber,
              countryCode: event.countryCode,
            ));
          } else {
            emit(AuthError(failure.message ?? 'OTP verification failed'));
          }
        }
      },
    );
  }

  Future<void> _onRegisterRequested(
    AuthRegisterRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    // Demo mode - simulate registration
    if (_enableDemoMode) {
      await Future.delayed(const Duration(milliseconds: 500));
      final user = User(
        id: 'demo-user-${DateTime.now().millisecondsSinceEpoch}',
        firstName: event.firstName,
        lastName: event.lastName,
        email: event.email,
        phoneNumber: '${event.countryCode}${event.phoneNumber}',
        role: UserRole.rider,
        verificationStatus: VerificationStatus.verified,
      );
      emit(AuthAuthenticated(user));
      return;
    }

    if (_authRepository == null) {
      emit(const AuthError('Auth repository not initialized'));
      return;
    }

    final result = await _authRepository!.register(
      phoneNumber: event.phoneNumber,
      countryCode: event.countryCode,
      firstName: event.firstName,
      lastName: event.lastName,
      email: event.email,
    );

    result.when(
      success: (user) {
        emit(AuthAuthenticated(user));
      },
      failure: (failure) {
        // In demo mode, allow registration even if API fails
        if (_enableDemoMode) {
          final user = User(
            id: 'demo-user-${DateTime.now().millisecondsSinceEpoch}',
            firstName: event.firstName,
            lastName: event.lastName,
            email: event.email,
            phoneNumber: '${event.countryCode}${event.phoneNumber}',
            role: UserRole.rider,
            verificationStatus: VerificationStatus.verified,
          );
          emit(AuthAuthenticated(user));
        } else {
          emit(AuthError(failure.message ?? 'Registration failed'));
        }
      },
    );
  }

  Future<void> _onGoogleLoginRequested(
    AuthGoogleLoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    try {
      final googleUser = await _googleSignIn.signIn();
      if (googleUser == null) {
        emit(const AuthUnauthenticated());
        return;
      }

      final googleAuth = await googleUser.authentication;
      final idToken = googleAuth.idToken;

      if (idToken == null) {
        emit(const AuthError('Failed to get Google ID token'));
        return;
      }

      // Demo mode - simulate Google sign in
      if (_enableDemoMode) {
        await Future.delayed(const Duration(milliseconds: 500));
        final user = User(
          id: 'demo-google-user-${DateTime.now().millisecondsSinceEpoch}',
          firstName: googleUser.displayName?.split(' ').first ?? 'Google',
          lastName: googleUser.displayName?.split(' ').skip(1).join(' ') ?? 'User',
          email: googleUser.email,
          phoneNumber: '',
          role: UserRole.rider,
          verificationStatus: VerificationStatus.verified,
        );
        emit(AuthAuthenticated(user));
        return;
      }

      if (_authRepository == null) {
        emit(const AuthError('Auth repository not initialized'));
        return;
      }

      final result = await _authRepository!.signInWithGoogle(idToken);

      result.when(
        success: (user) {
          emit(AuthAuthenticated(user));
        },
        failure: (failure) {
          // In demo mode, allow sign in even if API fails
          if (_enableDemoMode) {
            final user = User(
              id: 'demo-google-user-${DateTime.now().millisecondsSinceEpoch}',
              firstName: googleUser.displayName?.split(' ').first ?? 'Google',
              lastName: googleUser.displayName?.split(' ').skip(1).join(' ') ?? 'User',
              email: googleUser.email,
              phoneNumber: '',
              role: UserRole.rider,
              verificationStatus: VerificationStatus.verified,
            );
            emit(AuthAuthenticated(user));
          } else {
            emit(AuthError(failure.message ?? 'Google sign in failed'));
          }
        },
      );
    } catch (e) {
      // In demo mode, provide fallback
      if (_enableDemoMode) {
        emit(AuthAuthenticated(_demoUser));
      } else {
        emit(AuthError('Google sign in failed: $e'));
      }
    }
  }

  Future<void> _onAppleLoginRequested(
    AuthAppleLoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    try {
      final credential = await SignInWithApple.getAppleIDCredential(
        scopes: [
          AppleIDAuthorizationScopes.email,
          AppleIDAuthorizationScopes.fullName,
        ],
      );

      final identityToken = credential.identityToken;
      final authorizationCode = credential.authorizationCode;

      if (identityToken == null) {
        emit(const AuthError('Failed to get Apple identity token'));
        return;
      }

      // Demo mode - simulate Apple sign in
      if (_enableDemoMode) {
        await Future.delayed(const Duration(milliseconds: 500));
        final user = User(
          id: 'demo-apple-user-${DateTime.now().millisecondsSinceEpoch}',
          firstName: credential.givenName ?? 'Apple',
          lastName: credential.familyName ?? 'User',
          email: credential.email ?? 'apple@ubi.app',
          phoneNumber: '',
          role: UserRole.rider,
          verificationStatus: VerificationStatus.verified,
        );
        emit(AuthAuthenticated(user));
        return;
      }

      if (_authRepository == null) {
        emit(const AuthError('Auth repository not initialized'));
        return;
      }

      final result = await _authRepository!.signInWithApple(
        identityToken: identityToken,
        authorizationCode: authorizationCode,
        firstName: credential.givenName,
        lastName: credential.familyName,
      );

      result.when(
        success: (user) {
          emit(AuthAuthenticated(user));
        },
        failure: (failure) {
          // In demo mode, allow sign in even if API fails
          if (_enableDemoMode) {
            final user = User(
              id: 'demo-apple-user-${DateTime.now().millisecondsSinceEpoch}',
              firstName: credential.givenName ?? 'Apple',
              lastName: credential.familyName ?? 'User',
              email: credential.email ?? 'apple@ubi.app',
              phoneNumber: '',
              role: UserRole.rider,
              verificationStatus: VerificationStatus.verified,
            );
            emit(AuthAuthenticated(user));
          } else {
            emit(AuthError(failure.message ?? 'Apple sign in failed'));
          }
        },
      );
    } catch (e) {
      if (e is SignInWithAppleAuthorizationException &&
          e.code == AuthorizationErrorCode.canceled) {
        emit(const AuthUnauthenticated());
        return;
      }
      // In demo mode, provide fallback
      if (_enableDemoMode) {
        emit(AuthAuthenticated(_demoUser));
      } else {
        emit(AuthError('Apple sign in failed: $e'));
      }
    }
  }

  Future<void> _onLogoutRequested(
    AuthLogoutRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    await _authRepository?.logout();
    await _tokenStorage?.clearTokens();
    await _googleSignIn.signOut();
    // Don't clear biometric on logout - user may want to use it again

    await _emitUnauthenticatedWithBiometricStatus(emit);
  }

  void _onUserUpdated(
    AuthUserUpdated event,
    Emitter<AuthState> emit,
  ) {
    emit(AuthAuthenticated(event.user));
  }

  // ==================== Biometric Authentication ====================

  /// Handle biometric login request
  Future<void> _onBiometricLoginRequested(
    AuthBiometricLoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthBiometricInProgress());

    if (_biometricRepository == null) {
      emit(const AuthBiometricFailed(
        message: 'Biometric login is not available',
        canRetry: false,
      ));
      return;
    }

    // Get current device key for biometric check
    final deviceKey = DateTime.now().millisecondsSinceEpoch.toString();

    // Check if biometric is enrolled
    final status = await _biometricRepository!.checkBiometricLoginStatus(
      currentDeviceKey: deviceKey,
    );
    if (status != BiometricLoginStatus.ready) {
      emit(const AuthBiometricFailed(
        message: 'Biometric login is not enabled',
        canRetry: false,
      ));
      return;
    }

    // Authenticate using biometrics
    final biometricType = await _biometricAuthService.getPrimaryBiometricType();
    final biometricName = _biometricAuthService.getBiometricName(biometricType);
    
    final result = await _biometricAuthService.authenticate(
      reason: 'Sign in to UBI',
    );

    if (!result.success) {
      final canRetry = result.errorCode != 'permanently_locked_out' &&
          result.errorCode != 'not_available' &&
          result.errorCode != 'not_enrolled';
      
      emit(AuthBiometricFailed(
        message: result.errorMessage ?? 'Biometric authentication failed',
        canRetry: canRetry,
      ));
      return;
    }

    // Biometric successful - get user from stored tokens
    final userId = await _biometricRepository!.getBiometricUserId();
    if (userId == null) {
      emit(const AuthBiometricFailed(
        message: 'No saved credentials found',
        canRetry: false,
      ));
      return;
    }

    // Record successful biometric login
    await _biometricRepository!.recordBiometricLogin();

    // Get current user from API using stored tokens
    if (_authRepository != null) {
      final userResult = await _authRepository!.getCurrentUser();
      
      userResult.when(
        success: (user) {
          if (user != null) {
            emit(AuthAuthenticated(user));
          } else {
            // Tokens might be invalid, disable biometric
            _biometricRepository!.disableBiometric();
            emit(const AuthBiometricFailed(
              message: 'Session expired. Please sign in again.',
              canRetry: false,
            ));
          }
        },
        failure: (failure) {
          // Tokens invalid, disable biometric
          _biometricRepository!.disableBiometric();
          emit(const AuthBiometricFailed(
            message: 'Session expired. Please sign in again.',
            canRetry: false,
          ));
        },
      );
    } else if (_enableDemoMode) {
      // Demo mode - just log in as demo user
      emit(AuthAuthenticated(_demoUser));
    } else {
      emit(const AuthBiometricFailed(
        message: 'Authentication service unavailable',
        canRetry: false,
      ));
    }
  }

  /// Handle enable biometric request (after successful login)
  Future<void> _onEnableBiometricRequested(
    AuthEnableBiometricRequested event,
    Emitter<AuthState> emit,
  ) async {
    final currentState = state;
    if (currentState is! AuthAuthenticated) {
      emit(const AuthError('Must be logged in to enable biometric'));
      return;
    }

    if (_biometricRepository == null) {
      emit(AuthBiometricSetupResult(
        success: false,
        user: currentState.user,
        message: 'Biometric not available',
      ));
      return;
    }

    // Verify biometrics first
    final result = await _biometricAuthService.authenticate(
      reason: 'Enable biometric login',
    );

    if (!result.success) {
      emit(AuthBiometricSetupResult(
        success: false,
        user: currentState.user,
        message: result.errorMessage ?? 'Biometric verification failed',
      ));
      return;
    }

    // Generate a device key based on current biometric setup
    final deviceKey = DateTime.now().millisecondsSinceEpoch.toString();

    // Store biometric enrollment
    await _biometricRepository!.enableBiometric(
      userId: currentState.user.id,
      deviceKey: deviceKey,
    );
    await _biometricRepository!.markBiometricPromptShown();

    emit(AuthBiometricSetupResult(
      success: true,
      user: currentState.user,
      message: 'Biometric login enabled',
    ));

    // Return to authenticated state
    emit(AuthAuthenticated(currentState.user, showBiometricPrompt: false));
  }

  /// Handle disable biometric request
  Future<void> _onDisableBiometricRequested(
    AuthDisableBiometricRequested event,
    Emitter<AuthState> emit,
  ) async {
    final currentState = state;
    if (currentState is! AuthAuthenticated) {
      emit(const AuthError('Must be logged in to disable biometric'));
      return;
    }

    await _biometricRepository?.disableBiometric();
    
    emit(AuthBiometricSetupResult(
      success: true,
      user: currentState.user,
      message: 'Biometric login disabled',
    ));

    // Re-emit current state
    emit(AuthAuthenticated(currentState.user, showBiometricPrompt: false));
  }

  /// Handle skip biometric setup
  Future<void> _onSkipBiometricSetup(
    AuthSkipBiometricSetup event,
    Emitter<AuthState> emit,
  ) async {
    final currentState = state;
    if (currentState is! AuthAuthenticated) return;

    await _biometricRepository?.markBiometricSetupSkipped();
    await _biometricRepository?.markBiometricPromptShown();

    emit(AuthAuthenticated(currentState.user, showBiometricPrompt: false));
  }

  /// Check biometric status and update unauthenticated state
  Future<void> _onCheckBiometricStatus(
    AuthCheckBiometricStatus event,
    Emitter<AuthState> emit,
  ) async {
    await _emitUnauthenticatedWithBiometricStatus(emit);
  }

  /// Helper to emit unauthenticated state with biometric info
  Future<void> _emitUnauthenticatedWithBiometricStatus(
    Emitter<AuthState> emit,
  ) async {
    final biometricStatus = await _checkBiometricAvailability();
    emit(AuthUnauthenticated(
      biometricAvailable: biometricStatus.available,
      biometricType: biometricStatus.type,
    ));
  }

  /// Check if biometrics are available and enabled
  Future<({bool available, String? type})> _checkBiometricAvailability() async {
    if (_biometricRepository == null) {
      return (available: false, type: null);
    }

    // Get current device key
    final deviceKey = DateTime.now().millisecondsSinceEpoch.toString();
    
    final status = await _biometricRepository!.checkBiometricLoginStatus(
      currentDeviceKey: deviceKey,
    );
    if (status != BiometricLoginStatus.ready) {
      return (available: false, type: null);
    }

    final isAvailable = await _biometricAuthService.isAvailable();
    if (!isAvailable) {
      return (available: false, type: null);
    }

    final biometricType = await _biometricAuthService.getPrimaryBiometricType();
    return (
      available: true,
      type: _biometricAuthService.getBiometricName(biometricType),
    );
  }

  /// Determine if we should show the biometric prompt after login
  Future<bool> _shouldShowBiometricPrompt() async {
    if (_biometricRepository == null) {
      return false;
    }

    // Get current device key
    final deviceKey = DateTime.now().millisecondsSinceEpoch.toString();
    
    // Check if already enrolled
    final status = await _biometricRepository!.checkBiometricLoginStatus(
      currentDeviceKey: deviceKey,
    );
    if (status == BiometricLoginStatus.ready) {
      return false;
    }

    // Check if device supports biometrics
    final isAvailable = await _biometricAuthService.isAvailable();
    return isAvailable;
  }
}
