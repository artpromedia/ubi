// =============================================================================
// UBI OFFLINE & ACCESSIBILITY PLATFORM - LOW-BANDWIDTH OPTIMIZATION SERVICE
// =============================================================================
// Optimized data transfer for 2G networks and data-constrained users
// Target: 90% reduction in data usage, sub-second response times
// =============================================================================

import { EventEmitter } from "events";
import * as zlib from "zlib";
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
} from "../types/offline.types";

// =============================================================================
// COMPRESSION CONSTANTS
// =============================================================================

const COMPRESSION_THRESHOLD = 500; // Only compress if > 500 bytes
const MAX_DELTA_SIZE = 10000; // Max bytes for delta sync
const SYNC_BATCH_SIZE = 50; // Max records per sync
const CACHE_TTL_SECONDS = 300; // 5 minutes default cache

// Data budget tiers (MB per month)
const DATA_BUDGETS = {
  ultra_saver: 50,
  saver: 100,
  normal: 500,
  unlimited: Infinity,
};

// =============================================================================
// LOW-BANDWIDTH SERVICE
// =============================================================================

export class LowBandwidthService implements ILowBandwidthService {
  private eventEmitter: EventEmitter;

  // User sync states (Redis in production)
  private syncStates: Map<string, SyncState> = new Map();

  // Compressed cache
  private compressedCache: Map<
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
      return JSON.parse(response.data);
    }

    const buffer = Buffer.from(response.data, "base64");

    if (response.encoding === "gzip") {
      const decompressed = await this.gzipDecompress(buffer);
      return JSON.parse(decompressed.toString("utf8"));
    }

    if (response.encoding === "msgpack+gzip") {
      const decompressed = await this.gzipDecompress(buffer);
      return this.fromBinaryFormat(decompressed.toString("utf8"));
    }

    throw new Error(`Unknown encoding: ${response.encoding}`);
  }

  private gzipCompress(data: string | Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      zlib.gzip(data, { level: 9 }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  private gzipDecompress(data: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      zlib.gunzip(data, (err, result) => {
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
    if (!syncState) {
      syncState = await this.initializeSyncState(userId);
    }

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
        lastSyncVersion,
        batchSize
      );

      for (const change of entityChanges) {
        const changeSize = JSON.stringify(change).length;
        if (currentSize + changeSize > MAX_DELTA_SIZE) {
          break; // Stop if we exceed max payload size
        }

        changes.push(change);
        currentSize += changeSize;
      }
    }

    // Get new server version
    const newVersion = Date.now();

    // Prepare response
    const response: DeltaSyncResponse = {
      serverVersion: newVersion,
      changes,
      hasMore: changes.length >= batchSize,
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
      syncState.pendingChanges - changes.length
    );
    this.syncStates.set(userId, syncState);

    // Track data usage
    this.trackDataUsage(userId, currentSize, "download", "delta_sync");

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

  private async getEntityChanges(
    userId: string,
    entity: string,
    sinceVersion: number,
    limit: number
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
        userId,
        sinceVersion,
        limit
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

  // ===========================================================================
  // LITE API ENDPOINTS
  // ===========================================================================

  async getLiteFareEstimate(
    pickup: GeoLocation,
    dropoff: GeoLocation,
    networkType?: NetworkType
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
    networkType?: NetworkType
  ): Promise<LiteTrip | null> {
    const trip = await this.getTrip(tripId);
    if (!trip) return null;

    return this.toLiteTrip(trip);
  }

  async getLiteTrips(
    userId: string,
    limit: number = 10,
    networkType?: NetworkType
  ): Promise<LiteTrip[]> {
    const trips = await this.getUserTrips(userId, limit);
    return trips.map((trip) => this.toLiteTrip(trip));
  }

  private toLiteTrip(trip: any): LiteTrip {
    return {
      i: trip.id, // id
      s: trip.status[0].toUpperCase(), // status (first letter: S=searching, M=matched, A=arriving, P=in_progress, C=completed)
      p: {
        // pickup
        la: trip.pickup.lat,
        lo: trip.pickup.lng,
        a: this.truncateAddress(trip.pickupAddress, 30),
      },
      d: {
        // dropoff
        la: trip.dropoff.lat,
        lo: trip.dropoff.lng,
        a: this.truncateAddress(trip.dropoffAddress, 30),
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

  getImageQuality(networkType: NetworkType): "low" | "medium" | "high" {
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
    endpoint: string
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
    networkType?: NetworkType
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
    regionId: string,
    limit: number = 100
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
    etag?: string
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
    ttlSeconds: number = CACHE_TTL_SECONDS
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
      const char = data.charCodeAt(i);
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
  // EXTERNAL SERVICE STUBS
  // ===========================================================================

  private async calculateFare(
    pickup: GeoLocation,
    dropoff: GeoLocation
  ): Promise<any> {
    return {
      minFare: 300,
      maxFare: 400,
      eta: 5,
      distance: 7.2,
      currency: "KES",
      surgeMultiplier: 1,
    };
  }

  private async getTrip(tripId: string): Promise<any> {
    return null;
  }

  private async getUserTrips(userId: string, limit: number): Promise<any[]> {
    return [];
  }

  private async getTripsSinceVersion(
    userId: string,
    version: number,
    limit: number
  ): Promise<any[]> {
    return [];
  }

  private async getRegionDefinition(regionId: string): Promise<any> {
    return {
      id: regionId,
      boundingBox: { north: -1.2, south: -1.4, east: 37.0, west: 36.7 },
    };
  }

  private async getTilesForRegion(
    region: any,
    zoom: number,
    quality: string
  ): Promise<any[]> {
    return [];
  }

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

export default LowBandwidthService;
