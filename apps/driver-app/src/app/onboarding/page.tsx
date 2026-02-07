"use client";

import { useDriverStore } from "@/store/driver-store";
import { Car, CheckCircle, ChevronRight, FileText, MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Step {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  completed: boolean;
}

// Helper function for step circle styling
function getStepCircleClass(
  index: number,
  currentStep: number,
  completed: boolean,
): string {
  if (index === currentStep) {
    return "bg-primary text-white";
  }
  if (completed) {
    return "bg-green-500 text-white";
  }
  return "bg-gray-100 text-gray-400";
}

export default function OnboardingPage() {
  const router = useRouter();
  const { setOnboarded } = useDriverStore();
  const [currentStep, setCurrentStep] = useState(0);

  const steps: Step[] = [
    {
      id: "vehicle",
      title: "Vehicle Information",
      description: "Add your vehicle details",
      icon: <Car className="h-6 w-6" />,
      completed: currentStep > 0,
    },
    {
      id: "documents",
      title: "Upload Documents",
      description: "Required documents for verification",
      icon: <FileText className="h-6 w-6" />,
      completed: currentStep > 1,
    },
    {
      id: "areas",
      title: "Preferred Areas",
      description: "Set your driving zones",
      icon: <MapPin className="h-6 w-6" />,
      completed: currentStep > 2,
    },
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Complete onboarding
      setOnboarded(true);
      router.push("/dashboard");
    }
  };

  const handleSkip = () => {
    setOnboarded(true);
    router.push("/dashboard");
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="mx-auto w-full max-w-lg lg:max-w-md flex flex-col flex-1">
        {/* Progress Bar */}
        <div className="fixed top-0 left-0 right-0 h-1 bg-gray-100 z-10 max-w-lg lg:max-w-md mx-auto">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-12 pb-4">
          <h1 className="text-xl font-bold text-gray-900">Getting Started</h1>
          <button
            onClick={handleSkip}
            className="text-sm font-medium text-gray-500 hover:text-gray-700"
          >
            Skip for now
          </button>
        </div>

        {/* Steps Progress */}
        <div className="px-4 py-4">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full ${getStepCircleClass(index, currentStep, step.completed)}`}
                >
                  {step.completed ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    <span className="font-bold">{index + 1}</span>
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`h-0.5 w-12 mx-2 ${
                      step.completed ? "bg-green-500" : "bg-gray-200"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 px-4 py-8">
          {currentStep === 0 && <VehicleStep />}
          {currentStep === 1 && <DocumentsStep />}
          {currentStep === 2 && <AreasStep />}
        </div>

        {/* Footer */}
        <div className="border-t p-4">
          <button
            onClick={handleNext}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-4 font-semibold text-white hover:bg-primary-600"
          >
            {currentStep === steps.length - 1 ? "Get Started" : "Continue"}
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function VehicleStep() {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <Car className="h-10 w-10 text-primary" />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-gray-900">
          Vehicle Information
        </h2>
        <p className="mt-2 text-gray-600">
          Tell us about your vehicle so we can match you with the right trips.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label
            htmlFor="vehicle-type"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            Vehicle Type
          </label>
          <select
            id="vehicle-type"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 p-4 text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Select vehicle type</option>
            <option value="bike">Motorcycle</option>
            <option value="sedan">Sedan</option>
            <option value="suv">SUV</option>
            <option value="van">Van</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="vehicle-model"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            Vehicle Make & Model
          </label>
          <input
            id="vehicle-model"
            type="text"
            placeholder="e.g., Toyota Corolla"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 p-4 text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div>
          <label
            htmlFor="license-plate"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            License Plate
          </label>
          <input
            id="license-plate"
            type="text"
            placeholder="e.g., KBZ 123A"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 p-4 text-gray-900 uppercase placeholder:text-gray-400 placeholder:normal-case focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div>
          <label
            htmlFor="vehicle-year"
            className="mb-2 block text-sm font-medium text-gray-700"
          >
            Year of Manufacture
          </label>
          <select
            id="vehicle-year"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 p-4 text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">Select year</option>
            {Array.from({ length: 20 }, (_, i) => 2026 - i).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function DocumentsStep() {
  const documents = [
    { name: "Driver's License", required: true, uploaded: false },
    { name: "National ID / Passport", required: true, uploaded: false },
    { name: "Vehicle Insurance", required: true, uploaded: false },
    { name: "PSV License", required: true, uploaded: false },
    { name: "Good Conduct Certificate", required: true, uploaded: false },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <FileText className="h-10 w-10 text-primary" />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-gray-900">
          Upload Documents
        </h2>
        <p className="mt-2 text-gray-600">
          We need to verify your documents before you can start accepting trips.
        </p>
      </div>

      <div className="space-y-3">
        {documents.map((doc) => (
          <div
            key={doc.name}
            className="flex items-center justify-between rounded-xl border border-gray-200 p-4"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-gray-400" />
              <div>
                <p className="font-medium text-gray-900">{doc.name}</p>
                {doc.required && (
                  <p className="text-xs text-red-500">Required</p>
                )}
              </div>
            </div>
            <button className="rounded-lg bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20">
              Upload
            </button>
          </div>
        ))}
      </div>

      <p className="text-center text-sm text-gray-500">
        You can upload documents later from your profile settings.
      </p>
    </div>
  );
}

function AreasStep() {
  const areas = [
    { name: "Nairobi CBD", selected: true },
    { name: "Westlands", selected: true },
    { name: "Kilimani", selected: false },
    { name: "Karen", selected: false },
    { name: "Langata", selected: false },
    { name: "Eastlands", selected: false },
    { name: "Kasarani", selected: false },
    { name: "JKIA Area", selected: true },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <MapPin className="h-10 w-10 text-primary" />
        </div>
        <h2 className="mt-4 text-2xl font-bold text-gray-900">
          Preferred Areas
        </h2>
        <p className="mt-2 text-gray-600">
          Select the areas where you prefer to receive trip requests.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {areas.map((area) => (
          <button
            key={area.name}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              area.selected
                ? "bg-primary text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {area.name}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-gray-50 p-4">
        <p className="text-sm text-gray-600">
          💡 <strong>Tip:</strong> Selecting popular areas like CBD and JKIA can
          help you receive more trip requests.
        </p>
      </div>
    </div>
  );
}
