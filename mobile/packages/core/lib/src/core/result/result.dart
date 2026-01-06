import 'package:freezed_annotation/freezed_annotation.dart';
import '../errors/failures.dart';

part 'result.freezed.dart';

/// Result type for handling success and failure cases
@freezed
sealed class Result<T> with _$Result<T> {
  const Result._();

  /// Success case with data
  const factory Result.success(T data) = Success<T>;

  /// Failure case with failure info
  const factory Result.failure(Failure failure) = Fail<T>;

  /// Check if result is success
  bool get isSuccess => this is Success<T>;

  /// Check if result is failure
  bool get isFailure => this is Fail<T>;

  /// Get data or null
  T? get dataOrNull => when(
        success: (data) => data,
        failure: (_) => null,
      );

  /// Get failure or null
  Failure? get failureOrNull => when(
        success: (_) => null,
        failure: (failure) => failure,
      );

  /// Get data or throw
  T get dataOrThrow {
    return when(
      success: (data) => data,
      failure: (failure) => throw ResultException(failure),
    );
  }

  /// Map success value to a new type
  Result<R> mapData<R>(R Function(T data) mapper) {
    return when(
      success: (data) => Result.success(mapper(data)),
      failure: (failure) => Result.failure(failure),
    );
  }

  /// Flat map success value
  Result<R> flatMap<R>(Result<R> Function(T data) mapper) {
    return when(
      success: (data) => mapper(data),
      failure: (failure) => Result.failure(failure),
    );
  }

  /// Handle both cases
  R fold<R>({
    required R Function(T data) onSuccess,
    required R Function(Failure failure) onFailure,
  }) {
    return when(
      success: onSuccess,
      failure: onFailure,
    );
  }

  /// Execute action on success
  Result<T> onSuccess(void Function(T data) action) {
    when(
      success: (data) => action(data),
      failure: (_) {},
    );
    return this;
  }

  /// Execute action on failure
  Result<T> onFailure(void Function(Failure failure) action) {
    when(
      success: (_) {},
      failure: (failure) => action(failure),
    );
    return this;
  }

  /// Get data or default value
  T getOrElse(T defaultValue) {
    return when(
      success: (data) => data,
      failure: (_) => defaultValue,
    );
  }

  /// Get data or compute default
  T getOrElseCompute(T Function() compute) {
    return when(
      success: (data) => data,
      failure: (_) => compute(),
    );
  }

  /// Recover from failure
  Result<T> recover(Result<T> Function(Failure failure) recovery) {
    return when(
      success: (data) => Result.success(data),
      failure: (failure) => recovery(failure),
    );
  }

  /// Convert to Future
  Future<T> toFuture() {
    return when(
      success: (data) => Future.value(data),
      failure: (failure) => Future.error(ResultException(failure)),
    );
  }
}

/// Exception wrapper for Result failures
class ResultException implements Exception {
  final Failure failure;

  const ResultException(this.failure);

  @override
  String toString() => 'ResultException: ${failure.userMessage}';
}

/// Extension for Future<Result<T>>
extension FutureResultExtension<T> on Future<Result<T>> {
  /// Map success value
  Future<Result<R>> mapSuccess<R>(R Function(T data) mapper) async {
    final result = await this;
    return result.mapData(mapper);
  }

  /// Flat map success value
  Future<Result<R>> flatMapSuccess<R>(
    Future<Result<R>> Function(T data) mapper,
  ) async {
    final result = await this;
    return result.when(
      success: (data) => mapper(data),
      failure: (failure) => Result.failure(failure),
    );
  }

  /// Execute action on success
  Future<Result<T>> doOnSuccess(void Function(T data) action) async {
    final result = await this;
    return result.onSuccess(action);
  }

  /// Execute action on failure
  Future<Result<T>> doOnFailure(void Function(Failure failure) action) async {
    final result = await this;
    return result.onFailure(action);
  }
}

/// Extension for nullable values
extension NullableToResult<T> on T? {
  /// Convert nullable to Result
  Result<T> toResult({Failure? failure}) {
    if (this != null) {
      return Result.success(this as T);
    }
    return Result.failure(failure ?? const Failure.notFound());
  }
}

/// Result helpers
class Results {
  Results._();

  /// Create success result
  static Result<T> success<T>(T data) => Result.success(data);

  /// Create failure result
  static Result<T> failure<T>(Failure failure) => Result.failure(failure);

  /// Combine multiple results
  static Result<List<T>> combine<T>(List<Result<T>> results) {
    final data = <T>[];
    for (final result in results) {
      final value = result.dataOrNull;
      if (value != null) {
        data.add(value);
      } else {
        return Result.failure(result.failureOrNull ?? const Failure.unknown());
      }
    }
    return Result.success(data);
  }

  /// Run and catch errors
  static Future<Result<T>> guard<T>(
    Future<T> Function() action, {
    Failure Function(Object error, StackTrace stackTrace)? onError,
  }) async {
    try {
      final data = await action();
      return Result.success(data);
    } catch (e, st) {
      if (onError != null) {
        return Result.failure(onError(e, st));
      }
      return Result.failure(Failure.unknown(error: e, stackTrace: st));
    }
  }

  /// Run sync and catch errors
  static Result<T> guardSync<T>(
    T Function() action, {
    Failure Function(Object error, StackTrace stackTrace)? onError,
  }) {
    try {
      final data = action();
      return Result.success(data);
    } catch (e, st) {
      if (onError != null) {
        return Result.failure(onError(e, st));
      }
      return Result.failure(Failure.unknown(error: e, stackTrace: st));
    }
  }
}
