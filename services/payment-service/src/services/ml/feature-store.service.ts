// =============================================================================
// UBI AI/ML PLATFORM - FEATURE STORE SERVICE
// =============================================================================
// Centralized feature management with real-time and batch serving
// Target: Sub-10ms feature retrieval at scale
// =============================================================================

import { EventEmitter } from "events";
import {
  CreateFeatureDefinitionInput,
  FeatureDefinition,
  FeatureEntityType,
  FeatureFreshness,
  FeatureGroup,
  FeatureSource,
  FeatureValue,
  FeatureValueType,
  FeatureVector,
  GetFeaturesRequest,
  GetFeaturesResponse,
  IFeatureStoreService,
} from "../../types/ml.types";

// =============================================================================
// REDIS CLIENT INTERFACE (for real-time features)
// =============================================================================

interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<void>;
  mget(keys: string[]): Promise<(string | null)[]>;
  mset(keyValues: Record<string, string>): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hset(key: string, field: string, value: string): Promise<void>;
  hmget(key: string, fields: string[]): Promise<(string | null)[]>;
  hmset(key: string, values: Record<string, string>): Promise<void>;
  expire(key: string, seconds: number): Promise<void>;
  pipeline(): RedisPipeline;
}

interface RedisPipeline {
  get(key: string): RedisPipeline;
  set(key: string, value: string, options?: { EX?: number }): RedisPipeline;
  exec(): Promise<(string | null)[]>;
}

// =============================================================================
// FEATURE COMPUTATION CONTEXT
// =============================================================================

// Reserved for future use
// interface FeatureComputationContext {
//   entityType: FeatureEntityType;
//   entityId: string;
//   timestamp: Date;
//   dependencies: Record<string, unknown>;
// }

interface StreamFeatureUpdate {
  featureName: string;
  entityId: string;
  value: unknown;
  timestamp: Date;
  sourceEvent: string;
}

// =============================================================================
// FEATURE DEFINITIONS - Built-in UBI Features
// =============================================================================

const BUILT_IN_FEATURES: CreateFeatureDefinitionInput[] = [
  // ==========================================================================
  // USER FEATURES
  // ==========================================================================
  {
    name: "user_total_trips",
    displayName: "User Total Trips",
    description: "Total number of trips completed by user",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    computationSql: `
      SELECT user_id, COUNT(*) as value
      FROM trips
      WHERE status = 'COMPLETED'
      GROUP BY user_id
    `,
    defaultValue: 0,
  },
  {
    name: "user_trips_last_7d",
    displayName: "User Trips (7 days)",
    description: "Number of trips in the last 7 days",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    computationSql: `
      SELECT user_id, COUNT(*) as value
      FROM trips
      WHERE status = 'COMPLETED'
        AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY user_id
    `,
    defaultValue: 0,
  },
  {
    name: "user_trips_last_30d",
    displayName: "User Trips (30 days)",
    description: "Number of trips in the last 30 days",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
  },
  {
    name: "user_avg_rating_given",
    displayName: "User Average Rating Given",
    description: "Average rating given by user to drivers",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 5.0,
    minValue: 1.0,
    maxValue: 5.0,
  },
  {
    name: "user_cancellation_rate",
    displayName: "User Cancellation Rate",
    description: "Percentage of trips cancelled by user",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
    minValue: 0,
    maxValue: 1.0,
  },
  {
    name: "user_total_spend",
    displayName: "User Total Spend",
    description: "Total amount spent by user",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
  },
  {
    name: "user_avg_trip_distance",
    displayName: "User Average Trip Distance",
    description: "Average trip distance in km",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 5.0,
  },
  {
    name: "user_preferred_vehicle_type",
    displayName: "User Preferred Vehicle Type",
    description: "Most frequently used vehicle type",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.STRING,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: "economy",
  },
  {
    name: "user_days_since_last_trip",
    displayName: "Days Since Last Trip",
    description: "Number of days since user last trip",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
  },
  {
    name: "user_home_h3",
    displayName: "User Home Location (H3)",
    description: "Inferred home location H3 index",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.STRING,
    freshness: FeatureFreshness.WEEKLY,
    source: FeatureSource.BATCH,
  },
  {
    name: "user_work_h3",
    displayName: "User Work Location (H3)",
    description: "Inferred work location H3 index",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.STRING,
    freshness: FeatureFreshness.WEEKLY,
    source: FeatureSource.BATCH,
  },
  {
    name: "user_fraud_score",
    displayName: "User Fraud Score",
    description: "ML-computed fraud risk score",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    streamSource: "user.fraud.scores",
    defaultValue: 0,
    minValue: 0,
    maxValue: 1.0,
  },
  {
    name: "user_churn_probability",
    displayName: "User Churn Probability",
    description: "ML-computed churn probability",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 0.1,
    minValue: 0,
    maxValue: 1.0,
  },
  {
    name: "user_ltv_predicted",
    displayName: "User Predicted LTV",
    description: "Predicted lifetime value",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.WEEKLY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
  },
  {
    name: "user_embedding",
    displayName: "User Embedding",
    description: "User behavior embedding vector (128d)",
    entityType: FeatureEntityType.USER,
    valueType: FeatureValueType.EMBEDDING,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
  },

  // ==========================================================================
  // DRIVER FEATURES
  // ==========================================================================
  {
    name: "driver_total_trips",
    displayName: "Driver Total Trips",
    description: "Total number of trips completed",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
  },
  {
    name: "driver_trips_today",
    displayName: "Driver Trips Today",
    description: "Number of trips completed today",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    streamSource: "driver.trips.completed",
    defaultValue: 0,
  },
  {
    name: "driver_avg_rating",
    displayName: "Driver Average Rating",
    description: "Average rating received from riders",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    defaultValue: 5.0,
    minValue: 1.0,
    maxValue: 5.0,
  },
  {
    name: "driver_acceptance_rate",
    displayName: "Driver Acceptance Rate",
    description: "Rate of trip request acceptance",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    defaultValue: 0.8,
    minValue: 0,
    maxValue: 1.0,
  },
  {
    name: "driver_cancellation_rate",
    displayName: "Driver Cancellation Rate",
    description: "Rate of trip cancellations by driver",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
    minValue: 0,
    maxValue: 1.0,
  },
  {
    name: "driver_online_hours_week",
    displayName: "Driver Online Hours (Week)",
    description: "Hours online in the past week",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
  },
  {
    name: "driver_current_h3",
    displayName: "Driver Current Location (H3)",
    description: "Current H3 cell location",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.STRING,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    streamSource: "driver.location.updates",
  },
  {
    name: "driver_is_online",
    displayName: "Driver Is Online",
    description: "Whether driver is currently online",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.BOOLEAN,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    streamSource: "driver.status.updates",
    defaultValue: false,
  },
  {
    name: "driver_minutes_idle",
    displayName: "Driver Minutes Idle",
    description: "Minutes since last trip",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    defaultValue: 0,
  },
  {
    name: "driver_fraud_score",
    displayName: "Driver Fraud Score",
    description: "ML-computed fraud risk score",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    defaultValue: 0,
    minValue: 0,
    maxValue: 1.0,
  },
  {
    name: "driver_eta_accuracy",
    displayName: "Driver ETA Accuracy",
    description: "Historical ETA prediction accuracy",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 0.9,
    minValue: 0,
    maxValue: 1.0,
  },
  {
    name: "driver_embedding",
    displayName: "Driver Embedding",
    description: "Driver behavior embedding vector (128d)",
    entityType: FeatureEntityType.DRIVER,
    valueType: FeatureValueType.EMBEDDING,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
  },

  // ==========================================================================
  // RESTAURANT FEATURES
  // ==========================================================================
  {
    name: "restaurant_total_orders",
    displayName: "Restaurant Total Orders",
    description: "Total number of orders completed",
    entityType: FeatureEntityType.RESTAURANT,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
  },
  {
    name: "restaurant_orders_last_7d",
    displayName: "Restaurant Orders (7 days)",
    description: "Number of orders in the last 7 days",
    entityType: FeatureEntityType.RESTAURANT,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
  },
  {
    name: "restaurant_avg_rating",
    displayName: "Restaurant Average Rating",
    description: "Average customer rating",
    entityType: FeatureEntityType.RESTAURANT,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    defaultValue: 4.0,
    minValue: 1.0,
    maxValue: 5.0,
  },
  {
    name: "restaurant_avg_prep_time",
    displayName: "Restaurant Avg Prep Time",
    description: "Average order preparation time in minutes",
    entityType: FeatureEntityType.RESTAURANT,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    defaultValue: 20,
  },
  {
    name: "restaurant_is_open",
    displayName: "Restaurant Is Open",
    description: "Whether restaurant is currently open",
    entityType: FeatureEntityType.RESTAURANT,
    valueType: FeatureValueType.BOOLEAN,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    defaultValue: false,
  },
  {
    name: "restaurant_current_queue",
    displayName: "Restaurant Current Queue",
    description: "Number of orders in preparation",
    entityType: FeatureEntityType.RESTAURANT,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    defaultValue: 0,
  },
  {
    name: "restaurant_cuisines",
    displayName: "Restaurant Cuisines",
    description: "List of cuisine types",
    entityType: FeatureEntityType.RESTAURANT,
    valueType: FeatureValueType.JSON,
    freshness: FeatureFreshness.STATIC,
    source: FeatureSource.MANUAL,
  },
  {
    name: "restaurant_price_tier",
    displayName: "Restaurant Price Tier",
    description: "Price tier (1-4)",
    entityType: FeatureEntityType.RESTAURANT,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.STATIC,
    source: FeatureSource.MANUAL,
    defaultValue: 2,
    minValue: 1,
    maxValue: 4,
  },
  {
    name: "restaurant_popularity_score",
    displayName: "Restaurant Popularity Score",
    description: "ML-computed popularity score",
    entityType: FeatureEntityType.RESTAURANT,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 0.5,
    minValue: 0,
    maxValue: 1.0,
  },
  {
    name: "restaurant_embedding",
    displayName: "Restaurant Embedding",
    description: "Restaurant embedding vector (64d)",
    entityType: FeatureEntityType.RESTAURANT,
    valueType: FeatureValueType.EMBEDDING,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
  },

  // ==========================================================================
  // LOCATION FEATURES
  // ==========================================================================
  {
    name: "location_demand_current",
    displayName: "Location Current Demand",
    description: "Current ride requests per hour",
    entityType: FeatureEntityType.LOCATION,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    streamSource: "location.demand.updates",
    defaultValue: 0,
  },
  {
    name: "location_supply_current",
    displayName: "Location Current Supply",
    description: "Current available drivers",
    entityType: FeatureEntityType.LOCATION,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    streamSource: "location.supply.updates",
    defaultValue: 0,
  },
  {
    name: "location_surge_multiplier",
    displayName: "Location Surge Multiplier",
    description: "Current surge pricing multiplier",
    entityType: FeatureEntityType.LOCATION,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    defaultValue: 1.0,
    minValue: 1.0,
    maxValue: 5.0,
  },
  {
    name: "location_avg_wait_time",
    displayName: "Location Avg Wait Time",
    description: "Average pickup wait time in minutes",
    entityType: FeatureEntityType.LOCATION,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.HOURLY,
    source: FeatureSource.BATCH,
    defaultValue: 5,
  },
  {
    name: "location_traffic_level",
    displayName: "Location Traffic Level",
    description: "Current traffic congestion (0-1)",
    entityType: FeatureEntityType.LOCATION,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.EXTERNAL,
    defaultValue: 0.3,
    minValue: 0,
    maxValue: 1.0,
  },
  {
    name: "location_poi_count",
    displayName: "Location POI Count",
    description: "Number of points of interest nearby",
    entityType: FeatureEntityType.LOCATION,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.STATIC,
    source: FeatureSource.MANUAL,
    defaultValue: 0,
  },
  {
    name: "location_is_airport",
    displayName: "Location Is Airport",
    description: "Whether location is an airport",
    entityType: FeatureEntityType.LOCATION,
    valueType: FeatureValueType.BOOLEAN,
    freshness: FeatureFreshness.STATIC,
    source: FeatureSource.MANUAL,
    defaultValue: false,
  },
  {
    name: "location_historical_demand",
    displayName: "Location Historical Demand Pattern",
    description: "Historical demand by hour of week",
    entityType: FeatureEntityType.LOCATION,
    valueType: FeatureValueType.JSON,
    freshness: FeatureFreshness.WEEKLY,
    source: FeatureSource.BATCH,
  },

  // ==========================================================================
  // TRIP FEATURES (computed at request time)
  // ==========================================================================
  {
    name: "trip_distance_km",
    displayName: "Trip Distance (km)",
    description: "Estimated trip distance",
    entityType: FeatureEntityType.TRIP,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.REQUEST_TIME,
    defaultValue: 0,
  },
  {
    name: "trip_duration_estimate",
    displayName: "Trip Duration Estimate",
    description: "Estimated trip duration in minutes",
    entityType: FeatureEntityType.TRIP,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.REQUEST_TIME,
    defaultValue: 0,
  },
  {
    name: "trip_pickup_h3",
    displayName: "Trip Pickup H3",
    description: "Pickup location H3 index",
    entityType: FeatureEntityType.TRIP,
    valueType: FeatureValueType.STRING,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.REQUEST_TIME,
  },
  {
    name: "trip_dropoff_h3",
    displayName: "Trip Dropoff H3",
    description: "Dropoff location H3 index",
    entityType: FeatureEntityType.TRIP,
    valueType: FeatureValueType.STRING,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.REQUEST_TIME,
  },
  {
    name: "trip_hour_of_day",
    displayName: "Trip Hour of Day",
    description: "Hour when trip was requested (0-23)",
    entityType: FeatureEntityType.TRIP,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.REQUEST_TIME,
    minValue: 0,
    maxValue: 23,
  },
  {
    name: "trip_day_of_week",
    displayName: "Trip Day of Week",
    description: "Day of week (0=Monday, 6=Sunday)",
    entityType: FeatureEntityType.TRIP,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.REQUEST_TIME,
    minValue: 0,
    maxValue: 6,
  },
  {
    name: "trip_is_airport",
    displayName: "Trip Is Airport Trip",
    description: "Whether trip involves airport",
    entityType: FeatureEntityType.TRIP,
    valueType: FeatureValueType.BOOLEAN,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.REQUEST_TIME,
    defaultValue: false,
  },

  // ==========================================================================
  // PAYMENT FEATURES
  // ==========================================================================
  {
    name: "payment_method_age_days",
    displayName: "Payment Method Age (days)",
    description: "Days since payment method was added",
    entityType: FeatureEntityType.PAYMENT,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 0,
  },
  {
    name: "payment_method_success_rate",
    displayName: "Payment Method Success Rate",
    description: "Historical success rate of payment method",
    entityType: FeatureEntityType.PAYMENT,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.DAILY,
    source: FeatureSource.BATCH,
    defaultValue: 1.0,
    minValue: 0,
    maxValue: 1.0,
  },
  {
    name: "payment_velocity_24h",
    displayName: "Payment Velocity (24h)",
    description: "Number of payments in last 24 hours",
    entityType: FeatureEntityType.PAYMENT,
    valueType: FeatureValueType.INT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    defaultValue: 0,
  },
  {
    name: "payment_amount_velocity_24h",
    displayName: "Payment Amount Velocity (24h)",
    description: "Total payment amount in last 24 hours",
    entityType: FeatureEntityType.PAYMENT,
    valueType: FeatureValueType.FLOAT,
    freshness: FeatureFreshness.REALTIME,
    source: FeatureSource.STREAM,
    defaultValue: 0,
  },
];

// =============================================================================
// FEATURE STORE SERVICE IMPLEMENTATION
// =============================================================================

export class FeatureStoreService implements IFeatureStoreService {
  private redisClient: RedisClient;
  private eventEmitter: EventEmitter;
  private featureDefinitions: Map<string, FeatureDefinition> = new Map();
  private featureGroups: Map<string, FeatureGroup> = new Map();

  // Caching
  private definitionCache: Map<
    string,
    { def: FeatureDefinition; cachedAt: number }
  > = new Map();
  private readonly DEFINITION_CACHE_TTL = 60000; // 1 minute

  constructor(redisClient: RedisClient) {
    this.redisClient = redisClient;
    this.eventEmitter = new EventEmitter();
  }

  // ===========================================================================
  // FEATURE DEFINITION MANAGEMENT
  // ===========================================================================

  async createFeature(
    input: CreateFeatureDefinitionInput
  ): Promise<FeatureDefinition> {
    const existing = await this.getFeatureDefinition(input.name);
    if (existing) {
      throw new Error(`Feature ${input.name} already exists`);
    }

    const feature: FeatureDefinition = {
      id: this.generateId(),
      name: input.name,
      displayName: input.displayName,
      description: input.description,
      entityType: input.entityType,
      valueType: input.valueType,
      defaultValue: input.defaultValue,
      freshness: input.freshness,
      source: input.source,
      computationSql: input.computationSql,
      streamSource: input.streamSource,
      transformationCode: input.transformationCode,
      dependsOn: input.dependsOn || [],
      minValue: input.minValue,
      maxValue: input.maxValue,
      allowedValues: input.allowedValues || [],
      isNullable: input.isNullable ?? true,
      version: 1,
      isActive: true,
      owner: input.owner,
      tags: input.tags || [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Store in database (simulated)
    this.featureDefinitions.set(input.name, feature);

    // Store in Redis for fast lookup
    await this.redisClient.hset(
      "feature:definitions",
      input.name,
      JSON.stringify(feature)
    );

    this.eventEmitter.emit("feature:created", feature);
    return feature;
  }

  async getFeatureDefinition(name: string): Promise<FeatureDefinition | null> {
    // Check memory cache
    const cached = this.definitionCache.get(name);
    if (cached && Date.now() - cached.cachedAt < this.DEFINITION_CACHE_TTL) {
      return cached.def;
    }

    // Check in-memory map
    if (this.featureDefinitions.has(name)) {
      const def = this.featureDefinitions.get(name)!;
      this.definitionCache.set(name, { def, cachedAt: Date.now() });
      return def;
    }

    // Check Redis
    const redisData = await this.redisClient.hget("feature:definitions", name);
    if (redisData) {
      const def = JSON.parse(redisData) as FeatureDefinition;
      this.featureDefinitions.set(name, def);
      this.definitionCache.set(name, { def, cachedAt: Date.now() });
      return def;
    }

    return null;
  }

  async listFeatures(
    entityType?: FeatureEntityType
  ): Promise<FeatureDefinition[]> {
    const features = Array.from(this.featureDefinitions.values());

    if (entityType) {
      return features.filter((f) => f.entityType === entityType && f.isActive);
    }

    return features.filter((f) => f.isActive);
  }

  async deprecateFeature(name: string): Promise<void> {
    const feature = await this.getFeatureDefinition(name);
    if (!feature) {
      throw new Error(`Feature ${name} not found`);
    }

    feature.isActive = false;
    feature.deprecatedAt = new Date();
    feature.updatedAt = new Date();

    this.featureDefinitions.set(name, feature);
    await this.redisClient.hset(
      "feature:definitions",
      name,
      JSON.stringify(feature)
    );

    this.eventEmitter.emit("feature:deprecated", feature);
  }

  // ===========================================================================
  // FEATURE VALUE RETRIEVAL
  // ===========================================================================

  async getFeatures(request: GetFeaturesRequest): Promise<GetFeaturesResponse> {
    const startTime = Date.now();
    const vectors: FeatureVector[] = [];
    const missingFeatures: string[] = [];
    const staleFeatures: string[] = [];

    // Get feature definitions
    const definitions: Map<string, FeatureDefinition> = new Map();
    for (const name of request.featureNames) {
      const def = await this.getFeatureDefinition(name);
      if (!def) {
        missingFeatures.push(name);
      } else if (!def.isActive) {
        missingFeatures.push(name);
      } else {
        definitions.set(name, def);
      }
    }

    // Group features by freshness for optimal retrieval
    const realtimeFeatures: string[] = [];
    const batchFeatures: string[] = [];

    definitions.forEach((def, name) => {
      if (
        def.freshness === FeatureFreshness.REALTIME ||
        def.freshness === FeatureFreshness.NEAR_REALTIME
      ) {
        realtimeFeatures.push(name);
      } else {
        batchFeatures.push(name);
      }
    });

    // Retrieve features for each entity
    for (const entityId of request.entityIds) {
      const features: Record<string, unknown> = {};
      const featureVersions: Record<string, number> = {};
      const staleness: Record<string, number> = {};

      // Get realtime features from Redis
      if (realtimeFeatures.length > 0) {
        const realtimeValues = await this.getRealtimeFeatures(
          request.entityType,
          entityId,
          realtimeFeatures
        );

        for (const [name, value] of Object.entries(realtimeValues)) {
          if (value !== null) {
            features[name] = value.value;
            featureVersions[name] = definitions.get(name)!.version;
            staleness[name] = Math.floor(
              (Date.now() - value.computedAt.getTime()) / 1000
            );

            // Check staleness
            if (
              request.maxStalenessSeconds &&
              staleness[name] > request.maxStalenessSeconds
            ) {
              if (!request.allowStale) {
                staleFeatures.push(name);
              }
            }
          } else {
            // Use default value
            const def = definitions.get(name)!;
            features[name] = def.defaultValue;
            featureVersions[name] = def.version;
            staleness[name] = 0;
          }
        }
      }

      // Get batch features from Redis/DB
      if (batchFeatures.length > 0) {
        const batchValues = await this.getBatchFeatures(
          request.entityType,
          entityId,
          batchFeatures
        );

        for (const [name, value] of Object.entries(batchValues)) {
          if (value !== null) {
            features[name] = value.value;
            featureVersions[name] = definitions.get(name)!.version;
            staleness[name] = Math.floor(
              (Date.now() - value.computedAt.getTime()) / 1000
            );
          } else {
            const def = definitions.get(name)!;
            features[name] = def.defaultValue;
            featureVersions[name] = def.version;
            staleness[name] = 0;
          }
        }
      }

      vectors.push({
        entityType: request.entityType,
        entityId,
        features,
        metadata: {
          computedAt: new Date(),
          featureVersions,
          staleness,
        },
      });
    }

    return {
      vectors,
      missingFeatures,
      staleFeatures,
      latencyMs: Date.now() - startTime,
    };
  }

  private async getRealtimeFeatures(
    entityType: FeatureEntityType,
    entityId: string,
    featureNames: string[]
  ): Promise<Record<string, FeatureValue | null>> {
    const result: Record<string, FeatureValue | null> = {};

    // Build Redis keys
    const keys = featureNames.map(
      (name) => `feature:${entityType}:${entityId}:${name}`
    );

    // Batch get from Redis
    const values = await this.redisClient.mget(keys);

    for (let i = 0; i < featureNames.length; i++) {
      const rawValue = values[i];
      const featureName = featureNames[i];
      if (featureName && rawValue) {
        result[featureName] = JSON.parse(rawValue);
      } else if (featureName) {
        result[featureName] = null;
      }
    }

    return result;
  }

  private async getBatchFeatures(
    entityType: FeatureEntityType,
    entityId: string,
    featureNames: string[]
  ): Promise<Record<string, FeatureValue | null>> {
    // Same implementation for now - in production would query batch storage
    return this.getRealtimeFeatures(entityType, entityId, featureNames);
  }

  // ===========================================================================
  // FEATURE VALUE SETTING
  // ===========================================================================

  async setFeatureValue(
    featureId: string,
    entityId: string,
    value: unknown,
    options?: { ttl?: number; sourceEvent?: string }
  ): Promise<void> {
    const definition = await this.getFeatureDefinition(featureId);
    if (!definition) {
      throw new Error(`Feature ${featureId} not found`);
    }

    // Validate value
    this.validateFeatureValue(definition, value);

    const featureValue: FeatureValue = {
      id: this.generateId(),
      featureId,
      entityId,
      value,
      computedAt: new Date(),
      sourceEvent: options?.sourceEvent,
    };

    // Determine TTL based on freshness
    const ttl = options?.ttl ?? this.getTTLForFreshness(definition.freshness);

    // Store in Redis
    const key = `feature:${definition.entityType}:${entityId}:${featureId}`;
    await this.redisClient.set(key, JSON.stringify(featureValue), { EX: ttl });

    this.eventEmitter.emit("feature:updated", {
      featureId,
      entityId,
      value,
      timestamp: new Date(),
    });
  }

  async computeFeature(
    featureName: string,
    entityId: string
  ): Promise<FeatureValue> {
    const definition = await this.getFeatureDefinition(featureName);
    if (!definition) {
      throw new Error(`Feature ${featureName} not found`);
    }

    // Get dependencies first
    const dependencies: Record<string, unknown> = {};
    for (const depName of definition.dependsOn) {
      const depDef = await this.getFeatureDefinition(depName);
      if (depDef) {
        const depValue = await this.getFeatures({
          entityType: depDef.entityType,
          entityIds: [entityId],
          featureNames: [depName],
        });
        if (depValue.vectors.length > 0 && depValue.vectors[0]) {
          dependencies[depName] = depValue.vectors[0].features[depName];
        }
      }
    }

    // Compute based on source type
    let value: unknown;

    switch (definition.source) {
      case FeatureSource.BATCH:
        value = await this.computeBatchFeature(
          definition,
          entityId,
          dependencies
        );
        break;
      case FeatureSource.REQUEST_TIME:
        value = await this.computeRequestTimeFeature(
          definition,
          entityId,
          dependencies
        );
        break;
      case FeatureSource.EXTERNAL:
        value = await this.computeExternalFeature(definition, entityId);
        break;
      default:
        value = definition.defaultValue;
    }

    const featureValue: FeatureValue = {
      id: this.generateId(),
      featureId: definition.id,
      entityId,
      value,
      computedAt: new Date(),
    };

    // Cache the computed value
    await this.setFeatureValue(featureName, entityId, value);

    return featureValue;
  }

  private async computeBatchFeature(
    definition: FeatureDefinition,
    _entityId: string,
    _dependencies: Record<string, unknown>
  ): Promise<unknown> {
    // In production, this would execute the SQL or transformation code
    // For now, return default value
    return definition.defaultValue;
  }

  private async computeRequestTimeFeature(
    definition: FeatureDefinition,
    _entityId: string,
    _dependencies: Record<string, unknown>
  ): Promise<unknown> {
    // Compute request-time features based on current context
    const now = new Date();

    switch (definition.name) {
      case "trip_hour_of_day":
        return now.getHours();
      case "trip_day_of_week":
        return (now.getDay() + 6) % 7; // Convert to Monday=0
      default:
        return definition.defaultValue;
    }
  }

  private async computeExternalFeature(
    definition: FeatureDefinition,
    _entityId: string
  ): Promise<unknown> {
    // Call external API
    // For now, return default value
    return definition.defaultValue;
  }

  // ===========================================================================
  // FEATURE GROUPS
  // ===========================================================================

  async createFeatureGroup(
    name: string,
    featureNames: string[],
    entityType: FeatureEntityType
  ): Promise<FeatureGroup> {
    // Validate all features exist and have correct entity type
    for (const featureName of featureNames) {
      const def = await this.getFeatureDefinition(featureName);
      if (!def) {
        throw new Error(`Feature ${featureName} not found`);
      }
      if (def.entityType !== entityType) {
        throw new Error(
          `Feature ${featureName} has entity type ${def.entityType}, expected ${entityType}`
        );
      }
    }

    const group: FeatureGroup = {
      id: this.generateId(),
      name,
      entityType,
      featureNames,
      usedByModels: [],
    };

    this.featureGroups.set(name, group);

    await this.redisClient.hset("feature:groups", name, JSON.stringify(group));

    return group;
  }

  async getFeatureGroup(name: string): Promise<FeatureGroup | null> {
    if (this.featureGroups.has(name)) {
      return this.featureGroups.get(name)!;
    }

    const data = await this.redisClient.hget("feature:groups", name);
    if (data) {
      const group = JSON.parse(data) as FeatureGroup;
      this.featureGroups.set(name, group);
      return group;
    }

    return null;
  }

  // ===========================================================================
  // STREAM PROCESSING
  // ===========================================================================

  async processStreamUpdate(update: StreamFeatureUpdate): Promise<void> {
    const definition = await this.getFeatureDefinition(update.featureName);
    if (!definition) {
      console.warn(`Unknown feature: ${update.featureName}`);
      return;
    }

    // Apply transformation if defined
    let value = update.value;
    if (definition.transformationCode) {
      value = this.applyTransformation(definition.transformationCode, value);
    }

    // Validate and store
    this.validateFeatureValue(definition, value);
    await this.setFeatureValue(update.featureName, update.entityId, value, {
      sourceEvent: update.sourceEvent,
    });
  }

  private applyTransformation(_code: string, value: unknown): unknown {
    // In production, this would safely execute transformation code
    // For now, return value as-is
    return value;
  }

  // ===========================================================================
  // BATCH FEATURE COMPUTATION
  // ===========================================================================

  async runBatchComputation(
    featureNames: string[],
    entityIds?: string[]
  ): Promise<{ computed: number; failed: number; duration: number }> {
    const startTime = Date.now();
    let computed = 0;
    let failed = 0;

    for (const featureName of featureNames) {
      const definition = await this.getFeatureDefinition(featureName);
      if (!definition || definition.source !== FeatureSource.BATCH) {
        continue;
      }

      try {
        // In production, this would:
        // 1. Execute computationSql against data warehouse
        // 2. Store results in batch feature store
        // 3. Sync to Redis for serving

        if (entityIds) {
          for (const entityId of entityIds) {
            await this.computeFeature(featureName, entityId);
            computed++;
          }
        }
      } catch (error) {
        failed++;
        console.error(`Failed to compute ${featureName}:`, error);
      }
    }

    return {
      computed,
      failed,
      duration: Date.now() - startTime,
    };
  }

  // ===========================================================================
  // FEATURE SERVING FOR ML MODELS
  // ===========================================================================

  async getFeatureVectorForModel(
    _modelId: string,
    entityType: FeatureEntityType,
    entityId: string,
    featureNames: string[]
  ): Promise<number[]> {
    const response = await this.getFeatures({
      entityType,
      entityIds: [entityId],
      featureNames,
      allowStale: true,
    });

    if (response.vectors.length === 0) {
      // Return default values
      const defaults: number[] = [];
      for (const name of featureNames) {
        const def = await this.getFeatureDefinition(name);
        if (def?.valueType === FeatureValueType.EMBEDDING) {
          // Return zero vector for embeddings
          defaults.push(...new Array(128).fill(0));
        } else {
          defaults.push(Number(def?.defaultValue ?? 0));
        }
      }
      return defaults;
    }

    const vector: number[] = [];
    const features = response.vectors[0]?.features || {};

    for (const name of featureNames) {
      const def = await this.getFeatureDefinition(name);
      const value = features[name];

      if (
        def?.valueType === FeatureValueType.EMBEDDING &&
        Array.isArray(value)
      ) {
        vector.push(...value);
      } else if (def?.valueType === FeatureValueType.BOOLEAN) {
        vector.push(value ? 1 : 0);
      } else if (def?.valueType === FeatureValueType.STRING) {
        // Would need encoding lookup
        vector.push(0);
      } else {
        vector.push(Number(value ?? def?.defaultValue ?? 0));
      }
    }

    return vector;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initializeBuiltInFeatures(): Promise<void> {
    console.log("Initializing built-in features...");

    for (const featureInput of BUILT_IN_FEATURES) {
      try {
        await this.createFeature(featureInput);
      } catch (error) {
        // Feature may already exist
        console.log(
          `Feature ${featureInput.name} already exists or failed to create`
        );
      }
    }

    // Create default feature groups
    await this.createDefaultFeatureGroups();

    console.log(`Initialized ${BUILT_IN_FEATURES.length} built-in features`);
  }

  private async createDefaultFeatureGroups(): Promise<void> {
    const groups = [
      {
        name: "user_base_features",
        entityType: FeatureEntityType.USER,
        features: [
          "user_total_trips",
          "user_trips_last_7d",
          "user_trips_last_30d",
          "user_avg_rating_given",
          "user_cancellation_rate",
          "user_total_spend",
          "user_avg_trip_distance",
          "user_days_since_last_trip",
        ],
      },
      {
        name: "user_ml_features",
        entityType: FeatureEntityType.USER,
        features: [
          "user_fraud_score",
          "user_churn_probability",
          "user_ltv_predicted",
          "user_embedding",
        ],
      },
      {
        name: "driver_base_features",
        entityType: FeatureEntityType.DRIVER,
        features: [
          "driver_total_trips",
          "driver_avg_rating",
          "driver_acceptance_rate",
          "driver_cancellation_rate",
          "driver_online_hours_week",
          "driver_is_online",
        ],
      },
      {
        name: "driver_realtime_features",
        entityType: FeatureEntityType.DRIVER,
        features: [
          "driver_trips_today",
          "driver_current_h3",
          "driver_is_online",
          "driver_minutes_idle",
        ],
      },
      {
        name: "restaurant_features",
        entityType: FeatureEntityType.RESTAURANT,
        features: [
          "restaurant_total_orders",
          "restaurant_orders_last_7d",
          "restaurant_avg_rating",
          "restaurant_avg_prep_time",
          "restaurant_is_open",
          "restaurant_current_queue",
          "restaurant_price_tier",
          "restaurant_popularity_score",
        ],
      },
      {
        name: "location_features",
        entityType: FeatureEntityType.LOCATION,
        features: [
          "location_demand_current",
          "location_supply_current",
          "location_surge_multiplier",
          "location_avg_wait_time",
          "location_traffic_level",
        ],
      },
      {
        name: "fraud_detection_features",
        entityType: FeatureEntityType.USER,
        features: [
          "user_total_trips",
          "user_cancellation_rate",
          "user_fraud_score",
          "user_days_since_last_trip",
        ],
      },
      {
        name: "churn_prediction_features",
        entityType: FeatureEntityType.USER,
        features: [
          "user_total_trips",
          "user_trips_last_7d",
          "user_trips_last_30d",
          "user_days_since_last_trip",
          "user_total_spend",
          "user_avg_rating_given",
          "user_churn_probability",
        ],
      },
    ];

    for (const group of groups) {
      try {
        await this.createFeatureGroup(
          group.name,
          group.features,
          group.entityType
        );
      } catch (error) {
        // Group may already exist
      }
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private validateFeatureValue(
    definition: FeatureDefinition,
    value: unknown
  ): void {
    if (value === null || value === undefined) {
      if (!definition.isNullable) {
        throw new Error(
          `Feature ${definition.name} does not allow null values`
        );
      }
      return;
    }

    // Type validation
    switch (definition.valueType) {
      case FeatureValueType.INT:
        if (typeof value !== "number" || !Number.isInteger(value)) {
          throw new Error(`Feature ${definition.name} expects integer value`);
        }
        break;
      case FeatureValueType.FLOAT:
        if (typeof value !== "number") {
          throw new Error(`Feature ${definition.name} expects float value`);
        }
        break;
      case FeatureValueType.STRING:
        if (typeof value !== "string") {
          throw new Error(`Feature ${definition.name} expects string value`);
        }
        break;
      case FeatureValueType.BOOLEAN:
        if (typeof value !== "boolean") {
          throw new Error(`Feature ${definition.name} expects boolean value`);
        }
        break;
      case FeatureValueType.VECTOR:
      case FeatureValueType.EMBEDDING:
        if (
          !Array.isArray(value) ||
          !value.every((v) => typeof v === "number")
        ) {
          throw new Error(`Feature ${definition.name} expects numeric array`);
        }
        break;
    }

    // Range validation
    if (typeof value === "number") {
      if (definition.minValue !== undefined && value < definition.minValue) {
        throw new Error(
          `Feature ${definition.name} value ${value} below minimum ${definition.minValue}`
        );
      }
      if (definition.maxValue !== undefined && value > definition.maxValue) {
        throw new Error(
          `Feature ${definition.name} value ${value} above maximum ${definition.maxValue}`
        );
      }
    }

    // Allowed values validation
    if (definition.allowedValues.length > 0) {
      if (!definition.allowedValues.includes(String(value))) {
        throw new Error(
          `Feature ${definition.name} value ${value} not in allowed values`
        );
      }
    }
  }

  private getTTLForFreshness(freshness: FeatureFreshness): number {
    switch (freshness) {
      case FeatureFreshness.REALTIME:
        return 60; // 1 minute
      case FeatureFreshness.NEAR_REALTIME:
        return 300; // 5 minutes
      case FeatureFreshness.MINUTE:
        return 120; // 2 minutes
      case FeatureFreshness.HOURLY:
        return 7200; // 2 hours
      case FeatureFreshness.DAILY:
        return 172800; // 2 days
      case FeatureFreshness.WEEKLY:
        return 1209600; // 2 weeks
      case FeatureFreshness.STATIC:
        return 0; // No expiry
      default:
        return 3600; // 1 hour default
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // ===========================================================================
  // EVENT HANDLERS
  // ===========================================================================

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.off(event, listener);
  }
}

// =============================================================================
// FEATURE COMPUTATION SCHEDULER
// =============================================================================

export class FeatureComputationScheduler {
  private featureStore: FeatureStoreService;
  private schedules: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(featureStore: FeatureStoreService) {
    this.featureStore = featureStore;
  }

  async start(): Promise<void> {
    // Schedule hourly features
    this.scheduleComputation("hourly", 3600000, [
      "user_total_trips",
      "user_trips_last_7d",
      "user_avg_rating_given",
      "user_total_spend",
      "driver_total_trips",
      "driver_avg_rating",
      "driver_acceptance_rate",
      "restaurant_total_orders",
      "restaurant_avg_rating",
      "restaurant_avg_prep_time",
    ]);

    // Schedule daily features
    this.scheduleComputation("daily", 86400000, [
      "user_trips_last_30d",
      "user_cancellation_rate",
      "user_avg_trip_distance",
      "user_days_since_last_trip",
      "user_churn_probability",
      "driver_cancellation_rate",
      "driver_online_hours_week",
      "driver_eta_accuracy",
      "restaurant_orders_last_7d",
      "restaurant_popularity_score",
    ]);

    // Schedule weekly features
    this.scheduleComputation("weekly", 604800000, [
      "user_home_h3",
      "user_work_h3",
      "user_ltv_predicted",
      "user_embedding",
      "driver_embedding",
      "restaurant_embedding",
      "location_historical_demand",
    ]);

    console.log("Feature computation scheduler started");
  }

  private scheduleComputation(
    name: string,
    intervalMs: number,
    features: string[]
  ): void {
    const timer: ReturnType<typeof setInterval> = setInterval(async () => {
      console.log(`Running ${name} feature computation...`);
      try {
        const result = await this.featureStore.runBatchComputation(features);
        console.log(
          `${name} computation complete: ${result.computed} computed, ${result.failed} failed`
        );
      } catch (error) {
        console.error(`${name} computation failed:`, error);
      }
    }, intervalMs);

    this.schedules.set(name, timer);
  }

  stop(): void {
    for (const timer of this.schedules.values()) {
      clearInterval(timer);
    }
    this.schedules.clear();
    console.log("Feature computation scheduler stopped");
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { BUILT_IN_FEATURES };
