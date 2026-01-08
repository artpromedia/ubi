import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/router/app_router.dart';
import '../bloc/otp_auto_read_cubit.dart';

/// OTP verification page for phone number authentication
/// 
/// Features:
/// - 6-digit OTP input with auto-advance
/// - Automatic SMS detection via SMS Retriever API (Android)
/// - Clipboard paste detection
/// - Resend OTP with countdown
/// - Help dialog
class OtpVerificationPage extends StatefulWidget {
  final String phoneNumber;

  const OtpVerificationPage({
    super.key,
    required this.phoneNumber,
  });

  @override
  State<OtpVerificationPage> createState() => _OtpVerificationPageState();
}

class _OtpVerificationPageState extends State<OtpVerificationPage> {
  final List<TextEditingController> _controllers = List.generate(
    6,
    (_) => TextEditingController(),
  );
  final List<FocusNode> _focusNodes = List.generate(
    6,
    (_) => FocusNode(),
  );

  late final OtpAutoReadCubit _otpAutoReadCubit;

  bool _isLoading = false;
  bool _canResend = false;
  int _resendCountdown = 60;
  Timer? _countdownTimer;
  bool _showClipboardBanner = false;
  String? _clipboardOtp;

  @override
  void initState() {
    super.initState();
    _startCountdown();
    _initOtpAutoRead();
  }

  void _initOtpAutoRead() {
    _otpAutoReadCubit = OtpAutoReadCubit();
    _otpAutoReadCubit.startListening();
  }

  @override
  void dispose() {
    _countdownTimer?.cancel();
    _otpAutoReadCubit.close();
    for (final controller in _controllers) {
      controller.dispose();
    }
    for (final node in _focusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  void _startCountdown() {
    _resendCountdown = 60;
    _canResend = false;

    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_resendCountdown > 0) {
        setState(() {
          _resendCountdown--;
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

  Future<void> _verifyOtp() async {
    if (_otp.length != 6) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please enter the complete OTP'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }

    setState(() => _isLoading = true);

    // Simulate API call
    await Future.delayed(const Duration(seconds: 1));

    if (!mounted) return;

    setState(() => _isLoading = false);

    // Navigate to home on success
    context.go(AppRoutes.home);
  }

  Future<void> _resendOtp() async {
    if (!_canResend) return;

    // Restart OTP auto-read when resending
    _otpAutoReadCubit.startListening();

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('OTP sent successfully'),
        backgroundColor: Colors.green,
      ),
    );

    _startCountdown();
  }

  void _onOtpChanged(int index, String value) {
    if (value.isNotEmpty && index < 5) {
      _focusNodes[index + 1].requestFocus();
    }

    // Auto-submit when complete
    if (_otp.length == 6) {
      _verifyOtp();
    }
  }

  void _onKeyDown(int index, KeyEvent event) {
    if (event is KeyDownEvent &&
        event.logicalKey == LogicalKeyboardKey.backspace &&
        _controllers[index].text.isEmpty &&
        index > 0) {
      _focusNodes[index - 1].requestFocus();
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
            leading: IconButton(
              icon: const Icon(Icons.arrow_back),
              onPressed: () => context.pop(),
            ),
          ),
          body: SafeArea(
            child: Column(
              children: [
                // Clipboard OTP detection banner
                if (_showClipboardBanner && _clipboardOtp != null)
                  _buildClipboardBanner(),
                
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Verify Phone Number',
                          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          'We sent a 6-digit code to',
                          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                                color: Colors.grey.shade600,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          widget.phoneNumber,
                          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
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
                              height: 56,
                              child: KeyboardListener(
                                focusNode: FocusNode(),
                                onKeyEvent: (event) => _onKeyDown(index, event),
                                child: TextFormField(
                                  controller: _controllers[index],
                                  focusNode: _focusNodes[index],
                                  keyboardType: TextInputType.number,
                                  textAlign: TextAlign.center,
                                  maxLength: 1,
                                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                        fontWeight: FontWeight.bold,
                                      ),
                                  decoration: InputDecoration(
                                    counterText: '',
                                    contentPadding: EdgeInsets.zero,
                                    enabledBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(12),
                                      borderSide: BorderSide(color: Colors.grey.shade300),
                                    ),
                                    focusedBorder: OutlineInputBorder(
                                      borderRadius: BorderRadius.circular(12),
                                      borderSide: BorderSide(
                                        color: Theme.of(context).primaryColor,
                                        width: 2,
                                      ),
                                    ),
                                    filled: _controllers[index].text.isNotEmpty,
                                    fillColor: Theme.of(context).primaryColor.withOpacity(0.1),
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
                            onPressed: _handlePasteFromClipboard,
                            icon: const Icon(Icons.content_paste, size: 18),
                            label: const Text('Paste from clipboard'),
                            style: TextButton.styleFrom(
                              foregroundColor: Colors.grey.shade700,
                            ),
                          ),
                        ),
                        
                        const SizedBox(height: 16),

                        // Verify button
                        SizedBox(
                          width: double.infinity,
                          height: 56,
                          child: ElevatedButton(
                            onPressed: _isLoading ? null : _verifyOtp,
                            child: _isLoading
                                ? const SizedBox(
                                    width: 24,
                                    height: 24,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Text('Verify'),
                          ),
                        ),
                        const SizedBox(height: 24),

                        // Resend section
                        Center(
                          child: _canResend
                              ? TextButton(
                                  onPressed: _resendOtp,
                                  child: const Text('Resend Code'),
                                )
                              : Text(
                                  'Resend code in ${_resendCountdown}s',
                                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                        color: Colors.grey.shade600,
                                      ),
                                ),
                        ),

                        const Spacer(),

                        // Help section
                        Center(
                          child: Column(
                            children: [
                              Icon(
                                Icons.help_outline,
                                color: Colors.grey.shade400,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                "Didn't receive the code?",
                                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: Colors.grey.shade600,
                                    ),
                              ),
                              TextButton(
                                onPressed: () {
                                  // Show help dialog
                                  showDialog(
                                    context: context,
                                    builder: (context) => AlertDialog(
                                      title: const Text('Need Help?'),
                                      content: const Text(
                                        'Make sure your phone number is correct and you have a stable network connection. If the problem persists, please contact support.',
                                      ),
                                      actions: [
                                        TextButton(
                                          onPressed: () => Navigator.pop(context),
                                          child: const Text('OK'),
                                        ),
                                        TextButton(
                                          onPressed: () {
                                            Navigator.pop(context);
                                            // TODO: Open support chat
                                          },
                                          child: const Text('Contact Support'),
                                        ),
                                      ],
                                    ),
                                  );
                                },
                                child: const Text('Get Help'),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
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
                Expanded(
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
              children: [
                Icon(Icons.info_outline, color: Colors.orange.shade700, size: 18),
                const SizedBox(width: 12),
                Expanded(
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
