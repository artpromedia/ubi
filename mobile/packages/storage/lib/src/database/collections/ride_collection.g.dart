// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ride_collection.dart';

// **************************************************************************
// IsarCollectionGenerator
// **************************************************************************

// coverage:ignore-file
// ignore_for_file: duplicate_ignore, non_constant_identifier_names, constant_identifier_names, invalid_use_of_protected_member, unnecessary_cast, prefer_const_constructors, lines_longer_than_80_chars, require_trailing_commas, inference_failure_on_function_invocation, unnecessary_parenthesis, unnecessary_raw_strings, unnecessary_null_checks, join_return_with_assignment, prefer_final_locals, avoid_js_rounded_ints, avoid_positional_boolean_parameters, always_specify_types

extension GetCachedRideCollection on Isar {
  IsarCollection<CachedRide> get cachedRides => this.collection();
}

const CachedRideSchema = CollectionSchema(
  name: r'CachedRide',
  id: -1622933872511121636,
  properties: {
    r'acceptedAt': PropertySchema(
      id: 0,
      name: r'acceptedAt',
      type: IsarType.dateTime,
    ),
    r'actualFare': PropertySchema(
      id: 1,
      name: r'actualFare',
      type: IsarType.double,
    ),
    r'arrivedAt': PropertySchema(
      id: 2,
      name: r'arrivedAt',
      type: IsarType.dateTime,
    ),
    r'cachedAt': PropertySchema(
      id: 3,
      name: r'cachedAt',
      type: IsarType.dateTime,
    ),
    r'cancelledAt': PropertySchema(
      id: 4,
      name: r'cancelledAt',
      type: IsarType.dateTime,
    ),
    r'completedAt': PropertySchema(
      id: 5,
      name: r'completedAt',
      type: IsarType.dateTime,
    ),
    r'createdAt': PropertySchema(
      id: 6,
      name: r'createdAt',
      type: IsarType.dateTime,
    ),
    r'currency': PropertySchema(
      id: 7,
      name: r'currency',
      type: IsarType.string,
    ),
    r'driverId': PropertySchema(
      id: 8,
      name: r'driverId',
      type: IsarType.string,
    ),
    r'driverName': PropertySchema(
      id: 9,
      name: r'driverName',
      type: IsarType.string,
    ),
    r'driverPhotoUrl': PropertySchema(
      id: 10,
      name: r'driverPhotoUrl',
      type: IsarType.string,
    ),
    r'driverRating': PropertySchema(
      id: 11,
      name: r'driverRating',
      type: IsarType.double,
    ),
    r'dropoffAddress': PropertySchema(
      id: 12,
      name: r'dropoffAddress',
      type: IsarType.string,
    ),
    r'dropoffLatitude': PropertySchema(
      id: 13,
      name: r'dropoffLatitude',
      type: IsarType.double,
    ),
    r'dropoffLongitude': PropertySchema(
      id: 14,
      name: r'dropoffLongitude',
      type: IsarType.double,
    ),
    r'estimatedDistance': PropertySchema(
      id: 15,
      name: r'estimatedDistance',
      type: IsarType.double,
    ),
    r'estimatedDuration': PropertySchema(
      id: 16,
      name: r'estimatedDuration',
      type: IsarType.long,
    ),
    r'estimatedFare': PropertySchema(
      id: 17,
      name: r'estimatedFare',
      type: IsarType.double,
    ),
    r'isActive': PropertySchema(
      id: 18,
      name: r'isActive',
      type: IsarType.bool,
    ),
    r'pickupAddress': PropertySchema(
      id: 19,
      name: r'pickupAddress',
      type: IsarType.string,
    ),
    r'pickupLatitude': PropertySchema(
      id: 20,
      name: r'pickupLatitude',
      type: IsarType.double,
    ),
    r'pickupLongitude': PropertySchema(
      id: 21,
      name: r'pickupLongitude',
      type: IsarType.double,
    ),
    r'requestedAt': PropertySchema(
      id: 22,
      name: r'requestedAt',
      type: IsarType.dateTime,
    ),
    r'serverId': PropertySchema(
      id: 23,
      name: r'serverId',
      type: IsarType.string,
    ),
    r'startedAt': PropertySchema(
      id: 24,
      name: r'startedAt',
      type: IsarType.dateTime,
    ),
    r'status': PropertySchema(
      id: 25,
      name: r'status',
      type: IsarType.string,
    ),
    r'tip': PropertySchema(
      id: 26,
      name: r'tip',
      type: IsarType.double,
    ),
    r'userRating': PropertySchema(
      id: 27,
      name: r'userRating',
      type: IsarType.long,
    ),
    r'userReview': PropertySchema(
      id: 28,
      name: r'userReview',
      type: IsarType.string,
    ),
    r'vehicleColor': PropertySchema(
      id: 29,
      name: r'vehicleColor',
      type: IsarType.string,
    ),
    r'vehicleMake': PropertySchema(
      id: 30,
      name: r'vehicleMake',
      type: IsarType.string,
    ),
    r'vehicleModel': PropertySchema(
      id: 31,
      name: r'vehicleModel',
      type: IsarType.string,
    ),
    r'vehiclePlate': PropertySchema(
      id: 32,
      name: r'vehiclePlate',
      type: IsarType.string,
    ),
    r'vehicleType': PropertySchema(
      id: 33,
      name: r'vehicleType',
      type: IsarType.string,
    )
  },
  estimateSize: _cachedRideEstimateSize,
  serialize: _cachedRideSerialize,
  deserialize: _cachedRideDeserialize,
  deserializeProp: _cachedRideDeserializeProp,
  idName: r'id',
  indexes: {
    r'serverId': IndexSchema(
      id: -7950187970872907662,
      name: r'serverId',
      unique: true,
      replace: false,
      properties: [
        IndexPropertySchema(
          name: r'serverId',
          type: IndexType.hash,
          caseSensitive: true,
        )
      ],
    ),
    r'isActive': IndexSchema(
      id: 8092228061260947457,
      name: r'isActive',
      unique: false,
      replace: false,
      properties: [
        IndexPropertySchema(
          name: r'isActive',
          type: IndexType.value,
          caseSensitive: false,
        )
      ],
    ),
    r'createdAt': IndexSchema(
      id: -3433535483987302584,
      name: r'createdAt',
      unique: false,
      replace: false,
      properties: [
        IndexPropertySchema(
          name: r'createdAt',
          type: IndexType.value,
          caseSensitive: false,
        )
      ],
    )
  },
  links: {},
  embeddedSchemas: {},
  getId: _cachedRideGetId,
  getLinks: _cachedRideGetLinks,
  attach: _cachedRideAttach,
  version: '3.1.0+1',
);

int _cachedRideEstimateSize(
  CachedRide object,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  var bytesCount = offsets.last;
  {
    final value = object.currency;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.driverId;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.driverName;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.driverPhotoUrl;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.dropoffAddress.length * 3;
  bytesCount += 3 + object.pickupAddress.length * 3;
  bytesCount += 3 + object.serverId.length * 3;
  bytesCount += 3 + object.status.length * 3;
  {
    final value = object.userReview;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.vehicleColor;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.vehicleMake;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.vehicleModel;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.vehiclePlate;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.vehicleType.length * 3;
  return bytesCount;
}

void _cachedRideSerialize(
  CachedRide object,
  IsarWriter writer,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  writer.writeDateTime(offsets[0], object.acceptedAt);
  writer.writeDouble(offsets[1], object.actualFare);
  writer.writeDateTime(offsets[2], object.arrivedAt);
  writer.writeDateTime(offsets[3], object.cachedAt);
  writer.writeDateTime(offsets[4], object.cancelledAt);
  writer.writeDateTime(offsets[5], object.completedAt);
  writer.writeDateTime(offsets[6], object.createdAt);
  writer.writeString(offsets[7], object.currency);
  writer.writeString(offsets[8], object.driverId);
  writer.writeString(offsets[9], object.driverName);
  writer.writeString(offsets[10], object.driverPhotoUrl);
  writer.writeDouble(offsets[11], object.driverRating);
  writer.writeString(offsets[12], object.dropoffAddress);
  writer.writeDouble(offsets[13], object.dropoffLatitude);
  writer.writeDouble(offsets[14], object.dropoffLongitude);
  writer.writeDouble(offsets[15], object.estimatedDistance);
  writer.writeLong(offsets[16], object.estimatedDuration);
  writer.writeDouble(offsets[17], object.estimatedFare);
  writer.writeBool(offsets[18], object.isActive);
  writer.writeString(offsets[19], object.pickupAddress);
  writer.writeDouble(offsets[20], object.pickupLatitude);
  writer.writeDouble(offsets[21], object.pickupLongitude);
  writer.writeDateTime(offsets[22], object.requestedAt);
  writer.writeString(offsets[23], object.serverId);
  writer.writeDateTime(offsets[24], object.startedAt);
  writer.writeString(offsets[25], object.status);
  writer.writeDouble(offsets[26], object.tip);
  writer.writeLong(offsets[27], object.userRating);
  writer.writeString(offsets[28], object.userReview);
  writer.writeString(offsets[29], object.vehicleColor);
  writer.writeString(offsets[30], object.vehicleMake);
  writer.writeString(offsets[31], object.vehicleModel);
  writer.writeString(offsets[32], object.vehiclePlate);
  writer.writeString(offsets[33], object.vehicleType);
}

CachedRide _cachedRideDeserialize(
  Id id,
  IsarReader reader,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  final object = CachedRide();
  object.acceptedAt = reader.readDateTimeOrNull(offsets[0]);
  object.actualFare = reader.readDoubleOrNull(offsets[1]);
  object.arrivedAt = reader.readDateTimeOrNull(offsets[2]);
  object.cachedAt = reader.readDateTime(offsets[3]);
  object.cancelledAt = reader.readDateTimeOrNull(offsets[4]);
  object.completedAt = reader.readDateTimeOrNull(offsets[5]);
  object.createdAt = reader.readDateTimeOrNull(offsets[6]);
  object.currency = reader.readStringOrNull(offsets[7]);
  object.driverId = reader.readStringOrNull(offsets[8]);
  object.driverName = reader.readStringOrNull(offsets[9]);
  object.driverPhotoUrl = reader.readStringOrNull(offsets[10]);
  object.driverRating = reader.readDoubleOrNull(offsets[11]);
  object.dropoffAddress = reader.readString(offsets[12]);
  object.dropoffLatitude = reader.readDouble(offsets[13]);
  object.dropoffLongitude = reader.readDouble(offsets[14]);
  object.estimatedDistance = reader.readDoubleOrNull(offsets[15]);
  object.estimatedDuration = reader.readLongOrNull(offsets[16]);
  object.estimatedFare = reader.readDouble(offsets[17]);
  object.id = id;
  object.isActive = reader.readBool(offsets[18]);
  object.pickupAddress = reader.readString(offsets[19]);
  object.pickupLatitude = reader.readDouble(offsets[20]);
  object.pickupLongitude = reader.readDouble(offsets[21]);
  object.requestedAt = reader.readDateTimeOrNull(offsets[22]);
  object.serverId = reader.readString(offsets[23]);
  object.startedAt = reader.readDateTimeOrNull(offsets[24]);
  object.status = reader.readString(offsets[25]);
  object.tip = reader.readDoubleOrNull(offsets[26]);
  object.userRating = reader.readLongOrNull(offsets[27]);
  object.userReview = reader.readStringOrNull(offsets[28]);
  object.vehicleColor = reader.readStringOrNull(offsets[29]);
  object.vehicleMake = reader.readStringOrNull(offsets[30]);
  object.vehicleModel = reader.readStringOrNull(offsets[31]);
  object.vehiclePlate = reader.readStringOrNull(offsets[32]);
  object.vehicleType = reader.readString(offsets[33]);
  return object;
}

P _cachedRideDeserializeProp<P>(
  IsarReader reader,
  int propertyId,
  int offset,
  Map<Type, List<int>> allOffsets,
) {
  switch (propertyId) {
    case 0:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 1:
      return (reader.readDoubleOrNull(offset)) as P;
    case 2:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 3:
      return (reader.readDateTime(offset)) as P;
    case 4:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 5:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 6:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 7:
      return (reader.readStringOrNull(offset)) as P;
    case 8:
      return (reader.readStringOrNull(offset)) as P;
    case 9:
      return (reader.readStringOrNull(offset)) as P;
    case 10:
      return (reader.readStringOrNull(offset)) as P;
    case 11:
      return (reader.readDoubleOrNull(offset)) as P;
    case 12:
      return (reader.readString(offset)) as P;
    case 13:
      return (reader.readDouble(offset)) as P;
    case 14:
      return (reader.readDouble(offset)) as P;
    case 15:
      return (reader.readDoubleOrNull(offset)) as P;
    case 16:
      return (reader.readLongOrNull(offset)) as P;
    case 17:
      return (reader.readDouble(offset)) as P;
    case 18:
      return (reader.readBool(offset)) as P;
    case 19:
      return (reader.readString(offset)) as P;
    case 20:
      return (reader.readDouble(offset)) as P;
    case 21:
      return (reader.readDouble(offset)) as P;
    case 22:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 23:
      return (reader.readString(offset)) as P;
    case 24:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 25:
      return (reader.readString(offset)) as P;
    case 26:
      return (reader.readDoubleOrNull(offset)) as P;
    case 27:
      return (reader.readLongOrNull(offset)) as P;
    case 28:
      return (reader.readStringOrNull(offset)) as P;
    case 29:
      return (reader.readStringOrNull(offset)) as P;
    case 30:
      return (reader.readStringOrNull(offset)) as P;
    case 31:
      return (reader.readStringOrNull(offset)) as P;
    case 32:
      return (reader.readStringOrNull(offset)) as P;
    case 33:
      return (reader.readString(offset)) as P;
    default:
      throw IsarError('Unknown property with id $propertyId');
  }
}

Id _cachedRideGetId(CachedRide object) {
  return object.id;
}

List<IsarLinkBase<dynamic>> _cachedRideGetLinks(CachedRide object) {
  return [];
}

void _cachedRideAttach(IsarCollection<dynamic> col, Id id, CachedRide object) {
  object.id = id;
}

extension CachedRideByIndex on IsarCollection<CachedRide> {
  Future<CachedRide?> getByServerId(String serverId) {
    return getByIndex(r'serverId', [serverId]);
  }

  CachedRide? getByServerIdSync(String serverId) {
    return getByIndexSync(r'serverId', [serverId]);
  }

  Future<bool> deleteByServerId(String serverId) {
    return deleteByIndex(r'serverId', [serverId]);
  }

  bool deleteByServerIdSync(String serverId) {
    return deleteByIndexSync(r'serverId', [serverId]);
  }

  Future<List<CachedRide?>> getAllByServerId(List<String> serverIdValues) {
    final values = serverIdValues.map((e) => [e]).toList();
    return getAllByIndex(r'serverId', values);
  }

  List<CachedRide?> getAllByServerIdSync(List<String> serverIdValues) {
    final values = serverIdValues.map((e) => [e]).toList();
    return getAllByIndexSync(r'serverId', values);
  }

  Future<int> deleteAllByServerId(List<String> serverIdValues) {
    final values = serverIdValues.map((e) => [e]).toList();
    return deleteAllByIndex(r'serverId', values);
  }

  int deleteAllByServerIdSync(List<String> serverIdValues) {
    final values = serverIdValues.map((e) => [e]).toList();
    return deleteAllByIndexSync(r'serverId', values);
  }

  Future<Id> putByServerId(CachedRide object) {
    return putByIndex(r'serverId', object);
  }

  Id putByServerIdSync(CachedRide object, {bool saveLinks = true}) {
    return putByIndexSync(r'serverId', object, saveLinks: saveLinks);
  }

  Future<List<Id>> putAllByServerId(List<CachedRide> objects) {
    return putAllByIndex(r'serverId', objects);
  }

  List<Id> putAllByServerIdSync(List<CachedRide> objects,
      {bool saveLinks = true}) {
    return putAllByIndexSync(r'serverId', objects, saveLinks: saveLinks);
  }
}

extension CachedRideQueryWhereSort
    on QueryBuilder<CachedRide, CachedRide, QWhere> {
  QueryBuilder<CachedRide, CachedRide, QAfterWhere> anyId() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(const IdWhereClause.any());
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhere> anyIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        const IndexWhereClause.any(indexName: r'isActive'),
      );
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhere> anyCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        const IndexWhereClause.any(indexName: r'createdAt'),
      );
    });
  }
}

extension CachedRideQueryWhere
    on QueryBuilder<CachedRide, CachedRide, QWhereClause> {
  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> idEqualTo(Id id) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IdWhereClause.between(
        lower: id,
        upper: id,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> idNotEqualTo(Id id) {
    return QueryBuilder.apply(this, (query) {
      if (query.whereSort == Sort.asc) {
        return query
            .addWhereClause(
              IdWhereClause.lessThan(upper: id, includeUpper: false),
            )
            .addWhereClause(
              IdWhereClause.greaterThan(lower: id, includeLower: false),
            );
      } else {
        return query
            .addWhereClause(
              IdWhereClause.greaterThan(lower: id, includeLower: false),
            )
            .addWhereClause(
              IdWhereClause.lessThan(upper: id, includeUpper: false),
            );
      }
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> idGreaterThan(Id id,
      {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.greaterThan(lower: id, includeLower: include),
      );
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> idLessThan(Id id,
      {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.lessThan(upper: id, includeUpper: include),
      );
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> idBetween(
    Id lowerId,
    Id upperId, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IdWhereClause.between(
        lower: lowerId,
        includeLower: includeLower,
        upper: upperId,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> serverIdEqualTo(
      String serverId) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'serverId',
        value: [serverId],
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> serverIdNotEqualTo(
      String serverId) {
    return QueryBuilder.apply(this, (query) {
      if (query.whereSort == Sort.asc) {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'serverId',
              lower: [],
              upper: [serverId],
              includeUpper: false,
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'serverId',
              lower: [serverId],
              includeLower: false,
              upper: [],
            ));
      } else {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'serverId',
              lower: [serverId],
              includeLower: false,
              upper: [],
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'serverId',
              lower: [],
              upper: [serverId],
              includeUpper: false,
            ));
      }
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> isActiveEqualTo(
      bool isActive) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'isActive',
        value: [isActive],
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> isActiveNotEqualTo(
      bool isActive) {
    return QueryBuilder.apply(this, (query) {
      if (query.whereSort == Sort.asc) {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'isActive',
              lower: [],
              upper: [isActive],
              includeUpper: false,
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'isActive',
              lower: [isActive],
              includeLower: false,
              upper: [],
            ));
      } else {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'isActive',
              lower: [isActive],
              includeLower: false,
              upper: [],
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'isActive',
              lower: [],
              upper: [isActive],
              includeUpper: false,
            ));
      }
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> createdAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'createdAt',
        value: [null],
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> createdAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.between(
        indexName: r'createdAt',
        lower: [null],
        includeLower: false,
        upper: [],
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> createdAtEqualTo(
      DateTime? createdAt) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'createdAt',
        value: [createdAt],
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> createdAtNotEqualTo(
      DateTime? createdAt) {
    return QueryBuilder.apply(this, (query) {
      if (query.whereSort == Sort.asc) {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'createdAt',
              lower: [],
              upper: [createdAt],
              includeUpper: false,
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'createdAt',
              lower: [createdAt],
              includeLower: false,
              upper: [],
            ));
      } else {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'createdAt',
              lower: [createdAt],
              includeLower: false,
              upper: [],
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'createdAt',
              lower: [],
              upper: [createdAt],
              includeUpper: false,
            ));
      }
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> createdAtGreaterThan(
    DateTime? createdAt, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.between(
        indexName: r'createdAt',
        lower: [createdAt],
        includeLower: include,
        upper: [],
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> createdAtLessThan(
    DateTime? createdAt, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.between(
        indexName: r'createdAt',
        lower: [],
        upper: [createdAt],
        includeUpper: include,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterWhereClause> createdAtBetween(
    DateTime? lowerCreatedAt,
    DateTime? upperCreatedAt, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.between(
        indexName: r'createdAt',
        lower: [lowerCreatedAt],
        includeLower: includeLower,
        upper: [upperCreatedAt],
        includeUpper: includeUpper,
      ));
    });
  }
}

extension CachedRideQueryFilter
    on QueryBuilder<CachedRide, CachedRide, QFilterCondition> {
  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      acceptedAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'acceptedAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      acceptedAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'acceptedAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> acceptedAtEqualTo(
      DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'acceptedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      acceptedAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'acceptedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      acceptedAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'acceptedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> acceptedAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'acceptedAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      actualFareIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'actualFare',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      actualFareIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'actualFare',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> actualFareEqualTo(
    double? value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'actualFare',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      actualFareGreaterThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'actualFare',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      actualFareLessThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'actualFare',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> actualFareBetween(
    double? lower,
    double? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'actualFare',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      arrivedAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'arrivedAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      arrivedAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'arrivedAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> arrivedAtEqualTo(
      DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'arrivedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      arrivedAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'arrivedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> arrivedAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'arrivedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> arrivedAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'arrivedAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> cachedAtEqualTo(
      DateTime value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'cachedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      cachedAtGreaterThan(
    DateTime value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'cachedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> cachedAtLessThan(
    DateTime value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'cachedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> cachedAtBetween(
    DateTime lower,
    DateTime upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'cachedAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      cancelledAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'cancelledAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      cancelledAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'cancelledAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      cancelledAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'cancelledAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      cancelledAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'cancelledAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      cancelledAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'cancelledAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      cancelledAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'cancelledAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      completedAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'completedAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      completedAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'completedAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      completedAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'completedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      completedAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'completedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      completedAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'completedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      completedAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'completedAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      createdAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'createdAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      createdAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'createdAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> createdAtEqualTo(
      DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'createdAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      createdAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'createdAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> createdAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'createdAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> createdAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'createdAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> currencyIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'currency',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      currencyIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'currency',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> currencyEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'currency',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      currencyGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'currency',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> currencyLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'currency',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> currencyBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'currency',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      currencyStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'currency',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> currencyEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'currency',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> currencyContains(
      String value,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'currency',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> currencyMatches(
      String pattern,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'currency',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      currencyIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'currency',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      currencyIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'currency',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> driverIdIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'driverId',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverIdIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'driverId',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> driverIdEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'driverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverIdGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'driverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> driverIdLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'driverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> driverIdBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'driverId',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverIdStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'driverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> driverIdEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'driverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> driverIdContains(
      String value,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'driverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> driverIdMatches(
      String pattern,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'driverId',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverIdIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'driverId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverIdIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'driverId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverNameIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'driverName',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverNameIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'driverName',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> driverNameEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'driverName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverNameGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'driverName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverNameLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'driverName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> driverNameBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'driverName',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverNameStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'driverName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverNameEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'driverName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverNameContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'driverName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> driverNameMatches(
      String pattern,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'driverName',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverNameIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'driverName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverNameIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'driverName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'driverPhotoUrl',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'driverPhotoUrl',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'driverPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'driverPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'driverPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'driverPhotoUrl',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'driverPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'driverPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'driverPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'driverPhotoUrl',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'driverPhotoUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverPhotoUrlIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'driverPhotoUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverRatingIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'driverRating',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverRatingIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'driverRating',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverRatingEqualTo(
    double? value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'driverRating',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverRatingGreaterThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'driverRating',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverRatingLessThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'driverRating',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      driverRatingBetween(
    double? lower,
    double? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'driverRating',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffAddressEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'dropoffAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffAddressGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'dropoffAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffAddressLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'dropoffAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffAddressBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'dropoffAddress',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffAddressStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'dropoffAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffAddressEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'dropoffAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffAddressContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'dropoffAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffAddressMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'dropoffAddress',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffAddressIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'dropoffAddress',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffAddressIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'dropoffAddress',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffLatitudeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'dropoffLatitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffLatitudeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'dropoffLatitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffLatitudeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'dropoffLatitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffLatitudeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'dropoffLatitude',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffLongitudeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'dropoffLongitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffLongitudeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'dropoffLongitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffLongitudeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'dropoffLongitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      dropoffLongitudeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'dropoffLongitude',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDistanceIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'estimatedDistance',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDistanceIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'estimatedDistance',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDistanceEqualTo(
    double? value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'estimatedDistance',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDistanceGreaterThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'estimatedDistance',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDistanceLessThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'estimatedDistance',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDistanceBetween(
    double? lower,
    double? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'estimatedDistance',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDurationIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'estimatedDuration',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDurationIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'estimatedDuration',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDurationEqualTo(int? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'estimatedDuration',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDurationGreaterThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'estimatedDuration',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDurationLessThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'estimatedDuration',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedDurationBetween(
    int? lower,
    int? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'estimatedDuration',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedFareEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'estimatedFare',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedFareGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'estimatedFare',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedFareLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'estimatedFare',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      estimatedFareBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'estimatedFare',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> idEqualTo(
      Id value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'id',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> idGreaterThan(
    Id value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'id',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> idLessThan(
    Id value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'id',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> idBetween(
    Id lower,
    Id upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'id',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> isActiveEqualTo(
      bool value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'isActive',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupAddressEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickupAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupAddressGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'pickupAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupAddressLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'pickupAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupAddressBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'pickupAddress',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupAddressStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'pickupAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupAddressEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'pickupAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupAddressContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'pickupAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupAddressMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'pickupAddress',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupAddressIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickupAddress',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupAddressIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'pickupAddress',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupLatitudeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickupLatitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupLatitudeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'pickupLatitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupLatitudeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'pickupLatitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupLatitudeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'pickupLatitude',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupLongitudeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickupLongitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupLongitudeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'pickupLongitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupLongitudeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'pickupLongitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      pickupLongitudeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'pickupLongitude',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      requestedAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'requestedAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      requestedAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'requestedAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      requestedAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'requestedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      requestedAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'requestedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      requestedAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'requestedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      requestedAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'requestedAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> serverIdEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'serverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      serverIdGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'serverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> serverIdLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'serverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> serverIdBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'serverId',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      serverIdStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'serverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> serverIdEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'serverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> serverIdContains(
      String value,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'serverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> serverIdMatches(
      String pattern,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'serverId',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      serverIdIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'serverId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      serverIdIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'serverId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      startedAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'startedAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      startedAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'startedAt',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> startedAtEqualTo(
      DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'startedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      startedAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'startedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> startedAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'startedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> startedAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'startedAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> statusEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'status',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> statusGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'status',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> statusLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'status',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> statusBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'status',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> statusStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'status',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> statusEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'status',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> statusContains(
      String value,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'status',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> statusMatches(
      String pattern,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'status',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> statusIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'status',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      statusIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'status',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> tipIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'tip',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> tipIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'tip',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> tipEqualTo(
    double? value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'tip',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> tipGreaterThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'tip',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> tipLessThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'tip',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> tipBetween(
    double? lower,
    double? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'tip',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userRatingIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'userRating',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userRatingIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'userRating',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> userRatingEqualTo(
      int? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'userRating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userRatingGreaterThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'userRating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userRatingLessThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'userRating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> userRatingBetween(
    int? lower,
    int? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'userRating',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userReviewIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'userReview',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userReviewIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'userReview',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> userReviewEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'userReview',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userReviewGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'userReview',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userReviewLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'userReview',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> userReviewBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'userReview',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userReviewStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'userReview',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userReviewEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'userReview',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userReviewContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'userReview',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition> userReviewMatches(
      String pattern,
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'userReview',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userReviewIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'userReview',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      userReviewIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'userReview',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'vehicleColor',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'vehicleColor',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'vehicleColor',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'vehicleColor',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'vehicleColor',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'vehicleColor',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'vehicleColor',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'vehicleColor',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'vehicleColor',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'vehicleColor',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'vehicleColor',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleColorIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'vehicleColor',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'vehicleMake',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'vehicleMake',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'vehicleMake',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'vehicleMake',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'vehicleMake',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'vehicleMake',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'vehicleMake',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'vehicleMake',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'vehicleMake',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'vehicleMake',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'vehicleMake',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleMakeIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'vehicleMake',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'vehicleModel',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'vehicleModel',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'vehicleModel',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'vehicleModel',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'vehicleModel',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'vehicleModel',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'vehicleModel',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'vehicleModel',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'vehicleModel',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'vehicleModel',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'vehicleModel',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleModelIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'vehicleModel',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'vehiclePlate',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'vehiclePlate',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'vehiclePlate',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'vehiclePlate',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'vehiclePlate',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'vehiclePlate',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'vehiclePlate',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'vehiclePlate',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'vehiclePlate',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'vehiclePlate',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'vehiclePlate',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehiclePlateIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'vehiclePlate',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleTypeEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'vehicleType',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleTypeGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'vehicleType',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleTypeLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'vehicleType',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleTypeBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'vehicleType',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleTypeStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'vehicleType',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleTypeEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'vehicleType',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleTypeContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'vehicleType',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleTypeMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'vehicleType',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleTypeIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'vehicleType',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterFilterCondition>
      vehicleTypeIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'vehicleType',
        value: '',
      ));
    });
  }
}

extension CachedRideQueryObject
    on QueryBuilder<CachedRide, CachedRide, QFilterCondition> {}

extension CachedRideQueryLinks
    on QueryBuilder<CachedRide, CachedRide, QFilterCondition> {}

extension CachedRideQuerySortBy
    on QueryBuilder<CachedRide, CachedRide, QSortBy> {
  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByAcceptedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'acceptedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByAcceptedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'acceptedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByActualFare() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'actualFare', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByActualFareDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'actualFare', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByArrivedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'arrivedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByArrivedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'arrivedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByCachedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByCancelledAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByCancelledAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByCompletedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'completedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByCompletedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'completedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByCreatedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByCurrency() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByCurrencyDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByDriverId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverId', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByDriverIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverId', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByDriverName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverName', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByDriverNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverName', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByDriverPhotoUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverPhotoUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      sortByDriverPhotoUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverPhotoUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByDriverRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverRating', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByDriverRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverRating', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByDropoffAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffAddress', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      sortByDropoffAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffAddress', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByDropoffLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLatitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      sortByDropoffLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLatitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByDropoffLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLongitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      sortByDropoffLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLongitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByEstimatedDistance() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDistance', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      sortByEstimatedDistanceDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDistance', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByEstimatedDuration() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDuration', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      sortByEstimatedDurationDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDuration', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByEstimatedFare() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedFare', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByEstimatedFareDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedFare', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByIsActiveDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByPickupAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupAddress', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByPickupAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupAddress', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByPickupLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLatitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      sortByPickupLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLatitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByPickupLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLongitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      sortByPickupLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLongitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByRequestedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'requestedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByRequestedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'requestedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByServerId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByServerIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByStartedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'startedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByStartedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'startedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByStatus() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByStatusDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByTip() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByTipDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByUserRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'userRating', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByUserRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'userRating', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByUserReview() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'userReview', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByUserReviewDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'userReview', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByVehicleColor() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleColor', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByVehicleColorDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleColor', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByVehicleMake() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleMake', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByVehicleMakeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleMake', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByVehicleModel() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleModel', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByVehicleModelDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleModel', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByVehiclePlate() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehiclePlate', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByVehiclePlateDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehiclePlate', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByVehicleType() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleType', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> sortByVehicleTypeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleType', Sort.desc);
    });
  }
}

extension CachedRideQuerySortThenBy
    on QueryBuilder<CachedRide, CachedRide, QSortThenBy> {
  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByAcceptedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'acceptedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByAcceptedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'acceptedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByActualFare() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'actualFare', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByActualFareDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'actualFare', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByArrivedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'arrivedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByArrivedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'arrivedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByCachedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByCancelledAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByCancelledAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByCompletedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'completedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByCompletedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'completedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByCreatedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByCurrency() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByCurrencyDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByDriverId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverId', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByDriverIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverId', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByDriverName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverName', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByDriverNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverName', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByDriverPhotoUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverPhotoUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      thenByDriverPhotoUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverPhotoUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByDriverRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverRating', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByDriverRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'driverRating', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByDropoffAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffAddress', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      thenByDropoffAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffAddress', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByDropoffLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLatitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      thenByDropoffLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLatitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByDropoffLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLongitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      thenByDropoffLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLongitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByEstimatedDistance() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDistance', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      thenByEstimatedDistanceDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDistance', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByEstimatedDuration() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDuration', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      thenByEstimatedDurationDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDuration', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByEstimatedFare() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedFare', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByEstimatedFareDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedFare', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenById() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByIsActiveDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByPickupAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupAddress', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByPickupAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupAddress', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByPickupLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLatitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      thenByPickupLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLatitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByPickupLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLongitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy>
      thenByPickupLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLongitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByRequestedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'requestedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByRequestedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'requestedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByServerId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByServerIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByStartedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'startedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByStartedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'startedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByStatus() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByStatusDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByTip() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByTipDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByUserRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'userRating', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByUserRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'userRating', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByUserReview() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'userReview', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByUserReviewDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'userReview', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByVehicleColor() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleColor', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByVehicleColorDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleColor', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByVehicleMake() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleMake', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByVehicleMakeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleMake', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByVehicleModel() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleModel', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByVehicleModelDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleModel', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByVehiclePlate() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehiclePlate', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByVehiclePlateDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehiclePlate', Sort.desc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByVehicleType() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleType', Sort.asc);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QAfterSortBy> thenByVehicleTypeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'vehicleType', Sort.desc);
    });
  }
}

extension CachedRideQueryWhereDistinct
    on QueryBuilder<CachedRide, CachedRide, QDistinct> {
  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByAcceptedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'acceptedAt');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByActualFare() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'actualFare');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByArrivedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'arrivedAt');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'cachedAt');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByCancelledAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'cancelledAt');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByCompletedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'completedAt');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'createdAt');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByCurrency(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'currency', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByDriverId(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'driverId', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByDriverName(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'driverName', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByDriverPhotoUrl(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'driverPhotoUrl',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByDriverRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'driverRating');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByDropoffAddress(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'dropoffAddress',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByDropoffLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'dropoffLatitude');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByDropoffLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'dropoffLongitude');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct>
      distinctByEstimatedDistance() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'estimatedDistance');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct>
      distinctByEstimatedDuration() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'estimatedDuration');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByEstimatedFare() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'estimatedFare');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'isActive');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByPickupAddress(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'pickupAddress',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByPickupLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'pickupLatitude');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByPickupLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'pickupLongitude');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByRequestedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'requestedAt');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByServerId(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'serverId', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByStartedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'startedAt');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByStatus(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'status', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByTip() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'tip');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByUserRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'userRating');
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByUserReview(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'userReview', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByVehicleColor(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'vehicleColor', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByVehicleMake(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'vehicleMake', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByVehicleModel(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'vehicleModel', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByVehiclePlate(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'vehiclePlate', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRide, CachedRide, QDistinct> distinctByVehicleType(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'vehicleType', caseSensitive: caseSensitive);
    });
  }
}

extension CachedRideQueryProperty
    on QueryBuilder<CachedRide, CachedRide, QQueryProperty> {
  QueryBuilder<CachedRide, int, QQueryOperations> idProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'id');
    });
  }

  QueryBuilder<CachedRide, DateTime?, QQueryOperations> acceptedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'acceptedAt');
    });
  }

  QueryBuilder<CachedRide, double?, QQueryOperations> actualFareProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'actualFare');
    });
  }

  QueryBuilder<CachedRide, DateTime?, QQueryOperations> arrivedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'arrivedAt');
    });
  }

  QueryBuilder<CachedRide, DateTime, QQueryOperations> cachedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'cachedAt');
    });
  }

  QueryBuilder<CachedRide, DateTime?, QQueryOperations> cancelledAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'cancelledAt');
    });
  }

  QueryBuilder<CachedRide, DateTime?, QQueryOperations> completedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'completedAt');
    });
  }

  QueryBuilder<CachedRide, DateTime?, QQueryOperations> createdAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'createdAt');
    });
  }

  QueryBuilder<CachedRide, String?, QQueryOperations> currencyProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'currency');
    });
  }

  QueryBuilder<CachedRide, String?, QQueryOperations> driverIdProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'driverId');
    });
  }

  QueryBuilder<CachedRide, String?, QQueryOperations> driverNameProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'driverName');
    });
  }

  QueryBuilder<CachedRide, String?, QQueryOperations> driverPhotoUrlProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'driverPhotoUrl');
    });
  }

  QueryBuilder<CachedRide, double?, QQueryOperations> driverRatingProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'driverRating');
    });
  }

  QueryBuilder<CachedRide, String, QQueryOperations> dropoffAddressProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'dropoffAddress');
    });
  }

  QueryBuilder<CachedRide, double, QQueryOperations> dropoffLatitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'dropoffLatitude');
    });
  }

  QueryBuilder<CachedRide, double, QQueryOperations>
      dropoffLongitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'dropoffLongitude');
    });
  }

  QueryBuilder<CachedRide, double?, QQueryOperations>
      estimatedDistanceProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'estimatedDistance');
    });
  }

  QueryBuilder<CachedRide, int?, QQueryOperations> estimatedDurationProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'estimatedDuration');
    });
  }

  QueryBuilder<CachedRide, double, QQueryOperations> estimatedFareProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'estimatedFare');
    });
  }

  QueryBuilder<CachedRide, bool, QQueryOperations> isActiveProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'isActive');
    });
  }

  QueryBuilder<CachedRide, String, QQueryOperations> pickupAddressProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'pickupAddress');
    });
  }

  QueryBuilder<CachedRide, double, QQueryOperations> pickupLatitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'pickupLatitude');
    });
  }

  QueryBuilder<CachedRide, double, QQueryOperations> pickupLongitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'pickupLongitude');
    });
  }

  QueryBuilder<CachedRide, DateTime?, QQueryOperations> requestedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'requestedAt');
    });
  }

  QueryBuilder<CachedRide, String, QQueryOperations> serverIdProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'serverId');
    });
  }

  QueryBuilder<CachedRide, DateTime?, QQueryOperations> startedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'startedAt');
    });
  }

  QueryBuilder<CachedRide, String, QQueryOperations> statusProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'status');
    });
  }

  QueryBuilder<CachedRide, double?, QQueryOperations> tipProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'tip');
    });
  }

  QueryBuilder<CachedRide, int?, QQueryOperations> userRatingProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'userRating');
    });
  }

  QueryBuilder<CachedRide, String?, QQueryOperations> userReviewProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'userReview');
    });
  }

  QueryBuilder<CachedRide, String?, QQueryOperations> vehicleColorProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'vehicleColor');
    });
  }

  QueryBuilder<CachedRide, String?, QQueryOperations> vehicleMakeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'vehicleMake');
    });
  }

  QueryBuilder<CachedRide, String?, QQueryOperations> vehicleModelProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'vehicleModel');
    });
  }

  QueryBuilder<CachedRide, String?, QQueryOperations> vehiclePlateProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'vehiclePlate');
    });
  }

  QueryBuilder<CachedRide, String, QQueryOperations> vehicleTypeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'vehicleType');
    });
  }
}
