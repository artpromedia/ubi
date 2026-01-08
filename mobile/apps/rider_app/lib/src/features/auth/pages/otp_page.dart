import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../bloc/auth_bloc.dart';
import '../bloc/otp_auto_read_cubit.dart';
import '../../../core/router/app_router.dart';

/// OTP verification page with auto-read support
/// 
/// Features:
/// - 6-digit OTP input with auto-advance
/// - Automatic SMS detection via SMS Retriever API (Android)
/// - Clipboard paste detection
/// - Resend OTP with countdown
class OtpPage extends StatefulWidget {
  final String phoneNumber;
  final String countryCode;

  const OtpPage({
    super.key,
    required this.phoneNumber,
    required this.countryCode,
  });

  @override
  State<OtpPage> createState() => _OtpPageState();
}

class _OtpPageState extends State<OtpPage> {
  final List<TextEditingController> _controllers = List.generate(
    6,
    (_) => TextEditingController(),
  );
  final List<FocusNode> _focusNodes = List.generate(
    6,
    (_) => FocusNode(),
  );

  late final OtpAutoReadCubit _otpAutoReadCubit;
  
  Timer? _timer;
  int _secondsRemaining = 60;
  bool _canResend = false;
  bool _showClipboardBanner = false;
  String? _clipboardOtp;

  @override
  void initState() {
    super.initState();
    _startTimer();
    _initOtpAutoRead();
  }

  void _initOtpAutoRead() {
    _otpAutoReadCubit = OtpAutoReadCubit();
    _otpAutoReadCubit.startListening();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _otpAutoReadCubit.close();
    for (final controller in _controllers) {
      controller.dispose();
    }
    for (final node in _focusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  void _startTimer() {
    _secondsRemaining = 60;
    _canResend = false;
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_secondsRemaining > 0) {
        setState(() {
          _secondsRemaining--;
        });
      } else {
        setState(() {
          _canResend = true;
        });
        timer.cancel();
      }
    });
  }

  String get _otp => _controllers.map((c) => c.text).join();

  /// Auto-fills OTP in the input fields with animation
  void _autoFillOtp(String otp) {
    if (otp.length != 6) return;

    // Clear existing values first
    for (final controller in _controllers) {
      controller.clear();
    }

    // Fill each digit with a slight delay for visual effect
    for (int i = 0; i < 6; i++) {
      Future.delayed(Duration(milliseconds: i * 50), () {
        if (mounted && i < otp.length) {
          _controllers[i].text = otp[i];
          // Trigger rebuild to show filled state
          if (i == 5) {
            setState(() {});
            // Auto-verify after filling
            Future.delayed(const Duration(milliseconds: 300), () {
              if (mounted) {
                _verifyOtp();
              }
            });
          }
        }
      });
    }
  }

  void _onOtpChanged(int index, String value) {
    if (value.length == 1 && index < 5) {
      _focusNodes[index + 1].requestFocus();
    }

    if (_otp.length == 6) {
      _verifyOtp();
    }
  }

  void _onKeyPressed(int index, RawKeyEvent event) {
    if (event is RawKeyDownEvent &&
        event.logicalKey == LogicalKeyboardKey.backspace &&
        _controllers[index].text.isEmpty &&
        index > 0) {
      _focusNodes[index - 1].requestFocus();
    }
  }

  void _verifyOtp() {
    if (_otp.length == 6) {
      context.read<AuthBloc>().add(
            AuthOtpVerified(
              phoneNumber: widget.phoneNumber,
              countryCode: widget.countryCode,
              code: _otp,
            ),
          );
    }
  }

  void _resendOtp() {
    if (_canResend) {
      // Restart OTP auto-read when resending
      _otpAutoReadCubit.startListening();
      
      // Request new OTP
      _startTimer();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('OTP resent successfully')),
      );
    }
  }

  void _handlePasteFromClipboard() async {
    try {
      final clipboardData = await Clipboard.getData(Clipboard.kTextPlain);
      final text = clipboardData?.text;
      
      if (text != null && mounted) {
        // Try to extract 6 consecutive digits
        final match = RegExp(r'\d{6}').firstMatch(text);
        if (match != null) {
          _autoFillOtp(match.group(0)!);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('OTP pasted from clipboard'),
              backgroundColor: Colors.green,
              duration: Duration(seconds: 1),
            ),
          );
        }
      }
    } catch (_) {
      // Ignore clipboard errors
    }
  }

  void _acceptClipboardOtp() {
    if (_clipboardOtp != null) {
      _autoFillOtp(_clipboardOtp!);
      setState(() {
        _showClipboardBanner = false;
        _clipboardOtp = null;
      });
      _otpAutoReadCubit.dismissClipboardOtp();
    }
  }

  void _dismissClipboardBanner() {
    setState(() {
      _showClipboardBanner = false;
      _clipboardOtp = null;
    });
    _otpAutoReadCubit.dismissClipboardOtp();
  }

  @override
  Widget build(BuildContext context) {
    return BlocProvider.value(
      value: _otpAutoReadCubit,
      child: BlocListener<OtpAutoReadCubit, OtpAutoReadState>(
        listener: (context, state) {
          if (state is OtpAutoReadSuccess) {
            _autoFillOtp(state.otp);
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  state.source == OtpSource.smsRetriever
                      ? 'OTP auto-detected from SMS'
                      : 'OTP detected from clipboard',
                ),
                backgroundColor: Colors.green,
                duration: const Duration(seconds: 2),
              ),
            );
          } else if (state is OtpDetectedFromClipboard) {
            // Show banner for clipboard OTP
            setState(() {
              _showClipboardBanner = true;
              _clipboardOtp = state.otp;
            });
          }
        },
        child: Scaffold(
          appBar: AppBar(
            title: const Text('Verify Phone'),
            leading: IconButton(
              icon: const Icon(Icons.arrow_back),
              onPressed: () => context.go(Routes.login),
            ),
          ),
          body: BlocConsumer<AuthBloc, AuthState>(
            listener: (context, state) {
              if (state is AuthNeedsRegistration) {
                context.go(Routes.register);
              } else if (state is AuthAuthenticated) {
                context.go(Routes.home);
              } else if (state is AuthError) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(state.message),
                    backgroundColor: Colors.red,
                  ),
                );
                // Clear OTP fields
                for (final controller in _controllers) {
                  controller.clear();
                }
                _focusNodes[0].requestFocus();
              }
            },
            builder: (context, state) {
              final isLoading = state is AuthLoading;

              return SafeArea(
                child: Column(
                  children: [
                    // Clipboard OTP detection banner
                    if (_showClipboardBanner && _clipboardOtp != null)
                      _buildClipboardBanner(),
                    
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const SizedBox(height: 24),

                            // Instructions
                            Text(
                              'Enter verification code',
                              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'We sent a 6-digit code to your phone number',
                              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                                    color: Colors.grey[600],
                                  ),
                              textAlign: TextAlign.center,
                            ),

                            // Auto-detection hint (Android only)
                            if (Platform.isAndroid) ...[
                              const SizedBox(height: 16),
                              _buildAutoDetectionHint(),
                            ],

                            const SizedBox(height: 32),

                            // OTP input fields
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                              children: List.generate(6, (index) {
                                return SizedBox(
                                  width: 48,
                                  child: RawKeyboardListener(
                                    focusNode: FocusNode(),
                                    onKey: (event) => _onKeyPressed(index, event),
                                    child: TextFormField(
                                      controller: _controllers[index],
                                      focusNode: _focusNodes[index],
                                      keyboardType: TextInputType.number,
                                      textAlign: TextAlign.center,
                                      maxLength: 1,
                                      enabled: !isLoading,
                                      style: const TextStyle(
                                        fontSize: 24,
                                        fontWeight: FontWeight.bold,
                                      ),
                                      decoration: InputDecoration(
                                        counterText: '',
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(12),
                                        ),
                                        focusedBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(12),
                                          borderSide: BorderSide(
                                            color: Theme.of(context).primaryColor,
                                            width: 2,
                                          ),
                                        ),
                                      ),
                                      inputFormatters: [
                                        FilteringTextInputFormatter.digitsOnly,
                                      ],
                                      onChanged: (value) => _onOtpChanged(index, value),
                                    ),
                                  ),
                                );
                              }),
                            ),

                            // Paste from clipboard button
                            const SizedBox(height: 16),
                            Center(
                              child: TextButton.icon(
                                onPressed: isLoading ? null : _handlePasteFromClipboard,
                                icon: const Icon(Icons.content_paste, size: 18),
                                label: const Text('Paste from clipboard'),
                                style: TextButton.styleFrom(
                                  foregroundColor: Colors.grey.shade700,
                                ),
                              ),
                            ),

                            const SizedBox(height: 16),

                            // Loading indicator
                            if (isLoading)
                              const Center(child: CircularProgressIndicator()),

                            const Spacer(),

                            // Resend code
                            TextButton(
                              onPressed: _canResend ? _resendOtp : null,
                              child: Text(
                                _canResend
                                    ? 'Resend code'
                                    : 'Resend code in ${_secondsRemaining}s',
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildAutoDetectionHint() {
    return BlocBuilder<OtpAutoReadCubit, OtpAutoReadState>(
      builder: (context, state) {
        if (state is OtpAutoReadListening) {
          return Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.blue.shade50,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.blue.shade700,
                  ),
                ),
                const SizedBox(width: 12),
                Flexible(
                  child: Text(
                    'Waiting for SMS... We\'ll auto-fill when it arrives',
                    style: TextStyle(
                      color: Colors.blue.shade700,
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
          );
        } else if (state is OtpAutoReadTimeout) {
          return Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: Colors.orange.shade50,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.info_outline, color: Colors.orange.shade700, size: 18),
                const SizedBox(width: 12),
                Flexible(
                  child: Text(
                    'Auto-detection timed out. Please enter the code manually.',
                    style: TextStyle(
                      color: Colors.orange.shade700,
                      fontSize: 13,
                    ),
                  ),
                ),
              ],
            ),
          );
        }
        return const SizedBox.shrink();
      },
    );
  }

  Widget _buildClipboardBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      color: Colors.green.shade50,
      child: Row(
        children: [
          Icon(Icons.content_paste, color: Colors.green.shade700, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'OTP detected in clipboard',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: Colors.green.shade800,
                    fontSize: 14,
                  ),
                ),
                Text(
                  'Code: $_clipboardOtp',
                  style: TextStyle(
                    color: Colors.green.shade700,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: _acceptClipboardOtp,
            style: TextButton.styleFrom(
              backgroundColor: Colors.green.shade600,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            ),
            child: const Text('Use'),
          ),
          IconButton(
            onPressed: _dismissClipboardBanner,
            icon: Icon(Icons.close, color: Colors.green.shade700, size: 20),
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            padding: EdgeInsets.zero,
          ),
        ],
      ),
    );
  }
}
