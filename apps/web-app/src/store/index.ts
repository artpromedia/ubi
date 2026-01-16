/**
 * UBI Web App - Store Configuration
 *
 * Global state management using Zustand with persistence and devtools.
 */

import type { Coordinates } from "@ubi/utils";
import { create } from "zustand";
import { devtools, persist, subscribeWithSelector } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// ===========================================
// Auth Store
// ===========================================

export interface AuthState {
  // State
  isAuthenticated: boolean;
  userId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;

  // Actions
  setAuth: (userId: string, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
  updateTokens: (accessToken: string, refreshToken: string) => void;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      subscribeWithSelector(
        immer((set) => ({
          // Initial state
          isAuthenticated: false,
          userId: null,
          accessToken: null,
          refreshToken: null,
          isLoading: true,

          // Actions
          setAuth: (userId, accessToken, refreshToken) =>
            set((state) => {
              state.isAuthenticated = true;
              state.userId = userId;
              state.accessToken = accessToken;
              state.refreshToken = refreshToken;
              state.isLoading = false;
            }),

          clearAuth: () =>
            set((state) => {
              state.isAuthenticated = false;
              state.userId = null;
              state.accessToken = null;
              state.refreshToken = null;
              state.isLoading = false;
            }),

          setLoading: (loading) =>
            set((state) => {
              state.isLoading = loading;
            }),

          updateTokens: (accessToken, refreshToken) =>
            set((state) => {
              state.accessToken = accessToken;
              state.refreshToken = refreshToken;
            }),
        }))
      ),
      {
        name: "ubi-auth",
        partialize: (state) => ({
          userId: state.userId,
          accessToken: state.accessToken,
          refreshToken: state.refreshToken,
        }),
      }
    ),
    { name: "auth-store" }
  )
);

// ===========================================
// User Store
// ===========================================

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  defaultPaymentMethodId?: string;
  preferredLanguage: string;
  preferredCurrency: string;
}

export interface SavedAddress {
  id: string;
  label: string;
  address: string;
  coordinates: Coordinates;
  type: "home" | "work" | "other";
}

export interface UserState {
  // State
  profile: UserProfile | null;
  savedAddresses: SavedAddress[];
  isProfileLoaded: boolean;

  // Actions
  setProfile: (profile: UserProfile) => void;
  updateProfile: (updates: Partial<UserProfile>) => void;
  setSavedAddresses: (addresses: SavedAddress[]) => void;
  addSavedAddress: (address: SavedAddress) => void;
  removeSavedAddress: (id: string) => void;
  clearUser: () => void;
}

export const useUserStore = create<UserState>()(
  devtools(
    persist(
      immer((set) => ({
        // Initial state
        profile: null,
        savedAddresses: [],
        isProfileLoaded: false,

        // Actions
        setProfile: (profile) =>
          set((state) => {
            state.profile = profile;
            state.isProfileLoaded = true;
          }),

        updateProfile: (updates) =>
          set((state) => {
            if (state.profile) {
              Object.assign(state.profile, updates);
            }
          }),

        setSavedAddresses: (addresses) =>
          set((state) => {
            state.savedAddresses = addresses;
          }),

        addSavedAddress: (address) =>
          set((state) => {
            state.savedAddresses.push(address);
          }),

        removeSavedAddress: (id) =>
          set((state) => {
            state.savedAddresses = state.savedAddresses.filter(
              (a) => a.id !== id
            );
          }),

        clearUser: () =>
          set((state) => {
            state.profile = null;
            state.savedAddresses = [];
            state.isProfileLoaded = false;
          }),
      })),
      {
        name: "ubi-user",
      }
    ),
    { name: "user-store" }
  )
);

// ===========================================
// Location Store
// ===========================================

export interface LocationState {
  // State
  currentLocation: Coordinates | null;
  selectedPickup: { address: string; coordinates: Coordinates } | null;
  selectedDropoff: { address: string; coordinates: Coordinates } | null;
  locationPermission: "granted" | "denied" | "prompt" | "unknown";
  isLoadingLocation: boolean;
  locationError: string | null;

  // Actions
  setCurrentLocation: (location: Coordinates | null) => void;
  setSelectedPickup: (
    pickup: { address: string; coordinates: Coordinates } | null
  ) => void;
  setSelectedDropoff: (
    dropoff: { address: string; coordinates: Coordinates } | null
  ) => void;
  setLocationPermission: (
    permission: LocationState["locationPermission"]
  ) => void;
  setLocationLoading: (loading: boolean) => void;
  setLocationError: (error: string | null) => void;
  swapLocations: () => void;
  clearLocations: () => void;
}

export const useLocationStore = create<LocationState>()(
  devtools(
    subscribeWithSelector(
      immer((set) => ({
        // Initial state
        currentLocation: null,
        selectedPickup: null,
        selectedDropoff: null,
        locationPermission: "unknown",
        isLoadingLocation: false,
        locationError: null,

        // Actions
        setCurrentLocation: (location) =>
          set((state) => {
            state.currentLocation = location;
          }),

        setSelectedPickup: (pickup) =>
          set((state) => {
            state.selectedPickup = pickup;
          }),

        setSelectedDropoff: (dropoff) =>
          set((state) => {
            state.selectedDropoff = dropoff;
          }),

        setLocationPermission: (permission) =>
          set((state) => {
            state.locationPermission = permission;
          }),

        setLocationLoading: (loading) =>
          set((state) => {
            state.isLoadingLocation = loading;
          }),

        setLocationError: (error) =>
          set((state) => {
            state.locationError = error;
          }),

        swapLocations: () =>
          set((state) => {
            const temp = state.selectedPickup;
            state.selectedPickup = state.selectedDropoff;
            state.selectedDropoff = temp;
          }),

        clearLocations: () =>
          set((state) => {
            state.selectedPickup = null;
            state.selectedDropoff = null;
          }),
      }))
    ),
    { name: "location-store" }
  )
);

// ===========================================
// UI Store
// ===========================================

export type ServiceTab = "move" | "bites" | "send";
export type Theme = "light" | "dark" | "system";

export interface UIState {
  // State
  activeTab: ServiceTab;
  theme: Theme;
  sidebarOpen: boolean;
  isBottomSheetOpen: boolean;
  bottomSheetContent: string | null;

  // Actions
  setActiveTab: (tab: ServiceTab) => void;
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  openBottomSheet: (content: string) => void;
  closeBottomSheet: () => void;
}

export const useUIStore = create<UIState>()(
  devtools(
    persist(
      immer((set) => ({
        // Initial state
        activeTab: "move",
        theme: "system",
        sidebarOpen: false,
        isBottomSheetOpen: false,
        bottomSheetContent: null,

        // Actions
        setActiveTab: (tab) =>
          set((state) => {
            state.activeTab = tab;
          }),

        setTheme: (theme) =>
          set((state) => {
            state.theme = theme;
          }),

        toggleSidebar: () =>
          set((state) => {
            state.sidebarOpen = !state.sidebarOpen;
          }),

        setSidebarOpen: (open) =>
          set((state) => {
            state.sidebarOpen = open;
          }),

        openBottomSheet: (content) =>
          set((state) => {
            state.isBottomSheetOpen = true;
            state.bottomSheetContent = content;
          }),

        closeBottomSheet: () =>
          set((state) => {
            state.isBottomSheetOpen = false;
            state.bottomSheetContent = null;
          }),
      })),
      {
        name: "ubi-ui",
        partialize: (state) => ({
          theme: state.theme,
        }),
      }
    ),
    { name: "ui-store" }
  )
);

// ===========================================
// Active Ride Store
// ===========================================

export type RideStatus =
  | "searching"
  | "driver_assigned"
  | "driver_arriving"
  | "driver_arrived"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface ActiveRide {
  id: string;
  status: RideStatus;
  pickup: { address: string; coordinates: Coordinates };
  dropoff: { address: string; coordinates: Coordinates };
  driver?: {
    id: string;
    name: string;
    phone: string;
    photoUrl?: string;
    rating: number;
    vehicleType: string;
    vehiclePlate: string;
    vehicleColor: string;
    currentLocation?: Coordinates;
  };
  estimatedArrival?: Date;
  estimatedDuration?: number;
  estimatedDistance?: number;
  fare?: {
    amount: number;
    currency: string;
  };
}

export interface RideState {
  // State
  activeRide: ActiveRide | null;
  rideHistory: ActiveRide[];

  // Actions
  setActiveRide: (ride: ActiveRide | null) => void;
  updateRideStatus: (status: RideStatus) => void;
  updateDriverLocation: (location: Coordinates) => void;
  addToHistory: (ride: ActiveRide) => void;
  clearActiveRide: () => void;
}

export const useRideStore = create<RideState>()(
  devtools(
    subscribeWithSelector(
      immer((set) => ({
        // Initial state
        activeRide: null,
        rideHistory: [],

        // Actions
        setActiveRide: (ride) =>
          set((state) => {
            state.activeRide = ride;
          }),

        updateRideStatus: (status) =>
          set((state) => {
            if (state.activeRide) {
              state.activeRide.status = status;
            }
          }),

        updateDriverLocation: (location) =>
          set((state) => {
            if (state.activeRide?.driver) {
              state.activeRide.driver.currentLocation = location;
            }
          }),

        addToHistory: (ride) =>
          set((state) => {
            state.rideHistory.unshift(ride);
          }),

        clearActiveRide: () =>
          set((state) => {
            if (state.activeRide) {
              state.rideHistory.unshift(state.activeRide);
            }
            state.activeRide = null;
          }),
      }))
    ),
    { name: "ride-store" }
  )
);

// ===========================================
// Cart Store (Food & Delivery)
// ===========================================

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  options?: Record<string, string | string[]>;
  restaurantId?: string;
  restaurantName?: string;
}

export interface CartState {
  // State
  items: CartItem[];
  restaurantId: string | null;
  restaurantName: string | null;
  deliveryFee: number;
  serviceFee: number;
  promoCode: string | null;
  discount: number;

  // Computed
  subtotal: () => number;
  total: () => number;
  itemCount: () => number;

  // Actions
  addItem: (item: CartItem) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;
  setPromoCode: (code: string | null, discount: number) => void;
  setDeliveryFee: (fee: number) => void;
  setServiceFee: (fee: number) => void;
}

export const useCartStore = create<CartState>()(
  devtools(
    persist(
      immer((set, get) => ({
        // Initial state
        items: [],
        restaurantId: null,
        restaurantName: null,
        deliveryFee: 0,
        serviceFee: 0,
        promoCode: null,
        discount: 0,

        // Computed
        subtotal: () =>
          get().items.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0
          ),
        total: () =>
          get().subtotal() +
          get().deliveryFee +
          get().serviceFee -
          get().discount,
        itemCount: () =>
          get().items.reduce((count, item) => count + item.quantity, 0),

        // Actions
        addItem: (item) =>
          set((state) => {
            // Check if switching restaurants
            if (
              state.restaurantId &&
              state.restaurantId !== item.restaurantId
            ) {
              // Clear cart if different restaurant
              state.items = [];
            }

            state.restaurantId = item.restaurantId || null;
            state.restaurantName = item.restaurantName || null;

            const existingIndex = state.items.findIndex(
              (i) => i.id === item.id
            );
            if (existingIndex >= 0) {
              const existingItem = state.items[existingIndex];
              if (existingItem) {
                existingItem.quantity += item.quantity;
              }
            } else {
              state.items.push(item);
            }
          }),

        updateQuantity: (itemId, quantity) =>
          set((state) => {
            const item = state.items.find((i) => i.id === itemId);
            if (item) {
              if (quantity <= 0) {
                state.items = state.items.filter((i) => i.id !== itemId);
              } else {
                item.quantity = quantity;
              }
            }
          }),

        removeItem: (itemId) =>
          set((state) => {
            state.items = state.items.filter((i) => i.id !== itemId);
            if (state.items.length === 0) {
              state.restaurantId = null;
              state.restaurantName = null;
            }
          }),

        clearCart: () =>
          set((state) => {
            state.items = [];
            state.restaurantId = null;
            state.restaurantName = null;
            state.promoCode = null;
            state.discount = 0;
          }),

        setPromoCode: (code, discount) =>
          set((state) => {
            state.promoCode = code;
            state.discount = discount;
          }),

        setDeliveryFee: (fee) =>
          set((state) => {
            state.deliveryFee = fee;
          }),

        setServiceFee: (fee) =>
          set((state) => {
            state.serviceFee = fee;
          }),
      })),
      {
        name: "ubi-cart",
      }
    ),
    { name: "cart-store" }
  )
);
