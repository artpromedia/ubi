-- Allow driver-reported "service_soon" issues to open a fleet-visible
-- `vehicle_service_requested` conflict row on `fleet_conflicts`.
ALTER TABLE "fleet_conflicts" DROP CONSTRAINT IF EXISTS "fleet_conflicts_type_check";
ALTER TABLE "fleet_conflicts" ADD CONSTRAINT "fleet_conflicts_type_check" CHECK (
  "type" IN (
    'maintenance_overlaps_booking',
    'unplanned_off_road',
    'document_expiring',
    'document_expires_in_booking',
    'time_off_overlaps_booking',
    'termination_bookings',
    'vehicle_service_requested'
  )
);
