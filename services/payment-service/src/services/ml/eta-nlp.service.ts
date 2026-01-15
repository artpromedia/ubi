// =============================================================================
// UBI AI/ML PLATFORM - ETA PREDICTION SERVICE
// =============================================================================
// ML-enhanced ETA with traffic, weather, and contextual factors
// Target: 90% accuracy within 2-minute window, <100ms latency
// =============================================================================

import { EventEmitter } from "events";

import {
  type ETAPrediction,
  type ETAPredictionRequest,
  FeatureEntityType,
  type GeoLocation,
  type TrafficCondition,
} from "../../types/ml.types";

import type { FeatureStoreService } from "./feature-store.service";

// =============================================================================
// ETA MODELS
// =============================================================================

interface ETAComponent {
  type: "travel" | "traffic" | "wait" | "weather" | "pickup";
  durationSeconds: number;
  confidence: number;
}

interface IETAPredictionService {
  predictETA(request: ETAPredictionRequest): Promise<ETAPrediction>;
  updateTrafficConditions(
    h3Index: string,
    condition: TrafficCondition,
  ): Promise<void>;
}

interface TrafficData {
  segmentId: string;
  speedMultiplier: number;
  congestionLevel: "free" | "light" | "moderate" | "heavy" | "severe";
  incidents: string[];
  lastUpdated: Date;
}

interface WeatherConditions {
  condition: "clear" | "rain" | "heavy_rain" | "fog" | "storm";
  speedImpact: number; // multiplier
  visibility: number; // km
}

// =============================================================================
// ETA PREDICTION SERVICE
// =============================================================================

export class ETAPredictionService implements IETAPredictionService {
  private featureStore: FeatureStoreService;
  private eventEmitter: EventEmitter;

  // Traffic data cache
  private trafficCache: Map<string, TrafficData> = new Map();
  private weatherCache: WeatherConditions = {
    condition: "clear",
    speedImpact: 1.0,
    visibility: 10,
  };

  // Time of day factors
  private readonly TIME_FACTORS: Record<string, number> = {
    night: 1.2, // 22:00-05:00
    morning_rush: 0.5, // 07:00-09:00
    midday: 0.9, // 11:00-14:00
    evening_rush: 0.4, // 17:00-20:00
    normal: 0.8, // other times
  };

  // Weather impact factors
  private readonly WEATHER_FACTORS: Record<string, number> = {
    clear: 1.0,
    rain: 0.7,
    heavy_rain: 0.5,
    fog: 0.6,
    storm: 0.3,
  };

  constructor(featureStore: FeatureStoreService) {
    this.featureStore = featureStore;
    this.eventEmitter = new EventEmitter();
  }

  // ===========================================================================
  // ETA PREDICTION
  // ===========================================================================

  async predictETA(request: ETAPredictionRequest): Promise<ETAPrediction> {
    const startTime = Date.now();
    const predictionId = this.generateId();

    // Calculate route distance
    const distanceKm = this.calculateDistance(
      request.origin,
      request.destination,
    );

    // Get base speed for route
    const baseSpeed = this.estimateAverageSpeed(
      request.origin,
      request.destination,
    );

    // Calculate ETA components
    const components = await this.calculateETAComponents(
      request,
      distanceKm,
      baseSpeed,
    );

    // Sum all components
    const totalSeconds = components.reduce(
      (sum, c) => sum + c.durationSeconds,
      0,
    );

    // Calculate confidence based on data quality
    const confidence = this.calculateConfidence(components, request);

    const prediction: ETAPrediction = {
      id: predictionId,
      predictedDuration: Math.round(totalSeconds),
      predictedArrival: new Date(Date.now() + totalSeconds * 1000),
      confidence,
      breakdown: {
        drivingTime: Math.round(
          components.find((c) => c.type === "travel")?.durationSeconds || 0,
        ),
        pickupTime: Math.round(
          components.find((c) => c.type === "pickup")?.durationSeconds || 0,
        ),
        trafficDelay: Math.round(
          components.find((c) => c.type === "traffic")?.durationSeconds || 0,
        ),
        weatherDelay: Math.round(
          components.find((c) => c.type === "weather")?.durationSeconds || 0,
        ),
        historicalAdjustment: 0,
      },
      modelVersion: "eta-v1.0.0",
      latencyMs: Date.now() - startTime,
    };

    this.eventEmitter.emit("eta:predicted", prediction);

    return prediction;
  }

  private async calculateETAComponents(
    request: ETAPredictionRequest,
    distanceKm: number,
    baseSpeed: number,
  ): Promise<ETAComponent[]> {
    const components: ETAComponent[] = [];

    // 1. Base travel time
    const baseTravelSeconds = (distanceKm / baseSpeed) * 3600;
    components.push({
      type: "travel",
      durationSeconds: baseTravelSeconds,
      confidence: 0.9,
    });

    // 2. Traffic delay
    const trafficMultiplier = await this.getTrafficMultiplier(
      request.origin,
      request.destination,
    );
    const trafficDelay = baseTravelSeconds * (1 - trafficMultiplier);
    if (trafficDelay > 0) {
      components.push({
        type: "traffic",
        durationSeconds: trafficDelay,
        confidence: 0.7,
      });
    }

    // 3. Time of day adjustment
    const timeOfDay = this.getTimeOfDay();
    const timeFactor = this.TIME_FACTORS[timeOfDay] || 0.8;
    const timeAdjustment = baseTravelSeconds * (1 / timeFactor - 1);
    if (Math.abs(timeAdjustment) > 60) {
      components.push({
        type: "wait",
        durationSeconds: Math.max(0, timeAdjustment),
        confidence: 0.8,
      });
    }

    // 4. Weather impact
    const weatherFactor =
      this.WEATHER_FACTORS[this.weatherCache.condition] || 1.0;
    const weatherDelay = baseTravelSeconds * (1 / weatherFactor - 1);
    if (weatherDelay > 60) {
      components.push({
        type: "weather",
        durationSeconds: weatherDelay,
        confidence: 0.6,
      });
    }

    // 5. Pickup time (for ride requests)
    if (request.vehicleType) {
      const pickupTime = await this.estimatePickupTime(
        request.origin,
        request.vehicleType,
      );
      if (pickupTime > 0) {
        components.push({
          type: "pickup",
          durationSeconds: pickupTime,
          confidence: 0.75,
        });
      }
    }

    return components;
  }

  // ===========================================================================
  // TRAFFIC ANALYSIS
  // ===========================================================================

  private async getTrafficMultiplier(
    _origin: GeoLocation,
    _destination: GeoLocation,
  ): Promise<number> {
    // In production, query real-time traffic data
    const timeOfDay = this.getTimeOfDay();

    // Base multipliers for Lagos traffic
    const baseMultipliers: Record<string, number> = {
      night: 1.0,
      morning_rush: 0.4,
      midday: 0.7,
      evening_rush: 0.35,
      normal: 0.75,
    };

    return baseMultipliers[timeOfDay] || 0.7;
  }

  async updateTrafficConditions(
    h3Index: string,
    condition: TrafficCondition,
  ): Promise<void> {
    this.trafficCache.set(h3Index, {
      segmentId: h3Index,
      speedMultiplier: this.conditionToMultiplier(condition),
      congestionLevel: this.getCongestionLevelName(condition.congestionLevel),
      incidents: [],
      lastUpdated: new Date(),
    });

    this.eventEmitter.emit("traffic:updated", { h3Index, condition });
  }

  private getCongestionLevelName(
    level: number,
  ): "free" | "light" | "moderate" | "heavy" | "severe" {
    if (level < 0.2) {
      return "free";
    }
    if (level < 0.4) {
      return "light";
    }
    if (level < 0.6) {
      return "moderate";
    }
    if (level < 0.8) {
      return "heavy";
    }
    return "severe";
  }

  private conditionToMultiplier(condition: TrafficCondition): number {
    const congestionLevel = condition.congestionLevel;
    if (congestionLevel < 0.2) {
      return 1.0;
    }
    if (congestionLevel < 0.4) {
      return 0.85;
    }
    if (congestionLevel < 0.6) {
      return 0.65;
    }
    if (congestionLevel < 0.8) {
      return 0.4;
    }
    return 0.2;
  }

  // ===========================================================================
  // WEATHER
  // ===========================================================================

  updateWeatherConditions(weather: WeatherConditions): void {
    this.weatherCache = weather;
    this.eventEmitter.emit("weather:updated", weather);
  }

  // ===========================================================================
  // PICKUP TIME
  // ===========================================================================

  private async estimatePickupTime(
    location: GeoLocation,
    vehicleType: string,
  ): Promise<number> {
    // Get nearby driver density
    const locationFeatures = await this.featureStore.getFeatures({
      entityType: FeatureEntityType.LOCATION,
      entityIds: [`${location.latitude}_${location.longitude}`],
      featureNames: ["location_driver_density", "location_avg_pickup_time"],
    });

    const features = locationFeatures.vectors[0]?.features || {};
    const avgPickupTime = Number(features.location_avg_pickup_time || 300); // 5 min default

    // Adjust for vehicle type availability
    const vehicleMultipliers: Record<string, number> = {
      economy: 1.0,
      comfort: 1.3,
      premium: 1.8,
      suv: 1.5,
      keke: 0.8,
      bike: 0.6,
    };

    return avgPickupTime * (vehicleMultipliers[vehicleType] || 1.0);
  }

  // ===========================================================================
  // LIVE UPDATES
  // ===========================================================================

  async updateLiveETA(
    _tripId: string,
    currentLocation: GeoLocation,
    destination: GeoLocation,
  ): Promise<ETAPrediction> {
    return this.predictETA({
      origin: currentLocation,
      destination,
    });
  }

  // ===========================================================================
  // UTILITY FUNCTIONS
  // ===========================================================================

  private calculateDistance(
    origin: GeoLocation,
    destination: GeoLocation,
  ): number {
    // Haversine formula
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(destination.latitude - origin.latitude);
    const dLng = this.toRad(destination.longitude - origin.longitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(origin.latitude)) *
        Math.cos(this.toRad(destination.latitude)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // Apply route factor (actual road distance vs straight line)
    const routeFactor = 1.3; // Typical for urban areas

    return R * c * routeFactor;
  }

  private toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  private estimateAverageSpeed(
    origin: GeoLocation,
    destination: GeoLocation,
  ): number {
    // Estimate based on likely road mix
    const distance = this.calculateDistance(origin, destination);

    if (distance > 20) {
      // Longer trips likely use highways
      return 45; // km/h average
    } else if (distance > 5) {
      // Medium trips mix of roads
      return 30; // km/h
    } else {
      // Short trips mostly minor roads
      return 25; // km/h
    }
  }

  private getTimeOfDay(): string {
    const hour = new Date().getHours();

    if (hour >= 22 || hour < 5) {
      return "night";
    }
    if (hour >= 7 && hour < 9) {
      return "morning_rush";
    }
    if (hour >= 11 && hour < 14) {
      return "midday";
    }
    if (hour >= 17 && hour < 20) {
      return "evening_rush";
    }
    return "normal";
  }

  private calculateConfidence(
    components: ETAComponent[],
    _request: ETAPredictionRequest,
  ): number {
    // Weighted average of component confidences
    const totalDuration = components.reduce(
      (sum, c) => sum + c.durationSeconds,
      0,
    );

    if (totalDuration === 0) {
      return 0.5;
    }

    const weightedConfidence = components.reduce(
      (sum, c) => sum + (c.confidence * c.durationSeconds) / totalDuration,
      0,
    );

    // Reduce confidence for:
    // - Longer trips
    // - Peak hours
    // - Bad weather
    let adjustedConfidence = weightedConfidence;

    if (totalDuration > 3600) {
      adjustedConfidence *= 0.9; // Less confident for trips > 1 hour
    }

    const timeOfDay = this.getTimeOfDay();
    if (timeOfDay === "morning_rush" || timeOfDay === "evening_rush") {
      adjustedConfidence *= 0.85;
    }

    if (this.weatherCache.condition !== "clear") {
      adjustedConfidence *= 0.9;
    }

    return Math.max(0.3, Math.min(0.95, adjustedConfidence));
  }

  private generateId(): string {
    return `eta_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

// =============================================================================
// SUPPORT NLP SERVICE
// =============================================================================
// Intent classification and auto-response for customer support
// Target: -40% support costs, <500ms classification
// =============================================================================

interface SupportIntent {
  id: string;
  name: string;
  examples: string[];
  responses: string[];
  actionRequired: boolean;
  priority: "low" | "medium" | "high" | "urgent";
  escalationTriggers: string[];
}

interface IntentClassification {
  intentId: string;
  intentName: string;
  confidence: number;
  entities: ExtractedEntity[];
  suggestedResponse: string;
  requiresHuman: boolean;
  sentiment: "positive" | "neutral" | "negative" | "angry";
  priority: "low" | "medium" | "high" | "urgent";
}

interface ExtractedEntity {
  type: string;
  value: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
}

// =============================================================================
// SUPPORT NLP SERVICE
// =============================================================================

export class SupportNLPService {
  private eventEmitter: EventEmitter;

  // Intent definitions
  private intents: Map<string, SupportIntent> = new Map();

  // Simple keyword-based patterns (in production, use ML model)
  private intentPatterns: Map<string, RegExp[]> = new Map();

  // Entity extraction patterns
  private entityPatterns: Map<string, RegExp> = new Map();

  // Sentiment keywords
  private sentimentKeywords = {
    positive: [
      "thanks",
      "great",
      "awesome",
      "excellent",
      "good",
      "love",
      "amazing",
    ],
    negative: [
      "bad",
      "poor",
      "terrible",
      "worst",
      "hate",
      "disappointed",
      "awful",
    ],
    angry: [
      "angry",
      "furious",
      "scam",
      "fraud",
      "sue",
      "report",
      "unacceptable",
    ],
  };

  constructor() {
    this.eventEmitter = new EventEmitter();
    this.initializeIntents();
    this.initializeEntityPatterns();
  }

  // ===========================================================================
  // INTENT CLASSIFICATION
  // ===========================================================================

  async classifyIntent(
    text: string,
    context?: { userId?: string; tripId?: string; previousIntents?: string[] },
  ): Promise<IntentClassification> {
    const startTime = Date.now();

    // Preprocess text
    const normalizedText = this.normalizeText(text);

    // Match intents
    const intentScores = this.scoreIntents(normalizedText);

    // Get top intent
    const topIntent = intentScores[0];

    // Extract entities
    const entities = this.extractEntities(text);

    // Analyze sentiment
    const sentiment = this.analyzeSentiment(normalizedText);

    // Determine if human required
    const requiresHuman = this.checkRequiresHuman(
      topIntent,
      sentiment,
      normalizedText,
      context,
    );

    // Generate suggested response
    const suggestedResponse = this.generateResponse(
      topIntent?.intent,
      entities,
      context,
    );

    // Determine priority
    const priority = this.determinePriority(
      topIntent?.intent,
      sentiment,
      entities,
    );

    const classification: IntentClassification = {
      intentId: topIntent?.intent.id || "unknown",
      intentName: topIntent?.intent.name || "Unknown Intent",
      confidence: topIntent?.score || 0,
      entities,
      suggestedResponse,
      requiresHuman,
      sentiment,
      priority,
    };

    this.eventEmitter.emit("intent:classified", {
      classification,
      text,
      context,
      latencyMs: Date.now() - startTime,
    });

    return classification;
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private scoreIntents(
    normalizedText: string,
  ): Array<{ intent: SupportIntent; score: number }> {
    const scores: Array<{ intent: SupportIntent; score: number }> = [];

    for (const [intentId, intent] of this.intents) {
      const patterns = this.intentPatterns.get(intentId) || [];
      let matchScore = 0;

      // Check pattern matches
      for (const pattern of patterns) {
        if (pattern.test(normalizedText)) {
          matchScore += 0.3;
        }
      }

      // Check example similarity
      for (const example of intent.examples) {
        const similarity = this.calculateSimilarity(
          normalizedText,
          example.toLowerCase(),
        );
        matchScore = Math.max(matchScore, similarity);
      }

      if (matchScore > 0.2) {
        scores.push({ intent, score: matchScore });
      }
    }

    // Sort by score
    scores.sort((a, b) => b.score - a.score);

    return scores;
  }

  private calculateSimilarity(text1: string, text2: string): number {
    // Simple word overlap similarity
    const words1 = new Set(text1.split(" "));
    const words2 = new Set(text2.split(" "));

    let overlap = 0;
    for (const word of words1) {
      if (words2.has(word)) {
        overlap++;
      }
    }

    return overlap / Math.max(words1.size, words2.size);
  }

  // ===========================================================================
  // ENTITY EXTRACTION
  // ===========================================================================

  private extractEntities(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];

    for (const [entityType, pattern] of this.entityPatterns) {
      const matches = text.matchAll(new RegExp(pattern, "gi"));

      for (const match of matches) {
        entities.push({
          type: entityType,
          value: match[0],
          startIndex: match.index || 0,
          endIndex: (match.index || 0) + match[0].length,
          confidence: 0.9,
        });
      }
    }

    return entities;
  }

  // ===========================================================================
  // SENTIMENT ANALYSIS
  // ===========================================================================

  private analyzeSentiment(
    normalizedText: string,
  ): "positive" | "neutral" | "negative" | "angry" {
    const words = normalizedText.split(" ");

    let positiveCount = 0;
    let negativeCount = 0;
    let angryCount = 0;

    for (const word of words) {
      if (this.sentimentKeywords.positive.includes(word)) {
        positiveCount++;
      }
      if (this.sentimentKeywords.negative.includes(word)) {
        negativeCount++;
      }
      if (this.sentimentKeywords.angry.includes(word)) {
        angryCount++;
      }
    }

    if (angryCount > 0) {
      return "angry";
    }
    if (negativeCount > positiveCount) {
      return "negative";
    }
    if (positiveCount > negativeCount) {
      return "positive";
    }
    return "neutral";
  }

  // ===========================================================================
  // HUMAN ESCALATION
  // ===========================================================================

  private checkRequiresHuman(
    topIntent: { intent: SupportIntent; score: number } | undefined,
    sentiment: string,
    text: string,
    context?: { previousIntents?: string[] },
  ): boolean {
    // Low confidence
    if (!topIntent || topIntent.score < 0.5) {
      return true;
    }

    // Angry sentiment
    if (sentiment === "angry") {
      return true;
    }

    // Intent requires action
    if (topIntent.intent.actionRequired) {
      return true;
    }

    // Check escalation triggers
    for (const trigger of topIntent.intent.escalationTriggers) {
      if (text.includes(trigger.toLowerCase())) {
        return true;
      }
    }

    // Repeated issues (same intent multiple times)
    if (context?.previousIntents) {
      const sameIntentCount = context.previousIntents.filter(
        (i) => i === topIntent.intent.id,
      ).length;
      if (sameIntentCount >= 2) {
        return true;
      }
    }

    return false;
  }

  // ===========================================================================
  // RESPONSE GENERATION
  // ===========================================================================

  private generateResponse(
    intent: SupportIntent | undefined,
    entities: ExtractedEntity[],
    context?: { userId?: string; tripId?: string },
  ): string {
    if (!intent) {
      return "I'm sorry, I didn't quite understand that. Could you please rephrase your question?";
    }

    // Get base response
    const response =
      intent.responses[Math.floor(Math.random() * intent.responses.length)] ||
      "";

    // Replace entity placeholders
    let formattedResponse = response;
    for (const entity of entities) {
      formattedResponse = formattedResponse.replace(
        `{${entity.type}}`,
        entity.value,
      );
    }

    // Add context if available
    if (context?.tripId) {
      formattedResponse = formattedResponse.replace(
        "{trip_id}",
        context.tripId || "",
      );
    }

    return formattedResponse;
  }

  // ===========================================================================
  // PRIORITY DETERMINATION
  // ===========================================================================

  private determinePriority(
    intent: SupportIntent | undefined,
    sentiment: string,
    entities: ExtractedEntity[],
  ): "low" | "medium" | "high" | "urgent" {
    if (!intent) {
      return "medium";
    }

    // Angry sentiment escalates priority
    if (sentiment === "angry") {
      return intent.priority === "low"
        ? "medium"
        : intent.priority === "medium"
          ? "high"
          : "urgent";
    }

    // Safety-related entities escalate
    const hasSafetyEntity = entities.some(
      (e) => e.type === "safety_concern" || e.type === "emergency",
    );
    if (hasSafetyEntity) {
      return "urgent";
    }

    return intent.priority;
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  private initializeIntents(): void {
    // Payment issues
    this.addIntent({
      id: "payment_failed",
      name: "Payment Failed",
      examples: [
        "my payment failed",
        "payment not going through",
        "card declined",
        "cannot pay",
        "payment error",
      ],
      responses: [
        "I'm sorry to hear about the payment issue. Let me help you with that. Could you try using a different payment method?",
        "I understand payment issues can be frustrating. Please check if your card has sufficient funds and try again.",
      ],
      actionRequired: false,
      priority: "high",
      escalationTriggers: ["charged twice", "money taken", "refund"],
    });

    // Refund requests
    this.addIntent({
      id: "refund_request",
      name: "Refund Request",
      examples: [
        "i want a refund",
        "refund my money",
        "get my money back",
        "cancel and refund",
        "return my payment",
      ],
      responses: [
        "I understand you'd like a refund. Let me review your recent transactions and help you with this.",
        "I'm checking your account for the refund request. This typically takes 3-5 business days.",
      ],
      actionRequired: true,
      priority: "high",
      escalationTriggers: ["lawyer", "sue", "fraud"],
    });

    // Trip issues
    this.addIntent({
      id: "trip_issue",
      name: "Trip Issue",
      examples: [
        "driver never arrived",
        "trip cancelled",
        "wrong route",
        "trip problem",
        "driver issue",
      ],
      responses: [
        "I'm sorry you experienced issues with your trip. Could you provide more details about what happened?",
        "I apologize for the inconvenience. Let me look into this trip for you.",
      ],
      actionRequired: true,
      priority: "medium",
      escalationTriggers: ["accident", "unsafe", "dangerous"],
    });

    // Account issues
    this.addIntent({
      id: "account_access",
      name: "Account Access",
      examples: [
        "cannot login",
        "forgot password",
        "reset password",
        "account locked",
        "cannot access account",
      ],
      responses: [
        "I can help you regain access to your account. Please check your email for a password reset link.",
        "Let me help you with account access. You can reset your password through the app or website.",
      ],
      actionRequired: false,
      priority: "medium",
      escalationTriggers: ["hacked", "someone else"],
    });

    // General inquiry
    this.addIntent({
      id: "general_inquiry",
      name: "General Inquiry",
      examples: [
        "how does it work",
        "how to use",
        "what is ubi",
        "pricing information",
        "how much does it cost",
      ],
      responses: [
        "I'd be happy to help you learn more about UBI! What specific information are you looking for?",
        "UBI offers rides, food delivery, and package delivery. What would you like to know more about?",
      ],
      actionRequired: false,
      priority: "low",
      escalationTriggers: [],
    });

    // Promo code
    this.addIntent({
      id: "promo_code",
      name: "Promo Code Issue",
      examples: [
        "promo code not working",
        "discount not applied",
        "coupon invalid",
        "promo expired",
        "add promo code",
      ],
      responses: [
        "I can help with your promo code. Could you share the code you're trying to use?",
        "Let me check the status of that promo code for you. Some codes have specific conditions.",
      ],
      actionRequired: false,
      priority: "low",
      escalationTriggers: [],
    });

    // Food order
    this.addIntent({
      id: "food_order_issue",
      name: "Food Order Issue",
      examples: [
        "wrong food delivered",
        "food never arrived",
        "order missing items",
        "food cold",
        "food order problem",
      ],
      responses: [
        "I'm sorry your food order wasn't right. Let me look into this and make it right.",
        "I apologize for the issue with your order. I'll help you resolve this quickly.",
      ],
      actionRequired: true,
      priority: "high",
      escalationTriggers: ["food poisoning", "allergic", "sick"],
    });

    // Driver rating
    this.addIntent({
      id: "driver_feedback",
      name: "Driver Feedback",
      examples: [
        "rate my driver",
        "driver was great",
        "bad driver experience",
        "want to complain about driver",
        "driver review",
      ],
      responses: [
        "Thank you for your feedback! You can rate your driver directly in the app after your trip.",
        "We value your feedback. Your rating helps maintain quality service.",
      ],
      actionRequired: false,
      priority: "low",
      escalationTriggers: ["harassed", "threatened", "unsafe"],
    });

    // Initialize patterns
    for (const intent of this.intents.values()) {
      const patterns = intent.examples.map((e) => {
        const keywords = e.split(" ").filter((w) => w.length > 3);
        return new RegExp(keywords.join("|"), "i");
      });
      this.intentPatterns.set(intent.id, patterns);
    }
  }

  private addIntent(intent: SupportIntent): void {
    this.intents.set(intent.id, intent);
  }

  private initializeEntityPatterns(): void {
    // Trip ID pattern
    this.entityPatterns.set("trip_id", /trip[-_]?[a-z0-9]{8,}/i);

    // Order ID pattern
    this.entityPatterns.set("order_id", /order[-_]?[a-z0-9]{8,}/i);

    // Phone number
    this.entityPatterns.set("phone", /(?:\+234|0)[789][01]\d{8}/);

    // Email
    this.entityPatterns.set("email", /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);

    // Amount (Naira)
    this.entityPatterns.set("amount", /(?:₦|NGN|naira)\s*[\d,]+(?:\.\d{2})?/i);

    // Date
    this.entityPatterns.set("date", /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/);
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default { ETAPredictionService, SupportNLPService };
