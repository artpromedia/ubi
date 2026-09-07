// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'ride.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
    'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models');

Ride _$RideFromJson(Map<String, dynamic> json) {
  return _Ride.fromJson(json);
}

/// @nodoc
mixin _$Ride {
  String get id => throw _privateConstructorUsedError;
  String get riderId => throw _privateConstructorUsedError;
  GeoLocation get pickupLocation => throw _privateConstructorUsedError;
  GeoLocation get dropoffLocation => throw _privateConstructorUsedError;
  String get pickupAddress => throw _privateConstructorUsedError;
  String get dropoffAddress => throw _privateConstructorUsedError;
  VehicleType get vehicleType => throw _privateConstructorUsedError;
  RideStatus get status => throw _privateConstructorUsedError;
  String? get driverId => throw _privateConstructorUsedError;
  Driver? get driver => throw _privateConstructorUsedError;
  Vehicle? get vehicle => throw _privateConstructorUsedError;
  double? get estimatedFare => throw _privateConstructorUsedError;
  double? get actualFare => throw _privateConstructorUsedError;
  String? get currency => throw _privateConstructorUsedError;
  int? get estimatedDurationMinutes => throw _privateConstructorUsedError;
  double? get estimatedDistanceKm => throw _privateConstructorUsedError;
  int? get actualDurationMinutes => throw _privateConstructorUsedError;
  double? get actualDistanceKm => throw _privateConstructorUsedError;
  DateTime? get requestedAt => throw _privateConstructorUsedError;
  DateTime? get acceptedAt => throw _privateConstructorUsedError;
  DateTime? get arrivedAt => throw _privateConstructorUsedError;
  DateTime? get startedAt => throw _privateConstructorUsedError;
  DateTime? get completedAt => throw _privateConstructorUsedError;
  DateTime? get cancelledAt => throw _privateConstructorUsedError;
  CancellationReason? get cancellationReason =>
      throw _privateConstructorUsedError;
  String? get cancellationNote => throw _privateConstructorUsedError;
  String? get cancelledBy => throw _privateConstructorUsedError;
  double? get driverRating => throw _privateConstructorUsedError;
  String? get driverReview => throw _privateConstructorUsedError;
  double? get riderRating => throw _privateConstructorUsedError;
  String? get riderReview => throw _privateConstructorUsedError;
  String? get paymentMethodId => throw _privateConstructorUsedError;
  String? get paymentId => throw _privateConstructorUsedError;
  List<GeoLocation>? get routePolyline => throw _privateConstructorUsedError;
  Map<String, dynamic>? get metadata => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $RideCopyWith<Ride> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $RideCopyWith<$Res> {
  factory $RideCopyWith(Ride value, $Res Function(Ride) then) =
      _$RideCopyWithImpl<$Res, Ride>;
  @useResult
  $Res call(
      {String id,
      String riderId,
      GeoLocation pickupLocation,
      GeoLocation dropoffLocation,
      String pickupAddress,
      String dropoffAddress,
      VehicleType vehicleType,
      RideStatus status,
      String? driverId,
      Driver? driver,
      Vehicle? vehicle,
      double? estimatedFare,
      double? actualFare,
      String? currency,
      int? estimatedDurationMinutes,
      double? estimatedDistanceKm,
      int? actualDurationMinutes,
      double? actualDistanceKm,
      DateTime? requestedAt,
      DateTime? acceptedAt,
      DateTime? arrivedAt,
      DateTime? startedAt,
      DateTime? completedAt,
      DateTime? cancelledAt,
      CancellationReason? cancellationReason,
      String? cancellationNote,
      String? cancelledBy,
      double? driverRating,
      String? driverReview,
      double? riderRating,
      String? riderReview,
      String? paymentMethodId,
      String? paymentId,
      List<GeoLocation>? routePolyline,
      Map<String, dynamic>? metadata});

  $GeoLocationCopyWith<$Res> get pickupLocation;
  $GeoLocationCopyWith<$Res> get dropoffLocation;
  $DriverCopyWith<$Res>? get driver;
  $VehicleCopyWith<$Res>? get vehicle;
}

/// @nodoc
class _$RideCopyWithImpl<$Res, $Val extends Ride>
    implements $RideCopyWith<$Res> {
  _$RideCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? riderId = null,
    Object? pickupLocation = null,
    Object? dropoffLocation = null,
    Object? pickupAddress = null,
    Object? dropoffAddress = null,
    Object? vehicleType = null,
    Object? status = null,
    Object? driverId = freezed,
    Object? driver = freezed,
    Object? vehicle = freezed,
    Object? estimatedFare = freezed,
    Object? actualFare = freezed,
    Object? currency = freezed,
    Object? estimatedDurationMinutes = freezed,
    Object? estimatedDistanceKm = freezed,
    Object? actualDurationMinutes = freezed,
    Object? actualDistanceKm = freezed,
    Object? requestedAt = freezed,
    Object? acceptedAt = freezed,
    Object? arrivedAt = freezed,
    Object? startedAt = freezed,
    Object? completedAt = freezed,
    Object? cancelledAt = freezed,
    Object? cancellationReason = freezed,
    Object? cancellationNote = freezed,
    Object? cancelledBy = freezed,
    Object? driverRating = freezed,
    Object? driverReview = freezed,
    Object? riderRating = freezed,
    Object? riderReview = freezed,
    Object? paymentMethodId = freezed,
    Object? paymentId = freezed,
    Object? routePolyline = freezed,
    Object? metadata = freezed,
  }) {
    return _then(_value.copyWith(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      riderId: null == riderId
          ? _value.riderId
          : riderId // ignore: cast_nullable_to_non_nullable
              as String,
      pickupLocation: null == pickupLocation
          ? _value.pickupLocation
          : pickupLocation // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      dropoffLocation: null == dropoffLocation
          ? _value.dropoffLocation
          : dropoffLocation // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      pickupAddress: null == pickupAddress
          ? _value.pickupAddress
          : pickupAddress // ignore: cast_nullable_to_non_nullable
              as String,
      dropoffAddress: null == dropoffAddress
          ? _value.dropoffAddress
          : dropoffAddress // ignore: cast_nullable_to_non_nullable
              as String,
      vehicleType: null == vehicleType
          ? _value.vehicleType
          : vehicleType // ignore: cast_nullable_to_non_nullable
              as VehicleType,
      status: null == status
          ? _value.status
          : status // ignore: cast_nullable_to_non_nullable
              as RideStatus,
      driverId: freezed == driverId
          ? _value.driverId
          : driverId // ignore: cast_nullable_to_non_nullable
              as String?,
      driver: freezed == driver
          ? _value.driver
          : driver // ignore: cast_nullable_to_non_nullable
              as Driver?,
      vehicle: freezed == vehicle
          ? _value.vehicle
          : vehicle // ignore: cast_nullable_to_non_nullable
              as Vehicle?,
      estimatedFare: freezed == estimatedFare
          ? _value.estimatedFare
          : estimatedFare // ignore: cast_nullable_to_non_nullable
              as double?,
      actualFare: freezed == actualFare
          ? _value.actualFare
          : actualFare // ignore: cast_nullable_to_non_nullable
              as double?,
      currency: freezed == currency
          ? _value.currency
          : currency // ignore: cast_nullable_to_non_nullable
              as String?,
      estimatedDurationMinutes: freezed == estimatedDurationMinutes
          ? _value.estimatedDurationMinutes
          : estimatedDurationMinutes // ignore: cast_nullable_to_non_nullable
              as int?,
      estimatedDistanceKm: freezed == estimatedDistanceKm
          ? _value.estimatedDistanceKm
          : estimatedDistanceKm // ignore: cast_nullable_to_non_nullable
              as double?,
      actualDurationMinutes: freezed == actualDurationMinutes
          ? _value.actualDurationMinutes
          : actualDurationMinutes // ignore: cast_nullable_to_non_nullable
              as int?,
      actualDistanceKm: freezed == actualDistanceKm
          ? _value.actualDistanceKm
          : actualDistanceKm // ignore: cast_nullable_to_non_nullable
              as double?,
      requestedAt: freezed == requestedAt
          ? _value.requestedAt
          : requestedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      acceptedAt: freezed == acceptedAt
          ? _value.acceptedAt
          : acceptedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      arrivedAt: freezed == arrivedAt
          ? _value.arrivedAt
          : arrivedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      startedAt: freezed == startedAt
          ? _value.startedAt
          : startedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      completedAt: freezed == completedAt
          ? _value.completedAt
          : completedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      cancelledAt: freezed == cancelledAt
          ? _value.cancelledAt
          : cancelledAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      cancellationReason: freezed == cancellationReason
          ? _value.cancellationReason
          : cancellationReason // ignore: cast_nullable_to_non_nullable
              as CancellationReason?,
      cancellationNote: freezed == cancellationNote
          ? _value.cancellationNote
          : cancellationNote // ignore: cast_nullable_to_non_nullable
              as String?,
      cancelledBy: freezed == cancelledBy
          ? _value.cancelledBy
          : cancelledBy // ignore: cast_nullable_to_non_nullable
              as String?,
      driverRating: freezed == driverRating
          ? _value.driverRating
          : driverRating // ignore: cast_nullable_to_non_nullable
              as double?,
      driverReview: freezed == driverReview
          ? _value.driverReview
          : driverReview // ignore: cast_nullable_to_non_nullable
              as String?,
      riderRating: freezed == riderRating
          ? _value.riderRating
          : riderRating // ignore: cast_nullable_to_non_nullable
              as double?,
      riderReview: freezed == riderReview
          ? _value.riderReview
          : riderReview // ignore: cast_nullable_to_non_nullable
              as String?,
      paymentMethodId: freezed == paymentMethodId
          ? _value.paymentMethodId
          : paymentMethodId // ignore: cast_nullable_to_non_nullable
              as String?,
      paymentId: freezed == paymentId
          ? _value.paymentId
          : paymentId // ignore: cast_nullable_to_non_nullable
              as String?,
      routePolyline: freezed == routePolyline
          ? _value.routePolyline
          : routePolyline // ignore: cast_nullable_to_non_nullable
              as List<GeoLocation>?,
      metadata: freezed == metadata
          ? _value.metadata
          : metadata // ignore: cast_nullable_to_non_nullable
              as Map<String, dynamic>?,
    ) as $Val);
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoLocationCopyWith<$Res> get pickupLocation {
    return $GeoLocationCopyWith<$Res>(_value.pickupLocation, (value) {
      return _then(_value.copyWith(pickupLocation: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoLocationCopyWith<$Res> get dropoffLocation {
    return $GeoLocationCopyWith<$Res>(_value.dropoffLocation, (value) {
      return _then(_value.copyWith(dropoffLocation: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $DriverCopyWith<$Res>? get driver {
    if (_value.driver == null) {
      return null;
    }

    return $DriverCopyWith<$Res>(_value.driver!, (value) {
      return _then(_value.copyWith(driver: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $VehicleCopyWith<$Res>? get vehicle {
    if (_value.vehicle == null) {
      return null;
    }

    return $VehicleCopyWith<$Res>(_value.vehicle!, (value) {
      return _then(_value.copyWith(vehicle: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$RideImplCopyWith<$Res> implements $RideCopyWith<$Res> {
  factory _$$RideImplCopyWith(
          _$RideImpl value, $Res Function(_$RideImpl) then) =
      __$$RideImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      String riderId,
      GeoLocation pickupLocation,
      GeoLocation dropoffLocation,
      String pickupAddress,
      String dropoffAddress,
      VehicleType vehicleType,
      RideStatus status,
      String? driverId,
      Driver? driver,
      Vehicle? vehicle,
      double? estimatedFare,
      double? actualFare,
      String? currency,
      int? estimatedDurationMinutes,
      double? estimatedDistanceKm,
      int? actualDurationMinutes,
      double? actualDistanceKm,
      DateTime? requestedAt,
      DateTime? acceptedAt,
      DateTime? arrivedAt,
      DateTime? startedAt,
      DateTime? completedAt,
      DateTime? cancelledAt,
      CancellationReason? cancellationReason,
      String? cancellationNote,
      String? cancelledBy,
      double? driverRating,
      String? driverReview,
      double? riderRating,
      String? riderReview,
      String? paymentMethodId,
      String? paymentId,
      List<GeoLocation>? routePolyline,
      Map<String, dynamic>? metadata});

  @override
  $GeoLocationCopyWith<$Res> get pickupLocation;
  @override
  $GeoLocationCopyWith<$Res> get dropoffLocation;
  @override
  $DriverCopyWith<$Res>? get driver;
  @override
  $VehicleCopyWith<$Res>? get vehicle;
}

/// @nodoc
class __$$RideImplCopyWithImpl<$Res>
    extends _$RideCopyWithImpl<$Res, _$RideImpl>
    implements _$$RideImplCopyWith<$Res> {
  __$$RideImplCopyWithImpl(_$RideImpl _value, $Res Function(_$RideImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? riderId = null,
    Object? pickupLocation = null,
    Object? dropoffLocation = null,
    Object? pickupAddress = null,
    Object? dropoffAddress = null,
    Object? vehicleType = null,
    Object? status = null,
    Object? driverId = freezed,
    Object? driver = freezed,
    Object? vehicle = freezed,
    Object? estimatedFare = freezed,
    Object? actualFare = freezed,
    Object? currency = freezed,
    Object? estimatedDurationMinutes = freezed,
    Object? estimatedDistanceKm = freezed,
    Object? actualDurationMinutes = freezed,
    Object? actualDistanceKm = freezed,
    Object? requestedAt = freezed,
    Object? acceptedAt = freezed,
    Object? arrivedAt = freezed,
    Object? startedAt = freezed,
    Object? completedAt = freezed,
    Object? cancelledAt = freezed,
    Object? cancellationReason = freezed,
    Object? cancellationNote = freezed,
    Object? cancelledBy = freezed,
    Object? driverRating = freezed,
    Object? driverReview = freezed,
    Object? riderRating = freezed,
    Object? riderReview = freezed,
    Object? paymentMethodId = freezed,
    Object? paymentId = freezed,
    Object? routePolyline = freezed,
    Object? metadata = freezed,
  }) {
    return _then(_$RideImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      riderId: null == riderId
          ? _value.riderId
          : riderId // ignore: cast_nullable_to_non_nullable
              as String,
      pickupLocation: null == pickupLocation
          ? _value.pickupLocation
          : pickupLocation // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      dropoffLocation: null == dropoffLocation
          ? _value.dropoffLocation
          : dropoffLocation // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      pickupAddress: null == pickupAddress
          ? _value.pickupAddress
          : pickupAddress // ignore: cast_nullable_to_non_nullable
              as String,
      dropoffAddress: null == dropoffAddress
          ? _value.dropoffAddress
          : dropoffAddress // ignore: cast_nullable_to_non_nullable
              as String,
      vehicleType: null == vehicleType
          ? _value.vehicleType
          : vehicleType // ignore: cast_nullable_to_non_nullable
              as VehicleType,
      status: null == status
          ? _value.status
          : status // ignore: cast_nullable_to_non_nullable
              as RideStatus,
      driverId: freezed == driverId
          ? _value.driverId
          : driverId // ignore: cast_nullable_to_non_nullable
              as String?,
      driver: freezed == driver
          ? _value.driver
          : driver // ignore: cast_nullable_to_non_nullable
              as Driver?,
      vehicle: freezed == vehicle
          ? _value.vehicle
          : vehicle // ignore: cast_nullable_to_non_nullable
              as Vehicle?,
      estimatedFare: freezed == estimatedFare
          ? _value.estimatedFare
          : estimatedFare // ignore: cast_nullable_to_non_nullable
              as double?,
      actualFare: freezed == actualFare
          ? _value.actualFare
          : actualFare // ignore: cast_nullable_to_non_nullable
              as double?,
      currency: freezed == currency
          ? _value.currency
          : currency // ignore: cast_nullable_to_non_nullable
              as String?,
      estimatedDurationMinutes: freezed == estimatedDurationMinutes
          ? _value.estimatedDurationMinutes
          : estimatedDurationMinutes // ignore: cast_nullable_to_non_nullable
              as int?,
      estimatedDistanceKm: freezed == estimatedDistanceKm
          ? _value.estimatedDistanceKm
          : estimatedDistanceKm // ignore: cast_nullable_to_non_nullable
              as double?,
      actualDurationMinutes: freezed == actualDurationMinutes
          ? _value.actualDurationMinutes
          : actualDurationMinutes // ignore: cast_nullable_to_non_nullable
              as int?,
      actualDistanceKm: freezed == actualDistanceKm
          ? _value.actualDistanceKm
          : actualDistanceKm // ignore: cast_nullable_to_non_nullable
              as double?,
      requestedAt: freezed == requestedAt
          ? _value.requestedAt
          : requestedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      acceptedAt: freezed == acceptedAt
          ? _value.acceptedAt
          : acceptedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      arrivedAt: freezed == arrivedAt
          ? _value.arrivedAt
          : arrivedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      startedAt: freezed == startedAt
          ? _value.startedAt
          : startedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      completedAt: freezed == completedAt
          ? _value.completedAt
          : completedAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      cancelledAt: freezed == cancelledAt
          ? _value.cancelledAt
          : cancelledAt // ignore: cast_nullable_to_non_nullable
              as DateTime?,
      cancellationReason: freezed == cancellationReason
          ? _value.cancellationReason
          : cancellationReason // ignore: cast_nullable_to_non_nullable
              as CancellationReason?,
      cancellationNote: freezed == cancellationNote
          ? _value.cancellationNote
          : cancellationNote // ignore: cast_nullable_to_non_nullable
              as String?,
      cancelledBy: freezed == cancelledBy
          ? _value.cancelledBy
          : cancelledBy // ignore: cast_nullable_to_non_nullable
              as String?,
      driverRating: freezed == driverRating
          ? _value.driverRating
          : driverRating // ignore: cast_nullable_to_non_nullable
              as double?,
      driverReview: freezed == driverReview
          ? _value.driverReview
          : driverReview // ignore: cast_nullable_to_non_nullable
              as String?,
      riderRating: freezed == riderRating
          ? _value.riderRating
          : riderRating // ignore: cast_nullable_to_non_nullable
              as double?,
      riderReview: freezed == riderReview
          ? _value.riderReview
          : riderReview // ignore: cast_nullable_to_non_nullable
              as String?,
      paymentMethodId: freezed == paymentMethodId
          ? _value.paymentMethodId
          : paymentMethodId // ignore: cast_nullable_to_non_nullable
              as String?,
      paymentId: freezed == paymentId
          ? _value.paymentId
          : paymentId // ignore: cast_nullable_to_non_nullable
              as String?,
      routePolyline: freezed == routePolyline
          ? _value._routePolyline
          : routePolyline // ignore: cast_nullable_to_non_nullable
              as List<GeoLocation>?,
      metadata: freezed == metadata
          ? _value._metadata
          : metadata // ignore: cast_nullable_to_non_nullable
              as Map<String, dynamic>?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$RideImpl extends _Ride {
  const _$RideImpl(
      {required this.id,
      required this.riderId,
      required this.pickupLocation,
      required this.dropoffLocation,
      required this.pickupAddress,
      required this.dropoffAddress,
      required this.vehicleType,
      required this.status,
      this.driverId,
      this.driver,
      this.vehicle,
      this.estimatedFare,
      this.actualFare,
      this.currency,
      this.estimatedDurationMinutes,
      this.estimatedDistanceKm,
      this.actualDurationMinutes,
      this.actualDistanceKm,
      this.requestedAt,
      this.acceptedAt,
      this.arrivedAt,
      this.startedAt,
      this.completedAt,
      this.cancelledAt,
      this.cancellationReason,
      this.cancellationNote,
      this.cancelledBy,
      this.driverRating,
      this.driverReview,
      this.riderRating,
      this.riderReview,
      this.paymentMethodId,
      this.paymentId,
      final List<GeoLocation>? routePolyline,
      final Map<String, dynamic>? metadata})
      : _routePolyline = routePolyline,
        _metadata = metadata,
        super._();

  factory _$RideImpl.fromJson(Map<String, dynamic> json) =>
      _$$RideImplFromJson(json);

  @override
  final String id;
  @override
  final String riderId;
  @override
  final GeoLocation pickupLocation;
  @override
  final GeoLocation dropoffLocation;
  @override
  final String pickupAddress;
  @override
  final String dropoffAddress;
  @override
  final VehicleType vehicleType;
  @override
  final RideStatus status;
  @override
  final String? driverId;
  @override
  final Driver? driver;
  @override
  final Vehicle? vehicle;
  @override
  final double? estimatedFare;
  @override
  final double? actualFare;
  @override
  final String? currency;
  @override
  final int? estimatedDurationMinutes;
  @override
  final double? estimatedDistanceKm;
  @override
  final int? actualDurationMinutes;
  @override
  final double? actualDistanceKm;
  @override
  final DateTime? requestedAt;
  @override
  final DateTime? acceptedAt;
  @override
  final DateTime? arrivedAt;
  @override
  final DateTime? startedAt;
  @override
  final DateTime? completedAt;
  @override
  final DateTime? cancelledAt;
  @override
  final CancellationReason? cancellationReason;
  @override
  final String? cancellationNote;
  @override
  final String? cancelledBy;
  @override
  final double? driverRating;
  @override
  final String? driverReview;
  @override
  final double? riderRating;
  @override
  final String? riderReview;
  @override
  final String? paymentMethodId;
  @override
  final String? paymentId;
  final List<GeoLocation>? _routePolyline;
  @override
  List<GeoLocation>? get routePolyline {
    final value = _routePolyline;
    if (value == null) return null;
    if (_routePolyline is EqualUnmodifiableListView) return _routePolyline;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(value);
  }

  final Map<String, dynamic>? _metadata;
  @override
  Map<String, dynamic>? get metadata {
    final value = _metadata;
    if (value == null) return null;
    if (_metadata is EqualUnmodifiableMapView) return _metadata;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableMapView(value);
  }

  @override
  String toString() {
    return 'Ride(id: $id, riderId: $riderId, pickupLocation: $pickupLocation, dropoffLocation: $dropoffLocation, pickupAddress: $pickupAddress, dropoffAddress: $dropoffAddress, vehicleType: $vehicleType, status: $status, driverId: $driverId, driver: $driver, vehicle: $vehicle, estimatedFare: $estimatedFare, actualFare: $actualFare, currency: $currency, estimatedDurationMinutes: $estimatedDurationMinutes, estimatedDistanceKm: $estimatedDistanceKm, actualDurationMinutes: $actualDurationMinutes, actualDistanceKm: $actualDistanceKm, requestedAt: $requestedAt, acceptedAt: $acceptedAt, arrivedAt: $arrivedAt, startedAt: $startedAt, completedAt: $completedAt, cancelledAt: $cancelledAt, cancellationReason: $cancellationReason, cancellationNote: $cancellationNote, cancelledBy: $cancelledBy, driverRating: $driverRating, driverReview: $driverReview, riderRating: $riderRating, riderReview: $riderReview, paymentMethodId: $paymentMethodId, paymentId: $paymentId, routePolyline: $routePolyline, metadata: $metadata)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$RideImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.riderId, riderId) || other.riderId == riderId) &&
            (identical(other.pickupLocation, pickupLocation) ||
                other.pickupLocation == pickupLocation) &&
            (identical(other.dropoffLocation, dropoffLocation) ||
                other.dropoffLocation == dropoffLocation) &&
            (identical(other.pickupAddress, pickupAddress) ||
                other.pickupAddress == pickupAddress) &&
            (identical(other.dropoffAddress, dropoffAddress) ||
                other.dropoffAddress == dropoffAddress) &&
            (identical(other.vehicleType, vehicleType) ||
                other.vehicleType == vehicleType) &&
            (identical(other.status, status) || other.status == status) &&
            (identical(other.driverId, driverId) ||
                other.driverId == driverId) &&
            (identical(other.driver, driver) || other.driver == driver) &&
            (identical(other.vehicle, vehicle) || other.vehicle == vehicle) &&
            (identical(other.estimatedFare, estimatedFare) ||
                other.estimatedFare == estimatedFare) &&
            (identical(other.actualFare, actualFare) ||
                other.actualFare == actualFare) &&
            (identical(other.currency, currency) ||
                other.currency == currency) &&
            (identical(
                    other.estimatedDurationMinutes, estimatedDurationMinutes) ||
                other.estimatedDurationMinutes == estimatedDurationMinutes) &&
            (identical(other.estimatedDistanceKm, estimatedDistanceKm) ||
                other.estimatedDistanceKm == estimatedDistanceKm) &&
            (identical(other.actualDurationMinutes, actualDurationMinutes) ||
                other.actualDurationMinutes == actualDurationMinutes) &&
            (identical(other.actualDistanceKm, actualDistanceKm) ||
                other.actualDistanceKm == actualDistanceKm) &&
            (identical(other.requestedAt, requestedAt) ||
                other.requestedAt == requestedAt) &&
            (identical(other.acceptedAt, acceptedAt) ||
                other.acceptedAt == acceptedAt) &&
            (identical(other.arrivedAt, arrivedAt) ||
                other.arrivedAt == arrivedAt) &&
            (identical(other.startedAt, startedAt) ||
                other.startedAt == startedAt) &&
            (identical(other.completedAt, completedAt) ||
                other.completedAt == completedAt) &&
            (identical(other.cancelledAt, cancelledAt) ||
                other.cancelledAt == cancelledAt) &&
            (identical(other.cancellationReason, cancellationReason) ||
                other.cancellationReason == cancellationReason) &&
            (identical(other.cancellationNote, cancellationNote) ||
                other.cancellationNote == cancellationNote) &&
            (identical(other.cancelledBy, cancelledBy) ||
                other.cancelledBy == cancelledBy) &&
            (identical(other.driverRating, driverRating) ||
                other.driverRating == driverRating) &&
            (identical(other.driverReview, driverReview) ||
                other.driverReview == driverReview) &&
            (identical(other.riderRating, riderRating) ||
                other.riderRating == riderRating) &&
            (identical(other.riderReview, riderReview) ||
                other.riderReview == riderReview) &&
            (identical(other.paymentMethodId, paymentMethodId) ||
                other.paymentMethodId == paymentMethodId) &&
            (identical(other.paymentId, paymentId) ||
                other.paymentId == paymentId) &&
            const DeepCollectionEquality()
                .equals(other._routePolyline, _routePolyline) &&
            const DeepCollectionEquality().equals(other._metadata, _metadata));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hashAll([
        runtimeType,
        id,
        riderId,
        pickupLocation,
        dropoffLocation,
        pickupAddress,
        dropoffAddress,
        vehicleType,
        status,
        driverId,
        driver,
        vehicle,
        estimatedFare,
        actualFare,
        currency,
        estimatedDurationMinutes,
        estimatedDistanceKm,
        actualDurationMinutes,
        actualDistanceKm,
        requestedAt,
        acceptedAt,
        arrivedAt,
        startedAt,
        completedAt,
        cancelledAt,
        cancellationReason,
        cancellationNote,
        cancelledBy,
        driverRating,
        driverReview,
        riderRating,
        riderReview,
        paymentMethodId,
        paymentId,
        const DeepCollectionEquality().hash(_routePolyline),
        const DeepCollectionEquality().hash(_metadata)
      ]);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$RideImplCopyWith<_$RideImpl> get copyWith =>
      __$$RideImplCopyWithImpl<_$RideImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$RideImplToJson(
      this,
    );
  }
}

abstract class _Ride extends Ride {
  const factory _Ride(
      {required final String id,
      required final String riderId,
      required final GeoLocation pickupLocation,
      required final GeoLocation dropoffLocation,
      required final String pickupAddress,
      required final String dropoffAddress,
      required final VehicleType vehicleType,
      required final RideStatus status,
      final String? driverId,
      final Driver? driver,
      final Vehicle? vehicle,
      final double? estimatedFare,
      final double? actualFare,
      final String? currency,
      final int? estimatedDurationMinutes,
      final double? estimatedDistanceKm,
      final int? actualDurationMinutes,
      final double? actualDistanceKm,
      final DateTime? requestedAt,
      final DateTime? acceptedAt,
      final DateTime? arrivedAt,
      final DateTime? startedAt,
      final DateTime? completedAt,
      final DateTime? cancelledAt,
      final CancellationReason? cancellationReason,
      final String? cancellationNote,
      final String? cancelledBy,
      final double? driverRating,
      final String? driverReview,
      final double? riderRating,
      final String? riderReview,
      final String? paymentMethodId,
      final String? paymentId,
      final List<GeoLocation>? routePolyline,
      final Map<String, dynamic>? metadata}) = _$RideImpl;
  const _Ride._() : super._();

  factory _Ride.fromJson(Map<String, dynamic> json) = _$RideImpl.fromJson;

  @override
  String get id;
  @override
  String get riderId;
  @override
  GeoLocation get pickupLocation;
  @override
  GeoLocation get dropoffLocation;
  @override
  String get pickupAddress;
  @override
  String get dropoffAddress;
  @override
  VehicleType get vehicleType;
  @override
  RideStatus get status;
  @override
  String? get driverId;
  @override
  Driver? get driver;
  @override
  Vehicle? get vehicle;
  @override
  double? get estimatedFare;
  @override
  double? get actualFare;
  @override
  String? get currency;
  @override
  int? get estimatedDurationMinutes;
  @override
  double? get estimatedDistanceKm;
  @override
  int? get actualDurationMinutes;
  @override
  double? get actualDistanceKm;
  @override
  DateTime? get requestedAt;
  @override
  DateTime? get acceptedAt;
  @override
  DateTime? get arrivedAt;
  @override
  DateTime? get startedAt;
  @override
  DateTime? get completedAt;
  @override
  DateTime? get cancelledAt;
  @override
  CancellationReason? get cancellationReason;
  @override
  String? get cancellationNote;
  @override
  String? get cancelledBy;
  @override
  double? get driverRating;
  @override
  String? get driverReview;
  @override
  double? get riderRating;
  @override
  String? get riderReview;
  @override
  String? get paymentMethodId;
  @override
  String? get paymentId;
  @override
  List<GeoLocation>? get routePolyline;
  @override
  Map<String, dynamic>? get metadata;
  @override
  @JsonKey(ignore: true)
  _$$RideImplCopyWith<_$RideImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

Driver _$DriverFromJson(Map<String, dynamic> json) {
  return _Driver.fromJson(json);
}

/// @nodoc
mixin _$Driver {
  String get id => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  String? get phoneNumber => throw _privateConstructorUsedError;
  String? get profileImageUrl => throw _privateConstructorUsedError;
  double? get rating => throw _privateConstructorUsedError;
  int? get totalTrips => throw _privateConstructorUsedError;
  GeoLocation? get currentLocation => throw _privateConstructorUsedError;
  int? get etaMinutes => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $DriverCopyWith<Driver> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $DriverCopyWith<$Res> {
  factory $DriverCopyWith(Driver value, $Res Function(Driver) then) =
      _$DriverCopyWithImpl<$Res, Driver>;
  @useResult
  $Res call(
      {String id,
      String name,
      String? phoneNumber,
      String? profileImageUrl,
      double? rating,
      int? totalTrips,
      GeoLocation? currentLocation,
      int? etaMinutes});

  $GeoLocationCopyWith<$Res>? get currentLocation;
}

/// @nodoc
class _$DriverCopyWithImpl<$Res, $Val extends Driver>
    implements $DriverCopyWith<$Res> {
  _$DriverCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? phoneNumber = freezed,
    Object? profileImageUrl = freezed,
    Object? rating = freezed,
    Object? totalTrips = freezed,
    Object? currentLocation = freezed,
    Object? etaMinutes = freezed,
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
      phoneNumber: freezed == phoneNumber
          ? _value.phoneNumber
          : phoneNumber // ignore: cast_nullable_to_non_nullable
              as String?,
      profileImageUrl: freezed == profileImageUrl
          ? _value.profileImageUrl
          : profileImageUrl // ignore: cast_nullable_to_non_nullable
              as String?,
      rating: freezed == rating
          ? _value.rating
          : rating // ignore: cast_nullable_to_non_nullable
              as double?,
      totalTrips: freezed == totalTrips
          ? _value.totalTrips
          : totalTrips // ignore: cast_nullable_to_non_nullable
              as int?,
      currentLocation: freezed == currentLocation
          ? _value.currentLocation
          : currentLocation // ignore: cast_nullable_to_non_nullable
              as GeoLocation?,
      etaMinutes: freezed == etaMinutes
          ? _value.etaMinutes
          : etaMinutes // ignore: cast_nullable_to_non_nullable
              as int?,
    ) as $Val);
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoLocationCopyWith<$Res>? get currentLocation {
    if (_value.currentLocation == null) {
      return null;
    }

    return $GeoLocationCopyWith<$Res>(_value.currentLocation!, (value) {
      return _then(_value.copyWith(currentLocation: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$DriverImplCopyWith<$Res> implements $DriverCopyWith<$Res> {
  factory _$$DriverImplCopyWith(
          _$DriverImpl value, $Res Function(_$DriverImpl) then) =
      __$$DriverImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      String name,
      String? phoneNumber,
      String? profileImageUrl,
      double? rating,
      int? totalTrips,
      GeoLocation? currentLocation,
      int? etaMinutes});

  @override
  $GeoLocationCopyWith<$Res>? get currentLocation;
}

/// @nodoc
class __$$DriverImplCopyWithImpl<$Res>
    extends _$DriverCopyWithImpl<$Res, _$DriverImpl>
    implements _$$DriverImplCopyWith<$Res> {
  __$$DriverImplCopyWithImpl(
      _$DriverImpl _value, $Res Function(_$DriverImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? phoneNumber = freezed,
    Object? profileImageUrl = freezed,
    Object? rating = freezed,
    Object? totalTrips = freezed,
    Object? currentLocation = freezed,
    Object? etaMinutes = freezed,
  }) {
    return _then(_$DriverImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      name: null == name
          ? _value.name
          : name // ignore: cast_nullable_to_non_nullable
              as String,
      phoneNumber: freezed == phoneNumber
          ? _value.phoneNumber
          : phoneNumber // ignore: cast_nullable_to_non_nullable
              as String?,
      profileImageUrl: freezed == profileImageUrl
          ? _value.profileImageUrl
          : profileImageUrl // ignore: cast_nullable_to_non_nullable
              as String?,
      rating: freezed == rating
          ? _value.rating
          : rating // ignore: cast_nullable_to_non_nullable
              as double?,
      totalTrips: freezed == totalTrips
          ? _value.totalTrips
          : totalTrips // ignore: cast_nullable_to_non_nullable
              as int?,
      currentLocation: freezed == currentLocation
          ? _value.currentLocation
          : currentLocation // ignore: cast_nullable_to_non_nullable
              as GeoLocation?,
      etaMinutes: freezed == etaMinutes
          ? _value.etaMinutes
          : etaMinutes // ignore: cast_nullable_to_non_nullable
              as int?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$DriverImpl implements _Driver {
  const _$DriverImpl(
      {required this.id,
      required this.name,
      this.phoneNumber,
      this.profileImageUrl,
      this.rating,
      this.totalTrips,
      this.currentLocation,
      this.etaMinutes});

  factory _$DriverImpl.fromJson(Map<String, dynamic> json) =>
      _$$DriverImplFromJson(json);

  @override
  final String id;
  @override
  final String name;
  @override
  final String? phoneNumber;
  @override
  final String? profileImageUrl;
  @override
  final double? rating;
  @override
  final int? totalTrips;
  @override
  final GeoLocation? currentLocation;
  @override
  final int? etaMinutes;

  @override
  String toString() {
    return 'Driver(id: $id, name: $name, phoneNumber: $phoneNumber, profileImageUrl: $profileImageUrl, rating: $rating, totalTrips: $totalTrips, currentLocation: $currentLocation, etaMinutes: $etaMinutes)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$DriverImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.phoneNumber, phoneNumber) ||
                other.phoneNumber == phoneNumber) &&
            (identical(other.profileImageUrl, profileImageUrl) ||
                other.profileImageUrl == profileImageUrl) &&
            (identical(other.rating, rating) || other.rating == rating) &&
            (identical(other.totalTrips, totalTrips) ||
                other.totalTrips == totalTrips) &&
            (identical(other.currentLocation, currentLocation) ||
                other.currentLocation == currentLocation) &&
            (identical(other.etaMinutes, etaMinutes) ||
                other.etaMinutes == etaMinutes));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(runtimeType, id, name, phoneNumber,
      profileImageUrl, rating, totalTrips, currentLocation, etaMinutes);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$DriverImplCopyWith<_$DriverImpl> get copyWith =>
      __$$DriverImplCopyWithImpl<_$DriverImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$DriverImplToJson(
      this,
    );
  }
}

abstract class _Driver implements Driver {
  const factory _Driver(
      {required final String id,
      required final String name,
      final String? phoneNumber,
      final String? profileImageUrl,
      final double? rating,
      final int? totalTrips,
      final GeoLocation? currentLocation,
      final int? etaMinutes}) = _$DriverImpl;

  factory _Driver.fromJson(Map<String, dynamic> json) = _$DriverImpl.fromJson;

  @override
  String get id;
  @override
  String get name;
  @override
  String? get phoneNumber;
  @override
  String? get profileImageUrl;
  @override
  double? get rating;
  @override
  int? get totalTrips;
  @override
  GeoLocation? get currentLocation;
  @override
  int? get etaMinutes;
  @override
  @JsonKey(ignore: true)
  _$$DriverImplCopyWith<_$DriverImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

Vehicle _$VehicleFromJson(Map<String, dynamic> json) {
  return _Vehicle.fromJson(json);
}

/// @nodoc
mixin _$Vehicle {
  String get id => throw _privateConstructorUsedError;
  String get make => throw _privateConstructorUsedError;
  String get model => throw _privateConstructorUsedError;
  String get color => throw _privateConstructorUsedError;
  String get plateNumber => throw _privateConstructorUsedError;
  int? get year => throw _privateConstructorUsedError;
  VehicleType? get type => throw _privateConstructorUsedError;
  String? get imageUrl => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $VehicleCopyWith<Vehicle> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $VehicleCopyWith<$Res> {
  factory $VehicleCopyWith(Vehicle value, $Res Function(Vehicle) then) =
      _$VehicleCopyWithImpl<$Res, Vehicle>;
  @useResult
  $Res call(
      {String id,
      String make,
      String model,
      String color,
      String plateNumber,
      int? year,
      VehicleType? type,
      String? imageUrl});
}

/// @nodoc
class _$VehicleCopyWithImpl<$Res, $Val extends Vehicle>
    implements $VehicleCopyWith<$Res> {
  _$VehicleCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? make = null,
    Object? model = null,
    Object? color = null,
    Object? plateNumber = null,
    Object? year = freezed,
    Object? type = freezed,
    Object? imageUrl = freezed,
  }) {
    return _then(_value.copyWith(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      make: null == make
          ? _value.make
          : make // ignore: cast_nullable_to_non_nullable
              as String,
      model: null == model
          ? _value.model
          : model // ignore: cast_nullable_to_non_nullable
              as String,
      color: null == color
          ? _value.color
          : color // ignore: cast_nullable_to_non_nullable
              as String,
      plateNumber: null == plateNumber
          ? _value.plateNumber
          : plateNumber // ignore: cast_nullable_to_non_nullable
              as String,
      year: freezed == year
          ? _value.year
          : year // ignore: cast_nullable_to_non_nullable
              as int?,
      type: freezed == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as VehicleType?,
      imageUrl: freezed == imageUrl
          ? _value.imageUrl
          : imageUrl // ignore: cast_nullable_to_non_nullable
              as String?,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$VehicleImplCopyWith<$Res> implements $VehicleCopyWith<$Res> {
  factory _$$VehicleImplCopyWith(
          _$VehicleImpl value, $Res Function(_$VehicleImpl) then) =
      __$$VehicleImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {String id,
      String make,
      String model,
      String color,
      String plateNumber,
      int? year,
      VehicleType? type,
      String? imageUrl});
}

/// @nodoc
class __$$VehicleImplCopyWithImpl<$Res>
    extends _$VehicleCopyWithImpl<$Res, _$VehicleImpl>
    implements _$$VehicleImplCopyWith<$Res> {
  __$$VehicleImplCopyWithImpl(
      _$VehicleImpl _value, $Res Function(_$VehicleImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? make = null,
    Object? model = null,
    Object? color = null,
    Object? plateNumber = null,
    Object? year = freezed,
    Object? type = freezed,
    Object? imageUrl = freezed,
  }) {
    return _then(_$VehicleImpl(
      id: null == id
          ? _value.id
          : id // ignore: cast_nullable_to_non_nullable
              as String,
      make: null == make
          ? _value.make
          : make // ignore: cast_nullable_to_non_nullable
              as String,
      model: null == model
          ? _value.model
          : model // ignore: cast_nullable_to_non_nullable
              as String,
      color: null == color
          ? _value.color
          : color // ignore: cast_nullable_to_non_nullable
              as String,
      plateNumber: null == plateNumber
          ? _value.plateNumber
          : plateNumber // ignore: cast_nullable_to_non_nullable
              as String,
      year: freezed == year
          ? _value.year
          : year // ignore: cast_nullable_to_non_nullable
              as int?,
      type: freezed == type
          ? _value.type
          : type // ignore: cast_nullable_to_non_nullable
              as VehicleType?,
      imageUrl: freezed == imageUrl
          ? _value.imageUrl
          : imageUrl // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$VehicleImpl implements _Vehicle {
  const _$VehicleImpl(
      {required this.id,
      required this.make,
      required this.model,
      required this.color,
      required this.plateNumber,
      this.year,
      this.type,
      this.imageUrl});

  factory _$VehicleImpl.fromJson(Map<String, dynamic> json) =>
      _$$VehicleImplFromJson(json);

  @override
  final String id;
  @override
  final String make;
  @override
  final String model;
  @override
  final String color;
  @override
  final String plateNumber;
  @override
  final int? year;
  @override
  final VehicleType? type;
  @override
  final String? imageUrl;

  @override
  String toString() {
    return 'Vehicle(id: $id, make: $make, model: $model, color: $color, plateNumber: $plateNumber, year: $year, type: $type, imageUrl: $imageUrl)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$VehicleImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.make, make) || other.make == make) &&
            (identical(other.model, model) || other.model == model) &&
            (identical(other.color, color) || other.color == color) &&
            (identical(other.plateNumber, plateNumber) ||
                other.plateNumber == plateNumber) &&
            (identical(other.year, year) || other.year == year) &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.imageUrl, imageUrl) ||
                other.imageUrl == imageUrl));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType, id, make, model, color, plateNumber, year, type, imageUrl);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$VehicleImplCopyWith<_$VehicleImpl> get copyWith =>
      __$$VehicleImplCopyWithImpl<_$VehicleImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$VehicleImplToJson(
      this,
    );
  }
}

abstract class _Vehicle implements Vehicle {
  const factory _Vehicle(
      {required final String id,
      required final String make,
      required final String model,
      required final String color,
      required final String plateNumber,
      final int? year,
      final VehicleType? type,
      final String? imageUrl}) = _$VehicleImpl;

  factory _Vehicle.fromJson(Map<String, dynamic> json) = _$VehicleImpl.fromJson;

  @override
  String get id;
  @override
  String get make;
  @override
  String get model;
  @override
  String get color;
  @override
  String get plateNumber;
  @override
  int? get year;
  @override
  VehicleType? get type;
  @override
  String? get imageUrl;
  @override
  @JsonKey(ignore: true)
  _$$VehicleImplCopyWith<_$VehicleImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

RideEstimate _$RideEstimateFromJson(Map<String, dynamic> json) {
  return _RideEstimate.fromJson(json);
}

/// @nodoc
mixin _$RideEstimate {
  VehicleType get vehicleType => throw _privateConstructorUsedError;
  double get estimatedFare => throw _privateConstructorUsedError;
  String get currency => throw _privateConstructorUsedError;
  int get estimatedDurationMinutes => throw _privateConstructorUsedError;
  double get estimatedDistanceKm => throw _privateConstructorUsedError;
  int get etaMinutes => throw _privateConstructorUsedError;
  double? get surgePriceMultiplier => throw _privateConstructorUsedError;
  String? get promoCode => throw _privateConstructorUsedError;
  double? get discount => throw _privateConstructorUsedError;
  bool? get isAvailable => throw _privateConstructorUsedError;
  String? get unavailableReason => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $RideEstimateCopyWith<RideEstimate> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $RideEstimateCopyWith<$Res> {
  factory $RideEstimateCopyWith(
          RideEstimate value, $Res Function(RideEstimate) then) =
      _$RideEstimateCopyWithImpl<$Res, RideEstimate>;
  @useResult
  $Res call(
      {VehicleType vehicleType,
      double estimatedFare,
      String currency,
      int estimatedDurationMinutes,
      double estimatedDistanceKm,
      int etaMinutes,
      double? surgePriceMultiplier,
      String? promoCode,
      double? discount,
      bool? isAvailable,
      String? unavailableReason});
}

/// @nodoc
class _$RideEstimateCopyWithImpl<$Res, $Val extends RideEstimate>
    implements $RideEstimateCopyWith<$Res> {
  _$RideEstimateCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? vehicleType = null,
    Object? estimatedFare = null,
    Object? currency = null,
    Object? estimatedDurationMinutes = null,
    Object? estimatedDistanceKm = null,
    Object? etaMinutes = null,
    Object? surgePriceMultiplier = freezed,
    Object? promoCode = freezed,
    Object? discount = freezed,
    Object? isAvailable = freezed,
    Object? unavailableReason = freezed,
  }) {
    return _then(_value.copyWith(
      vehicleType: null == vehicleType
          ? _value.vehicleType
          : vehicleType // ignore: cast_nullable_to_non_nullable
              as VehicleType,
      estimatedFare: null == estimatedFare
          ? _value.estimatedFare
          : estimatedFare // ignore: cast_nullable_to_non_nullable
              as double,
      currency: null == currency
          ? _value.currency
          : currency // ignore: cast_nullable_to_non_nullable
              as String,
      estimatedDurationMinutes: null == estimatedDurationMinutes
          ? _value.estimatedDurationMinutes
          : estimatedDurationMinutes // ignore: cast_nullable_to_non_nullable
              as int,
      estimatedDistanceKm: null == estimatedDistanceKm
          ? _value.estimatedDistanceKm
          : estimatedDistanceKm // ignore: cast_nullable_to_non_nullable
              as double,
      etaMinutes: null == etaMinutes
          ? _value.etaMinutes
          : etaMinutes // ignore: cast_nullable_to_non_nullable
              as int,
      surgePriceMultiplier: freezed == surgePriceMultiplier
          ? _value.surgePriceMultiplier
          : surgePriceMultiplier // ignore: cast_nullable_to_non_nullable
              as double?,
      promoCode: freezed == promoCode
          ? _value.promoCode
          : promoCode // ignore: cast_nullable_to_non_nullable
              as String?,
      discount: freezed == discount
          ? _value.discount
          : discount // ignore: cast_nullable_to_non_nullable
              as double?,
      isAvailable: freezed == isAvailable
          ? _value.isAvailable
          : isAvailable // ignore: cast_nullable_to_non_nullable
              as bool?,
      unavailableReason: freezed == unavailableReason
          ? _value.unavailableReason
          : unavailableReason // ignore: cast_nullable_to_non_nullable
              as String?,
    ) as $Val);
  }
}

/// @nodoc
abstract class _$$RideEstimateImplCopyWith<$Res>
    implements $RideEstimateCopyWith<$Res> {
  factory _$$RideEstimateImplCopyWith(
          _$RideEstimateImpl value, $Res Function(_$RideEstimateImpl) then) =
      __$$RideEstimateImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {VehicleType vehicleType,
      double estimatedFare,
      String currency,
      int estimatedDurationMinutes,
      double estimatedDistanceKm,
      int etaMinutes,
      double? surgePriceMultiplier,
      String? promoCode,
      double? discount,
      bool? isAvailable,
      String? unavailableReason});
}

/// @nodoc
class __$$RideEstimateImplCopyWithImpl<$Res>
    extends _$RideEstimateCopyWithImpl<$Res, _$RideEstimateImpl>
    implements _$$RideEstimateImplCopyWith<$Res> {
  __$$RideEstimateImplCopyWithImpl(
      _$RideEstimateImpl _value, $Res Function(_$RideEstimateImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? vehicleType = null,
    Object? estimatedFare = null,
    Object? currency = null,
    Object? estimatedDurationMinutes = null,
    Object? estimatedDistanceKm = null,
    Object? etaMinutes = null,
    Object? surgePriceMultiplier = freezed,
    Object? promoCode = freezed,
    Object? discount = freezed,
    Object? isAvailable = freezed,
    Object? unavailableReason = freezed,
  }) {
    return _then(_$RideEstimateImpl(
      vehicleType: null == vehicleType
          ? _value.vehicleType
          : vehicleType // ignore: cast_nullable_to_non_nullable
              as VehicleType,
      estimatedFare: null == estimatedFare
          ? _value.estimatedFare
          : estimatedFare // ignore: cast_nullable_to_non_nullable
              as double,
      currency: null == currency
          ? _value.currency
          : currency // ignore: cast_nullable_to_non_nullable
              as String,
      estimatedDurationMinutes: null == estimatedDurationMinutes
          ? _value.estimatedDurationMinutes
          : estimatedDurationMinutes // ignore: cast_nullable_to_non_nullable
              as int,
      estimatedDistanceKm: null == estimatedDistanceKm
          ? _value.estimatedDistanceKm
          : estimatedDistanceKm // ignore: cast_nullable_to_non_nullable
              as double,
      etaMinutes: null == etaMinutes
          ? _value.etaMinutes
          : etaMinutes // ignore: cast_nullable_to_non_nullable
              as int,
      surgePriceMultiplier: freezed == surgePriceMultiplier
          ? _value.surgePriceMultiplier
          : surgePriceMultiplier // ignore: cast_nullable_to_non_nullable
              as double?,
      promoCode: freezed == promoCode
          ? _value.promoCode
          : promoCode // ignore: cast_nullable_to_non_nullable
              as String?,
      discount: freezed == discount
          ? _value.discount
          : discount // ignore: cast_nullable_to_non_nullable
              as double?,
      isAvailable: freezed == isAvailable
          ? _value.isAvailable
          : isAvailable // ignore: cast_nullable_to_non_nullable
              as bool?,
      unavailableReason: freezed == unavailableReason
          ? _value.unavailableReason
          : unavailableReason // ignore: cast_nullable_to_non_nullable
              as String?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$RideEstimateImpl implements _RideEstimate {
  const _$RideEstimateImpl(
      {required this.vehicleType,
      required this.estimatedFare,
      required this.currency,
      required this.estimatedDurationMinutes,
      required this.estimatedDistanceKm,
      required this.etaMinutes,
      this.surgePriceMultiplier,
      this.promoCode,
      this.discount,
      this.isAvailable,
      this.unavailableReason});

  factory _$RideEstimateImpl.fromJson(Map<String, dynamic> json) =>
      _$$RideEstimateImplFromJson(json);

  @override
  final VehicleType vehicleType;
  @override
  final double estimatedFare;
  @override
  final String currency;
  @override
  final int estimatedDurationMinutes;
  @override
  final double estimatedDistanceKm;
  @override
  final int etaMinutes;
  @override
  final double? surgePriceMultiplier;
  @override
  final String? promoCode;
  @override
  final double? discount;
  @override
  final bool? isAvailable;
  @override
  final String? unavailableReason;

  @override
  String toString() {
    return 'RideEstimate(vehicleType: $vehicleType, estimatedFare: $estimatedFare, currency: $currency, estimatedDurationMinutes: $estimatedDurationMinutes, estimatedDistanceKm: $estimatedDistanceKm, etaMinutes: $etaMinutes, surgePriceMultiplier: $surgePriceMultiplier, promoCode: $promoCode, discount: $discount, isAvailable: $isAvailable, unavailableReason: $unavailableReason)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$RideEstimateImpl &&
            (identical(other.vehicleType, vehicleType) ||
                other.vehicleType == vehicleType) &&
            (identical(other.estimatedFare, estimatedFare) ||
                other.estimatedFare == estimatedFare) &&
            (identical(other.currency, currency) ||
                other.currency == currency) &&
            (identical(
                    other.estimatedDurationMinutes, estimatedDurationMinutes) ||
                other.estimatedDurationMinutes == estimatedDurationMinutes) &&
            (identical(other.estimatedDistanceKm, estimatedDistanceKm) ||
                other.estimatedDistanceKm == estimatedDistanceKm) &&
            (identical(other.etaMinutes, etaMinutes) ||
                other.etaMinutes == etaMinutes) &&
            (identical(other.surgePriceMultiplier, surgePriceMultiplier) ||
                other.surgePriceMultiplier == surgePriceMultiplier) &&
            (identical(other.promoCode, promoCode) ||
                other.promoCode == promoCode) &&
            (identical(other.discount, discount) ||
                other.discount == discount) &&
            (identical(other.isAvailable, isAvailable) ||
                other.isAvailable == isAvailable) &&
            (identical(other.unavailableReason, unavailableReason) ||
                other.unavailableReason == unavailableReason));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      vehicleType,
      estimatedFare,
      currency,
      estimatedDurationMinutes,
      estimatedDistanceKm,
      etaMinutes,
      surgePriceMultiplier,
      promoCode,
      discount,
      isAvailable,
      unavailableReason);

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$RideEstimateImplCopyWith<_$RideEstimateImpl> get copyWith =>
      __$$RideEstimateImplCopyWithImpl<_$RideEstimateImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$RideEstimateImplToJson(
      this,
    );
  }
}

abstract class _RideEstimate implements RideEstimate {
  const factory _RideEstimate(
      {required final VehicleType vehicleType,
      required final double estimatedFare,
      required final String currency,
      required final int estimatedDurationMinutes,
      required final double estimatedDistanceKm,
      required final int etaMinutes,
      final double? surgePriceMultiplier,
      final String? promoCode,
      final double? discount,
      final bool? isAvailable,
      final String? unavailableReason}) = _$RideEstimateImpl;

  factory _RideEstimate.fromJson(Map<String, dynamic> json) =
      _$RideEstimateImpl.fromJson;

  @override
  VehicleType get vehicleType;
  @override
  double get estimatedFare;
  @override
  String get currency;
  @override
  int get estimatedDurationMinutes;
  @override
  double get estimatedDistanceKm;
  @override
  int get etaMinutes;
  @override
  double? get surgePriceMultiplier;
  @override
  String? get promoCode;
  @override
  double? get discount;
  @override
  bool? get isAvailable;
  @override
  String? get unavailableReason;
  @override
  @JsonKey(ignore: true)
  _$$RideEstimateImplCopyWith<_$RideEstimateImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

RideRequest _$RideRequestFromJson(Map<String, dynamic> json) {
  return _RideRequest.fromJson(json);
}

/// @nodoc
mixin _$RideRequest {
  GeoLocation get pickupLocation => throw _privateConstructorUsedError;
  GeoLocation get dropoffLocation => throw _privateConstructorUsedError;
  String get pickupAddress => throw _privateConstructorUsedError;
  String get dropoffAddress => throw _privateConstructorUsedError;
  VehicleType get vehicleType => throw _privateConstructorUsedError;
  String? get paymentMethodId => throw _privateConstructorUsedError;
  String? get promoCode => throw _privateConstructorUsedError;
  String? get note => throw _privateConstructorUsedError;
  List<GeoLocation>? get stops => throw _privateConstructorUsedError;

  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;
  @JsonKey(ignore: true)
  $RideRequestCopyWith<RideRequest> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $RideRequestCopyWith<$Res> {
  factory $RideRequestCopyWith(
          RideRequest value, $Res Function(RideRequest) then) =
      _$RideRequestCopyWithImpl<$Res, RideRequest>;
  @useResult
  $Res call(
      {GeoLocation pickupLocation,
      GeoLocation dropoffLocation,
      String pickupAddress,
      String dropoffAddress,
      VehicleType vehicleType,
      String? paymentMethodId,
      String? promoCode,
      String? note,
      List<GeoLocation>? stops});

  $GeoLocationCopyWith<$Res> get pickupLocation;
  $GeoLocationCopyWith<$Res> get dropoffLocation;
}

/// @nodoc
class _$RideRequestCopyWithImpl<$Res, $Val extends RideRequest>
    implements $RideRequestCopyWith<$Res> {
  _$RideRequestCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? pickupLocation = null,
    Object? dropoffLocation = null,
    Object? pickupAddress = null,
    Object? dropoffAddress = null,
    Object? vehicleType = null,
    Object? paymentMethodId = freezed,
    Object? promoCode = freezed,
    Object? note = freezed,
    Object? stops = freezed,
  }) {
    return _then(_value.copyWith(
      pickupLocation: null == pickupLocation
          ? _value.pickupLocation
          : pickupLocation // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      dropoffLocation: null == dropoffLocation
          ? _value.dropoffLocation
          : dropoffLocation // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      pickupAddress: null == pickupAddress
          ? _value.pickupAddress
          : pickupAddress // ignore: cast_nullable_to_non_nullable
              as String,
      dropoffAddress: null == dropoffAddress
          ? _value.dropoffAddress
          : dropoffAddress // ignore: cast_nullable_to_non_nullable
              as String,
      vehicleType: null == vehicleType
          ? _value.vehicleType
          : vehicleType // ignore: cast_nullable_to_non_nullable
              as VehicleType,
      paymentMethodId: freezed == paymentMethodId
          ? _value.paymentMethodId
          : paymentMethodId // ignore: cast_nullable_to_non_nullable
              as String?,
      promoCode: freezed == promoCode
          ? _value.promoCode
          : promoCode // ignore: cast_nullable_to_non_nullable
              as String?,
      note: freezed == note
          ? _value.note
          : note // ignore: cast_nullable_to_non_nullable
              as String?,
      stops: freezed == stops
          ? _value.stops
          : stops // ignore: cast_nullable_to_non_nullable
              as List<GeoLocation>?,
    ) as $Val);
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoLocationCopyWith<$Res> get pickupLocation {
    return $GeoLocationCopyWith<$Res>(_value.pickupLocation, (value) {
      return _then(_value.copyWith(pickupLocation: value) as $Val);
    });
  }

  @override
  @pragma('vm:prefer-inline')
  $GeoLocationCopyWith<$Res> get dropoffLocation {
    return $GeoLocationCopyWith<$Res>(_value.dropoffLocation, (value) {
      return _then(_value.copyWith(dropoffLocation: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$RideRequestImplCopyWith<$Res>
    implements $RideRequestCopyWith<$Res> {
  factory _$$RideRequestImplCopyWith(
          _$RideRequestImpl value, $Res Function(_$RideRequestImpl) then) =
      __$$RideRequestImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call(
      {GeoLocation pickupLocation,
      GeoLocation dropoffLocation,
      String pickupAddress,
      String dropoffAddress,
      VehicleType vehicleType,
      String? paymentMethodId,
      String? promoCode,
      String? note,
      List<GeoLocation>? stops});

  @override
  $GeoLocationCopyWith<$Res> get pickupLocation;
  @override
  $GeoLocationCopyWith<$Res> get dropoffLocation;
}

/// @nodoc
class __$$RideRequestImplCopyWithImpl<$Res>
    extends _$RideRequestCopyWithImpl<$Res, _$RideRequestImpl>
    implements _$$RideRequestImplCopyWith<$Res> {
  __$$RideRequestImplCopyWithImpl(
      _$RideRequestImpl _value, $Res Function(_$RideRequestImpl) _then)
      : super(_value, _then);

  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? pickupLocation = null,
    Object? dropoffLocation = null,
    Object? pickupAddress = null,
    Object? dropoffAddress = null,
    Object? vehicleType = null,
    Object? paymentMethodId = freezed,
    Object? promoCode = freezed,
    Object? note = freezed,
    Object? stops = freezed,
  }) {
    return _then(_$RideRequestImpl(
      pickupLocation: null == pickupLocation
          ? _value.pickupLocation
          : pickupLocation // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      dropoffLocation: null == dropoffLocation
          ? _value.dropoffLocation
          : dropoffLocation // ignore: cast_nullable_to_non_nullable
              as GeoLocation,
      pickupAddress: null == pickupAddress
          ? _value.pickupAddress
          : pickupAddress // ignore: cast_nullable_to_non_nullable
              as String,
      dropoffAddress: null == dropoffAddress
          ? _value.dropoffAddress
          : dropoffAddress // ignore: cast_nullable_to_non_nullable
              as String,
      vehicleType: null == vehicleType
          ? _value.vehicleType
          : vehicleType // ignore: cast_nullable_to_non_nullable
              as VehicleType,
      paymentMethodId: freezed == paymentMethodId
          ? _value.paymentMethodId
          : paymentMethodId // ignore: cast_nullable_to_non_nullable
              as String?,
      promoCode: freezed == promoCode
          ? _value.promoCode
          : promoCode // ignore: cast_nullable_to_non_nullable
              as String?,
      note: freezed == note
          ? _value.note
          : note // ignore: cast_nullable_to_non_nullable
              as String?,
      stops: freezed == stops
          ? _value._stops
          : stops // ignore: cast_nullable_to_non_nullable
              as List<GeoLocation>?,
    ));
  }
}

/// @nodoc
@JsonSerializable()
class _$RideRequestImpl implements _RideRequest {
  const _$RideRequestImpl(
      {required this.pickupLocation,
      required this.dropoffLocation,
      required this.pickupAddress,
      required this.dropoffAddress,
      required this.vehicleType,
      this.paymentMethodId,
      this.promoCode,
      this.note,
      final List<GeoLocation>? stops})
      : _stops = stops;

  factory _$RideRequestImpl.fromJson(Map<String, dynamic> json) =>
      _$$RideRequestImplFromJson(json);

  @override
  final GeoLocation pickupLocation;
  @override
  final GeoLocation dropoffLocation;
  @override
  final String pickupAddress;
  @override
  final String dropoffAddress;
  @override
  final VehicleType vehicleType;
  @override
  final String? paymentMethodId;
  @override
  final String? promoCode;
  @override
  final String? note;
  final List<GeoLocation>? _stops;
  @override
  List<GeoLocation>? get stops {
    final value = _stops;
    if (value == null) return null;
    if (_stops is EqualUnmodifiableListView) return _stops;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(value);
  }

  @override
  String toString() {
    return 'RideRequest(pickupLocation: $pickupLocation, dropoffLocation: $dropoffLocation, pickupAddress: $pickupAddress, dropoffAddress: $dropoffAddress, vehicleType: $vehicleType, paymentMethodId: $paymentMethodId, promoCode: $promoCode, note: $note, stops: $stops)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$RideRequestImpl &&
            (identical(other.pickupLocation, pickupLocation) ||
                other.pickupLocation == pickupLocation) &&
            (identical(other.dropoffLocation, dropoffLocation) ||
                other.dropoffLocation == dropoffLocation) &&
            (identical(other.pickupAddress, pickupAddress) ||
                other.pickupAddress == pickupAddress) &&
            (identical(other.dropoffAddress, dropoffAddress) ||
                other.dropoffAddress == dropoffAddress) &&
            (identical(other.vehicleType, vehicleType) ||
                other.vehicleType == vehicleType) &&
            (identical(other.paymentMethodId, paymentMethodId) ||
                other.paymentMethodId == paymentMethodId) &&
            (identical(other.promoCode, promoCode) ||
                other.promoCode == promoCode) &&
            (identical(other.note, note) || other.note == note) &&
            const DeepCollectionEquality().equals(other._stops, _stops));
  }

  @JsonKey(ignore: true)
  @override
  int get hashCode => Object.hash(
      runtimeType,
      pickupLocation,
      dropoffLocation,
      pickupAddress,
      dropoffAddress,
      vehicleType,
      paymentMethodId,
      promoCode,
      note,
      const DeepCollectionEquality().hash(_stops));

  @JsonKey(ignore: true)
  @override
  @pragma('vm:prefer-inline')
  _$$RideRequestImplCopyWith<_$RideRequestImpl> get copyWith =>
      __$$RideRequestImplCopyWithImpl<_$RideRequestImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$RideRequestImplToJson(
      this,
    );
  }
}

abstract class _RideRequest implements RideRequest {
  const factory _RideRequest(
      {required final GeoLocation pickupLocation,
      required final GeoLocation dropoffLocation,
      required final String pickupAddress,
      required final String dropoffAddress,
      required final VehicleType vehicleType,
      final String? paymentMethodId,
      final String? promoCode,
      final String? note,
      final List<GeoLocation>? stops}) = _$RideRequestImpl;

  factory _RideRequest.fromJson(Map<String, dynamic> json) =
      _$RideRequestImpl.fromJson;

  @override
  GeoLocation get pickupLocation;
  @override
  GeoLocation get dropoffLocation;
  @override
  String get pickupAddress;
  @override
  String get dropoffAddress;
  @override
  VehicleType get vehicleType;
  @override
  String? get paymentMethodId;
  @override
  String? get promoCode;
  @override
  String? get note;
  @override
  List<GeoLocation>? get stops;
  @override
  @JsonKey(ignore: true)
  _$$RideRequestImplCopyWith<_$RideRequestImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
