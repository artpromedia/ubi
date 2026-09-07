// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'location.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

GeoLocation _$GeoLocationFromJson(Map<String, dynamic> json) {
  return _GeoLocation.fromJson(json);
}

/// @nodoc
mixin _$GeoLocation {
  double get latitude => throw _privateConstructorUsedError;
  double get longitude => throw _privateConstructorUsedError;
  double? get altitude => throw _privateConstructorUsedError;
  double? get accuracy => throw _privateConstructorUsedError;
  double? get heading => throw _privateConstructorUsedError;
  double? get speed => throw _privateConstructorUsedError;
  DateTime? get timestamp => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $GeoLocationCopyWith<GeoLocation> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $GeoLocationCopyWith<$Res> {
  factory $GeoLocationCopyWith(
          GeoLocation value, $Res Function(GeoLocation) then) =
      _$GeoLocationCopyWithImpl<$Res, GeoLocation>;
  @useResult
  $Res call(
      {double latitude,
      double longitude,
      double? altitude,
      double? accuracy,
      double? heading,
      double? speed,
      DateTime? timestamp});
}

/// @nodoc
class _$GeoLocationCopyWithImpl<$Res, $Val extends GeoLocation>
    implements $GeoLocationCopyWith<$Res> {
  _$GeoLocationCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? latitude = null,
    Object? longitude = null,
    Object? altitude = freezed,
    Object? accuracy = freezed,
    Object? heading = freezed,
    Object? speed = freezed,
    Object? timestamp = freezed,
  }) {
    return _then(_value.copyWith(
      latitude: null == latitude
          ? _value.latitude
          : latitude // ignore: cast_nullable_to_non_nullable
              as double,
      longitude: null == longitude
          ? _value.longitude
          : longitude // ignore: cast_nullable_to_non_nullable
              as double,
      altitude: freezed == altitude
          ? _value.altitude
          : altitude // ignore: cast_nullable_to_non_nullable
              as double?,
      accuracy: freezed == accuracy
          ? _value.accuracy
          : accuracy // ignore: cast_nullable_to_non_nullable
              as double?,
      heading: freezed == heading
          ? _value.heading
          : heading // ignore: cast_nullable_to_non_nullable
              as double?,
      speed: freezed == speed
          ? _value.speed
          : speed // ignore: cast_nullable_to_non_nullable
              as double?,
      timestamp: freezed == timestamp
          ? _value.timestamp
          : timestamp // ignore: cast_nullable_to_non_nullable
              as DateTime?,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$GeoLocationImplCopyWith<$Res>
    implements $GeoLocationCopyWith<$Res> {
  factory _$$GeoLocationImplCopyWith(
          _$GeoLocationImpl value, $Res Function(_$GeoLocationImpl) then) =
      __$$GeoLocationImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {double latitude,
      double longitude,
      double? altitude,
      double? accuracy,
      double? heading,
      double? speed,
      DateTime? timestamp});
}

/// @nodoc
class __$$GeoLocationImplCopyWithImpl<$Res>
    extends _$GeoLocationCopyWithImpl<$Res, _$GeoLocationImpl>
    implements _$$GeoLocationImplCopyWith<$Res> {
  __$$GeoLocationImplCopyWithImpl(
      _$GeoLocationImpl _value, $Res Function(_$GeoLocationImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? latitude = null,
    Object? longitude = null,
    Object? altitude = freezed,
    Object? accuracy = freezed,
    Object? heading = freezed,
    Object? speed = freezed,
    Object? timestamp = freezed,
  }) {
    return _then(_$GeoLocationImpl(
      latitude: null == latitude
          ? _value.latitude
          : latitude // ignore: cast_nullable_to_non_nullable
              as double,
      longitude: null == longitude
          ? _value.longitude
          : longitude // ignore: cast_nullable_to_non_nullable
              as double,
      altitude: freezed == altitude
          ? _value.altitude
          : altitude // ignore: cast_nullable_to_non_nullable
              as double?,
      accuracy: freezed == accuracy
          ? _value.accuracy
          : accuracy // ignore: cast_nullable_to_non_nullable
              as double?,
      heading: freezed == heading
          ? _value.heading
          : heading // ignore: cast_nullable_to_non_nullable
              as double?,
      speed: freezed == speed
          ? _value.speed
          : speed // ignore: cast_nullable_to_non_nullable
              as double?,
      timestamp: freezed == timestamp
          ? _value.timestamp
          : timestamp // ignore: cast_nullable_to_non_nullable
              as DateTime?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$GeoLocationImpl extends _GeoLocation {
  const _$GeoLocationImpl(
      {required this.latitude,
      required this.longitude,
      this.altitude,
      this.accuracy,
      this.heading,
      this.speed,
      this.timestamp})
      : super._();

  factory _$GeoLocationImpl.fromJson(Map<String, dynamic> json) =>
      _$$GeoLocationImplFromJson(json);

  @override
  final double latitude;
  @override
  final double longitude;
  @override
  final double? altitude;
  @override
  final double? accuracy;
  @override
  final double? heading;
  @override
  final double? speed;
  @override
  final DateTime? timestamp;

  @override
  String toString() {
    return 'GeoLocation(latitude: $latitude, longitude: $longitude, altitude: $altitude, accuracy: $accuracy, heading: $heading, speed: $speed, timestamp: $timestamp)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$GeoLocationImpl &&
            (identical(other.latitude, latitude) ||
                other.latitude == latitude) &&
            (identical(other.longitude, longitude) ||
                other.longitude == longitude) &&
            (identical(other.altitude, altitude) ||
                other.altitude == altitude) &&
            (identical(other.accuracy, accuracy) ||
                other.accuracy == accuracy) &&
            (identical(other.heading, heading) || other.heading == heading) &&
            (identical(other.speed, speed) || other.speed == speed) &&
            (identical(other.timestamp, timestamp) ||
                other.timestamp == timestamp));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(runtimeType, latitude, longitude, altitude,
      accuracy, heading, speed, timestamp);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$GeoLocationImplCopyWith<_$GeoLocationImpl> get copyWith =>
      __$$GeoLocationImplCopyWithImpl<_$GeoLocationImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$GeoLocationImplToJson(
      this,
    );
  }
}

abstract class _GeoLocation extends GeoLocation {
  const factory _GeoLocation(
      {required final double latitude,
      required final double longitude,
      final double? altitude,
      final double? accuracy,
      final double? heading,
      final double? speed,
      final DateTime? timestamp}) = _$GeoLocationImpl;
  const _GeoLocation._() : super._();

  factory _GeoLocation.fromJson(Map<String, dynamic> json) =
      _$GeoLocationImpl.fromJson;

  @override
  double get latitude;
  @override
  double get longitude;
  @override
  double? get altitude;
  @override
  double? get accuracy;
  @override
  double? get heading;
  @override
  double? get speed;
  @override
  DateTime? get timestamp;
  @override
  @JsonKey(ignore: true)
  _$$GeoLocationImplCopyWith<_$GeoLocationImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

LocationUpdate _$LocationUpdateFromJson(Map<String, dynamic> json) {
  return _LocationUpdate.fromJson(json);
}

/// @nodoc
mixin _$LocationUpdate {
  GeoLocation get location => throw _privateConstructorUsedError;
  DateTime get timestamp => throw _privateConstructorUsedError;
  String? get provider => throw _privateConstructorUsedError;
  bool? get isMocked => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $LocationUpdateCopyWith<LocationUpdate> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $LocationUpdateCopyWith<$Res> {
  factory $LocationUpdateCopyWith(
          LocationUpdate value, $Res Function(LocationUpdate) then) =
      _$LocationUpdateCopyWithImpl<$Res, LocationUpdate>;
  @useResult
  $Res call(
      {GeoLocation location,
      DateTime timestamp,
      String? provider,
      bool? isMocked});

  $GeoLocationCopyWith<$Res> get location;
}

/// @nodoc
class _$LocationUpdateCopyWithImpl<$Res, $Val extends LocationUpdate>
    implements $LocationUpdateCopyWith<$Res> {
  _$LocationUpdateCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? location = null,
    Object? timestamp = null,
    Object? provider = freezed,
    Object? isMocked = freezed,
  }) {
    return _then(_value.copyWith(
      location: null == location
          ? _value.location
          : location // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      timestamp: null == timestamp
          ? _value.timestamp
          : timestamp // ignore: cast_nullable_to_non_nullable
              as DateTime,
      provider: freezed == provider
          ? _value.provider
          : provider // ignore: cast_nullable_to_non_nullable
              as String?,
      isMocked: freezed == isMocked
          ? _value.isMocked
          : isMocked // ignore: cast_nullable_to_non_nullable
              as bool?,
    ) as $Val);
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoLocationCopyWith<$Res> get location {
    return $GeoLocationCopyWith<$Res>(_value.location, (value) {
      return _then(_value.copyWith(location: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$LocationUpdateImplCopyWith<$Res>
    implements $LocationUpdateCopyWith<$Res> {
  factory _$$LocationUpdateImplCopyWith(_$LocationUpdateImpl value,
          $Res Function(_$LocationUpdateImpl) then) =
      __$$LocationUpdateImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {GeoLocation location,
      DateTime timestamp,
      String? provider,
      bool? isMocked});

  @override
  $GeoLocationCopyWith<$Res> get location;
}

/// @nodoc
class __$$LocationUpdateImplCopyWithImpl<$Res>
    extends _$LocationUpdateCopyWithImpl<$Res, _$LocationUpdateImpl>
    implements _$$LocationUpdateImplCopyWith<$Res> {
  __$$LocationUpdateImplCopyWithImpl(
      _$LocationUpdateImpl _value, $Res Function(_$LocationUpdateImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? location = null,
    Object? timestamp = null,
    Object? provider = freezed,
    Object? isMocked = freezed,
  }) {
    return _then(_$LocationUpdateImpl(
      location: null == location
          ? _value.location
          : location // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      timestamp: null == timestamp
          ? _value.timestamp
          : timestamp // ignore: cast_nullable_to_non_nullable
              as DateTime,
      provider: freezed == provider
          ? _value.provider
          : provider // ignore: cast_nullable_to_non_nullable
              as String?,
      isMocked: freezed == isMocked
          ? _value.isMocked
          : isMocked // ignore: cast_nullable_to_non_nullable
              as bool?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$LocationUpdateImpl implements _LocationUpdate {
  const _$LocationUpdateImpl(
      {required this.location,
      required this.timestamp,
      this.provider,
      this.isMocked});

  factory _$LocationUpdateImpl.fromJson(Map<String, dynamic> json) =>
      _$$LocationUpdateImplFromJson(json);

  @override
  final GeoLocation location;
  @override
  final DateTime timestamp;
  @override
  final String? provider;
  @override
  final bool? isMocked;

  @override
  String toString() {
    return 'LocationUpdate(location: $location, timestamp: $timestamp, provider: $provider, isMocked: $isMocked)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$LocationUpdateImpl &&
            (identical(other.location, location) ||
                other.location == location) &&
            (identical(other.timestamp, timestamp) ||
                other.timestamp == timestamp) &&
            (identical(other.provider, provider) ||
                other.provider == provider) &&
            (identical(other.isMocked, isMocked) ||
                other.isMocked == isMocked));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode =>
      Object.hash(runtimeType, location, timestamp, provider, isMocked);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$LocationUpdateImplCopyWith<_$LocationUpdateImpl> get copyWith =>
      __$$LocationUpdateImplCopyWithImpl<_$LocationUpdateImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$LocationUpdateImplToJson(
      this,
    );
  }
}

abstract class _LocationUpdate implements LocationUpdate {
  const factory _LocationUpdate(
      {required final GeoLocation location,
      required final DateTime timestamp,
      final String? provider,
      final bool? isMocked}) = _$LocationUpdateImpl;

  factory _LocationUpdate.fromJson(Map<String, dynamic> json) =
      _$LocationUpdateImpl.fromJson;

  @override
  GeoLocation get location;
  @override
  DateTime get timestamp;
  @override
  String? get provider;
  @override
  bool? get isMocked;
  @override
  @JsonKey(ignore: true)
  _$$LocationUpdateImplCopyWith<_$LocationUpdateImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

GeoBounds _$GeoBoundsFromJson(Map<String, dynamic> json) {
  return _GeoBounds.fromJson(json);
}

/// @nodoc
mixin _$GeoBounds {
  GeoLocation get northeast => throw _privateConstructorUsedError;
  GeoLocation get southwest => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $GeoBoundsCopyWith<GeoBounds> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $GeoBoundsCopyWith<$Res> {
  factory $GeoBoundsCopyWith(GeoBounds value, $Res Function(GeoBounds) then) =
      _$GeoBoundsCopyWithImpl<$Res, GeoBounds>;
  @useResult
  $Res call({GeoLocation northeast, GeoLocation southwest});

  $GeoLocationCopyWith<$Res> get northeast;
  $GeoLocationCopyWith<$Res> get southwest;
}

/// @nodoc
class _$GeoBoundsCopyWithImpl<$Res, $Val extends GeoBounds>
    implements $GeoBoundsCopyWith<$Res> {
  _$GeoBoundsCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? northeast = null,
    Object? southwest = null,
  }) {
    return _then(_value.copyWith(
      northeast: null == northeast
          ? _value.northeast
          : northeast // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      southwest: null == southwest
          ? _value.southwest
          : southwest // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
    ) as $Val);
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoLocationCopyWith<$Res> get northeast {
    return $GeoLocationCopyWith<$Res>(_value.northeast, (value) {
      return _then(_value.copyWith(northeast: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoLocationCopyWith<$Res> get southwest {
    return $GeoLocationCopyWith<$Res>(_value.southwest, (value) {
      return _then(_value.copyWith(southwest: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$GeoBoundsImplCopyWith<$Res>
    implements $GeoBoundsCopyWith<$Res> {
  factory _$$GeoBoundsImplCopyWith(
          _$GeoBoundsImpl value, $Res Function(_$GeoBoundsImpl) then) =
      __$$GeoBoundsImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({GeoLocation northeast, GeoLocation southwest});

  @override
  $GeoLocationCopyWith<$Res> get northeast;
  @override
  $GeoLocationCopyWith<$Res> get southwest;
}

/// @nodoc
class __$$GeoBoundsImplCopyWithImpl<$Res>
    extends _$GeoBoundsCopyWithImpl<$Res, _$GeoBoundsImpl>
    implements _$$GeoBoundsImplCopyWith<$Res> {
  __$$GeoBoundsImplCopyWithImpl(
      _$GeoBoundsImpl _value, $Res Function(_$GeoBoundsImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? northeast = null,
    Object? southwest = null,
  }) {
    return _then(_$GeoBoundsImpl(
      northeast: null == northeast
          ? _value.northeast
          : northeast // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      southwest: null == southwest
          ? _value.southwest
          : southwest // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$GeoBoundsImpl extends _GeoBounds {
  const _$GeoBoundsImpl({required this.northeast, required this.southwest})
      : super._();

  factory _$GeoBoundsImpl.fromJson(Map<String, dynamic> json) =>
      _$$GeoBoundsImplFromJson(json);

  @override
  final GeoLocation northeast;
  @override
  final GeoLocation southwest;

  @override
  String toString() {
    return 'GeoBounds(northeast: $northeast, southwest: $southwest)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$GeoBoundsImpl &&
            (identical(other.northeast, northeast) ||
                other.northeast == northeast) &&
            (identical(other.southwest, southwest) ||
                other.southwest == southwest));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(runtimeType, northeast, southwest);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$GeoBoundsImplCopyWith<_$GeoBoundsImpl> get copyWith =>
      __$$GeoBoundsImplCopyWithImpl<_$GeoBoundsImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$GeoBoundsImplToJson(
      this,
    );
  }
}

abstract class _GeoBounds extends GeoBounds {
  const factory _GeoBounds(
      {required final GeoLocation northeast,
      required final GeoLocation southwest}) = _$GeoBoundsImpl;
  const _GeoBounds._() : super._();

  factory _GeoBounds.fromJson(Map<String, dynamic> json) =
      _$GeoBoundsImpl.fromJson;

  @override
  GeoLocation get northeast;
  @override
  GeoLocation get southwest;
  @override
  @JsonKey(ignore: true)
  _$$GeoBoundsImplCopyWith<_$GeoBoundsImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
