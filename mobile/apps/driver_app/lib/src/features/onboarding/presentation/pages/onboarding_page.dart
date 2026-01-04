import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';

/// Onboarding screen for new drivers
class OnboardingPage extends StatefulWidget {
  const OnboardingPage({super.key});

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> {
  final PageController _pageController = PageController();
  int _currentPage = 0;

  final List<OnboardingItem> _items = [
    OnboardingItem(
      icon: Icons.monetization_on,
      title: 'Earn on Your Schedule',
      description:
          'Drive whenever you want. Be your own boss and earn money on your terms.',
      color: const Color(0xFF00A86B),
    ),
    OnboardingItem(
      icon: Icons.local_shipping,
      title: 'Multiple Services',
      description:
          'Earn from rides, food delivery, and package delivery all in one app.',
      color: const Color(0xFF2196F3),
    ),
    OnboardingItem(
      icon: Icons.navigation,
      title: 'Smart Navigation',
      description:
          'Get turn-by-turn navigation to pickups and drop-offs with real-time traffic updates.',
      color: const Color(0xFFFF9800),
    ),
    OnboardingItem(
      icon: Icons.account_balance_wallet,
      title: 'Fast Payouts',
      description:
          'Get paid weekly or request instant payouts directly to your bank account.',
      color: const Color(0xFF9C27B0),
    ),
  ];

  void _nextPage() {
    if (_currentPage < _items.length - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    } else {
      _completeOnboarding();
    }
  }

  void _completeOnboarding() {
    // Mark onboarding as complete
    context.go(AppRoutes.login);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // Skip button
            Align(
              alignment: Alignment.topRight,
              child: TextButton(
                onPressed: _completeOnboarding,
                child: const Text('Skip'),
              ),
            ),

            // Page view
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                onPageChanged: (index) {
                  setState(() => _currentPage = index);
                },
                itemCount: _items.length,
                itemBuilder: (context, index) {
                  return _OnboardingPageView(item: _items[index]);
                },
              ),
            ),

            // Page indicators
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(
                _items.length,
                (index) => Container(
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  width: _currentPage == index ? 24 : 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: _currentPage == index
                        ? Theme.of(context).primaryColor
                        : Colors.grey.shade300,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 32),

            // Next button
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: SizedBox(
                width: double.infinity,
                height: 56,
                child: ElevatedButton(
                  onPressed: _nextPage,
                  child: Text(
                    _currentPage == _items.length - 1 ? 'Get Started' : 'Next',
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),

            // Already have account
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('Already a partner?'),
                TextButton(
                  onPressed: () => context.go(AppRoutes.login),
                  child: const Text('Sign In'),
                ),
              ],
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }
}

class _OnboardingPageView extends StatelessWidget {
  const _OnboardingPageView({required this.item});

  final OnboardingItem item;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 160,
            height: 160,
            decoration: BoxDecoration(
              color: item.color.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              item.icon,
              size: 80,
              color: item.color,
            ),
          ),
          const SizedBox(height: 48),
          Text(
            item.title,
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          Text(
            item.description,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Colors.grey.shade600,
                ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

class OnboardingItem {
  OnboardingItem({
    required this.icon,
    required this.title,
    required this.description,
    required this.color,
  });

  final IconData icon;
  final String title;
  final String description;
  final Color color;
}
