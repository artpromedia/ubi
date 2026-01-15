// =============================================================================
// UBI AI/ML PLATFORM - DEMAND FORECASTING & DYNAMIC PRICING
// =============================================================================
// Spatial-temporal demand prediction with H3 indexing
// ML-powered surge pricing optimization
// =============================================================================

import { EventEmitter } from "events";

import {
  type DemandFactors,
  type DemandForecast,
  type DemandForecastRequest,
  type DemandForecastResponse,
  type DiscountComponent,
  FeatureEntityType,
  type GeoLocation,
  type IDemandForecastService,
  type IDynamicPricingService,
  type PriceBreakdown,
  type PriceQuote,
  type PriceQuoteRequest,
  type SupplyOptimization,
  type SupplyOptimizationRequest,
  type SupplyOptimizationResponse,
  type SurgeZoneState,
  type UpdateSurgeRequest,
} from "../../types/ml.types";

import type { FeatureStoreService } from "./feature-store.service";

// =============================================================================
// H3 UTILITIES
// =============================================================================

// Reserved for future use
// interface H3Cell {
//   index: string;
//   resolution: number;
//   center: GeoLocation;
//   neighbors: string[];
// }

// Simplified H3 utilities (in production, use h3-js library)
function latLngToH3(lat: number, lng: number, resolution: number = 7): string {
  // Simplified H3 index generation
  const latBucket = Math.floor((lat + 90) * 100);
  const lngBucket = Math.floor((lng + 180) * 100);
  return `${resolution}${latBucket.toString(16).padStart(4, "0")}${lngBucket.toString(16).padStart(4, "0")}`;
}

function h3ToLatLng(h3Index: string): GeoLocation {
  // Simplified reverse lookup
  const resolution = parseInt(h3Index[0] || "7", 10);
  const latBucket = parseInt(h3Index.substring(1, 5), 16);
  const lngBucket = parseInt(h3Index.substring(5, 9), 16);
  return {
    latitude: latBucket / 100 - 90,
    longitude: lngBucket / 100 - 180,
    h3Index,
    h3Resolution: resolution,
  };
}

function getH3Neighbors(h3Index: string): string[] {
  // Simplified neighbor calculation
  const center = h3ToLatLng(h3Index);
  const resolution = parseInt(h3Index[0] || "7", 10);
  const offsets = [
    [0.01, 0],
    [0, 0.01],
    [-0.01, 0],
    [0, -0.01],
    [0.01, 0.01],
    [-0.01, 0.01],
    [0.01, -0.01],
    [-0.01, -0.01],
  ];

  return offsets.map(([latOff, lngOff]) =>
    latLngToH3(
      center.latitude + (latOff ?? 0),
      center.longitude + (lngOff ?? 0),
      resolution,
    ),
  );
}

// =============================================================================
// DEMAND FORECASTING SERVICE
// =============================================================================

interface DemandModel {
  baselineDemand: Record<string, number[]>; // H3 -> hourly baseline
  seasonalFactors: Record<string, number>; // Day/hour -> factor
  eventImpact: Record<string, number>; // Event type -> impact multiplier
  weatherImpact: Record<string, number>; // Weather -> impact multiplier
}

export class DemandForecastService implements IDemandForecastService {
  private featureStore: FeatureStoreService;
  private eventEmitter: EventEmitter;

  // Model cache
  private demandModel: DemandModel;
  private forecastCache: Map<
    string,
    { forecast: DemandForecast; cachedAt: number }
  > = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute

  // Historical data for accuracy tracking
  private forecastAccuracy: Map<string, number[]> = new Map();

  constructor(featureStore: FeatureStoreService) {
    this.featureStore = featureStore;
    this.eventEmitter = new EventEmitter();
    this.demandModel = this.initializeDemandModel();
  }

  // ===========================================================================
  // DEMAND FORECASTING
  // ===========================================================================

  async getForecast(
    request: DemandForecastRequest,
  ): Promise<DemandForecastResponse> {
    const startTime = Date.now();
    const forecasts: DemandForecast[] = [];
    const resolution = request.h3Resolution || 7;

    for (const h3Index of request.h3Indices) {
      for (const horizon of request.forecastHorizons) {
        const forecast = await this.generateForecast(
          h3Index,
          resolution,
          horizon,
          request.includeConfidenceIntervals,
        );
        forecasts.push(forecast);
      }
    }

    return {
      forecasts,
      generatedAt: new Date(),
      modelVersion: "demand-v1.0.0",
      latencyMs: Date.now() - startTime,
    };
  }

  private async generateForecast(
    h3Index: string,
    resolution: number,
    horizonMinutes: number,
    includeConfidence?: boolean,
  ): Promise<DemandForecast> {
    // Check cache
    const cacheKey = `${h3Index}:${horizonMinutes}`;
    const cached = this.forecastCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.CACHE_TTL) {
      return cached.forecast;
    }

    const now = new Date();
    const forecastTime = new Date(now.getTime() + horizonMinutes * 60000);

    // Get location features
    const locationFeatures = await this.featureStore.getFeatures({
      entityType: FeatureEntityType.LOCATION,
      entityIds: [h3Index],
      featureNames: [
        "location_demand_current",
        "location_supply_current",
        "location_historical_demand",
        "location_traffic_level",
      ],
    });

    const features = locationFeatures.vectors[0]?.features || {};

    // Calculate base demand
    const baseDemand = this.calculateBaseDemand(h3Index, forecastTime);

    // Calculate factors
    const factors = this.calculateDemandFactors(forecastTime, features);

    // Apply factors to base demand
    let predictedDemand = baseDemand;
    predictedDemand *= factors.timeOfDay;
    predictedDemand *= factors.dayOfWeek;
    predictedDemand *= factors.isHoliday ? 1.3 : 1.0;
    predictedDemand *= factors.weather;
    predictedDemand *= 1 + factors.events * 0.5;
    predictedDemand *= 1 + factors.historicalTrend * 0.2;
    predictedDemand *= 1 + factors.recentMomentum * 0.3;

    // Predict supply based on current and historical patterns
    const currentSupply = Number(features.location_supply_current || 0);
    const predictedSupply = this.predictSupply(
      h3Index,
      forecastTime,
      currentSupply,
    );

    // Calculate confidence based on data availability and horizon
    const confidence = this.calculateConfidence(h3Index, horizonMinutes);

    // Calculate confidence intervals
    let demandLower: number | undefined;
    let demandUpper: number | undefined;

    if (includeConfidence) {
      const stdDev = predictedDemand * (1 - confidence) * 0.5;
      demandLower = Math.max(0, predictedDemand - 1.96 * stdDev);
      demandUpper = predictedDemand + 1.96 * stdDev;
    }

    const forecast: DemandForecast = {
      id: this.generateId(),
      h3Index,
      h3Resolution: resolution,
      forecastTime,
      forecastHorizon: horizonMinutes,
      predictedDemand: Math.round(predictedDemand * 10) / 10,
      predictedSupply: Math.round(predictedSupply * 10) / 10,
      demandLower,
      demandUpper,
      factors,
      modelVersion: "demand-v1.0.0",
      confidence,
    };

    // Cache forecast
    this.forecastCache.set(cacheKey, { forecast, cachedAt: Date.now() });

    return forecast;
  }

  private calculateBaseDemand(h3Index: string, forecastTime: Date): number {
    // Get baseline from model
    const hourlyBaseline = this.demandModel.baselineDemand[h3Index];
    if (hourlyBaseline) {
      const hour = forecastTime.getHours();
      return hourlyBaseline[hour] || 10;
    }

    // Default baseline based on time
    const hour = forecastTime.getHours();
    if (hour >= 7 && hour <= 9) {
      return 25;
    } // Morning rush
    if (hour >= 17 && hour <= 19) {
      return 30;
    } // Evening rush
    if (hour >= 12 && hour <= 14) {
      return 20;
    } // Lunch
    if (hour >= 0 && hour <= 5) {
      return 5;
    } // Night
    return 15;
  }

  private calculateDemandFactors(
    forecastTime: Date,
    features: Record<string, unknown>,
  ): DemandFactors {
    const hour = forecastTime.getHours();
    const dayOfWeek = forecastTime.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Time of day factor
    let timeOfDay = 1.0;
    if (hour >= 7 && hour <= 9) {
      timeOfDay = 1.4;
    } else if (hour >= 17 && hour <= 19) {
      timeOfDay = 1.5;
    } else if (hour >= 12 && hour <= 14) {
      timeOfDay = 1.2;
    } else if (hour >= 0 && hour <= 5) {
      timeOfDay = 0.3;
    } else if (hour >= 22 || hour <= 6) {
      timeOfDay = 0.5;
    }

    // Day of week factor
    let dayFactor = isWeekend ? 0.8 : 1.0;
    if (dayOfWeek === 5) {
      dayFactor = 1.2;
    } // Friday

    // Holiday factor (simplified - would use calendar API)
    const isHoliday = false;

    // Weather factor (would use weather API)
    const weatherFactor = 1.0;

    // Events factor (would use events API)
    const eventsFactor = 0;

    // Historical trend
    const historicalDemand = features.location_historical_demand as
      | number[]
      | undefined;
    let historicalTrend = 0;
    if (historicalDemand && historicalDemand.length > 0) {
      // Compare recent to historical average
      const recent = historicalDemand.slice(-7).reduce((a, b) => a + b, 0) / 7;
      const older =
        historicalDemand.slice(0, -7).reduce((a, b) => a + b, 0) /
        Math.max(1, historicalDemand.length - 7);
      historicalTrend = older > 0 ? (recent - older) / older : 0;
    }

    // Recent momentum (current demand vs expected)
    const currentDemand = Number(features.location_demand_current || 0);
    const expectedDemand = this.calculateBaseDemand("", forecastTime);
    const recentMomentum =
      expectedDemand > 0
        ? (currentDemand - expectedDemand) / expectedDemand
        : 0;

    return {
      timeOfDay,
      dayOfWeek: dayFactor,
      isHoliday,
      weather: weatherFactor,
      events: eventsFactor,
      historicalTrend: Math.max(-0.5, Math.min(0.5, historicalTrend)),
      recentMomentum: Math.max(-0.5, Math.min(0.5, recentMomentum)),
    };
  }

  private predictSupply(
    _h3Index: string,
    forecastTime: Date,
    currentSupply: number,
  ): number {
    const hour = forecastTime.getHours();

    // Supply typically follows demand patterns with lag
    let supplyFactor = 1.0;
    if (hour >= 7 && hour <= 9) {
      supplyFactor = 0.9;
    } // Drivers still joining
    else if (hour >= 17 && hour <= 19) {
      supplyFactor = 1.1;
    } // Peak driver hours
    else if (hour >= 0 && hour <= 5) {
      supplyFactor = 0.3;
    }

    return Math.max(1, currentSupply * supplyFactor);
  }

  private calculateConfidence(h3Index: string, horizonMinutes: number): number {
    // Confidence decreases with forecast horizon
    let confidence = 0.95;

    if (horizonMinutes > 15) {
      confidence -= 0.05;
    }
    if (horizonMinutes > 30) {
      confidence -= 0.05;
    }
    if (horizonMinutes > 60) {
      confidence -= 0.1;
    }
    if (horizonMinutes > 120) {
      confidence -= 0.1;
    }

    // Adjust based on historical accuracy
    const accuracy = this.forecastAccuracy.get(h3Index);
    if (accuracy && accuracy.length > 0) {
      const avgAccuracy = accuracy.reduce((a, b) => a + b, 0) / accuracy.length;
      confidence *= avgAccuracy;
    }

    return Math.max(0.5, Math.min(0.99, confidence));
  }

  // ===========================================================================
  // SUPPLY OPTIMIZATION
  // ===========================================================================

  async getSupplyOptimizations(
    request: SupplyOptimizationRequest,
  ): Promise<SupplyOptimizationResponse> {
    const startTime = Date.now();
    const optimizations: SupplyOptimization[] = [];
    let totalBudget = 0;

    for (const targetH3 of request.targetH3Indices) {
      // Get current supply/demand gap
      const forecast = await this.generateForecast(
        targetH3,
        7,
        request.optimizationHorizon,
      );
      const gap = forecast.predictedDemand - forecast.predictedSupply;

      if (gap > 2) {
        // Need more drivers
        const optimization = await this.generateOptimization(
          targetH3,
          gap,
          request.maxIncentiveBudget,
        );

        if (optimization) {
          optimizations.push(optimization);
          totalBudget += optimization.incentiveAmount || 0;

          // Check budget constraint
          if (
            request.maxIncentiveBudget &&
            totalBudget > request.maxIncentiveBudget
          ) {
            break;
          }
        }
      }
    }

    // Calculate expected improvement
    const expectedImprovement = optimizations.reduce(
      (sum, opt) => sum + opt.expectedImpact,
      0,
    );

    return {
      optimizations,
      totalBudget,
      expectedDemandFulfillmentIncrease: expectedImprovement,
      latencyMs: Date.now() - startTime,
    };
  }

  private async generateOptimization(
    targetH3: string,
    driversNeeded: number,
    maxBudget?: number,
  ): Promise<SupplyOptimization | null> {
    // Find nearby cells with surplus drivers
    const neighbors = getH3Neighbors(targetH3);
    const sourceH3Indices: string[] = [];

    for (const neighbor of neighbors) {
      const features = await this.featureStore.getFeatures({
        entityType: FeatureEntityType.LOCATION,
        entityIds: [neighbor],
        featureNames: ["location_supply_current", "location_demand_current"],
      });

      const neighborFeatures = features.vectors[0]?.features || {};
      const supply = Number(neighborFeatures.location_supply_current || 0);
      const demand = Number(neighborFeatures.location_demand_current || 0);

      if (supply > demand + 2) {
        sourceH3Indices.push(neighbor);
      }
    }

    if (sourceH3Indices.length === 0) {
      return null;
    }

    // Calculate incentive
    const urgency = Math.min(1, driversNeeded / 10);
    const baseIncentive = 200; // Base bonus in NGN
    const incentiveAmount = Math.min(
      baseIncentive * (1 + urgency),
      maxBudget || 500,
    );

    const now = new Date();

    return {
      id: this.generateId(),
      targetH3Index: targetH3,
      driversNeeded: Math.ceil(driversNeeded),
      sourceH3Indices,
      incentiveType: "bonus",
      incentiveAmount,
      expectedImpact: Math.min(driversNeeded, sourceH3Indices.length * 2),
      validFrom: now,
      validUntil: new Date(now.getTime() + 30 * 60000), // 30 minutes
    };
  }

  // ===========================================================================
  // ACCURACY TRACKING
  // ===========================================================================

  async recordActual(
    forecastId: string,
    actualDemand: number,
    actualSupply: number,
  ): Promise<void> {
    // In production, would update database and calculate accuracy
    this.eventEmitter.emit("forecast:actual", {
      forecastId,
      actualDemand,
      actualSupply,
      timestamp: new Date(),
    });
  }

  // ===========================================================================
  // MODEL INITIALIZATION
  // ===========================================================================

  private initializeDemandModel(): DemandModel {
    return {
      baselineDemand: {},
      seasonalFactors: {
        monday_morning: 1.3,
        friday_evening: 1.5,
        saturday_night: 1.4,
        sunday_afternoon: 1.1,
      },
      eventImpact: {
        concert: 2.0,
        sports_match: 1.8,
        conference: 1.3,
        holiday: 1.2,
      },
      weatherImpact: {
        rain: 1.5,
        heavy_rain: 2.0,
        clear: 1.0,
        hot: 1.1,
      },
    };
  }

  private generateId(): string {
    return `fcst_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

// =============================================================================
// DYNAMIC PRICING SERVICE
// =============================================================================

interface PricingConfig {
  baseFareNGN: number;
  perKmRateNGN: number;
  perMinuteRateNGN: number;
  bookingFeeNGN: number;
  minFareNGN: number;
  maxSurgeMultiplier: number;
  minSurgeMultiplier: number;
  surgeDecayRate: number; // How quickly surge decreases when supply improves
}

interface VehicleTypePricing {
  economy: PricingConfig;
  comfort: PricingConfig;
  premium: PricingConfig;
  suv: PricingConfig;
  keke: PricingConfig;
  bike: PricingConfig;
}

export class DynamicPricingService implements IDynamicPricingService {
  private featureStore: FeatureStoreService;
  private demandService: DemandForecastService;
  private eventEmitter: EventEmitter;

  // Surge zone cache
  private surgeZones: Map<string, SurgeZoneState> = new Map();

  // Pricing configuration by vehicle type
  private pricingConfig: VehicleTypePricing = {
    economy: {
      baseFareNGN: 300,
      perKmRateNGN: 100,
      perMinuteRateNGN: 15,
      bookingFeeNGN: 100,
      minFareNGN: 500,
      maxSurgeMultiplier: 3.0,
      minSurgeMultiplier: 1.0,
      surgeDecayRate: 0.1,
    },
    comfort: {
      baseFareNGN: 500,
      perKmRateNGN: 150,
      perMinuteRateNGN: 20,
      bookingFeeNGN: 150,
      minFareNGN: 800,
      maxSurgeMultiplier: 2.5,
      minSurgeMultiplier: 1.0,
      surgeDecayRate: 0.1,
    },
    premium: {
      baseFareNGN: 800,
      perKmRateNGN: 200,
      perMinuteRateNGN: 30,
      bookingFeeNGN: 200,
      minFareNGN: 1500,
      maxSurgeMultiplier: 2.0,
      minSurgeMultiplier: 1.0,
      surgeDecayRate: 0.15,
    },
    suv: {
      baseFareNGN: 700,
      perKmRateNGN: 180,
      perMinuteRateNGN: 25,
      bookingFeeNGN: 150,
      minFareNGN: 1200,
      maxSurgeMultiplier: 2.5,
      minSurgeMultiplier: 1.0,
      surgeDecayRate: 0.1,
    },
    keke: {
      baseFareNGN: 150,
      perKmRateNGN: 50,
      perMinuteRateNGN: 8,
      bookingFeeNGN: 50,
      minFareNGN: 200,
      maxSurgeMultiplier: 2.0,
      minSurgeMultiplier: 1.0,
      surgeDecayRate: 0.15,
    },
    bike: {
      baseFareNGN: 100,
      perKmRateNGN: 40,
      perMinuteRateNGN: 5,
      bookingFeeNGN: 0,
      minFareNGN: 150,
      maxSurgeMultiplier: 2.0,
      minSurgeMultiplier: 1.0,
      surgeDecayRate: 0.2,
    },
  };

  constructor(
    featureStore: FeatureStoreService,
    demandService: DemandForecastService,
  ) {
    this.featureStore = featureStore;
    this.demandService = demandService;
    this.eventEmitter = new EventEmitter();
  }

  // ===========================================================================
  // PRICE QUOTE GENERATION
  // ===========================================================================

  async getQuote(request: PriceQuoteRequest): Promise<PriceQuote> {
    const quoteId = this.generateId();
    const vehicleType =
      request.vehicleType.toLowerCase() as keyof VehicleTypePricing;
    const config =
      this.pricingConfig[vehicleType] || this.pricingConfig.economy;

    // Calculate route estimates
    const { distanceKm, durationMinutes } = this.calculateRouteEstimates(
      request.pickupLocation,
      request.dropoffLocation,
    );

    // Get surge for pickup location
    const pickupH3 = latLngToH3(
      request.pickupLocation.latitude,
      request.pickupLocation.longitude,
    );
    const surgeState = await this.getSurgeZone(pickupH3);

    // Calculate base prices
    const distancePrice = distanceKm * config.perKmRateNGN;
    const timePrice = durationMinutes * config.perMinuteRateNGN;
    const basePrice = config.baseFareNGN + distancePrice + timePrice;

    // Apply surge
    const surgeMultiplier = surgeState.currentMultiplier;
    const surgeAmount = basePrice * (surgeMultiplier - 1);
    const surgeReason = this.getSurgeReason(surgeState);

    // Get user discounts
    const { promotionDiscount, subscriptionDiscount } =
      await this.getUserDiscounts(request.userId, basePrice + surgeAmount);

    // Calculate final price
    let finalPrice =
      basePrice + surgeAmount - promotionDiscount - subscriptionDiscount;
    finalPrice = Math.max(finalPrice, config.minFareNGN);
    finalPrice = Math.ceil(finalPrice / 50) * 50; // Round to nearest 50

    // Build breakdown if requested
    let breakdown: PriceBreakdown | undefined;
    if (request.includeBreakdown) {
      breakdown = {
        baseFare: config.baseFareNGN,
        perKmRate: config.perKmRateNGN,
        perMinuteRate: config.perMinuteRateNGN,
        estimatedKm: distanceKm,
        estimatedMinutes: durationMinutes,
        bookingFee: config.bookingFeeNGN,
        tollEstimate: await this.estimateTolls(
          request.pickupLocation,
          request.dropoffLocation,
        ),
        surgeComponents:
          surgeMultiplier > 1
            ? [
                {
                  type: "demand_surge",
                  multiplier: surgeMultiplier,
                  amount: surgeAmount,
                  reason: surgeReason || "High demand",
                },
              ]
            : [],
        discountComponents: this.buildDiscountComponents(
          promotionDiscount,
          subscriptionDiscount,
        ),
      };
    }

    const quote: PriceQuote = {
      id: quoteId,
      basePrice,
      distancePrice,
      timePrice,
      surgeMultiplier,
      surgeAmount,
      surgeReason,
      promotionDiscount,
      subscriptionDiscount,
      finalPrice,
      currency: "NGN",
      validUntil: new Date(Date.now() + 5 * 60000), // 5 minutes
      breakdown,
      pricingModelVersion: "pricing-v1.0.0",
    };

    // Log quote for analysis
    this.logQuote(request, quote);

    return quote;
  }

  private calculateRouteEstimates(
    pickup: GeoLocation,
    dropoff: GeoLocation,
  ): { distanceKm: number; durationMinutes: number } {
    // Haversine distance
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(dropoff.latitude - pickup.latitude);
    const dLon = this.toRad(dropoff.longitude - pickup.longitude);
    const lat1 = this.toRad(pickup.latitude);
    const lat2 = this.toRad(dropoff.latitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const straightLineDistance = R * c;

    // Route distance is typically 1.3-1.5x straight line
    const distanceKm = straightLineDistance * 1.4;

    // Estimate duration based on average speed (20-30 km/h in Lagos traffic)
    const avgSpeedKmH = 25;
    const durationMinutes = (distanceKm / avgSpeedKmH) * 60;

    return {
      distanceKm: Math.round(distanceKm * 10) / 10,
      durationMinutes: Math.ceil(durationMinutes),
    };
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private async getUserDiscounts(
    userId?: string,
    _subtotal?: number,
  ): Promise<{ promotionDiscount: number; subscriptionDiscount: number }> {
    if (!userId) {
      return { promotionDiscount: 0, subscriptionDiscount: 0 };
    }

    // In production, check user's active promotions and subscriptions
    return { promotionDiscount: 0, subscriptionDiscount: 0 };
  }

  private async estimateTolls(
    _pickup: GeoLocation,
    _dropoff: GeoLocation,
  ): Promise<number> {
    // In production, check if route passes through toll roads
    return 0;
  }

  private buildDiscountComponents(
    promotionDiscount: number,
    subscriptionDiscount: number,
  ): DiscountComponent[] {
    const components: DiscountComponent[] = [];

    if (promotionDiscount > 0) {
      components.push({
        type: "promotion",
        amount: promotionDiscount,
      });
    }

    if (subscriptionDiscount > 0) {
      components.push({
        type: "subscription",
        amount: subscriptionDiscount,
      });
    }

    return components;
  }

  private getSurgeReason(surgeState: SurgeZoneState): string | undefined {
    if (surgeState.currentMultiplier <= 1.0) {
      return undefined;
    }

    const ratio =
      surgeState.currentDemand / Math.max(1, surgeState.currentSupply);

    if (ratio > 3) {
      return "Very high demand";
    }
    if (ratio > 2) {
      return "High demand in your area";
    }
    if (ratio > 1.5) {
      return "Increased demand";
    }
    return "Moderate demand increase";
  }

  // ===========================================================================
  // SURGE ZONE MANAGEMENT
  // ===========================================================================

  async getSurgeZone(h3Index: string): Promise<SurgeZoneState> {
    // Check cache
    const cached = this.surgeZones.get(h3Index);
    if (cached && Date.now() - cached.lastUpdated.getTime() < 30000) {
      return cached;
    }

    // Get current demand/supply
    const features = await this.featureStore.getFeatures({
      entityType: FeatureEntityType.LOCATION,
      entityIds: [h3Index],
      featureNames: [
        "location_demand_current",
        "location_supply_current",
        "location_surge_multiplier",
      ],
    });

    const locationFeatures = features.vectors[0]?.features || {};
    const currentDemand = Number(locationFeatures.location_demand_current || 0);
    const currentSupply = Number(locationFeatures.location_supply_current || 0);
    const existingMultiplier = Number(
      locationFeatures.location_surge_multiplier || 1.0,
    );

    // Calculate optimal surge multiplier
    const calculatedMultiplier = this.calculateSurgeMultiplier(
      currentDemand,
      currentSupply,
    );

    // Smooth transition (don't jump too quickly)
    const smoothedMultiplier = this.smoothSurgeTransition(
      existingMultiplier,
      calculatedMultiplier,
    );

    // Get forecast for trend
    const forecast = await this.demandService.getForecast({
      h3Indices: [h3Index],
      forecastHorizons: [15],
    });
    const demandForecast = forecast.forecasts[0]?.predictedDemand;
    const supplyForecast = forecast.forecasts[0]?.predictedSupply;

    // Determine trend
    let trend: "increasing" | "stable" | "decreasing" = "stable";
    if (demandForecast && demandForecast > currentDemand * 1.1) {
      trend = "increasing";
    } else if (demandForecast && demandForecast < currentDemand * 0.9) {
      trend = "decreasing";
    }

    const surgeState: SurgeZoneState = {
      h3Index,
      currentMultiplier: smoothedMultiplier,
      currentDemand,
      currentSupply,
      demandForecast,
      supplyForecast,
      maxMultiplier: 3.0,
      minMultiplier: 1.0,
      trend,
      lastUpdated: new Date(),
    };

    // Update cache
    this.surgeZones.set(h3Index, surgeState);

    // Update feature store
    await this.featureStore.setFeatureValue(
      "location_surge_multiplier",
      h3Index,
      smoothedMultiplier,
    );

    return surgeState;
  }

  async updateSurge(request: UpdateSurgeRequest): Promise<SurgeZoneState> {
    // Calculate new surge based on demand/supply
    const multiplier = this.calculateSurgeMultiplier(
      request.demand,
      request.supply,
    );

    // Get current state
    const current = this.surgeZones.get(request.h3Index);
    const smoothedMultiplier = current
      ? this.smoothSurgeTransition(current.currentMultiplier, multiplier)
      : multiplier;

    const surgeState: SurgeZoneState = {
      h3Index: request.h3Index,
      currentMultiplier: smoothedMultiplier,
      currentDemand: request.demand,
      currentSupply: request.supply,
      maxMultiplier: 3.0,
      minMultiplier: 1.0,
      trend: "stable",
      lastUpdated: new Date(),
    };

    // Update cache and feature store
    this.surgeZones.set(request.h3Index, surgeState);
    await this.featureStore.setFeatureValue(
      "location_surge_multiplier",
      request.h3Index,
      smoothedMultiplier,
    );

    this.eventEmitter.emit("surge:updated", surgeState);

    return surgeState;
  }

  private calculateSurgeMultiplier(demand: number, supply: number): number {
    if (supply === 0) {
      return demand > 0 ? 3.0 : 1.0;
    }

    const ratio = demand / supply;

    // Piecewise linear surge function
    if (ratio <= 0.5) {
      return 1.0;
    } // Oversupply - no surge
    if (ratio <= 1.0) {
      return 1.0;
    }
    if (ratio <= 1.5) {
      return 1.0 + (ratio - 1.0) * 0.4;
    } // 1.0 - 1.2x
    if (ratio <= 2.0) {
      return 1.2 + (ratio - 1.5) * 0.6;
    } // 1.2 - 1.5x
    if (ratio <= 3.0) {
      return 1.5 + (ratio - 2.0) * 0.5;
    } // 1.5 - 2.0x
    if (ratio <= 5.0) {
      return 2.0 + (ratio - 3.0) * 0.25;
    } // 2.0 - 2.5x

    return 3.0; // Cap at 3.0x
  }

  private smoothSurgeTransition(current: number, target: number): number {
    // Smooth surge changes to prevent wild fluctuations
    const maxChange = 0.2; // Max 0.2x change per update
    const diff = target - current;

    if (Math.abs(diff) <= maxChange) {
      return target;
    }

    return current + (diff > 0 ? maxChange : -maxChange);
  }

  // ===========================================================================
  // ACCEPTANCE TRACKING
  // ===========================================================================

  async recordAcceptance(quoteId: string, accepted: boolean): Promise<void> {
    this.eventEmitter.emit("quote:response", {
      quoteId,
      accepted,
      timestamp: new Date(),
    });
  }

  // ===========================================================================
  // LOGGING
  // ===========================================================================

  private logQuote(request: PriceQuoteRequest, quote: PriceQuote): void {
    this.eventEmitter.emit("quote:generated", {
      quoteId: quote.id,
      userId: request.userId,
      vehicleType: request.vehicleType,
      basePrice: quote.basePrice,
      finalPrice: quote.finalPrice,
      surgeMultiplier: quote.surgeMultiplier,
      timestamp: new Date(),
    });
  }

  private generateId(): string {
    return `quote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export { getH3Neighbors, h3ToLatLng, latLngToH3 };
