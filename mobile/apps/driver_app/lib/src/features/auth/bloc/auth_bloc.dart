import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:ubi_core/ubi_core.dart';
import 'package:ubi_storage/ubi_storage.dart';

import '../data/repositories/biometric_repository.dart';
import '../../../core/services/biometric_auth_service.dart';

part 'auth_event.dart';
part 'auth_state.dart';

/// Authentication BLoC for driver app
class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc({
    AuthRepository? authRepository,
    TokenStorage? tokenStorage,
    GoogleSignIn? googleSignIn,
    BiometricAuthService? biometricService,
    BiometricRepository? biometricRepository,
  })  : _authRepository = authRepository,
        _tokenStorage = tokenStorage,
        _googleSignIn = googleSignIn ?? GoogleSignIn(scopes: ['email']),
        _biometricService = biometricService ?? BiometricAuthService(),
        _biometricRepository = biometricRepository,
        super(const AuthInitial()) {
    on<AuthCheckRequested>(_onCheckRequested);
    on<AuthPhoneLoginRequested>(_onPhoneLoginRequested);
    on<AuthOtpVerified>(_onOtpVerified);
    on<AuthRegisterRequested>(_onRegisterRequested);
    on<AuthGoogleLoginRequested>(_onGoogleLoginRequested);
    on<AuthAppleLoginRequested>(_onAppleLoginRequested);
    on<AuthBiometricLoginRequested>(_onBiometricLoginRequested);
    on<AuthEnableBiometricRequested>(_onEnableBiometricRequested);
    on<AuthDisableBiometricRequested>(_onDisableBiometricRequested);
    on<AuthSkipBiometricSetup>(_onSkipBiometricSetup);
    on<AuthCheckBiometricStatus>(_onCheckBiometricStatus);
    on<AuthLogoutRequested>(_onLogoutRequested);
    on<AuthUserUpdated>(_onUserUpdated);
  }

  final AuthRepository? _authRepository;
  final TokenStorage? _tokenStorage;
  final GoogleSignIn _googleSignIn;
  final BiometricAuthService _biometricService;
  final BiometricRepository? _biometricRepository;

  Future<void> _onCheckRequested(
    AuthCheckRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

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
      failure: (failure) {
        // Token might be expired, clear and logout
        _tokenStorage!.clearTokens();
        _emitUnauthenticatedWithBiometricStatus(emit);
      },
    );
  }

  /// Helper to emit unauthenticated state with biometric availability info
  Future<void> _emitUnauthenticatedWithBiometricStatus(Emitter<AuthState> emit) async {
    final biometricAvailable = await _checkBiometricAvailability();
    String? biometricType;
    
    if (biometricAvailable) {
      final type = await _biometricService.getPrimaryBiometricType();
      biometricType = _biometricService.getBiometricName(type);
    }
    
    emit(AuthUnauthenticated(
      biometricAvailable: biometricAvailable,
      biometricType: biometricType,
    ));
  }

  /// Check if biometric login is available for returning users
  Future<bool> _checkBiometricAvailability() async {
    if (_biometricRepository == null) return false;
    
    final canUseBiometrics = await _biometricService.canCheckBiometrics();
    if (!canUseBiometrics) return false;
    
    final isEnabled = await _biometricRepository!.isBiometricEnabled();
    return isEnabled;
  }

  Future<void> _onPhoneLoginRequested(
    AuthPhoneLoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

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
        emit(AuthError(failure.message ?? 'Failed to send OTP'));
      },
    );
  }

  Future<void> _onOtpVerified(
    AuthOtpVerified event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    if (_authRepository == null) {
      emit(const AuthError('Auth repository not initialized'));
      return;
    }

    final result = await _authRepository!.verifyOtp(
      phoneNumber: event.phoneNumber,
      countryCode: event.countryCode,
      code: event.code,
    );

    result.when(
      success: (user) async {
        // Check if we should show biometric prompt
        final showBiometricPrompt = await _shouldShowBiometricPrompt();
        emit(AuthAuthenticated(
          user,
          showBiometricPrompt: showBiometricPrompt,
          isFirstLogin: true,
        ));
      },
      failure: (failure) {
        // Check if user needs to register
        if (failure is AuthFailure && (failure.message?.contains('not registered') ?? false)) {
          emit(AuthNeedsRegistration(
            phoneNumber: event.phoneNumber,
            countryCode: event.countryCode,
          ));
        } else {
          emit(AuthError(failure.message ?? 'OTP verification failed'));
        }
      },
    );
  }

  /// Check if we should prompt user to enable biometric login
  Future<bool> _shouldShowBiometricPrompt() async {
    if (_biometricRepository == null) return false;
    
    // Don't show if already enabled
    final isEnabled = await _biometricRepository!.isBiometricEnabled();
    if (isEnabled) return false;
    
    // Don't show if user has skipped before
    final hasSkipped = await _biometricRepository!.hasBiometricSetupBeenSkipped();
    if (hasSkipped) return false;
    
    // Don't show if device doesn't support biometrics
    final canUseBiometrics = await _biometricService.canCheckBiometrics();
    if (!canUseBiometrics) return false;
    
    return true;
  }

  Future<void> _onRegisterRequested(
    AuthRegisterRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

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
        emit(AuthError(failure.message ?? 'Registration failed'));
      },
    );
  }

  Future<void> _onGoogleLoginRequested(
    AuthGoogleLoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    if (_authRepository == null) {
      emit(const AuthError('Auth repository not initialized'));
      return;
    }

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

      final result = await _authRepository!.signInWithGoogle(idToken);

      result.when(
        success: (user) {
          emit(AuthAuthenticated(user));
        },
        failure: (failure) {
          emit(AuthError(failure.message ?? 'Google sign in failed'));
        },
      );
    } catch (e) {
      emit(AuthError('Google sign in failed: $e'));
    }
  }

  Future<void> _onAppleLoginRequested(
    AuthAppleLoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    if (_authRepository == null) {
      emit(const AuthError('Auth repository not initialized'));
      return;
    }

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
          emit(AuthError(failure.message ?? 'Apple sign in failed'));
        },
      );
    } catch (e) {
      if (e is SignInWithAppleAuthorizationException &&
          e.code == AuthorizationErrorCode.canceled) {
        emit(const AuthUnauthenticated());
        return;
      }
      emit(AuthError('Apple sign in failed: $e'));
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
    // Note: We don't disable biometric on logout, so user can use it to log back in

    await _emitUnauthenticatedWithBiometricStatus(emit);
  }

  void _onUserUpdated(
    AuthUserUpdated event,
    Emitter<AuthState> emit,
  ) {
    emit(AuthAuthenticated(event.user));
  }

  // === Biometric Authentication Handlers ===

  Future<void> _onBiometricLoginRequested(
    AuthBiometricLoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthBiometricInProgress());

    if (_biometricRepository == null || _authRepository == null) {
      emit(const AuthBiometricFailed(
        message: 'Biometric authentication not available',
        canRetry: false,
      ));
      return;
    }

    // Verify biometric is enabled
    final isEnabled = await _biometricRepository!.isBiometricEnabled();
    if (!isEnabled) {
      emit(const AuthBiometricFailed(
        message: 'Biometric login is not enabled',
        canRetry: false,
      ));
      return;
    }

    // Get the biometric type for the prompt message
    final biometricType = await _biometricService.getPrimaryBiometricType();
    final biometricName = _biometricService.getBiometricName(biometricType);

    // Perform biometric authentication
    final authResult = await _biometricService.authenticate(
      reason: 'Authenticate to sign in to UBI',
      biometricOnly: true,
    );

    if (!authResult.success) {
      final canRetry = authResult.errorCode != 'permanently_locked_out' &&
          authResult.errorCode != 'not_available' &&
          authResult.errorCode != 'not_enrolled';

      emit(AuthBiometricFailed(
        message: authResult.errorMessage ?? 'Authentication failed',
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
    final result = await _authRepository!.getCurrentUser();

    result.when(
      success: (user) {
        if (user != null) {
          // Analytics: Track biometric login
          print('Analytics: biometric_login_success, type: $biometricName');
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
  }

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

    // First verify the user can authenticate with biometrics
    final authResult = await _biometricService.authenticate(
      reason: 'Verify your identity to enable biometric login',
      biometricOnly: true,
    );

    if (!authResult.success) {
      emit(AuthBiometricSetupResult(
        success: false,
        user: currentState.user,
        message: authResult.errorMessage ?? 'Biometric verification failed',
      ));
      return;
    }

    // Generate a device key based on current biometric setup
    // In a real app, this would be derived from the biometric data
    final deviceKey = DateTime.now().millisecondsSinceEpoch.toString();

    // Enable biometric for this user
    await _biometricRepository!.enableBiometric(
      userId: currentState.user.id,
      deviceKey: deviceKey,
    );
    await _biometricRepository!.markBiometricPromptShown();

    // Analytics: Track biometric enabled
    final biometricType = await _biometricService.getPrimaryBiometricType();
    print('Analytics: biometric_enabled, type: ${_biometricService.getBiometricName(biometricType)}');

    emit(AuthBiometricSetupResult(
      success: true,
      user: currentState.user,
      message: 'Biometric login enabled',
    ));

    // Return to authenticated state
    emit(AuthAuthenticated(currentState.user));
  }

  Future<void> _onDisableBiometricRequested(
    AuthDisableBiometricRequested event,
    Emitter<AuthState> emit,
  ) async {
    final currentState = state;
    if (currentState is! AuthAuthenticated) {
      emit(const AuthError('Must be logged in to disable biometric'));
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

    await _biometricRepository!.disableBiometric();

    // Analytics: Track biometric disabled
    print('Analytics: biometric_disabled');

    emit(AuthBiometricSetupResult(
      success: true,
      user: currentState.user,
      message: 'Biometric login disabled',
    ));

    // Return to authenticated state
    emit(AuthAuthenticated(currentState.user));
  }

  Future<void> _onSkipBiometricSetup(
    AuthSkipBiometricSetup event,
    Emitter<AuthState> emit,
  ) async {
    final currentState = state;
    if (currentState is! AuthAuthenticated) return;

    await _biometricRepository?.markBiometricSetupSkipped();
    await _biometricRepository?.markBiometricPromptShown();

    // Analytics: Track biometric setup skipped
    print('Analytics: biometric_setup_skipped');

    emit(AuthAuthenticated(currentState.user));
  }

  Future<void> _onCheckBiometricStatus(
    AuthCheckBiometricStatus event,
    Emitter<AuthState> emit,
  ) async {
    // This is used to refresh the login screen with biometric status
    await _emitUnauthenticatedWithBiometricStatus(emit);
  }
}
