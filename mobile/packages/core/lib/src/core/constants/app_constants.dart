/// Application-wide constants
class AppConstants {
  AppConstants._();

  // App information
  static const String appName = 'UBI';
  static const String appVersion = '1.0.0';
  
  // Timeouts
  static const Duration connectionTimeout = Duration(seconds: 30);
  static const Duration receiveTimeout = Duration(seconds: 30);
  
  // Pagination
  static const int defaultPageSize = 20;
  static const int maxPageSize = 100;
  
  // Location
  static const double defaultLatitude = 37.7749;
  static const double defaultLongitude = -122.4194;
  static const int locationUpdateIntervalMs = 5000;
  
  // Maps
  static const double defaultZoom = 15.0;
  static const double minZoom = 5.0;
  static const double maxZoom = 20.0;
  
  // Ride
  static const int maxRideSearchRadiusMeters = 5000;
  static const int driverArrivingThresholdMeters = 100;
  
  // Food
  static const int maxRestaurantSearchRadiusMeters = 10000;
  static const int minOrderAmount = 1000; // in cents
  
  // Validation
  static const int minPasswordLength = 8;
  static const int maxPasswordLength = 128;
  static const int minPhoneLength = 10;
  static const int maxPhoneLength = 15;
}
