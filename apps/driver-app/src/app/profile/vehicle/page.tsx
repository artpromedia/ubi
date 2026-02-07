"use client";

import { driverService } from "@/lib/driver-service";
import { useDriverStore } from "@/store/driver-store";
import {
  AlertCircle,
  Calendar,
  Car,
  CheckCircle,
  ChevronLeft,
  Save,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const vehicleTypes = [
  { id: "SEDAN", name: "Sedan", icon: "🚗" },
  { id: "SUV", name: "SUV", icon: "🚙" },
  { id: "VAN", name: "Van", icon: "🚐" },
  { id: "MOTORCYCLE", name: "Motorcycle", icon: "🏍️" },
  { id: "ELECTRIC", name: "Electric", icon: "⚡" },
];

const colors = [
  { name: "White", value: "#FFFFFF" },
  { name: "Black", value: "#000000" },
  { name: "Silver", value: "#C0C0C0" },
  { name: "Gray", value: "#808080" },
  { name: "Red", value: "#FF0000" },
  { name: "Blue", value: "#0000FF" },
  { name: "Green", value: "#008000" },
  { name: "Yellow", value: "#FFD700" },
];

export default function VehiclePage() {
  const { profile, setProfile } = useDriverStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [formData, setFormData] = useState({
    vehicleType: profile?.vehicleType || "SEDAN",
    make: "Toyota",
    model: profile?.vehicleModel?.split(" ")[0] || "",
    year: new Date().getFullYear(),
    color: "White",
    plateNumber: profile?.vehiclePlate || "",
    isElectric: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await driverService.updateVehicle({
        make: formData.make,
        model: formData.model,
        year: formData.year,
        color: formData.color,
        plateNumber: formData.plateNumber,
      });

      if (response.success) {
        if (profile) {
          setProfile({
            ...profile,
            vehicleType: formData.vehicleType,
            vehiclePlate: formData.plateNumber,
            vehicleModel: `${formData.make} ${formData.model} ${formData.year}`,
          });
        }
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(response.error?.message || "Failed to update vehicle");
      }
    } catch (err) {
      console.error("Failed to update vehicle:", err);
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <div className="mx-auto w-full max-w-lg lg:max-w-md">
        {/* Header */}
        <div className="bg-ubi-black px-4 pb-6 pt-12">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/profile"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
              >
                <ChevronLeft className="h-5 w-5" />
              </Link>
              <h1 className="text-xl font-bold text-white">Vehicle Details</h1>
            </div>
            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Save
            </button>
          </div>
        </div>

        <div className="px-4 py-6">
          {/* Success message */}
          {success && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-green-700">
              <CheckCircle className="h-5 w-5" />
              <span>Vehicle updated successfully!</span>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-700">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Vehicle Type */}
            <fieldset>
              <legend className="mb-3 block text-sm font-medium text-gray-700">
                Vehicle Type
              </legend>
              <div className="grid grid-cols-3 gap-3">
                {vehicleTypes.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, vehicleType: type.id })
                    }
                    className={`flex flex-col items-center justify-center rounded-xl border-2 p-4 transition-colors ${
                      formData.vehicleType === type.id
                        ? "border-primary bg-primary/5"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span className="text-2xl">{type.icon}</span>
                    <span className="mt-2 text-sm font-medium text-gray-700">
                      {type.name}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Make & Model */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="vehicle-make"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Make
                </label>
                <input
                  id="vehicle-make"
                  type="text"
                  value={formData.make}
                  onChange={(e) =>
                    setFormData({ ...formData, make: e.target.value })
                  }
                  placeholder="e.g. Toyota"
                  className="w-full rounded-xl border border-gray-200 bg-white py-3 px-4 text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label
                  htmlFor="vehicle-model"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Model
                </label>
                <input
                  id="vehicle-model"
                  type="text"
                  value={formData.model}
                  onChange={(e) =>
                    setFormData({ ...formData, model: e.target.value })
                  }
                  placeholder="e.g. Corolla"
                  className="w-full rounded-xl border border-gray-200 bg-white py-3 px-4 text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Year */}
            <div>
              <label
                htmlFor="vehicle-year"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Year
              </label>
              <div className="relative">
                <Calendar className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <select
                  id="vehicle-year"
                  value={formData.year}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      year: Number.parseInt(e.target.value, 10),
                    })
                  }
                  className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {Array.from(
                    { length: 30 },
                    (_, i) => new Date().getFullYear() - i,
                  ).map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Color */}
            <fieldset>
              <legend className="mb-3 block text-sm font-medium text-gray-700">
                Color
              </legend>
              <div className="flex flex-wrap gap-3">
                {colors.map((color) => (
                  <button
                    key={color.name}
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, color: color.name })
                    }
                    className={`flex items-center gap-2 rounded-full border-2 px-4 py-2 ${
                      formData.color === color.name
                        ? "border-primary bg-primary/5"
                        : "border-gray-200"
                    }`}
                  >
                    <div
                      className="h-4 w-4 rounded-full border border-gray-300"
                      style={{ backgroundColor: color.value }}
                    />
                    <span className="text-sm font-medium">{color.name}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Plate Number */}
            <div>
              <label
                htmlFor="vehicle-plate"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Plate Number
              </label>
              <div className="relative">
                <Car className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                <input
                  id="vehicle-plate"
                  type="text"
                  value={formData.plateNumber}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      plateNumber: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="e.g. KBZ 123A"
                  className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-gray-900 uppercase focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            {/* Electric Vehicle Toggle */}
            <div className="flex items-center justify-between rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚡</span>
                <div>
                  <p className="font-medium text-gray-900">Electric Vehicle</p>
                  <p className="text-sm text-gray-500">
                    Mark if your vehicle is electric
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setFormData({ ...formData, isElectric: !formData.isElectric })
                }
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  formData.isElectric ? "bg-primary" : "bg-gray-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    formData.isElectric ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-xl bg-primary py-4 font-bold text-white disabled:opacity-50"
            >
              {isLoading ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
