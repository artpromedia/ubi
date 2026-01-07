/**
 * UBI Move - Ride Booking Card
 *
 * The main component for booking rides.
 */

"use client";

import { VEHICLE_TYPES } from "@/lib/constants";
import { cn, formatDuration, formatPrice } from "@/lib/utils";
import { useLocationStore } from "@/store";
import { Button, Card, CardContent } from "@ubi/ui";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ArrowUpDown, ChevronRight, Clock, Users, Wallet } from "lucide-react";
import { useState } from "react";
import { LocationSearch } from "../shared/location-search";

interface RideEstimate {
  vehicleType: string;
  price: {
    amount: number;
    currency: string;
  };
  duration: number; // seconds
  distance: number; // meters
  surgeMultiplier?: number;
  eta: number; // seconds until pickup
}

interface RideBookingCardProps {
  className?: string;
}

export function RideBookingCard({ className }: RideBookingCardProps) {
  const [step, setStep] = useState<"location" | "vehicle" | "confirm">("location");
  const [pickupInput, setPickupInput] = useState("");
  const [dropoffInput, setDropoffInput] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);
  const [estimates, setEstimates] = useState<RideEstimate[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const {
    selectedPickup,
    selectedDropoff,
    setSelectedPickup,
    setSelectedDropoff,
    swapLocations,
  } = useLocationStore();

  const handleGetEstimates = async () => {
    if (!selectedPickup || !selectedDropoff) return;

    setIsLoading(true);
    try {
      // Simulate network delay for demo purposes
      // In production: const estimates = await rideApi.getEstimates(selectedPickup, selectedDropoff);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Generate sample estimates based on vehicle types and distance
      const sampleEstimates: RideEstimate[] = VEHICLE_TYPES.slice(0, 4).map((type) => ({
        vehicleType: type.id,
        price: {
          amount: Math.round(500 * type.multiplier + Math.random() * 200),
          currency: "KES",
        },
        duration: 900 + Math.random() * 600,
        distance: 5000 + Math.random() * 3000,
        eta: 180 + Math.random() * 300,
      }));

      setEstimates(sampleEstimates);
      setStep("vehicle");
    } catch (error) {
      console.error("Failed to get estimates:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBookRide = async () => {
    if (!selectedVehicle) return;

    setIsLoading(true);
    try {
      // Simulate booking confirmation
      // In production: const ride = await rideApi.bookRide({ pickup, dropoff, vehicleType });
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Ride booked successfully - would navigate to ride tracking page
      // router.push(`/ride/${ride.id}`);
    } catch (error) {
      console.error("Failed to book ride:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSwapLocations = () => {
    swapLocations();
    const tempInput = pickupInput;
    setPickupInput(dropoffInput);
    setDropoffInput(tempInput);
  };

  const selectedEstimate = estimates.find((e) => e.vehicleType === selectedVehicle);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardContent className="p-0">
        {/* Location Selection */}
        <AnimatePresence mode="wait">
          {step === "location" && (
            <motion.div
              key="location"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="p-4"
            >
              <h2 className="mb-4 text-lg font-semibold">Where to?</h2>

              <div className="relative space-y-3">
                {/* Pickup */}
                <LocationSearch
                  value={pickupInput}
                  onChange={setPickupInput}
                  onSelect={(result) => {
                    setSelectedPickup({
                      address: result.name,
                      coordinates: result.coordinates,
                    });
                    setPickupInput(result.name);
                  }}
                  placeholder="Pickup location"
                  type="pickup"
                />

                {/* Swap button */}
                <div className="absolute left-3 top-1/2 z-10 -translate-y-1/2">
                  <button
                    onClick={handleSwapLocations}
                    className="rounded-full border border-gray-200 bg-white p-1.5 shadow-sm transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <ArrowUpDown className="h-4 w-4" />
                  </button>
                </div>

                {/* Dropoff */}
                <LocationSearch
                  value={dropoffInput}
                  onChange={setDropoffInput}
                  onSelect={(result) => {
                    setSelectedDropoff({
                      address: result.name,
                      coordinates: result.coordinates,
                    });
                    setDropoffInput(result.name);
                  }}
                  placeholder="Dropoff location"
                  type="dropoff"
                />
              </div>

              <Button
                onClick={handleGetEstimates}
                disabled={!selectedPickup || !selectedDropoff || isLoading}
                className="mt-4 w-full bg-ubi-green hover:bg-ubi-green/90"
                size="lg"
              >
                {isLoading ? "Getting prices..." : "Get ride prices"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          )}

          {step === "vehicle" && (
            <motion.div
              key="vehicle"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              {/* Route summary */}
              <div className="border-b border-gray-200 p-4 dark:border-gray-700">
                <button
                  onClick={() => setStep("location")}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-ubi-green" />
                      <span className="text-sm">{selectedPickup?.address}</span>
                    </div>
                    <div className="ml-0.5 h-4 border-l-2 border-dashed border-gray-300" />
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full bg-ubi-bites" />
                      <span className="text-sm">{selectedDropoff?.address}</span>
                    </div>
                  </div>
                  <ChevronRight className="ml-auto h-5 w-5 text-gray-400" />
                </button>
              </div>

              {/* Vehicle options */}
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {estimates.map((estimate) => {
                  const vehicleInfo = VEHICLE_TYPES.find(
                    (v) => v.id === estimate.vehicleType
                  );
                  if (!vehicleInfo) return null;

                  const isSelected = selectedVehicle === estimate.vehicleType;

                  return (
                    <button
                      key={estimate.vehicleType}
                      onClick={() => setSelectedVehicle(estimate.vehicleType)}
                      className={cn(
                        "flex w-full items-center gap-4 p-4 text-left transition-colors",
                        isSelected
                          ? "bg-green-50 dark:bg-green-900/20"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800"
                      )}
                    >
                      {/* Vehicle icon placeholder */}
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-700">
                        <span className="text-2xl">🚗</span>
                      </div>

                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{vehicleInfo.name}</span>
                          <div className="flex items-center gap-1 text-sm text-gray-500">
                            <Users className="h-3.5 w-3.5" />
                            <span>{vehicleInfo.capacity}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{Math.round(estimate.eta / 60)} min away</span>
                          <span>•</span>
                          <span>{formatDuration(estimate.duration)}</span>
                        </div>
                        <p className="text-xs text-gray-400">
                          {vehicleInfo.description}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="font-semibold">
                          {formatPrice(estimate.price.amount, estimate.price.currency)}
                        </p>
                        {estimate.surgeMultiplier && estimate.surgeMultiplier > 1 && (
                          <span className="text-xs text-yellow-600">
                            {estimate.surgeMultiplier}x surge
                          </span>
                        )}
                      </div>

                      {isSelected && (
                        <div className="h-4 w-4 rounded-full bg-ubi-green">
                          <svg viewBox="0 0 16 16" fill="white" className="h-4 w-4">
                            <path d="M13.5 4.5l-7 7L3 8" stroke="white" strokeWidth="2" fill="none" />
                          </svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Payment method & confirm */}
              {selectedVehicle && selectedEstimate && (
                <div className="border-t border-gray-200 p-4 dark:border-gray-700">
                  {/* Payment method selector */}
                  <button className="mb-4 flex w-full items-center justify-between rounded-lg border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                    <div className="flex items-center gap-3">
                      <Wallet className="h-5 w-5 text-gray-500" />
                      <span className="font-medium">UBI Wallet</span>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </button>

                  <Button
                    onClick={handleBookRide}
                    disabled={isLoading}
                    className="w-full bg-ubi-green hover:bg-ubi-green/90"
                    size="lg"
                  >
                    {isLoading
                      ? "Confirming..."
                      : `Request ${VEHICLE_TYPES.find((v) => v.id === selectedVehicle)?.name}`}
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
