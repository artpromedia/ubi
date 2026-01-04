/// Auth DTOs
///
/// Re-exports all authentication-related DTOs.
library;

export '../services/auth_service.dart'
    show
        PhoneLoginRequestDto,
        VerifyOtpRequestDto,
        ResendOtpRequestDto,
        RegisterRequestDto,
        GoogleAuthRequestDto,
        AppleAuthRequestDto,
        RefreshTokenRequestDto,
        ForgotPasswordRequestDto,
        ResetPasswordRequestDto,
        OtpResponseDto,
        AuthResponseDto,
        AuthUserDto;
