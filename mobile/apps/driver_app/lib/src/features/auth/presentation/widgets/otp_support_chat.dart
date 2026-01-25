import 'package:flutter/material.dart';

/// Categories of support issues
enum SupportIssueCategory {
  otpNotReceived,
  otpExpired,
  wrongPhoneNumber,
  networkIssue,
  other,
}

/// Support chat message model
class SupportMessage {
  final String id;
  final String content;
  final bool isFromUser;
  final DateTime timestamp;
  final MessageStatus status;

  const SupportMessage({
    required this.id,
    required this.content,
    required this.isFromUser,
    required this.timestamp,
    this.status = MessageStatus.sent,
  });
}

enum MessageStatus { sending, sent, delivered, read }

/// A bottom sheet widget for OTP support chat
class OtpSupportChat extends StatefulWidget {
  final String phoneNumber;
  final VoidCallback? onResendRequested;

  const OtpSupportChat({
    super.key,
    required this.phoneNumber,
    this.onResendRequested,
  });

  @override
  State<OtpSupportChat> createState() => _OtpSupportChatState();
}

class _OtpSupportChatState extends State<OtpSupportChat> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<SupportMessage> _messages = [];
  bool _isTyping = false;
  SupportIssueCategory? _selectedCategory;

  @override
  void initState() {
    super.initState();
    _addBotMessage(
      'Hi! I\'m here to help you with OTP verification issues. '
      'Please select what you\'re experiencing:',
    );
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _addBotMessage(String content) {
    setState(() {
      _messages.add(SupportMessage(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        content: content,
        isFromUser: false,
        timestamp: DateTime.now(),
      ));
    });
    _scrollToBottom();
  }

  void _addUserMessage(String content) {
    setState(() {
      _messages.add(SupportMessage(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        content: content,
        isFromUser: true,
        timestamp: DateTime.now(),
      ));
    });
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _handleCategorySelection(SupportIssueCategory category) {
    _selectedCategory = category;

    String userMessage;
    String botResponse;

    switch (category) {
      case SupportIssueCategory.otpNotReceived:
        userMessage = 'I\'m not receiving the OTP';
        botResponse = _getOtpNotReceivedResponse();
        break;
      case SupportIssueCategory.otpExpired:
        userMessage = 'My OTP has expired';
        botResponse = _getOtpExpiredResponse();
        break;
      case SupportIssueCategory.wrongPhoneNumber:
        userMessage = 'I entered the wrong phone number';
        botResponse = _getWrongPhoneResponse();
        break;
      case SupportIssueCategory.networkIssue:
        userMessage = 'I have network connectivity issues';
        botResponse = _getNetworkIssueResponse();
        break;
      case SupportIssueCategory.other:
        userMessage = 'I have a different issue';
        botResponse = _getOtherIssueResponse();
        break;
    }

    _addUserMessage(userMessage);
    _showTypingIndicator();

    Future.delayed(const Duration(milliseconds: 1200), () {
      _hideTypingIndicator();
      _addBotMessage(botResponse);
    });
  }

  String _getOtpNotReceivedResponse() {
    return '''I understand you're not receiving the OTP. Here are some things to try:

📱 **Check your inbox**
• Make sure you're checking the correct phone: ${widget.phoneNumber}
• Look in your SMS spam folder

📶 **Network issues**
• Ensure you have cellular signal
• Try turning airplane mode on/off

⏱️ **Wait a moment**
• SMS can take up to 2 minutes to arrive

Would you like me to resend the OTP now?''';
  }

  String _getOtpExpiredResponse() {
    return '''OTP codes expire after 5 minutes for security reasons.

🔄 **Quick fix:**
I can send you a new OTP code right away.

💡 **Tip:** Enter the code immediately after receiving it to avoid expiration.

Would you like me to resend a new OTP?''';
  }

  String _getWrongPhoneResponse() {
    return '''No problem! I can help you update your phone number.

📱 **Current number:** ${widget.phoneNumber}

To change your phone number:
1. Tap the back arrow to go back
2. Enter the correct phone number
3. Request a new OTP

Need any other help?''';
  }

  String _getNetworkIssueResponse() {
    return '''Network issues can prevent OTP delivery. Let's troubleshoot:

📶 **Try these steps:**
1. Check your cellular signal
2. Turn off WiFi and use mobile data
3. Toggle Airplane mode on, wait 10 seconds, then off
4. Move to an area with better reception

🔄 **Still not working?**
Once you have a stable connection, tap "Resend OTP" to get a new code.

Is your connection better now?''';
  }

  String _getOtherIssueResponse() {
    return '''I'd like to help you with your specific issue.

📝 Please describe what's happening in the text box below, and I'll do my best to assist you.

🆘 **Need immediate help?**
You can also contact our support team directly:
• WhatsApp: +254 700 123 456
• Email: support@ubi.com
• Call: 0800 123 456 (toll-free)''';
  }

  void _showTypingIndicator() {
    setState(() => _isTyping = true);
  }

  void _hideTypingIndicator() {
    setState(() => _isTyping = false);
  }

  void _handleResendOtp() {
    _addUserMessage('Yes, please resend the OTP');
    _showTypingIndicator();

    Future.delayed(const Duration(milliseconds: 800), () {
      _hideTypingIndicator();
      widget.onResendRequested?.call();
      _addBotMessage(
        '✅ Done! A new OTP has been sent to ${widget.phoneNumber}.\n\n'
        'Please check your messages and enter the code within 5 minutes.\n\n'
        'Is there anything else I can help you with?',
      );
    });
  }

  void _sendMessage() {
    final message = _messageController.text.trim();
    if (message.isEmpty) return;

    _addUserMessage(message);
    _messageController.clear();
    _showTypingIndicator();

    // Simulate bot response
    Future.delayed(const Duration(milliseconds: 1500), () {
      _hideTypingIndicator();
      _handleUserInput(message);
    });
  }

  void _handleUserInput(String message) {
    final lowerMessage = message.toLowerCase();

    // Check for common intents
    if (lowerMessage.contains('resend') ||
        lowerMessage.contains('send again') ||
        lowerMessage.contains('new otp') ||
        lowerMessage.contains('yes')) {
      widget.onResendRequested?.call();
      _addBotMessage(
        '✅ A new OTP has been sent to ${widget.phoneNumber}!\n\n'
        'Please check your messages. The code will expire in 5 minutes.',
      );
    } else if (lowerMessage.contains('call') ||
        lowerMessage.contains('phone') ||
        lowerMessage.contains('speak')) {
      _addBotMessage(
        '📞 You can reach our support team at:\n\n'
        '• WhatsApp: +254 700 123 456\n'
        '• Call: 0800 123 456 (toll-free)\n'
        '• Hours: Mon-Sat, 6am - 10pm',
      );
    } else if (lowerMessage.contains('email')) {
      _addBotMessage(
        '📧 You can email us at support@ubi.com\n\n'
        'Please include your phone number and a description of the issue. '
        'We typically respond within 24 hours.',
      );
    } else if (lowerMessage.contains('thank') ||
        lowerMessage.contains('thanks') ||
        lowerMessage.contains('done') ||
        lowerMessage.contains('solved')) {
      _addBotMessage(
        '😊 You\'re welcome! Glad I could help.\n\n'
        'If you have any other issues in the future, don\'t hesitate to reach out. '
        'Good luck with your verification!',
      );
    } else if (lowerMessage.contains('no') ||
        lowerMessage.contains('nothing') ||
        lowerMessage.contains('that\'s all')) {
      _addBotMessage(
        '👍 Great! If you need any further assistance, feel free to come back.\n\n'
        'Tap outside this chat to close it and continue with verification.',
      );
    } else {
      // Generic response for other messages
      _addBotMessage(
        'I understand you\'re having trouble. Let me help you:\n\n'
        '🔄 **Resend OTP** - I can send a new code\n'
        '📞 **Call Support** - Talk to our team\n'
        '📧 **Email Us** - support@ubi.com\n\n'
        'What would you like to do?',
      );
    }
  }

  void _connectToHumanAgent() {
    _addUserMessage('I\'d like to speak with a human agent');
    _showTypingIndicator();

    Future.delayed(const Duration(milliseconds: 1000), () {
      _hideTypingIndicator();
      _addBotMessage(
        '🧑‍💼 Connecting you to a support agent...\n\n'
        'Estimated wait time: 2-5 minutes\n\n'
        'You can also reach us immediately via:\n'
        '• WhatsApp: +254 700 123 456\n'
        '• Call: 0800 123 456',
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height * 0.75,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          // Handle bar
          Container(
            margin: const EdgeInsets.only(top: 12),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.grey.shade300,
              borderRadius: BorderRadius.circular(2),
            ),
          ),

          // Header
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: Theme.of(context).primaryColor.withOpacity(0.1),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.support_agent,
                    color: Theme.of(context).primaryColor,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'OTP Support',
                        style: TextStyle(
                          fontWeight: FontWeight.bold,
                          fontSize: 16,
                        ),
                      ),
                      Row(
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: const BoxDecoration(
                              color: Colors.green,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'Online',
                            style: TextStyle(
                              color: Colors.grey.shade600,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.pop(context),
                ),
              ],
            ),
          ),

          const Divider(height: 1),

          // Messages
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length + (_isTyping ? 1 : 0),
              itemBuilder: (context, index) {
                if (_isTyping && index == _messages.length) {
                  return _buildTypingIndicator();
                }
                return _buildMessage(_messages[index]);
              },
            ),
          ),

          // Quick actions (if no category selected yet)
          if (_selectedCategory == null) ...[
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _buildQuickAction(
                    'Not receiving OTP',
                    Icons.sms_failed_outlined,
                    () => _handleCategorySelection(SupportIssueCategory.otpNotReceived),
                  ),
                  _buildQuickAction(
                    'OTP expired',
                    Icons.timer_off_outlined,
                    () => _handleCategorySelection(SupportIssueCategory.otpExpired),
                  ),
                  _buildQuickAction(
                    'Wrong number',
                    Icons.phone_disabled,
                    () => _handleCategorySelection(SupportIssueCategory.wrongPhoneNumber),
                  ),
                  _buildQuickAction(
                    'Network issue',
                    Icons.signal_cellular_off,
                    () => _handleCategorySelection(SupportIssueCategory.networkIssue),
                  ),
                  _buildQuickAction(
                    'Other issue',
                    Icons.help_outline,
                    () => _handleCategorySelection(SupportIssueCategory.other),
                  ),
                ],
              ),
            ),
          ] else ...[
            // Action buttons after initial selection
            const Divider(height: 1),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _handleResendOtp,
                      icon: const Icon(Icons.refresh, size: 18),
                      label: const Text('Resend OTP'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _connectToHumanAgent,
                      icon: const Icon(Icons.person, size: 18),
                      label: const Text('Human Agent'),
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Input field
          Container(
            padding: EdgeInsets.only(
              left: 16,
              right: 16,
              top: 8,
              bottom: MediaQuery.of(context).viewInsets.bottom + 16,
            ),
            decoration: BoxDecoration(
              color: Colors.grey.shade50,
              border: Border(
                top: BorderSide(color: Colors.grey.shade200),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _messageController,
                    decoration: InputDecoration(
                      hintText: 'Type a message...',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide.none,
                      ),
                      filled: true,
                      fillColor: Colors.white,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 8,
                      ),
                    ),
                    onSubmitted: (_) => _sendMessage(),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton.filled(
                  onPressed: _sendMessage,
                  icon: const Icon(Icons.send, size: 20),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMessage(SupportMessage message) {
    final isUser = message.isFromUser;

    return Padding(
      padding: EdgeInsets.only(
        left: isUser ? 48 : 0,
        right: isUser ? 0 : 48,
        bottom: 12,
      ),
      child: Row(
        mainAxisAlignment:
            isUser ? MainAxisAlignment.end : MainAxisAlignment.start,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (!isUser) ...[
            CircleAvatar(
              radius: 16,
              backgroundColor: Theme.of(context).primaryColor.withOpacity(0.1),
              child: Icon(
                Icons.support_agent,
                size: 18,
                color: Theme.of(context).primaryColor,
              ),
            ),
            const SizedBox(width: 8),
          ],
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: isUser
                    ? Theme.of(context).primaryColor
                    : Colors.grey.shade100,
                borderRadius: BorderRadius.circular(16).copyWith(
                  bottomLeft: isUser ? null : const Radius.circular(4),
                  bottomRight: isUser ? const Radius.circular(4) : null,
                ),
              ),
              child: Text(
                message.content,
                style: TextStyle(
                  color: isUser ? Colors.white : Colors.black87,
                  fontSize: 14,
                  height: 1.4,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTypingIndicator() {
    return Padding(
      padding: const EdgeInsets.only(right: 48, bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          CircleAvatar(
            radius: 16,
            backgroundColor: Theme.of(context).primaryColor.withOpacity(0.1),
            child: Icon(
              Icons.support_agent,
              size: 18,
              color: Theme.of(context).primaryColor,
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: Colors.grey.shade100,
              borderRadius: BorderRadius.circular(16).copyWith(
                bottomLeft: const Radius.circular(4),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: List.generate(3, (index) {
                return _TypingDot(delay: index * 150);
              }),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildQuickAction(String label, IconData icon, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          border: Border.all(color: Theme.of(context).primaryColor.withOpacity(0.3)),
          borderRadius: BorderRadius.circular(20),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: Theme.of(context).primaryColor),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                color: Theme.of(context).primaryColor,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Animated typing dot
class _TypingDot extends StatefulWidget {
  final int delay;

  const _TypingDot({required this.delay});

  @override
  State<_TypingDot> createState() => _TypingDotState();
}

class _TypingDotState extends State<_TypingDot>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );

    _animation = Tween<double>(begin: 0, end: 1).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOut),
    );

    Future.delayed(Duration(milliseconds: widget.delay), () {
      if (mounted) {
        _controller.repeat(reverse: true);
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Container(
          margin: const EdgeInsets.symmetric(horizontal: 2),
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: Colors.grey.withOpacity(0.3 + (_animation.value * 0.5)),
            shape: BoxShape.circle,
          ),
        );
      },
    );
  }
}

/// Shows the OTP support chat bottom sheet
void showOtpSupportChat(
  BuildContext context, {
  required String phoneNumber,
  VoidCallback? onResendRequested,
}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => OtpSupportChat(
      phoneNumber: phoneNumber,
      onResendRequested: onResendRequested,
    ),
  );
}
