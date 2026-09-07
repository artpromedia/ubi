// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'location.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$GeoLocationImpl _$$GeoLocationImplFromJson(Map<String, dynamic> json) =>
    _$GeoLocationImpl(
      latitude: (json['latitude'] as num).toDouble(),
      longitude: (json['longitude'] as num).toDouble(),
      altitude: (json['altitude'] as num?)?.toDouble(),
      accuracy: (json['accuracy'] as num?)?.toDouble(),
      heading: (json['heading'] as num?)?.toDouble(),
      speed: (json['speed'] as num?)?.toDouble(),
      timestamp: json['timestamp'] == null
          ? null
          : DateTime.parse(json['timestamp'] as String),
    );

Map<String, dynamic> _$$GeoLocationImplToJson(_$GeoLocationImpl instance) =>
    <String, dynamic>{
      'latitude': instance.latitude,
      'longitude': instance.longitude,
      'altitude': instance.altitude,
      'accuracy': instance.accuracy,
      'heading': instance.heading,
      'speed': instance.speed,
      'timestamp': instance.timestamp?.toIso8601String(),
    };

_$LocationUpdateImpl _$$LocationUpdateImplFromJson(Map<String, dynamic> json) =>
    _$LocationUpdateImpl(
      location: GeoLocation.fromJson(json['location'] as Map<String, dynamic>),
      timestamp: DateTime.parse(json['timestamp'] as String),
      provider: json['provider'] as String?,
      isMocked: json['isMocked'] as bool?,
    );

Map<String, dynamic> _$$LocationUpdateImplToJson(
        _$LocationUpdateImpl instance) =>
    <String, dynamic>{
      'location': instance.location,
      'timestamp': instance.timestamp.toIso8601String(),
      'provider': instance.provider,
      'isMocked': instance.isMocked,
    };

_$GeoBoundsImpl _$$GeoBoundsImplFromJson(Map<String, dynamic> json) =>
    _$GeoBoundsImpl(
      northeast:
          GeoLocation.fromJson(json['northeast'] as Map<String, dynamic>),
      southwest:
          GeoLocation.fromJson(json['southwest'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$$GeoBoundsImplToJson(_$GeoBoundsImpl instance) =>
    <String, dynamic>{
      'northeast': instance.northeast,
      'southwest': instance.southwest,
    };
