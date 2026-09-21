// Profile, saved places and ride history against user-service THROUGH the
// gateway (C05 / G12). Routes verified in services/user-service/src/routes/users.ts:
//   GET    /v1/users/me                    -> { success, data: { user } }
//   PATCH  /v1/users/me                    -> { success, data: { user } }
//   GET    /v1/users/me/saved-places       -> { success, data: { places } }
//   POST   /v1/users/me/saved-places       -> { success, data: { place } }
//   DELETE /v1/users/me/saved-places/:id   -> { success, data }
//   GET    /v1/users/me/ride-history?page&limit -> { success, data: { rides, pagination } }
// Ride-history amounts come from the legacy prisma ride table; render them
// only via the fields the server actually serves.
import { api } from "@ubi/mobile-core";
import type { Envelope } from "./auth";

export type Profile = {
  id: string;
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  avatarUrl?: string | null;
  language?: string;
  country?: string;
};

export type SavedPlace = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  type: "home" | "work" | "other";
};

export type HistoryRide = {
  id: string;
  status: string;
  createdAt: string;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  finalFare?: number | string | null;
  estimatedFare?: number | string | null;
  currency?: string | null;
  driver?: {
    user?: {
      firstName?: string | null;
      lastName?: string | null;
    } | null;
    vehicle?: {
      make?: string | null;
      model?: string | null;
      color?: string | null;
      plateNumber?: string | null;
    } | null;
  } | null;
};

export type RideHistoryPage = {
  rides: HistoryRide[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export const accountApi = {
  me: async (): Promise<Profile> => {
    const r = await api<Envelope<{ user: Profile }>>("GET", "/v1/users/me");
    return r.data.user;
  },
  update: async (patch: {
    firstName?: string;
    lastName?: string;
    email?: string;
    language?: string;
  }): Promise<Profile> => {
    const r = await api<Envelope<{ user: Profile }>>(
      "PATCH",
      "/v1/users/me",
      patch,
    );
    return r.data.user;
  },
  savedPlaces: async (): Promise<SavedPlace[]> => {
    const r = await api<Envelope<{ places: SavedPlace[] }>>(
      "GET",
      "/v1/users/me/saved-places",
    );
    return r.data.places;
  },
  addSavedPlace: async (place: {
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    type: "home" | "work" | "other";
  }): Promise<SavedPlace> => {
    const r = await api<Envelope<{ place: SavedPlace }>>(
      "POST",
      "/v1/users/me/saved-places",
      place,
    );
    return r.data.place;
  },
  removeSavedPlace: async (id: string): Promise<void> => {
    await api<Envelope<{ message: string }>>(
      "DELETE",
      "/v1/users/me/saved-places/" + encodeURIComponent(id),
    );
  },
  rideHistory: async (page = 1, limit = 20): Promise<RideHistoryPage> => {
    const r = await api<Envelope<RideHistoryPage>>(
      "GET",
      "/v1/users/me/ride-history?page=" + page + "&limit=" + limit,
    );
    return r.data;
  },
};
