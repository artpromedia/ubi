import '../constants/app_constants.dart';
import '../extensions/string_extensions.dart';

/// Input validators
class Validators {
  Validators._();

  /// Validate email address
  static String? email(String? value) {
    if (value == null || value.isEmpty) {
      return 'Email is required';
    }
    if (!value.isValidEmail) {
      return 'Please enter a valid email address';
    }
    return null;
  }

  /// Validate password
  static String? password(String? value) {
    if (value == null || value.isEmpty) {
      return 'Password is required';
    }
    if (value.length < AppConstants.minPasswordLength) {
      return 'Password must be at least ${AppConstants.minPasswordLength} characters';
    }
    if (value.length > AppConstants.maxPasswordLength) {
      return 'Password must be less than ${AppConstants.maxPasswordLength} characters';
    }
    return null;
  }

  /// Validate password confirmation
  static String? confirmPassword(String? value, String? password) {
    if (value == null || value.isEmpty) {
      return 'Please confirm your password';
    }
    if (value != password) {
      return 'Passwords do not match';
    }
    return null;
  }

  /// Validate phone number
  static String? phone(String? value) {
    if (value == null || value.isEmpty) {
      return 'Phone number is required';
    }
    if (!value.isValidPhone) {
      return 'Please enter a valid phone number';
    }
    return null;
  }

  /// Validate required field
  static String? required(String? value, {String fieldName = 'This field'}) {
    if (value == null || value.trim().isEmpty) {
      return '$fieldName is required';
    }
    return null;
  }

  /// Validate name
  static String? name(String? value) {
    if (value == null || value.trim().isEmpty) {
      return 'Name is required';
    }
    if (value.trim().length < 2) {
      return 'Name must be at least 2 characters';
    }
    return null;
  }

  /// Validate credit card number (basic Luhn check)
  static String? creditCard(String? value) {
    if (value == null || value.isEmpty) {
      return 'Card number is required';
    }
    
    final cleanedValue = value.removeWhitespace;
    if (cleanedValue.length < 13 || cleanedValue.length > 19) {
      return 'Please enter a valid card number';
    }
    
    // Luhn algorithm
    int sum = 0;
    bool isSecond = false;
    for (int i = cleanedValue.length - 1; i >= 0; i--) {
      int digit = int.tryParse(cleanedValue[i]) ?? -1;
      if (digit == -1) return 'Please enter a valid card number';
      
      if (isSecond) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      isSecond = !isSecond;
    }
    
    if (sum % 10 != 0) {
      return 'Please enter a valid card number';
    }
    
    return null;
  }

  /// Validate CVV
  static String? cvv(String? value) {
    if (value == null || value.isEmpty) {
      return 'CVV is required';
    }
    if (value.length < 3 || value.length > 4) {
      return 'Please enter a valid CVV';
    }
    return null;
  }

  /// Validate expiry date (MM/YY format)
  static String? expiryDate(String? value) {
    if (value == null || value.isEmpty) {
      return 'Expiry date is required';
    }
    
    final parts = value.split('/');
    if (parts.length != 2) {
      return 'Please use MM/YY format';
    }
    
    final month = int.tryParse(parts[0]);
    final year = int.tryParse(parts[1]);
    
    if (month == null || year == null) {
      return 'Please enter a valid expiry date';
    }
    
    if (month < 1 || month > 12) {
      return 'Please enter a valid month';
    }
    
    final now = DateTime.now();
    final expiryYear = 2000 + year;
    final expiry = DateTime(expiryYear, month + 1, 0);
    
    if (expiry.isBefore(now)) {
      return 'Card has expired';
    }
    
    return null;
  }
}
