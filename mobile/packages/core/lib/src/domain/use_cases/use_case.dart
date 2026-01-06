import '../result/result.dart';

/// Base use case interface
abstract class UseCase<Type, Params> {
  /// Execute the use case
  Future<Result<Type>> call(Params params);
}

/// Use case without parameters
abstract class NoParamsUseCase<Type> {
  /// Execute the use case
  Future<Result<Type>> call();
}

/// Stream use case interface
abstract class StreamUseCase<Type, Params> {
  /// Execute the use case and return a stream
  Stream<Result<Type>> call(Params params);
}

/// Stream use case without parameters
abstract class NoParamsStreamUseCase<Type> {
  /// Execute the use case and return a stream
  Stream<Result<Type>> call();
}

/// Synchronous use case interface
abstract class SyncUseCase<Type, Params> {
  /// Execute the use case synchronously
  Result<Type> call(Params params);
}

/// Synchronous use case without parameters
abstract class NoParamsSyncUseCase<Type> {
  /// Execute the use case synchronously
  Result<Type> call();
}

/// No parameters marker class
class NoParams {
  const NoParams();
}

/// Represents no parameters for use cases
const noParams = NoParams();

