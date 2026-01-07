/**
 * Location Search Input
 *
 * Autocomplete search for pickup/dropoff locations.
 */

"use client";

import { useDebounce, useGeolocation } from "@/hooks";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/store";
import { Input } from "@ubi/ui";
import type { Coordinates } from "@ubi/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  Clock,
  Loader2,
  MapPin,
  Navigation,
  Search,
  Star,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface LocationResult {
  id: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  type: "place" | "saved" | "recent" | "current";
}

interface LocationSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (result: LocationResult) => void;
  placeholder?: string;
  label?: string;
  type?: "pickup" | "dropoff";
  className?: string;
}

export function LocationSearch({
  value,
  onChange,
  onSelect,
  placeholder = "Search location",
  label,
  type = "pickup",
  className,
}: LocationSearchProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<LocationResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedValue = useDebounce(value, 300);

  const { savedAddresses } = useUserStore();
  const {
    location: currentLocation,
    requestLocation,
    isLoading: isLoadingLocation,
  } = useGeolocation();

  // Search for places when input changes
  useEffect(() => {
    if (!debouncedValue || debouncedValue.length < 2) {
      setResults([]);
      return;
    }

    const searchPlaces = async () => {
      setIsLoading(true);
      try {
        // Simulate autocomplete search
        // In production: const results = await placesApi.autocomplete(debouncedValue);
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Generate sample results based on search query
        const sampleResults: LocationResult[] = [
          {
            id: "1",
            name: debouncedValue,
            address: "123 Sample Street, Nairobi",
            coordinates: { latitude: -1.2921, longitude: 36.8219 },
            type: "place",
          },
          {
            id: "2",
            name: `${debouncedValue} Mall`,
            address: "456 Shopping Ave, Nairobi",
            coordinates: { latitude: -1.2821, longitude: 36.8119 },
            type: "place",
          },
        ];

        setResults(sampleResults);
      } catch (error) {
        console.error("Search error:", error);
        setResults([]);
      } finally {
        setIsLoading(false);
      }
    };

    searchPlaces();
  }, [debouncedValue]);

  // Build suggestions list (saved places, recent, current location)
  const getSuggestions = useCallback((): LocationResult[] => {
    const suggestions: LocationResult[] = [];

    // Current location option
    if (type === "pickup" && currentLocation) {
      suggestions.push({
        id: "current-location",
        name: "Current Location",
        address: "Use your current location",
        coordinates: currentLocation,
        type: "current",
      });
    }

    // Saved addresses
    savedAddresses.forEach((addr) => {
      suggestions.push({
        id: addr.id,
        name: addr.label,
        address: addr.address,
        coordinates: addr.coordinates,
        type: "saved",
      });
    });

    return suggestions;
  }, [savedAddresses, currentLocation, type]);

  const handleSelect = (result: LocationResult) => {
    onChange(result.name);
    onSelect(result);
    setIsFocused(false);
    inputRef.current?.blur();
  };

  const handleUseCurrentLocation = async () => {
    await requestLocation();
    if (currentLocation) {
      handleSelect({
        id: "current-location",
        name: "Current Location",
        address: "Your current location",
        coordinates: currentLocation,
        type: "current",
      });
    }
  };

  const displayResults = value.length > 1 ? results : getSuggestions();

  return (
    <div className={cn("relative", className)}>
      {label && (
        <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}

      <div className="relative">
        <div
          className={cn(
            "absolute left-3 top-1/2 -translate-y-1/2",
            type === "pickup" ? "text-ubi-green" : "text-ubi-bites"
          )}
        >
          <MapPin className="h-5 w-5" />
        </div>

        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          placeholder={placeholder}
          className="pl-10 pr-10"
        />

        {value && (
          <button
            onClick={() => onChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          </div>
        )}
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {isFocused && (displayResults.length > 0 || type === "pickup") && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            {/* Use current location */}
            {type === "pickup" && !value && (
              <button
                onClick={handleUseCurrentLocation}
                disabled={isLoadingLocation}
                className="flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400">
                  {isLoadingLocation ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Navigation className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <p className="font-medium">Use Current Location</p>
                  <p className="text-sm text-gray-500">Locate me on the map</p>
                </div>
              </button>
            )}

            {/* Results */}
            {displayResults.map((result) => (
              <button
                key={result.id}
                onClick={() => handleSelect(result)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full",
                    result.type === "saved"
                      ? "bg-yellow-100 text-yellow-600 dark:bg-yellow-900 dark:text-yellow-400"
                      : result.type === "recent"
                        ? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                        : result.type === "current"
                          ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                  )}
                >
                  {result.type === "saved" ? (
                    <Star className="h-5 w-5" />
                  ) : result.type === "recent" ? (
                    <Clock className="h-5 w-5" />
                  ) : result.type === "current" ? (
                    <Navigation className="h-5 w-5" />
                  ) : (
                    <MapPin className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{result.name}</p>
                  <p className="truncate text-sm text-gray-500">
                    {result.address}
                  </p>
                </div>
              </button>
            ))}

            {/* No results */}
            {value.length > 1 && !isLoading && results.length === 0 && (
              <div className="px-4 py-8 text-center text-gray-500">
                <Search className="mx-auto mb-2 h-8 w-8" />
                <p>No locations found</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
