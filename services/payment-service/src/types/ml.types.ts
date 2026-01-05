// =============================================================================
// UBI AI/ML PLATFORM - TYPE DEFINITIONS
// =============================================================================
// Comprehensive TypeScript types for ML infrastructure
// =============================================================================

// =============================================================================
// ENUMS
// =============================================================================

export enum FeatureEntityType {
  USER = "USER",
  DRIVER = "DRIVER",
  RESTAURANT = "RESTAURANT",
  TRIP = "TRIP",
  ORDER = "ORDER",
  LOCATION = "LOCATION",
  VEHICLE = "VEHICLE",
  PAYMENT = "PAYMENT",
}

export enum FeatureValueType {
  INT = "INT",
  FLOAT = "FLOAT",
  STRING = "STRING",
  BOOLEAN = "BOOLEAN",
  VECTOR = "VECTOR",
  EMBEDDING = "EMBEDDING",
  JSON = "JSON",
  TIMESTAMP = "TIMESTAMP",
}

export enum FeatureFreshness {
  REALTIME = "REALTIME",
  NEAR_REALTIME = "NEAR_REALTIME",
  MINUTE = "MINUTE",
  HOURLY = "HOURLY",
  DAILY = "DAILY",
  WEEKLY = "WEEKLY",
  STATIC = "STATIC",
}

export enum FeatureSource {
  STREAM = "STREAM",
  BATCH = "BATCH",
  REQUEST_TIME = "REQUEST_TIME",
  EXTERNAL = "EXTERNAL",
  MANUAL = "MANUAL",
}

export enum ModelType {
  CLASSIFICATION = "CLASSIFICATION",
  REGRESSION = "REGRESSION",
  RANKING = "RANKING",
  RECOMMENDATION = "RECOMMENDATION",
  CLUSTERING = "CLUSTERING",
  ANOMALY_DETECTION = "ANOMALY_DETECTION",
  TIME_SERIES = "TIME_SERIES",
  NLP = "NLP",
  COMPUTER_VISION = "COMPUTER_VISION",
  REINFORCEMENT_LEARNING = "REINFORCEMENT_LEARNING",
  EMBEDDING = "EMBEDDING",
}

export enum ModelFramework {
  TENSORFLOW = "TENSORFLOW",
  PYTORCH = "PYTORCH",
  SKLEARN = "SKLEARN",
  XGBOOST = "XGBOOST",
  LIGHTGBM = "LIGHTGBM",
  CATBOOST = "CATBOOST",
  ONNX = "ONNX",
  CUSTOM = "CUSTOM",
}

export enum ModelStatus {
  TRAINING = "TRAINING",
  VALIDATING = "VALIDATING",
  STAGED = "STAGED",
  DEPLOYED = "DEPLOYED",
  DEPRECATED = "DEPRECATED",
  FAILED = "FAILED",
  ARCHIVED = "ARCHIVED",
}

export enum ExperimentStatus {
  DRAFT = "DRAFT",
  RUNNING = "RUNNING",
  PAUSED = "PAUSED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

export enum ExperimentType {
  MODEL_COMPARISON = "MODEL_COMPARISON",
  FEATURE_FLAG = "FEATURE_FLAG",
  UI_TEST = "UI_TEST",
  ALGORITHM_TEST = "ALGORITHM_TEST",
  PRICING_TEST = "PRICING_TEST",
}

export enum RecommendationType {
  RESTAURANT = "RESTAURANT",
  CUISINE = "CUISINE",
  DESTINATION = "DESTINATION",
  OFFER = "OFFER",
  DRIVER = "DRIVER",
  VEHICLE_TYPE = "VEHICLE_TYPE",
  CONTENT = "CONTENT",
  SEARCH_RESULT = "SEARCH_RESULT",
}

export enum FraudRiskLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
}

export enum ChurnRiskLevel {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
}

export enum InterventionType {
  EMAIL = "EMAIL",
  SMS = "SMS",
  PUSH = "PUSH",
  CALL = "CALL",
  DISCOUNT = "DISCOUNT",
  OFFER = "OFFER",
  PERSONALIZED_CONTENT = "PERSONALIZED_CONTENT",
  IN_APP_MESSAGE = "IN_APP_MESSAGE",
  LOYALTY_BONUS = "LOYALTY_BONUS",
}

export enum FraudType {
  PAYMENT_FRAUD = "PAYMENT_FRAUD",
  ACCOUNT_TAKEOVER = "ACCOUNT_TAKEOVER",
  PROMO_ABUSE = "PROMO_ABUSE",
  COLLUSION = "COLLUSION",
  FAKE_TRIP = "FAKE_TRIP",
  IDENTITY_FRAUD = "IDENTITY_FRAUD",
  REFUND_ABUSE = "REFUND_ABUSE",
  GPS_SPOOFING = "GPS_SPOOFING",
}

export enum IntentCategory {
  TRIP_ISSUE = "TRIP_ISSUE",
  PAYMENT_ISSUE = "PAYMENT_ISSUE",
  ACCOUNT_ISSUE = "ACCOUNT_ISSUE",
  DRIVER_ISSUE = "DRIVER_ISSUE",
  FOOD_ORDER_ISSUE = "FOOD_ORDER_ISSUE",
  DELIVERY_ISSUE = "DELIVERY_ISSUE",
  PROMO_ISSUE = "PROMO_ISSUE",
  GENERAL_INQUIRY = "GENERAL_INQUIRY",
  FEEDBACK = "FEEDBACK",
  EMERGENCY = "EMERGENCY",
}

export enum AlertSeverity {
  INFO = "INFO",
  WARNING = "WARNING",
  ERROR = "ERROR",
  CRITICAL = "CRITICAL",
}

export enum AlertType {
  DATA_DRIFT = "DATA_DRIFT",
  PREDICTION_DRIFT = "PREDICTION_DRIFT",
  PERFORMANCE_DEGRADATION = "PERFORMANCE_DEGRADATION",
  LATENCY_SPIKE = "LATENCY_SPIKE",
  ERROR_RATE_SPIKE = "ERROR_RATE_SPIKE",
  FAIRNESS_VIOLATION = "FAIRNESS_VIOLATION",
  STALE_MODEL = "STALE_MODEL",
  RESOURCE_EXHAUSTION = "RESOURCE_EXHAUSTION",
}

export enum PipelineStatus {
  PENDING = "PENDING",
  RUNNING = "RUNNING",
  SUCCEEDED = "SUCCEEDED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
}

// =============================================================================
// FEATURE STORE TYPES
// =============================================================================

export interface FeatureDefinition {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  entityType: FeatureEntityType;
  valueType: FeatureValueType;
  defaultValue?: unknown;
  freshness: FeatureFreshness;
  source: FeatureSource;
  computationSql?: string;
  streamSource?: string;
  transformationCode?: string;
  dependsOn: string[];
  minValue?: number;
  maxValue?: number;
  allowedValues: string[];
  isNullable: boolean;
  version: number;
  isActive: boolean;
  deprecatedAt?: Date;
  owner?: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureValue {
  id: string;
  featureId: string;
  entityId: string;
  value: unknown;
  valueVector?: number[];
  computedAt: Date;
  expiresAt?: Date;
  confidence?: number;
  sourceEvent?: string;
}

export interface FeatureVector {
  entityType: FeatureEntityType;
  entityId: string;
  features: Record<string, unknown>;
  metadata: {
    computedAt: Date;
    featureVersions: Record<string, number>;
    staleness: Record<string, number>; // seconds since computation
  };
}

export interface FeatureGroup {
  id: string;
  name: string;
  description?: string;
  entityType: FeatureEntityType;
  featureNames: string[];
  usedByModels: string[];
}

export interface CreateFeatureDefinitionInput {
  name: string;
  displayName: string;
  description?: string;
  entityType: FeatureEntityType;
  valueType: FeatureValueType;
  defaultValue?: unknown;
  freshness: FeatureFreshness;
  source: FeatureSource;
  computationSql?: string;
  streamSource?: string;
  transformationCode?: string;
  dependsOn?: string[];
  minValue?: number;
  maxValue?: number;
  allowedValues?: string[];
  isNullable?: boolean;
  owner?: string;
  tags?: string[];
}

export interface GetFeaturesRequest {
  entityType: FeatureEntityType;
  entityIds: string[];
  featureNames: string[];
  allowStale?: boolean;
  maxStalenessSeconds?: number;
}

export interface GetFeaturesResponse {
  vectors: FeatureVector[];
  missingFeatures: string[];
  staleFeatures: string[];
  latencyMs: number;
}

// =============================================================================
// MODEL REGISTRY TYPES
// =============================================================================

export interface MLModel {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  type: ModelType;
  framework: ModelFramework;
  version: string;
  status: ModelStatus;
  featureGroupId?: string;
  inputFeatures: string[];
  outputSchema: ModelOutputSchema;
  artifactUri?: string;
  modelSize?: number;
  checksum?: string;
  trainingDataStart?: Date;
  trainingDataEnd?: Date;
  trainingSamples?: number;
  trainingDuration?: number;
  hyperparameters?: Record<string, unknown>;
  metrics?: ModelMetrics;
  validationMetrics?: ModelMetrics;
  productionMetrics?: ModelMetrics;
  servingConfig?: ServingConfig;
  resourceRequirements?: ResourceRequirements;
  trafficPercentage: number;
  isCanary: boolean;
  championModelId?: string;
  parentModelId?: string;
  trainedBy?: string;
  approvedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  deployedAt?: Date;
  retiredAt?: Date;
}

export interface ModelOutputSchema {
  type: "classification" | "regression" | "ranking" | "embedding" | "custom";
  classes?: string[];
  dimensions?: number;
  fields?: Array<{
    name: string;
    type: string;
    description?: string;
  }>;
}

export interface ModelMetrics {
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  auc?: number;
  rmse?: number;
  mae?: number;
  mape?: number;
  r2?: number;
  logloss?: number;
  ndcg?: number;
  mrr?: number;
  custom?: Record<string, number>;
}

export interface ServingConfig {
  batchSize: number;
  timeoutMs: number;
  maxConcurrency: number;
  enableCaching: boolean;
  cacheExpirySec: number;
}

export interface ResourceRequirements {
  cpuMillis: number;
  memoryMb: number;
  gpuType?: string;
  gpuCount?: number;
}

export interface CreateModelInput {
  name: string;
  displayName: string;
  description?: string;
  type: ModelType;
  framework: ModelFramework;
  version: string;
  featureGroupId?: string;
  inputFeatures: string[];
  outputSchema: ModelOutputSchema;
  hyperparameters?: Record<string, unknown>;
  trainedBy?: string;
}

export interface DeployModelInput {
  modelId: string;
  trafficPercentage: number;
  isCanary?: boolean;
  servingConfig?: ServingConfig;
  resourceRequirements?: ResourceRequirements;
}

// =============================================================================
// PREDICTION TYPES
// =============================================================================

export interface PredictionRequest {
  modelName: string;
  modelVersion?: string; // Latest if not specified
  entityType: FeatureEntityType;
  entityId: string;
  features?: Record<string, unknown>; // Override features
  context?: PredictionContext;
  experimentId?: string;
}

export interface PredictionContext {
  timestamp?: Date;
  location?: GeoLocation;
  requestSource?: string;
  metadata?: Record<string, unknown>;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
  h3Index?: string;
  h3Resolution?: number;
}

export interface PredictionResponse {
  id: string;
  modelId: string;
  modelVersion: string;
  prediction: unknown;
  confidence?: number;
  explanations?: FeatureImportance[];
  latencyMs: number;
  experimentVariant?: string;
}

export interface FeatureImportance {
  featureName: string;
  importance: number;
  contribution: number;
  baselineValue?: unknown;
  actualValue?: unknown;
}

export interface BatchPredictionRequest {
  modelName: string;
  modelVersion?: string;
  requests: Array<{
    entityId: string;
    features?: Record<string, unknown>;
  }>;
  entityType: FeatureEntityType;
}

export interface BatchPredictionResponse {
  predictions: Array<{
    entityId: string;
    prediction: unknown;
    confidence?: number;
    error?: string;
  }>;
  modelId: string;
  modelVersion: string;
  totalLatencyMs: number;
}

// =============================================================================
// A/B EXPERIMENT TYPES
// =============================================================================

export interface ABExperiment {
  id: string;
  name: string;
  description?: string;
  type: ExperimentType;
  status: ExperimentStatus;
  hypothesis?: string;
  primaryMetric: string;
  secondaryMetrics: string[];
  trafficPercentage: number;
  variants: ExperimentVariant[];
  userSegment?: UserSegment;
  geoTargeting?: GeoTargeting;
  minimumSampleSize: number;
  confidenceLevel: number;
  minimumDetectableEffect: number;
  startedAt?: Date;
  scheduledEndAt?: Date;
  endedAt?: Date;
  results?: ExperimentResults;
  winner?: string;
  conclusion?: string;
  modelId?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExperimentVariant {
  id: string;
  name: string;
  description?: string;
  trafficWeight: number;
  config: Record<string, unknown>;
  modelVersion?: string;
}

export interface UserSegment {
  userType?: string[];
  signupDateRange?: { start: Date; end: Date };
  tripCountRange?: { min: number; max: number };
  customAttributes?: Record<string, unknown>;
}

export interface GeoTargeting {
  countries?: string[];
  cities?: string[];
  h3Indices?: string[];
  excludeH3Indices?: string[];
}

export interface ExperimentResults {
  sampleSizes: Record<string, number>;
  metrics: Record<string, VariantMetrics>;
  statisticalSignificance: Record<string, number>;
  confidenceIntervals: Record<string, ConfidenceInterval>;
  winner?: string;
  improvement?: number;
}

export interface VariantMetrics {
  mean: number;
  median: number;
  stdDev: number;
  count: number;
  conversionRate?: number;
}

export interface ConfidenceInterval {
  lower: number;
  upper: number;
  level: number;
}

export interface CreateExperimentInput {
  name: string;
  description?: string;
  type: ExperimentType;
  hypothesis?: string;
  primaryMetric: string;
  secondaryMetrics?: string[];
  trafficPercentage?: number;
  variants: Omit<ExperimentVariant, "id">[];
  userSegment?: UserSegment;
  geoTargeting?: GeoTargeting;
  minimumSampleSize?: number;
  confidenceLevel?: number;
  minimumDetectableEffect?: number;
  scheduledEndAt?: Date;
  modelId?: string;
  createdBy: string;
}

export interface GetExperimentAssignmentRequest {
  experimentId: string;
  userId: string;
}

export interface ExperimentAssignment {
  experimentId: string;
  userId: string;
  variantId: string;
  variantName: string;
  config: Record<string, unknown>;
  assignedAt: Date;
}

// =============================================================================
// RECOMMENDATION TYPES
// =============================================================================

export interface RecommendationRequest {
  userId: string;
  type: RecommendationType;
  location?: GeoLocation;
  context?: RecommendationContext;
  candidateCount?: number;
  filters?: RecommendationFilters;
  excludeIds?: string[];
}

export interface RecommendationContext {
  timestamp?: Date;
  dayOfWeek?: number;
  hourOfDay?: number;
  weather?: string;
  isFirstOrder?: boolean;
  lastOrderedCuisine?: string;
  currentMood?: string;
  occasion?: string;
}

export interface RecommendationFilters {
  cuisines?: string[];
  priceRange?: { min: number; max: number };
  minRating?: number;
  maxDeliveryTime?: number;
  dietaryRestrictions?: string[];
  isOpen?: boolean;
}

export interface RecommendationResponse {
  id: string;
  recommendations: RecommendedItem[];
  modelVersion: string;
  latencyMs: number;
  diversityScore?: number;
}

export interface RecommendedItem {
  itemId: string;
  itemType: string;
  score: number;
  rank: number;
  reason?: string;
  features?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UserPreferences {
  userId: string;
  favoriteCuisines: string[];
  dietaryRestrictions: string[];
  pricePreference?: "budget" | "moderate" | "premium";
  cuisineEmbedding?: number[];
  restaurantEmbedding?: number[];
  locationEmbedding?: number[];
  orderHistory?: OrderHistoryAggregates;
  ridePatterns?: RidePatternAggregates;
  timePreferences?: TimePreferences;
}

export interface OrderHistoryAggregates {
  totalOrders: number;
  averageOrderValue: number;
  topCuisines: Array<{ cuisine: string; count: number }>;
  topRestaurants: Array<{ restaurantId: string; count: number }>;
  averageRating: number;
  lastOrderDate?: Date;
}

export interface RidePatternAggregates {
  totalRides: number;
  homeLocationH3?: string;
  workLocationH3?: string;
  frequentDestinations: Array<{ h3Index: string; count: number }>;
  averageRideDistance: number;
  preferredVehicleType?: string;
}

export interface TimePreferences {
  preferredOrderTimes: number[]; // Hours 0-23
  preferredRideTimes: number[];
  weekdayVsWeekend: { weekday: number; weekend: number };
}

// =============================================================================
// DEMAND FORECASTING TYPES
// =============================================================================

export interface DemandForecastRequest {
  h3Indices: string[];
  h3Resolution?: number;
  forecastHorizons: number[]; // Minutes: [15, 30, 60, 120]
  includeConfidenceIntervals?: boolean;
}

export interface DemandForecast {
  id: string;
  h3Index: string;
  h3Resolution: number;
  forecastTime: Date;
  forecastHorizon: number;
  predictedDemand: number;
  predictedSupply: number;
  demandLower?: number;
  demandUpper?: number;
  supplyLower?: number;
  supplyUpper?: number;
  factors?: DemandFactors;
  modelVersion: string;
  confidence: number;
}

export interface DemandFactors {
  timeOfDay: number;
  dayOfWeek: number;
  isHoliday: boolean;
  weather: number;
  events: number;
  historicalTrend: number;
  recentMomentum: number;
}

export interface DemandForecastResponse {
  forecasts: DemandForecast[];
  generatedAt: Date;
  modelVersion: string;
  latencyMs: number;
}

export interface SupplyOptimizationRequest {
  targetH3Indices: string[];
  optimizationHorizon: number; // Minutes
  maxIncentiveBudget?: number;
}

export interface SupplyOptimization {
  id: string;
  targetH3Index: string;
  driversNeeded: number;
  sourceH3Indices: string[];
  incentiveType?: "bonus" | "surge_guarantee" | "priority_dispatch";
  incentiveAmount?: number;
  expectedImpact: number;
  validFrom: Date;
  validUntil: Date;
}

export interface SupplyOptimizationResponse {
  optimizations: SupplyOptimization[];
  totalBudget: number;
  expectedDemandFulfillmentIncrease: number;
  latencyMs: number;
}

// =============================================================================
// DYNAMIC PRICING TYPES
// =============================================================================

export interface PriceQuoteRequest {
  userId?: string;
  pickupLocation: GeoLocation;
  dropoffLocation: GeoLocation;
  vehicleType: string;
  scheduledTime?: Date;
  includeBreakdown?: boolean;
}

export interface PriceQuote {
  id: string;
  basePrice: number;
  distancePrice: number;
  timePrice: number;
  surgeMultiplier: number;
  surgeAmount: number;
  surgeReason?: string;
  promotionDiscount: number;
  subscriptionDiscount: number;
  finalPrice: number;
  currency: string;
  validUntil: Date;
  breakdown?: PriceBreakdown;
  pricingModelVersion?: string;
}

export interface PriceBreakdown {
  baseFare: number;
  perKmRate: number;
  perMinuteRate: number;
  estimatedKm: number;
  estimatedMinutes: number;
  bookingFee: number;
  tollEstimate: number;
  surgeComponents: SurgeComponent[];
  discountComponents: DiscountComponent[];
}

export interface SurgeComponent {
  type: string;
  multiplier: number;
  amount: number;
  reason: string;
}

export interface DiscountComponent {
  type: string;
  code?: string;
  amount: number;
  percentage?: number;
}

export interface SurgeZoneState {
  h3Index: string;
  currentMultiplier: number;
  currentDemand: number;
  currentSupply: number;
  demandForecast?: number;
  supplyForecast?: number;
  maxMultiplier: number;
  minMultiplier: number;
  trend: "increasing" | "stable" | "decreasing";
  lastUpdated: Date;
}

export interface UpdateSurgeRequest {
  h3Index: string;
  demand: number;
  supply: number;
  externalFactors?: Record<string, number>;
}

// =============================================================================
// FRAUD DETECTION TYPES
// =============================================================================

export interface FraudScoreRequest {
  entityType: "user" | "driver" | "trip" | "transaction" | "order";
  entityId: string;
  transactionAmount?: number;
  features?: Record<string, unknown>;
  context?: FraudContext;
}

export interface FraudContext {
  ipAddress?: string;
  deviceId?: string;
  userAgent?: string;
  location?: GeoLocation;
  sessionDuration?: number;
  isNewDevice?: boolean;
  paymentMethodAge?: number;
}

export interface FraudScore {
  id: string;
  entityType: string;
  entityId: string;
  score: number;
  riskLevel: FraudRiskLevel;
  fraudTypes: FraudTypeScore[];
  topFactors: FraudFactor[];
  recommendation: "approve" | "review" | "block";
  modelVersion: string;
  latencyMs: number;
  createdAt: Date;
}

export interface FraudTypeScore {
  type: FraudType;
  score: number;
  isHighRisk: boolean;
}

export interface FraudFactor {
  name: string;
  contribution: number;
  value: unknown;
  threshold?: unknown;
  direction: "increases_risk" | "decreases_risk";
}

export interface FraudAlert {
  id: string;
  entityType: string;
  entityId: string;
  fraudScoreId: string;
  alertType: string;
  severity: AlertSeverity;
  message: string;
  suggestedActions: string[];
  createdAt: Date;
}

export interface CollusionDetectionRequest {
  driverId?: string;
  userId?: string;
  tripId?: string;
  lookbackDays?: number;
}

export interface CollusionNetwork {
  id: string;
  members: CollusionMember[];
  patternType: "ring" | "pair" | "cluster";
  connectionCount: number;
  totalTrips: number;
  totalAmount: number;
  riskScore: number;
  patterns: CollusionPattern[];
  status: "detected" | "investigating" | "confirmed" | "dismissed";
  detectedAt: Date;
}

export interface CollusionMember {
  type: "user" | "driver";
  id: string;
  role?: string;
  connectionStrength: number;
}

export interface CollusionPattern {
  type: string;
  description: string;
  evidence: Record<string, unknown>;
  confidence: number;
}

// =============================================================================
// CHURN PREDICTION TYPES
// =============================================================================

export interface ChurnPredictionRequest {
  userId: string;
  includeRecommendations?: boolean;
  includeExplanations?: boolean;
}

export interface ChurnPrediction {
  id: string;
  userId: string;
  churnProbability: number;
  riskLevel: ChurnRiskLevel;
  expectedChurnDays?: number;
  topFactors: ChurnFactor[];
  recommendedActions?: RetentionAction[];
  modelVersion: string;
  createdAt: Date;
}

export interface ChurnFactor {
  name: string;
  description: string;
  contribution: number;
  value: unknown;
  trend: "worsening" | "stable" | "improving";
  benchmark?: unknown;
}

export interface RetentionAction {
  type: string;
  description: string;
  expectedImpact: number;
  cost?: number;
  priority: number;
  config: Record<string, unknown>;
}

export interface RetentionIntervention {
  id: string;
  userId: string;
  type: InterventionType;
  priority: number;
  message: string;
  subject?: string;
  offerDetails?: {
    discountPercentage?: number;
    discountAmount?: number;
    validityDays?: number;
    minimumOrderValue?: number;
    promoCode?: string;
  };
  scheduledAt: Date;
  deliveredAt?: Date;
  openedAt?: Date;
  clickedAt?: Date;
  convertedAt?: Date;
  status: "scheduled" | "delivered" | "opened" | "clicked" | "converted" | "failed";
  campaignId?: string;
  churnPredictionId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface RetentionCampaign {
  id: string;
  name: string;
  description?: string;
  targetSegment: ChurnSegment;
  targetUserCount?: number;
  interventionType: InterventionType;
  interventionConfig: InterventionConfig;
  startDate: Date;
  endDate?: Date;
  budgetTotal?: number;
  budgetUsed: number;
  maxPerUser?: number;
  performance?: CampaignPerformance;
  isActive: boolean;
}

export interface ChurnSegment {
  riskLevels: ChurnRiskLevel[];
  minChurnProbability?: number;
  maxChurnProbability?: number;
  lastActivityDays?: number;
  customFilters?: Record<string, unknown>;
}

export interface InterventionConfig {
  offerType?: string;
  discountPercentage?: number;
  discountAmount?: number;
  validityDays?: number;
  minimumOrderValue?: number;
  messageTemplate?: string;
  channels: string[];
}

export interface CampaignPerformance {
  usersTargeted: number;
  usersReached: number;
  usersConverted: number;
  conversionRate: number;
  revenueRecovered: number;
  costPerConversion: number;
  roi: number;
}

export interface CreateRetentionCampaignInput {
  name: string;
  description?: string;
  targetSegment: ChurnSegment;
  interventionType: InterventionType;
  interventionConfig: InterventionConfig;
  startDate: Date;
  endDate?: Date;
  budgetTotal?: number;
  maxPerUser?: number;
}

// =============================================================================
// ETA PREDICTION TYPES
// =============================================================================

export interface ETAPredictionRequest {
  origin: GeoLocation;
  destination: GeoLocation;
  vehicleType?: string;
  departureTime?: Date;
  includeBreakdown?: boolean;
  includeAlternatives?: boolean;
}

export interface ETAPrediction {
  id: string;
  predictedDuration: number; // seconds
  predictedArrival: Date;
  confidence: number;
  breakdown?: ETABreakdown;
  alternatives?: ETAAlternative[];
  modelVersion: string;
  latencyMs: number;
}

export interface ETABreakdown {
  drivingTime: number;
  pickupTime: number;
  trafficDelay: number;
  weatherDelay: number;
  historicalAdjustment: number;
}

export interface ETAAlternative {
  route: string;
  duration: number;
  confidence: number;
  trafficLevel: "low" | "moderate" | "high" | "severe";
}

export interface TrafficCondition {
  h3Index: string;
  congestionLevel: number;
  averageSpeed: number;
  incidentCount: number;
  forecastedCongestion: CongestionForecast[];
  updatedAt: Date;
}

export interface CongestionForecast {
  time: Date;
  congestionLevel: number;
  confidence: number;
}

// =============================================================================
// SUPPORT NLP TYPES
// =============================================================================

export interface IntentClassificationRequest {
  messageText: string;
  language?: string;
  ticketId?: string;
  conversationHistory?: string[];
  includeSentiment?: boolean;
  includeEntities?: boolean;
}

export interface IntentClassification {
  id: string;
  intentId: string;
  intentName: string;
  category: IntentCategory;
  confidence: number;
  allIntents: Array<{
    intentId: string;
    name: string;
    confidence: number;
  }>;
  entities?: ExtractedEntity[];
  sentiment?: SentimentAnalysis;
  suggestedResponse?: string;
  autoResolved: boolean;
  suggestedQueue?: string;
  modelVersion: string;
  latencyMs: number;
}

export interface ExtractedEntity {
  type: string;
  value: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
  normalized?: string;
}

export interface SentimentAnalysis {
  sentiment: "positive" | "neutral" | "negative";
  score: number;
  magnitude: number;
  aspects?: AspectSentiment[];
}

export interface AspectSentiment {
  aspect: string;
  sentiment: "positive" | "neutral" | "negative";
  score: number;
}

export interface SupportIntent {
  id: string;
  name: string;
  category: IntentCategory;
  description?: string;
  trainingExamples: string[];
  keywords: string[];
  canAutoResolve: boolean;
  autoResolveTemplate?: string;
  defaultQueue?: string;
  priority: number;
  isActive: boolean;
}

export interface AutoResponseRequest {
  intentId: string;
  entities: ExtractedEntity[];
  userId?: string;
  language?: string;
}

export interface AutoResponse {
  response: string;
  actions?: AutoAction[];
  escalationRequired: boolean;
  confidence: number;
}

export interface AutoAction {
  type: string;
  description: string;
  params: Record<string, unknown>;
}

// =============================================================================
// MLOPS TYPES
// =============================================================================

export interface ModelAlert {
  id: string;
  modelId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  details?: Record<string, unknown>;
  metrics?: Record<string, number>;
  thresholdValue?: number;
  actualValue?: number;
  status: "open" | "acknowledged" | "resolved";
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedBy?: string;
  resolvedAt?: Date;
  resolution?: string;
  createdAt: Date;
}

export interface ModelPerformanceMetrics {
  modelId: string;
  windowStart: Date;
  windowEnd: Date;
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  auc?: number;
  rmse?: number;
  mae?: number;
  p50Latency?: number;
  p95Latency?: number;
  p99Latency?: number;
  predictionCount: number;
  errorCount: number;
  errorRate: number;
  featureDriftScore?: number;
  predictionDriftScore?: number;
  fairnessMetrics?: FairnessMetrics;
}

export interface FairnessMetrics {
  demographicParity?: Record<string, number>;
  equalizedOdds?: Record<string, number>;
  calibration?: Record<string, number>;
}

export interface DataDriftReport {
  id: string;
  modelId: string;
  referenceStart: Date;
  referenceEnd: Date;
  currentStart: Date;
  currentEnd: Date;
  overallDriftScore: number;
  driftDetected: boolean;
  featureDrift: Record<string, number>;
  psiScores?: Record<string, number>;
  ksScores?: Record<string, number>;
  recommendations?: string[];
  createdAt: Date;
}

export interface TrainingPipeline {
  id: string;
  modelName: string;
  config: TrainingConfig;
  datasetConfig: DatasetConfig;
  status: PipelineStatus;
  currentStep?: string;
  progress: number;
  startedAt?: Date;
  completedAt?: Date;
  computeType?: string;
  computeCost?: number;
  modelId?: string;
  logsUri?: string;
  errorMessage?: string;
  triggeredBy: "manual" | "scheduled" | "auto" | "drift_detected";
  createdAt: Date;
}

export interface TrainingConfig {
  algorithm: string;
  hyperparameters: Record<string, unknown>;
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  earlyStoppingPatience?: number;
  validationSplit?: number;
  crossValidationFolds?: number;
}

export interface DatasetConfig {
  featureGroupId: string;
  labelColumn: string;
  dateRangeStart: Date;
  dateRangeEnd: Date;
  filterConditions?: Record<string, unknown>;
  samplingStrategy?: "random" | "stratified" | "time_based";
  samplingRate?: number;
  balanceClasses?: boolean;
}

export interface CreateTrainingPipelineInput {
  modelName: string;
  config: TrainingConfig;
  datasetConfig: DatasetConfig;
  computeType?: string;
}

export interface RetrainingTrigger {
  modelName: string;
  triggerType:
    | "drift_threshold"
    | "performance_degradation"
    | "scheduled"
    | "data_volume";
  condition: Record<string, unknown>;
  isEnabled: boolean;
}

// =============================================================================
// SERVICE INTERFACES
// =============================================================================

export interface IFeatureStoreService {
  // Feature definitions
  createFeature(
    input: CreateFeatureDefinitionInput
  ): Promise<FeatureDefinition>;
  getFeatureDefinition(name: string): Promise<FeatureDefinition | null>;
  listFeatures(entityType?: FeatureEntityType): Promise<FeatureDefinition[]>;
  deprecateFeature(name: string): Promise<void>;

  // Feature values
  getFeatures(request: GetFeaturesRequest): Promise<GetFeaturesResponse>;
  setFeatureValue(
    featureId: string,
    entityId: string,
    value: unknown
  ): Promise<void>;
  computeFeature(featureName: string, entityId: string): Promise<FeatureValue>;

  // Feature groups
  createFeatureGroup(
    name: string,
    featureNames: string[],
    entityType: FeatureEntityType
  ): Promise<FeatureGroup>;
  getFeatureGroup(name: string): Promise<FeatureGroup | null>;
}

export interface IModelRegistryService {
  registerModel(input: CreateModelInput): Promise<MLModel>;
  getModel(name: string, version?: string): Promise<MLModel | null>;
  listModels(type?: ModelType, status?: ModelStatus): Promise<MLModel[]>;
  deployModel(input: DeployModelInput): Promise<MLModel>;
  retireModel(modelId: string): Promise<void>;
  updateModelMetrics(modelId: string, metrics: ModelMetrics): Promise<void>;
}

export interface IPredictionService {
  predict(request: PredictionRequest): Promise<PredictionResponse>;
  batchPredict(
    request: BatchPredictionRequest
  ): Promise<BatchPredictionResponse>;
  recordOutcome(predictionId: string, outcome: unknown): Promise<void>;
}

export interface IExperimentService {
  createExperiment(input: CreateExperimentInput): Promise<ABExperiment>;
  getExperiment(id: string): Promise<ABExperiment | null>;
  listExperiments(status?: ExperimentStatus): Promise<ABExperiment[]>;
  getAssignment(
    request: GetExperimentAssignmentRequest
  ): Promise<ExperimentAssignment>;
  recordMetric(
    experimentId: string,
    userId: string,
    metric: string,
    value: number
  ): Promise<void>;
  analyzeExperiment(id: string): Promise<ExperimentResults>;
  concludeExperiment(
    id: string,
    winner?: string,
    conclusion?: string
  ): Promise<ABExperiment>;
}

export interface IRecommendationService {
  getRecommendations(
    request: RecommendationRequest
  ): Promise<RecommendationResponse>;
  getUserPreferences(userId: string): Promise<UserPreferences>;
  updateUserPreferences(
    userId: string,
    preferences: Partial<UserPreferences>
  ): Promise<void>;
  recordInteraction(
    requestId: string,
    itemId: string,
    interactionType: "impression" | "click" | "conversion"
  ): Promise<void>;
}

export interface IDemandForecastService {
  getForecast(request: DemandForecastRequest): Promise<DemandForecastResponse>;
  getSupplyOptimizations(
    request: SupplyOptimizationRequest
  ): Promise<SupplyOptimizationResponse>;
  recordActual(
    forecastId: string,
    actualDemand: number,
    actualSupply: number
  ): Promise<void>;
}

export interface IDynamicPricingService {
  getQuote(request: PriceQuoteRequest): Promise<PriceQuote>;
  getSurgeZone(h3Index: string): Promise<SurgeZoneState>;
  updateSurge(request: UpdateSurgeRequest): Promise<SurgeZoneState>;
  recordAcceptance(quoteId: string, accepted: boolean): Promise<void>;
}

export interface IFraudDetectionService {
  scoreEntity(request: FraudScoreRequest): Promise<FraudScore>;
  detectCollusion(
    request: CollusionDetectionRequest
  ): Promise<CollusionNetwork[]>;
  reportFraud(
    entityType: string,
    entityId: string,
    fraudType: FraudType
  ): Promise<void>;
  updateInvestigation(
    investigationId: string,
    status: string,
    findings?: Record<string, unknown>
  ): Promise<void>;
}

export interface IChurnPredictionService {
  predictChurn(request: ChurnPredictionRequest): Promise<ChurnPrediction>;
  batchPredictChurn(userIds: string[]): Promise<ChurnPrediction[]>;
  createCampaign(
    input: CreateRetentionCampaignInput
  ): Promise<RetentionCampaign>;
  triggerIntervention(userId: string, campaignId: string): Promise<void>;
  recordOutcome(predictionId: string, churned: boolean): Promise<void>;
}

export interface IETAPredictionService {
  predictETA(request: ETAPredictionRequest): Promise<ETAPrediction>;
  getTrafficConditions(h3Indices: string[]): Promise<TrafficCondition[]>;
  recordActual(predictionId: string, actualDuration: number): Promise<void>;
}

export interface ISupportNLPService {
  classifyIntent(
    request: IntentClassificationRequest
  ): Promise<IntentClassification>;
  generateResponse(request: AutoResponseRequest): Promise<AutoResponse>;
  provideFeedback(
    classificationId: string,
    wasCorrect: boolean,
    correctedIntent?: string
  ): Promise<void>;
}

export interface IMLOpsService {
  getModelMetrics(
    modelId: string,
    startTime: Date,
    endTime: Date
  ): Promise<ModelPerformanceMetrics[]>;
  checkDrift(modelId: string): Promise<DataDriftReport>;
  createAlert(
    modelId: string,
    type: AlertType,
    severity: AlertSeverity,
    message: string
  ): Promise<ModelAlert>;
  acknowledgeAlert(alertId: string, userId: string): Promise<void>;
  resolveAlert(
    alertId: string,
    userId: string,
    resolution: string
  ): Promise<void>;
  triggerRetraining(
    modelName: string,
    reason: string
  ): Promise<TrainingPipeline>;
  getTrainingPipelineStatus(pipelineId: string): Promise<TrainingPipeline>;
}
