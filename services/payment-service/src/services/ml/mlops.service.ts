// =============================================================================
// UBI AI/ML PLATFORM - MLOps & A/B TESTING SERVICE
// =============================================================================
// Model lifecycle management, monitoring, and experimentation
// Target: 99.9% model uptime, automated drift detection, statistical significance
// =============================================================================

import { EventEmitter } from "events";
import {
  ABExperiment,
  AlertSeverity,
  AlertType,
  DataDriftReport,
  ExperimentAssignment,
  ExperimentStatus,
  ExperimentType,
  ExperimentVariant,
  MLModel,
  ModelAlert,
  ModelFramework,
  ModelPerformanceMetrics,
  ModelStatus,
  ModelType,
  PipelineStatus,
  ServingConfig,
  TrainingConfig,
  TrainingPipeline,
} from "../../types/ml.types";
import { FeatureStoreService } from "./feature-store.service";

// =============================================================================
// MLOPS SERVICE
// =============================================================================

export class MLOpsService {
  // @ts-expect-error - Reserved for future feature store integration
  private _featureStore: FeatureStoreService;
  private eventEmitter: EventEmitter;

  // Model registry (in production, use dedicated model registry)
  private models: Map<string, MLModel> = new Map();
  private deployedModels: Map<string, MLModel> = new Map();

  // Metrics storage
  private modelMetrics: Map<string, ModelPerformanceMetrics[]> = new Map();

  // Alert thresholds
  private alertThresholds = {
    latencyP99Ms: 100,
    errorRate: 0.01,
    driftScore: 0.15,
    accuracyDrop: 0.05,
  };

  constructor(featureStore: FeatureStoreService) {
    this._featureStore = featureStore;
    this.eventEmitter = new EventEmitter();
    this.initializeDefaultModels();
  }

  // ===========================================================================
  // MODEL REGISTRY
  // ===========================================================================

  async registerModel(model: Partial<MLModel>): Promise<MLModel> {
    const modelId = this.generateId("model");

    const newModel: MLModel = {
      id: modelId,
      name: model.name || "Unnamed Model",
      displayName: model.displayName || model.name || "Unnamed Model",
      type: model.type || ModelType.REGRESSION,
      version: model.version || "1.0.0",
      status: ModelStatus.TRAINING,
      framework: model.framework || ModelFramework.TENSORFLOW,
      inputFeatures: model.inputFeatures || [],
      outputSchema: model.outputSchema || { type: "regression" as const },
      hyperparameters: model.hyperparameters || {},
      metrics: model.metrics || {},
      artifactUri: model.artifactUri,
      trafficPercentage: model.trafficPercentage || 0,
      isCanary: model.isCanary || false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.models.set(modelId, newModel);
    this.eventEmitter.emit("model:registered", newModel);

    return newModel;
  }

  async updateModelStatus(modelId: string, status: ModelStatus): Promise<void> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    model.status = status;
    model.updatedAt = new Date();

    this.eventEmitter.emit("model:status_changed", { modelId, status });
  }

  async getModel(modelId: string): Promise<MLModel | undefined> {
    return this.models.get(modelId);
  }

  async listModels(type?: ModelType): Promise<MLModel[]> {
    const models = Array.from(this.models.values());
    if (type) {
      return models.filter((m) => m.type === type);
    }
    return models;
  }

  // ===========================================================================
  // MODEL DEPLOYMENT
  // ===========================================================================

  async deployModel(
    modelId: string,
    config: ServingConfig
  ): Promise<void> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    // Validate model is ready
    if (model.status !== ModelStatus.STAGED && model.status !== ModelStatus.VALIDATING) {
      throw new Error(`Model ${modelId} is not ready for deployment`);
    }

    // Update model status
    model.status = ModelStatus.DEPLOYED;
    model.servingConfig = config;
    model.deployedAt = new Date();
    model.updatedAt = new Date();

    // Add to deployed models
    this.deployedModels.set(modelId, model);

    this.eventEmitter.emit("model:deployed", { modelId, config });

    // Start monitoring
    this.startModelMonitoring(modelId);
  }

  async rollbackModel(modelId: string, targetVersion: string): Promise<void> {
    // Find model with target version
    const models = Array.from(this.models.values()).filter(
      (m) =>
        m.name === this.models.get(modelId)?.name && m.version === targetVersion
    );

    if (models.length === 0) {
      throw new Error(`No model found with version ${targetVersion}`);
    }

    const targetModel = models[0];
    if (!targetModel) {
      throw new Error(`Target model not found`);
    }

    // Undeploy current
    this.deployedModels.delete(modelId);

    // Deploy target
    if (targetModel.servingConfig) {
      await this.deployModel(targetModel.id, targetModel.servingConfig);
    }

    this.eventEmitter.emit("model:rollback", { modelId, targetVersion });
  }

  // ===========================================================================
  // MODEL MONITORING
  // ===========================================================================

  private startModelMonitoring(_modelId: string): void {
    // In production, this would set up continuous monitoring
    // For now, we'll track metrics when predictions are made
  }

  async recordPrediction(
    modelId: string,
    latencyMs: number,
    success: boolean,
    prediction?: unknown,
    actual?: unknown
  ): Promise<void> {
    const metrics = this.modelMetrics.get(modelId) || [];

    const metric: ModelPerformanceMetrics = {
      modelId,
      windowStart: new Date(),
      windowEnd: new Date(),
      p50Latency: latencyMs,
      p99Latency: latencyMs,
      errorRate: success ? 0 : 1,
      predictionCount: 1,
      errorCount: success ? 0 : 1,
    };

    // Calculate accuracy if actual provided
    if (prediction !== undefined && actual !== undefined) {
      metric.accuracy = prediction === actual ? 1 : 0;
    }

    metrics.push(metric);

    // Keep last 1000 metrics
    if (metrics.length > 1000) {
      metrics.shift();
    }

    this.modelMetrics.set(modelId, metrics);

    // Check for alerts
    await this.checkModelAlerts(modelId, metric);
  }

  async getModelMetrics(
    modelId: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<ModelPerformanceMetrics> {
    const metrics = this.modelMetrics.get(modelId) || [];

    let filteredMetrics = metrics;
    if (timeRange) {
      filteredMetrics = metrics.filter(
        (m) => m.windowStart >= timeRange.start && m.windowEnd <= timeRange.end
      );
    }

    if (filteredMetrics.length === 0) {
      return {
        modelId,
        windowStart: new Date(),
        windowEnd: new Date(),
        p50Latency: 0,
        p99Latency: 0,
        errorRate: 0,
        predictionCount: 0,
        errorCount: 0,
      };
    }

    // Aggregate metrics
    const aggregated: ModelPerformanceMetrics = {
      modelId,
      windowStart: new Date(),
      windowEnd: new Date(),
      p50Latency: this.calculatePercentile(
        filteredMetrics.map((m) => m.p50Latency || 0),
        50
      ),
      p99Latency: this.calculatePercentile(
        filteredMetrics.map((m) => m.p99Latency || 0),
        99
      ),
      errorRate:
        filteredMetrics.reduce((sum, m) => sum + m.errorRate, 0) /
        filteredMetrics.length,
      predictionCount: filteredMetrics.reduce((sum, m) => sum + m.predictionCount, 0),
      errorCount: filteredMetrics.reduce((sum, m) => sum + m.errorCount, 0),
    };

    // Calculate accuracy if available
    const withAccuracy = filteredMetrics.filter(
      (m) => m.accuracy !== undefined
    );
    if (withAccuracy.length > 0) {
      aggregated.accuracy =
        withAccuracy.reduce((sum, m) => sum + (m.accuracy || 0), 0) /
        withAccuracy.length;
    }

    return aggregated;
  }

  private calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;

    return sorted[Math.max(0, index)] ?? 0;
  }

  // ===========================================================================
  // DRIFT DETECTION
  // ===========================================================================

  async detectDrift(modelId: string): Promise<DataDriftReport> {
    const metrics = this.modelMetrics.get(modelId) || [];

    // Compare recent metrics to baseline
    const recentMetrics = metrics.slice(-100);
    const baselineMetrics = metrics.slice(0, 100);

    const driftScores: Record<string, number> = {};
    const driftingFeatures: string[] = [];

    // Check accuracy drift
    const recentAccuracy = this.calculateAverageAccuracy(recentMetrics);
    const baselineAccuracy = this.calculateAverageAccuracy(baselineMetrics);
    const accuracyDrift = Math.abs(recentAccuracy - baselineAccuracy);

    if (accuracyDrift > this.alertThresholds.accuracyDrop) {
      driftingFeatures.push("accuracy");
      driftScores["accuracy"] = accuracyDrift;
    }

    // Check latency drift
    const recentLatency = this.calculateAverageLatency(recentMetrics);
    const baselineLatency = this.calculateAverageLatency(baselineMetrics);
    const latencyDrift = (recentLatency - baselineLatency) / (baselineLatency || 1);

    if (latencyDrift > 0.2) {
      // 20% increase
      driftingFeatures.push("latency");
      driftScores["latency"] = latencyDrift;
    }

    const overallDriftScore =
      Object.values(driftScores).length > 0
        ? Object.values(driftScores).reduce((a, b) => a + b, 0) /
          Object.values(driftScores).length
        : 0;

    const report: DataDriftReport = {
      id: this.generateId("drift"),
      modelId,
      referenceStart: baselineMetrics[0]?.windowStart || new Date(),
      referenceEnd:
        baselineMetrics[baselineMetrics.length - 1]?.windowEnd || new Date(),
      currentStart: recentMetrics[0]?.windowStart || new Date(),
      currentEnd: recentMetrics[recentMetrics.length - 1]?.windowEnd || new Date(),
      overallDriftScore,
      driftDetected: overallDriftScore > this.alertThresholds.driftScore,
      featureDrift: driftScores,
      recommendations: overallDriftScore > this.alertThresholds.driftScore
        ? [`Consider retraining model due to drift in: ${driftingFeatures.join(", ")}`]
        : [],
      createdAt: new Date(),
    };

    // Emit alert if drift detected
    if (report.driftDetected) {
      await this.createAlert({
        modelId,
        severity: AlertSeverity.WARNING,
        type: AlertType.DATA_DRIFT,
        message: `Model drift detected: ${driftingFeatures.join(", ")}`,
        thresholdValue: this.alertThresholds.driftScore,
        actualValue: overallDriftScore,
      });
    }

    return report;
  }

  private calculateAverageAccuracy(metrics: ModelPerformanceMetrics[]): number {
    const withAccuracy = metrics.filter((m) => m.accuracy !== undefined);
    if (withAccuracy.length === 0) return 1;

    return (
      withAccuracy.reduce((sum, m) => sum + (m.accuracy || 0), 0) /
      withAccuracy.length
    );
  }

  private calculateAverageLatency(metrics: ModelPerformanceMetrics[]): number {
    if (metrics.length === 0) return 0;

    return metrics.reduce((sum, m) => sum + (m.p50Latency || 0), 0) / metrics.length;
  }

  // ===========================================================================
  // ALERTS
  // ===========================================================================

  private async checkModelAlerts(
    modelId: string,
    metric: ModelPerformanceMetrics
  ): Promise<void> {
    // Check latency
    if ((metric.p99Latency || 0) > this.alertThresholds.latencyP99Ms) {
      await this.createAlert({
        modelId,
        severity: AlertSeverity.WARNING,
        type: AlertType.LATENCY_SPIKE,
        message: `High latency detected: ${metric.p99Latency}ms`,
        thresholdValue: this.alertThresholds.latencyP99Ms,
        actualValue: metric.p99Latency,
      });
    }

    // Check error rate
    if (metric.errorRate > this.alertThresholds.errorRate) {
      await this.createAlert({
        modelId,
        severity: AlertSeverity.ERROR,
        type: AlertType.ERROR_RATE_SPIKE,
        message: `High error rate: ${(metric.errorRate * 100).toFixed(2)}%`,
        thresholdValue: this.alertThresholds.errorRate,
        actualValue: metric.errorRate,
      });
    }
  }

  private async createAlert(alert: Partial<ModelAlert>): Promise<ModelAlert> {
    const newAlert: ModelAlert = {
      id: this.generateId("alert"),
      modelId: alert.modelId || "unknown",
      severity: alert.severity || AlertSeverity.INFO,
      type: alert.type || AlertType.PERFORMANCE_DEGRADATION,
      message: alert.message || "Alert triggered",
      thresholdValue: alert.thresholdValue,
      actualValue: alert.actualValue,
      status: "open",
      createdAt: new Date(),
    };

    this.eventEmitter.emit("alert:created", newAlert);

    return newAlert;
  }

  // ===========================================================================
  // TRAINING PIPELINES
  // ===========================================================================

  async triggerRetraining(
    modelId: string,
    reason: string
  ): Promise<TrainingPipeline> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error(`Model ${modelId} not found`);
    }

    const config: TrainingConfig = {
      algorithm: "default",
      hyperparameters: model.hyperparameters || {},
    };

    const now = new Date();
    const pipeline: TrainingPipeline = {
      id: this.generateId("pipeline"),
      modelName: model.name,
      status: PipelineStatus.PENDING,
      triggeredBy: reason === "drift_detected" ? "drift_detected" : "manual",
      config,
      datasetConfig: {
        featureGroupId: model.featureGroupId || "default",
        labelColumn: "target",
        dateRangeStart: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        dateRangeEnd: now,
      },
      progress: 0,
      createdAt: new Date(),
    };

    this.eventEmitter.emit("pipeline:triggered", pipeline);

    return pipeline;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  private initializeDefaultModels(): void {
    // Register default ML models
    const defaultModels: Partial<MLModel>[] = [
      {
        name: "fraud-detection",
        type: ModelType.CLASSIFICATION,
        version: "1.0.0",
        framework: ModelFramework.XGBOOST,
        inputFeatures: ["payment_velocity", "device_fingerprint", "location_risk"],
        outputSchema: { type: "classification" as const, classes: ["fraud", "legitimate"] },
      },
      {
        name: "demand-forecast",
        type: ModelType.REGRESSION,
        version: "1.0.0",
        framework: ModelFramework.TENSORFLOW,
        inputFeatures: ["h3_index", "hour", "day_of_week", "weather"],
        outputSchema: { type: "regression" as const },
      },
      {
        name: "eta-prediction",
        type: ModelType.REGRESSION,
        version: "1.0.0",
        framework: ModelFramework.LIGHTGBM,
        inputFeatures: ["distance", "traffic", "time_of_day"],
        outputSchema: { type: "regression" as const },
      },
      {
        name: "churn-prediction",
        type: ModelType.CLASSIFICATION,
        version: "1.0.0",
        framework: ModelFramework.XGBOOST,
        inputFeatures: ["last_activity", "frequency", "satisfaction"],
        outputSchema: { type: "classification" as const, classes: ["low", "medium", "high"] },
      },
      {
        name: "recommendation",
        type: ModelType.RANKING,
        version: "1.0.0",
        framework: ModelFramework.TENSORFLOW,
        inputFeatures: ["user_id", "context"],
        outputSchema: { type: "ranking" as const },
      },
    ];

    for (const model of defaultModels) {
      this.registerModel({
        ...model,
        status: ModelStatus.DEPLOYED,
      });
    }
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

// =============================================================================
// A/B TESTING SERVICE
// =============================================================================

export class ABTestingService {
  private eventEmitter: EventEmitter;

  // Experiment registry
  private experiments: Map<string, ABExperiment> = new Map();

  // User assignments
  private assignments: Map<string, Map<string, ExperimentAssignment>> =
    new Map();

  // Statistical parameters
  private readonly DEFAULT_CONFIDENCE = 0.95;
  private readonly MIN_SAMPLE_SIZE = 100;

  constructor() {
    this.eventEmitter = new EventEmitter();
  }

  // ===========================================================================
  // EXPERIMENT MANAGEMENT
  // ===========================================================================

  async createExperiment(
    experiment: Partial<ABExperiment>
  ): Promise<ABExperiment> {
    const experimentId = this.generateId("exp");

    const newExperiment: ABExperiment = {
      id: experimentId,
      name: experiment.name || "Unnamed Experiment",
      description: experiment.description,
      type: experiment.type || ExperimentType.MODEL_COMPARISON,
      status: ExperimentStatus.DRAFT,
      variants: experiment.variants || [
        { id: "control", name: "Control", trafficWeight: 50, config: {} },
        { id: "treatment", name: "Treatment", trafficWeight: 50, config: {} },
      ],
      primaryMetric: experiment.primaryMetric || "conversion_rate",
      secondaryMetrics: experiment.secondaryMetrics || [],
      trafficPercentage: experiment.trafficPercentage || 100,
      startedAt: experiment.startedAt,
      endedAt: experiment.endedAt,
      minimumSampleSize: experiment.minimumSampleSize || 1000,
      confidenceLevel: experiment.confidenceLevel || 0.95,
      minimumDetectableEffect: experiment.minimumDetectableEffect || 0.05,
      createdBy: experiment.createdBy || "system",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.experiments.set(experimentId, newExperiment);
    this.eventEmitter.emit("experiment:created", newExperiment);

    return newExperiment;
  }

  async startExperiment(experimentId: string): Promise<void> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    experiment.status = ExperimentStatus.RUNNING;
    experiment.startedAt = new Date();
    experiment.updatedAt = new Date();

    this.eventEmitter.emit("experiment:started", { experimentId });
  }

  async stopExperiment(experimentId: string): Promise<void> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    experiment.status = ExperimentStatus.PAUSED;
    experiment.endedAt = new Date();
    experiment.updatedAt = new Date();

    this.eventEmitter.emit("experiment:stopped", { experimentId });
  }

  async getExperiment(experimentId: string): Promise<ABExperiment | undefined> {
    return this.experiments.get(experimentId);
  }

  async listExperiments(status?: ExperimentStatus): Promise<ABExperiment[]> {
    const experiments = Array.from(this.experiments.values());
    if (status) {
      return experiments.filter((e) => e.status === status);
    }
    return experiments;
  }

  // ===========================================================================
  // USER ASSIGNMENT
  // ===========================================================================

  async assignUser(
    experimentId: string,
    userId: string,
    _context?: Record<string, unknown>
  ): Promise<ExperimentAssignment> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    if (experiment.status !== ExperimentStatus.RUNNING) {
      throw new Error(`Experiment ${experimentId} is not running`);
    }

    // Check existing assignment
    const userAssignments = this.assignments.get(userId) || new Map();
    const existingAssignment = userAssignments.get(experimentId);

    if (existingAssignment) {
      return existingAssignment;
    }

    // Check traffic allocation
    if (Math.random() * 100 > experiment.trafficPercentage) {
      // User not in experiment - return control
      const controlVariant = experiment.variants.find(v => v.id === "control") || experiment.variants[0];
      if (!controlVariant) {
        throw new Error("No control variant found");
      }
      const assignment: ExperimentAssignment = {
        experimentId,
        userId,
        variantId: controlVariant.id,
        variantName: controlVariant.name,
        config: controlVariant.config,
        assignedAt: new Date(),
      };
      return assignment;
    }

    // Assign to variant based on weights
    const variant = this.selectVariant(experiment.variants);

    const assignment: ExperimentAssignment = {
      experimentId,
      userId,
      variantId: variant.id,
      variantName: variant.name,
      config: variant.config,
      assignedAt: new Date(),
    };

    // Store assignment
    userAssignments.set(experimentId, assignment);
    this.assignments.set(userId, userAssignments);

    this.eventEmitter.emit("experiment:assignment", assignment);

    return assignment;
  }

  private selectVariant(variants: ExperimentVariant[]): ExperimentVariant {
    const totalWeight = variants.reduce((sum, v) => sum + v.trafficWeight, 0);
    let random = Math.random() * totalWeight;

    for (const variant of variants) {
      random -= variant.trafficWeight;
      if (random <= 0) {
        return variant;
      }
    }

    const fallback = variants[0];
    if (!fallback) {
      throw new Error("No variants available");
    }
    return fallback;
  }

  async getUserVariant(
    experimentId: string,
    userId: string
  ): Promise<string | undefined> {
    const userAssignments = this.assignments.get(userId);
    if (!userAssignments) return undefined;

    const assignment = userAssignments.get(experimentId);
    if (!assignment) return undefined;

    return assignment.variantId;
  }

  // ===========================================================================
  // EVENT TRACKING
  // ===========================================================================

  async trackEvent(
    experimentId: string,
    userId: string,
    metricName: string,
    value: number
  ): Promise<void> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) return;

    const userAssignments = this.assignments.get(userId);
    if (!userAssignments) return;

    const assignment = userAssignments.get(experimentId);
    if (!assignment) return;

    // Store event for analysis
    this.eventEmitter.emit("experiment:event", {
      experimentId,
      userId,
      variantId: assignment.variantId,
      metricName,
      value,
      timestamp: new Date(),
    });
  }

  // ===========================================================================
  // STATISTICAL ANALYSIS
  // ===========================================================================

  async analyzeExperiment(experimentId: string): Promise<{
    variants: Array<{
      id: string;
      sampleSize: number;
      mean: number;
      standardError: number;
    }>;
    winner?: string;
    confidence: number;
    isSignificant: boolean;
    minimumDetectableEffect: number;
    powerAnalysis: number;
  }> {
    const experiment = this.experiments.get(experimentId);
    if (!experiment) {
      throw new Error(`Experiment ${experimentId} not found`);
    }

    // In production, aggregate real metrics from event store
    // For now, return placeholder analysis
    const sampleSize = experiment.minimumSampleSize || 100;
    const variants = experiment.variants.map((v: ExperimentVariant) => ({
      id: v.id,
      sampleSize: Math.floor(
        sampleSize / experiment.variants.length
      ),
      mean: Math.random() * 0.1 + 0.05, // Placeholder conversion rate
      standardError: 0.01,
    }));

    // Calculate statistical significance
    const { isSignificant, confidence, winner } =
      this.calculateSignificance(variants);

    return {
      variants,
      winner: isSignificant ? winner : undefined,
      confidence,
      isSignificant,
      minimumDetectableEffect: 0.02,
      powerAnalysis: 0.8,
    };
  }

  private calculateSignificance(
    variants: Array<{
      id: string;
      sampleSize: number;
      mean: number;
      standardError: number;
    }>
  ): { isSignificant: boolean; confidence: number; winner?: string } {
    if (variants.length < 2) {
      return { isSignificant: false, confidence: 0 };
    }

    // Simple two-sample z-test
    const control = variants.find((v) => v.id === "control") || variants[0];
    const treatment = variants.find((v) => v.id !== "control") || variants[1];

    // Check minimum sample size
    if (
      !control ||
      !treatment ||
      control.sampleSize < this.MIN_SAMPLE_SIZE ||
      treatment.sampleSize < this.MIN_SAMPLE_SIZE
    ) {
      return { isSignificant: false, confidence: 0.5 };
    }

    // Calculate z-score
    const pooledSE = Math.sqrt(
      Math.pow(control.standardError, 2) + Math.pow(treatment.standardError, 2)
    );

    if (pooledSE === 0) {
      return { isSignificant: false, confidence: 0.5 };
    }

    const zScore = (treatment.mean - control.mean) / pooledSE;

    // Calculate confidence (two-tailed)
    const confidence = this.zScoreToConfidence(Math.abs(zScore));

    // Determine winner
    const isSignificant = confidence >= this.DEFAULT_CONFIDENCE;
    const winner = isSignificant
      ? treatment.mean > control.mean
        ? treatment.id
        : control.id
      : undefined;

    return { isSignificant, confidence, winner };
  }

  private zScoreToConfidence(zScore: number): number {
    // Approximate p-value to confidence
    // Using standard normal CDF approximation
    const p = 1 - 0.5 * Math.exp(-0.717 * zScore - 0.416 * zScore * zScore);
    return 1 - 2 * (1 - p); // Two-tailed
  }

  // ===========================================================================
  // FEATURE FLAGS
  // ===========================================================================

  async isFeatureEnabled(
    featureKey: string,
    userId: string,
    defaultValue: boolean = false
  ): Promise<boolean> {
    // Check if feature is part of an experiment
    const experiments = Array.from(this.experiments.values()).filter(
      (e) =>
        e.status === ExperimentStatus.RUNNING &&
        e.name.toLowerCase() === featureKey.toLowerCase()
    );

    if (experiments.length > 0) {
      const exp = experiments[0];
      if (exp) {
        const assignment = await this.assignUser(exp.id, userId);
        return assignment.variantId === "treatment";
      }
    }

    return defaultValue;
  }

  async getFeatureVariant(
    featureKey: string,
    userId: string,
    defaultVariant: string = "control"
  ): Promise<string> {
    const experiments = Array.from(this.experiments.values()).filter(
      (e) =>
        e.status === ExperimentStatus.RUNNING &&
        e.name.toLowerCase() === featureKey.toLowerCase()
    );

    if (experiments.length > 0) {
      const exp = experiments[0];
      if (exp) {
        const variant = await this.getUserVariant(exp.id, userId);
        return variant || defaultVariant;
      }
    }

    return defaultVariant;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default { MLOpsService, ABTestingService };
