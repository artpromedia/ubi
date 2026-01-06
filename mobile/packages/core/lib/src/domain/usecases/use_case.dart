import '../../core/result/result.dart';

/// Base class for all use cases
abstract class UseCase<Type, Params> {
  Future<Result<Type>> call(Params params);
}

/// Base class for stream-based use cases
abstract class StreamUseCase<Type, Params> {
  Stream<Type> call(Params params);
}

/// Use this class when a use case doesn't require any parameters
class NoParams {
  const NoParams();
}

