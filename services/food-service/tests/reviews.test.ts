/**
 * Review Routes Tests
 *
 * Tests review creation, ratings, and restaurant replies.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Schemas
const createReviewSchema = z.object({
  orderId: z.string(),
  restaurantRating: z.number().min(1).max(5),
  foodRating: z.number().min(1).max(5),
  deliveryRating: z.number().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
  images: z.array(z.string().url()).max(5).default([]),
  tags: z.array(z.string()).max(10).default([]),
});

const updateReviewSchema = z.object({
  restaurantRating: z.number().min(1).max(5).optional(),
  foodRating: z.number().min(1).max(5).optional(),
  deliveryRating: z.number().min(1).max(5).optional(),
  comment: z.string().max(1000).optional(),
  images: z.array(z.string().url()).max(5).optional(),
  tags: z.array(z.string()).max(10).optional(),
});

const restaurantReplySchema = z.object({
  reply: z.string().min(1).max(500),
});

describe("Review Schema Validation", () => {
  describe("createReviewSchema", () => {
    const validReview = {
      orderId: "order_123",
      restaurantRating: 5,
      foodRating: 4,
      deliveryRating: 5,
      comment: "Great food and fast delivery!",
      images: ["https://example.com/food.jpg"],
      tags: ["delicious", "fast delivery", "good value"],
    };

    it("should validate valid review", () => {
      const result = createReviewSchema.safeParse(validReview);
      expect(result.success).toBe(true);
    });

    it("should require orderId", () => {
      const { orderId: _orderId, ...review } = validReview;
      const result = createReviewSchema.safeParse(review);
      expect(result.success).toBe(false);
    });

    it("should require restaurantRating", () => {
      const { restaurantRating: _restaurantRating, ...review } = validReview;
      const result = createReviewSchema.safeParse(review);
      expect(result.success).toBe(false);
    });

    it("should require foodRating", () => {
      const { foodRating: _foodRating, ...review } = validReview;
      const result = createReviewSchema.safeParse(review);
      expect(result.success).toBe(false);
    });

    it("should make deliveryRating optional", () => {
      const { deliveryRating: _deliveryRating, ...review } = validReview;
      const result = createReviewSchema.safeParse(review);
      expect(result.success).toBe(true);
    });

    it("should reject rating less than 1", () => {
      const result = createReviewSchema.safeParse({
        ...validReview,
        restaurantRating: 0,
      });
      expect(result.success).toBe(false);
    });

    it("should reject rating greater than 5", () => {
      const result = createReviewSchema.safeParse({
        ...validReview,
        foodRating: 6,
      });
      expect(result.success).toBe(false);
    });

    it("should reject comment too long", () => {
      const result = createReviewSchema.safeParse({
        ...validReview,
        comment: "A".repeat(1001),
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid image URLs", () => {
      const result = createReviewSchema.safeParse({
        ...validReview,
        images: ["not-a-url"],
      });
      expect(result.success).toBe(false);
    });

    it("should reject more than 5 images", () => {
      const result = createReviewSchema.safeParse({
        ...validReview,
        images: [
          "https://example.com/1.jpg",
          "https://example.com/2.jpg",
          "https://example.com/3.jpg",
          "https://example.com/4.jpg",
          "https://example.com/5.jpg",
          "https://example.com/6.jpg",
        ],
      });
      expect(result.success).toBe(false);
    });

    it("should reject more than 10 tags", () => {
      const result = createReviewSchema.safeParse({
        ...validReview,
        tags: new Array(11).fill("tag"),
      });
      expect(result.success).toBe(false);
    });

    it("should apply default values", () => {
      const minimalReview = {
        orderId: "order_123",
        restaurantRating: 4,
        foodRating: 4,
      };

      const result = createReviewSchema.safeParse(minimalReview);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.images).toEqual([]);
        expect(result.data.tags).toEqual([]);
      }
    });
  });

  describe("updateReviewSchema", () => {
    it("should allow partial updates", () => {
      const result = updateReviewSchema.safeParse({
        restaurantRating: 5,
      });
      expect(result.success).toBe(true);
    });

    it("should allow updating just comment", () => {
      const result = updateReviewSchema.safeParse({
        comment: "Updated comment",
      });
      expect(result.success).toBe(true);
    });

    it("should validate all fields when provided", () => {
      const result = updateReviewSchema.safeParse({
        restaurantRating: 5,
        foodRating: 4,
        deliveryRating: 5,
        comment: "Great!",
        images: ["https://example.com/new.jpg"],
        tags: ["updated"],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("restaurantReplySchema", () => {
    it("should validate valid reply", () => {
      const result = restaurantReplySchema.safeParse({
        reply: "Thank you for your feedback!",
      });
      expect(result.success).toBe(true);
    });

    it("should require reply", () => {
      const result = restaurantReplySchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("should reject empty reply", () => {
      const result = restaurantReplySchema.safeParse({
        reply: "",
      });
      expect(result.success).toBe(false);
    });

    it("should reject reply too long", () => {
      const result = restaurantReplySchema.safeParse({
        reply: "A".repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("Rating Calculations", () => {
  interface Review {
    restaurantRating: number;
    foodRating: number;
    deliveryRating?: number;
  }

  function calculateOverallRating(review: Review): number {
    const ratings = [review.restaurantRating, review.foodRating];
    if (review.deliveryRating !== undefined) {
      ratings.push(review.deliveryRating);
    }
    const sum = ratings.reduce((a, b) => a + b, 0);
    return Math.round((sum / ratings.length) * 10) / 10;
  }

  function calculateAverageRating(reviews: Review[]): number {
    if (reviews.length === 0) {
      return 0;
    }

    const sum = reviews.reduce((acc, review) => {
      return acc + calculateOverallRating(review);
    }, 0);

    return Math.round((sum / reviews.length) * 10) / 10;
  }

  describe("calculateOverallRating", () => {
    it("should calculate average of restaurant and food ratings", () => {
      const review: Review = {
        restaurantRating: 4,
        foodRating: 5,
      };

      expect(calculateOverallRating(review)).toBe(4.5);
    });

    it("should include delivery rating when present", () => {
      const review: Review = {
        restaurantRating: 5,
        foodRating: 5,
        deliveryRating: 4,
      };

      // (5 + 5 + 4) / 3 = 4.67, rounds to 4.7
      expect(calculateOverallRating(review)).toBe(4.7);
    });

    it("should round to one decimal place", () => {
      const review: Review = {
        restaurantRating: 5,
        foodRating: 4,
        deliveryRating: 3,
      };

      // (5 + 4 + 3) / 3 = 4.0
      expect(calculateOverallRating(review)).toBe(4);
    });
  });

  describe("calculateAverageRating", () => {
    it("should calculate average from multiple reviews", () => {
      const reviews: Review[] = [
        { restaurantRating: 5, foodRating: 5 },
        { restaurantRating: 4, foodRating: 4 },
        { restaurantRating: 3, foodRating: 3 },
      ];

      // (5 + 4 + 3) / 3 = 4.0
      expect(calculateAverageRating(reviews)).toBe(4);
    });

    it("should return 0 for no reviews", () => {
      expect(calculateAverageRating([])).toBe(0);
    });
  });
});

describe("Review Tags", () => {
  const ALLOWED_TAGS = new Set([
    "delicious",
    "fast delivery",
    "good value",
    "great service",
    "generous portions",
    "well packaged",
    "tasty",
    "fresh ingredients",
    "authentic",
    "slow delivery",
    "cold food",
    "overpriced",
    "small portions",
    "poor packaging",
  ]);

  function validateTags(tags: string[]): string[] {
    return tags.filter((tag) => ALLOWED_TAGS.has(tag.toLowerCase()));
  }

  function getTagStats(reviews: { tags: string[] }[]): Record<string, number> {
    const stats: Record<string, number> = {};

    reviews.forEach((review) => {
      review.tags.forEach((tag) => {
        stats[tag] = (stats[tag] || 0) + 1;
      });
    });

    return stats;
  }

  function getTopTags(
    stats: Record<string, number>,
    limit: number = 5,
  ): { tag: string; count: number }[] {
    return Object.entries(stats)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  it("should validate allowed tags", () => {
    const tags = ["delicious", "fast delivery", "invalid tag"];
    const valid = validateTags(tags);
    expect(valid).toHaveLength(2);
    expect(valid).toContain("delicious");
    expect(valid).toContain("fast delivery");
  });

  it("should calculate tag statistics", () => {
    const reviews = [
      { tags: ["delicious", "fast delivery"] },
      { tags: ["delicious", "good value"] },
      { tags: ["delicious"] },
    ];

    const stats = getTagStats(reviews);
    expect(stats["delicious"]).toBe(3);
    expect(stats["fast delivery"]).toBe(1);
    expect(stats["good value"]).toBe(1);
  });

  it("should get top tags", () => {
    const stats = {
      delicious: 10,
      "fast delivery": 8,
      "good value": 6,
      "great service": 4,
      "well packaged": 2,
    };

    const topTags = getTopTags(stats, 3);
    expect(topTags).toHaveLength(3);
    expect(topTags[0].tag).toBe("delicious");
    expect(topTags[0].count).toBe(10);
  });
});

describe("Review Moderation", () => {
  const PROFANITY_LIST = ["badword1", "badword2", "offensive"];

  function containsProfanity(text: string): boolean {
    const lowerText = text.toLowerCase();
    return PROFANITY_LIST.some((word) => lowerText.includes(word));
  }

  function isSpamReview(
    review: {
      comment?: string;
      createdAt: Date;
    },
    userReviews: { createdAt: Date }[],
  ): boolean {
    // Check for rapid review submission
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentReviews = userReviews.filter(
      (r) => r.createdAt > fiveMinutesAgo,
    );

    if (recentReviews.length >= 3) {
      return true;
    }

    // Check for suspicious comment patterns
    if (review.comment) {
      // All caps
      if (
        review.comment === review.comment.toUpperCase() &&
        review.comment.length > 20
      ) {
        return true;
      }

      // Repeated characters
      if (/(.)\1{4,}/.test(review.comment)) {
        return true;
      }
    }

    return false;
  }

  it("should detect profanity", () => {
    expect(containsProfanity("This was badword1 food")).toBe(true);
    expect(containsProfanity("Great food!")).toBe(false);
  });

  it("should detect spam from rapid submissions", () => {
    const now = new Date();
    const userReviews = [
      { createdAt: new Date(now.getTime() - 60000) }, // 1 min ago
      { createdAt: new Date(now.getTime() - 120000) }, // 2 min ago
      { createdAt: new Date(now.getTime() - 180000) }, // 3 min ago
    ];

    const newReview = { createdAt: now };
    expect(isSpamReview(newReview, userReviews)).toBe(true);
  });

  it("should not flag legitimate reviews", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const userReviews = [{ createdAt: oneHourAgo }];

    const newReview = {
      comment: "The food was delicious and well packaged.",
      createdAt: new Date(),
    };

    expect(isSpamReview(newReview, userReviews)).toBe(false);
  });

  it("should detect all caps spam", () => {
    const newReview = {
      comment: "THIS IS ALL CAPS AND LOOKS LIKE SPAM",
      createdAt: new Date(),
    };

    expect(isSpamReview(newReview, [])).toBe(true);
  });

  it("should detect repeated characters", () => {
    const newReview = {
      comment: "Greaaaaaaaat food!",
      createdAt: new Date(),
    };

    expect(isSpamReview(newReview, [])).toBe(true);
  });
});

describe("Review Helpfulness", () => {
  interface ReviewHelpfulness {
    reviewId: string;
    helpfulCount: number;
    notHelpfulCount: number;
  }

  function calculateHelpfulnessScore(review: ReviewHelpfulness): number {
    const total = review.helpfulCount + review.notHelpfulCount;
    if (total === 0) {
      return 0;
    }

    // Wilson score lower bound for helpfulness
    const p = review.helpfulCount / total;
    const z = 1.96; // 95% confidence
    const n = total;

    const score =
      (p +
        (z * z) / (2 * n) -
        z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) /
      (1 + (z * z) / n);

    return Math.round(score * 100) / 100;
  }

  function sortByHelpfulness(
    reviews: ReviewHelpfulness[],
  ): ReviewHelpfulness[] {
    return [...reviews].sort((a, b) => {
      return calculateHelpfulnessScore(b) - calculateHelpfulnessScore(a);
    });
  }

  it("should calculate helpfulness score", () => {
    const review: ReviewHelpfulness = {
      reviewId: "1",
      helpfulCount: 80,
      notHelpfulCount: 20,
    };

    const score = calculateHelpfulnessScore(review);
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(0.9);
  });

  it("should return 0 for no votes", () => {
    const review: ReviewHelpfulness = {
      reviewId: "1",
      helpfulCount: 0,
      notHelpfulCount: 0,
    };

    expect(calculateHelpfulnessScore(review)).toBe(0);
  });

  it("should rank reviews with more helpful votes higher", () => {
    const reviews: ReviewHelpfulness[] = [
      { reviewId: "1", helpfulCount: 5, notHelpfulCount: 5 },
      { reviewId: "2", helpfulCount: 90, notHelpfulCount: 10 },
      { reviewId: "3", helpfulCount: 10, notHelpfulCount: 2 },
    ];

    const sorted = sortByHelpfulness(reviews);
    expect(sorted[0].reviewId).toBe("2");
  });
});

describe("Review Time Constraints", () => {
  function canReview(
    orderDeliveredAt: Date,
    existingReviewAt?: Date,
  ): { canReview: boolean; reason?: string } {
    const now = new Date();
    const daysSinceDelivery =
      (now.getTime() - orderDeliveredAt.getTime()) / (1000 * 60 * 60 * 24);

    // Can only review within 30 days of delivery
    if (daysSinceDelivery > 30) {
      return {
        canReview: false,
        reason: "Review period has expired (30 days)",
      };
    }

    // Cannot review again if already reviewed
    if (existingReviewAt) {
      return {
        canReview: false,
        reason: "Order has already been reviewed",
      };
    }

    return { canReview: true };
  }

  it("should allow review within 30 days", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const result = canReview(tenDaysAgo);
    expect(result.canReview).toBe(true);
  });

  it("should reject review after 30 days", () => {
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const result = canReview(fortyDaysAgo);
    expect(result.canReview).toBe(false);
    expect(result.reason).toContain("30 days");
  });

  it("should reject duplicate review", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);

    const result = canReview(tenDaysAgo, fiveDaysAgo);
    expect(result.canReview).toBe(false);
    expect(result.reason).toContain("already been reviewed");
  });
});
