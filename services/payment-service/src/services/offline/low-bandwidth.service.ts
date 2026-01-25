// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - LOW-BANDWIDTH OPTIMIZATION SERVICE
// =============================================================================
// Optimized data transfer for 2G networks and data-constrained users
// Target: 90% reduction in data usage, sub-second response times
// =============================================================================

import { logger } from "@/lib/logger";
import {
  CompressedResponse,
  DataUsageStats,
  DeltaSyncRequest,
  DeltaSyncResponse,
  GeoLocation,
  ILowBandwidthService,
  LiteFareEstimate,
  LiteTrip,
  NetworkType,
  SyncState,
  SyncStatus,
} from "@/types/offline.types";
import { prisma } from "@ubi/database";
import { Redis } from "ioredis";
import { EventEmitter } from "node:events";
import { gunzip, gzip } from "node:zlib";

// Redis client for caching
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// =============================================================================
// COMPRESSION CONSTANTS
// =============================================================================

const COMPRESSION_THRESHOLD = 500; // Only compress if > 500 bytes
const MAX_DELTA_SIZE = 10000; // Max bytes for delta sync
const SYNC_BATCH_SIZE = 50; // Max records per sync
const CACHE_TTL_SECONDS = 300; // 5 minutes default cache

// =============================================================================
// TYPE ALIASES
// =============================================================================

/** Quality level for images and map tiles */
type QualityLevel = "low" | "medium" | "high";

// =============================================================================
// LOW-BANDWIDTH SERVICE
// =============================================================================

export class LowBandwidthService implements ILowBandwidthService {
  private readonly eventEmitter: EventEmitter;

  // User sync states (Redis in production)
  private readonly syncStates: Map<string, SyncState> = new Map();

  // Compressed cache
  private readonly compressedCache: Map<
    string,
    { data: Buffer; etag: string; expiresAt: Date }
  > = new Map();

  constructor() {
    this.eventEmitter = new EventEmitter();
  }

  // ===========================================================================
  // COMPRESSION
  // ===========================================================================

  async compress(data: unknown): Promise<CompressedResponse> {
    const json = JSON.stringify(data);
    const originalSize = Buffer.byteLength(json, "utf8");

    // Skip compression for small payloads
    if (originalSize < COMPRESSION_THRESHOLD) {
      return {
        encoding: "identity",
        data: json,
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 1,
      };
    }

    // Try gzip compression
    const gzipBuffer = await this.gzipCompress(json);

    // Try MessagePack-like binary encoding
    const binaryData = this.toBinaryFormat(data);
    const binaryGzip = await this.gzipCompress(binaryData);

    // Use the smallest representation
    if (binaryGzip.length < gzipBuffer.length) {
      return {
        encoding: "msgpack+gzip",
        data: binaryGzip.toString("base64"),
        originalSize,
        compressedSize: binaryGzip.length,
        compressionRatio: originalSize / binaryGzip.length,
      };
    }

    return {
      encoding: "gzip",
      data: gzipBuffer.toString("base64"),
      originalSize,
      compressedSize: gzipBuffer.length,
      compressionRatio: originalSize / gzipBuffer.length,
    };
  }

  async decompress(response: CompressedResponse): Promise<unknown> {
    if (response.encoding === "identity") {
      return JSON.parse(response.data as string);
    }

    const buffer = Buffer.from(response.data as string, "base64");

    if (response.encoding === "gzip") {
      const decompressed = await this.gzipDecompress(buffer);
      return JSON.parse(decompressed.toString("utf8"));
    }

    if (response.encoding === "msgpack+gzip") {
      const decompressed = await this.gzipDecompress(buffer);
      return this.fromBinaryFormat(decompressed.toString("utf8"));
    }

    throw new Error(`Unknown encoding: ${response.encoding as string}`);
  }

  private gzipCompress(data: string | Buffer): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      gzip(data, { level: 9 }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  private gzipDecompress(data: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      gunzip(data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  // ===========================================================================
  // BINARY FORMAT (MessagePack-like)
  // ===========================================================================

  private toBinaryFormat(data: unknown): string {
    // Simplified binary encoding - use field name abbreviations
    const abbreviated = this.abbreviateKeys(data);
    return JSON.stringify(abbreviated);
  }

  private fromBinaryFormat(data: string): unknown {
    const abbreviated = JSON.parse(data);
    return this.expandKeys(abbreviated);
  }

  private abbreviateKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.abbreviateKeys(item));
    }

    const abbreviations: Record<string, string> = {
      id: "i",
      pickup: "p",
      dropoff: "d",
      latitude: "la",
      longitude: "lo",
      timestamp: "t",
      status: "s",
      driver: "dr",
      driverId: "di",
      driverName: "dn",
      driverPhone: "dp",
      driverPhoto: "dh",
      vehiclePlate: "vp",
      vehicleModel: "vm",
      vehicleColor: "vc",
      fareEstimate: "fe",
      fareActual: "fa",
      currency: "cu",
      distance: "ds",
      duration: "du",
      eta: "e",
      rating: "r",
      createdAt: "ca",
      updatedAt: "ua",
      address: "a",
      name: "n",
      phone: "ph",
      email: "em",
      userId: "ui",
      tripId: "ti",
      paymentMethod: "pm",
      paymentStatus: "ps",
    };

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const abbreviatedKey = abbreviations[key] || key;
      result[abbreviatedKey] = this.abbreviateKeys(value);
    }
    return result;
  }

  private expandKeys(obj: unknown): unknown {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.expandKeys(item));
    }

    const expansions: Record<string, string> = {
      i: "id",
      p: "pickup",
      d: "dropoff",
      la: "latitude",
      lo: "longitude",
      t: "timestamp",
      s: "status",
      dr: "driver",
      di: "driverId",
      dn: "driverName",
      dp: "driverPhone",
      dh: "driverPhoto",
      vp: "vehiclePlate",
      vm: "vehicleModel",
      vc: "vehicleColor",
      fe: "fareEstimate",
      fa: "fareActual",
      cu: "currency",
      ds: "distance",
      du: "duration",
      e: "eta",
      r: "rating",
      ca: "createdAt",
      ua: "updatedAt",
      a: "address",
      n: "name",
      ph: "phone",
      em: "email",
      ui: "userId",
      ti: "tripId",
      pm: "paymentMethod",
      ps: "paymentStatus",
    };

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const expandedKey = expansions[key] || key;
      result[expandedKey] = this.expandKeys(value);
    }
    return result;
  }

  // ===========================================================================
  // DELTA SYNC
  // ===========================================================================

  async deltaSync(request: DeltaSyncRequest): Promise<DeltaSyncResponse> {
    const { userId, lastSyncVersion, entities, networkType } = request;

    // Get user's sync state
    let syncState = this.syncStates.get(userId);
    syncState ??= await this.initializeSyncState(userId);

    // Determine batch size based on network
    const batchSize = this.getBatchSize(networkType);

    // Collect changes since last sync
    const changes: DeltaSyncResponse["changes"] = [];
    let currentSize = 0;

    for (const entity of entities || [
      "trips",
      "wallet",
      "notifications",
      "places",
    ]) {
      const entityChanges = await this.getEntityChanges(
        userId,
        entity,
        Number(lastSyncVersion),
        batchSize,
      );

      for (const change of entityChanges) {
        const changeSize = JSON.stringify(change).length;
        if (currentSize + changeSize > MAX_DELTA_SIZE) {
          break; // Stop if we exceed max payload size
        }

        changes.push({
          entity: change.entity,
          id: change.id,
          action: change.operation,
          data: change.data as Record<string, unknown> | undefined,
          version: BigInt(Math.floor(change.version)),
        });
        currentSize += changeSize;
      }
    }

    // Get new server version
    const newVersion = Date.now();

    // Prepare response
    const response: DeltaSyncResponse = {
      currentVersion: BigInt(newVersion),
      serverVersion: newVersion,
      changes,
      hasMore: changes.length >= batchSize,
      timestamp: newVersion,
      syncedAt: new Date(),
    };

    // Compress if needed
    if (
      networkType === NetworkType.EDGE_2G ||
      networkType === NetworkType.GPRS
    ) {
      const compressed = await this.compress(response);
      response.compressed = compressed;
    }

    // Update sync state
    syncState.lastSyncAt = new Date();
    syncState.serverVersion = newVersion;
    syncState.pendingChanges = Math.max(
      0,
      syncState.pendingChanges - changes.length,
    );
    this.syncStates.set(userId, syncState);

    // Track data usage
    await this.trackDataUsage(userId, currentSize, "download", "delta_sync");

    return response;
  }

  private getBatchSize(networkType?: NetworkType): number {
    switch (networkType) {
      case NetworkType.GPRS:
        return 5;
      case NetworkType.EDGE_2G:
        return 10;
      case NetworkType.HSPA_3G:
        return 25;
      case NetworkType.LTE_4G:
      case NetworkType.WIFI:
        return SYNC_BATCH_SIZE;
      default:
        return 20;
    }
  }

  private async initializeSyncState(userId: string): Promise<SyncState> {
    const state: SyncState = {
      userId,
      deviceId: "",
      lastSyncAt: new Date(0),
      serverVersion: 0,
      clientVersion: 0,
      syncStatus: SyncStatus.IDLE,
      pendingChanges: 0,
      syncErrors: 0,
    };
    this.syncStates.set(userId, state);
    return state;
  }

  private async getEntityChanges(
    _userId: string,
    entity: string,
    sinceVersion: number,
    limit: number,
  ): Promise<
    Array<{
      entity: string;
      id: string;
      operation: "create" | "update" | "delete";
      data?: unknown;
      version: number;
    }>
  > {
    // In production, query database for changes since version
    // This is a stub implementation
    const changes: Array<{
      entity: string;
      id: string;
      operation: "create" | "update" | "delete";
      data?: unknown;
      version: number;
    }> = [];

    // Example: Get trip changes
    if (entity === "trips") {
      const trips = await this.getTripsSinceVersion(
        _userId,
        sinceVersion,
        limit,
      );
      for (const trip of trips) {
        changes.push({
          entity: "trips",
          id: trip.id,
          operation: "update",
          data: this.toLiteTrip(trip),
          version: trip.version,
        });
      }
    }

    return changes;
  }

  // ===========================================================================
  // LITE API ENDPOINTS
  // ===========================================================================

  async getLiteFareEstimate(
    pickup: GeoLocation,
    dropoff: GeoLocation,
    _networkType?: NetworkType,
  ): Promise<LiteFareEstimate> {
    // Get fare estimate with minimal data
    const estimate = await this.calculateFare(pickup, dropoff);

    const lite: LiteFareEstimate = {
      p: Math.round(estimate.minFare), // price min
      x: Math.round(estimate.maxFare), // price max
      e: Math.round(estimate.eta), // eta in minutes
      d: Math.round(estimate.distance * 10) / 10, // distance in km (1 decimal)
      c: estimate.currency, // currency code
      s: estimate.surgeMultiplier > 1 ? estimate.surgeMultiplier : undefined, // surge if applicable
    };

    // Track data usage (estimate ~50 bytes for lite vs ~300 for full)
    this.trackDataUsage("anonymous", 50, "download", "fare_estimate");

    return lite;
  }

  async getLiteTrip(
    tripId: string,
    _networkType?: NetworkType,
  ): Promise<LiteTrip | null> {
    const trip = await this.getTrip(tripId);
    if (!trip) return null;

    return this.toLiteTrip(trip);
  }

  async getLiteTrips(
    userId: string,
    limit: number = 10,
    _networkType?: NetworkType,
  ): Promise<LiteTrip[]> {
    const trips = await this.getUserTrips(userId, limit);
    return trips.map((trip) => this.toLiteTrip(trip));
  }

  private toLiteTrip(trip: any): LiteTrip {
    const pickupAddress = trip.pickupAddress || "";
    const dropoffAddress = trip.dropoffAddress || "";

    return {
      i: trip.id, // id
      s: trip.status[0].toUpperCase(), // status (first letter: S=searching, M=matched, A=arriving, P=in_progress, C=completed)
      p: {
        // pickup
        la: trip.pickup.lat,
        lo: trip.pickup.lng,
        a: this.truncateAddress(pickupAddress, 30),
      },
      d: {
        // dropoff
        la: trip.dropoff.lat,
        lo: trip.dropoff.lng,
        a: this.truncateAddress(dropoffAddress, 30),
      },
      e: trip.eta, // eta
      f: Math.round(trip.fare), // fare
      t: Math.floor(trip.createdAt.getTime() / 1000), // timestamp (unix)
      // Driver info (only if assigned)
      ...(trip.driverId && {
        dr: {
          n: trip.driverName,
          ph: trip.driverPhone,
          v: trip.vehiclePlate,
          r: trip.driverRating,
        },
      }),
    };
  }

  // ===========================================================================
  // ADAPTIVE DATA
  // ===========================================================================

  getOptimalPayloadSize(networkType: NetworkType): number {
    switch (networkType) {
      case NetworkType.GPRS:
        return 1024; // 1 KB
      case NetworkType.EDGE_2G:
        return 5120; // 5 KB
      case NetworkType.HSPA_3G:
        return 51200; // 50 KB
      case NetworkType.LTE_4G:
        return 512000; // 500 KB
      case NetworkType.WIFI:
        return 1048576; // 1 MB
      default:
        return 10240; // 10 KB default
    }
  }

  shouldIncludeImages(networkType: NetworkType, dataBudget: string): boolean {
    if (dataBudget === "ultra_saver" || dataBudget === "saver") {
      return false;
    }

    return (
      networkType === NetworkType.LTE_4G || networkType === NetworkType.WIFI
    );
  }

  getImageQuality(networkType: NetworkType): QualityLevel {
    switch (networkType) {
      case NetworkType.GPRS:
      case NetworkType.EDGE_2G:
        return "low";
      case NetworkType.HSPA_3G:
        return "medium";
      default:
        return "high";
    }
  }

  // ===========================================================================
  // DATA USAGE TRACKING
  // ===========================================================================

  async trackDataUsage(
    userId: string,
    bytes: number,
    direction: "upload" | "download",
    endpoint: string,
  ): Promise<void> {
    this.eventEmitter.emit("data:usage", {
      userId,
      bytes,
      direction,
      endpoint,
      timestamp: new Date(),
    });

    // In production, persist to database and check against budget
  }

  async getDataUsageStats(userId: string): Promise<DataUsageStats> {
    // In production, aggregate from database
    return {
      userId,
      periodStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      periodEnd: new Date(),
      totalBytes: 50 * 1024 * 1024, // 50 MB example
      uploadBytes: 5 * 1024 * 1024,
      downloadBytes: 45 * 1024 * 1024,
      byEndpoint: {
        trips: 20 * 1024 * 1024,
        maps: 15 * 1024 * 1024,
        images: 10 * 1024 * 1024,
        sync: 5 * 1024 * 1024,
      },
      savedBytes: 150 * 1024 * 1024, // Estimated savings from compression
      budgetRemaining: 50 * 1024 * 1024,
    };
  }

  async setDataBudget(userId: string, budgetType: string): Promise<void> {
    // Update user's data budget preference
    this.eventEmitter.emit("budget:updated", { userId, budgetType });
  }

  // ===========================================================================
  // OFFLINE MAP REGIONS
  // ===========================================================================

  async getOfflineMapRegion(
    regionId: string,
    zoomLevel: number,
    networkType?: NetworkType,
  ): Promise<{
    tiles: Array<{ x: number; y: number; z: number; data: string }>;
    boundingBox: { north: number; south: number; east: number; west: number };
    sizeBytes: number;
  }> {
    // In production, get from map tile cache
    const region = await this.getRegionDefinition(regionId);

    // Adjust tile quality based on network
    const quality =
      networkType === NetworkType.GPRS || networkType === NetworkType.EDGE_2G
        ? "low"
        : "high";

    const tiles = await this.getTilesForRegion(region, zoomLevel, quality);

    return {
      tiles,
      boundingBox: region.boundingBox,
      sizeBytes: tiles.reduce((sum, t) => sum + t.data.length, 0),
    };
  }

  async getCachedPlacesForRegion(
    _regionId: string,
    _limit: number = 100,
  ): Promise<
    Array<{
      id: string;
      name: string;
      address: string;
      coords: GeoLocation;
      type: string;
      h3Index: string;
    }>
  > {
    // Get frequently-used places for offline availability
    return [];
  }

  // ===========================================================================
  // CACHING
  // ===========================================================================

  async getCachedResponse(
    cacheKey: string,
    etag?: string,
  ): Promise<{ data: unknown; etag: string } | null> {
    const cached = this.compressedCache.get(cacheKey);

    if (!cached || cached.expiresAt < new Date()) {
      this.compressedCache.delete(cacheKey);
      return null;
    }

    // Return 304-style response if etag matches
    if (etag && cached.etag === etag) {
      return { data: null, etag: cached.etag };
    }

    const decompressed = await this.gzipDecompress(cached.data);
    return {
      data: JSON.parse(decompressed.toString("utf8")),
      etag: cached.etag,
    };
  }

  async setCachedResponse(
    cacheKey: string,
    data: unknown,
    ttlSeconds: number = CACHE_TTL_SECONDS,
  ): Promise<string> {
    const json = JSON.stringify(data);
    const compressed = await this.gzipCompress(json);
    const etag = this.generateETag(json);

    this.compressedCache.set(cacheKey, {
      data: compressed,
      etag,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });

    return etag;
  }

  private generateETag(data: string): string {
    // Simple hash for ETag
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.codePointAt(i) ?? 0;
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return `"${Math.abs(hash).toString(36)}"`;
  }

  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================

  private truncateAddress(address: string, maxLength: number): string {
    if (!address || address.length <= maxLength) return address;
    return address.substring(0, maxLength - 3) + "...";
  }

  // ===========================================================================
  // EXTERNAL SERVICE IMPLEMENTATIONS
  // ===========================================================================

  private async calculateFare(
    pickup: GeoLocation,
    dropoff: GeoLocation,
  ): Promise<{
    minFare: number;
    maxFare: number;
    eta: number;
    distance: number;
    currency: string;
    surgeMultiplier: number;
  }> {
    try {
      // Calculate distance using Haversine formula
      const R = 6371; // Earth's radius in km
      const dLat = ((dropoff.lat - pickup.lat) * Math.PI) / 180;
      const dLng = ((dropoff.lng - pickup.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((pickup.lat * Math.PI) / 180) *
          Math.cos((dropoff.lat * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

      // Get pricing config from Redis
      const pricing = (await redis.hgetall("pricing:config")) || {};
      const baseFare = Number.parseFloat(pricing.baseFare) || 100;
      const perKm = Number.parseFloat(pricing.perKm) || 50;
      const perMinute = Number.parseFloat(pricing.perMinute) || 5;
      const currency = pricing.currency || "KES";

      // Estimate travel time (assume 25 km/h average in city traffic)
      const estimatedMinutes = Math.ceil((distance / 25) * 60);

      // Calculate fare
      const baseCost =
        baseFare + distance * perKm + estimatedMinutes * perMinute;

      // Check for surge pricing
      const surgeKey = `surge:${Math.floor(pickup.lat * 100)}_${Math.floor(pickup.lng * 100)}`;
      const surgeMultiplier = Number.parseFloat(
        (await redis.get(surgeKey)) || "1.0",
      );

      // Calculate min/max range (±10%)
      const fare = baseCost * surgeMultiplier;
      const minFare = Math.round(fare * 0.9);
      const maxFare = Math.round(fare * 1.1);

      return {
        minFare,
        maxFare,
        eta: Math.ceil(estimatedMinutes),
        distance: Math.round(distance * 10) / 10,
        currency,
        surgeMultiplier,
      };
    } catch (error) {
      logger.error("LowBandwidth: Error calculating fare", {
        pickup,
        dropoff,
        error,
      });
      // Return fallback estimate
      return {
        minFare: 300,
        maxFare: 400,
        eta: 15,
        distance: 5,
        currency: "KES",
        surgeMultiplier: 1,
      };
    }
  }

  private async getTrip(tripId: string): Promise<LiteTrip | null> {
    try {
      const ride = await prisma.ride.findUnique({
        where: { id: tripId },
        include: {
          driver: {
            include: {
              user: { select: { firstName: true, phone: true } },
              vehicle: {
                select: {
                  plateNumber: true,
                  make: true,
                  model: true,
                  color: true,
                },
              },
            },
          },
        },
      });

      if (!ride) return null;

      // Return lite version for low bandwidth
      return {
        id: ride.id,
        status: ride.status,
        pickupAddress: this.truncateAddress(ride.pickupAddress, 30),
        dropoffAddress: this.truncateAddress(ride.dropoffAddress, 30),
        fare: Number(ride.estimatedFare),
        currency: ride.currency,
        driverName: ride.driver?.user?.firstName || "",
        driverPhone: ride.driver?.user?.phone || "",
        vehiclePlate: ride.driver?.vehicle?.plateNumber || "",
        vehicleDescription: ride.driver?.vehicle
          ? `${ride.driver.vehicle.color} ${ride.driver.vehicle.make}`
          : "",
        driverLocation: ride.driver?.currentLatitude
          ? {
              lat: ride.driver.currentLatitude,
              lng: ride.driver.currentLongitude || 0,
            }
          : undefined,
        createdAt: ride.requestedAt.toISOString(),
        updatedAt: ride.updatedAt.toISOString(),
      };
    } catch (error) {
      logger.error("LowBandwidth: Error getting trip", { tripId, error });
      return null;
    }
  }

  private async getUserTrips(
    userId: string,
    limit: number,
  ): Promise<LiteTrip[]> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { rider: true },
      });

      if (!user?.rider) return [];

      const rides = await prisma.ride.findMany({
        where: { riderId: user.rider.id },
        orderBy: { requestedAt: "desc" },
        take: limit,
        include: {
          driver: {
            include: {
              user: { select: { firstName: true, phone: true } },
              vehicle: {
                select: { plateNumber: true, make: true, color: true },
              },
            },
          },
        },
      });

      return rides.map((ride) => ({
        id: ride.id,
        status: ride.status,
        pickupAddress: this.truncateAddress(ride.pickupAddress, 25),
        dropoffAddress: this.truncateAddress(ride.dropoffAddress, 25),
        fare: Number(ride.estimatedFare),
        currency: ride.currency,
        driverName: ride.driver?.user?.firstName || "",
        driverPhone: ride.driver?.user?.phone || "",
        vehiclePlate: ride.driver?.vehicle?.plateNumber || "",
        createdAt: ride.requestedAt.toISOString(),
        updatedAt: ride.updatedAt.toISOString(),
      }));
    } catch (error) {
      logger.error("LowBandwidth: Error getting user trips", {
        userId,
        limit,
        error,
      });
      return [];
    }
  }

  private async getTripsSinceVersion(
    userId: string,
    version: number,
    limit: number,
  ): Promise<LiteTrip[]> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { rider: true },
      });

      if (!user?.rider) return [];

      // Version is timestamp-based for delta sync
      const sinceDate = new Date(version);

      const rides = await prisma.ride.findMany({
        where: {
          riderId: user.rider.id,
          updatedAt: { gt: sinceDate },
        },
        orderBy: { updatedAt: "asc" },
        take: limit,
        include: {
          driver: {
            include: {
              user: { select: { firstName: true, phone: true } },
              vehicle: { select: { plateNumber: true } },
            },
          },
        },
      });

      return rides.map((ride) => ({
        id: ride.id,
        status: ride.status,
        pickupAddress: this.truncateAddress(ride.pickupAddress, 25),
        dropoffAddress: this.truncateAddress(ride.dropoffAddress, 25),
        fare: Number(ride.estimatedFare),
        currency: ride.currency,
        driverName: ride.driver?.user?.firstName || "",
        driverPhone: ride.driver?.user?.phone || "",
        vehiclePlate: ride.driver?.vehicle?.plateNumber || "",
        createdAt: ride.requestedAt.toISOString(),
        updatedAt: ride.updatedAt.toISOString(),
      }));
    } catch (error) {
      logger.error("LowBandwidth: Error getting trips since version", {
        userId,
        version,
        error,
      });
      return [];
    }
  }

  private async getRegionDefinition(regionId: string): Promise<{
    id: string;
    name: string;
    boundingBox: { north: number; south: number; east: number; west: number };
    center: GeoLocation;
    zoom: number;
  }> {
    try {
      // Check Redis cache first
      const cacheKey = `region:${regionId}`;
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      // Define known regions
      const regions: Record<string, any> = {
        nairobi: {
          id: "nairobi",
          name: "Nairobi",
          boundingBox: { north: -1.15, south: -1.45, east: 37.05, west: 36.65 },
          center: { lat: -1.2921, lng: 36.8219 },
          zoom: 12,
        },
        lagos: {
          id: "lagos",
          name: "Lagos",
          boundingBox: { north: 6.7, south: 6.35, east: 3.7, west: 3.1 },
          center: { lat: 6.5244, lng: 3.3792 },
          zoom: 11,
        },
        accra: {
          id: "accra",
          name: "Accra",
          boundingBox: { north: 5.75, south: 5.45, east: -0.05, west: -0.35 },
          center: { lat: 5.6037, lng: -0.187 },
          zoom: 12,
        },
        johannesburg: {
          id: "johannesburg",
          name: "Johannesburg",
          boundingBox: { north: -26, south: -26.4, east: 28.2, west: 27.8 },
          center: { lat: -26.2041, lng: 28.0473 },
          zoom: 11,
        },
        kigali: {
          id: "kigali",
          name: "Kigali",
          boundingBox: { north: -1.85, south: -2.05, east: 30.15, west: 29.95 },
          center: { lat: -1.9403, lng: 29.8739 },
          zoom: 13,
        },
      };

      const region = regions[regionId.toLowerCase()] || regions.nairobi;

      // Cache for 24 hours
      await redis.setex(cacheKey, 86400, JSON.stringify(region));

      return region;
    } catch (error) {
      logger.error("LowBandwidth: Error getting region definition", {
        regionId,
        error,
      });
      return {
        id: regionId,
        name: "Default Region",
        boundingBox: { north: -1.2, south: -1.4, east: 37, west: 36.7 },
        center: { lat: -1.3, lng: 36.85 },
        zoom: 12,
      };
    }
  }

  private async getTilesForRegion(
    region: {
      boundingBox: { north: number; south: number; east: number; west: number };
    },
    zoom: number,
    quality: string,
  ): Promise<
    Array<{
      x: number;
      y: number;
      z: number;
      url: string;
      size: number;
      hash: string;
    }>
  > {
    try {
      const tiles: Array<{
        x: number;
        y: number;
        z: number;
        url: string;
        size: number;
        hash: string;
      }> = [];

      // Calculate tile coordinates from bounding box
      const tileXMin = this.lonToTile(region.boundingBox.west, zoom);
      const tileXMax = this.lonToTile(region.boundingBox.east, zoom);
      const tileYMin = this.latToTile(region.boundingBox.north, zoom);
      const tileYMax = this.latToTile(region.boundingBox.south, zoom);

      // Limit tiles based on quality setting
      const maxTiles = this.getMaxTilesByQuality(quality);
      let tileCount = 0;

      const tileServer = process.env.TILE_SERVER_URL || "https://tiles.ubi.com";

      for (let x = tileXMin; x <= tileXMax && tileCount < maxTiles; x++) {
        for (let y = tileYMin; y <= tileYMax && tileCount < maxTiles; y++) {
          // Generate tile URL and metadata
          const tileUrl = `${tileServer}/${zoom}/${x}/${y}.${quality === "low" ? "png8" : "png"}`;
          const tileHash = `${zoom}_${x}_${y}_${quality}`;

          // Estimate tile size based on quality
          const estimatedSize = this.getEstimatedTileSize(quality);

          tiles.push({
            x,
            y,
            z: zoom,
            url: tileUrl,
            size: estimatedSize,
            hash: tileHash,
          });
          tileCount++;
        }
      }

      logger.debug("LowBandwidth: Generated tiles for region", {
        region: region.boundingBox,
        zoom,
        quality,
        tileCount: tiles.length,
      });

      return tiles;
    } catch (error) {
      logger.error("LowBandwidth: Error getting tiles for region", {
        region,
        zoom,
        quality,
        error,
      });
      return [];
    }
  }

  // Helper methods for quality-based tile settings
  private getMaxTilesByQuality(quality: QualityLevel): number {
    switch (quality) {
      case "low":
        return 20;
      case "medium":
        return 50;
      default:
        return 100;
    }
  }

  private getEstimatedTileSize(quality: QualityLevel): number {
    switch (quality) {
      case "low":
        return 8000;
      case "medium":
        return 20000;
      default:
        return 40000;
    }
  }

  // Helper methods for tile calculations
  private lonToTile(lon: number, zoom: number): number {
    return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
  }

  private latToTile(lat: number, zoom: number): number {
    return Math.floor(
      ((1 -
        Math.log(
          Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
        ) /
          Math.PI) /
        2) *
        Math.pow(2, zoom),
    );
  }

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  async compressResponse<T>(data: T): Promise<CompressedResponse<T>> {
    const compressed = await this.compress(data);
    return {
      data: data,
      compressed: true,
      originalSize: compressed.originalSize,
      compressedSize: compressed.compressedSize,
      compressionRatio: compressed.compressionRatio,
      encoding: compressed.encoding,
    };
  }

  async searchPlacesOffline(_query: string, _city: string): Promise<any[]> {
    return [];
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

export default LowBandwidthService;
