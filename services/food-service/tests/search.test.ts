/**
 * Search Routes Tests
 *
 * Tests restaurant and menu item search functionality.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

// Enums
enum CuisineType {
  AFRICAN = "AFRICAN",
  NIGERIAN = "NIGERIAN",
  GHANAIAN = "GHANAIAN",
  KENYAN = "KENYAN",
  FAST_FOOD = "FAST_FOOD",
  CHINESE = "CHINESE",
  INDIAN = "INDIAN",
  ITALIAN = "ITALIAN",
}

// Schemas
const searchSchema = z.object({
  query: z.string().min(1).max(100),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().min(0.5).max(50).default(10),
  city: z.string().optional(),
  cuisine: z.nativeEnum(CuisineType).optional(),
  priceRange: z.coerce.number().min(1).max(4).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  isOpen: z.coerce.boolean().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

const suggestionsSchema = z.object({
  query: z.string().min(1).max(50),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().min(1).max(10).default(5),
});

describe("Search Schema Validation", () => {
  describe("searchSchema", () => {
    it("should validate basic search query", () => {
      const result = searchSchema.safeParse({
        query: "jollof rice",
      });
      expect(result.success).toBe(true);
    });

    it("should validate search with all parameters", () => {
      const result = searchSchema.safeParse({
        query: "pizza",
        latitude: "6.5244",
        longitude: "3.3792",
        radius: "5",
        city: "Lagos",
        cuisine: CuisineType.ITALIAN,
        priceRange: "2",
        minRating: "4",
        isOpen: "true",
        page: "1",
        limit: "20",
      });
      expect(result.success).toBe(true);
    });

    it("should require query", () => {
      const result = searchSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("should reject empty query", () => {
      const result = searchSchema.safeParse({ query: "" });
      expect(result.success).toBe(false);
    });

    it("should reject query too long", () => {
      const result = searchSchema.safeParse({
        query: "A".repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it("should apply default values", () => {
      const result = searchSchema.safeParse({ query: "food" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.radius).toBe(10);
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
      }
    });

    it("should reject invalid cuisine type", () => {
      const result = searchSchema.safeParse({
        query: "food",
        cuisine: "INVALID_CUISINE" as any,
      });
      expect(result.success).toBe(false);
    });

    it("should reject radius too small", () => {
      const result = searchSchema.safeParse({
        query: "food",
        radius: "0.1",
      });
      expect(result.success).toBe(false);
    });

    it("should reject radius too large", () => {
      const result = searchSchema.safeParse({
        query: "food",
        radius: "100",
      });
      expect(result.success).toBe(false);
    });

    it("should coerce string numbers to numbers", () => {
      const result = searchSchema.safeParse({
        query: "food",
        latitude: "6.5244",
        longitude: "3.3792",
        page: "2",
        limit: "10",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.latitude).toBe("number");
        expect(typeof result.data.longitude).toBe("number");
        expect(typeof result.data.page).toBe("number");
        expect(typeof result.data.limit).toBe("number");
      }
    });
  });

  describe("suggestionsSchema", () => {
    it("should validate basic suggestion query", () => {
      const result = suggestionsSchema.safeParse({
        query: "piz",
      });
      expect(result.success).toBe(true);
    });

    it("should validate with location", () => {
      const result = suggestionsSchema.safeParse({
        query: "piz",
        latitude: "6.5244",
        longitude: "3.3792",
        limit: "5",
      });
      expect(result.success).toBe(true);
    });

    it("should reject query too long", () => {
      const result = suggestionsSchema.safeParse({
        query: "A".repeat(51),
      });
      expect(result.success).toBe(false);
    });

    it("should reject limit greater than 10", () => {
      const result = suggestionsSchema.safeParse({
        query: "food",
        limit: "20",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("Search Result Scoring", () => {
  interface SearchResult {
    id: string;
    name: string;
    rating: number;
    reviewCount: number;
    distance?: number; // km
    isOpen: boolean;
    matchType: "exact" | "partial" | "fuzzy";
  }

  function calculateRelevanceScore(result: SearchResult): number {
    let score = 0;

    // Match type weight
    switch (result.matchType) {
      case "exact":
        score += 100;
        break;
      case "partial":
        score += 50;
        break;
      case "fuzzy":
        score += 25;
        break;
    }

    // Rating weight (max 25 points)
    score += result.rating * 5;

    // Review count weight (max 20 points)
    score += Math.min(result.reviewCount / 10, 20);

    // Distance penalty (closer is better)
    if (result.distance !== undefined) {
      score -= Math.min(result.distance * 2, 20);
    }

    // Open status bonus
    if (result.isOpen) {
      score += 15;
    }

    return Math.max(0, score);
  }

  function sortByRelevance(results: SearchResult[]): SearchResult[] {
    return [...results].sort((a, b) => {
      return calculateRelevanceScore(b) - calculateRelevanceScore(a);
    });
  }

  it("should score exact matches higher", () => {
    const exactMatch: SearchResult = {
      id: "1",
      name: "Pizza Palace",
      rating: 4.5,
      reviewCount: 100,
      distance: 2,
      isOpen: true,
      matchType: "exact",
    };

    const partialMatch: SearchResult = {
      id: "2",
      name: "Pizza House",
      rating: 4.5,
      reviewCount: 100,
      distance: 2,
      isOpen: true,
      matchType: "partial",
    };

    expect(calculateRelevanceScore(exactMatch)).toBeGreaterThan(
      calculateRelevanceScore(partialMatch),
    );
  });

  it("should score higher ratings better", () => {
    const highRated: SearchResult = {
      id: "1",
      name: "Restaurant A",
      rating: 5,
      reviewCount: 50,
      distance: 2,
      isOpen: true,
      matchType: "exact",
    };

    const lowRated: SearchResult = {
      id: "2",
      name: "Restaurant B",
      rating: 3,
      reviewCount: 50,
      distance: 2,
      isOpen: true,
      matchType: "exact",
    };

    expect(calculateRelevanceScore(highRated)).toBeGreaterThan(
      calculateRelevanceScore(lowRated),
    );
  });

  it("should penalize distant restaurants", () => {
    const nearby: SearchResult = {
      id: "1",
      name: "Nearby Restaurant",
      rating: 4,
      reviewCount: 50,
      distance: 1,
      isOpen: true,
      matchType: "exact",
    };

    const farAway: SearchResult = {
      id: "2",
      name: "Far Restaurant",
      rating: 4,
      reviewCount: 50,
      distance: 10,
      isOpen: true,
      matchType: "exact",
    };

    expect(calculateRelevanceScore(nearby)).toBeGreaterThan(
      calculateRelevanceScore(farAway),
    );
  });

  it("should boost open restaurants", () => {
    const openRestaurant: SearchResult = {
      id: "1",
      name: "Open Restaurant",
      rating: 4,
      reviewCount: 50,
      isOpen: true,
      matchType: "exact",
    };

    const closedRestaurant: SearchResult = {
      id: "2",
      name: "Closed Restaurant",
      rating: 4,
      reviewCount: 50,
      isOpen: false,
      matchType: "exact",
    };

    expect(calculateRelevanceScore(openRestaurant)).toBeGreaterThan(
      calculateRelevanceScore(closedRestaurant),
    );
  });

  it("should sort results by relevance", () => {
    const results: SearchResult[] = [
      {
        id: "1",
        name: "Low Match",
        rating: 3,
        reviewCount: 10,
        isOpen: false,
        matchType: "fuzzy",
      },
      {
        id: "2",
        name: "Best Match",
        rating: 5,
        reviewCount: 200,
        isOpen: true,
        matchType: "exact",
      },
      {
        id: "3",
        name: "Medium Match",
        rating: 4,
        reviewCount: 50,
        isOpen: true,
        matchType: "partial",
      },
    ];

    const sorted = sortByRelevance(results);
    expect(sorted[0].name).toBe("Best Match");
    expect(sorted[sorted.length - 1].name).toBe("Low Match");
  });
});

describe("Search Text Matching", () => {
  function normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replaceAll(/[\u0300-\u036f]/g, "") // Remove diacritics
      .replaceAll(/[^a-z0-9\s]/g, "") // Remove special chars
      .trim();
  }

  function getMatchType(
    query: string,
    text: string,
  ): "exact" | "partial" | "fuzzy" | "none" {
    const normalizedQuery = normalizeText(query);
    const normalizedText = normalizeText(text);

    if (normalizedText === normalizedQuery) {
      return "exact";
    }

    if (normalizedText.includes(normalizedQuery)) {
      return "partial";
    }

    // Simple fuzzy match - check if all words are present
    const queryWords = normalizedQuery.split(/\s+/);
    const textWords = normalizedText.split(/\s+/);
    const allWordsPresent = queryWords.every((qw) =>
      textWords.some((tw) => tw.includes(qw) || qw.includes(tw)),
    );

    if (allWordsPresent) {
      return "fuzzy";
    }

    return "none";
  }

  it("should normalize text correctly", () => {
    expect(normalizeText("Café Restaurant")).toBe("cafe restaurant");
    expect(normalizeText("PIZZA PALACE!")).toBe("pizza palace");
    expect(normalizeText("  Extra   Spaces  ")).toBe("extra   spaces");
  });

  it("should detect exact match", () => {
    expect(getMatchType("pizza palace", "Pizza Palace")).toBe("exact");
  });

  it("should detect partial match", () => {
    expect(getMatchType("pizza", "Pizza Palace Restaurant")).toBe("partial");
  });

  it("should detect fuzzy match", () => {
    expect(getMatchType("palace pizza", "Pizza Palace")).toBe("fuzzy");
  });

  it("should return none for no match", () => {
    expect(getMatchType("burger", "Pizza Palace")).toBe("none");
  });
});

describe("Search Suggestions", () => {
  interface Suggestion {
    type: "restaurant" | "menu_item" | "cuisine";
    id: string;
    name: string;
    subtitle?: string;
  }

  function generateSuggestions(
    query: string,
    restaurants: { id: string; name: string; cuisines: string[] }[],
    menuItems: { id: string; name: string; restaurantName: string }[],
    cuisines: string[],
  ): Suggestion[] {
    const suggestions: Suggestion[] = [];
    const normalizedQuery = query.toLowerCase();

    // Restaurant suggestions
    restaurants
      .filter((r) => r.name.toLowerCase().includes(normalizedQuery))
      .slice(0, 3)
      .forEach((r) => {
        suggestions.push({
          type: "restaurant",
          id: r.id,
          name: r.name,
          subtitle: r.cuisines.join(", "),
        });
      });

    // Menu item suggestions
    menuItems
      .filter((m) => m.name.toLowerCase().includes(normalizedQuery))
      .slice(0, 3)
      .forEach((m) => {
        suggestions.push({
          type: "menu_item",
          id: m.id,
          name: m.name,
          subtitle: `at ${m.restaurantName}`,
        });
      });

    // Cuisine suggestions
    cuisines
      .filter((c) => c.toLowerCase().includes(normalizedQuery))
      .slice(0, 2)
      .forEach((c) => {
        suggestions.push({
          type: "cuisine",
          id: c,
          name: c,
          subtitle: "Cuisine type",
        });
      });

    return suggestions;
  }

  const restaurants = [
    { id: "r1", name: "Pizza Palace", cuisines: ["Italian"] },
    { id: "r2", name: "Mama's Kitchen", cuisines: ["Nigerian", "African"] },
    { id: "r3", name: "Pizza Hut", cuisines: ["Italian", "Fast Food"] },
  ];

  const menuItems = [
    { id: "m1", name: "Pepperoni Pizza", restaurantName: "Pizza Palace" },
    { id: "m2", name: "Jollof Rice", restaurantName: "Mama's Kitchen" },
    { id: "m3", name: "Margherita Pizza", restaurantName: "Pizza Hut" },
  ];

  const cuisines = ["Italian", "Nigerian", "African", "Chinese", "Indian"];

  it("should suggest restaurants matching query", () => {
    const suggestions = generateSuggestions(
      "pizza",
      restaurants,
      menuItems,
      cuisines,
    );
    const restaurantSuggestions = suggestions.filter(
      (s) => s.type === "restaurant",
    );
    expect(restaurantSuggestions.length).toBeGreaterThanOrEqual(1);
    expect(
      restaurantSuggestions.every((s) =>
        s.name.toLowerCase().includes("pizza"),
      ),
    ).toBe(true);
  });

  it("should suggest menu items matching query", () => {
    const suggestions = generateSuggestions(
      "jollof",
      restaurants,
      menuItems,
      cuisines,
    );
    const menuSuggestions = suggestions.filter((s) => s.type === "menu_item");
    expect(menuSuggestions.length).toBe(1);
    expect(menuSuggestions[0].name).toBe("Jollof Rice");
  });

  it("should suggest cuisines matching query", () => {
    const suggestions = generateSuggestions(
      "ital",
      restaurants,
      menuItems,
      cuisines,
    );
    const cuisineSuggestions = suggestions.filter((s) => s.type === "cuisine");
    expect(cuisineSuggestions.length).toBe(1);
    expect(cuisineSuggestions[0].name).toBe("Italian");
  });

  it("should return mixed suggestions", () => {
    const suggestions = generateSuggestions(
      "pizza",
      restaurants,
      menuItems,
      cuisines,
    );
    const types = new Set(suggestions.map((s) => s.type));
    expect(types.size).toBeGreaterThanOrEqual(2);
  });

  it("should handle no matches", () => {
    const suggestions = generateSuggestions(
      "xyz123",
      restaurants,
      menuItems,
      cuisines,
    );
    expect(suggestions).toHaveLength(0);
  });
});

describe("Search Caching", () => {
  function generateCacheKey(params: {
    query: string;
    latitude?: number;
    longitude?: number;
    city?: string;
    cuisine?: string;
  }): string {
    const parts = [
      `q:${params.query.toLowerCase()}`,
      params.latitude && params.longitude
        ? `loc:${params.latitude.toFixed(2)},${params.longitude.toFixed(2)}`
        : null,
      params.city ? `city:${params.city.toLowerCase()}` : null,
      params.cuisine ? `cuisine:${params.cuisine.toLowerCase()}` : null,
    ].filter(Boolean);

    return `search:${parts.join(":")}`;
  }

  it("should generate consistent cache keys", () => {
    const key1 = generateCacheKey({ query: "Pizza" });
    const key2 = generateCacheKey({ query: "pizza" });
    expect(key1).toBe(key2);
  });

  it("should include location in cache key", () => {
    const key = generateCacheKey({
      query: "pizza",
      latitude: 6.5244,
      longitude: 3.3792,
    });
    expect(key).toContain("loc:");
  });

  it("should round location for caching", () => {
    const key1 = generateCacheKey({
      query: "pizza",
      latitude: 6.5244,
      longitude: 3.3792,
    });
    const key2 = generateCacheKey({
      query: "pizza",
      latitude: 6.5249,
      longitude: 3.3798,
    });
    expect(key1).toBe(key2); // Both round to same values
  });

  it("should include filters in cache key", () => {
    const key = generateCacheKey({
      query: "food",
      city: "Lagos",
      cuisine: "Italian",
    });
    expect(key).toContain("city:lagos");
    expect(key).toContain("cuisine:italian");
  });
});
