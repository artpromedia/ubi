/// API endpoint constants
class ApiConstants {
  ApiConstants._();

  static const String baseUrl = 'https://api.ubi.com';
  static const String apiVersion = 'v1';
  
  // Authentication endpoints
  static const String login = '/auth/login';
  static const String register = '/auth/register';
  static const String logout = '/auth/logout';
  static const String refreshToken = '/auth/refresh';
  
  // User endpoints
  static const String users = '/users';
  static const String userProfile = '/users/me';
  
  // Ride endpoints
  static const String rides = '/rides';
  static const String rideEstimate = '/rides/estimate';
  static const String rideHistory = '/rides/history';
  
  // Food endpoints
  static const String restaurants = '/restaurants';
  static const String menu = '/menu';
  static const String foodOrders = '/food/orders';
  
  // Delivery endpoints
  static const String deliveries = '/deliveries';
  static const String deliveryEstimate = '/deliveries/estimate';
  
  // Payment endpoints
  static const String payments = '/payments';
  static const String paymentMethods = '/payments/methods';
}
