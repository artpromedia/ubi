/// UBI Core Package
///
/// Contains domain entities, repository interfaces, and shared
/// business logic for UBI mobile applications.
library ubi_core;

// === Domain Entities ===
export 'src/domain/entities/user.dart';
export 'src/domain/entities/location.dart';
export 'src/domain/entities/ride.dart';
export 'src/domain/entities/food_order.dart';
export 'src/domain/entities/delivery.dart';
export 'src/domain/entities/payment.dart';
export 'src/domain/entities/notification.dart';

// === Repository Interfaces ===
export 'src/domain/repositories/auth_repository.dart';
export 'src/domain/repositories/user_repository.dart';
export 'src/domain/repositories/ride_repository.dart';
export 'src/domain/repositories/food_repository.dart';
export 'src/domain/repositories/delivery_repository.dart';
export 'src/domain/repositories/payment_repository.dart';
export 'src/domain/repositories/location_repository.dart';
export 'src/domain/repositories/notification_repository.dart';

// === Use Cases ===
export 'src/domain/usecases/use_case.dart';
export 'src/domain/usecases/auth_usecases.dart';
export 'src/domain/usecases/user_usecases.dart';
export 'src/domain/usecases/ride_usecases.dart';
export 'src/domain/usecases/food_usecases.dart';
export 'src/domain/usecases/delivery_usecases.dart';
export 'src/domain/usecases/payment_usecases.dart';
export 'src/domain/usecases/notification_usecases.dart';

// === Failures & Exceptions ===
export 'src/core/errors/failures.dart';

// === Result Type ===
export 'src/core/result/result.dart';

// === Constants ===
export 'src/core/constants/api_constants.dart';
export 'src/core/constants/app_constants.dart';
export 'src/core/constants/storage_keys.dart';

// === Extensions ===
export 'src/core/extensions/string_extensions.dart';
export 'src/core/extensions/datetime_extensions.dart';
export 'src/core/extensions/num_extensions.dart';

// === Utils ===
export 'src/core/utils/validators.dart';
export 'src/core/utils/formatters.dart';
export 'src/core/utils/logger.dart' show UbiLogger;

// === DI ===
export 'src/di/injection.dart';
