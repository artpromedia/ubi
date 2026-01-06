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

SavedPlace _$SavedPlaceFromJson(Map<String, dynamic> json) {
  return _SavedPlace.fromJson(json);
}

/// @nodoc
mixin _$SavedPlace {
  String get id => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  GeoLocation get location => throw _privateConstructorUsedError;
  PlaceType get type => throw _privateConstructorUsedError;
  String? get address => throw _privateConstructorUsedError;
  String? get instructions => throw _privateConstructorUsedError;
  DateTime? get createdAt => throw _privateConstructorUsedError;
  DateTime? get updatedAt => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $SavedPlaceCopyWith<SavedPlace> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $SavedPlaceCopyWith<$Res> {
  factory $SavedPlaceCopyWith(
          SavedPlace value, $Res Function(SavedPlace) then) =
      _$SavedPlaceCopyWithImpl<$Res, SavedPlace>;
  @useResult
  $Res call(
      {String id,
      String name,
      GeoLocation location,
      PlaceType type,
      String? address,
      String? instructions,
      DateTime? createdAt,
      DateTime? updatedAt});

  $GeoLocationCopyWith<$Res> get location;
}

/// @nodoc
class _$SavedPlaceCopyWithImpl<$Res, $Val extends SavedPlace>
    implements $SavedPlaceCopyWith<$Res> {
  _$SavedPlaceCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? location = null,
    Object? type = null,
    Object? address = freezed,
    Object? instructions = freezed,
    Object? createdAt = freezed,
    Object? updatedAt = freezed,
  }) {
    return _then(_value.copyWith(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      location: null == location
          ? _value.location
          : location // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      type: null == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as PlaceType,
      address: freezed == address
          ? _value.address
          : address // ignore: cast_nullable_to_non_nullable
              as String?,
      instructions: freezed == instructions
          ? _value.instructions
          : instructions // ignore: cast_nullable_to_non_nullable
              as String?,
      createdAt: freezed == createdAt
          ? _value.createdAt
          : createdAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      updatedAt: freezed == updatedAt
          ? _value.updatedAt
          : updatedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
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
abstract class _$$SavedPlaceImplCopyWith<$Res>
    implements $SavedPlaceCopyWith<$Res> {
  factory _$$SavedPlaceImplCopyWith(
          _$SavedPlaceImpl value, $Res Function(_$SavedPlaceImpl) then) =
      __$$SavedPlaceImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      String name,
      GeoLocation location,
      PlaceType type,
      String? address,
      String? instructions,
      DateTime? createdAt,
      DateTime? updatedAt});

  @override
  $GeoLocationCopyWith<$Res> get location;
}

/// @nodoc
class __$$SavedPlaceImplCopyWithImpl<$Res>
    extends _$SavedPlaceCopyWithImpl<$Res, _$SavedPlaceImpl>
    implements _$$SavedPlaceImplCopyWith<$Res> {
  __$$SavedPlaceImplCopyWithImpl(
      _$SavedPlaceImpl _value, $Res Function(_$SavedPlaceImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? location = null,
    Object? type = null,
    Object? address = freezed,
    Object? instructions = freezed,
    Object? createdAt = freezed,
    Object? updatedAt = freezed,
  }) {
    return _then(_$SavedPlaceImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      location: null == location
          ? _value.location
          : location // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      type: null == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as PlaceType,
      address: freezed == address
          ? _value.address
          : address // ignore: cast_nullable_to_non_nullable
              as String?,
      instructions: freezed == instructions
          ? _value.instructions
          : instructions // ignore: cast_nullable_to_non_nullable
              as String?,
      createdAt: freezed == createdAt
          ? _value.createdAt
          : createdAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      updatedAt: freezed == updatedAt
          ? _value.updatedAt
          : updatedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$SavedPlaceImpl extends _SavedPlace {
  const _$SavedPlaceImpl(
      {required this.id,
      required this.name,
      required this.location,
      required this.type,
      this.address,
      this.instructions,
      this.createdAt,
      this.updatedAt})
      : super._();

  factory _$SavedPlaceImpl.fromJson(Map<String, dynamic> json) =>
      _$$SavedPlaceImplFromJson(json);

  @override
  final String id;
  @override
  final String name;
  @override
  final GeoLocation location;
  @override
  final PlaceType type;
  @override
  final String? address;
  @override
  final String? instructions;
  @override
  final DateTime? createdAt;
  @override
  final DateTime? updatedAt;

  @override
  String toString() {
    return 'SavedPlace(id: $id, name: $name, location: $location, type: $type, address: $address, instructions: $instructions, createdAt: $createdAt, updatedAt: $updatedAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SavedPlaceImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.location, location) ||
                other.location == location) &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.address, address) || other.address == address) &&
            (identical(other.instructions, instructions) ||
                other.instructions == instructions) &&
            (identical(other.createdAt, createdAt) ||
                other.createdAt == createdAt) &&
            (identical(other.updatedAt, updatedAt) ||
                other.updatedAt == updatedAt));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(runtimeType, id, name, location, type,
      address, instructions, createdAt, updatedAt);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$SavedPlaceImplCopyWith<_$SavedPlaceImpl> get copyWith =>
      __$$SavedPlaceImplCopyWithImpl<_$SavedPlaceImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$SavedPlaceImplToJson(
      this,
    );
  }
}

abstract class _SavedPlace extends SavedPlace {
  const factory _SavedPlace(
      {required final String id,
      required final String name,
      required final GeoLocation location,
      required final PlaceType type,
      final String? address,
      final String? instructions,
      final DateTime? createdAt,
      final DateTime? updatedAt}) = _$SavedPlaceImpl;
  const _SavedPlace._() : super._();

  factory _SavedPlace.fromJson(Map<String, dynamic> json) =
      _$SavedPlaceImpl.fromJson;

  @override
  String get id;
  @override
  String get name;
  @override
  GeoLocation get location;
  @override
  PlaceType get type;
  @override
  String? get address;
  @override
  String? get instructions;
  @override
  DateTime? get createdAt;
  @override
  DateTime? get updatedAt;
  @override
  @JsonKey(ignore: true)
  _$$SavedPlaceImplCopyWith<_$SavedPlaceImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

PlaceSearchResult _$PlaceSearchResultFromJson(Map<String, dynamic> json) {
  return _PlaceSearchResult.fromJson(json);
}

/// @nodoc
mixin _$PlaceSearchResult {
  String get placeId => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  String? get address => throw _privateConstructorUsedError;
  String? get secondaryText => throw _privateConstructorUsedError;
  GeoLocation? get location => throw _privateConstructorUsedError;
  double? get distance => throw _privateConstructorUsedError;
  List<String>? get types => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $PlaceSearchResultCopyWith<PlaceSearchResult> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $PlaceSearchResultCopyWith<$Res> {
  factory $PlaceSearchResultCopyWith(
          PlaceSearchResult value, $Res Function(PlaceSearchResult) then) =
      _$PlaceSearchResultCopyWithImpl<$Res, PlaceSearchResult>;
  @useResult
  $Res call(
      {String placeId,
      String name,
      String? address,
      String? secondaryText,
      GeoLocation? location,
      double? distance,
      List<String>? types});

  $GeoLocationCopyWith<$Res>? get location;
}

/// @nodoc
class _$PlaceSearchResultCopyWithImpl<$Res, $Val extends PlaceSearchResult>
    implements $PlaceSearchResultCopyWith<$Res> {
  _$PlaceSearchResultCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? placeId = null,
    Object? name = null,
    Object? address = freezed,
    Object? secondaryText = freezed,
    Object? location = freezed,
    Object? distance = freezed,
    Object? types = freezed,
  }) {
    return _then(_value.copyWith(
      placeId: null == placeId
          ? _value.placeId
          : placeId // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      address: freezed == address
          ? _value.address
          : address // ignore: cast_nullable_to_non_nullable
              as String?,
      secondaryText: freezed == secondaryText
          ? _value.secondaryText
          : secondaryText // ignore: cast_nullable_to_non_nullable
              as String?,
      location: freezed == location
          ? _value.location
          : location // ignore: cast_nullable_to_non_nullable
              as GeoLocation?,
      distance: freezed == distance
          ? _value.distance
          : distance // ignore: cast_nullable_to_non_nullable
              as double?,
      types: freezed == types
          ? _value.types
          : types // ignore: cast_nullable_to_non_nullable
              as List<String>?,
    ) as $Val);
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoLocationCopyWith<$Res>? get location {
    if (_value.location == null) {
      return null;
    }

    return $GeoLocationCopyWith<$Res>(_value.location!, (value) {
      return _then(_value.copyWith(location: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$PlaceSearchResultImplCopyWith<$Res>
    implements $PlaceSearchResultCopyWith<$Res> {
  factory _$$PlaceSearchResultImplCopyWith(_$PlaceSearchResultImpl value,
          $Res Function(_$PlaceSearchResultImpl) then) =
      __$$PlaceSearchResultImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String placeId,
      String name,
      String? address,
      String? secondaryText,
      GeoLocation? location,
      double? distance,
      List<String>? types});

  @override
  $GeoLocationCopyWith<$Res>? get location;
}

/// @nodoc
class __$$PlaceSearchResultImplCopyWithImpl<$Res>
    extends _$PlaceSearchResultCopyWithImpl<$Res, _$PlaceSearchResultImpl>
    implements _$$PlaceSearchResultImplCopyWith<$Res> {
  __$$PlaceSearchResultImplCopyWithImpl(_$PlaceSearchResultImpl _value,
      $Res Function(_$PlaceSearchResultImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? placeId = null,
    Object? name = null,
    Object? address = freezed,
    Object? secondaryText = freezed,
    Object? location = freezed,
    Object? distance = freezed,
    Object? types = freezed,
  }) {
    return _then(_$PlaceSearchResultImpl(
      placeId: null == placeId
          ? _value.placeId
          : placeId // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      address: freezed == address
          ? _value.address
          : address // ignore: cast_nullable_to_non_nullable
              as String?,
      secondaryText: freezed == secondaryText
          ? _value.secondaryText
          : secondaryText // ignore: cast_nullable_to_non_nullable
              as String?,
      location: freezed == location
          ? _value.location
          : location // ignore: cast_nullable_to_non_nullable
              as GeoLocation?,
      distance: freezed == distance
          ? _value.distance
          : distance // ignore: cast_nullable_to_non_nullable
              as double?,
      types: freezed == types
          ? _value._types
          : types // ignore: cast_nullable_to_non_nullable
              as List<String>?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$PlaceSearchResultImpl extends _PlaceSearchResult {
  const _$PlaceSearchResultImpl(
      {required this.placeId,
      required this.name,
      this.address,
      this.secondaryText,
      this.location,
      this.distance,
      final List<String>? types})
      : _types = types,
        super._();

  factory _$PlaceSearchResultImpl.fromJson(Map<String, dynamic> json) =>
      _$$PlaceSearchResultImplFromJson(json);

  @override
  final String placeId;
  @override
  final String name;
  @override
  final String? address;
  @override
  final String? secondaryText;
  @override
  final GeoLocation? location;
  @override
  final double? distance;
  final List<String>? _types;
  @override
  List<String>? get types {
    final value = _types;
    if (value == null) return null;
    if (_types is EqualUnmodifiableListView) return _types;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(value);
  }

  @override
  String toString() {
    return 'PlaceSearchResult(placeId: $placeId, name: $name, address: $address, secondaryText: $secondaryText, location: $location, distance: $distance, types: $types)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$PlaceSearchResultImpl &&
            (identical(other.placeId, placeId) || other.placeId == placeId) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.address, address) || other.address == address) &&
            (identical(other.secondaryText, secondaryText) ||
                other.secondaryText == secondaryText) &&
            (identical(other.location, location) ||
                other.location == location) &&
            (identical(other.distance, distance) ||
                other.distance == distance) &&
            const DeepCollectionEquality().equals(other._types, _types));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      placeId,
      name,
      address,
      secondaryText,
      location,
      distance,
      const DeepCollectionEquality().hash(_types));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$PlaceSearchResultImplCopyWith<_$PlaceSearchResultImpl> get copyWith =>
      __$$PlaceSearchResultImplCopyWithImpl<_$PlaceSearchResultImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$PlaceSearchResultImplToJson(
      this,
    );
  }
}

abstract class _PlaceSearchResult extends PlaceSearchResult {
  const factory _PlaceSearchResult(
      {required final String placeId,
      required final String name,
      final String? address,
      final String? secondaryText,
      final GeoLocation? location,
      final double? distance,
      final List<String>? types}) = _$PlaceSearchResultImpl;
  const _PlaceSearchResult._() : super._();

  factory _PlaceSearchResult.fromJson(Map<String, dynamic> json) =
      _$PlaceSearchResultImpl.fromJson;

  @override
  String get placeId;
  @override
  String get name;
  @override
  String? get address;
  @override
  String? get secondaryText;
  @override
  GeoLocation? get location;
  @override
  double? get distance;
  @override
  List<String>? get types;
  @override
  @JsonKey(ignore: true)
  _$$PlaceSearchResultImplCopyWith<_$PlaceSearchResultImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

PlaceDetails _$PlaceDetailsFromJson(Map<String, dynamic> json) {
  return _PlaceDetails.fromJson(json);
}

/// @nodoc
mixin _$PlaceDetails {
  String get placeId => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  GeoLocation get location => throw _privateConstructorUsedError;
  String? get formattedAddress => throw _privateConstructorUsedError;
  String? get formattedPhoneNumber => throw _privateConstructorUsedError;
  String? get website => throw _privateConstructorUsedError;
  double? get rating => throw _privateConstructorUsedError;
  int? get totalRatings => throw _privateConstructorUsedError;
  List<String>? get types => throw _privateConstructorUsedError;
  PlaceOpeningHours? get openingHours => throw _privateConstructorUsedError;
  GeoBounds? get viewport => throw _privateConstructorUsedError;
  List<AddressComponent>? get addressComponents =>
      throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $PlaceDetailsCopyWith<PlaceDetails> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $PlaceDetailsCopyWith<$Res> {
  factory $PlaceDetailsCopyWith(
          PlaceDetails value, $Res Function(PlaceDetails) then) =
      _$PlaceDetailsCopyWithImpl<$Res, PlaceDetails>;
  @useResult
  $Res call(
      {String placeId,
      String name,
      GeoLocation location,
      String? formattedAddress,
      String? formattedPhoneNumber,
      String? website,
      double? rating,
      int? totalRatings,
      List<String>? types,
      PlaceOpeningHours? openingHours,
      GeoBounds? viewport,
      List<AddressComponent>? addressComponents});

  $GeoLocationCopyWith<$Res> get location;
  $PlaceOpeningHoursCopyWith<$Res>? get openingHours;
  $GeoBoundsCopyWith<$Res>? get viewport;
}

/// @nodoc
class _$PlaceDetailsCopyWithImpl<$Res, $Val extends PlaceDetails>
    implements $PlaceDetailsCopyWith<$Res> {
  _$PlaceDetailsCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? placeId = null,
    Object? name = null,
    Object? location = null,
    Object? formattedAddress = freezed,
    Object? formattedPhoneNumber = freezed,
    Object? website = freezed,
    Object? rating = freezed,
    Object? totalRatings = freezed,
    Object? types = freezed,
    Object? openingHours = freezed,
    Object? viewport = freezed,
    Object? addressComponents = freezed,
  }) {
    return _then(_value.copyWith(
      placeId: null == placeId
          ? _value.placeId
          : placeId // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      location: null == location
          ? _value.location
          : location // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      formattedAddress: freezed == formattedAddress
          ? _value.formattedAddress
          : formattedAddress // ignore: cast_nullable_to_non_nullable
              as String?,
      formattedPhoneNumber: freezed == formattedPhoneNumber
          ? _value.formattedPhoneNumber
          : formattedPhoneNumber // ignore: cast_nullable_to_non_nullable
              as String?,
      website: freezed == website
          ? _value.website
          : website // ignore: cast_nullable_to_non_nullable
              as String?,
      rating: freezed == rating
          ? _value.rating
          : rating // ignore: cast_nullable_to_non_nullable
              as double?,
      totalRatings: freezed == totalRatings
          ? _value.totalRatings
          : totalRatings // ignore: cast_nullable_to_non_nullable
              as int?,
      types: freezed == types
          ? _value.types
          : types // ignore: cast_nullable_to_non_nullable
              as List<String>?,
      openingHours: freezed == openingHours
          ? _value.openingHours
          : openingHours // ignore: cast_nullable_to_non_nullable
              as PlaceOpeningHours?,
      viewport: freezed == viewport
          ? _value.viewport
          : viewport // ignore: cast_nullable_to_non_nullable
              as GeoBounds?,
      addressComponents: freezed == addressComponents
          ? _value.addressComponents
          : addressComponents // ignore: cast_nullable_to_non_nullable
              as List<AddressComponent>?,
    ) as $Val);
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoLocationCopyWith<$Res> get location {
    return $GeoLocationCopyWith<$Res>(_value.location, (value) {
      return _then(_value.copyWith(location: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $PlaceOpeningHoursCopyWith<$Res>? get openingHours {
    if (_value.openingHours == null) {
      return null;
    }

    return $PlaceOpeningHoursCopyWith<$Res>(_value.openingHours!, (value) {
      return _then(_value.copyWith(openingHours: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoBoundsCopyWith<$Res>? get viewport {
    if (_value.viewport == null) {
      return null;
    }

    return $GeoBoundsCopyWith<$Res>(_value.viewport!, (value) {
      return _then(_value.copyWith(viewport: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$PlaceDetailsImplCopyWith<$Res>
    implements $PlaceDetailsCopyWith<$Res> {
  factory _$$PlaceDetailsImplCopyWith(
          _$PlaceDetailsImpl value, $Res Function(_$PlaceDetailsImpl) then) =
      __$$PlaceDetailsImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String placeId,
      String name,
      GeoLocation location,
      String? formattedAddress,
      String? formattedPhoneNumber,
      String? website,
      double? rating,
      int? totalRatings,
      List<String>? types,
      PlaceOpeningHours? openingHours,
      GeoBounds? viewport,
      List<AddressComponent>? addressComponents});

  @override
  $GeoLocationCopyWith<$Res> get location;
  @override
  $PlaceOpeningHoursCopyWith<$Res>? get openingHours;
  @override
  $GeoBoundsCopyWith<$Res>? get viewport;
}

/// @nodoc
class __$$PlaceDetailsImplCopyWithImpl<$Res>
    extends _$PlaceDetailsCopyWithImpl<$Res, _$PlaceDetailsImpl>
    implements _$$PlaceDetailsImplCopyWith<$Res> {
  __$$PlaceDetailsImplCopyWithImpl(
      _$PlaceDetailsImpl _value, $Res Function(_$PlaceDetailsImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? placeId = null,
    Object? name = null,
    Object? location = null,
    Object? formattedAddress = freezed,
    Object? formattedPhoneNumber = freezed,
    Object? website = freezed,
    Object? rating = freezed,
    Object? totalRatings = freezed,
    Object? types = freezed,
    Object? openingHours = freezed,
    Object? viewport = freezed,
    Object? addressComponents = freezed,
  }) {
    return _then(_$PlaceDetailsImpl(
      placeId: null == placeId
          ? _value.placeId
          : placeId // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      location: null == location
          ? _value.location
          : location // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      formattedAddress: freezed == formattedAddress
          ? _value.formattedAddress
          : formattedAddress // ignore: cast_nullable_to_non_nullable
              as String?,
      formattedPhoneNumber: freezed == formattedPhoneNumber
          ? _value.formattedPhoneNumber
          : formattedPhoneNumber // ignore: cast_nullable_to_non_nullable
              as String?,
      website: freezed == website
          ? _value.website
          : website // ignore: cast_nullable_to_non_nullable
              as String?,
      rating: freezed == rating
          ? _value.rating
          : rating // ignore: cast_nullable_to_non_nullable
              as double?,
      totalRatings: freezed == totalRatings
          ? _value.totalRatings
          : totalRatings // ignore: cast_nullable_to_non_nullable
              as int?,
      types: freezed == types
          ? _value._types
          : types // ignore: cast_nullable_to_non_nullable
              as List<String>?,
      openingHours: freezed == openingHours
          ? _value.openingHours
          : openingHours // ignore: cast_nullable_to_non_nullable
              as PlaceOpeningHours?,
      viewport: freezed == viewport
          ? _value.viewport
          : viewport // ignore: cast_nullable_to_non_nullable
              as GeoBounds?,
      addressComponents: freezed == addressComponents
          ? _value._addressComponents
          : addressComponents // ignore: cast_nullable_to_non_nullable
              as List<AddressComponent>?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$PlaceDetailsImpl extends _PlaceDetails {
  const _$PlaceDetailsImpl(
      {required this.placeId,
      required this.name,
      required this.location,
      this.formattedAddress,
      this.formattedPhoneNumber,
      this.website,
      this.rating,
      this.totalRatings,
      final List<String>? types,
      this.openingHours,
      this.viewport,
      final List<AddressComponent>? addressComponents})
      : _types = types,
        _addressComponents = addressComponents,
        super._();

  factory _$PlaceDetailsImpl.fromJson(Map<String, dynamic> json) =>
      _$$PlaceDetailsImplFromJson(json);

  @override
  final String placeId;
  @override
  final String name;
  @override
  final GeoLocation location;
  @override
  final String? formattedAddress;
  @override
  final String? formattedPhoneNumber;
  @override
  final String? website;
  @override
  final double? rating;
  @override
  final int? totalRatings;
  final List<String>? _types;
  @override
  List<String>? get types {
    final value = _types;
    if (value == null) return null;
    if (_types is EqualUnmodifiableListView) return _types;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(value);
  }

  @override
  final PlaceOpeningHours? openingHours;
  @override
  final GeoBounds? viewport;
  final List<AddressComponent>? _addressComponents;
  @override
  List<AddressComponent>? get addressComponents {
    final value = _addressComponents;
    if (value == null) return null;
    if (_addressComponents is EqualUnmodifiableListView)
      return _addressComponents;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(value);
  }

  @override
  String toString() {
    return 'PlaceDetails(placeId: $placeId, name: $name, location: $location, formattedAddress: $formattedAddress, formattedPhoneNumber: $formattedPhoneNumber, website: $website, rating: $rating, totalRatings: $totalRatings, types: $types, openingHours: $openingHours, viewport: $viewport, addressComponents: $addressComponents)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$PlaceDetailsImpl &&
            (identical(other.placeId, placeId) || other.placeId == placeId) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.location, location) ||
                other.location == location) &&
            (identical(other.formattedAddress, formattedAddress) ||
                other.formattedAddress == formattedAddress) &&
            (identical(other.formattedPhoneNumber, formattedPhoneNumber) ||
                other.formattedPhoneNumber == formattedPhoneNumber) &&
            (identical(other.website, website) || other.website == website) &&
            (identical(other.rating, rating) || other.rating == rating) &&
            (identical(other.totalRatings, totalRatings) ||
                other.totalRatings == totalRatings) &&
            const DeepCollectionEquality().equals(other._types, _types) &&
            (identical(other.openingHours, openingHours) ||
                other.openingHours == openingHours) &&
            (identical(other.viewport, viewport) ||
                other.viewport == viewport) &&
            const DeepCollectionEquality()
                .equals(other._addressComponents, _addressComponents));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      placeId,
      name,
      location,
      formattedAddress,
      formattedPhoneNumber,
      website,
      rating,
      totalRatings,
      const DeepCollectionEquality().hash(_types),
      openingHours,
      viewport,
      const DeepCollectionEquality().hash(_addressComponents));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$PlaceDetailsImplCopyWith<_$PlaceDetailsImpl> get copyWith =>
      __$$PlaceDetailsImplCopyWithImpl<_$PlaceDetailsImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$PlaceDetailsImplToJson(
      this,
    );
  }
}

abstract class _PlaceDetails extends PlaceDetails {
  const factory _PlaceDetails(
      {required final String placeId,
      required final String name,
      required final GeoLocation location,
      final String? formattedAddress,
      final String? formattedPhoneNumber,
      final String? website,
      final double? rating,
      final int? totalRatings,
      final List<String>? types,
      final PlaceOpeningHours? openingHours,
      final GeoBounds? viewport,
      final List<AddressComponent>? addressComponents}) = _$PlaceDetailsImpl;
  const _PlaceDetails._() : super._();

  factory _PlaceDetails.fromJson(Map<String, dynamic> json) =
      _$PlaceDetailsImpl.fromJson;

  @override
  String get placeId;
  @override
  String get name;
  @override
  GeoLocation get location;
  @override
  String? get formattedAddress;
  @override
  String? get formattedPhoneNumber;
  @override
  String? get website;
  @override
  double? get rating;
  @override
  int? get totalRatings;
  @override
  List<String>? get types;
  @override
  PlaceOpeningHours? get openingHours;
  @override
  GeoBounds? get viewport;
  @override
  List<AddressComponent>? get addressComponents;
  @override
  @JsonKey(ignore: true)
  _$$PlaceDetailsImplCopyWith<_$PlaceDetailsImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

PlaceOpeningHours _$PlaceOpeningHoursFromJson(Map<String, dynamic> json) {
  return _PlaceOpeningHours.fromJson(json);
}

/// @nodoc
mixin _$PlaceOpeningHours {
  bool get isOpen => throw _privateConstructorUsedError;
  List<String>? get weekdayText => throw _privateConstructorUsedError;
  List<Period>? get periods => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $PlaceOpeningHoursCopyWith<PlaceOpeningHours> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $PlaceOpeningHoursCopyWith<$Res> {
  factory $PlaceOpeningHoursCopyWith(
          PlaceOpeningHours value, $Res Function(PlaceOpeningHours) then) =
      _$PlaceOpeningHoursCopyWithImpl<$Res, PlaceOpeningHours>;
  @useResult
  $Res call({bool isOpen, List<String>? weekdayText, List<Period>? periods});
}

/// @nodoc
class _$PlaceOpeningHoursCopyWithImpl<$Res, $Val extends PlaceOpeningHours>
    implements $PlaceOpeningHoursCopyWith<$Res> {
  _$PlaceOpeningHoursCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? isOpen = null,
    Object? weekdayText = freezed,
    Object? periods = freezed,
  }) {
    return _then(_value.copyWith(
      isOpen: null == isOpen
          ? _value.isOpen
          : isOpen // ignore: cast_nullable_to_non_nullable
              as bool,
      weekdayText: freezed == weekdayText
          ? _value.weekdayText
          : weekdayText // ignore: cast_nullable_to_non_nullable
              as List<String>?,
      periods: freezed == periods
          ? _value.periods
          : periods // ignore: cast_nullable_to_non_nullable
              as List<Period>?,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$PlaceOpeningHoursImplCopyWith<$Res>
    implements $PlaceOpeningHoursCopyWith<$Res> {
  factory _$$PlaceOpeningHoursImplCopyWith(_$PlaceOpeningHoursImpl value,
          $Res Function(_$PlaceOpeningHoursImpl) then) =
      __$$PlaceOpeningHoursImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({bool isOpen, List<String>? weekdayText, List<Period>? periods});
}

/// @nodoc
class __$$PlaceOpeningHoursImplCopyWithImpl<$Res>
    extends _$PlaceOpeningHoursCopyWithImpl<$Res, _$PlaceOpeningHoursImpl>
    implements _$$PlaceOpeningHoursImplCopyWith<$Res> {
  __$$PlaceOpeningHoursImplCopyWithImpl(_$PlaceOpeningHoursImpl _value,
      $Res Function(_$PlaceOpeningHoursImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? isOpen = null,
    Object? weekdayText = freezed,
    Object? periods = freezed,
  }) {
    return _then(_$PlaceOpeningHoursImpl(
      isOpen: null == isOpen
          ? _value.isOpen
          : isOpen // ignore: cast_nullable_to_non_nullable
              as bool,
      weekdayText: freezed == weekdayText
          ? _value._weekdayText
          : weekdayText // ignore: cast_nullable_to_non_nullable
              as List<String>?,
      periods: freezed == periods
          ? _value._periods
          : periods // ignore: cast_nullable_to_non_nullable
              as List<Period>?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$PlaceOpeningHoursImpl implements _PlaceOpeningHours {
  const _$PlaceOpeningHoursImpl(
      {required this.isOpen,
      final List<String>? weekdayText,
      final List<Period>? periods})
      : _weekdayText = weekdayText,
        _periods = periods;

  factory _$PlaceOpeningHoursImpl.fromJson(Map<String, dynamic> json) =>
      _$$PlaceOpeningHoursImplFromJson(json);

  @override
  final bool isOpen;
  final List<String>? _weekdayText;
  @override
  List<String>? get weekdayText {
    final value = _weekdayText;
    if (value == null) return null;
    if (_weekdayText is EqualUnmodifiableListView) return _weekdayText;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(value);
  }

  final List<Period>? _periods;
  @override
  List<Period>? get periods {
    final value = _periods;
    if (value == null) return null;
    if (_periods is EqualUnmodifiableListView) return _periods;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(value);
  }

  @override
  String toString() {
    return 'PlaceOpeningHours(isOpen: $isOpen, weekdayText: $weekdayText, periods: $periods)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$PlaceOpeningHoursImpl &&
            (identical(other.isOpen, isOpen) || other.isOpen == isOpen) &&
            const DeepCollectionEquality()
                .equals(other._weekdayText, _weekdayText) &&
            const DeepCollectionEquality().equals(other._periods, _periods));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      isOpen,
      const DeepCollectionEquality().hash(_weekdayText),
      const DeepCollectionEquality().hash(_periods));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$PlaceOpeningHoursImplCopyWith<_$PlaceOpeningHoursImpl> get copyWith =>
      __$$PlaceOpeningHoursImplCopyWithImpl<_$PlaceOpeningHoursImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$PlaceOpeningHoursImplToJson(
      this,
    );
  }
}

abstract class _PlaceOpeningHours implements PlaceOpeningHours {
  const factory _PlaceOpeningHours(
      {required final bool isOpen,
      final List<String>? weekdayText,
      final List<Period>? periods}) = _$PlaceOpeningHoursImpl;

  factory _PlaceOpeningHours.fromJson(Map<String, dynamic> json) =
      _$PlaceOpeningHoursImpl.fromJson;

  @override
  bool get isOpen;
  @override
  List<String>? get weekdayText;
  @override
  List<Period>? get periods;
  @override
  @JsonKey(ignore: true)
  _$$PlaceOpeningHoursImplCopyWith<_$PlaceOpeningHoursImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

Period _$PeriodFromJson(Map<String, dynamic> json) {
  return _Period.fromJson(json);
}

/// @nodoc
mixin _$Period {
  TimeOfWeek get open => throw _privateConstructorUsedError;
  TimeOfWeek? get close => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $PeriodCopyWith<Period> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $PeriodCopyWith<$Res> {
  factory $PeriodCopyWith(Period value, $Res Function(Period) then) =
      _$PeriodCopyWithImpl<$Res, Period>;
  @useResult
  $Res call({TimeOfWeek open, TimeOfWeek? close});

  $TimeOfWeekCopyWith<$Res> get open;
  $TimeOfWeekCopyWith<$Res>? get close;
}

/// @nodoc
class _$PeriodCopyWithImpl<$Res, $Val extends Period>
    implements $PeriodCopyWith<$Res> {
  _$PeriodCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? open = null,
    Object? close = freezed,
  }) {
    return _then(_value.copyWith(
      open: null == open
          ? _value.open
          : open // ignore: cast_nullable_to_non_nullable
              as TimeOfWeek,
      close: freezed == close
          ? _value.close
          : close // ignore: cast_nullable_to_non_nullable
              as TimeOfWeek?,
    ) as $Val);
  }

  @override
  @pragma('vm:prefer-inline')
  $TimeOfWeekCopyWith<$Res> get open {
    return $TimeOfWeekCopyWith<$Res>(_value.open, (value) {
      return _then(_value.copyWith(open: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $TimeOfWeekCopyWith<$Res>? get close {
    if (_value.close == null) {
      return null;
    }

    return $TimeOfWeekCopyWith<$Res>(_value.close!, (value) {
      return _then(_value.copyWith(close: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$PeriodImplCopyWith<$Res> implements $PeriodCopyWith<$Res> {
  factory _$$PeriodImplCopyWith(
          _$PeriodImpl value, $Res Function(_$PeriodImpl) then) =
      __$$PeriodImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({TimeOfWeek open, TimeOfWeek? close});

  @override
  $TimeOfWeekCopyWith<$Res> get open;
  @override
  $TimeOfWeekCopyWith<$Res>? get close;
}

/// @nodoc
class __$$PeriodImplCopyWithImpl<$Res>
    extends _$PeriodCopyWithImpl<$Res, _$PeriodImpl>
    implements _$$PeriodImplCopyWith<$Res> {
  __$$PeriodImplCopyWithImpl(
      _$PeriodImpl _value, $Res Function(_$PeriodImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? open = null,
    Object? close = freezed,
  }) {
    return _then(_$PeriodImpl(
      open: null == open
          ? _value.open
          : open // ignore: cast_nullable_to_non_nullable
              as TimeOfWeek,
      close: freezed == close
          ? _value.close
          : close // ignore: cast_nullable_to_non_nullable
              as TimeOfWeek?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$PeriodImpl implements _Period {
  const _$PeriodImpl({required this.open, this.close});

  factory _$PeriodImpl.fromJson(Map<String, dynamic> json) =>
      _$$PeriodImplFromJson(json);

  @override
  final TimeOfWeek open;
  @override
  final TimeOfWeek? close;

  @override
  String toString() {
    return 'Period(open: $open, close: $close)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$PeriodImpl &&
            (identical(other.open, open) || other.open == open) &&
            (identical(other.close, close) || other.close == close));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(runtimeType, open, close);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$PeriodImplCopyWith<_$PeriodImpl> get copyWith =>
      __$$PeriodImplCopyWithImpl<_$PeriodImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$PeriodImplToJson(
      this,
    );
  }
}

abstract class _Period implements Period {
  const factory _Period(
      {required final TimeOfWeek open, final TimeOfWeek? close}) = _$PeriodImpl;

  factory _Period.fromJson(Map<String, dynamic> json) = _$PeriodImpl.fromJson;

  @override
  TimeOfWeek get open;
  @override
  TimeOfWeek? get close;
  @override
  @JsonKey(ignore: true)
  _$$PeriodImplCopyWith<_$PeriodImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

TimeOfWeek _$TimeOfWeekFromJson(Map<String, dynamic> json) {
  return _TimeOfWeek.fromJson(json);
}

/// @nodoc
mixin _$TimeOfWeek {
  int get day => throw _privateConstructorUsedError;
  String get time => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $TimeOfWeekCopyWith<TimeOfWeek> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $TimeOfWeekCopyWith<$Res> {
  factory $TimeOfWeekCopyWith(
          TimeOfWeek value, $Res Function(TimeOfWeek) then) =
      _$TimeOfWeekCopyWithImpl<$Res, TimeOfWeek>;
  @useResult
  $Res call({int day, String time});
}

/// @nodoc
class _$TimeOfWeekCopyWithImpl<$Res, $Val extends TimeOfWeek>
    implements $TimeOfWeekCopyWith<$Res> {
  _$TimeOfWeekCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? day = null,
    Object? time = null,
  }) {
    return _then(_value.copyWith(
      day: null == day
          ? _value.day
          : day // ignore: cast_nullable_to_non_nullable
              as int,
      time: null == time
          ? _value.time
          : time // ignore: cast_nullable_to_non_nullable
              as String,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$TimeOfWeekImplCopyWith<$Res>
    implements $TimeOfWeekCopyWith<$Res> {
  factory _$$TimeOfWeekImplCopyWith(
          _$TimeOfWeekImpl value, $Res Function(_$TimeOfWeekImpl) then) =
      __$$TimeOfWeekImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({int day, String time});
}

/// @nodoc
class __$$TimeOfWeekImplCopyWithImpl<$Res>
    extends _$TimeOfWeekCopyWithImpl<$Res, _$TimeOfWeekImpl>
    implements _$$TimeOfWeekImplCopyWith<$Res> {
  __$$TimeOfWeekImplCopyWithImpl(
      _$TimeOfWeekImpl _value, $Res Function(_$TimeOfWeekImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? day = null,
    Object? time = null,
  }) {
    return _then(_$TimeOfWeekImpl(
      day: null == day
          ? _value.day
          : day // ignore: cast_nullable_to_non_nullable
              as int,
      time: null == time
          ? _value.time
          : time // ignore: cast_nullable_to_non_nullable
              as String,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$TimeOfWeekImpl implements _TimeOfWeek {
  const _$TimeOfWeekImpl({required this.day, required this.time});

  factory _$TimeOfWeekImpl.fromJson(Map<String, dynamic> json) =>
      _$$TimeOfWeekImplFromJson(json);

  @override
  final int day;
  @override
  final String time;

  @override
  String toString() {
    return 'TimeOfWeek(day: $day, time: $time)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$TimeOfWeekImpl &&
            (identical(other.day, day) || other.day == day) &&
            (identical(other.time, time) || other.time == time));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(runtimeType, day, time);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$TimeOfWeekImplCopyWith<_$TimeOfWeekImpl> get copyWith =>
      __$$TimeOfWeekImplCopyWithImpl<_$TimeOfWeekImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$TimeOfWeekImplToJson(
      this,
    );
  }
}

abstract class _TimeOfWeek implements TimeOfWeek {
  const factory _TimeOfWeek(
      {required final int day, required final String time}) = _$TimeOfWeekImpl;

  factory _TimeOfWeek.fromJson(Map<String, dynamic> json) =
      _$TimeOfWeekImpl.fromJson;

  @override
  int get day;
  @override
  String get time;
  @override
  @JsonKey(ignore: true)
  _$$TimeOfWeekImplCopyWith<_$TimeOfWeekImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

AddressComponent _$AddressComponentFromJson(Map<String, dynamic> json) {
  return _AddressComponent.fromJson(json);
}

/// @nodoc
mixin _$AddressComponent {
  String get longName => throw _privateConstructorUsedError;
  String get shortName => throw _privateConstructorUsedError;
  List<String> get types => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $AddressComponentCopyWith<AddressComponent> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $AddressComponentCopyWith<$Res> {
  factory $AddressComponentCopyWith(
          AddressComponent value, $Res Function(AddressComponent) then) =
      _$AddressComponentCopyWithImpl<$Res, AddressComponent>;
  @useResult
  $Res call({String longName, String shortName, List<String> types});
}

/// @nodoc
class _$AddressComponentCopyWithImpl<$Res, $Val extends AddressComponent>
    implements $AddressComponentCopyWith<$Res> {
  _$AddressComponentCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? longName = null,
    Object? shortName = null,
    Object? types = null,
  }) {
    return _then(_value.copyWith(
      longName: null == longName
          ? _value.longName
          : longName // ignore: cast_nullable_to_non_nullable
              as String,
      shortName: null == shortName
          ? _value.shortName
          : shortName // ignore: cast_nullable_to_non_nullable
              as String,
      types: null == types
          ? _value.types
          : types // ignore: cast_nullable_to_non_nullable
              as List<String>,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$AddressComponentImplCopyWith<$Res>
    implements $AddressComponentCopyWith<$Res> {
  factory _$$AddressComponentImplCopyWith(_$AddressComponentImpl value,
          $Res Function(_$AddressComponentImpl) then) =
      __$$AddressComponentImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String longName, String shortName, List<String> types});
}

/// @nodoc
class __$$AddressComponentImplCopyWithImpl<$Res>
    extends _$AddressComponentCopyWithImpl<$Res, _$AddressComponentImpl>
    implements _$$AddressComponentImplCopyWith<$Res> {
  __$$AddressComponentImplCopyWithImpl(_$AddressComponentImpl _value,
      $Res Function(_$AddressComponentImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? longName = null,
    Object? shortName = null,
    Object? types = null,
  }) {
    return _then(_$AddressComponentImpl(
      longName: null == longName
          ? _value.longName
          : longName // ignore: cast_nullable_to_non_nullable
              as String,
      shortName: null == shortName
          ? _value.shortName
          : shortName // ignore: cast_nullable_to_non_nullable
              as String,
      types: null == types
          ? _value._types
          : types // ignore: cast_nullable_to_non_nullable
              as List<String>,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$AddressComponentImpl implements _AddressComponent {
  const _$AddressComponentImpl(
      {required this.longName,
      required this.shortName,
      required final List<String> types})
      : _types = types;

  factory _$AddressComponentImpl.fromJson(Map<String, dynamic> json) =>
      _$$AddressComponentImplFromJson(json);

  @override
  final String longName;
  @override
  final String shortName;
  final List<String> _types;
  @override
  List<String> get types {
    if (_types is EqualUnmodifiableListView) return _types;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_types);
  }

  @override
  String toString() {
    return 'AddressComponent(longName: $longName, shortName: $shortName, types: $types)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AddressComponentImpl &&
            (identical(other.longName, longName) ||
                other.longName == longName) &&
            (identical(other.shortName, shortName) ||
                other.shortName == shortName) &&
            const DeepCollectionEquality().equals(other._types, _types));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(runtimeType, longName, shortName,
      const DeepCollectionEquality().hash(_types));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$AddressComponentImplCopyWith<_$AddressComponentImpl> get copyWith =>
      __$$AddressComponentImplCopyWithImpl<_$AddressComponentImpl>(
          this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$AddressComponentImplToJson(
      this,
    );
  }
}

abstract class _AddressComponent implements AddressComponent {
  const factory _AddressComponent(
      {required final String longName,
      required final String shortName,
      required final List<String> types}) = _$AddressComponentImpl;

  factory _AddressComponent.fromJson(Map<String, dynamic> json) =
      _$AddressComponentImpl.fromJson;

  @override
  String get longName;
  @override
  String get shortName;
  @override
  List<String> get types;
  @override
  @JsonKey(ignore: true)
  _$$AddressComponentImplCopyWith<_$AddressComponentImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
