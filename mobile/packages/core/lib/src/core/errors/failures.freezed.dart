// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'failures.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

/// @nodoc
mixin _$Failure {
  String? get message => throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) =>
      throw _privateConstructorUsedError;
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) =>
      throw _privateConstructorUsedError;

  @JsonKey(ignore: true)
  $FailureCopyWith<Failure> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $FailureCopyWith<$Res> {
  factory $FailureCopyWith(Failure value, $Res Function(Failure) then) =
      _$FailureCopyWithImpl<$Res, Failure>;
  @useResult
  $Res call({String? message});
}

/// @nodoc
class _$FailureCopyWithImpl<$Res, $Val extends Failure>
    implements $FailureCopyWith<$Res> {
  _$FailureCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
  }) {
    return _then(_value.copyWith(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$ServerFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$ServerFailureImplCopyWith(
          _$ServerFailureImpl value, $Res Function(_$ServerFailureImpl) then) =
      __$$ServerFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message, int? statusCode, String? errorCode});
}

/// @nodoc
class __$$ServerFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$ServerFailureImpl>
    implements _$$ServerFailureImplCopyWith<$Res> {
  __$$ServerFailureImplCopyWithImpl(
      _$ServerFailureImpl _value, $Res Function(_$ServerFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
    Object? statusCode = freezed,
    Object? errorCode = freezed,
  }) {
    return _then(_$ServerFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
      statusCode: freezed == statusCode
          ? _value.statusCode
          : statusCode // ignore: cast_nullable_to_non_nullable
              as int?,
      errorCode: freezed == errorCode
          ? _value.errorCode
          : errorCode // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc

class _$ServerFailureImpl extends ServerFailure {
  const _$ServerFailureImpl({this.message, this.statusCode, this.errorCode})
      : super._();

  @override
  final String? message;
  @override
  final int? statusCode;
  @override
  final String? errorCode;

  @override
  String toString() {
    return 'Failure.server(message: $message, statusCode: $statusCode, errorCode: $errorCode)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ServerFailureImpl &&
            (identical(other.message, message) || other.message == message) &&
            (identical(other.statusCode, statusCode) ||
                other.statusCode == statusCode) &&
            (identical(other.errorCode, errorCode) ||
                other.errorCode == errorCode));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message, statusCode, errorCode);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$ServerFailureImplCopyWith<_$ServerFailureImpl> get copyWith =>
      __$$ServerFailureImplCopyWithImpl<_$ServerFailureImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return server(message, statusCode, errorCode);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return server?.call(message, statusCode, errorCode);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (server != null) {
      return server(message, statusCode, errorCode);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return server(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return server?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (server != null) {
      return server(this);
    }
    return orElse();
  }
}

abstract class ServerFailure extends Failure {
  const factory ServerFailure(
      {final String? message,
      final int? statusCode,
      final String? errorCode}) = _$ServerFailureImpl;
  const ServerFailure._() : super._();

  @override
  String? get message;
  int? get statusCode;
  String? get errorCode;
  @override
  @JsonKey(ignore: true)
  _$$ServerFailureImplCopyWith<_$ServerFailureImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$NetworkFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$NetworkFailureImplCopyWith(_$NetworkFailureImpl value,
          $Res Function(_$NetworkFailureImpl) then) =
      __$$NetworkFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message});
}

/// @nodoc
class __$$NetworkFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$NetworkFailureImpl>
    implements _$$NetworkFailureImplCopyWith<$Res> {
  __$$NetworkFailureImplCopyWithImpl(
      _$NetworkFailureImpl _value, $Res Function(_$NetworkFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
  }) {
    return _then(_$NetworkFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc

class _$NetworkFailureImpl extends NetworkFailure {
  const _$NetworkFailureImpl({this.message}) : super._();

  @override
  final String? message;

  @override
  String toString() {
    return 'Failure.network(message: $message)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$NetworkFailureImpl &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$NetworkFailureImplCopyWith<_$NetworkFailureImpl> get copyWith =>
      __$$NetworkFailureImplCopyWithImpl<_$NetworkFailureImpl>(
          this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return network(message);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return network?.call(message);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (network != null) {
      return network(message);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return network(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return network?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (network != null) {
      return network(this);
    }
    return orElse();
  }
}

abstract class NetworkFailure extends Failure {
  const factory NetworkFailure({final String? message}) = _$NetworkFailureImpl;
  const NetworkFailure._() : super._();

  @override
  String? get message;
  @override
  @JsonKey(ignore: true)
  _$$NetworkFailureImplCopyWith<_$NetworkFailureImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$AuthenticationFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$AuthenticationFailureImplCopyWith(
          _$AuthenticationFailureImpl value,
          $Res Function(_$AuthenticationFailureImpl) then) =
      __$$AuthenticationFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message, String? errorCode});
}

/// @nodoc
class __$$AuthenticationFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$AuthenticationFailureImpl>
    implements _$$AuthenticationFailureImplCopyWith<$Res> {
  __$$AuthenticationFailureImplCopyWithImpl(_$AuthenticationFailureImpl _value,
      $Res Function(_$AuthenticationFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
    Object? errorCode = freezed,
  }) {
    return _then(_$AuthenticationFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
      errorCode: freezed == errorCode
          ? _value.errorCode
          : errorCode // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc

class _$AuthenticationFailureImpl extends AuthenticationFailure {
  const _$AuthenticationFailureImpl({this.message, this.errorCode}) : super._();

  @override
  final String? message;
  @override
  final String? errorCode;

  @override
  String toString() {
    return 'Failure.authentication(message: $message, errorCode: $errorCode)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AuthenticationFailureImpl &&
            (identical(other.message, message) || other.message == message) &&
            (identical(other.errorCode, errorCode) ||
                other.errorCode == errorCode));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message, errorCode);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$AuthenticationFailureImplCopyWith<_$AuthenticationFailureImpl>
      get copyWith => __$$AuthenticationFailureImplCopyWithImpl<
          _$AuthenticationFailureImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return authentication(message, errorCode);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return authentication?.call(message, errorCode);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (authentication != null) {
      return authentication(message, errorCode);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return authentication(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return authentication?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (authentication != null) {
      return authentication(this);
    }
    return orElse();
  }
}

abstract class AuthenticationFailure extends Failure {
  const factory AuthenticationFailure(
      {final String? message,
      final String? errorCode}) = _$AuthenticationFailureImpl;
  const AuthenticationFailure._() : super._();

  @override
  String? get message;
  String? get errorCode;
  @override
  @JsonKey(ignore: true)
  _$$AuthenticationFailureImplCopyWith<_$AuthenticationFailureImpl>
      get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$AuthorizationFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$AuthorizationFailureImplCopyWith(_$AuthorizationFailureImpl value,
          $Res Function(_$AuthorizationFailureImpl) then) =
      __$$AuthorizationFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message});
}

/// @nodoc
class __$$AuthorizationFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$AuthorizationFailureImpl>
    implements _$$AuthorizationFailureImplCopyWith<$Res> {
  __$$AuthorizationFailureImplCopyWithImpl(_$AuthorizationFailureImpl _value,
      $Res Function(_$AuthorizationFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
  }) {
    return _then(_$AuthorizationFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc

class _$AuthorizationFailureImpl extends AuthorizationFailure {
  const _$AuthorizationFailureImpl({this.message}) : super._();

  @override
  final String? message;

  @override
  String toString() {
    return 'Failure.authorization(message: $message)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AuthorizationFailureImpl &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$AuthorizationFailureImplCopyWith<_$AuthorizationFailureImpl>
      get copyWith =>
          __$$AuthorizationFailureImplCopyWithImpl<_$AuthorizationFailureImpl>(
              this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return authorization(message);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return authorization?.call(message);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (authorization != null) {
      return authorization(message);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return authorization(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return authorization?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (authorization != null) {
      return authorization(this);
    }
    return orElse();
  }
}

abstract class AuthorizationFailure extends Failure {
  const factory AuthorizationFailure({final String? message}) =
      _$AuthorizationFailureImpl;
  const AuthorizationFailure._() : super._();

  @override
  String? get message;
  @override
  @JsonKey(ignore: true)
  _$$AuthorizationFailureImplCopyWith<_$AuthorizationFailureImpl>
      get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$ValidationFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$ValidationFailureImplCopyWith(_$ValidationFailureImpl value,
          $Res Function(_$ValidationFailureImpl) then) =
      __$$ValidationFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message, Map<String, List<String>>? fieldErrors});
}

/// @nodoc
class __$$ValidationFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$ValidationFailureImpl>
    implements _$$ValidationFailureImplCopyWith<$Res> {
  __$$ValidationFailureImplCopyWithImpl(_$ValidationFailureImpl _value,
      $Res Function(_$ValidationFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
    Object? fieldErrors = freezed,
  }) {
    return _then(_$ValidationFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
      fieldErrors: freezed == fieldErrors
          ? _value._fieldErrors
          : fieldErrors // ignore: cast_nullable_to_non_nullable
              as Map<String, List<String>>?,
    ));
  }
}

/// @nodoc

class _$ValidationFailureImpl extends ValidationFailure {
  const _$ValidationFailureImpl(
      {this.message, final Map<String, List<String>>? fieldErrors})
      : _fieldErrors = fieldErrors,
        super._();

  @override
  final String? message;
  final Map<String, List<String>>? _fieldErrors;
  @override
  Map<String, List<String>>? get fieldErrors {
    final value = _fieldErrors;
    if (value == null) return null;
    if (_fieldErrors is EqualUnmodifiableMapView) return _fieldErrors;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableMapView(value);
  }

  @override
  String toString() {
    return 'Failure.validation(message: $message, fieldErrors: $fieldErrors)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ValidationFailureImpl &&
            (identical(other.message, message) || other.message == message) &&
            const DeepCollectionEquality()
                .equals(other._fieldErrors, _fieldErrors));
  }

  @override
  int get hashCode => Object.hash(
      runtimeType, message, const DeepCollectionEquality().hash(_fieldErrors));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$ValidationFailureImplCopyWith<_$ValidationFailureImpl> get copyWith =>
      __$$ValidationFailureImplCopyWithImpl<_$ValidationFailureImpl>(
          this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return validation(message, fieldErrors);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return validation?.call(message, fieldErrors);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (validation != null) {
      return validation(message, fieldErrors);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return validation(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return validation?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (validation != null) {
      return validation(this);
    }
    return orElse();
  }
}

abstract class ValidationFailure extends Failure {
  const factory ValidationFailure(
      {final String? message,
      final Map<String, List<String>>? fieldErrors}) = _$ValidationFailureImpl;
  const ValidationFailure._() : super._();

  @override
  String? get message;
  Map<String, List<String>>? get fieldErrors;
  @override
  @JsonKey(ignore: true)
  _$$ValidationFailureImplCopyWith<_$ValidationFailureImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$NotFoundFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$NotFoundFailureImplCopyWith(_$NotFoundFailureImpl value,
          $Res Function(_$NotFoundFailureImpl) then) =
      __$$NotFoundFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message, String? resourceType, String? resourceId});
}

/// @nodoc
class __$$NotFoundFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$NotFoundFailureImpl>
    implements _$$NotFoundFailureImplCopyWith<$Res> {
  __$$NotFoundFailureImplCopyWithImpl(
      _$NotFoundFailureImpl _value, $Res Function(_$NotFoundFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
    Object? resourceType = freezed,
    Object? resourceId = freezed,
  }) {
    return _then(_$NotFoundFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
      resourceType: freezed == resourceType
          ? _value.resourceType
          : resourceType // ignore: cast_nullable_to_non_nullable
              as String?,
      resourceId: freezed == resourceId
          ? _value.resourceId
          : resourceId // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc

class _$NotFoundFailureImpl extends NotFoundFailure {
  const _$NotFoundFailureImpl(
      {this.message, this.resourceType, this.resourceId})
      : super._();

  @override
  final String? message;
  @override
  final String? resourceType;
  @override
  final String? resourceId;

  @override
  String toString() {
    return 'Failure.notFound(message: $message, resourceType: $resourceType, resourceId: $resourceId)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$NotFoundFailureImpl &&
            (identical(other.message, message) || other.message == message) &&
            (identical(other.resourceType, resourceType) ||
                other.resourceType == resourceType) &&
            (identical(other.resourceId, resourceId) ||
                other.resourceId == resourceId));
  }

  @override
  int get hashCode =>
      Object.hash(runtimeType, message, resourceType, resourceId);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$NotFoundFailureImplCopyWith<_$NotFoundFailureImpl> get copyWith =>
      __$$NotFoundFailureImplCopyWithImpl<_$NotFoundFailureImpl>(
          this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return notFound(message, resourceType, resourceId);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return notFound?.call(message, resourceType, resourceId);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (notFound != null) {
      return notFound(message, resourceType, resourceId);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return notFound(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return notFound?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (notFound != null) {
      return notFound(this);
    }
    return orElse();
  }
}

abstract class NotFoundFailure extends Failure {
  const factory NotFoundFailure(
      {final String? message,
      final String? resourceType,
      final String? resourceId}) = _$NotFoundFailureImpl;
  const NotFoundFailure._() : super._();

  @override
  String? get message;
  String? get resourceType;
  String? get resourceId;
  @override
  @JsonKey(ignore: true)
  _$$NotFoundFailureImplCopyWith<_$NotFoundFailureImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$CacheFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$CacheFailureImplCopyWith(
          _$CacheFailureImpl value, $Res Function(_$CacheFailureImpl) then) =
      __$$CacheFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message});
}

/// @nodoc
class __$$CacheFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$CacheFailureImpl>
    implements _$$CacheFailureImplCopyWith<$Res> {
  __$$CacheFailureImplCopyWithImpl(
      _$CacheFailureImpl _value, $Res Function(_$CacheFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
  }) {
    return _then(_$CacheFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc

class _$CacheFailureImpl extends CacheFailure {
  const _$CacheFailureImpl({this.message}) : super._();

  @override
  final String? message;

  @override
  String toString() {
    return 'Failure.cache(message: $message)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$CacheFailureImpl &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$CacheFailureImplCopyWith<_$CacheFailureImpl> get copyWith =>
      __$$CacheFailureImplCopyWithImpl<_$CacheFailureImpl>(this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return cache(message);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return cache?.call(message);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (cache != null) {
      return cache(message);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return cache(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return cache?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (cache != null) {
      return cache(this);
    }
    return orElse();
  }
}

abstract class CacheFailure extends Failure {
  const factory CacheFailure({final String? message}) = _$CacheFailureImpl;
  const CacheFailure._() : super._();

  @override
  String? get message;
  @override
  @JsonKey(ignore: true)
  _$$CacheFailureImplCopyWith<_$CacheFailureImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$LocationFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$LocationFailureImplCopyWith(_$LocationFailureImpl value,
          $Res Function(_$LocationFailureImpl) then) =
      __$$LocationFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message, LocationFailureReason? reason});
}

/// @nodoc
class __$$LocationFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$LocationFailureImpl>
    implements _$$LocationFailureImplCopyWith<$Res> {
  __$$LocationFailureImplCopyWithImpl(
      _$LocationFailureImpl _value, $Res Function(_$LocationFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
    Object? reason = freezed,
  }) {
    return _then(_$LocationFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
      reason: freezed == reason
          ? _value.reason
          : reason // ignore: cast_nullable_to_non_nullable
              as LocationFailureReason?,
    ));
  }
}

/// @nodoc

class _$LocationFailureImpl extends LocationFailure {
  const _$LocationFailureImpl({this.message, this.reason}) : super._();

  @override
  final String? message;
  @override
  final LocationFailureReason? reason;

  @override
  String toString() {
    return 'Failure.location(message: $message, reason: $reason)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$LocationFailureImpl &&
            (identical(other.message, message) || other.message == message) &&
            (identical(other.reason, reason) || other.reason == reason));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message, reason);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$LocationFailureImplCopyWith<_$LocationFailureImpl> get copyWith =>
      __$$LocationFailureImplCopyWithImpl<_$LocationFailureImpl>(
          this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return location(message, reason);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return location?.call(message, reason);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (location != null) {
      return location(message, reason);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return location(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return location?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (location != null) {
      return location(this);
    }
    return orElse();
  }
}

abstract class LocationFailure extends Failure {
  const factory LocationFailure(
      {final String? message,
      final LocationFailureReason? reason}) = _$LocationFailureImpl;
  const LocationFailure._() : super._();

  @override
  String? get message;
  LocationFailureReason? get reason;
  @override
  @JsonKey(ignore: true)
  _$$LocationFailureImplCopyWith<_$LocationFailureImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$PaymentFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$PaymentFailureImplCopyWith(_$PaymentFailureImpl value,
          $Res Function(_$PaymentFailureImpl) then) =
      __$$PaymentFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String? message, String? paymentErrorCode, String? providerMessage});
}

/// @nodoc
class __$$PaymentFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$PaymentFailureImpl>
    implements _$$PaymentFailureImplCopyWith<$Res> {
  __$$PaymentFailureImplCopyWithImpl(
      _$PaymentFailureImpl _value, $Res Function(_$PaymentFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
    Object? paymentErrorCode = freezed,
    Object? providerMessage = freezed,
  }) {
    return _then(_$PaymentFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
      paymentErrorCode: freezed == paymentErrorCode
          ? _value.paymentErrorCode
          : paymentErrorCode // ignore: cast_nullable_to_non_nullable
              as String?,
      providerMessage: freezed == providerMessage
          ? _value.providerMessage
          : providerMessage // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc

class _$PaymentFailureImpl extends PaymentFailure {
  const _$PaymentFailureImpl(
      {this.message, this.paymentErrorCode, this.providerMessage})
      : super._();

  @override
  final String? message;
  @override
  final String? paymentErrorCode;
  @override
  final String? providerMessage;

  @override
  String toString() {
    return 'Failure.payment(message: $message, paymentErrorCode: $paymentErrorCode, providerMessage: $providerMessage)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$PaymentFailureImpl &&
            (identical(other.message, message) || other.message == message) &&
            (identical(other.paymentErrorCode, paymentErrorCode) ||
                other.paymentErrorCode == paymentErrorCode) &&
            (identical(other.providerMessage, providerMessage) ||
                other.providerMessage == providerMessage));
  }

  @override
  int get hashCode =>
      Object.hash(runtimeType, message, paymentErrorCode, providerMessage);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$PaymentFailureImplCopyWith<_$PaymentFailureImpl> get copyWith =>
      __$$PaymentFailureImplCopyWithImpl<_$PaymentFailureImpl>(
          this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return payment(message, paymentErrorCode, providerMessage);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return payment?.call(message, paymentErrorCode, providerMessage);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (payment != null) {
      return payment(message, paymentErrorCode, providerMessage);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return payment(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return payment?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (payment != null) {
      return payment(this);
    }
    return orElse();
  }
}

abstract class PaymentFailure extends Failure {
  const factory PaymentFailure(
      {final String? message,
      final String? paymentErrorCode,
      final String? providerMessage}) = _$PaymentFailureImpl;
  const PaymentFailure._() : super._();

  @override
  String? get message;
  String? get paymentErrorCode;
  String? get providerMessage;
  @override
  @JsonKey(ignore: true)
  _$$PaymentFailureImplCopyWith<_$PaymentFailureImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$RateLimitFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$RateLimitFailureImplCopyWith(_$RateLimitFailureImpl value,
          $Res Function(_$RateLimitFailureImpl) then) =
      __$$RateLimitFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message, int? retryAfterSeconds});
}

/// @nodoc
class __$$RateLimitFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$RateLimitFailureImpl>
    implements _$$RateLimitFailureImplCopyWith<$Res> {
  __$$RateLimitFailureImplCopyWithImpl(_$RateLimitFailureImpl _value,
      $Res Function(_$RateLimitFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
    Object? retryAfterSeconds = freezed,
  }) {
    return _then(_$RateLimitFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
      retryAfterSeconds: freezed == retryAfterSeconds
          ? _value.retryAfterSeconds
          : retryAfterSeconds // ignore: cast_nullable_to_non_nullable
              as int?,
    ));
  }
}

/// @nodoc

class _$RateLimitFailureImpl extends RateLimitFailure {
  const _$RateLimitFailureImpl({this.message, this.retryAfterSeconds})
      : super._();

  @override
  final String? message;
  @override
  final int? retryAfterSeconds;

  @override
  String toString() {
    return 'Failure.rateLimit(message: $message, retryAfterSeconds: $retryAfterSeconds)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$RateLimitFailureImpl &&
            (identical(other.message, message) || other.message == message) &&
            (identical(other.retryAfterSeconds, retryAfterSeconds) ||
                other.retryAfterSeconds == retryAfterSeconds));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message, retryAfterSeconds);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$RateLimitFailureImplCopyWith<_$RateLimitFailureImpl> get copyWith =>
      __$$RateLimitFailureImplCopyWithImpl<_$RateLimitFailureImpl>(
          this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return rateLimit(message, retryAfterSeconds);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return rateLimit?.call(message, retryAfterSeconds);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (rateLimit != null) {
      return rateLimit(message, retryAfterSeconds);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return rateLimit(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return rateLimit?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (rateLimit != null) {
      return rateLimit(this);
    }
    return orElse();
  }
}

abstract class RateLimitFailure extends Failure {
  const factory RateLimitFailure(
      {final String? message,
      final int? retryAfterSeconds}) = _$RateLimitFailureImpl;
  const RateLimitFailure._() : super._();

  @override
  String? get message;
  int? get retryAfterSeconds;
  @override
  @JsonKey(ignore: true)
  _$$RateLimitFailureImplCopyWith<_$RateLimitFailureImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$TimeoutFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$TimeoutFailureImplCopyWith(_$TimeoutFailureImpl value,
          $Res Function(_$TimeoutFailureImpl) then) =
      __$$TimeoutFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message});
}

/// @nodoc
class __$$TimeoutFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$TimeoutFailureImpl>
    implements _$$TimeoutFailureImplCopyWith<$Res> {
  __$$TimeoutFailureImplCopyWithImpl(
      _$TimeoutFailureImpl _value, $Res Function(_$TimeoutFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
  }) {
    return _then(_$TimeoutFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc

class _$TimeoutFailureImpl extends TimeoutFailure {
  const _$TimeoutFailureImpl({this.message}) : super._();

  @override
  final String? message;

  @override
  String toString() {
    return 'Failure.timeout(message: $message)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$TimeoutFailureImpl &&
            (identical(other.message, message) || other.message == message));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$TimeoutFailureImplCopyWith<_$TimeoutFailureImpl> get copyWith =>
      __$$TimeoutFailureImplCopyWithImpl<_$TimeoutFailureImpl>(
          this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return timeout(message);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return timeout?.call(message);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (timeout != null) {
      return timeout(message);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return timeout(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return timeout?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (timeout != null) {
      return timeout(this);
    }
    return orElse();
  }
}

abstract class TimeoutFailure extends Failure {
  const factory TimeoutFailure({final String? message}) = _$TimeoutFailureImpl;
  const TimeoutFailure._() : super._();

  @override
  String? get message;
  @override
  @JsonKey(ignore: true)
  _$$TimeoutFailureImplCopyWith<_$TimeoutFailureImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class _$$UnknownFailureImplCopyWith<$Res>
    implements $FailureCopyWith<$Res> {
  factory _$$UnknownFailureImplCopyWith(_$UnknownFailureImpl value,
          $Res Function(_$UnknownFailureImpl) then) =
      __$$UnknownFailureImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String? message, Object? error, StackTrace? stackTrace});
}

/// @nodoc
class __$$UnknownFailureImplCopyWithImpl<$Res>
    extends _$FailureCopyWithImpl<$Res, _$UnknownFailureImpl>
    implements _$$UnknownFailureImplCopyWith<$Res> {
  __$$UnknownFailureImplCopyWithImpl(
      _$UnknownFailureImpl _value, $Res Function(_$UnknownFailureImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? message = freezed,
    Object? error = freezed,
    Object? stackTrace = freezed,
  }) {
    return _then(_$UnknownFailureImpl(
      message: freezed == message
          ? _value.message
          : message // ignore: cast_nullable_to_non_nullable
              as String?,
      error: freezed == error ? _value.error : error,
      stackTrace: freezed == stackTrace
          ? _value.stackTrace
          : stackTrace // ignore: cast_nullable_to_non_nullable
              as StackTrace?,
    ));
  }
}

/// @nodoc

class _$UnknownFailureImpl extends UnknownFailure {
  const _$UnknownFailureImpl({this.message, this.error, this.stackTrace})
      : super._();

  @override
  final String? message;
  @override
  final Object? error;
  @override
  final StackTrace? stackTrace;

  @override
  String toString() {
    return 'Failure.unknown(message: $message, error: $error, stackTrace: $stackTrace)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$UnknownFailureImpl &&
            (identical(other.message, message) || other.message == message) &&
            const DeepCollectionEquality().equals(other.error, error) &&
            (identical(other.stackTrace, stackTrace) ||
                other.stackTrace == stackTrace));
  }

  @override
  int get hashCode => Object.hash(runtimeType, message,
      const DeepCollectionEquality().hash(error), stackTrace);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$UnknownFailureImplCopyWith<_$UnknownFailureImpl> get copyWith =>
      __$$UnknownFailureImplCopyWithImpl<_$UnknownFailureImpl>(
          this, _$identity);

  @override
  @optionalTypeArgs
  TResult when<TResult extends Object?>({
    required TResult Function(
            String? message, int? statusCode, String? errorCode)
        server,
    required TResult Function(String? message) network,
    required TResult Function(String? message, String? errorCode)
        authentication,
    required TResult Function(String? message) authorization,
    required TResult Function(
            String? message, Map<String, List<String>>? fieldErrors)
        validation,
    required TResult Function(
            String? message, String? resourceType, String? resourceId)
        notFound,
    required TResult Function(String? message) cache,
    required TResult Function(String? message, LocationFailureReason? reason)
        location,
    required TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)
        payment,
    required TResult Function(String? message, int? retryAfterSeconds)
        rateLimit,
    required TResult Function(String? message) timeout,
    required TResult Function(
            String? message, Object? error, StackTrace? stackTrace)
        unknown,
  }) {
    return unknown(message, error, stackTrace);
  }

  @override
  @optionalTypeArgs
  TResult? whenOrNull<TResult extends Object?>({
    TResult? Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult? Function(String? message)? network,
    TResult? Function(String? message, String? errorCode)? authentication,
    TResult? Function(String? message)? authorization,
    TResult? Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult? Function(
            String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult? Function(String? message)? cache,
    TResult? Function(String? message, LocationFailureReason? reason)? location,
    TResult? Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult? Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult? Function(String? message)? timeout,
    TResult? Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
  }) {
    return unknown?.call(message, error, stackTrace);
  }

  @override
  @optionalTypeArgs
  TResult maybeWhen<TResult extends Object?>({
    TResult Function(String? message, int? statusCode, String? errorCode)?
        server,
    TResult Function(String? message)? network,
    TResult Function(String? message, String? errorCode)? authentication,
    TResult Function(String? message)? authorization,
    TResult Function(String? message, Map<String, List<String>>? fieldErrors)?
        validation,
    TResult Function(String? message, String? resourceType, String? resourceId)?
        notFound,
    TResult Function(String? message)? cache,
    TResult Function(String? message, LocationFailureReason? reason)? location,
    TResult Function(
            String? message, String? paymentErrorCode, String? providerMessage)?
        payment,
    TResult Function(String? message, int? retryAfterSeconds)? rateLimit,
    TResult Function(String? message)? timeout,
    TResult Function(String? message, Object? error, StackTrace? stackTrace)?
        unknown,
    required TResult orElse(),
  }) {
    if (unknown != null) {
      return unknown(message, error, stackTrace);
    }
    return orElse();
  }

  @override
  @optionalTypeArgs
  TResult map<TResult extends Object?>({
    required TResult Function(ServerFailure value) server,
    required TResult Function(NetworkFailure value) network,
    required TResult Function(AuthenticationFailure value) authentication,
    required TResult Function(AuthorizationFailure value) authorization,
    required TResult Function(ValidationFailure value) validation,
    required TResult Function(NotFoundFailure value) notFound,
    required TResult Function(CacheFailure value) cache,
    required TResult Function(LocationFailure value) location,
    required TResult Function(PaymentFailure value) payment,
    required TResult Function(RateLimitFailure value) rateLimit,
    required TResult Function(TimeoutFailure value) timeout,
    required TResult Function(UnknownFailure value) unknown,
  }) {
    return unknown(this);
  }

  @override
  @optionalTypeArgs
  TResult? mapOrNull<TResult extends Object?>({
    TResult? Function(ServerFailure value)? server,
    TResult? Function(NetworkFailure value)? network,
    TResult? Function(AuthenticationFailure value)? authentication,
    TResult? Function(AuthorizationFailure value)? authorization,
    TResult? Function(ValidationFailure value)? validation,
    TResult? Function(NotFoundFailure value)? notFound,
    TResult? Function(CacheFailure value)? cache,
    TResult? Function(LocationFailure value)? location,
    TResult? Function(PaymentFailure value)? payment,
    TResult? Function(RateLimitFailure value)? rateLimit,
    TResult? Function(TimeoutFailure value)? timeout,
    TResult? Function(UnknownFailure value)? unknown,
  }) {
    return unknown?.call(this);
  }

  @override
  @optionalTypeArgs
  TResult maybeMap<TResult extends Object?>({
    TResult Function(ServerFailure value)? server,
    TResult Function(NetworkFailure value)? network,
    TResult Function(AuthenticationFailure value)? authentication,
    TResult Function(AuthorizationFailure value)? authorization,
    TResult Function(ValidationFailure value)? validation,
    TResult Function(NotFoundFailure value)? notFound,
    TResult Function(CacheFailure value)? cache,
    TResult Function(LocationFailure value)? location,
    TResult Function(PaymentFailure value)? payment,
    TResult Function(RateLimitFailure value)? rateLimit,
    TResult Function(TimeoutFailure value)? timeout,
    TResult Function(UnknownFailure value)? unknown,
    required TResult orElse(),
  }) {
    if (unknown != null) {
      return unknown(this);
    }
    return orElse();
  }
}

abstract class UnknownFailure extends Failure {
  const factory UnknownFailure(
      {final String? message,
      final Object? error,
      final StackTrace? stackTrace}) = _$UnknownFailureImpl;
  const UnknownFailure._() : super._();

  @override
  String? get message;
  Object? get error;
  StackTrace? get stackTrace;
  @override
  @JsonKey(ignore: true)
  _$$UnknownFailureImplCopyWith<_$UnknownFailureImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
