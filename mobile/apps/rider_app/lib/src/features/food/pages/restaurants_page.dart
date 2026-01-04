import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../core/router/app_router.dart';

/// Restaurant list page
class RestaurantsPage extends StatefulWidget {
  const RestaurantsPage({super.key});

  @override
  State<RestaurantsPage> createState() => _RestaurantsPageState();
}

class _RestaurantsPageState extends State<RestaurantsPage> {
  final _searchController = TextEditingController();
  String _selectedCuisine = 'All';

  final List<String> _cuisines = [
    'All',
    'African',
    'Fast Food',
    'Indian',
    'Chinese',
    'Italian',
    'Mexican',
  ];

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            // App bar with search
            SliverAppBar(
              floating: true,
              pinned: true,
              expandedHeight: 140,
              flexibleSpace: FlexibleSpaceBar(
                background: Container(
                  color: Theme.of(context).scaffoldBackgroundColor,
                  padding: const EdgeInsets.fromLTRB(16, 60, 16, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Order Food',
                        style:
                            Theme.of(context).textTheme.headlineMedium?.copyWith(
                                  fontWeight: FontWeight.bold,
                                ),
                      ),
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          const Icon(
                            Icons.location_on,
                            size: 16,
                            color: Colors.grey,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            'Delivering to: Westlands',
                            style: TextStyle(color: Colors.grey[600]),
                          ),
                          const Icon(Icons.arrow_drop_down),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // Search bar
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: TextField(
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Search restaurants or dishes',
                    prefixIcon: const Icon(Icons.search),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 12,
                    ),
                  ),
                ),
              ),
            ),

            // Cuisine filters
            SliverToBoxAdapter(
              child: SizedBox(
                height: 48,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: _cuisines.length,
                  itemBuilder: (context, index) {
                    final cuisine = _cuisines[index];
                    final isSelected = cuisine == _selectedCuisine;
                    return Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: FilterChip(
                        label: Text(cuisine),
                        selected: isSelected,
                        onSelected: (selected) {
                          setState(() {
                            _selectedCuisine = cuisine;
                          });
                        },
                      ),
                    );
                  },
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 16)),

            // Featured section
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  'Featured',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 12)),

            // Featured restaurants horizontal scroll
            SliverToBoxAdapter(
              child: SizedBox(
                height: 200,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: 5,
                  itemBuilder: (context, index) {
                    return _FeaturedRestaurantCard(
                      name: 'Restaurant ${index + 1}',
                      cuisine: _cuisines[index % _cuisines.length],
                      rating: 4.5 + (index * 0.1),
                      deliveryTime: '20-30 min',
                      onTap: () => context.go('${Routes.foodRestaurants}/$index'),
                    );
                  },
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 24)),

            // All restaurants section
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Text(
                  'All Restaurants',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 12)),

            // Restaurant list
            SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              sliver: SliverList(
                delegate: SliverChildBuilderDelegate(
                  (context, index) {
                    return _RestaurantListTile(
                      name: 'Restaurant ${index + 1}',
                      cuisine: _cuisines[index % _cuisines.length],
                      rating: 4.0 + (index * 0.1),
                      deliveryTime: '${15 + index * 5}-${25 + index * 5} min',
                      deliveryFee: index == 0 ? 'Free delivery' : 'KES ${50 + index * 10}',
                      onTap: () => context.go('${Routes.foodRestaurants}/$index'),
                    );
                  },
                  childCount: 10,
                ),
              ),
            ),

            const SliverToBoxAdapter(child: SizedBox(height: 24)),
          ],
        ),
      ),
    );
  }
}

class _FeaturedRestaurantCard extends StatelessWidget {
  final String name;
  final String cuisine;
  final double rating;
  final String deliveryTime;
  final VoidCallback onTap;

  const _FeaturedRestaurantCard({
    required this.name,
    required this.cuisine,
    required this.rating,
    required this.deliveryTime,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(right: 16),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          width: 280,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Image placeholder
              Container(
                height: 120,
                color: Colors.grey[300],
                child: const Center(
                  child: Icon(
                    Icons.restaurant,
                    size: 48,
                    color: Colors.grey,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(12),
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
                    Row(
                      children: [
                        Text(
                          cuisine,
                          style: TextStyle(color: Colors.grey[600]),
                        ),
                        const SizedBox(width: 8),
                        const Icon(Icons.star, size: 16, color: Colors.amber),
                        Text(' $rating'),
                        const Spacer(),
                        const Icon(Icons.access_time, size: 14),
                        Text(' $deliveryTime'),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _RestaurantListTile extends StatelessWidget {
  final String name;
  final String cuisine;
  final double rating;
  final String deliveryTime;
  final String deliveryFee;
  final VoidCallback onTap;

  const _RestaurantListTile({
    required this.name,
    required this.cuisine,
    required this.rating,
    required this.deliveryTime,
    required this.deliveryFee,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              // Image placeholder
              Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  color: Colors.grey[300],
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(
                  Icons.restaurant,
                  color: Colors.grey,
                ),
              ),
              const SizedBox(width: 12),
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
                      cuisine,
                      style: TextStyle(color: Colors.grey[600]),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(Icons.star, size: 16, color: Colors.amber),
                        Text(' $rating'),
                        const SizedBox(width: 12),
                        const Icon(Icons.access_time, size: 14),
                        Text(' $deliveryTime'),
                        const Spacer(),
                        Text(
                          deliveryFee,
                          style: TextStyle(
                            color: deliveryFee == 'Free delivery'
                                ? Colors.green
                                : Colors.grey[600],
                            fontWeight: deliveryFee == 'Free delivery'
                                ? FontWeight.bold
                                : FontWeight.normal,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
