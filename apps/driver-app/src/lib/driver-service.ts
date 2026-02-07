/**
 * Driver Service
 *
 * Handles driver-specific operations including status, location,
 * documents, and earnings.
 */

import apiClient, { type ApiResponse } from "./api-client";

// ============================================
// Types
// ============================================

export type DriverStatus = "offline" | "online" | "busy" | "break";

export interface DriverApplication {
  licenseNumber: string;
  licenseExpiry: string;
  vehicleType: "SEDAN" | "SUV" | "VAN" | "MOTORCYCLE" | "ELECTRIC";
  vehicle: {
    make: string;
    model: string;
    year: number;
    color: string;
    plateNumber: string;
    capacity?: number;
    isElectric?: boolean;
  };
}

export interface DriverDocument {
  id: string;
  type:
    | "license"
    | "insurance"
    | "vehicle_registration"
    | "profile_photo"
    | "vehicle_photo"
    | "psv"
    | "good_conduct";
  status: "pending" | "verified" | "rejected";
  url?: string;
  expiresAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DriverStats {
  today: {
    earnings: number;
    trips: number;
    hours: number;
    tips: number;
  };
  week: {
    earnings: number;
    trips: number;
    hours: number;
    tips: number;
  };
  month: {
    earnings: number;
    trips: number;
    hours: number;
    tips: number;
  };
  overall: {
    totalEarnings: number;
    totalTrips: number;
    rating: number;
    acceptanceRate: number;
    cancellationRate: number;
  };
}

export interface DriverEarnings {
  period: "day" | "week" | "month";
  total: number;
  trips: number;
  hours: number;
  tips: number;
  bonus: number;
  breakdown: Array<{
    label: string;
    amount: number;
  }>;
}

export interface LocationUpdate {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
}

// ============================================
// Service
// ============================================

export const driverService = {
  /**
   * Submit driver application
   */
  async submitApplication(
    data: DriverApplication,
  ): Promise<ApiResponse<{ driver: { id: string; status: string } }>> {
    return apiClient.post("/drivers/apply", data);
  },

  /**
   * Update driver profile
   */
  async updateProfile(data: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    photoUrl?: string;
  }): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.patch("/drivers/profile", data);
  },

  /**
   * Update driver status (online/offline)
   */
  async updateStatus(
    isOnline: boolean,
    isAvailable?: boolean,
  ): Promise<ApiResponse<{ status: string }>> {
    return apiClient.patch("/drivers/status", { isOnline, isAvailable });
  },

  /**
   * Update driver location
   */
  async updateLocation(
    location: LocationUpdate,
  ): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.post("/drivers/location", location);
  },

  /**
   * Get driver stats
   */
  async getStats(): Promise<ApiResponse<DriverStats>> {
    return apiClient.get("/drivers/stats");
  },

  /**
   * Get earnings for a period
   */
  async getEarnings(
    period: "day" | "week" | "month",
    date?: string,
  ): Promise<ApiResponse<DriverEarnings>> {
    const params: Record<string, string> = { period };
    if (date) params.date = date;
    return apiClient.get("/drivers/earnings", params);
  },

  /**
   * Get documents
   */
  async getDocuments(): Promise<ApiResponse<DriverDocument[]>> {
    return apiClient.get("/drivers/documents");
  },

  /**
   * Upload document
   */
  async uploadDocument(
    type: DriverDocument["type"],
    documentUrl: string,
  ): Promise<ApiResponse<DriverDocument>> {
    return apiClient.post("/drivers/documents", {
      documentType: type,
      documentUrl,
    });
  },

  /**
   * Get driver profile
   */
  async getProfile(): Promise<
    ApiResponse<{
      id: string;
      rating: number;
      totalTrips: number;
      isOnline: boolean;
      isAvailable: boolean;
      vehicle: {
        make: string;
        model: string;
        year: number;
        color: string;
        plateNumber: string;
      };
    }>
  > {
    return apiClient.get("/drivers/me");
  },

  /**
   * Update vehicle details
   */
  async updateVehicle(vehicle: {
    make?: string;
    model?: string;
    year?: number;
    color?: string;
    plateNumber?: string;
  }): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.patch("/drivers/vehicle", vehicle);
  },

  /**
   * Get driver ratings and reviews
   */
  async getRatings(
    page = 1,
    limit = 20,
  ): Promise<
    ApiResponse<{
      averageRating: number;
      totalRatings: number;
      breakdown: Record<number, number>;
      reviews: Array<{
        id: string;
        rating: number;
        comment?: string;
        riderName: string;
        createdAt: string;
      }>;
    }>
  > {
    return apiClient.get("/drivers/ratings", {
      page: page.toString(),
      limit: limit.toString(),
    });
  },

  /**
   * Update driver settings/preferences
   */
  async updateSettings(settings: {
    language?: string;
    notificationsEnabled?: boolean;
    locationTracking?: boolean;
    dataSharing?: boolean;
  }): Promise<ApiResponse<{ success: boolean }>> {
    return apiClient.patch("/drivers/settings", settings);
  },

  /**
   * Request account data download
   */
  async requestDataDownload(): Promise<
    ApiResponse<{ message: string; requestId: string }>
  > {
    return apiClient.post("/drivers/data-download");
  },

  /**
   * Request account deletion
   */
  async requestAccountDeletion(
    reason?: string,
  ): Promise<ApiResponse<{ message: string }>> {
    return apiClient.post("/drivers/account/delete", { reason });
  },

  /**
   * Submit a support ticket
   */
  async submitSupportTicket(data: {
    subject: string;
    message: string;
    category?: string;
  }): Promise<ApiResponse<{ ticketId: string; message: string }>> {
    return apiClient.post("/support/tickets", data);
  },
};

export default driverService;
