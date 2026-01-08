/// Mock Data Generators
///
/// Generates realistic test data for E2E tests including rides, orders, users.
library;

import 'dart:math';

import 'test_config.dart';

/// Mock data generator for E2E tests
class MockDataGenerator {
  static final _random = Random();

  /// Generate a unique ID
  static String generateId({String prefix = ''}) {
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final random = _random.nextInt(99999).toString().padLeft(5, '0');
    return prefix.isEmpty ? '${timestamp}_$random' : '${prefix}_${timestamp}_$random';
  }

  /// Generate a random phone number
  static String generatePhoneNumber() {
    final number = 700000000 + _random.nextInt(99999999);
    return '+254$number';
  }

  /// Generate a random email
  static String generateEmail({String? name}) {
    final userName = name?.toLowerCase().replaceAll(' ', '.') ??
        'user${_random.nextInt(9999)}';
    return '$userName@test.ubi.co.ke';
  }

  /// Generate test ride data
  static MockRideData generateRide({
    TestLocation? pickup,
    TestLocation? dropoff,
    String? vehicleType,
    MockRideStatus? status,
  }) {
    return MockRideData(
      id: generateId(prefix: 'ride'),
      pickup: pickup ?? TestLocations.nairobiCbd,
      dropoff: dropoff ?? TestLocations.westlands,
      vehicleType: vehicleType ?? _randomVehicleType(),
      status: status ?? MockRideStatus.searching,
      fare: _generateFare(pickup, dropoff),
      driver: generateDriver(),
      estimatedDuration: _estimateDuration(pickup, dropoff),
      estimatedArrival: _estimateArrival(),
    );
  }

  /// Generate test driver data
  static MockDriverData generateDriver() {
    final firstName = _firstNames[_random.nextInt(_firstNames.length)];
    final lastName = _lastNames[_random.nextInt(_lastNames.length)];

    return MockDriverData(
      id: generateId(prefix: 'driver'),
      name: '$firstName $lastName',
      phoneNumber: generatePhoneNumber(),
      rating: 4.0 + _random.nextDouble(),
      totalTrips: 100 + _random.nextInt(5000),
      vehicleMake: _vehicleMakes[_random.nextInt(_vehicleMakes.length)],
      vehicleModel: _vehicleModels[_random.nextInt(_vehicleModels.length)],
      vehicleColor: _vehicleColors[_random.nextInt(_vehicleColors.length)],
      licensePlate: _generateLicensePlate(),
      photoUrl: 'https://randomuser.me/api/portraits/men/${_random.nextInt(99)}.jpg',
    );
  }

  /// Generate test restaurant data
  static MockRestaurantData generateRestaurant({int? itemCount}) {
    final name = _restaurantNames[_random.nextInt(_restaurantNames.length)];
    final cuisine = _cuisineTypes[_random.nextInt(_cuisineTypes.length)];
    final items = List.generate(
      itemCount ?? (5 + _random.nextInt(15)),
      (_) => generateMenuItem(),
    );

    return MockRestaurantData(
      id: generateId(prefix: 'restaurant'),
      name: name,
      cuisine: cuisine,
      rating: 3.5 + _random.nextDouble() * 1.5,
      deliveryTime: '${20 + _random.nextInt(30)}-${40 + _random.nextInt(20)} min',
      deliveryFee: 50 + _random.nextInt(150),
      minOrder: 200 + _random.nextInt(300),
      isOpen: true,
      menuItems: items,
      location: TestLocations.testRestaurant,
    );
  }

  /// Generate test menu item
  static MockMenuItemData generateMenuItem() {
    return MockMenuItemData(
      id: generateId(prefix: 'item'),
      name: _menuItems[_random.nextInt(_menuItems.length)],
      description: 'Delicious ${_menuItems[_random.nextInt(_menuItems.length)]}',
      price: 100 + _random.nextInt(900),
      imageUrl: 'https://source.unsplash.com/random/300x300/?food',
      isAvailable: _random.nextDouble() > 0.1,
      preparationTime: '${10 + _random.nextInt(20)} min',
    );
  }

  /// Generate test food order
  static MockFoodOrderData generateFoodOrder({
    MockRestaurantData? restaurant,
    MockFoodOrderStatus? status,
  }) {
    final rest = restaurant ?? generateRestaurant();
    final items = List.generate(
      1 + _random.nextInt(3),
      (_) => MockOrderItem(
        menuItem: rest.menuItems[_random.nextInt(rest.menuItems.length)],
        quantity: 1 + _random.nextInt(2),
      ),
    );

    final subtotal = items.fold<int>(
      0,
      (sum, item) => sum + (item.menuItem.price * item.quantity),
    );

    return MockFoodOrderData(
      id: generateId(prefix: 'order'),
      restaurant: rest,
      items: items,
      status: status ?? MockFoodOrderStatus.pending,
      subtotal: subtotal,
      deliveryFee: rest.deliveryFee,
      total: subtotal + rest.deliveryFee,
      estimatedDelivery: '${30 + _random.nextInt(20)} min',
    );
  }

  /// Generate test delivery package
  static MockDeliveryData generateDelivery({
    TestLocation? pickup,
    TestLocation? dropoff,
    MockDeliveryStatus? status,
  }) {
    return MockDeliveryData(
      id: generateId(prefix: 'delivery'),
      pickup: pickup ?? TestLocations.nairobiCbd,
      dropoff: dropoff ?? TestLocations.karen,
      status: status ?? MockDeliveryStatus.pending,
      packageDescription: _packageDescriptions[_random.nextInt(_packageDescriptions.length)],
      packageSize: _packageSizes[_random.nextInt(_packageSizes.length)],
      price: 200 + _random.nextInt(500),
      estimatedDuration: _estimateDuration(pickup, dropoff),
      senderName: '${_firstNames[_random.nextInt(_firstNames.length)]}',
      recipientName: '${_firstNames[_random.nextInt(_firstNames.length)]}',
      recipientPhone: generatePhoneNumber(),
    );
  }

  // Private helpers
  static String _randomVehicleType() {
    const types = ['economy', 'comfort', 'premium', 'xl'];
    return types[_random.nextInt(types.length)];
  }

  static MockFareData _generateFare(TestLocation? pickup, TestLocation? dropoff) {
    final baseFare = 100 + _random.nextInt(100);
    final distance = _calculateDistance(pickup, dropoff);
    final distanceFare = (distance * 30).round();
    final timeFare = (distance * 2).round();

    return MockFareData(
      baseFare: baseFare,
      distanceFare: distanceFare,
      timeFare: timeFare,
      surgeFare: _random.nextDouble() > 0.7 ? (baseFare * 0.5).round() : 0,
      total: baseFare + distanceFare + timeFare,
      currency: 'KES',
    );
  }

  static double _calculateDistance(TestLocation? pickup, TestLocation? dropoff) {
    // Simplified distance calculation
    if (pickup == null || dropoff == null) return 5.0;
    final latDiff = (pickup.latitude - dropoff.latitude).abs();
    final lngDiff = (pickup.longitude - dropoff.longitude).abs();
    return sqrt(latDiff * latDiff + lngDiff * lngDiff) * 111; // Rough km conversion
  }

  static String _estimateDuration(TestLocation? pickup, TestLocation? dropoff) {
    final distance = _calculateDistance(pickup, dropoff);
    final minutes = (distance / 0.5).round(); // Assuming 30 km/h average
    return '$minutes min';
  }

  static String _estimateArrival() {
    return '${3 + _random.nextInt(7)} min';
  }

  static String _generateLicensePlate() {
    const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    final l1 = letters[_random.nextInt(letters.length)];
    final l2 = letters[_random.nextInt(letters.length)];
    final l3 = letters[_random.nextInt(letters.length)];
    final num = _random.nextInt(999).toString().padLeft(3, '0');
    return 'K$l1$l2 $num$l3';
  }

  // Data lists
  static const _firstNames = [
    'James', 'John', 'Peter', 'David', 'Michael',
    'Mary', 'Grace', 'Faith', 'Joy', 'Hope',
  ];

  static const _lastNames = [
    'Kamau', 'Mwangi', 'Ochieng', 'Wanjiru', 'Kimani',
    'Njeri', 'Otieno', 'Akinyi', 'Mutua', 'Kipchoge',
  ];

  static const _vehicleMakes = ['Toyota', 'Honda', 'Nissan', 'Mazda', 'Suzuki'];
  static const _vehicleModels = ['Vitz', 'Fit', 'Note', 'Demio', 'Swift'];
  static const _vehicleColors = ['White', 'Silver', 'Black', 'Blue', 'Red'];

  static const _restaurantNames = [
    'Mama\'s Kitchen',
    'Nyama Choma Palace',
    'Nairobi Bites',
    'Safari Grill',
    'Urban Eats',
  ];

  static const _cuisineTypes = [
    'Kenyan',
    'Indian',
    'Chinese',
    'Italian',
    'Fast Food',
  ];

  static const _menuItems = [
    'Ugali & Sukuma',
    'Nyama Choma',
    'Pilau',
    'Chapati',
    'Samosa',
    'Mandazi',
    'Chicken Curry',
    'Beef Stew',
  ];

  static const _packageDescriptions = [
    'Documents',
    'Electronics',
    'Clothing',
    'Food Package',
    'Gift Box',
  ];

  static const _packageSizes = ['Small', 'Medium', 'Large'];
}

// Mock data models
enum MockRideStatus {
  searching,
  driverAssigned,
  driverEnRoute,
  driverArrived,
  inProgress,
  completed,
  cancelled,
}

enum MockFoodOrderStatus {
  pending,
  confirmed,
  preparing,
  readyForPickup,
  pickedUp,
  delivered,
  cancelled,
}

enum MockDeliveryStatus {
  pending,
  confirmed,
  pickedUp,
  inTransit,
  delivered,
  cancelled,
}

class MockRideData {
  final String id;
  final TestLocation pickup;
  final TestLocation dropoff;
  final String vehicleType;
  final MockRideStatus status;
  final MockFareData fare;
  final MockDriverData driver;
  final String estimatedDuration;
  final String estimatedArrival;

  MockRideData({
    required this.id,
    required this.pickup,
    required this.dropoff,
    required this.vehicleType,
    required this.status,
    required this.fare,
    required this.driver,
    required this.estimatedDuration,
    required this.estimatedArrival,
  });
}

class MockFareData {
  final int baseFare;
  final int distanceFare;
  final int timeFare;
  final int surgeFare;
  final int total;
  final String currency;

  MockFareData({
    required this.baseFare,
    required this.distanceFare,
    required this.timeFare,
    required this.surgeFare,
    required this.total,
    required this.currency,
  });

  String get displayTotal => '$currency $total';
}

class MockDriverData {
  final String id;
  final String name;
  final String phoneNumber;
  final double rating;
  final int totalTrips;
  final String vehicleMake;
  final String vehicleModel;
  final String vehicleColor;
  final String licensePlate;
  final String photoUrl;

  MockDriverData({
    required this.id,
    required this.name,
    required this.phoneNumber,
    required this.rating,
    required this.totalTrips,
    required this.vehicleMake,
    required this.vehicleModel,
    required this.vehicleColor,
    required this.licensePlate,
    required this.photoUrl,
  });

  String get vehicleDescription => '$vehicleColor $vehicleMake $vehicleModel';
}

class MockRestaurantData {
  final String id;
  final String name;
  final String cuisine;
  final double rating;
  final String deliveryTime;
  final int deliveryFee;
  final int minOrder;
  final bool isOpen;
  final List<MockMenuItemData> menuItems;
  final TestLocation location;

  MockRestaurantData({
    required this.id,
    required this.name,
    required this.cuisine,
    required this.rating,
    required this.deliveryTime,
    required this.deliveryFee,
    required this.minOrder,
    required this.isOpen,
    required this.menuItems,
    required this.location,
  });
}

class MockMenuItemData {
  final String id;
  final String name;
  final String description;
  final int price;
  final String imageUrl;
  final bool isAvailable;
  final String preparationTime;

  MockMenuItemData({
    required this.id,
    required this.name,
    required this.description,
    required this.price,
    required this.imageUrl,
    required this.isAvailable,
    required this.preparationTime,
  });
}

class MockOrderItem {
  final MockMenuItemData menuItem;
  final int quantity;

  MockOrderItem({
    required this.menuItem,
    required this.quantity,
  });

  int get totalPrice => menuItem.price * quantity;
}

class MockFoodOrderData {
  final String id;
  final MockRestaurantData restaurant;
  final List<MockOrderItem> items;
  final MockFoodOrderStatus status;
  final int subtotal;
  final int deliveryFee;
  final int total;
  final String estimatedDelivery;

  MockFoodOrderData({
    required this.id,
    required this.restaurant,
    required this.items,
    required this.status,
    required this.subtotal,
    required this.deliveryFee,
    required this.total,
    required this.estimatedDelivery,
  });
}

class MockDeliveryData {
  final String id;
  final TestLocation pickup;
  final TestLocation dropoff;
  final MockDeliveryStatus status;
  final String packageDescription;
  final String packageSize;
  final int price;
  final String estimatedDuration;
  final String senderName;
  final String recipientName;
  final String recipientPhone;

  MockDeliveryData({
    required this.id,
    required this.pickup,
    required this.dropoff,
    required this.status,
    required this.packageDescription,
    required this.packageSize,
    required this.price,
    required this.estimatedDuration,
    required this.senderName,
    required this.recipientName,
    required this.recipientPhone,
  });
}
