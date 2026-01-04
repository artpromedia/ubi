/**
 * Ride Service Helpers
 *
 * API helpers for ride-hailing functionality
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { getBaseUrl, generateLocation } from "../config";
import { createHeaders, rideRequests, ApiResponse } from "./http";

export interface Location {
  latitude: number;
  longitude: number;
  address?: string;
}

export interface RideEstimate {
  rideType: string;
  price: number;
  currency: string;
  estimatedDuration: number;
  estimatedDistance: number;
  surgeMultiplier?: number;
}

export interface Ride {
  id: string;
  status: string;
  pickup: Location;
  dropoff: Location;
  rideType: string;
  pricing: {
    baseFare: number;
    total: number;
    currency: string;
  };
  driver?: {
    id: string;
    firstName: string;
    rating: number;
    vehicle: {
      model: string;
      plateNumber: string;
    };
  };
  estimatedArrival?: number;
}

// Request ride estimate
export function getRideEstimate(
  accessToken: string,
  pickup: Location,
  dropoff: Location
): RideEstimate[] | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/rides/estimate`;

  const response = http.post(
    url,
    JSON.stringify({ pickup, dropoff }),
    { headers: createHeaders(accessToken) }
  );

  rideRequests.add(1);

  const passed = check(response, {
    "Ride estimate - status is 200": (r) => r.status === 200,
    "Ride estimate - has estimates": (r) => {
      try {
        const body = JSON.parse(r.body as string) as ApiResponse<{
          estimates: RideEstimate[];
        }>;
        return body.data?.estimates && body.data.estimates.length > 0;
      } catch {
        return false;
      }
    },
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      estimates: RideEstimate[];
    }>;
    return body.data?.estimates || null;
  } catch {
    return null;
  }
}

// Request a ride
export function requestRide(
  accessToken: string,
  pickup: Location,
  dropoff: Location,
  rideType: string = "economy"
): Ride | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/rides`;

  const response = http.post(
    url,
    JSON.stringify({
      pickup,
      dropoff,
      rideType,
      paymentMethod: "wallet",
    }),
    { headers: createHeaders(accessToken) }
  );

  rideRequests.add(1);

  const passed = check(response, {
    "Request ride - status is 201": (r) => r.status === 201,
    "Request ride - returns ride": (r) => {
      try {
        const body = JSON.parse(r.body as string) as ApiResponse<{
          ride: Ride;
        }>;
        return body.data?.ride?.id !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      ride: Ride;
    }>;
    return body.data?.ride || null;
  } catch {
    return null;
  }
}

// Get ride status
export function getRideStatus(
  accessToken: string,
  rideId: string
): Ride | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/rides/${rideId}`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Get ride - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      ride: Ride;
    }>;
    return body.data?.ride || null;
  } catch {
    return null;
  }
}

// Cancel ride
export function cancelRide(
  accessToken: string,
  rideId: string,
  reason: string = "user_cancelled"
): boolean {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/rides/${rideId}/cancel`;

  const response = http.post(
    url,
    JSON.stringify({ reason }),
    { headers: createHeaders(accessToken) }
  );

  return check(response, {
    "Cancel ride - status is 200": (r) => r.status === 200,
  });
}

// Rate ride
export function rateRide(
  accessToken: string,
  rideId: string,
  rating: number,
  comment?: string
): boolean {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/rides/${rideId}/rate`;

  const response = http.post(
    url,
    JSON.stringify({ rating, comment }),
    { headers: createHeaders(accessToken) }
  );

  return check(response, {
    "Rate ride - status is 200": (r) => r.status === 200,
  });
}

// Get nearby drivers
export function getNearbyDrivers(
  accessToken: string,
  location: Location
): { id: string; location: Location }[] | null {
  const baseUrl = getBaseUrl("apiGateway");
  const url = `${baseUrl}/api/v1/drivers/nearby?lat=${location.latitude}&lng=${location.longitude}`;

  const response = http.get(url, {
    headers: createHeaders(accessToken),
  });

  const passed = check(response, {
    "Nearby drivers - status is 200": (r) => r.status === 200,
  });

  if (!passed) return null;

  try {
    const body = JSON.parse(response.body as string) as ApiResponse<{
      drivers: { id: string; location: Location }[];
    }>;
    return body.data?.drivers || [];
  } catch {
    return null;
  }
}

// Full ride flow simulation
export function simulateRideFlow(
  accessToken: string,
  city: string = "lagos"
): boolean {
  // Generate random pickup and dropoff within city
  const pickup = generateLocation(city);
  const dropoff = generateLocation(city);

  // Step 1: Get ride estimate
  const estimates = getRideEstimate(accessToken, {
    latitude: pickup.lat,
    longitude: pickup.lng,
  }, {
    latitude: dropoff.lat,
    longitude: dropoff.lng,
  });

  if (!estimates || estimates.length === 0) {
    console.error("Failed to get ride estimates");
    return false;
  }

  sleep(1); // User thinks about price

  // Step 2: Request ride
  const ride = requestRide(
    accessToken,
    { latitude: pickup.lat, longitude: pickup.lng },
    { latitude: dropoff.lat, longitude: dropoff.lng },
    "economy"
  );

  if (!ride) {
    console.error("Failed to request ride");
    return false;
  }

  // Step 3: Poll for driver (simplified)
  let attempts = 0;
  let currentRide = ride;

  while (attempts < 10 && currentRide.status === "searching") {
    sleep(2); // Wait 2 seconds between polls
    const updatedRide = getRideStatus(accessToken, ride.id);
    if (updatedRide) {
      currentRide = updatedRide;
    }
    attempts++;
  }

  // For load testing, we'll consider it successful if the ride was created
  return true;
}
