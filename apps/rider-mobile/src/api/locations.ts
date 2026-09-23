// Place search for the stop / destination picker, against ride-service's Maps-backed
// location routes THROUGH the gateway (/v1/locations/* → ride-service
// internal/handler/location.go). ride-service mounts them only when a Maps key is
// configured, and answers 503 MAPS_NOT_CONFIGURED while it is not — so every caller
// treats "no answer" as "search unavailable" and falls back to dropping a map pin.
//
// Shapes are the handler's own (snake_case, `success` flag, errors as
// { success: false, error: { code, message } }). Nothing here routes or prices anything:
// a picked place is only coordinates plus a label, which the quote validates.
import { api } from "@ubi/mobile-core";

export type PlacePrediction = {
  place_id: string;
  main_text: string;
  secondary_text: string;
  description: string;
};

export type PlaceDetails = {
  place_id: string;
  name: string;
  formatted_address: string;
  lat: number;
  lng: number;
};

export type ReverseAddress = {
  place_id: string;
  formatted_address: string;
  city: string;
  country: string;
};

// RN's URLSearchParams is only partially implemented; build the query by hand.
const qs = (pairs: [string, string | number | undefined][]) =>
  pairs
    .filter((p): p is [string, string | number] => p[1] !== undefined)
    .map(([k, v]) => k + "=" + encodeURIComponent(String(v)))
    .join("&");

export const locationsApi = {
  autocomplete: async (
    input: string,
    near?: { lat: number; lng: number },
  ): Promise<PlacePrediction[]> => {
    const r = await api<{ success: boolean; predictions?: PlacePrediction[] }>(
      "GET",
      "/v1/locations/autocomplete?" +
        qs([
          ["input", input],
          ["lat", near?.lat],
          ["lng", near?.lng],
        ]),
    );
    return r.predictions ?? [];
  },
  place: async (placeId: string): Promise<PlaceDetails> => {
    const r = await api<{ success: boolean; place: PlaceDetails }>(
      "GET",
      "/v1/locations/place?" + qs([["place_id", placeId]]),
    );
    return r.place;
  },
  geocode: async (
    address: string,
  ): Promise<{ lat: number; lng: number; formatted_address: string }> => {
    const r = await api<{
      success: boolean;
      location: { lat: number; lng: number; formatted_address: string };
    }>("GET", "/v1/locations/geocode?" + qs([["address", address]]));
    return r.location;
  },
  reverse: async (lat: number, lng: number): Promise<ReverseAddress> => {
    const r = await api<{ success: boolean; address: ReverseAddress }>(
      "GET",
      "/v1/locations/reverse?" +
        qs([
          ["lat", lat],
          ["lng", lng],
        ]),
    );
    return r.address;
  },
};
