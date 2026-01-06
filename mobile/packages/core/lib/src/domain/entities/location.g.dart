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

_$SavedPlaceImpl _$$SavedPlaceImplFromJson(Map<String, dynamic> json) =>
    _$SavedPlaceImpl(
      id: json['id'] as String,
      name: json['name'] as String,
      location: GeoLocation.fromJson(json['location'] as Map<String, dynamic>),
      type: $enumDecode(_$PlaceTypeEnumMap, json['type']),
      address: json['address'] as String?,
      instructions: json['instructions'] as String?,
      createdAt: json['createdAt'] == null
          ? null
          : DateTime.parse(json['createdAt'] as String),
      updatedAt: json['updatedAt'] == null
          ? null
          : DateTime.parse(json['updatedAt'] as String),
    );

Map<String, dynamic> _$$SavedPlaceImplToJson(_$SavedPlaceImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'location': instance.location,
      'type': _$PlaceTypeEnumMap[instance.type]!,
      'address': instance.address,
      'instructions': instance.instructions,
      'createdAt': instance.createdAt?.toIso8601String(),
      'updatedAt': instance.updatedAt?.toIso8601String(),
    };

const _$PlaceTypeEnumMap = {
  PlaceType.home: 'home',
  PlaceType.work: 'work',
  PlaceType.favorite: 'favorite',
  PlaceType.recent: 'recent',
  PlaceType.other: 'other',
};

_$PlaceSearchResultImpl _$$PlaceSearchResultImplFromJson(
        Map<String, dynamic> json) =>
    _$PlaceSearchResultImpl(
      placeId: json['placeId'] as String,
      name: json['name'] as String,
      address: json['address'] as String?,
      secondaryText: json['secondaryText'] as String?,
      location: json['location'] == null
          ? null
          : GeoLocation.fromJson(json['location'] as Map<String, dynamic>),
      distance: (json['distance'] as num?)?.toDouble(),
      types:
          (json['types'] as List<dynamic>?)?.map((e) => e as String).toList(),
    );

Map<String, dynamic> _$$PlaceSearchResultImplToJson(
        _$PlaceSearchResultImpl instance) =>
    <String, dynamic>{
      'placeId': instance.placeId,
      'name': instance.name,
      'address': instance.address,
      'secondaryText': instance.secondaryText,
      'location': instance.location,
      'distance': instance.distance,
      'types': instance.types,
    };

_$PlaceDetailsImpl _$$PlaceDetailsImplFromJson(Map<String, dynamic> json) =>
    _$PlaceDetailsImpl(
      placeId: json['placeId'] as String,
      name: json['name'] as String,
      location: GeoLocation.fromJson(json['location'] as Map<String, dynamic>),
      formattedAddress: json['formattedAddress'] as String?,
      formattedPhoneNumber: json['formattedPhoneNumber'] as String?,
      website: json['website'] as String?,
      rating: (json['rating'] as num?)?.toDouble(),
      totalRatings: (json['totalRatings'] as num?)?.toInt(),
      types:
          (json['types'] as List<dynamic>?)?.map((e) => e as String).toList(),
      openingHours: json['openingHours'] == null
          ? null
          : PlaceOpeningHours.fromJson(
              json['openingHours'] as Map<String, dynamic>),
      viewport: json['viewport'] == null
          ? null
          : GeoBounds.fromJson(json['viewport'] as Map<String, dynamic>),
      addressComponents: (json['addressComponents'] as List<dynamic>?)
          ?.map((e) => AddressComponent.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$$PlaceDetailsImplToJson(_$PlaceDetailsImpl instance) =>
    <String, dynamic>{
      'placeId': instance.placeId,
      'name': instance.name,
      'location': instance.location,
      'formattedAddress': instance.formattedAddress,
      'formattedPhoneNumber': instance.formattedPhoneNumber,
      'website': instance.website,
      'rating': instance.rating,
      'totalRatings': instance.totalRatings,
      'types': instance.types,
      'openingHours': instance.openingHours,
      'viewport': instance.viewport,
      'addressComponents': instance.addressComponents,
    };

_$PlaceOpeningHoursImpl _$$PlaceOpeningHoursImplFromJson(
        Map<String, dynamic> json) =>
    _$PlaceOpeningHoursImpl(
      isOpen: json['isOpen'] as bool,
      weekdayText: (json['weekdayText'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
      periods: (json['periods'] as List<dynamic>?)
          ?.map((e) => Period.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$$PlaceOpeningHoursImplToJson(
        _$PlaceOpeningHoursImpl instance) =>
    <String, dynamic>{
      'isOpen': instance.isOpen,
      'weekdayText': instance.weekdayText,
      'periods': instance.periods,
    };

_$PeriodImpl _$$PeriodImplFromJson(Map<String, dynamic> json) => _$PeriodImpl(
      open: TimeOfWeek.fromJson(json['open'] as Map<String, dynamic>),
      close: json['close'] == null
          ? null
          : TimeOfWeek.fromJson(json['close'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$$PeriodImplToJson(_$PeriodImpl instance) =>
    <String, dynamic>{
      'open': instance.open,
      'close': instance.close,
    };

_$TimeOfWeekImpl _$$TimeOfWeekImplFromJson(Map<String, dynamic> json) =>
    _$TimeOfWeekImpl(
      day: (json['day'] as num).toInt(),
      time: json['time'] as String,
    );

Map<String, dynamic> _$$TimeOfWeekImplToJson(_$TimeOfWeekImpl instance) =>
    <String, dynamic>{
      'day': instance.day,
      'time': instance.time,
    };

_$AddressComponentImpl _$$AddressComponentImplFromJson(
        Map<String, dynamic> json) =>
    _$AddressComponentImpl(
      longName: json['longName'] as String,
      shortName: json['shortName'] as String,
      types: (json['types'] as List<dynamic>).map((e) => e as String).toList(),
    );

Map<String, dynamic> _$$AddressComponentImplToJson(
        _$AddressComponentImpl instance) =>
    <String, dynamic>{
      'longName': instance.longName,
      'shortName': instance.shortName,
      'types': instance.types,
    };
