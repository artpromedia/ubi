// =============================================================================
// UBI AI/ML PLATFORM - RECOMMENDATION ENGINE
// =============================================================================
// Personalized recommendations for restaurants, destinations, and offers
// Using collaborative filtering, content-based, and contextual bandits
// =============================================================================

import { Redis } from "ioredis";
import { EventEmitter } from "node:events";
import {
  FeatureEntityType,
  GeoLocation,
  IRecommendationService,
  OrderHistoryAggregates,
  RecommendationContext,
  RecommendationFilters,
  RecommendationRequest,
  RecommendationResponse,
  RecommendationType,
  RecommendedItem,
  RidePatternAggregates,
  TimePreferences,
  UserPreferences,
} from "../../types/ml.types";
import { FeatureStoreService } from "./feature-store.service";

// Redis client for caching
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

// H3 resolution for geospatial indexing
const H3_RESOLUTION = 8; // ~460m edge length

// =============================================================================
// RECOMMENDATION ALGORITHMS
// =============================================================================

interface RecommendationCandidate {
  id: string;
  type: string;
  score: number;
  features: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface ScoringFactors {
  relevance: number;
  quality: number;
  popularity: number;
  recency: number;
  diversity: number;
  contextual: number;
}

interface UserEmbedding {
  userId: string;
  embedding: number[];
  updatedAt: Date;
}

// =============================================================================
// RECOMMENDATION ENGINE
// =============================================================================

export class RecommendationEngine implements IRecommendationService {
  private readonly featureStore: FeatureStoreService;
  private readonly eventEmitter: EventEmitter;

  // Caches
  private readonly userEmbeddings: Map<string, UserEmbedding> = new Map();
  private readonly userPreferences: Map<string, UserPreferences> = new Map();

  // Configuration
  private readonly EMBEDDING_DIM = 128;
  private readonly DEFAULT_CANDIDATE_COUNT = 20;
  private readonly DIVERSITY_WEIGHT = 0.15;
  private readonly EXPLORATION_RATE = 0.1;

  constructor(featureStore: FeatureStoreService) {
    this.featureStore = featureStore;
    this.eventEmitter = new EventEmitter();
  }

  // ===========================================================================
  // MAIN RECOMMENDATION API
  // ===========================================================================

  async getRecommendations(
    request: RecommendationRequest,
  ): Promise<RecommendationResponse> {
    const startTime = Date.now();
    const requestId = this.generateId();

    // Get user preferences and context
    const preferences = await this.getUserPreferences(request.userId);
    const context = this.enrichContext(request.context, preferences);

    // Generate candidates based on type
    let candidates: RecommendationCandidate[];

    switch (request.type) {
      case RecommendationType.RESTAURANT:
        candidates = await this.generateRestaurantCandidates(
          request.userId,
          request.location,
          request.filters,
        );
        break;
      case RecommendationType.CUISINE:
        candidates = await this.generateCuisineCandidates(
          request.userId,
          preferences,
        );
        break;
      case RecommendationType.DESTINATION:
        candidates = await this.generateDestinationCandidates(
          request.userId,
          request.location,
          context,
        );
        break;
      case RecommendationType.OFFER:
        candidates = await this.generateOfferCandidates(
          request.userId,
          preferences,
          context,
        );
        break;
      case RecommendationType.DRIVER:
        candidates = await this.generateDriverCandidates(
          request.userId,
          request.location!,
        );
        break;
      default:
        candidates = [];
    }

    // Filter excluded items
    if (request.excludeIds?.length) {
      candidates = candidates.filter(
        (c) => !request.excludeIds!.includes(c.id),
      );
    }

    // Score and rank candidates
    const scoredCandidates = await this.scoreAndRankCandidates(
      candidates,
      request.userId,
      preferences,
      context,
      request.type,
    );

    // Apply diversity optimization
    const diversifiedCandidates = this.applyDiversification(
      scoredCandidates,
      request.type,
    );

    // Apply exploration (contextual bandits)
    const finalCandidates = this.applyExploration(
      diversifiedCandidates,
      request.userId,
    );

    // Limit to requested count
    const count = request.candidateCount || this.DEFAULT_CANDIDATE_COUNT;
    const topCandidates = finalCandidates.slice(0, count);

    // Convert to response format
    const recommendations: RecommendedItem[] = topCandidates.map(
      (c, index) => ({
        itemId: c.id,
        itemType: c.type,
        score: c.score,
        rank: index + 1,
        reason: this.generateRecommendationReason(c, preferences, context),
        features: c.features,
        metadata: c.metadata,
      }),
    );

    // Calculate diversity score
    const diversityScore = this.calculateDiversityScore(recommendations);

    const response: RecommendationResponse = {
      id: requestId,
      recommendations,
      modelVersion: "v1.0.0",
      latencyMs: Date.now() - startTime,
      diversityScore,
    };

    // Log for training
    this.logRecommendationRequest(request, response);

    return response;
  }

  // ===========================================================================
  // USER PREFERENCES
  // ===========================================================================

  async getUserPreferences(userId: string): Promise<UserPreferences> {
    // Check cache
    if (this.userPreferences.has(userId)) {
      return this.userPreferences.get(userId)!;
    }

    // Get from feature store
    const features = await this.featureStore.getFeatures({
      entityType: FeatureEntityType.USER,
      entityIds: [userId],
      featureNames: [
        "user_embedding",
        "user_total_trips",
        "user_avg_trip_distance",
        "user_preferred_vehicle_type",
        "user_total_spend",
      ],
    });

    // Build preferences
    const preferences: UserPreferences = {
      userId,
      favoriteCuisines: [],
      dietaryRestrictions: [],
      pricePreference: this.inferPricePreference(features.vectors[0]?.features),
      cuisineEmbedding: [],
      restaurantEmbedding: [],
      locationEmbedding: [],
      orderHistory: await this.getOrderHistoryAggregates(userId),
      ridePatterns: await this.getRidePatternAggregates(userId),
      timePreferences: await this.getTimePreferences(userId),
    };

    // Get user embedding if available
    if (features.vectors[0]?.features.user_embedding) {
      const embedding = features.vectors[0].features.user_embedding as number[];
      preferences.cuisineEmbedding = embedding.slice(0, 32);
      preferences.restaurantEmbedding = embedding.slice(32, 64);
      preferences.locationEmbedding = embedding.slice(64, 96);
    }

    // Cache preferences
    this.userPreferences.set(userId, preferences);

    return preferences;
  }

  async updateUserPreferences(
    userId: string,
    update: Partial<UserPreferences>,
  ): Promise<void> {
    const current = await this.getUserPreferences(userId);
    const updated = { ...current, ...update };
    this.userPreferences.set(userId, updated);

    this.eventEmitter.emit("preferences:updated", {
      userId,
      preferences: updated,
    });
  }

  private inferPricePreference(
    features?: Record<string, unknown>,
  ): "budget" | "moderate" | "premium" {
    if (!features) return "moderate";

    const avgSpend =
      Number(features.user_avg_trip_distance || 0) *
      Number(features.user_total_trips || 0);

    if (avgSpend > 100000) return "premium";
    if (avgSpend > 30000) return "moderate";
    return "budget";
  }

  private async getOrderHistoryAggregates(
    _userId: string,
  ): Promise<OrderHistoryAggregates> {
    // In production, query order history
    return {
      totalOrders: 0,
      averageOrderValue: 0,
      topCuisines: [],
      topRestaurants: [],
      averageRating: 4.5,
    };
  }

  private async getRidePatternAggregates(
    _userId: string,
  ): Promise<RidePatternAggregates> {
    // In production, query ride history
    return {
      totalRides: 0,
      frequentDestinations: [],
      averageRideDistance: 5,
    };
  }

  private async getTimePreferences(_userId: string): Promise<TimePreferences> {
    // In production, analyze usage patterns
    return {
      preferredOrderTimes: [12, 13, 18, 19, 20],
      preferredRideTimes: [8, 9, 17, 18],
      weekdayVsWeekend: { weekday: 0.7, weekend: 0.3 },
    };
  }

  // ===========================================================================
  // CANDIDATE GENERATION
  // ===========================================================================

  private async generateRestaurantCandidates(
    _userId: string,
    location?: GeoLocation,
    filters?: RecommendationFilters,
  ): Promise<RecommendationCandidate[]> {
    const candidates: RecommendationCandidate[] = [];

    // Get nearby restaurants (would query database in production)
    const nearbyRestaurants = await this.getNearbyRestaurants(location, 5000); // 5km radius

    for (const restaurant of nearbyRestaurants) {
      // Apply filters
      if (!this.passesFilters(restaurant, filters)) {
        continue;
      }

      // Get restaurant features
      const features = await this.featureStore.getFeatures({
        entityType: FeatureEntityType.RESTAURANT,
        entityIds: [restaurant.id],
        featureNames: [
          "restaurant_avg_rating",
          "restaurant_orders_last_7d",
          "restaurant_avg_prep_time",
          "restaurant_is_open",
          "restaurant_current_queue",
          "restaurant_popularity_score",
          "restaurant_embedding",
        ],
      });

      const restaurantFeatures = features.vectors[0]?.features || {};

      // Skip closed restaurants
      if (filters?.isOpen && !restaurantFeatures.restaurant_is_open) {
        continue;
      }

      candidates.push({
        id: restaurant.id,
        type: "restaurant",
        score: 0, // Will be scored later
        features: {
          ...restaurantFeatures,
          distance: restaurant.distance,
          cuisines: restaurant.cuisines,
          priceTier: restaurant.priceTier,
        },
        metadata: {
          name: restaurant.name,
          imageUrl: restaurant.imageUrl,
          deliveryTime: this.estimateDeliveryTime(restaurant, location),
        },
      });
    }

    return candidates;
  }

  private async generateCuisineCandidates(
    _userId: string,
    preferences: UserPreferences,
  ): Promise<RecommendationCandidate[]> {
    const cuisines = [
      "Nigerian",
      "Ghanaian",
      "Chinese",
      "Indian",
      "Italian",
      "Lebanese",
      "American",
      "Mexican",
      "Japanese",
      "Thai",
      "Continental",
      "African",
      "Fast Food",
      "Healthy",
      "Vegetarian",
    ];

    const candidates: RecommendationCandidate[] = [];

    for (const cuisine of cuisines) {
      // Calculate affinity based on order history
      const orderCount =
        preferences.orderHistory?.topCuisines.find(
          (c: any) => c.cuisine === cuisine,
        )?.count || 0;

      candidates.push({
        id: cuisine.toLowerCase().replace(" ", "_"),
        type: "cuisine",
        score: 0,
        features: {
          orderCount,
          isFavorite: preferences.favoriteCuisines.includes(cuisine),
        },
        metadata: {
          name: cuisine,
          displayName: cuisine,
        },
      });
    }

    return candidates;
  }

  private async generateDestinationCandidates(
    userId: string,
    currentLocation?: GeoLocation,
    _context?: RecommendationContext,
  ): Promise<RecommendationCandidate[]> {
    const candidates: RecommendationCandidate[] = [];
    const preferences = await this.getUserPreferences(userId);

    // Add frequent destinations
    if (preferences.ridePatterns?.frequentDestinations) {
      for (const dest of preferences.ridePatterns.frequentDestinations) {
        candidates.push({
          id: dest.h3Index,
          type: "destination",
          score: 0,
          features: {
            visitCount: dest.count,
            isFrequent: true,
          },
          metadata: {
            h3Index: dest.h3Index,
            label: this.getDestinationLabel(dest.h3Index),
          },
        });
      }
    }

    // Add home/work if inferred
    if (preferences.ridePatterns?.homeLocationH3) {
      candidates.push({
        id: preferences.ridePatterns.homeLocationH3,
        type: "destination",
        score: 0,
        features: {
          isHome: true,
        },
        metadata: {
          h3Index: preferences.ridePatterns.homeLocationH3,
          label: "Home",
        },
      });
    }

    if (preferences.ridePatterns?.workLocationH3) {
      candidates.push({
        id: preferences.ridePatterns.workLocationH3,
        type: "destination",
        score: 0,
        features: {
          isWork: true,
        },
        metadata: {
          h3Index: preferences.ridePatterns.workLocationH3,
          label: "Work",
        },
      });
    }

    // Add popular destinations nearby
    const popularDestinations =
      await this.getPopularDestinations(currentLocation);
    for (const dest of popularDestinations) {
      if (!candidates.some((c) => c.id === dest.h3Index)) {
        candidates.push({
          id: dest.h3Index,
          type: "destination",
          score: 0,
          features: {
            popularity: dest.popularity,
            isPopular: true,
          },
          metadata: {
            h3Index: dest.h3Index,
            label: dest.label,
          },
        });
      }
    }

    return candidates;
  }

  private async generateOfferCandidates(
    userId: string,
    preferences: UserPreferences,
    context?: RecommendationContext,
  ): Promise<RecommendationCandidate[]> {
    const candidates: RecommendationCandidate[] = [];

    // Get active offers (would query database in production)
    const activeOffers = await this.getActiveOffers();

    for (const offer of activeOffers) {
      // Check eligibility
      if (!this.isEligibleForOffer(userId, offer)) {
        continue;
      }

      // Calculate relevance
      const relevance = this.calculateOfferRelevance(
        offer,
        preferences,
        context,
      );

      candidates.push({
        id: offer.id,
        type: "offer",
        score: 0,
        features: {
          discountType: offer.discountType,
          discountValue: offer.discountValue,
          minOrderValue: offer.minOrderValue,
          relevance,
        },
        metadata: {
          title: offer.title,
          description: offer.description,
          expiresAt: offer.expiresAt,
          terms: offer.terms,
        },
      });
    }

    return candidates;
  }

  private async generateDriverCandidates(
    _userId: string,
    location: GeoLocation,
  ): Promise<RecommendationCandidate[]> {
    const candidates: RecommendationCandidate[] = [];

    // Get nearby available drivers (would use location service in production)
    const nearbyDrivers = await this.getNearbyDrivers(location, 3000); // 3km radius

    for (const driver of nearbyDrivers) {
      // Get driver features
      const features = await this.featureStore.getFeatures({
        entityType: FeatureEntityType.DRIVER,
        entityIds: [driver.id],
        featureNames: [
          "driver_avg_rating",
          "driver_acceptance_rate",
          "driver_cancellation_rate",
          "driver_total_trips",
          "driver_eta_accuracy",
          "driver_embedding",
        ],
      });

      const driverFeatures = features.vectors[0]?.features || {};

      candidates.push({
        id: driver.id,
        type: "driver",
        score: 0,
        features: {
          ...driverFeatures,
          distance: driver.distance,
          eta: driver.eta,
          vehicleType: driver.vehicleType,
        },
        metadata: {
          name: driver.name,
          photoUrl: driver.photoUrl,
          vehiclePlate: driver.vehiclePlate,
        },
      });
    }

    return candidates;
  }

  // ===========================================================================
  // SCORING AND RANKING
  // ===========================================================================

  private async scoreAndRankCandidates(
    candidates: RecommendationCandidate[],
    userId: string,
    preferences: UserPreferences,
    context?: RecommendationContext,
    type?: RecommendationType,
  ): Promise<RecommendationCandidate[]> {
    // Get user embedding for similarity scoring
    const userEmbedding = await this.getUserEmbedding(userId);

    for (const candidate of candidates) {
      const factors = await this.calculateScoringFactors(
        candidate,
        userEmbedding,
        preferences,
        context,
        type,
      );

      // Weighted combination
      candidate.score = this.combineScoringFactors(factors, type);
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    return candidates;
  }

  private async calculateScoringFactors(
    candidate: RecommendationCandidate,
    userEmbedding: number[],
    preferences: UserPreferences,
    context?: RecommendationContext,
    type?: RecommendationType,
  ): Promise<ScoringFactors> {
    // Relevance: embedding similarity
    let relevance = 0.5;
    const itemEmbedding =
      candidate.features.restaurant_embedding ||
      candidate.features.driver_embedding;
    if (userEmbedding.length && itemEmbedding) {
      relevance = this.cosineSimilarity(
        userEmbedding,
        itemEmbedding as number[],
      );
    }

    // Quality: ratings and performance
    const quality = this.calculateQualityScore(candidate, type);

    // Popularity: order/trip counts, trending
    const popularity = this.calculatePopularityScore(candidate, type);

    // Recency: recent interactions boost
    const recency = this.calculateRecencyScore(candidate, preferences);

    // Diversity: penalize similar to already shown
    const diversity = 1; // Will be adjusted in diversification step

    // Contextual: time, location, weather relevance
    const contextual = this.calculateContextualScore(candidate, context, type);

    return { relevance, quality, popularity, recency, diversity, contextual };
  }

  private combineScoringFactors(
    factors: ScoringFactors,
    type?: RecommendationType,
  ): number {
    // Weights vary by recommendation type
    let weights: ScoringFactors;

    switch (type) {
      case RecommendationType.RESTAURANT:
        weights = {
          relevance: 0.3,
          quality: 0.25,
          popularity: 0.15,
          recency: 0.1,
          diversity: 0.1,
          contextual: 0.1,
        };
        break;
      case RecommendationType.DRIVER:
        weights = {
          relevance: 0.15,
          quality: 0.35,
          popularity: 0.1,
          recency: 0.05,
          diversity: 0.05,
          contextual: 0.3, // ETA is very important
        };
        break;
      case RecommendationType.OFFER:
        weights = {
          relevance: 0.35,
          quality: 0.1,
          popularity: 0.15,
          recency: 0.15,
          diversity: 0.1,
          contextual: 0.15,
        };
        break;
      default:
        weights = {
          relevance: 0.25,
          quality: 0.2,
          popularity: 0.2,
          recency: 0.1,
          diversity: 0.1,
          contextual: 0.15,
        };
    }

    return (
      factors.relevance * weights.relevance +
      factors.quality * weights.quality +
      factors.popularity * weights.popularity +
      factors.recency * weights.recency +
      factors.diversity * weights.diversity +
      factors.contextual * weights.contextual
    );
  }

  private calculateQualityScore(
    candidate: RecommendationCandidate,
    type?: RecommendationType,
  ): number {
    switch (type) {
      case RecommendationType.RESTAURANT: {
        const rating = Number(candidate.features.restaurant_avg_rating || 4);
        const prepTime = Number(
          candidate.features.restaurant_avg_prep_time || 20,
        );
        // Normalize rating (1-5) to 0-1 and penalize long prep times
        return (
          ((rating - 1) / 4) * 0.7 + Math.max(0, (60 - prepTime) / 60) * 0.3
        );
      }

      case RecommendationType.DRIVER: {
        const driverRating = Number(
          candidate.features.driver_avg_rating || 4.5,
        );
        const acceptRate = Number(
          candidate.features.driver_acceptance_rate || 0.8,
        );
        const cancelRate = Number(
          candidate.features.driver_cancellation_rate || 0.05,
        );
        return (
          ((driverRating - 1) / 4) * 0.5 +
          acceptRate * 0.3 +
          (1 - cancelRate) * 0.2
        );
      }

      default:
        return 0.5;
    }
  }

  private calculatePopularityScore(
    candidate: RecommendationCandidate,
    type?: RecommendationType,
  ): number {
    switch (type) {
      case RecommendationType.RESTAURANT: {
        const orders = Number(
          candidate.features.restaurant_orders_last_7d || 0,
        );
        const popScore = Number(
          candidate.features.restaurant_popularity_score || 0.5,
        );
        // Log scale for orders to prevent outliers dominating
        return (Math.log10(orders + 1) / 4) * 0.5 + popScore * 0.5;
      }

      case RecommendationType.DESTINATION: {
        const visits = Number(candidate.features.visitCount || 0);
        return Math.min(1, visits / 10);
      }

      default:
        return 0.5;
    }
  }

  private calculateRecencyScore(
    _candidate: RecommendationCandidate,
    _preferences: UserPreferences,
  ): number {
    // Boost items recently interacted with (but not too recently to avoid repetition)
    // In production, check recent interaction timestamps
    return 0.5;
  }

  private calculateRestaurantContextualScore(
    candidate: RecommendationCandidate,
    context: RecommendationContext,
  ): number {
    let score = 0.5;

    if (context.hourOfDay !== undefined) {
      const hour = context.hourOfDay;
      const isLunchTime = hour >= 11 && hour <= 14;
      const isDinnerTime = hour >= 18 && hour <= 21;

      if (isLunchTime || isDinnerTime) {
        score += 0.2;
      }
    }

    const distance = Number(candidate.features.distance || 1000);
    score += Math.max(0, (5000 - distance) / 5000) * 0.3;
    return score;
  }

  private calculateDriverContextualScore(
    candidate: RecommendationCandidate,
  ): number {
    const eta = Number(candidate.features.eta || 10);
    return Math.max(0, (15 - eta) / 15);
  }

  private calculateDestinationContextualScore(
    candidate: RecommendationCandidate,
    context: RecommendationContext,
  ): number {
    let score = 0.5;

    if (context.hourOfDay !== undefined) {
      const hour = context.hourOfDay;
      const isCommute = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19);

      if (
        isCommute &&
        (candidate.features.isWork || candidate.features.isHome)
      ) {
        score += 0.4;
      }
    }
    return score;
  }

  private calculateContextualScore(
    candidate: RecommendationCandidate,
    context?: RecommendationContext,
    type?: RecommendationType,
  ): number {
    if (!context) return 0.5;

    let score = 0.5;

    switch (type) {
      case RecommendationType.RESTAURANT:
        score = this.calculateRestaurantContextualScore(candidate, context);
        break;

      case RecommendationType.DRIVER:
        score = this.calculateDriverContextualScore(candidate);
        break;

      case RecommendationType.DESTINATION:
        score = this.calculateDestinationContextualScore(candidate, context);
        break;
    }

    return Math.min(1, Math.max(0, score));
  }

  // ===========================================================================
  // DIVERSIFICATION
  // ===========================================================================

  private applyDiversification(
    candidates: RecommendationCandidate[],
    type?: RecommendationType,
  ): RecommendationCandidate[] {
    if (candidates.length < 3) return candidates;

    const diversified: RecommendationCandidate[] = [];
    const remaining = [...candidates];

    // Always include top candidate
    diversified.push(remaining.shift()!);

    // Greedy diversification
    while (remaining.length > 0 && diversified.length < candidates.length) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i];
        if (!candidate) continue;

        // Calculate diversity penalty
        const diversityPenalty = this.calculateDiversityPenalty(
          candidate,
          diversified,
          type,
        );

        // Adjusted score
        const adjustedScore =
          candidate.score * (1 - this.DIVERSITY_WEIGHT) +
          (1 - diversityPenalty) * this.DIVERSITY_WEIGHT;

        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestIdx = i;
        }
      }

      const removed = remaining.splice(bestIdx, 1)[0];
      if (removed) {
        diversified.push(removed);
      }
    }

    return diversified;
  }

  private calculateDiversityPenalty(
    candidate: RecommendationCandidate,
    selected: RecommendationCandidate[],
    type?: RecommendationType,
  ): number {
    if (selected.length === 0) return 0;

    let maxSimilarity = 0;

    for (const item of selected) {
      let similarity = 0;

      switch (type) {
        case RecommendationType.RESTAURANT: {
          // Cuisine similarity
          const cuisines1 = (candidate.features.cuisines as string[]) || [];
          const cuisines2 = (item.features.cuisines as string[]) || [];
          const overlap = cuisines1.filter((c) => cuisines2.includes(c)).length;
          similarity =
            overlap / Math.max(cuisines1.length, cuisines2.length, 1);

          // Price tier similarity
          if (candidate.features.priceTier === item.features.priceTier) {
            similarity += 0.3;
          }
          break;
        }

        case RecommendationType.CUISINE:
          // Just don't repeat same cuisine
          similarity = candidate.id === item.id ? 1 : 0;
          break;

        default: {
          // Use embedding similarity if available
          const emb1 = candidate.features.embedding as number[];
          const emb2 = item.features.embedding as number[];
          if (emb1 && emb2) {
            similarity = this.cosineSimilarity(emb1, emb2);
          }
        }
      }

      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    return maxSimilarity;
  }

  // ===========================================================================
  // EXPLORATION (CONTEXTUAL BANDITS)
  // ===========================================================================

  private applyExploration(
    candidates: RecommendationCandidate[],
    _userId: string,
  ): RecommendationCandidate[] {
    if (candidates.length < 5) return candidates;

    const result = [...candidates];

    // Epsilon-greedy exploration
    for (let i = 0; i < result.length; i++) {
      if (Math.random() < this.EXPLORATION_RATE && i < result.length - 3) {
        // Swap with a random lower-ranked candidate
        const swapIdx =
          Math.floor(Math.random() * (result.length - i - 3)) + i + 3;
        const temp = result[i];
        const swap = result[swapIdx];
        if (temp && swap) {
          result[i] = swap;
          result[swapIdx] = temp;
        }
      }
    }

    return result;
  }

  // ===========================================================================
  // INTERACTION TRACKING
  // ===========================================================================

  async recordInteraction(
    requestId: string,
    itemId: string,
    interactionType: "impression" | "click" | "conversion",
  ): Promise<void> {
    const interaction = {
      requestId,
      itemId,
      type: interactionType,
      timestamp: new Date(),
    };

    this.eventEmitter.emit("interaction:recorded", interaction);

    // Log for training
    console.log(`Recommendation interaction: ${JSON.stringify(interaction)}`);
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private enrichContext(
    context?: RecommendationContext,
    _preferences?: UserPreferences,
  ): RecommendationContext {
    const now = new Date();

    return {
      timestamp: context?.timestamp || now,
      dayOfWeek: context?.dayOfWeek ?? now.getDay(),
      hourOfDay: context?.hourOfDay ?? now.getHours(),
      weather: context?.weather,
      isFirstOrder: context?.isFirstOrder,
      lastOrderedCuisine: context?.lastOrderedCuisine,
      currentMood: context?.currentMood,
      occasion: context?.occasion,
    };
  }

  private async getUserEmbedding(userId: string): Promise<number[]> {
    const cached = this.userEmbeddings.get(userId);
    if (cached && Date.now() - cached.updatedAt.getTime() < 3600000) {
      return cached.embedding;
    }

    // Get from feature store
    const features = await this.featureStore.getFeatures({
      entityType: FeatureEntityType.USER,
      entityIds: [userId],
      featureNames: ["user_embedding"],
    });

    const embedding =
      (features.vectors[0]?.features.user_embedding as number[]) ||
      new Array(this.EMBEDDING_DIM).fill(0);

    this.userEmbeddings.set(userId, {
      userId,
      embedding,
      updatedAt: new Date(),
    });

    return embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i];
      const bVal = b[i];
      if (aVal !== undefined && bVal !== undefined) {
        dotProduct += aVal * bVal;
        normA += aVal * aVal;
        normB += bVal * bVal;
      }
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

  private generateRecommendationReason(
    candidate: RecommendationCandidate,
    preferences: UserPreferences,
    _context?: RecommendationContext,
  ): string {
    switch (candidate.type) {
      case "restaurant":
        return this.getRestaurantReasons(candidate, preferences);

      case "destination":
        return this.getDestinationReason(candidate);

      case "offer":
        return (
          (candidate.metadata.description as string) || "Special offer for you"
        );

      case "driver":
        return this.getDriverReasons(candidate);

      default:
        return "Recommended for you";
    }
  }

  private getRestaurantReasons(
    candidate: RecommendationCandidate,
    preferences: UserPreferences,
  ): string {
    const reasons: string[] = [];

    const rating = Number(candidate.features.restaurant_avg_rating);
    if (rating >= 4.5) reasons.push("Highly rated");

    const cuisines = candidate.features.cuisines as string[];
    const favCuisine = cuisines?.find((c) =>
      preferences.favoriteCuisines.includes(c),
    );
    if (favCuisine) reasons.push(`Serves ${favCuisine}`);

    const distance = Number(candidate.features.distance);
    if (distance < 1000) reasons.push("Very close by");

    const popScore = Number(candidate.features.restaurant_popularity_score);
    if (popScore > 0.8) reasons.push("Popular choice");

    return reasons.length > 0 ? reasons.join(", ") : "Recommended for you";
  }

  private getDestinationReason(candidate: RecommendationCandidate): string {
    if (candidate.features.isHome) return "Your home";
    if (candidate.features.isWork) return "Your workplace";
    if (candidate.features.isFrequent) return "You visit here often";
    if (candidate.features.isPopular) return "Popular destination";
    return "Recommended for you";
  }

  private getDriverReasons(candidate: RecommendationCandidate): string {
    const reasons: string[] = [];

    const driverRating = Number(candidate.features.driver_avg_rating);
    if (driverRating >= 4.8) reasons.push("Top-rated driver");

    const eta = Number(candidate.features.eta);
    if (eta < 3) reasons.push("Arriving very soon");

    return reasons.length > 0 ? reasons.join(", ") : "Recommended for you";
  }

  private calculateDiversityScore(recommendations: RecommendedItem[]): number {
    if (recommendations.length < 2) return 1;

    let totalDiversity = 0;
    let comparisons = 0;

    for (let i = 0; i < recommendations.length; i++) {
      for (let j = i + 1; j < recommendations.length; j++) {
        // Simple diversity: different items contribute to diversity
        const r1 = recommendations[i];
        const r2 = recommendations[j];
        if (!r1 || !r2) continue;

        // Check if they're different enough
        const isDifferent = r1.itemId !== r2.itemId;
        totalDiversity += isDifferent ? 1 : 0;
        comparisons++;
      }
    }

    return comparisons > 0 ? totalDiversity / comparisons : 1;
  }

  private logRecommendationRequest(
    request: RecommendationRequest,
    response: RecommendationResponse,
  ): void {
    // Log for training and analysis
    this.eventEmitter.emit("recommendation:served", {
      requestId: response.id,
      userId: request.userId,
      type: request.type,
      candidateCount: response.recommendations.length,
      latencyMs: response.latencyMs,
      diversityScore: response.diversityScore,
      timestamp: new Date(),
    });
  }

  // ===========================================================================
  // DATA ACCESS IMPLEMENTATIONS WITH H3 GEOSPATIAL INDEXING
  // ===========================================================================

  private async getNearbyRestaurants(
    location?: GeoLocation,
    radiusM: number = 5000,
  ): Promise<any[]> {
    try {
      if (!location) return [];

      const startTime = Date.now();
      const cacheKey = `restaurants:nearby:${location.lat.toFixed(3)}_${location.lng.toFixed(3)}_${radiusM}`;

      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug("Recommendation: Restaurant cache hit", { cacheKey });
        return JSON.parse(cached);
      }

      const radiusDegrees = radiusM / 111000;

      const restaurants = await prisma.restaurant.findMany({
        where: {
          isActive: true,
          latitude: {
            gte: location.lat - radiusDegrees,
            lte: location.lat + radiusDegrees,
          },
          longitude: {
            gte: location.lng - radiusDegrees,
            lte: location.lng + radiusDegrees,
          },
        },
        include: { user: { select: { firstName: true, lastName: true } } },
        take: 50,
      });

      const result = restaurants
        .map((restaurant) => {
          const distanceKm = this.haversineDistance(
            location.lat,
            location.lng,
            restaurant.latitude || 0,
            restaurant.longitude || 0,
          );
          return {
            id: restaurant.id,
            name: restaurant.name,
            rating: restaurant.rating,
            avgPrepTime: restaurant.avgPrepTime || 20,
            cuisineTypes: restaurant.cuisineTypes,
            priceRange: restaurant.priceRange,
            distance: Math.round(distanceKm * 1000),
            h3Index: h3.latLngToCell(
              restaurant.latitude || 0,
              restaurant.longitude || 0,
              H3_RESOLUTION,
            ),
            isOpen: this.isRestaurantOpen(restaurant),
            minOrder: restaurant.minOrderAmount,
            deliveryFee: restaurant.deliveryFee,
          };
        })
        .filter((r) => r.distance <= radiusM)
        .sort((a, b) => a.distance - b.distance);

      await redis.setex(cacheKey, 60, JSON.stringify(result));

      logger.info("Recommendation: Fetched nearby restaurants", {
        location,
        radiusM,
        count: result.length,
        latencyMs: Date.now() - startTime,
      });
      return result;
    } catch (error) {
      logger.error("Recommendation: Error fetching nearby restaurants", {
        location,
        radiusM,
        error,
      });
      return [];
    }
  }

  private async getNearbyDrivers(
    location: GeoLocation,
    radiusM: number,
  ): Promise<any[]> {
    try {
      const startTime = Date.now();
      const cacheKey = `drivers:nearby:${location.lat.toFixed(3)}_${location.lng.toFixed(3)}_${radiusM}`;

      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const radiusDegrees = radiusM / 111000;

      const drivers = await prisma.driver.findMany({
        where: {
          isOnline: true,
          isAvailable: true,
          currentLatitude: {
            gte: location.lat - radiusDegrees,
            lte: location.lat + radiusDegrees,
          },
          currentLongitude: {
            gte: location.lng - radiusDegrees,
            lte: location.lng + radiusDegrees,
          },
        },
        include: {
          user: { select: { firstName: true, lastName: true, phone: true } },
          vehicle: {
            select: {
              make: true,
              model: true,
              color: true,
              plateNumber: true,
              type: true,
            },
          },
        },
        take: 30,
      });

      const result = drivers
        .map((driver) => {
          const distanceKm = this.haversineDistance(
            location.lat,
            location.lng,
            driver.currentLatitude || 0,
            driver.currentLongitude || 0,
          );
          const etaMinutes = Math.ceil((distanceKm / 30) * 60);

          return {
            id: driver.id,
            userId: driver.userId,
            name: driver.user.firstName,
            phone: driver.user.phone,
            rating: driver.rating,
            distance: Math.round(distanceKm * 1000),
            eta: etaMinutes,
            vehicle: driver.vehicle
              ? {
                  make: driver.vehicle.make,
                  model: driver.vehicle.model,
                  color: driver.vehicle.color,
                  plateNumber: driver.vehicle.plateNumber,
                  type: driver.vehicle.type,
                }
              : null,
            acceptanceRate: driver.acceptanceRate,
            totalRides: driver.totalRides,
            h3Index: h3.latLngToCell(
              driver.currentLatitude || 0,
              driver.currentLongitude || 0,
              H3_RESOLUTION,
            ),
          };
        })
        .filter((d) => d.distance <= radiusM)
        .sort((a, b) => a.eta - b.eta);

      await redis.setex(cacheKey, 5, JSON.stringify(result));

      logger.info("Recommendation: Fetched nearby drivers", {
        location,
        radiusM,
        count: result.length,
        latencyMs: Date.now() - startTime,
      });
      return result;
    } catch (error) {
      logger.error("Recommendation: Error fetching nearby drivers", {
        location,
        radiusM,
        error,
      });
      return [];
    }
  }

  private async getPopularDestinations(location?: GeoLocation): Promise<any[]> {
    try {
      if (!location) return [];

      const startTime = Date.now();
      const cacheKey = `destinations:popular:${location.lat.toFixed(2)}_${location.lng.toFixed(2)}`;

      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const radiusDegrees = 2000 / 111000;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const rides = await prisma.ride.findMany({
        where: {
          status: "COMPLETED",
          completedAt: { gte: thirtyDaysAgo },
          pickupLatitude: {
            gte: location.lat - radiusDegrees,
            lte: location.lat + radiusDegrees,
          },
          pickupLongitude: {
            gte: location.lng - radiusDegrees,
            lte: location.lng + radiusDegrees,
          },
        },
        select: {
          dropoffLatitude: true,
          dropoffLongitude: true,
          dropoffAddress: true,
        },
        take: 500,
      });

      const destinationCounts: Map<
        string,
        { count: number; address: string; lat: number; lng: number }
      > = new Map();

      for (const ride of rides) {
        const h3Index = h3.latLngToCell(
          ride.dropoffLatitude,
          ride.dropoffLongitude,
          H3_RESOLUTION,
        );
        const existing = destinationCounts.get(h3Index);
        if (existing) existing.count++;
        else
          destinationCounts.set(h3Index, {
            count: 1,
            address: ride.dropoffAddress,
            lat: ride.dropoffLatitude,
            lng: ride.dropoffLongitude,
          });
      }

      const result = Array.from(destinationCounts.entries())
        .map(([h3Index, data]) => ({
          id: h3Index,
          h3Index,
          address: data.address,
          coords: { lat: data.lat, lng: data.lng },
          tripCount: data.count,
          popularity: data.count / Math.max(rides.length, 1),
          label: this.getDestinationLabel(h3Index),
        }))
        .sort((a, b) => b.tripCount - a.tripCount)
        .slice(0, 20);

      await redis.setex(cacheKey, 3600, JSON.stringify(result));

      logger.info("Recommendation: Fetched popular destinations", {
        location,
        count: result.length,
        latencyMs: Date.now() - startTime,
      });
      return result;
    } catch (error) {
      logger.error("Recommendation: Error fetching popular destinations", {
        location,
        error,
      });
      return [];
    }
  }

  private async getActiveOffers(): Promise<any[]> {
    try {
      const cacheKey = "offers:active";
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const now = new Date();
      const offerKeys = await redis.keys("offer:active:*");
      const offers: any[] = [];

      for (const key of offerKeys) {
        const offerData = await redis.hgetall(key);
        if (offerData?.endDate && new Date(offerData.endDate) > now) {
          offers.push({
            id: key.replace("offer:active:", ""),
            code: offerData.code,
            title: offerData.title,
            description: offerData.description,
            discountType: offerData.discountType,
            discountValue: Number.parseFloat(offerData.discountValue || "0"),
            minOrderAmount: Number.parseFloat(offerData.minOrderAmount || "0"),
            maxDiscount: Number.parseFloat(offerData.maxDiscount || "0"),
            offerType: offerData.offerType,
            targetSegment: offerData.targetSegment,
          });
        }
      }

      // Default platform offers
      const defaultOffers = [
        {
          id: "first_ride",
          code: "FIRSTRIDE",
          title: "First Ride Free",
          description: "Get your first ride free up to 500 NGN",
          discountType: "fixed",
          discountValue: 500,
          minOrderAmount: 0,
          maxDiscount: 500,
          offerType: "ride",
          targetSegment: "new_users",
        },
        {
          id: "food_discount",
          code: "UBIEATS10",
          title: "10% Off Food Orders",
          description: "Save 10% on your next food order",
          discountType: "percentage",
          discountValue: 10,
          minOrderAmount: 1000,
          maxDiscount: 500,
          offerType: "food",
          targetSegment: "all",
        },
      ];

      const result = [...offers, ...defaultOffers];
      await redis.setex(cacheKey, 300, JSON.stringify(result));
      return result;
    } catch (error) {
      logger.error("Recommendation: Error fetching active offers", { error });
      return [];
    }
  }

  private haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private isRestaurantOpen(restaurant: any): boolean {
    const now = new Date();
    const currentHour = now.getHours();
    const openHour = restaurant.openingHour || 8;
    const closeHour = restaurant.closingHour || 22;
    return currentHour >= openHour && currentHour < closeHour;
  }

  private passesFilters(
    restaurant: any,
    filters?: RecommendationFilters,
  ): boolean {
    if (!filters) return true;

    // Apply cuisine filter
    if (filters.cuisineTypes?.length) {
      if (!filters.cuisineTypes.includes(restaurant.cuisineType)) {
        return false;
      }
    }

    // Apply price filter
    if (filters.priceRange) {
      const price = restaurant.priceLevel || 2;
      if (price < filters.priceRange.min || price > filters.priceRange.max) {
        return false;
      }
    }

    // Apply distance filter
    if (filters.maxDistance && restaurant.distance > filters.maxDistance) {
      return false;
    }

    // Apply rating filter
    if (filters.minRating && restaurant.rating < filters.minRating) {
      return false;
    }

    return true;
  }

  private isEligibleForOffer(userId: string, offer: any): boolean {
    // Check user eligibility for offer
    if (!userId || !offer) return false;

    // Check if offer is expired
    if (offer.expiresAt && new Date(offer.expiresAt) < new Date()) {
      return false;
    }

    // Check usage limits
    if (offer.maxUsagePerUser && offer.usageCount >= offer.maxUsagePerUser) {
      return false;
    }

    return true;
  }

  private calculateOfferRelevance(
    _offer: any,
    _preferences: UserPreferences,
    _context?: RecommendationContext,
  ): number {
    return 0.5;
  }

  private estimateDeliveryTime(
    restaurant: any,
    _location?: GeoLocation,
  ): number {
    const prepTime = restaurant.avgPrepTime || 20;
    const distance = restaurant.distance || 3000;
    const deliveryTime = Math.ceil(distance / 500); // 500m per minute
    return prepTime + deliveryTime;
  }

  private getDestinationLabel(_h3Index: string): string {
    // Would lookup POI name from H3 index
    return "Destination";
  }

  private generateId(): string {
    return `rec_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 2 + 9)}`;
  }

  // ===========================================================================
  // EVENT SUBSCRIPTION
  // ===========================================================================

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  off(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.off(event, listener);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default RecommendationEngine;
