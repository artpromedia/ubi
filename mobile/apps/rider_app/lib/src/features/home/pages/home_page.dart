import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';
import '../../connectivity/bloc/connectivity_bloc.dart';

/// Home page with bottom navigation shell for rides, food, delivery
class HomePage extends StatefulWidget {
  final Widget child;

  const HomePage({
    super.key,
    required this.child,
  });

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    return BlocListener<ConnectivityBloc, ConnectivityState>(
      listener: (context, state) {
        if (state is ConnectivityOffline) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Row(
                children: [
                  const Icon(Icons.wifi_off, color: Colors.white),
                  const SizedBox(width: 8),
                  const Text('No internet connection'),
                ],
              ),
              backgroundColor: Colors.orange,
              duration: const Duration(seconds: 5),
              action: SnackBarAction(
                label: 'Dismiss',
                textColor: Colors.white,
                onPressed: () {},
              ),
            ),
          );
        }
      },
      child: Scaffold(
        body: widget.child,
        bottomNavigationBar: NavigationBar(
          selectedIndex: _calculateSelectedIndex(context),
          onDestinationSelected: (index) => _onItemTapped(index, context),
          destinations: const [
            NavigationDestination(
              icon: Icon(Icons.local_taxi_outlined),
              selectedIcon: Icon(Icons.local_taxi),
              label: 'Ride',
            ),
            NavigationDestination(
              icon: Icon(Icons.restaurant_outlined),
              selectedIcon: Icon(Icons.restaurant),
              label: 'Food',
            ),
            NavigationDestination(
              icon: Icon(Icons.local_shipping_outlined),
              selectedIcon: Icon(Icons.local_shipping),
              label: 'Delivery',
            ),
            NavigationDestination(
              icon: Icon(Icons.person_outline),
              selectedIcon: Icon(Icons.person),
              label: 'Profile',
            ),
          ],
        ),
      ),
    );
  }

  int _calculateSelectedIndex(BuildContext context) {
    final location = GoRouterState.of(context).uri.path;
    
    if (location.startsWith('/home/ride')) {
      return 0;
    }
    if (location.startsWith('/home/food')) {
      return 1;
    }
    if (location.startsWith('/home/delivery')) {
      return 2;
    }
    if (location.startsWith('/profile')) {
      return 3;
    }
    return 0;
  }

  void _onItemTapped(int index, BuildContext context) {
    switch (index) {
      case 0:
        context.go(Routes.rideSearch);
        break;
      case 1:
        context.go(Routes.foodRestaurants);
        break;
      case 2:
        context.go(Routes.deliveryNew);
        break;
      case 3:
        context.go(Routes.profile);
        break;
    }
  }
}
