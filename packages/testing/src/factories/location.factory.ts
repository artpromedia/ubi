/**
 * Location Factory
 *
 * Creates test locations, addresses, and coordinates for African cities.
 */

import { faker } from "@faker-js/faker";
import type { TestLocation, TestSavedLocation } from "../types";
import {
  AFRICAN_CITIES,
  randomLocationInCity,
  randomPick,
  uuid,
} from "../utils";

// Popular landmarks and places in African cities
const CITY_LANDMARKS: Record<string, string[]> = {
  lagos: [
    "Victoria Island",
    "Ikeja City Mall",
    "Lekki Phase 1",
    "Ikoyi",
    "Marina",
    "Ajah",
    "Maryland Mall",
    "Festac Town",
    "Surulere",
    "Yaba Tech",
    "UNILAG Main Gate",
    "Oshodi",
    "Ikeja GRA",
    "National Theatre",
    "Bar Beach",
  ],
  nairobi: [
    "Westlands",
    "Karen",
    "Kilimani",
    "Lavington",
    "Kileleshwa",
    "CBD",
    "Two Rivers Mall",
    "Village Market",
    "JKIA",
    "Nyayo Stadium",
    "University of Nairobi",
    "Kenyatta Hospital",
    "Sarit Centre",
    "Gigiri",
  ],
  accra: [
    "Osu",
    "East Legon",
    "Airport Residential",
    "Cantonments",
    "Labone",
    "Accra Mall",
    "Kotoka Airport",
    "Independence Square",
    "Labadi Beach",
    "Achimota",
    "Madina",
    "Tema",
    "Spintex Road",
    "West Hills Mall",
  ],
  johannesburg: [
    "Sandton City",
    "Rosebank",
    "Melrose Arch",
    "Braamfontein",
    "Fourways",
    "Soweto",
    "Randburg",
    "Midrand",
    "OR Tambo Airport",
    "Eastgate Mall",
    "Hyde Park",
    "Parkhurst",
    "Greenside",
    "Norwood",
    "Melville",
  ],
  kigali: [
    "Kigali City Tower",
    "Kimironko",
    "Nyarutarama",
    "Kacyiru",
    "Remera",
    "Nyabugogo",
    "Kigali Heights",
    "KG Avenue",
    "Kigali Convention Centre",
  ],
};

const STREET_TYPES = [
  "Street",
  "Road",
  "Avenue",
  "Close",
  "Crescent",
  "Lane",
  "Drive",
];

interface LocationFactoryOptions {
  city?: keyof typeof AFRICAN_CITIES;
  radiusKm?: number;
}

interface SavedLocationFactoryOptions extends LocationFactoryOptions {
  type?: "home" | "work" | "favorite";
}

/**
 * Generate a realistic street address for a city
 */
function generateStreetAddress(city: string): string {
  const landmarks = CITY_LANDMARKS[city] || CITY_LANDMARKS.lagos;
  const landmark = randomPick(landmarks);
  const streetNumber = faker.number.int({ min: 1, max: 150 });
  const streetType = randomPick(STREET_TYPES);

  // Various address formats
  const formats = [
    `${streetNumber} ${landmark} ${streetType}`,
    `${streetNumber}A ${landmark}`,
    `Block ${faker.string.alpha({ length: 1 }).toUpperCase()}, House ${streetNumber}, ${landmark}`,
    `Plot ${streetNumber}, ${landmark} ${streetType}`,
  ];

  return randomPick(formats);
}

/**
 * Create a test location
 */
export function createLocation(
  options: LocationFactoryOptions = {},
): TestLocation {
  const { city = "lagos", radiusKm = 10 } = options;
  const coords = randomLocationInCity(city, radiusKm);
  const cityData = AFRICAN_CITIES[city];

  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    address: generateStreetAddress(city),
    city: cityData?.name || "Lagos",
    country: cityData?.country || "Nigeria",
  };
}

/**
 * Create a saved location (home, work, favorite)
 */
export function createSavedLocation(
  options: SavedLocationFactoryOptions = {},
): TestSavedLocation {
  const { type = "home", city = "lagos", radiusKm = 10 } = options;
  const location = createLocation({ city, radiusKm });

  const names: Record<string, string[]> = {
    home: ["Home", "My House", "Residence"],
    work: ["Work", "Office", "Workplace"],
    favorite: [
      "Gym",
      "Restaurant",
      "Mall",
      "Friend's Place",
      "Parents' House",
      "Church",
      "Mosque",
    ],
  };

  return {
    id: uuid(),
    name: randomPick(names[type]),
    ...location,
    isFavorite: type === "favorite",
    createdAt: faker.date.past(),
  };
}

/**
 * Create a pickup-dropoff location pair for rides
 */
export function createRideLocations(options: LocationFactoryOptions = {}): {
  pickup: TestLocation;
  dropoff: TestLocation;
} {
  const { city = "lagos" } = options;

  // Pickup typically closer to center, dropoff can be further
  const pickup = createLocation({ city, radiusKm: 5 });
  const dropoff = createLocation({ city, radiusKm: 15 });

  return { pickup, dropoff };
}

/**
 * Calculate distance between two locations (Haversine formula)
 */
export function calculateDistance(
  loc1: { latitude: number; longitude: number },
  loc2: { latitude: number; longitude: number },
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((loc2.latitude - loc1.latitude) * Math.PI) / 180;
  const dLon = ((loc2.longitude - loc1.longitude) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((loc1.latitude * Math.PI) / 180) *
      Math.cos((loc2.latitude * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

/**
 * Calculate estimated ride duration based on distance
 */
export function calculateEstimatedDuration(distanceKm: number): number {
  // Average speed of 25 km/h in African urban traffic
  const averageSpeed = 25;
  return Math.ceil((distanceKm / averageSpeed) * 60); // Duration in minutes
}

/**
 * Get city coordinates
 */
export function getCityCoordinates(city: keyof typeof AFRICAN_CITIES): {
  latitude: number;
  longitude: number;
} {
  const cityData = AFRICAN_CITIES[city];
  if (!cityData) {
    throw new Error(`Unknown city: ${city}`);
  }
  return {
    latitude: cityData.latitude,
    longitude: cityData.longitude,
  };
}

/**
 * Create multiple locations
 */
export function createLocations(
  count: number,
  options?: LocationFactoryOptions,
): TestLocation[] {
  return Array.from({ length: count }, () => createLocation(options));
}

/**
 * Create a driver's location near a specific point
 */
export function createNearbyDriverLocation(
  origin: { latitude: number; longitude: number },
  maxDistanceKm: number = 2,
): { latitude: number; longitude: number } {
  const kmPerDegree = 111;
  const offset = maxDistanceKm / kmPerDegree;

  return {
    latitude: origin.latitude + (Math.random() - 0.5) * 2 * offset,
    longitude: origin.longitude + (Math.random() - 0.5) * 2 * offset,
  };
}
