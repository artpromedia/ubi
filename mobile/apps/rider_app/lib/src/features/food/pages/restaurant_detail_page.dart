import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';

/// Restaurant detail page showing menu
class RestaurantDetailPage extends StatefulWidget {
  final String restaurantId;

  const RestaurantDetailPage({
    super.key,
    required this.restaurantId,
  });

  @override
  State<RestaurantDetailPage> createState() => _RestaurantDetailPageState();
}

class _RestaurantDetailPageState extends State<RestaurantDetailPage>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final _categories = ['Popular', 'Main Dishes', 'Sides', 'Drinks', 'Desserts'];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _categories.length, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          // App bar with restaurant image
          SliverAppBar(
            expandedHeight: 200,
            pinned: true,
            flexibleSpace: FlexibleSpaceBar(
              background: Container(
                color: Colors.grey[300],
                child: const Center(
                  child: Icon(
                    Icons.restaurant,
                    size: 64,
                    color: Colors.grey,
                  ),
                ),
              ),
            ),
            leading: IconButton(
              icon: const CircleAvatar(
                backgroundColor: Colors.white,
                child: Icon(Icons.arrow_back, color: Colors.black),
              ),
              onPressed: () => context.go(Routes.foodRestaurants),
            ),
            actions: [
              IconButton(
                icon: const CircleAvatar(
                  backgroundColor: Colors.white,
                  child: Icon(Icons.search, color: Colors.black),
                ),
                onPressed: () {
                  // Search menu
                },
              ),
              IconButton(
                icon: const CircleAvatar(
                  backgroundColor: Colors.white,
                  child: Icon(Icons.favorite_border, color: Colors.black),
                ),
                onPressed: () {
                  // Add to favorites
                },
              ),
            ],
          ),

          // Restaurant info
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Restaurant Name',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'African • Kenyan • Grilled',
                    style: TextStyle(color: Colors.grey[600]),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Icon(Icons.star, size: 20, color: Colors.amber),
                      const Text(
                        ' 4.8 (200+)',
                        style: TextStyle(fontWeight: FontWeight.bold),
                      ),
                      const SizedBox(width: 16),
                      const Icon(Icons.access_time, size: 16),
                      const Text(' 20-30 min'),
                      const SizedBox(width: 16),
                      const Icon(Icons.delivery_dining, size: 16),
                      const Text(' KES 100'),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Colors.green.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.local_offer, color: Colors.green),
                        const SizedBox(width: 8),
                        const Expanded(
                          child: Text(
                            '20% off on orders above KES 500',
                            style: TextStyle(color: Colors.green),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Category tabs
          SliverPersistentHeader(
            pinned: true,
            delegate: _TabBarDelegate(
              TabBar(
                controller: _tabController,
                isScrollable: true,
                labelColor: Theme.of(context).primaryColor,
                unselectedLabelColor: Colors.grey,
                indicatorColor: Theme.of(context).primaryColor,
                tabs: _categories.map((c) => Tab(text: c)).toList(),
              ),
            ),
          ),

          // Menu items
          SliverPadding(
            padding: const EdgeInsets.all(16),
            sliver: SliverList(
              delegate: SliverChildBuilderDelegate(
                (context, index) {
                  return _MenuItemCard(
                    name: 'Menu Item ${index + 1}',
                    description:
                        'Delicious dish with fresh ingredients and amazing flavors',
                    price: 250 + (index * 50),
                    onAdd: () {
                      // Add to cart
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Added to cart'),
                          duration: Duration(seconds: 1),
                        ),
                      );
                    },
                  );
                },
                childCount: 10,
              ),
            ),
          ),
        ],
      ),
      // Cart button
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: ElevatedButton(
            onPressed: () => context.go(Routes.foodCart),
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.shopping_cart),
                SizedBox(width: 8),
                Text('View Cart (3 items) - KES 750'),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TabBarDelegate extends SliverPersistentHeaderDelegate {
  final TabBar tabBar;

  _TabBarDelegate(this.tabBar);

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return Container(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: tabBar,
    );
  }

  @override
  double get maxExtent => tabBar.preferredSize.height;

  @override
  double get minExtent => tabBar.preferredSize.height;

  @override
  bool shouldRebuild(covariant _TabBarDelegate oldDelegate) {
    return tabBar != oldDelegate.tabBar;
  }
}

class _MenuItemCard extends StatelessWidget {
  final String name;
  final String description;
  final int price;
  final VoidCallback onAdd;

  const _MenuItemCard({
    required this.name,
    required this.description,
    required this.price,
    required this.onAdd,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    description,
                    style: TextStyle(
                      color: Colors.grey[600],
                      fontSize: 13,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'KES $price',
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Stack(
              alignment: Alignment.bottomCenter,
              children: [
                Container(
                  width: 100,
                  height: 100,
                  decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.fastfood,
                    color: Colors.grey,
                  ),
                ),
                Positioned(
                  bottom: -8,
                  child: ElevatedButton(
                    onPressed: onAdd,
                    style: ElevatedButton.styleFrom(
                      minimumSize: const Size(80, 32),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(20),
                      ),
                    ),
                    child: const Text('ADD'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
