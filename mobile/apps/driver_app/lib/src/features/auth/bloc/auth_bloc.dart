import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:ubi_core/ubi_core.dart';
import 'package:ubi_storage/ubi_storage.dart';

part 'auth_event.dart';
part 'auth_state.dart';

/// Authentication BLoC for driver app
class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc({
    AuthRepository? authRepository,
    TokenStorage? tokenStorage,
    GoogleSignIn? googleSignIn,
  })  : _authRepository = authRepository,
        _tokenStorage = tokenStorage,
        _googleSignIn = googleSignIn ?? GoogleSignIn(scopes: ['email']),
        super(const AuthInitial()) {
    on<AuthCheckRequested>(_onCheckRequested);
    on<AuthPhoneLoginRequested>(_onPhoneLoginRequested);
    on<AuthOtpVerified>(_onOtpVerified);
    on<AuthRegisterRequested>(_onRegisterRequested);
    on<AuthGoogleLoginRequested>(_onGoogleLoginRequested);
    on<AuthAppleLoginRequested>(_onAppleLoginRequested);
    on<AuthLogoutRequested>(_onLogoutRequested);
    on<AuthUserUpdated>(_onUserUpdated);
  }

  final AuthRepository? _authRepository;
  final TokenStorage? _tokenStorage;
  final GoogleSignIn _googleSignIn;

  Future<void> _onCheckRequested(
    AuthCheckRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthLoading());

    if (_tokenStorage == null || _authRepository == null) {
      emit(const AuthUnauthenticated());
      return;
    }

    // Check if we have stored tokens
    final isLoggedIn = await _tokenStorage!.isLoggedIn();

    if (!isLoggedIn) {
      emit(const AuthUnauthenticated());
      return;
    }

    // Try to get current user
    final result = await _authRepository!.getCurrentUser();

    result.when(
      success: (user) {
        if (user != null) {
          emit(AuthAuthenticated(user));
        } else {
          emit(const AuthUnauthenticated());
        }
      },
      failure: (failure) {
        // Token might be expired, clear and logout
        _tokenStorage!.clearTokens();
        emit(const AuthUnauthenticated());
      },
    );
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
      success: (user) {
        emit(AuthAuthenticated(user));
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

    emit(const AuthUnauthenticated());
  }

  void _onUserUpdated(
    AuthUserUpdated event,
    Emitter<AuthState> emit,
  ) {
    emit(AuthAuthenticated(event.user));
  }
}
