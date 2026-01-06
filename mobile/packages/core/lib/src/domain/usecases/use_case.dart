import '../../core/result/result.dart';

/// Base class for all use cases
abstract class UseCase<Type, Params> {
  Future<Result<Type>> call(Params params);
}

/// Base class for stream-based use cases
abstract class StreamUseCase<Type, Params> {
  Stream<Type> call(Params params);
}

/// Base class for stream use cases that return Result-wrapped streams
/// This allows for initial error handling before the stream is established
abstract class ResultStreamUseCase<Type, Params> {
  Future<Result<Stream<Type>>> call(Params params);
}

/// Use this class when a use case doesn't require any parameters
class NoParams {
  const NoParams();
}

