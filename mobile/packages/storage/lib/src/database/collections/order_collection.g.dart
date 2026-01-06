// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'order_collection.dart';

// **************************************************************************
// IsarCollectionGenerator
// **************************************************************************

// coverage:ignore-file
// ignore_for_file: duplicate_ignore, non_constant_identifier_names, constant_identifier_names, invalid_use_of_protected_member, unnecessary_cast, prefer_const_constructors, lines_longer_than_80_chars, require_trailing_commas, inference_failure_on_function_invocation, unnecessary_parenthesis, unnecessary_raw_strings, unnecessary_null_checks, join_return_with_assignment, prefer_final_locals, avoid_js_rounded_ints, avoid_positional_boolean_parameters, always_specify_types

extension GetCachedFoodOrderCollection on Isar {
  IsarCollection<CachedFoodOrder> get cachedFoodOrders => this.collection();
}

const CachedFoodOrderSchema = CollectionSchema(
  name: r'CachedFoodOrder',
  id: 1214102445494047617,
  properties: {
    r'cachedAt': PropertySchema(
      id: 0,
      name: r'cachedAt',
      type: IsarType.dateTime,
    ),
    r'cancelledAt': PropertySchema(
      id: 1,
      name: r'cancelledAt',
      type: IsarType.dateTime,
    ),
    r'confirmedAt': PropertySchema(
      id: 2,
      name: r'confirmedAt',
      type: IsarType.dateTime,
    ),
    r'createdAt': PropertySchema(
      id: 3,
      name: r'createdAt',
      type: IsarType.dateTime,
    ),
    r'currency': PropertySchema(
      id: 4,
      name: r'currency',
      type: IsarType.string,
    ),
    r'deliveredAt': PropertySchema(
      id: 5,
      name: r'deliveredAt',
      type: IsarType.dateTime,
    ),
    r'deliveryAddress': PropertySchema(
      id: 6,
      name: r'deliveryAddress',
      type: IsarType.string,
    ),
    r'deliveryFee': PropertySchema(
      id: 7,
      name: r'deliveryFee',
      type: IsarType.double,
    ),
    r'deliveryLatitude': PropertySchema(
      id: 8,
      name: r'deliveryLatitude',
      type: IsarType.double,
    ),
    r'deliveryLongitude': PropertySchema(
      id: 9,
      name: r'deliveryLongitude',
      type: IsarType.double,
    ),
    r'deliveryPersonId': PropertySchema(
      id: 10,
      name: r'deliveryPersonId',
      type: IsarType.string,
    ),
    r'deliveryPersonName': PropertySchema(
      id: 11,
      name: r'deliveryPersonName',
      type: IsarType.string,
    ),
    r'deliveryPersonPhone': PropertySchema(
      id: 12,
      name: r'deliveryPersonPhone',
      type: IsarType.string,
    ),
    r'deliveryPersonPhotoUrl': PropertySchema(
      id: 13,
      name: r'deliveryPersonPhotoUrl',
      type: IsarType.string,
    ),
    r'deliveryRating': PropertySchema(
      id: 14,
      name: r'deliveryRating',
      type: IsarType.long,
    ),
    r'discount': PropertySchema(
      id: 15,
      name: r'discount',
      type: IsarType.double,
    ),
    r'estimatedDeliveryMinutes': PropertySchema(
      id: 16,
      name: r'estimatedDeliveryMinutes',
      type: IsarType.long,
    ),
    r'foodRating': PropertySchema(
      id: 17,
      name: r'foodRating',
      type: IsarType.long,
    ),
    r'isActive': PropertySchema(
      id: 18,
      name: r'isActive',
      type: IsarType.bool,
    ),
    r'itemsJson': PropertySchema(
      id: 19,
      name: r'itemsJson',
      type: IsarType.string,
    ),
    r'orderedAt': PropertySchema(
      id: 20,
      name: r'orderedAt',
      type: IsarType.dateTime,
    ),
    r'pickedUpAt': PropertySchema(
      id: 21,
      name: r'pickedUpAt',
      type: IsarType.dateTime,
    ),
    r'preparingAt': PropertySchema(
      id: 22,
      name: r'preparingAt',
      type: IsarType.dateTime,
    ),
    r'readyAt': PropertySchema(
      id: 23,
      name: r'readyAt',
      type: IsarType.dateTime,
    ),
    r'restaurantId': PropertySchema(
      id: 24,
      name: r'restaurantId',
      type: IsarType.string,
    ),
    r'restaurantImageUrl': PropertySchema(
      id: 25,
      name: r'restaurantImageUrl',
      type: IsarType.string,
    ),
    r'restaurantName': PropertySchema(
      id: 26,
      name: r'restaurantName',
      type: IsarType.string,
    ),
    r'review': PropertySchema(
      id: 27,
      name: r'review',
      type: IsarType.string,
    ),
    r'serverId': PropertySchema(
      id: 28,
      name: r'serverId',
      type: IsarType.string,
    ),
    r'serviceFee': PropertySchema(
      id: 29,
      name: r'serviceFee',
      type: IsarType.double,
    ),
    r'status': PropertySchema(
      id: 30,
      name: r'status',
      type: IsarType.string,
    ),
    r'subtotal': PropertySchema(
      id: 31,
      name: r'subtotal',
      type: IsarType.double,
    ),
    r'tip': PropertySchema(
      id: 32,
      name: r'tip',
      type: IsarType.double,
    ),
    r'total': PropertySchema(
      id: 33,
      name: r'total',
      type: IsarType.double,
    )
  },
  estimateSize: _cachedFoodOrderEstimateSize,
  serialize: _cachedFoodOrderSerialize,
  deserialize: _cachedFoodOrderDeserialize,
  deserializeProp: _cachedFoodOrderDeserializeProp,
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
  getId: _cachedFoodOrderGetId,
  getLinks: _cachedFoodOrderGetLinks,
  attach: _cachedFoodOrderAttach,
  version: '3.1.0+1',
);

int _cachedFoodOrderEstimateSize(
  CachedFoodOrder object,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  var bytesCount = offsets.last;
  bytesCount += 3 + object.currency.length * 3;
  bytesCount += 3 + object.deliveryAddress.length * 3;
  {
    final value = object.deliveryPersonId;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.deliveryPersonName;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.deliveryPersonPhone;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.deliveryPersonPhotoUrl;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.itemsJson.length * 3;
  bytesCount += 3 + object.restaurantId.length * 3;
  {
    final value = object.restaurantImageUrl;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.restaurantName.length * 3;
  {
    final value = object.review;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.serverId.length * 3;
  bytesCount += 3 + object.status.length * 3;
  return bytesCount;
}

void _cachedFoodOrderSerialize(
  CachedFoodOrder object,
  IsarWriter writer,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  writer.writeDateTime(offsets[0], object.cachedAt);
  writer.writeDateTime(offsets[1], object.cancelledAt);
  writer.writeDateTime(offsets[2], object.confirmedAt);
  writer.writeDateTime(offsets[3], object.createdAt);
  writer.writeString(offsets[4], object.currency);
  writer.writeDateTime(offsets[5], object.deliveredAt);
  writer.writeString(offsets[6], object.deliveryAddress);
  writer.writeDouble(offsets[7], object.deliveryFee);
  writer.writeDouble(offsets[8], object.deliveryLatitude);
  writer.writeDouble(offsets[9], object.deliveryLongitude);
  writer.writeString(offsets[10], object.deliveryPersonId);
  writer.writeString(offsets[11], object.deliveryPersonName);
  writer.writeString(offsets[12], object.deliveryPersonPhone);
  writer.writeString(offsets[13], object.deliveryPersonPhotoUrl);
  writer.writeLong(offsets[14], object.deliveryRating);
  writer.writeDouble(offsets[15], object.discount);
  writer.writeLong(offsets[16], object.estimatedDeliveryMinutes);
  writer.writeLong(offsets[17], object.foodRating);
  writer.writeBool(offsets[18], object.isActive);
  writer.writeString(offsets[19], object.itemsJson);
  writer.writeDateTime(offsets[20], object.orderedAt);
  writer.writeDateTime(offsets[21], object.pickedUpAt);
  writer.writeDateTime(offsets[22], object.preparingAt);
  writer.writeDateTime(offsets[23], object.readyAt);
  writer.writeString(offsets[24], object.restaurantId);
  writer.writeString(offsets[25], object.restaurantImageUrl);
  writer.writeString(offsets[26], object.restaurantName);
  writer.writeString(offsets[27], object.review);
  writer.writeString(offsets[28], object.serverId);
  writer.writeDouble(offsets[29], object.serviceFee);
  writer.writeString(offsets[30], object.status);
  writer.writeDouble(offsets[31], object.subtotal);
  writer.writeDouble(offsets[32], object.tip);
  writer.writeDouble(offsets[33], object.total);
}

CachedFoodOrder _cachedFoodOrderDeserialize(
  Id id,
  IsarReader reader,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  final object = CachedFoodOrder();
  object.cachedAt = reader.readDateTime(offsets[0]);
  object.cancelledAt = reader.readDateTimeOrNull(offsets[1]);
  object.confirmedAt = reader.readDateTimeOrNull(offsets[2]);
  object.createdAt = reader.readDateTimeOrNull(offsets[3]);
  object.currency = reader.readString(offsets[4]);
  object.deliveredAt = reader.readDateTimeOrNull(offsets[5]);
  object.deliveryAddress = reader.readString(offsets[6]);
  object.deliveryFee = reader.readDouble(offsets[7]);
  object.deliveryLatitude = reader.readDouble(offsets[8]);
  object.deliveryLongitude = reader.readDouble(offsets[9]);
  object.deliveryPersonId = reader.readStringOrNull(offsets[10]);
  object.deliveryPersonName = reader.readStringOrNull(offsets[11]);
  object.deliveryPersonPhone = reader.readStringOrNull(offsets[12]);
  object.deliveryPersonPhotoUrl = reader.readStringOrNull(offsets[13]);
  object.deliveryRating = reader.readLongOrNull(offsets[14]);
  object.discount = reader.readDoubleOrNull(offsets[15]);
  object.estimatedDeliveryMinutes = reader.readLongOrNull(offsets[16]);
  object.foodRating = reader.readLongOrNull(offsets[17]);
  object.id = id;
  object.isActive = reader.readBool(offsets[18]);
  object.itemsJson = reader.readString(offsets[19]);
  object.orderedAt = reader.readDateTimeOrNull(offsets[20]);
  object.pickedUpAt = reader.readDateTimeOrNull(offsets[21]);
  object.preparingAt = reader.readDateTimeOrNull(offsets[22]);
  object.readyAt = reader.readDateTimeOrNull(offsets[23]);
  object.restaurantId = reader.readString(offsets[24]);
  object.restaurantImageUrl = reader.readStringOrNull(offsets[25]);
  object.restaurantName = reader.readString(offsets[26]);
  object.review = reader.readStringOrNull(offsets[27]);
  object.serverId = reader.readString(offsets[28]);
  object.serviceFee = reader.readDouble(offsets[29]);
  object.status = reader.readString(offsets[30]);
  object.subtotal = reader.readDouble(offsets[31]);
  object.tip = reader.readDoubleOrNull(offsets[32]);
  object.total = reader.readDouble(offsets[33]);
  return object;
}

P _cachedFoodOrderDeserializeProp<P>(
  IsarReader reader,
  int propertyId,
  int offset,
  Map<Type, List<int>> allOffsets,
) {
  switch (propertyId) {
    case 0:
      return (reader.readDateTime(offset)) as P;
    case 1:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 2:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 3:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 4:
      return (reader.readString(offset)) as P;
    case 5:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 6:
      return (reader.readString(offset)) as P;
    case 7:
      return (reader.readDouble(offset)) as P;
    case 8:
      return (reader.readDouble(offset)) as P;
    case 9:
      return (reader.readDouble(offset)) as P;
    case 10:
      return (reader.readStringOrNull(offset)) as P;
    case 11:
      return (reader.readStringOrNull(offset)) as P;
    case 12:
      return (reader.readStringOrNull(offset)) as P;
    case 13:
      return (reader.readStringOrNull(offset)) as P;
    case 14:
      return (reader.readLongOrNull(offset)) as P;
    case 15:
      return (reader.readDoubleOrNull(offset)) as P;
    case 16:
      return (reader.readLongOrNull(offset)) as P;
    case 17:
      return (reader.readLongOrNull(offset)) as P;
    case 18:
      return (reader.readBool(offset)) as P;
    case 19:
      return (reader.readString(offset)) as P;
    case 20:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 21:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 22:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 23:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 24:
      return (reader.readString(offset)) as P;
    case 25:
      return (reader.readStringOrNull(offset)) as P;
    case 26:
      return (reader.readString(offset)) as P;
    case 27:
      return (reader.readStringOrNull(offset)) as P;
    case 28:
      return (reader.readString(offset)) as P;
    case 29:
      return (reader.readDouble(offset)) as P;
    case 30:
      return (reader.readString(offset)) as P;
    case 31:
      return (reader.readDouble(offset)) as P;
    case 32:
      return (reader.readDoubleOrNull(offset)) as P;
    case 33:
      return (reader.readDouble(offset)) as P;
    default:
      throw IsarError('Unknown property with id $propertyId');
  }
}

Id _cachedFoodOrderGetId(CachedFoodOrder object) {
  return object.id;
}

List<IsarLinkBase<dynamic>> _cachedFoodOrderGetLinks(CachedFoodOrder object) {
  return [];
}

void _cachedFoodOrderAttach(
    IsarCollection<dynamic> col, Id id, CachedFoodOrder object) {
  object.id = id;
}

extension CachedFoodOrderByIndex on IsarCollection<CachedFoodOrder> {
  Future<CachedFoodOrder?> getByServerId(String serverId) {
    return getByIndex(r'serverId', [serverId]);
  }

  CachedFoodOrder? getByServerIdSync(String serverId) {
    return getByIndexSync(r'serverId', [serverId]);
  }

  Future<bool> deleteByServerId(String serverId) {
    return deleteByIndex(r'serverId', [serverId]);
  }

  bool deleteByServerIdSync(String serverId) {
    return deleteByIndexSync(r'serverId', [serverId]);
  }

  Future<List<CachedFoodOrder?>> getAllByServerId(List<String> serverIdValues) {
    final values = serverIdValues.map((e) => [e]).toList();
    return getAllByIndex(r'serverId', values);
  }

  List<CachedFoodOrder?> getAllByServerIdSync(List<String> serverIdValues) {
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

  Future<Id> putByServerId(CachedFoodOrder object) {
    return putByIndex(r'serverId', object);
  }

  Id putByServerIdSync(CachedFoodOrder object, {bool saveLinks = true}) {
    return putByIndexSync(r'serverId', object, saveLinks: saveLinks);
  }

  Future<List<Id>> putAllByServerId(List<CachedFoodOrder> objects) {
    return putAllByIndex(r'serverId', objects);
  }

  List<Id> putAllByServerIdSync(List<CachedFoodOrder> objects,
      {bool saveLinks = true}) {
    return putAllByIndexSync(r'serverId', objects, saveLinks: saveLinks);
  }
}

extension CachedFoodOrderQueryWhereSort
    on QueryBuilder<CachedFoodOrder, CachedFoodOrder, QWhere> {
  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhere> anyId() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(const IdWhereClause.any());
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhere> anyIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        const IndexWhereClause.any(indexName: r'isActive'),
      );
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhere> anyCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        const IndexWhereClause.any(indexName: r'createdAt'),
      );
    });
  }
}

extension CachedFoodOrderQueryWhere
    on QueryBuilder<CachedFoodOrder, CachedFoodOrder, QWhereClause> {
  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause> idEqualTo(
      Id id) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IdWhereClause.between(
        lower: id,
        upper: id,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      idNotEqualTo(Id id) {
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      idGreaterThan(Id id, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.greaterThan(lower: id, includeLower: include),
      );
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause> idLessThan(
      Id id,
      {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.lessThan(upper: id, includeUpper: include),
      );
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause> idBetween(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      serverIdEqualTo(String serverId) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'serverId',
        value: [serverId],
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      serverIdNotEqualTo(String serverId) {
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      isActiveEqualTo(bool isActive) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'isActive',
        value: [isActive],
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      isActiveNotEqualTo(bool isActive) {
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      createdAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'createdAt',
        value: [null],
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      createdAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.between(
        indexName: r'createdAt',
        lower: [null],
        includeLower: false,
        upper: [],
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      createdAtEqualTo(DateTime? createdAt) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'createdAt',
        value: [createdAt],
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      createdAtNotEqualTo(DateTime? createdAt) {
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      createdAtGreaterThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      createdAtLessThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterWhereClause>
      createdAtBetween(
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

extension CachedFoodOrderQueryFilter
    on QueryBuilder<CachedFoodOrder, CachedFoodOrder, QFilterCondition> {
  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      cachedAtEqualTo(DateTime value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'cachedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      cachedAtLessThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      cachedAtBetween(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      cancelledAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'cancelledAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      cancelledAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'cancelledAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      cancelledAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'cancelledAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      confirmedAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'confirmedAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      confirmedAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'confirmedAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      confirmedAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'confirmedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      confirmedAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'confirmedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      confirmedAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'confirmedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      confirmedAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'confirmedAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      createdAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'createdAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      createdAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'createdAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      createdAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'createdAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      createdAtLessThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      createdAtBetween(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      currencyEqualTo(
    String value, {
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      currencyGreaterThan(
    String value, {
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      currencyLessThan(
    String value, {
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      currencyBetween(
    String lower,
    String upper, {
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      currencyEndsWith(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      currencyContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'currency',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      currencyMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'currency',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      currencyIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'currency',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      currencyIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'currency',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveredAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'deliveredAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveredAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'deliveredAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveredAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveredAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveredAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveredAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveredAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveredAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveredAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveredAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryAddressEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryAddressGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryAddressLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryAddressBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryAddress',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryAddressStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'deliveryAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryAddressEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'deliveryAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryAddressContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'deliveryAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryAddressMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'deliveryAddress',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryAddressIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryAddress',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryAddressIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'deliveryAddress',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryFeeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryFee',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryFeeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryFee',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryFeeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryFee',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryFeeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryFee',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryLatitudeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryLatitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryLatitudeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryLatitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryLatitudeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryLatitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryLatitudeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryLatitude',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryLongitudeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryLongitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryLongitudeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryLongitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryLongitudeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryLongitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryLongitudeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryLongitude',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'deliveryPersonId',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'deliveryPersonId',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryPersonId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryPersonId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryPersonId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryPersonId',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'deliveryPersonId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'deliveryPersonId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'deliveryPersonId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'deliveryPersonId',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryPersonId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonIdIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'deliveryPersonId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'deliveryPersonName',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'deliveryPersonName',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryPersonName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryPersonName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryPersonName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryPersonName',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'deliveryPersonName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'deliveryPersonName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'deliveryPersonName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'deliveryPersonName',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryPersonName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonNameIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'deliveryPersonName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'deliveryPersonPhone',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'deliveryPersonPhone',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryPersonPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryPersonPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryPersonPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryPersonPhone',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'deliveryPersonPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'deliveryPersonPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'deliveryPersonPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'deliveryPersonPhone',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryPersonPhone',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhoneIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'deliveryPersonPhone',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'deliveryPersonPhotoUrl',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'deliveryPersonPhotoUrl',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryPersonPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryPersonPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryPersonPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryPersonPhotoUrl',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'deliveryPersonPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'deliveryPersonPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlContains(String value,
          {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'deliveryPersonPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlMatches(String pattern,
          {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'deliveryPersonPhotoUrl',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryPersonPhotoUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryPersonPhotoUrlIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'deliveryPersonPhotoUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryRatingIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'deliveryRating',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryRatingIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'deliveryRating',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryRatingEqualTo(int? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryRating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryRatingGreaterThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryRating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryRatingLessThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryRating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      deliveryRatingBetween(
    int? lower,
    int? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryRating',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      discountIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'discount',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      discountIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'discount',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      discountEqualTo(
    double? value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'discount',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      discountGreaterThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'discount',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      discountLessThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'discount',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      discountBetween(
    double? lower,
    double? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'discount',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      estimatedDeliveryMinutesIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'estimatedDeliveryMinutes',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      estimatedDeliveryMinutesIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'estimatedDeliveryMinutes',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      estimatedDeliveryMinutesEqualTo(int? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'estimatedDeliveryMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      estimatedDeliveryMinutesGreaterThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'estimatedDeliveryMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      estimatedDeliveryMinutesLessThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'estimatedDeliveryMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      estimatedDeliveryMinutesBetween(
    int? lower,
    int? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'estimatedDeliveryMinutes',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      foodRatingIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'foodRating',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      foodRatingIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'foodRating',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      foodRatingEqualTo(int? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'foodRating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      foodRatingGreaterThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'foodRating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      foodRatingLessThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'foodRating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      foodRatingBetween(
    int? lower,
    int? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'foodRating',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      idEqualTo(Id value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'id',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      idGreaterThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      idLessThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      idBetween(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      isActiveEqualTo(bool value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'isActive',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      itemsJsonEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'itemsJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      itemsJsonGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'itemsJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      itemsJsonLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'itemsJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      itemsJsonBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'itemsJson',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      itemsJsonStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'itemsJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      itemsJsonEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'itemsJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      itemsJsonContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'itemsJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      itemsJsonMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'itemsJson',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      itemsJsonIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'itemsJson',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      itemsJsonIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'itemsJson',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      orderedAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'orderedAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      orderedAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'orderedAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      orderedAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'orderedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      orderedAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'orderedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      orderedAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'orderedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      orderedAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'orderedAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      pickedUpAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'pickedUpAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      pickedUpAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'pickedUpAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      pickedUpAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickedUpAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      pickedUpAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'pickedUpAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      pickedUpAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'pickedUpAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      pickedUpAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'pickedUpAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      preparingAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'preparingAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      preparingAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'preparingAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      preparingAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'preparingAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      preparingAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'preparingAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      preparingAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'preparingAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      preparingAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'preparingAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      readyAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'readyAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      readyAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'readyAt',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      readyAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'readyAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      readyAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'readyAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      readyAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'readyAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      readyAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'readyAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantIdEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'restaurantId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantIdGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'restaurantId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantIdLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'restaurantId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantIdBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'restaurantId',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantIdStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'restaurantId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantIdEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'restaurantId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantIdContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'restaurantId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantIdMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'restaurantId',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantIdIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'restaurantId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantIdIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'restaurantId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'restaurantImageUrl',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'restaurantImageUrl',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'restaurantImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'restaurantImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'restaurantImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'restaurantImageUrl',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'restaurantImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'restaurantImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'restaurantImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'restaurantImageUrl',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'restaurantImageUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantImageUrlIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'restaurantImageUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantNameEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'restaurantName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantNameGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'restaurantName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantNameLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'restaurantName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantNameBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'restaurantName',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantNameStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'restaurantName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantNameEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'restaurantName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantNameContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'restaurantName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantNameMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'restaurantName',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantNameIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'restaurantName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      restaurantNameIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'restaurantName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'review',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'review',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'review',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'review',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'review',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      reviewIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'review',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serverIdEqualTo(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serverIdLessThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serverIdBetween(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serverIdEndsWith(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serverIdContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'serverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serverIdMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'serverId',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serverIdIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'serverId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serverIdIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'serverId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serviceFeeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'serviceFee',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serviceFeeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'serviceFee',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serviceFeeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'serviceFee',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      serviceFeeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'serviceFee',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      statusEqualTo(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      statusGreaterThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      statusLessThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      statusBetween(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      statusStartsWith(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      statusEndsWith(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      statusContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'status',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      statusMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'status',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      statusIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'status',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      statusIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'status',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      subtotalEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'subtotal',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      subtotalGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'subtotal',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      subtotalLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'subtotal',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      subtotalBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'subtotal',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      tipIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'tip',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      tipIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'tip',
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      tipEqualTo(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      tipGreaterThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      tipLessThan(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      tipBetween(
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

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      totalEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'total',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      totalGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'total',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      totalLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'total',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterFilterCondition>
      totalBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'total',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }
}

extension CachedFoodOrderQueryObject
    on QueryBuilder<CachedFoodOrder, CachedFoodOrder, QFilterCondition> {}

extension CachedFoodOrderQueryLinks
    on QueryBuilder<CachedFoodOrder, CachedFoodOrder, QFilterCondition> {}

extension CachedFoodOrderQuerySortBy
    on QueryBuilder<CachedFoodOrder, CachedFoodOrder, QSortBy> {
  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByCachedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByCancelledAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByCancelledAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByConfirmedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'confirmedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByConfirmedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'confirmedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByCreatedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByCurrency() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByCurrencyDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveredAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveredAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveredAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveredAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryAddress', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryAddress', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryFee() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryFee', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryFeeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryFee', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryLatitude', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryLatitude', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryLongitude', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryLongitude', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryPersonId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonId', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryPersonIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonId', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryPersonName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonName', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryPersonNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonName', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryPersonPhone() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonPhone', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryPersonPhoneDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonPhone', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryPersonPhotoUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonPhotoUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryPersonPhotoUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonPhotoUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryRating', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDeliveryRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryRating', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDiscount() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'discount', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByDiscountDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'discount', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByEstimatedDeliveryMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDeliveryMinutes', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByEstimatedDeliveryMinutesDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDeliveryMinutes', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByFoodRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'foodRating', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByFoodRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'foodRating', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByIsActiveDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByItemsJson() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'itemsJson', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByItemsJsonDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'itemsJson', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByOrderedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'orderedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByOrderedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'orderedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByPickedUpAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickedUpAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByPickedUpAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickedUpAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByPreparingAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'preparingAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByPreparingAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'preparingAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> sortByReadyAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'readyAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByReadyAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'readyAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByRestaurantId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantId', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByRestaurantIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantId', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByRestaurantImageUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantImageUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByRestaurantImageUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantImageUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByRestaurantName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantName', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByRestaurantNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantName', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> sortByReview() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'review', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByReviewDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'review', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByServerId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByServerIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByServiceFee() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serviceFee', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByServiceFeeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serviceFee', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> sortByStatus() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByStatusDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortBySubtotal() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'subtotal', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortBySubtotalDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'subtotal', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> sortByTip() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> sortByTipDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> sortByTotal() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'total', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      sortByTotalDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'total', Sort.desc);
    });
  }
}

extension CachedFoodOrderQuerySortThenBy
    on QueryBuilder<CachedFoodOrder, CachedFoodOrder, QSortThenBy> {
  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByCachedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByCancelledAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByCancelledAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByConfirmedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'confirmedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByConfirmedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'confirmedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByCreatedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByCurrency() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByCurrencyDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveredAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveredAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveredAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveredAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryAddress', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryAddress', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryFee() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryFee', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryFeeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryFee', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryLatitude', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryLatitude', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryLongitude', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryLongitude', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryPersonId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonId', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryPersonIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonId', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryPersonName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonName', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryPersonNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonName', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryPersonPhone() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonPhone', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryPersonPhoneDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonPhone', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryPersonPhotoUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonPhotoUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryPersonPhotoUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryPersonPhotoUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryRating', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDeliveryRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryRating', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDiscount() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'discount', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByDiscountDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'discount', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByEstimatedDeliveryMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDeliveryMinutes', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByEstimatedDeliveryMinutesDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDeliveryMinutes', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByFoodRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'foodRating', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByFoodRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'foodRating', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> thenById() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> thenByIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByIsActiveDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByItemsJson() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'itemsJson', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByItemsJsonDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'itemsJson', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByOrderedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'orderedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByOrderedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'orderedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByPickedUpAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickedUpAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByPickedUpAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickedUpAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByPreparingAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'preparingAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByPreparingAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'preparingAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> thenByReadyAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'readyAt', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByReadyAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'readyAt', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByRestaurantId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantId', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByRestaurantIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantId', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByRestaurantImageUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantImageUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByRestaurantImageUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantImageUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByRestaurantName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantName', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByRestaurantNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'restaurantName', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> thenByReview() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'review', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByReviewDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'review', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByServerId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByServerIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByServiceFee() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serviceFee', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByServiceFeeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serviceFee', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> thenByStatus() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByStatusDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenBySubtotal() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'subtotal', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenBySubtotalDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'subtotal', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> thenByTip() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> thenByTipDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.desc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy> thenByTotal() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'total', Sort.asc);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QAfterSortBy>
      thenByTotalDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'total', Sort.desc);
    });
  }
}

extension CachedFoodOrderQueryWhereDistinct
    on QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct> {
  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'cachedAt');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByCancelledAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'cancelledAt');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByConfirmedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'confirmedAt');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'createdAt');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct> distinctByCurrency(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'currency', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDeliveredAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveredAt');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDeliveryAddress({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryAddress',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDeliveryFee() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryFee');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDeliveryLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryLatitude');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDeliveryLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryLongitude');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDeliveryPersonId({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryPersonId',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDeliveryPersonName({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryPersonName',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDeliveryPersonPhone({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryPersonPhone',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDeliveryPersonPhotoUrl({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryPersonPhotoUrl',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDeliveryRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryRating');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByDiscount() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'discount');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByEstimatedDeliveryMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'estimatedDeliveryMinutes');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByFoodRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'foodRating');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'isActive');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct> distinctByItemsJson(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'itemsJson', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByOrderedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'orderedAt');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByPickedUpAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'pickedUpAt');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByPreparingAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'preparingAt');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByReadyAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'readyAt');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByRestaurantId({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'restaurantId', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByRestaurantImageUrl({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'restaurantImageUrl',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByRestaurantName({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'restaurantName',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct> distinctByReview(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'review', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct> distinctByServerId(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'serverId', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctByServiceFee() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'serviceFee');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct> distinctByStatus(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'status', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct>
      distinctBySubtotal() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'subtotal');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct> distinctByTip() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'tip');
    });
  }

  QueryBuilder<CachedFoodOrder, CachedFoodOrder, QDistinct> distinctByTotal() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'total');
    });
  }
}

extension CachedFoodOrderQueryProperty
    on QueryBuilder<CachedFoodOrder, CachedFoodOrder, QQueryProperty> {
  QueryBuilder<CachedFoodOrder, int, QQueryOperations> idProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'id');
    });
  }

  QueryBuilder<CachedFoodOrder, DateTime, QQueryOperations> cachedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'cachedAt');
    });
  }

  QueryBuilder<CachedFoodOrder, DateTime?, QQueryOperations>
      cancelledAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'cancelledAt');
    });
  }

  QueryBuilder<CachedFoodOrder, DateTime?, QQueryOperations>
      confirmedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'confirmedAt');
    });
  }

  QueryBuilder<CachedFoodOrder, DateTime?, QQueryOperations>
      createdAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'createdAt');
    });
  }

  QueryBuilder<CachedFoodOrder, String, QQueryOperations> currencyProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'currency');
    });
  }

  QueryBuilder<CachedFoodOrder, DateTime?, QQueryOperations>
      deliveredAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveredAt');
    });
  }

  QueryBuilder<CachedFoodOrder, String, QQueryOperations>
      deliveryAddressProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryAddress');
    });
  }

  QueryBuilder<CachedFoodOrder, double, QQueryOperations>
      deliveryFeeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryFee');
    });
  }

  QueryBuilder<CachedFoodOrder, double, QQueryOperations>
      deliveryLatitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryLatitude');
    });
  }

  QueryBuilder<CachedFoodOrder, double, QQueryOperations>
      deliveryLongitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryLongitude');
    });
  }

  QueryBuilder<CachedFoodOrder, String?, QQueryOperations>
      deliveryPersonIdProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryPersonId');
    });
  }

  QueryBuilder<CachedFoodOrder, String?, QQueryOperations>
      deliveryPersonNameProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryPersonName');
    });
  }

  QueryBuilder<CachedFoodOrder, String?, QQueryOperations>
      deliveryPersonPhoneProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryPersonPhone');
    });
  }

  QueryBuilder<CachedFoodOrder, String?, QQueryOperations>
      deliveryPersonPhotoUrlProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryPersonPhotoUrl');
    });
  }

  QueryBuilder<CachedFoodOrder, int?, QQueryOperations>
      deliveryRatingProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryRating');
    });
  }

  QueryBuilder<CachedFoodOrder, double?, QQueryOperations> discountProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'discount');
    });
  }

  QueryBuilder<CachedFoodOrder, int?, QQueryOperations>
      estimatedDeliveryMinutesProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'estimatedDeliveryMinutes');
    });
  }

  QueryBuilder<CachedFoodOrder, int?, QQueryOperations> foodRatingProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'foodRating');
    });
  }

  QueryBuilder<CachedFoodOrder, bool, QQueryOperations> isActiveProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'isActive');
    });
  }

  QueryBuilder<CachedFoodOrder, String, QQueryOperations> itemsJsonProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'itemsJson');
    });
  }

  QueryBuilder<CachedFoodOrder, DateTime?, QQueryOperations>
      orderedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'orderedAt');
    });
  }

  QueryBuilder<CachedFoodOrder, DateTime?, QQueryOperations>
      pickedUpAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'pickedUpAt');
    });
  }

  QueryBuilder<CachedFoodOrder, DateTime?, QQueryOperations>
      preparingAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'preparingAt');
    });
  }

  QueryBuilder<CachedFoodOrder, DateTime?, QQueryOperations> readyAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'readyAt');
    });
  }

  QueryBuilder<CachedFoodOrder, String, QQueryOperations>
      restaurantIdProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'restaurantId');
    });
  }

  QueryBuilder<CachedFoodOrder, String?, QQueryOperations>
      restaurantImageUrlProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'restaurantImageUrl');
    });
  }

  QueryBuilder<CachedFoodOrder, String, QQueryOperations>
      restaurantNameProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'restaurantName');
    });
  }

  QueryBuilder<CachedFoodOrder, String?, QQueryOperations> reviewProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'review');
    });
  }

  QueryBuilder<CachedFoodOrder, String, QQueryOperations> serverIdProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'serverId');
    });
  }

  QueryBuilder<CachedFoodOrder, double, QQueryOperations> serviceFeeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'serviceFee');
    });
  }

  QueryBuilder<CachedFoodOrder, String, QQueryOperations> statusProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'status');
    });
  }

  QueryBuilder<CachedFoodOrder, double, QQueryOperations> subtotalProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'subtotal');
    });
  }

  QueryBuilder<CachedFoodOrder, double?, QQueryOperations> tipProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'tip');
    });
  }

  QueryBuilder<CachedFoodOrder, double, QQueryOperations> totalProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'total');
    });
  }
}

// coverage:ignore-file
// ignore_for_file: duplicate_ignore, non_constant_identifier_names, constant_identifier_names, invalid_use_of_protected_member, unnecessary_cast, prefer_const_constructors, lines_longer_than_80_chars, require_trailing_commas, inference_failure_on_function_invocation, unnecessary_parenthesis, unnecessary_raw_strings, unnecessary_null_checks, join_return_with_assignment, prefer_final_locals, avoid_js_rounded_ints, avoid_positional_boolean_parameters, always_specify_types

extension GetCachedDeliveryCollection on Isar {
  IsarCollection<CachedDelivery> get cachedDeliverys => this.collection();
}

const CachedDeliverySchema = CollectionSchema(
  name: r'CachedDelivery',
  id: 6350505418814277484,
  properties: {
    r'cachedAt': PropertySchema(
      id: 0,
      name: r'cachedAt',
      type: IsarType.dateTime,
    ),
    r'cancelledAt': PropertySchema(
      id: 1,
      name: r'cancelledAt',
      type: IsarType.dateTime,
    ),
    r'courierId': PropertySchema(
      id: 2,
      name: r'courierId',
      type: IsarType.string,
    ),
    r'courierName': PropertySchema(
      id: 3,
      name: r'courierName',
      type: IsarType.string,
    ),
    r'courierPhone': PropertySchema(
      id: 4,
      name: r'courierPhone',
      type: IsarType.string,
    ),
    r'courierPhotoUrl': PropertySchema(
      id: 5,
      name: r'courierPhotoUrl',
      type: IsarType.string,
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
    r'deliveredAt': PropertySchema(
      id: 8,
      name: r'deliveredAt',
      type: IsarType.dateTime,
    ),
    r'dropoffAddress': PropertySchema(
      id: 9,
      name: r'dropoffAddress',
      type: IsarType.string,
    ),
    r'dropoffContactName': PropertySchema(
      id: 10,
      name: r'dropoffContactName',
      type: IsarType.string,
    ),
    r'dropoffContactPhone': PropertySchema(
      id: 11,
      name: r'dropoffContactPhone',
      type: IsarType.string,
    ),
    r'dropoffLatitude': PropertySchema(
      id: 12,
      name: r'dropoffLatitude',
      type: IsarType.double,
    ),
    r'dropoffLongitude': PropertySchema(
      id: 13,
      name: r'dropoffLongitude',
      type: IsarType.double,
    ),
    r'estimatedDurationMinutes': PropertySchema(
      id: 14,
      name: r'estimatedDurationMinutes',
      type: IsarType.long,
    ),
    r'fare': PropertySchema(
      id: 15,
      name: r'fare',
      type: IsarType.double,
    ),
    r'isActive': PropertySchema(
      id: 16,
      name: r'isActive',
      type: IsarType.bool,
    ),
    r'packageDescription': PropertySchema(
      id: 17,
      name: r'packageDescription',
      type: IsarType.string,
    ),
    r'packageSize': PropertySchema(
      id: 18,
      name: r'packageSize',
      type: IsarType.string,
    ),
    r'pickedUpAt': PropertySchema(
      id: 19,
      name: r'pickedUpAt',
      type: IsarType.dateTime,
    ),
    r'pickupAddress': PropertySchema(
      id: 20,
      name: r'pickupAddress',
      type: IsarType.string,
    ),
    r'pickupContactName': PropertySchema(
      id: 21,
      name: r'pickupContactName',
      type: IsarType.string,
    ),
    r'pickupContactPhone': PropertySchema(
      id: 22,
      name: r'pickupContactPhone',
      type: IsarType.string,
    ),
    r'pickupLatitude': PropertySchema(
      id: 23,
      name: r'pickupLatitude',
      type: IsarType.double,
    ),
    r'pickupLongitude': PropertySchema(
      id: 24,
      name: r'pickupLongitude',
      type: IsarType.double,
    ),
    r'rating': PropertySchema(
      id: 25,
      name: r'rating',
      type: IsarType.long,
    ),
    r'requestedAt': PropertySchema(
      id: 26,
      name: r'requestedAt',
      type: IsarType.dateTime,
    ),
    r'review': PropertySchema(
      id: 27,
      name: r'review',
      type: IsarType.string,
    ),
    r'serverId': PropertySchema(
      id: 28,
      name: r'serverId',
      type: IsarType.string,
    ),
    r'status': PropertySchema(
      id: 29,
      name: r'status',
      type: IsarType.string,
    ),
    r'tip': PropertySchema(
      id: 30,
      name: r'tip',
      type: IsarType.double,
    )
  },
  estimateSize: _cachedDeliveryEstimateSize,
  serialize: _cachedDeliverySerialize,
  deserialize: _cachedDeliveryDeserialize,
  deserializeProp: _cachedDeliveryDeserializeProp,
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
  getId: _cachedDeliveryGetId,
  getLinks: _cachedDeliveryGetLinks,
  attach: _cachedDeliveryAttach,
  version: '3.1.0+1',
);

int _cachedDeliveryEstimateSize(
  CachedDelivery object,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  var bytesCount = offsets.last;
  {
    final value = object.courierId;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.courierName;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.courierPhone;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.courierPhotoUrl;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.currency.length * 3;
  bytesCount += 3 + object.dropoffAddress.length * 3;
  bytesCount += 3 + object.dropoffContactName.length * 3;
  bytesCount += 3 + object.dropoffContactPhone.length * 3;
  {
    final value = object.packageDescription;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.packageSize.length * 3;
  bytesCount += 3 + object.pickupAddress.length * 3;
  bytesCount += 3 + object.pickupContactName.length * 3;
  bytesCount += 3 + object.pickupContactPhone.length * 3;
  {
    final value = object.review;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.serverId.length * 3;
  bytesCount += 3 + object.status.length * 3;
  return bytesCount;
}

void _cachedDeliverySerialize(
  CachedDelivery object,
  IsarWriter writer,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  writer.writeDateTime(offsets[0], object.cachedAt);
  writer.writeDateTime(offsets[1], object.cancelledAt);
  writer.writeString(offsets[2], object.courierId);
  writer.writeString(offsets[3], object.courierName);
  writer.writeString(offsets[4], object.courierPhone);
  writer.writeString(offsets[5], object.courierPhotoUrl);
  writer.writeDateTime(offsets[6], object.createdAt);
  writer.writeString(offsets[7], object.currency);
  writer.writeDateTime(offsets[8], object.deliveredAt);
  writer.writeString(offsets[9], object.dropoffAddress);
  writer.writeString(offsets[10], object.dropoffContactName);
  writer.writeString(offsets[11], object.dropoffContactPhone);
  writer.writeDouble(offsets[12], object.dropoffLatitude);
  writer.writeDouble(offsets[13], object.dropoffLongitude);
  writer.writeLong(offsets[14], object.estimatedDurationMinutes);
  writer.writeDouble(offsets[15], object.fare);
  writer.writeBool(offsets[16], object.isActive);
  writer.writeString(offsets[17], object.packageDescription);
  writer.writeString(offsets[18], object.packageSize);
  writer.writeDateTime(offsets[19], object.pickedUpAt);
  writer.writeString(offsets[20], object.pickupAddress);
  writer.writeString(offsets[21], object.pickupContactName);
  writer.writeString(offsets[22], object.pickupContactPhone);
  writer.writeDouble(offsets[23], object.pickupLatitude);
  writer.writeDouble(offsets[24], object.pickupLongitude);
  writer.writeLong(offsets[25], object.rating);
  writer.writeDateTime(offsets[26], object.requestedAt);
  writer.writeString(offsets[27], object.review);
  writer.writeString(offsets[28], object.serverId);
  writer.writeString(offsets[29], object.status);
  writer.writeDouble(offsets[30], object.tip);
}

CachedDelivery _cachedDeliveryDeserialize(
  Id id,
  IsarReader reader,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  final object = CachedDelivery();
  object.cachedAt = reader.readDateTime(offsets[0]);
  object.cancelledAt = reader.readDateTimeOrNull(offsets[1]);
  object.courierId = reader.readStringOrNull(offsets[2]);
  object.courierName = reader.readStringOrNull(offsets[3]);
  object.courierPhone = reader.readStringOrNull(offsets[4]);
  object.courierPhotoUrl = reader.readStringOrNull(offsets[5]);
  object.createdAt = reader.readDateTimeOrNull(offsets[6]);
  object.currency = reader.readString(offsets[7]);
  object.deliveredAt = reader.readDateTimeOrNull(offsets[8]);
  object.dropoffAddress = reader.readString(offsets[9]);
  object.dropoffContactName = reader.readString(offsets[10]);
  object.dropoffContactPhone = reader.readString(offsets[11]);
  object.dropoffLatitude = reader.readDouble(offsets[12]);
  object.dropoffLongitude = reader.readDouble(offsets[13]);
  object.estimatedDurationMinutes = reader.readLongOrNull(offsets[14]);
  object.fare = reader.readDouble(offsets[15]);
  object.id = id;
  object.isActive = reader.readBool(offsets[16]);
  object.packageDescription = reader.readStringOrNull(offsets[17]);
  object.packageSize = reader.readString(offsets[18]);
  object.pickedUpAt = reader.readDateTimeOrNull(offsets[19]);
  object.pickupAddress = reader.readString(offsets[20]);
  object.pickupContactName = reader.readString(offsets[21]);
  object.pickupContactPhone = reader.readString(offsets[22]);
  object.pickupLatitude = reader.readDouble(offsets[23]);
  object.pickupLongitude = reader.readDouble(offsets[24]);
  object.rating = reader.readLongOrNull(offsets[25]);
  object.requestedAt = reader.readDateTimeOrNull(offsets[26]);
  object.review = reader.readStringOrNull(offsets[27]);
  object.serverId = reader.readString(offsets[28]);
  object.status = reader.readString(offsets[29]);
  object.tip = reader.readDoubleOrNull(offsets[30]);
  return object;
}

P _cachedDeliveryDeserializeProp<P>(
  IsarReader reader,
  int propertyId,
  int offset,
  Map<Type, List<int>> allOffsets,
) {
  switch (propertyId) {
    case 0:
      return (reader.readDateTime(offset)) as P;
    case 1:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 2:
      return (reader.readStringOrNull(offset)) as P;
    case 3:
      return (reader.readStringOrNull(offset)) as P;
    case 4:
      return (reader.readStringOrNull(offset)) as P;
    case 5:
      return (reader.readStringOrNull(offset)) as P;
    case 6:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 7:
      return (reader.readString(offset)) as P;
    case 8:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 9:
      return (reader.readString(offset)) as P;
    case 10:
      return (reader.readString(offset)) as P;
    case 11:
      return (reader.readString(offset)) as P;
    case 12:
      return (reader.readDouble(offset)) as P;
    case 13:
      return (reader.readDouble(offset)) as P;
    case 14:
      return (reader.readLongOrNull(offset)) as P;
    case 15:
      return (reader.readDouble(offset)) as P;
    case 16:
      return (reader.readBool(offset)) as P;
    case 17:
      return (reader.readStringOrNull(offset)) as P;
    case 18:
      return (reader.readString(offset)) as P;
    case 19:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 20:
      return (reader.readString(offset)) as P;
    case 21:
      return (reader.readString(offset)) as P;
    case 22:
      return (reader.readString(offset)) as P;
    case 23:
      return (reader.readDouble(offset)) as P;
    case 24:
      return (reader.readDouble(offset)) as P;
    case 25:
      return (reader.readLongOrNull(offset)) as P;
    case 26:
      return (reader.readDateTimeOrNull(offset)) as P;
    case 27:
      return (reader.readStringOrNull(offset)) as P;
    case 28:
      return (reader.readString(offset)) as P;
    case 29:
      return (reader.readString(offset)) as P;
    case 30:
      return (reader.readDoubleOrNull(offset)) as P;
    default:
      throw IsarError('Unknown property with id $propertyId');
  }
}

Id _cachedDeliveryGetId(CachedDelivery object) {
  return object.id;
}

List<IsarLinkBase<dynamic>> _cachedDeliveryGetLinks(CachedDelivery object) {
  return [];
}

void _cachedDeliveryAttach(
    IsarCollection<dynamic> col, Id id, CachedDelivery object) {
  object.id = id;
}

extension CachedDeliveryByIndex on IsarCollection<CachedDelivery> {
  Future<CachedDelivery?> getByServerId(String serverId) {
    return getByIndex(r'serverId', [serverId]);
  }

  CachedDelivery? getByServerIdSync(String serverId) {
    return getByIndexSync(r'serverId', [serverId]);
  }

  Future<bool> deleteByServerId(String serverId) {
    return deleteByIndex(r'serverId', [serverId]);
  }

  bool deleteByServerIdSync(String serverId) {
    return deleteByIndexSync(r'serverId', [serverId]);
  }

  Future<List<CachedDelivery?>> getAllByServerId(List<String> serverIdValues) {
    final values = serverIdValues.map((e) => [e]).toList();
    return getAllByIndex(r'serverId', values);
  }

  List<CachedDelivery?> getAllByServerIdSync(List<String> serverIdValues) {
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

  Future<Id> putByServerId(CachedDelivery object) {
    return putByIndex(r'serverId', object);
  }

  Id putByServerIdSync(CachedDelivery object, {bool saveLinks = true}) {
    return putByIndexSync(r'serverId', object, saveLinks: saveLinks);
  }

  Future<List<Id>> putAllByServerId(List<CachedDelivery> objects) {
    return putAllByIndex(r'serverId', objects);
  }

  List<Id> putAllByServerIdSync(List<CachedDelivery> objects,
      {bool saveLinks = true}) {
    return putAllByIndexSync(r'serverId', objects, saveLinks: saveLinks);
  }
}

extension CachedDeliveryQueryWhereSort
    on QueryBuilder<CachedDelivery, CachedDelivery, QWhere> {
  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhere> anyId() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(const IdWhereClause.any());
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhere> anyIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        const IndexWhereClause.any(indexName: r'isActive'),
      );
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhere> anyCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        const IndexWhereClause.any(indexName: r'createdAt'),
      );
    });
  }
}

extension CachedDeliveryQueryWhere
    on QueryBuilder<CachedDelivery, CachedDelivery, QWhereClause> {
  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause> idEqualTo(
      Id id) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IdWhereClause.between(
        lower: id,
        upper: id,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause> idNotEqualTo(
      Id id) {
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause> idGreaterThan(
      Id id,
      {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.greaterThan(lower: id, includeLower: include),
      );
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause> idLessThan(
      Id id,
      {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.lessThan(upper: id, includeUpper: include),
      );
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause> idBetween(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      serverIdEqualTo(String serverId) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'serverId',
        value: [serverId],
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      serverIdNotEqualTo(String serverId) {
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      isActiveEqualTo(bool isActive) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'isActive',
        value: [isActive],
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      isActiveNotEqualTo(bool isActive) {
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      createdAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'createdAt',
        value: [null],
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      createdAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.between(
        indexName: r'createdAt',
        lower: [null],
        includeLower: false,
        upper: [],
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      createdAtEqualTo(DateTime? createdAt) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'createdAt',
        value: [createdAt],
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      createdAtNotEqualTo(DateTime? createdAt) {
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      createdAtGreaterThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      createdAtLessThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterWhereClause>
      createdAtBetween(
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

extension CachedDeliveryQueryFilter
    on QueryBuilder<CachedDelivery, CachedDelivery, QFilterCondition> {
  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      cachedAtEqualTo(DateTime value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'cachedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      cachedAtLessThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      cachedAtBetween(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      cancelledAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'cancelledAt',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      cancelledAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'cancelledAt',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      cancelledAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'cancelledAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'courierId',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'courierId',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'courierId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'courierId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'courierId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'courierId',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'courierId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'courierId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'courierId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'courierId',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'courierId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierIdIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'courierId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'courierName',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'courierName',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'courierName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'courierName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'courierName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'courierName',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'courierName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'courierName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'courierName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'courierName',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'courierName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierNameIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'courierName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'courierPhone',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'courierPhone',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'courierPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'courierPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'courierPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'courierPhone',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'courierPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'courierPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'courierPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'courierPhone',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'courierPhone',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhoneIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'courierPhone',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'courierPhotoUrl',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'courierPhotoUrl',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'courierPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'courierPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'courierPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'courierPhotoUrl',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'courierPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'courierPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'courierPhotoUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'courierPhotoUrl',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'courierPhotoUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      courierPhotoUrlIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'courierPhotoUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      createdAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'createdAt',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      createdAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'createdAt',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      createdAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'createdAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      createdAtLessThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      createdAtBetween(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      currencyEqualTo(
    String value, {
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      currencyGreaterThan(
    String value, {
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      currencyLessThan(
    String value, {
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      currencyBetween(
    String lower,
    String upper, {
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      currencyEndsWith(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      currencyContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'currency',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      currencyMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'currency',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      currencyIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'currency',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      currencyIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'currency',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      deliveredAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'deliveredAt',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      deliveredAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'deliveredAt',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      deliveredAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveredAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      deliveredAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveredAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      deliveredAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveredAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      deliveredAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveredAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffAddressContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'dropoffAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffAddressMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'dropoffAddress',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffAddressIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'dropoffAddress',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffAddressIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'dropoffAddress',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactNameEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'dropoffContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactNameGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'dropoffContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactNameLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'dropoffContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactNameBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'dropoffContactName',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactNameStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'dropoffContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactNameEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'dropoffContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactNameContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'dropoffContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactNameMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'dropoffContactName',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactNameIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'dropoffContactName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactNameIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'dropoffContactName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactPhoneEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'dropoffContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactPhoneGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'dropoffContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactPhoneLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'dropoffContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactPhoneBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'dropoffContactPhone',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactPhoneStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'dropoffContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactPhoneEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'dropoffContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactPhoneContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'dropoffContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactPhoneMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'dropoffContactPhone',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactPhoneIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'dropoffContactPhone',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      dropoffContactPhoneIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'dropoffContactPhone',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      estimatedDurationMinutesIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'estimatedDurationMinutes',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      estimatedDurationMinutesIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'estimatedDurationMinutes',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      estimatedDurationMinutesEqualTo(int? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'estimatedDurationMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      estimatedDurationMinutesGreaterThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'estimatedDurationMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      estimatedDurationMinutesLessThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'estimatedDurationMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      estimatedDurationMinutesBetween(
    int? lower,
    int? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'estimatedDurationMinutes',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      fareEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'fare',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      fareGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'fare',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      fareLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'fare',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      fareBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'fare',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition> idEqualTo(
      Id value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'id',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      idGreaterThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      idLessThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition> idBetween(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      isActiveEqualTo(bool value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'isActive',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'packageDescription',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'packageDescription',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'packageDescription',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'packageDescription',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'packageDescription',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'packageDescription',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'packageDescription',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'packageDescription',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'packageDescription',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'packageDescription',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'packageDescription',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageDescriptionIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'packageDescription',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageSizeEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'packageSize',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageSizeGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'packageSize',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageSizeLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'packageSize',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageSizeBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'packageSize',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageSizeStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'packageSize',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageSizeEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'packageSize',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageSizeContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'packageSize',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageSizeMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'packageSize',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageSizeIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'packageSize',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      packageSizeIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'packageSize',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickedUpAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'pickedUpAt',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickedUpAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'pickedUpAt',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickedUpAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickedUpAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickedUpAtGreaterThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'pickedUpAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickedUpAtLessThan(
    DateTime? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'pickedUpAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickedUpAtBetween(
    DateTime? lower,
    DateTime? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'pickedUpAt',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupAddressContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'pickupAddress',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupAddressMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'pickupAddress',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupAddressIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickupAddress',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupAddressIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'pickupAddress',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactNameEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickupContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactNameGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'pickupContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactNameLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'pickupContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactNameBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'pickupContactName',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactNameStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'pickupContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactNameEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'pickupContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactNameContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'pickupContactName',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactNameMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'pickupContactName',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactNameIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickupContactName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactNameIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'pickupContactName',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactPhoneEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickupContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactPhoneGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'pickupContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactPhoneLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'pickupContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactPhoneBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'pickupContactPhone',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactPhoneStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'pickupContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactPhoneEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'pickupContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactPhoneContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'pickupContactPhone',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactPhoneMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'pickupContactPhone',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactPhoneIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'pickupContactPhone',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      pickupContactPhoneIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'pickupContactPhone',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      ratingIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'rating',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      ratingIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'rating',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      ratingEqualTo(int? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'rating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      ratingGreaterThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'rating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      ratingLessThan(
    int? value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'rating',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      ratingBetween(
    int? lower,
    int? upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'rating',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      requestedAtIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'requestedAt',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      requestedAtIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'requestedAt',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      requestedAtEqualTo(DateTime? value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'requestedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'review',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'review',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'review',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'review',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'review',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'review',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      reviewIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'review',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      serverIdEqualTo(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      serverIdLessThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      serverIdBetween(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      serverIdEndsWith(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      serverIdContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'serverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      serverIdMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'serverId',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      serverIdIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'serverId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      serverIdIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'serverId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      statusEqualTo(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      statusGreaterThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      statusLessThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      statusBetween(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      statusStartsWith(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      statusEndsWith(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      statusContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'status',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      statusMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'status',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      statusIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'status',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      statusIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'status',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      tipIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'tip',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      tipIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'tip',
      ));
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      tipEqualTo(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      tipGreaterThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      tipLessThan(
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

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterFilterCondition>
      tipBetween(
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
}

extension CachedDeliveryQueryObject
    on QueryBuilder<CachedDelivery, CachedDelivery, QFilterCondition> {}

extension CachedDeliveryQueryLinks
    on QueryBuilder<CachedDelivery, CachedDelivery, QFilterCondition> {}

extension CachedDeliveryQuerySortBy
    on QueryBuilder<CachedDelivery, CachedDelivery, QSortBy> {
  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCachedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCancelledAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCancelledAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByCourierId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierId', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCourierIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierId', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCourierName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierName', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCourierNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierName', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCourierPhone() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierPhone', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCourierPhoneDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierPhone', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCourierPhotoUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierPhotoUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCourierPhotoUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierPhotoUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCreatedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByCurrency() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByCurrencyDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDeliveredAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveredAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDeliveredAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveredAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDropoffAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffAddress', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDropoffAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffAddress', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDropoffContactName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffContactName', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDropoffContactNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffContactName', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDropoffContactPhone() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffContactPhone', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDropoffContactPhoneDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffContactPhone', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDropoffLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLatitude', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDropoffLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLatitude', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDropoffLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLongitude', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByDropoffLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLongitude', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByEstimatedDurationMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDurationMinutes', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByEstimatedDurationMinutesDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDurationMinutes', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByFare() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'fare', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByFareDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'fare', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByIsActiveDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPackageDescription() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageDescription', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPackageDescriptionDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageDescription', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPackageSize() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageSize', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPackageSizeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageSize', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickedUpAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickedUpAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickedUpAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickedUpAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickupAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupAddress', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickupAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupAddress', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickupContactName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupContactName', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickupContactNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupContactName', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickupContactPhone() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupContactPhone', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickupContactPhoneDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupContactPhone', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickupLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLatitude', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickupLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLatitude', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickupLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLongitude', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByPickupLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLongitude', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'rating', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'rating', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByRequestedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'requestedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByRequestedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'requestedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByReview() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'review', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByReviewDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'review', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByServerId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByServerIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByStatus() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      sortByStatusDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByTip() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> sortByTipDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.desc);
    });
  }
}

extension CachedDeliveryQuerySortThenBy
    on QueryBuilder<CachedDelivery, CachedDelivery, QSortThenBy> {
  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCachedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCancelledAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCancelledAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cancelledAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByCourierId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierId', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCourierIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierId', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCourierName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierName', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCourierNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierName', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCourierPhone() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierPhone', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCourierPhoneDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierPhone', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCourierPhotoUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierPhotoUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCourierPhotoUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'courierPhotoUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCreatedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'createdAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByCurrency() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByCurrencyDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'currency', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDeliveredAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveredAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDeliveredAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveredAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDropoffAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffAddress', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDropoffAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffAddress', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDropoffContactName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffContactName', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDropoffContactNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffContactName', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDropoffContactPhone() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffContactPhone', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDropoffContactPhoneDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffContactPhone', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDropoffLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLatitude', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDropoffLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLatitude', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDropoffLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLongitude', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByDropoffLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'dropoffLongitude', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByEstimatedDurationMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDurationMinutes', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByEstimatedDurationMinutesDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'estimatedDurationMinutes', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByFare() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'fare', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByFareDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'fare', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenById() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByIsActiveDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isActive', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPackageDescription() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageDescription', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPackageDescriptionDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageDescription', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPackageSize() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageSize', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPackageSizeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'packageSize', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickedUpAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickedUpAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickedUpAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickedUpAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickupAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupAddress', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickupAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupAddress', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickupContactName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupContactName', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickupContactNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupContactName', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickupContactPhone() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupContactPhone', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickupContactPhoneDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupContactPhone', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickupLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLatitude', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickupLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLatitude', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickupLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLongitude', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByPickupLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'pickupLongitude', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'rating', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'rating', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByRequestedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'requestedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByRequestedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'requestedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByReview() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'review', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByReviewDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'review', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByServerId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByServerIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByStatus() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy>
      thenByStatusDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'status', Sort.desc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByTip() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.asc);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QAfterSortBy> thenByTipDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'tip', Sort.desc);
    });
  }
}

extension CachedDeliveryQueryWhereDistinct
    on QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> {
  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'cachedAt');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByCancelledAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'cancelledAt');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByCourierId(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'courierId', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByCourierName(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'courierName', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByCourierPhone({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'courierPhone', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByCourierPhotoUrl({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'courierPhotoUrl',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByCreatedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'createdAt');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByCurrency(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'currency', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByDeliveredAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveredAt');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByDropoffAddress({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'dropoffAddress',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByDropoffContactName({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'dropoffContactName',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByDropoffContactPhone({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'dropoffContactPhone',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByDropoffLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'dropoffLatitude');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByDropoffLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'dropoffLongitude');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByEstimatedDurationMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'estimatedDurationMinutes');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByFare() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'fare');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByIsActive() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'isActive');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByPackageDescription({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'packageDescription',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByPackageSize(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'packageSize', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByPickedUpAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'pickedUpAt');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByPickupAddress({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'pickupAddress',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByPickupContactName({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'pickupContactName',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByPickupContactPhone({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'pickupContactPhone',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByPickupLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'pickupLatitude');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByPickupLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'pickupLongitude');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'rating');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct>
      distinctByRequestedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'requestedAt');
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByReview(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'review', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByServerId(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'serverId', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByStatus(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'status', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedDelivery, CachedDelivery, QDistinct> distinctByTip() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'tip');
    });
  }
}

extension CachedDeliveryQueryProperty
    on QueryBuilder<CachedDelivery, CachedDelivery, QQueryProperty> {
  QueryBuilder<CachedDelivery, int, QQueryOperations> idProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'id');
    });
  }

  QueryBuilder<CachedDelivery, DateTime, QQueryOperations> cachedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'cachedAt');
    });
  }

  QueryBuilder<CachedDelivery, DateTime?, QQueryOperations>
      cancelledAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'cancelledAt');
    });
  }

  QueryBuilder<CachedDelivery, String?, QQueryOperations> courierIdProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'courierId');
    });
  }

  QueryBuilder<CachedDelivery, String?, QQueryOperations>
      courierNameProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'courierName');
    });
  }

  QueryBuilder<CachedDelivery, String?, QQueryOperations>
      courierPhoneProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'courierPhone');
    });
  }

  QueryBuilder<CachedDelivery, String?, QQueryOperations>
      courierPhotoUrlProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'courierPhotoUrl');
    });
  }

  QueryBuilder<CachedDelivery, DateTime?, QQueryOperations>
      createdAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'createdAt');
    });
  }

  QueryBuilder<CachedDelivery, String, QQueryOperations> currencyProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'currency');
    });
  }

  QueryBuilder<CachedDelivery, DateTime?, QQueryOperations>
      deliveredAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveredAt');
    });
  }

  QueryBuilder<CachedDelivery, String, QQueryOperations>
      dropoffAddressProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'dropoffAddress');
    });
  }

  QueryBuilder<CachedDelivery, String, QQueryOperations>
      dropoffContactNameProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'dropoffContactName');
    });
  }

  QueryBuilder<CachedDelivery, String, QQueryOperations>
      dropoffContactPhoneProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'dropoffContactPhone');
    });
  }

  QueryBuilder<CachedDelivery, double, QQueryOperations>
      dropoffLatitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'dropoffLatitude');
    });
  }

  QueryBuilder<CachedDelivery, double, QQueryOperations>
      dropoffLongitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'dropoffLongitude');
    });
  }

  QueryBuilder<CachedDelivery, int?, QQueryOperations>
      estimatedDurationMinutesProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'estimatedDurationMinutes');
    });
  }

  QueryBuilder<CachedDelivery, double, QQueryOperations> fareProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'fare');
    });
  }

  QueryBuilder<CachedDelivery, bool, QQueryOperations> isActiveProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'isActive');
    });
  }

  QueryBuilder<CachedDelivery, String?, QQueryOperations>
      packageDescriptionProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'packageDescription');
    });
  }

  QueryBuilder<CachedDelivery, String, QQueryOperations> packageSizeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'packageSize');
    });
  }

  QueryBuilder<CachedDelivery, DateTime?, QQueryOperations>
      pickedUpAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'pickedUpAt');
    });
  }

  QueryBuilder<CachedDelivery, String, QQueryOperations>
      pickupAddressProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'pickupAddress');
    });
  }

  QueryBuilder<CachedDelivery, String, QQueryOperations>
      pickupContactNameProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'pickupContactName');
    });
  }

  QueryBuilder<CachedDelivery, String, QQueryOperations>
      pickupContactPhoneProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'pickupContactPhone');
    });
  }

  QueryBuilder<CachedDelivery, double, QQueryOperations>
      pickupLatitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'pickupLatitude');
    });
  }

  QueryBuilder<CachedDelivery, double, QQueryOperations>
      pickupLongitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'pickupLongitude');
    });
  }

  QueryBuilder<CachedDelivery, int?, QQueryOperations> ratingProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'rating');
    });
  }

  QueryBuilder<CachedDelivery, DateTime?, QQueryOperations>
      requestedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'requestedAt');
    });
  }

  QueryBuilder<CachedDelivery, String?, QQueryOperations> reviewProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'review');
    });
  }

  QueryBuilder<CachedDelivery, String, QQueryOperations> serverIdProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'serverId');
    });
  }

  QueryBuilder<CachedDelivery, String, QQueryOperations> statusProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'status');
    });
  }

  QueryBuilder<CachedDelivery, double?, QQueryOperations> tipProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'tip');
    });
  }
}

// coverage:ignore-file
// ignore_for_file: duplicate_ignore, non_constant_identifier_names, constant_identifier_names, invalid_use_of_protected_member, unnecessary_cast, prefer_const_constructors, lines_longer_than_80_chars, require_trailing_commas, inference_failure_on_function_invocation, unnecessary_parenthesis, unnecessary_raw_strings, unnecessary_null_checks, join_return_with_assignment, prefer_final_locals, avoid_js_rounded_ints, avoid_positional_boolean_parameters, always_specify_types

extension GetCachedRestaurantCollection on Isar {
  IsarCollection<CachedRestaurant> get cachedRestaurants => this.collection();
}

const CachedRestaurantSchema = CollectionSchema(
  name: r'CachedRestaurant',
  id: 4529956856613617592,
  properties: {
    r'address': PropertySchema(
      id: 0,
      name: r'address',
      type: IsarType.string,
    ),
    r'cachedAt': PropertySchema(
      id: 1,
      name: r'cachedAt',
      type: IsarType.dateTime,
    ),
    r'coverImageUrl': PropertySchema(
      id: 2,
      name: r'coverImageUrl',
      type: IsarType.string,
    ),
    r'cuisine': PropertySchema(
      id: 3,
      name: r'cuisine',
      type: IsarType.string,
    ),
    r'deliveryFee': PropertySchema(
      id: 4,
      name: r'deliveryFee',
      type: IsarType.double,
    ),
    r'deliveryTimeDisplay': PropertySchema(
      id: 5,
      name: r'deliveryTimeDisplay',
      type: IsarType.string,
    ),
    r'description': PropertySchema(
      id: 6,
      name: r'description',
      type: IsarType.string,
    ),
    r'imageUrl': PropertySchema(
      id: 7,
      name: r'imageUrl',
      type: IsarType.string,
    ),
    r'isFeatured': PropertySchema(
      id: 8,
      name: r'isFeatured',
      type: IsarType.bool,
    ),
    r'isOpen': PropertySchema(
      id: 9,
      name: r'isOpen',
      type: IsarType.bool,
    ),
    r'latitude': PropertySchema(
      id: 10,
      name: r'latitude',
      type: IsarType.double,
    ),
    r'longitude': PropertySchema(
      id: 11,
      name: r'longitude',
      type: IsarType.double,
    ),
    r'maxDeliveryTimeMinutes': PropertySchema(
      id: 12,
      name: r'maxDeliveryTimeMinutes',
      type: IsarType.long,
    ),
    r'minDeliveryTimeMinutes': PropertySchema(
      id: 13,
      name: r'minDeliveryTimeMinutes',
      type: IsarType.long,
    ),
    r'minimumOrder': PropertySchema(
      id: 14,
      name: r'minimumOrder',
      type: IsarType.double,
    ),
    r'name': PropertySchema(
      id: 15,
      name: r'name',
      type: IsarType.string,
    ),
    r'openingHoursJson': PropertySchema(
      id: 16,
      name: r'openingHoursJson',
      type: IsarType.string,
    ),
    r'priceLevel': PropertySchema(
      id: 17,
      name: r'priceLevel',
      type: IsarType.long,
    ),
    r'priceLevelDisplay': PropertySchema(
      id: 18,
      name: r'priceLevelDisplay',
      type: IsarType.string,
    ),
    r'rating': PropertySchema(
      id: 19,
      name: r'rating',
      type: IsarType.double,
    ),
    r'reviewCount': PropertySchema(
      id: 20,
      name: r'reviewCount',
      type: IsarType.long,
    ),
    r'serverId': PropertySchema(
      id: 21,
      name: r'serverId',
      type: IsarType.string,
    )
  },
  estimateSize: _cachedRestaurantEstimateSize,
  serialize: _cachedRestaurantSerialize,
  deserialize: _cachedRestaurantDeserialize,
  deserializeProp: _cachedRestaurantDeserializeProp,
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
    r'name': IndexSchema(
      id: 879695947855722453,
      name: r'name',
      unique: false,
      replace: false,
      properties: [
        IndexPropertySchema(
          name: r'name',
          type: IndexType.hash,
          caseSensitive: true,
        )
      ],
    ),
    r'cuisine': IndexSchema(
      id: -3173894729494932683,
      name: r'cuisine',
      unique: false,
      replace: false,
      properties: [
        IndexPropertySchema(
          name: r'cuisine',
          type: IndexType.hash,
          caseSensitive: true,
        )
      ],
    )
  },
  links: {},
  embeddedSchemas: {},
  getId: _cachedRestaurantGetId,
  getLinks: _cachedRestaurantGetLinks,
  attach: _cachedRestaurantAttach,
  version: '3.1.0+1',
);

int _cachedRestaurantEstimateSize(
  CachedRestaurant object,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  var bytesCount = offsets.last;
  bytesCount += 3 + object.address.length * 3;
  {
    final value = object.coverImageUrl;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.cuisine.length * 3;
  bytesCount += 3 + object.deliveryTimeDisplay.length * 3;
  {
    final value = object.description;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  {
    final value = object.imageUrl;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.name.length * 3;
  {
    final value = object.openingHoursJson;
    if (value != null) {
      bytesCount += 3 + value.length * 3;
    }
  }
  bytesCount += 3 + object.priceLevelDisplay.length * 3;
  bytesCount += 3 + object.serverId.length * 3;
  return bytesCount;
}

void _cachedRestaurantSerialize(
  CachedRestaurant object,
  IsarWriter writer,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  writer.writeString(offsets[0], object.address);
  writer.writeDateTime(offsets[1], object.cachedAt);
  writer.writeString(offsets[2], object.coverImageUrl);
  writer.writeString(offsets[3], object.cuisine);
  writer.writeDouble(offsets[4], object.deliveryFee);
  writer.writeString(offsets[5], object.deliveryTimeDisplay);
  writer.writeString(offsets[6], object.description);
  writer.writeString(offsets[7], object.imageUrl);
  writer.writeBool(offsets[8], object.isFeatured);
  writer.writeBool(offsets[9], object.isOpen);
  writer.writeDouble(offsets[10], object.latitude);
  writer.writeDouble(offsets[11], object.longitude);
  writer.writeLong(offsets[12], object.maxDeliveryTimeMinutes);
  writer.writeLong(offsets[13], object.minDeliveryTimeMinutes);
  writer.writeDouble(offsets[14], object.minimumOrder);
  writer.writeString(offsets[15], object.name);
  writer.writeString(offsets[16], object.openingHoursJson);
  writer.writeLong(offsets[17], object.priceLevel);
  writer.writeString(offsets[18], object.priceLevelDisplay);
  writer.writeDouble(offsets[19], object.rating);
  writer.writeLong(offsets[20], object.reviewCount);
  writer.writeString(offsets[21], object.serverId);
}

CachedRestaurant _cachedRestaurantDeserialize(
  Id id,
  IsarReader reader,
  List<int> offsets,
  Map<Type, List<int>> allOffsets,
) {
  final object = CachedRestaurant();
  object.address = reader.readString(offsets[0]);
  object.cachedAt = reader.readDateTime(offsets[1]);
  object.coverImageUrl = reader.readStringOrNull(offsets[2]);
  object.cuisine = reader.readString(offsets[3]);
  object.deliveryFee = reader.readDouble(offsets[4]);
  object.description = reader.readStringOrNull(offsets[6]);
  object.id = id;
  object.imageUrl = reader.readStringOrNull(offsets[7]);
  object.isFeatured = reader.readBool(offsets[8]);
  object.isOpen = reader.readBool(offsets[9]);
  object.latitude = reader.readDouble(offsets[10]);
  object.longitude = reader.readDouble(offsets[11]);
  object.maxDeliveryTimeMinutes = reader.readLong(offsets[12]);
  object.minDeliveryTimeMinutes = reader.readLong(offsets[13]);
  object.minimumOrder = reader.readDoubleOrNull(offsets[14]);
  object.name = reader.readString(offsets[15]);
  object.openingHoursJson = reader.readStringOrNull(offsets[16]);
  object.priceLevel = reader.readLong(offsets[17]);
  object.rating = reader.readDouble(offsets[19]);
  object.reviewCount = reader.readLong(offsets[20]);
  object.serverId = reader.readString(offsets[21]);
  return object;
}

P _cachedRestaurantDeserializeProp<P>(
  IsarReader reader,
  int propertyId,
  int offset,
  Map<Type, List<int>> allOffsets,
) {
  switch (propertyId) {
    case 0:
      return (reader.readString(offset)) as P;
    case 1:
      return (reader.readDateTime(offset)) as P;
    case 2:
      return (reader.readStringOrNull(offset)) as P;
    case 3:
      return (reader.readString(offset)) as P;
    case 4:
      return (reader.readDouble(offset)) as P;
    case 5:
      return (reader.readString(offset)) as P;
    case 6:
      return (reader.readStringOrNull(offset)) as P;
    case 7:
      return (reader.readStringOrNull(offset)) as P;
    case 8:
      return (reader.readBool(offset)) as P;
    case 9:
      return (reader.readBool(offset)) as P;
    case 10:
      return (reader.readDouble(offset)) as P;
    case 11:
      return (reader.readDouble(offset)) as P;
    case 12:
      return (reader.readLong(offset)) as P;
    case 13:
      return (reader.readLong(offset)) as P;
    case 14:
      return (reader.readDoubleOrNull(offset)) as P;
    case 15:
      return (reader.readString(offset)) as P;
    case 16:
      return (reader.readStringOrNull(offset)) as P;
    case 17:
      return (reader.readLong(offset)) as P;
    case 18:
      return (reader.readString(offset)) as P;
    case 19:
      return (reader.readDouble(offset)) as P;
    case 20:
      return (reader.readLong(offset)) as P;
    case 21:
      return (reader.readString(offset)) as P;
    default:
      throw IsarError('Unknown property with id $propertyId');
  }
}

Id _cachedRestaurantGetId(CachedRestaurant object) {
  return object.id;
}

List<IsarLinkBase<dynamic>> _cachedRestaurantGetLinks(CachedRestaurant object) {
  return [];
}

void _cachedRestaurantAttach(
    IsarCollection<dynamic> col, Id id, CachedRestaurant object) {
  object.id = id;
}

extension CachedRestaurantByIndex on IsarCollection<CachedRestaurant> {
  Future<CachedRestaurant?> getByServerId(String serverId) {
    return getByIndex(r'serverId', [serverId]);
  }

  CachedRestaurant? getByServerIdSync(String serverId) {
    return getByIndexSync(r'serverId', [serverId]);
  }

  Future<bool> deleteByServerId(String serverId) {
    return deleteByIndex(r'serverId', [serverId]);
  }

  bool deleteByServerIdSync(String serverId) {
    return deleteByIndexSync(r'serverId', [serverId]);
  }

  Future<List<CachedRestaurant?>> getAllByServerId(
      List<String> serverIdValues) {
    final values = serverIdValues.map((e) => [e]).toList();
    return getAllByIndex(r'serverId', values);
  }

  List<CachedRestaurant?> getAllByServerIdSync(List<String> serverIdValues) {
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

  Future<Id> putByServerId(CachedRestaurant object) {
    return putByIndex(r'serverId', object);
  }

  Id putByServerIdSync(CachedRestaurant object, {bool saveLinks = true}) {
    return putByIndexSync(r'serverId', object, saveLinks: saveLinks);
  }

  Future<List<Id>> putAllByServerId(List<CachedRestaurant> objects) {
    return putAllByIndex(r'serverId', objects);
  }

  List<Id> putAllByServerIdSync(List<CachedRestaurant> objects,
      {bool saveLinks = true}) {
    return putAllByIndexSync(r'serverId', objects, saveLinks: saveLinks);
  }
}

extension CachedRestaurantQueryWhereSort
    on QueryBuilder<CachedRestaurant, CachedRestaurant, QWhere> {
  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhere> anyId() {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(const IdWhereClause.any());
    });
  }
}

extension CachedRestaurantQueryWhere
    on QueryBuilder<CachedRestaurant, CachedRestaurant, QWhereClause> {
  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause> idEqualTo(
      Id id) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IdWhereClause.between(
        lower: id,
        upper: id,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause>
      idNotEqualTo(Id id) {
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause>
      idGreaterThan(Id id, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.greaterThan(lower: id, includeLower: include),
      );
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause>
      idLessThan(Id id, {bool include = false}) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(
        IdWhereClause.lessThan(upper: id, includeUpper: include),
      );
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause> idBetween(
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause>
      serverIdEqualTo(String serverId) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'serverId',
        value: [serverId],
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause>
      serverIdNotEqualTo(String serverId) {
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause>
      nameEqualTo(String name) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'name',
        value: [name],
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause>
      nameNotEqualTo(String name) {
    return QueryBuilder.apply(this, (query) {
      if (query.whereSort == Sort.asc) {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'name',
              lower: [],
              upper: [name],
              includeUpper: false,
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'name',
              lower: [name],
              includeLower: false,
              upper: [],
            ));
      } else {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'name',
              lower: [name],
              includeLower: false,
              upper: [],
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'name',
              lower: [],
              upper: [name],
              includeUpper: false,
            ));
      }
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause>
      cuisineEqualTo(String cuisine) {
    return QueryBuilder.apply(this, (query) {
      return query.addWhereClause(IndexWhereClause.equalTo(
        indexName: r'cuisine',
        value: [cuisine],
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterWhereClause>
      cuisineNotEqualTo(String cuisine) {
    return QueryBuilder.apply(this, (query) {
      if (query.whereSort == Sort.asc) {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'cuisine',
              lower: [],
              upper: [cuisine],
              includeUpper: false,
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'cuisine',
              lower: [cuisine],
              includeLower: false,
              upper: [],
            ));
      } else {
        return query
            .addWhereClause(IndexWhereClause.between(
              indexName: r'cuisine',
              lower: [cuisine],
              includeLower: false,
              upper: [],
            ))
            .addWhereClause(IndexWhereClause.between(
              indexName: r'cuisine',
              lower: [],
              upper: [cuisine],
              includeUpper: false,
            ));
      }
    });
  }
}

extension CachedRestaurantQueryFilter
    on QueryBuilder<CachedRestaurant, CachedRestaurant, QFilterCondition> {
  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      addressEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'address',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      addressGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'address',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      addressLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'address',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      addressBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'address',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      addressStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'address',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      addressEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'address',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      addressContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'address',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      addressMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'address',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      addressIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'address',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      addressIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'address',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cachedAtEqualTo(DateTime value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'cachedAt',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cachedAtLessThan(
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cachedAtBetween(
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'coverImageUrl',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'coverImageUrl',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'coverImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'coverImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'coverImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'coverImageUrl',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'coverImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'coverImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'coverImageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'coverImageUrl',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'coverImageUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      coverImageUrlIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'coverImageUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cuisineEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'cuisine',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cuisineGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'cuisine',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cuisineLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'cuisine',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cuisineBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'cuisine',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cuisineStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'cuisine',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cuisineEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'cuisine',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cuisineContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'cuisine',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cuisineMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'cuisine',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cuisineIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'cuisine',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      cuisineIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'cuisine',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryFeeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryFee',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryFeeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryFee',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryFeeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryFee',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryFeeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryFee',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryTimeDisplayEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryTimeDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryTimeDisplayGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'deliveryTimeDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryTimeDisplayLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'deliveryTimeDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryTimeDisplayBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'deliveryTimeDisplay',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryTimeDisplayStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'deliveryTimeDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryTimeDisplayEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'deliveryTimeDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryTimeDisplayContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'deliveryTimeDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryTimeDisplayMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'deliveryTimeDisplay',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryTimeDisplayIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'deliveryTimeDisplay',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      deliveryTimeDisplayIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'deliveryTimeDisplay',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'description',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'description',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'description',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'description',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'description',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'description',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'description',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'description',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'description',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'description',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'description',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      descriptionIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'description',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      idEqualTo(Id value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'id',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      idGreaterThan(
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      idLessThan(
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      idBetween(
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'imageUrl',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'imageUrl',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'imageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'imageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'imageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'imageUrl',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'imageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'imageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'imageUrl',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'imageUrl',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'imageUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      imageUrlIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'imageUrl',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      isFeaturedEqualTo(bool value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'isFeatured',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      isOpenEqualTo(bool value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'isOpen',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      latitudeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'latitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      latitudeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'latitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      latitudeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'latitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      latitudeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'latitude',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      longitudeEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'longitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      longitudeGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'longitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      longitudeLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'longitude',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      longitudeBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'longitude',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      maxDeliveryTimeMinutesEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'maxDeliveryTimeMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      maxDeliveryTimeMinutesGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'maxDeliveryTimeMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      maxDeliveryTimeMinutesLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'maxDeliveryTimeMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      maxDeliveryTimeMinutesBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'maxDeliveryTimeMinutes',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      minDeliveryTimeMinutesEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'minDeliveryTimeMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      minDeliveryTimeMinutesGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'minDeliveryTimeMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      minDeliveryTimeMinutesLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'minDeliveryTimeMinutes',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      minDeliveryTimeMinutesBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'minDeliveryTimeMinutes',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      minimumOrderIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'minimumOrder',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      minimumOrderIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'minimumOrder',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      minimumOrderEqualTo(
    double? value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'minimumOrder',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      minimumOrderGreaterThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'minimumOrder',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      minimumOrderLessThan(
    double? value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'minimumOrder',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      minimumOrderBetween(
    double? lower,
    double? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'minimumOrder',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      nameEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'name',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      nameGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'name',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      nameLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'name',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      nameBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'name',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      nameStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'name',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      nameEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'name',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      nameContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'name',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      nameMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'name',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      nameIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'name',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      nameIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'name',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonIsNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNull(
        property: r'openingHoursJson',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonIsNotNull() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(const FilterCondition.isNotNull(
        property: r'openingHoursJson',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonEqualTo(
    String? value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'openingHoursJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonGreaterThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'openingHoursJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonLessThan(
    String? value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'openingHoursJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonBetween(
    String? lower,
    String? upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'openingHoursJson',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'openingHoursJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'openingHoursJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'openingHoursJson',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'openingHoursJson',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'openingHoursJson',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      openingHoursJsonIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'openingHoursJson',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'priceLevel',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'priceLevel',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'priceLevel',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'priceLevel',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelDisplayEqualTo(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'priceLevelDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelDisplayGreaterThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'priceLevelDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelDisplayLessThan(
    String value, {
    bool include = false,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'priceLevelDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelDisplayBetween(
    String lower,
    String upper, {
    bool includeLower = true,
    bool includeUpper = true,
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'priceLevelDisplay',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelDisplayStartsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.startsWith(
        property: r'priceLevelDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelDisplayEndsWith(
    String value, {
    bool caseSensitive = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.endsWith(
        property: r'priceLevelDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelDisplayContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'priceLevelDisplay',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelDisplayMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'priceLevelDisplay',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelDisplayIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'priceLevelDisplay',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      priceLevelDisplayIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'priceLevelDisplay',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      ratingEqualTo(
    double value, {
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'rating',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      ratingGreaterThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'rating',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      ratingLessThan(
    double value, {
    bool include = false,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'rating',
        value: value,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      ratingBetween(
    double lower,
    double upper, {
    bool includeLower = true,
    bool includeUpper = true,
    double epsilon = Query.epsilon,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'rating',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
        epsilon: epsilon,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      reviewCountEqualTo(int value) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'reviewCount',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      reviewCountGreaterThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        include: include,
        property: r'reviewCount',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      reviewCountLessThan(
    int value, {
    bool include = false,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.lessThan(
        include: include,
        property: r'reviewCount',
        value: value,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      reviewCountBetween(
    int lower,
    int upper, {
    bool includeLower = true,
    bool includeUpper = true,
  }) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.between(
        property: r'reviewCount',
        lower: lower,
        includeLower: includeLower,
        upper: upper,
        includeUpper: includeUpper,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      serverIdEqualTo(
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      serverIdLessThan(
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      serverIdBetween(
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      serverIdEndsWith(
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

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      serverIdContains(String value, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.contains(
        property: r'serverId',
        value: value,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      serverIdMatches(String pattern, {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.matches(
        property: r'serverId',
        wildcard: pattern,
        caseSensitive: caseSensitive,
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      serverIdIsEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.equalTo(
        property: r'serverId',
        value: '',
      ));
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterFilterCondition>
      serverIdIsNotEmpty() {
    return QueryBuilder.apply(this, (query) {
      return query.addFilterCondition(FilterCondition.greaterThan(
        property: r'serverId',
        value: '',
      ));
    });
  }
}

extension CachedRestaurantQueryObject
    on QueryBuilder<CachedRestaurant, CachedRestaurant, QFilterCondition> {}

extension CachedRestaurantQueryLinks
    on QueryBuilder<CachedRestaurant, CachedRestaurant, QFilterCondition> {}

extension CachedRestaurantQuerySortBy
    on QueryBuilder<CachedRestaurant, CachedRestaurant, QSortBy> {
  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'address', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'address', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByCachedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByCoverImageUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'coverImageUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByCoverImageUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'coverImageUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByCuisine() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cuisine', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByCuisineDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cuisine', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByDeliveryFee() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryFee', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByDeliveryFeeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryFee', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByDeliveryTimeDisplay() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryTimeDisplay', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByDeliveryTimeDisplayDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryTimeDisplay', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByDescription() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'description', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByDescriptionDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'description', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByImageUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'imageUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByImageUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'imageUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByIsFeatured() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isFeatured', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByIsFeaturedDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isFeatured', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByIsOpen() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isOpen', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByIsOpenDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isOpen', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'latitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'latitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'longitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'longitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByMaxDeliveryTimeMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'maxDeliveryTimeMinutes', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByMaxDeliveryTimeMinutesDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'maxDeliveryTimeMinutes', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByMinDeliveryTimeMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'minDeliveryTimeMinutes', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByMinDeliveryTimeMinutesDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'minDeliveryTimeMinutes', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByMinimumOrder() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'minimumOrder', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByMinimumOrderDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'minimumOrder', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy> sortByName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'name', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'name', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByOpeningHoursJson() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'openingHoursJson', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByOpeningHoursJsonDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'openingHoursJson', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByPriceLevel() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'priceLevel', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByPriceLevelDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'priceLevel', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByPriceLevelDisplay() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'priceLevelDisplay', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByPriceLevelDisplayDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'priceLevelDisplay', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'rating', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'rating', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByReviewCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'reviewCount', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByReviewCountDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'reviewCount', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByServerId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      sortByServerIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.desc);
    });
  }
}

extension CachedRestaurantQuerySortThenBy
    on QueryBuilder<CachedRestaurant, CachedRestaurant, QSortThenBy> {
  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByAddress() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'address', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByAddressDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'address', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByCachedAtDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cachedAt', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByCoverImageUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'coverImageUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByCoverImageUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'coverImageUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByCuisine() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cuisine', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByCuisineDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'cuisine', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByDeliveryFee() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryFee', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByDeliveryFeeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryFee', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByDeliveryTimeDisplay() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryTimeDisplay', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByDeliveryTimeDisplayDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'deliveryTimeDisplay', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByDescription() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'description', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByDescriptionDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'description', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy> thenById() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'id', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByImageUrl() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'imageUrl', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByImageUrlDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'imageUrl', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByIsFeatured() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isFeatured', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByIsFeaturedDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isFeatured', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByIsOpen() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isOpen', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByIsOpenDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'isOpen', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'latitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByLatitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'latitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'longitude', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByLongitudeDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'longitude', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByMaxDeliveryTimeMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'maxDeliveryTimeMinutes', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByMaxDeliveryTimeMinutesDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'maxDeliveryTimeMinutes', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByMinDeliveryTimeMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'minDeliveryTimeMinutes', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByMinDeliveryTimeMinutesDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'minDeliveryTimeMinutes', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByMinimumOrder() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'minimumOrder', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByMinimumOrderDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'minimumOrder', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy> thenByName() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'name', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByNameDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'name', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByOpeningHoursJson() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'openingHoursJson', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByOpeningHoursJsonDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'openingHoursJson', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByPriceLevel() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'priceLevel', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByPriceLevelDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'priceLevel', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByPriceLevelDisplay() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'priceLevelDisplay', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByPriceLevelDisplayDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'priceLevelDisplay', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'rating', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByRatingDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'rating', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByReviewCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'reviewCount', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByReviewCountDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'reviewCount', Sort.desc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByServerId() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.asc);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QAfterSortBy>
      thenByServerIdDesc() {
    return QueryBuilder.apply(this, (query) {
      return query.addSortBy(r'serverId', Sort.desc);
    });
  }
}

extension CachedRestaurantQueryWhereDistinct
    on QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct> {
  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct> distinctByAddress(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'address', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByCachedAt() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'cachedAt');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByCoverImageUrl({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'coverImageUrl',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct> distinctByCuisine(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'cuisine', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByDeliveryFee() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryFee');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByDeliveryTimeDisplay({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'deliveryTimeDisplay',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByDescription({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'description', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByImageUrl({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'imageUrl', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByIsFeatured() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'isFeatured');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByIsOpen() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'isOpen');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByLatitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'latitude');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByLongitude() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'longitude');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByMaxDeliveryTimeMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'maxDeliveryTimeMinutes');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByMinDeliveryTimeMinutes() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'minDeliveryTimeMinutes');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByMinimumOrder() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'minimumOrder');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct> distinctByName(
      {bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'name', caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByOpeningHoursJson({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'openingHoursJson',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByPriceLevel() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'priceLevel');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByPriceLevelDisplay({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'priceLevelDisplay',
          caseSensitive: caseSensitive);
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByRating() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'rating');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByReviewCount() {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'reviewCount');
    });
  }

  QueryBuilder<CachedRestaurant, CachedRestaurant, QDistinct>
      distinctByServerId({bool caseSensitive = true}) {
    return QueryBuilder.apply(this, (query) {
      return query.addDistinctBy(r'serverId', caseSensitive: caseSensitive);
    });
  }
}

extension CachedRestaurantQueryProperty
    on QueryBuilder<CachedRestaurant, CachedRestaurant, QQueryProperty> {
  QueryBuilder<CachedRestaurant, int, QQueryOperations> idProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'id');
    });
  }

  QueryBuilder<CachedRestaurant, String, QQueryOperations> addressProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'address');
    });
  }

  QueryBuilder<CachedRestaurant, DateTime, QQueryOperations>
      cachedAtProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'cachedAt');
    });
  }

  QueryBuilder<CachedRestaurant, String?, QQueryOperations>
      coverImageUrlProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'coverImageUrl');
    });
  }

  QueryBuilder<CachedRestaurant, String, QQueryOperations> cuisineProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'cuisine');
    });
  }

  QueryBuilder<CachedRestaurant, double, QQueryOperations>
      deliveryFeeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryFee');
    });
  }

  QueryBuilder<CachedRestaurant, String, QQueryOperations>
      deliveryTimeDisplayProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'deliveryTimeDisplay');
    });
  }

  QueryBuilder<CachedRestaurant, String?, QQueryOperations>
      descriptionProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'description');
    });
  }

  QueryBuilder<CachedRestaurant, String?, QQueryOperations> imageUrlProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'imageUrl');
    });
  }

  QueryBuilder<CachedRestaurant, bool, QQueryOperations> isFeaturedProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'isFeatured');
    });
  }

  QueryBuilder<CachedRestaurant, bool, QQueryOperations> isOpenProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'isOpen');
    });
  }

  QueryBuilder<CachedRestaurant, double, QQueryOperations> latitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'latitude');
    });
  }

  QueryBuilder<CachedRestaurant, double, QQueryOperations> longitudeProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'longitude');
    });
  }

  QueryBuilder<CachedRestaurant, int, QQueryOperations>
      maxDeliveryTimeMinutesProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'maxDeliveryTimeMinutes');
    });
  }

  QueryBuilder<CachedRestaurant, int, QQueryOperations>
      minDeliveryTimeMinutesProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'minDeliveryTimeMinutes');
    });
  }

  QueryBuilder<CachedRestaurant, double?, QQueryOperations>
      minimumOrderProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'minimumOrder');
    });
  }

  QueryBuilder<CachedRestaurant, String, QQueryOperations> nameProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'name');
    });
  }

  QueryBuilder<CachedRestaurant, String?, QQueryOperations>
      openingHoursJsonProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'openingHoursJson');
    });
  }

  QueryBuilder<CachedRestaurant, int, QQueryOperations> priceLevelProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'priceLevel');
    });
  }

  QueryBuilder<CachedRestaurant, String, QQueryOperations>
      priceLevelDisplayProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'priceLevelDisplay');
    });
  }

  QueryBuilder<CachedRestaurant, double, QQueryOperations> ratingProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'rating');
    });
  }

  QueryBuilder<CachedRestaurant, int, QQueryOperations> reviewCountProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'reviewCount');
    });
  }

  QueryBuilder<CachedRestaurant, String, QQueryOperations> serverIdProperty() {
    return QueryBuilder.apply(this, (query) {
      return query.addPropertyName(r'serverId');
    });
  }
}
