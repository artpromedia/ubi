"use client";

import { useParams } from "next/navigation";

import { VehicleDetailScreen } from "@/components/vehicle/VehicleDetail";

/** B4: one vehicle — documents, maintenance, drivers and the week's money lines. */
const VehiclePage = () => {
  const params = useParams<{ vehicleId: string }>();
  const vehicleId =
    typeof params.vehicleId === "string"
      ? decodeURIComponent(params.vehicleId)
      : "";
  return <VehicleDetailScreen vehicleId={vehicleId} />;
};

export default VehiclePage;
