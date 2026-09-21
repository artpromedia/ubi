/**
 * UBI Move - Ride Booking Card
 *
 * The main component for booking rides.
 */

"use client";

import { cn } from "@/lib/utils";
import { useLocationStore } from "@/store";
import { Button, Card, CardContent } from "@ubi/ui";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { LocationSearch } from "../shared/location-search";

interface RideBookingCardProps {
  className?: string;
}

/**
 * Location search is real. UBI's marketplace does not quote an instant fixed
 * price: the requester sets a fare within bounds, nearby drivers send private
 * offers, and the requester picks one. That flow isn't wired up in this web
 * shell yet, so we say so honestly instead of faking a price and a booking
 * confirmation that goes nowhere.
 */
export function RideBookingCard({ className }: RideBookingCardProps) {
  const [step, setStep] = useState<"location" | "unavailable">("location");
  const [pickupInput, setPickupInput] = useState("");
  const [dropoffInput, setDropoffInput] = useState("");

  const {
    selectedPickup,
    selectedDropoff,
    setSelectedPickup,
    setSelectedDropoff,
    swapLocations,
  } = useLocationStore();

  const handleSwapLocations = () => {
    swapLocations();
    const tempInput = pickupInput;
    setPickupInput(dropoffInput);
    setDropoffInput(tempInput);
  };

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
                onClick={() => setStep("unavailable")}
                disabled={!selectedPickup || !selectedDropoff}
                className="mt-4 w-full bg-ubi-green hover:bg-ubi-green/90"
                size="lg"
              >
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </motion.div>
          )}

          {step === "unavailable" && (
            <motion.div
              key="unavailable"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-4"
            >
              {/* Route summary */}
              <button
                onClick={() => setStep("location")}
                className="mb-4 flex w-full items-center gap-3 text-left"
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
              </button>

              <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">
                <p className="mb-2 font-medium text-gray-900 dark:text-white">
                  Requesting a ride from the web isn&apos;t available yet
                </p>
                <p>
                  In the UBI marketplace you set a fare within a suggested
                  range, nearby drivers send private offers, and you choose one
                  — nobody else sees another driver&apos;s offer. That flow runs
                  in the UBI app; it isn&apos;t wired up in this web preview, so
                  we&apos;re not going to fake a price or a booking here.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
