/// UBI API Client Package
///
/// Provides HTTP client, interceptors, and API services
/// for communicating with UBI backend services.
library ubi_api_client;

// === Client ===
export 'src/client/api_client.dart';
export 'src/client/api_config.dart';

// === Interceptors ===
export 'src/interceptors/auth_interceptor.dart';
export 'src/interceptors/error_interceptor.dart';
export 'src/interceptors/retry_interceptor.dart';
export 'src/interceptors/connectivity_interceptor.dart';
export 'src/interceptors/cache_interceptor.dart';

// === Services ===
export 'src/services/auth_service.dart';
export 'src/services/user_service.dart';
export 'src/services/ride_service.dart';
export 'src/services/food_service.dart';
export 'src/services/delivery_service.dart';
export 'src/services/payment_service.dart';
export 'src/services/notification_service.dart';

// === DTOs ===
export 'src/dtos/auth_dto.dart';
export 'src/dtos/user_dto.dart';
export 'src/dtos/ride_dto.dart';
export 'src/dtos/food_dto.dart';
export 'src/dtos/payment_dto.dart';

// === Mappers ===
export 'src/mappers/user_mapper.dart';
export 'src/mappers/ride_mapper.dart';

// === DI ===
export 'src/di/api_module.dart';
