import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type DriverStatus = "offline" | "online" | "busy" | "break";

export interface DriverProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  photoUrl?: string;
  rating: number;
  totalTrips: number;
  isVerified: boolean;
  vehicleType: string;
  vehiclePlate: string;
  vehicleModel: string;
}

export interface DriverState {
  // Auth state
  isAuthenticated: boolean;
  isOnboarded: boolean;
  accessToken: string | null;

  // Driver profile
  profile: DriverProfile | null;

  // Driver status
  status: DriverStatus;

  // Today's stats
  todayEarnings: number;
  todayTrips: number;
  todayHours: number;

  // Actions
  setAuthenticated: (value: boolean) => void;
  setOnboarded: (value: boolean) => void;
  setAccessToken: (token: string | null) => void;
  setProfile: (profile: DriverProfile | null) => void;
  setStatus: (status: DriverStatus) => void;
  updateTodayStats: (earnings: number, trips: number, hours: number) => void;
  logout: () => void;
}

export const useDriverStore = create<DriverState>()(
  persist(
    (set) => ({
      // Initial auth state
      isAuthenticated: false,
      isOnboarded: false,
      accessToken: null,

      // Initial profile
      profile: null,

      // Initial status
      status: "offline",

      // Initial stats
      todayEarnings: 0,
      todayTrips: 0,
      todayHours: 0,

      // Actions
      setAuthenticated: (value) => set({ isAuthenticated: value }),
      setOnboarded: (value) => set({ isOnboarded: value }),
      setAccessToken: (token) => set({ accessToken: token }),
      setProfile: (profile) => set({ profile }),
      setStatus: (status) => set({ status }),
      updateTodayStats: (earnings, trips, hours) =>
        set({
          todayEarnings: earnings,
          todayTrips: trips,
          todayHours: hours,
        }),
      logout: () =>
        set({
          isAuthenticated: false,
          accessToken: null,
          profile: null,
          status: "offline",
          todayEarnings: 0,
          todayTrips: 0,
          todayHours: 0,
        }),
    }),
    {
      name: "ubi-driver-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        isOnboarded: state.isOnboarded,
        accessToken: state.accessToken,
        profile: state.profile,
      }),
    },
  ),
);
