// =============================================================================
// UBI AI/ML PLATFORM - SERVICE INDEX
// =============================================================================
// Central export for all ML/AI services
// =============================================================================

// Feature Store
// =============================================================================
// SERVICE FACTORY
// =============================================================================

import { ChurnPredictionService } from "./churn-prediction.service";
import {
  DemandForecastService,
  DynamicPricingService,
} from "./demand-pricing.service";
import { ETAPredictionService, SupportNLPService } from "./eta-nlp.service";
import { FeatureStoreService } from "./feature-store.service";
import { FraudDetectionService } from "./fraud-detection.service";
import { ABTestingService, MLOpsService } from "./mlops.service";
import { RecommendationEngine } from "./recommendation.service";
import { redis } from "../../lib/redis";

export {
  FeatureComputationScheduler,
  FeatureStoreService,
} from "./feature-store.service";

// Recommendation Engine
export { RecommendationEngine } from "./recommendation.service";

// Demand & Pricing
export {
  DemandForecastService,
  DynamicPricingService,
  getH3Neighbors,
  h3ToLatLng,
  latLngToH3,
} from "./demand-pricing.service";

// Fraud Detection
export { FraudDetectionService } from "./fraud-detection.service";

// Churn Prediction
export { ChurnPredictionService } from "./churn-prediction.service";

// ETA & NLP
export { ETAPredictionService, SupportNLPService } from "./eta-nlp.service";

// MLOps & A/B Testing
export { ABTestingService, MLOpsService } from "./mlops.service";

export interface MLServiceConfig {
  redisUrl?: string;
  postgresUrl?: string;
  enableMetrics?: boolean;
  enableTracing?: boolean;
}

export class MLServiceFactory {
  private featureStore: FeatureStoreService;
  private recommendationService: RecommendationEngine;
  private demandService: DemandForecastService;
  private pricingService: DynamicPricingService;
  private fraudService: FraudDetectionService;
  private churnService: ChurnPredictionService;
  private etaService: ETAPredictionService;
  private nlpService: SupportNLPService;
  private mlopsService: MLOpsService;
  private abTestingService: ABTestingService;

  constructor(_config?: MLServiceConfig) {
    // Initialize core feature store first
    this.featureStore = new FeatureStoreService(redis as any);

    // Initialize dependent services
    this.recommendationService = new RecommendationEngine(this.featureStore);
    this.demandService = new DemandForecastService(this.featureStore);
    this.pricingService = new DynamicPricingService(
      this.featureStore,
      this.demandService,
    );
    this.fraudService = new FraudDetectionService(this.featureStore);
    this.churnService = new ChurnPredictionService(this.featureStore);
    this.etaService = new ETAPredictionService(this.featureStore);
    this.nlpService = new SupportNLPService();
    this.mlopsService = new MLOpsService(this.featureStore);
    this.abTestingService = new ABTestingService();
  }

  getFeatureStore(): FeatureStoreService {
    return this.featureStore;
  }

  getRecommendationService(): RecommendationEngine {
    return this.recommendationService;
  }

  getDemandForecastService(): DemandForecastService {
    return this.demandService;
  }

  getDynamicPricingService(): DynamicPricingService {
    return this.pricingService;
  }

  getFraudDetectionService(): FraudDetectionService {
    return this.fraudService;
  }

  getChurnPredictionService(): ChurnPredictionService {
    return this.churnService;
  }

  getETAPredictionService(): ETAPredictionService {
    return this.etaService;
  }

  getSupportNLPService(): SupportNLPService {
    return this.nlpService;
  }

  getMLOpsService(): MLOpsService {
    return this.mlopsService;
  }

  getABTestingService(): ABTestingService {
    return this.abTestingService;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let mlServiceInstance: MLServiceFactory | null = null;

export function getMLServices(config?: MLServiceConfig): MLServiceFactory {
  if (!mlServiceInstance) {
    mlServiceInstance = new MLServiceFactory(config);
  }
  return mlServiceInstance;
}

export function resetMLServices(): void {
  mlServiceInstance = null;
}
