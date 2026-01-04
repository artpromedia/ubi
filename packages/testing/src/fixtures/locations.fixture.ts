/**
 * Location Fixtures
 *
 * Pre-defined test locations for African cities.
 */

import type { TestLocation } from "../types";

/**
 * Popular locations in Lagos, Nigeria
 */
export const LAGOS_LOCATIONS: Record<string, TestLocation> = {
  VICTORIA_ISLAND: {
    latitude: 6.4281,
    longitude: 3.4219,
    address: "15 Adeola Odeku Street, Victoria Island",
    city: "Lagos",
    country: "Nigeria",
  },
  IKEJA: {
    latitude: 6.6018,
    longitude: 3.3515,
    address: "Ikeja City Mall, Alausa",
    city: "Lagos",
    country: "Nigeria",
  },
  LEKKI: {
    latitude: 6.4698,
    longitude: 3.5852,
    address: "Circle Mall, Lekki Phase 1",
    city: "Lagos",
    country: "Nigeria",
  },
  YABA: {
    latitude: 6.5158,
    longitude: 3.3795,
    address: "UNILAG Main Gate, Yaba",
    city: "Lagos",
    country: "Nigeria",
  },
  AIRPORT: {
    latitude: 6.5774,
    longitude: 3.3212,
    address: "Murtala Muhammed International Airport",
    city: "Lagos",
    country: "Nigeria",
  },
  SURULERE: {
    latitude: 6.5059,
    longitude: 3.3509,
    address: "National Stadium, Surulere",
    city: "Lagos",
    country: "Nigeria",
  },
  IKOYI: {
    latitude: 6.4541,
    longitude: 3.4354,
    address: "Ikoyi Club, Ikoyi",
    city: "Lagos",
    country: "Nigeria",
  },
};

/**
 * Popular locations in Nairobi, Kenya
 */
export const NAIROBI_LOCATIONS: Record<string, TestLocation> = {
  WESTLANDS: {
    latitude: -1.2635,
    longitude: 36.8026,
    address: "Sarit Centre, Westlands",
    city: "Nairobi",
    country: "Kenya",
  },
  CBD: {
    latitude: -1.2833,
    longitude: 36.8167,
    address: "Kenyatta Avenue, CBD",
    city: "Nairobi",
    country: "Kenya",
  },
  KAREN: {
    latitude: -1.3226,
    longitude: 36.7134,
    address: "Karen Shopping Centre",
    city: "Nairobi",
    country: "Kenya",
  },
  KILIMANI: {
    latitude: -1.2864,
    longitude: 36.7834,
    address: "Yaya Centre, Kilimani",
    city: "Nairobi",
    country: "Kenya",
  },
  JKIA: {
    latitude: -1.3192,
    longitude: 36.9278,
    address: "Jomo Kenyatta International Airport",
    city: "Nairobi",
    country: "Kenya",
  },
  GIGIRI: {
    latitude: -1.2348,
    longitude: 36.8059,
    address: "UN Complex, Gigiri",
    city: "Nairobi",
    country: "Kenya",
  },
};

/**
 * Popular locations in Accra, Ghana
 */
export const ACCRA_LOCATIONS: Record<string, TestLocation> = {
  OSU: {
    latitude: 5.5572,
    longitude: -0.1823,
    address: "Oxford Street, Osu",
    city: "Accra",
    country: "Ghana",
  },
  AIRPORT_CITY: {
    latitude: 5.6051,
    longitude: -0.1697,
    address: "Airport City Mall",
    city: "Accra",
    country: "Ghana",
  },
  EAST_LEGON: {
    latitude: 5.6389,
    longitude: -0.1536,
    address: "A&C Mall, East Legon",
    city: "Accra",
    country: "Ghana",
  },
  KOTOKA_AIRPORT: {
    latitude: 5.6052,
    longitude: -0.1668,
    address: "Kotoka International Airport",
    city: "Accra",
    country: "Ghana",
  },
};

/**
 * Popular locations in Johannesburg, South Africa
 */
export const JOHANNESBURG_LOCATIONS: Record<string, TestLocation> = {
  SANDTON: {
    latitude: -26.1076,
    longitude: 28.0567,
    address: "Sandton City Mall",
    city: "Johannesburg",
    country: "South Africa",
  },
  ROSEBANK: {
    latitude: -26.1456,
    longitude: 28.0436,
    address: "Rosebank Mall",
    city: "Johannesburg",
    country: "South Africa",
  },
  OR_TAMBO: {
    latitude: -26.1367,
    longitude: 28.2411,
    address: "OR Tambo International Airport",
    city: "Johannesburg",
    country: "South Africa",
  },
  MELROSE_ARCH: {
    latitude: -26.1345,
    longitude: 28.0689,
    address: "Melrose Arch",
    city: "Johannesburg",
    country: "South Africa",
  },
};

/**
 * All test locations by city
 */
export const TEST_LOCATIONS = {
  lagos: LAGOS_LOCATIONS,
  nairobi: NAIROBI_LOCATIONS,
  accra: ACCRA_LOCATIONS,
  johannesburg: JOHANNESBURG_LOCATIONS,
};

/**
 * Common pickup-dropoff pairs for testing rides
 */
export const RIDE_ROUTES = {
  LAGOS_SHORT: {
    pickup: LAGOS_LOCATIONS.VICTORIA_ISLAND,
    dropoff: LAGOS_LOCATIONS.IKOYI,
    estimatedDistance: 2.5, // km
    estimatedDuration: 10, // minutes
  },
  LAGOS_MEDIUM: {
    pickup: LAGOS_LOCATIONS.IKEJA,
    dropoff: LAGOS_LOCATIONS.VICTORIA_ISLAND,
    estimatedDistance: 15,
    estimatedDuration: 45,
  },
  LAGOS_AIRPORT: {
    pickup: LAGOS_LOCATIONS.VICTORIA_ISLAND,
    dropoff: LAGOS_LOCATIONS.AIRPORT,
    estimatedDistance: 25,
    estimatedDuration: 60,
  },
  NAIROBI_SHORT: {
    pickup: NAIROBI_LOCATIONS.KILIMANI,
    dropoff: NAIROBI_LOCATIONS.WESTLANDS,
    estimatedDistance: 4,
    estimatedDuration: 15,
  },
  NAIROBI_AIRPORT: {
    pickup: NAIROBI_LOCATIONS.WESTLANDS,
    dropoff: NAIROBI_LOCATIONS.JKIA,
    estimatedDistance: 20,
    estimatedDuration: 40,
  },
};

/**
 * Test geofence areas
 */
export const GEOFENCE_AREAS = {
  LAGOS_OPERATIONAL: {
    center: { latitude: 6.5244, longitude: 3.3792 },
    radiusKm: 50,
    name: "Lagos Operational Area",
  },
  NAIROBI_OPERATIONAL: {
    center: { latitude: -1.2921, longitude: 36.8219 },
    radiusKm: 40,
    name: "Nairobi Operational Area",
  },
  ACCRA_OPERATIONAL: {
    center: { latitude: 5.6037, longitude: -0.187 },
    radiusKm: 30,
    name: "Accra Operational Area",
  },
};
