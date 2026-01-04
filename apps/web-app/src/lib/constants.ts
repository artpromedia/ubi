/**
 * UBI Web App - Constants & Configuration
 */

// ===========================================
// App Configuration
// ===========================================

export const APP_CONFIG = {
  name: "UBI",
  description: "Your Ride, Your Way",
  url: process.env.NEXT_PUBLIC_APP_URL || "https://app.ubi.africa",
  supportEmail: "support@ubi.africa",
  supportPhone: "+254 700 000 000",
};

// ===========================================
// API Configuration
// ===========================================

export const API_CONFIG = {
  baseUrl: process.env.NEXT_PUBLIC_API_URL || "https://api.ubi.africa/v1",
  timeout: 30000,
  retries: 3,
};

// ===========================================
// Service Colors
// ===========================================

export const SERVICE_COLORS = {
  move: {
    primary: "#1DB954",
    light: "#22D264",
    dark: "#17A347",
  },
  bites: {
    primary: "#FF7545",
    light: "#FF8A5E",
    dark: "#E86A3E",
  },
  send: {
    primary: "#10AEBA",
    light: "#12C4D1",
    dark: "#0E9AA4",
  },
} as const;

// ===========================================
// Navigation Routes
// ===========================================

export const ROUTES = {
  // Public routes
  home: "/",
  login: "/auth/login",
  signup: "/auth/signup",
  forgotPassword: "/auth/forgot-password",
  resetPassword: "/auth/reset-password",

  // Main app routes
  move: "/move",
  rideDetails: (id: string) => `/move/rides/${id}`,
  trackRide: (id: string) => `/move/rides/${id}/track`,

  bites: "/bites",
  restaurant: (id: string) => `/bites/restaurants/${id}`,
  orderDetails: (id: string) => `/bites/orders/${id}`,
  trackOrder: (id: string) => `/bites/orders/${id}/track`,
  checkout: "/bites/checkout",

  send: "/send",
  deliveryDetails: (id: string) => `/send/deliveries/${id}`,
  trackDelivery: (id: string) => `/send/deliveries/${id}/track`,

  // Account routes
  account: "/account",
  profile: "/account/profile",
  wallet: "/account/wallet",
  payments: "/account/payments",
  addresses: "/account/addresses",
  history: "/account/history",
  promotions: "/account/promotions",
  referrals: "/account/referrals",
  settings: "/account/settings",
  help: "/account/help",

  // Static pages
  about: "/about",
  safety: "/safety",
  terms: "/terms",
  privacy: "/privacy",
} as const;

// ===========================================
// Storage Keys
// ===========================================

export const STORAGE_KEYS = {
  AUTH_TOKEN: "ubi_auth_token",
  REFRESH_TOKEN: "ubi_refresh_token",
  USER_ID: "ubi_user_id",
  THEME: "ubi_theme",
  LANGUAGE: "ubi_language",
  RECENT_SEARCHES: "ubi_recent_searches",
  RECENT_PLACES: "ubi_recent_places",
  ONBOARDING_COMPLETE: "ubi_onboarding_complete",
} as const;

// ===========================================
// Query Keys
// ===========================================

export const QUERY_KEYS = {
  // User
  user: ["user"] as const,
  userProfile: ["user", "profile"] as const,
  userAddresses: ["user", "addresses"] as const,
  userPaymentMethods: ["user", "payment-methods"] as const,

  // Rides
  rides: ["rides"] as const,
  ride: (id: string) => ["rides", id] as const,
  rideEstimate: ["rides", "estimate"] as const,
  nearbyDrivers: ["rides", "nearby-drivers"] as const,

  // Food
  restaurants: ["restaurants"] as const,
  restaurant: (id: string) => ["restaurants", id] as const,
  restaurantMenu: (id: string) => ["restaurants", id, "menu"] as const,
  foodOrders: ["food-orders"] as const,
  foodOrder: (id: string) => ["food-orders", id] as const,

  // Delivery
  deliveries: ["deliveries"] as const,
  delivery: (id: string) => ["deliveries", id] as const,
  deliveryEstimate: ["deliveries", "estimate"] as const,

  // Wallet
  wallet: ["wallet"] as const,
  walletTransactions: ["wallet", "transactions"] as const,

  // Promotions
  promotions: ["promotions"] as const,
} as const;

// ===========================================
// Vehicle Types
// ===========================================

export const VEHICLE_TYPES = [
  {
    id: "economy",
    name: "UBI X",
    description: "Affordable, everyday rides",
    icon: "car",
    capacity: 4,
    multiplier: 1.0,
  },
  {
    id: "comfort",
    name: "UBI Comfort",
    description: "Newer cars with extra legroom",
    icon: "car-alt",
    capacity: 4,
    multiplier: 1.3,
  },
  {
    id: "premium",
    name: "UBI Black",
    description: "Premium rides in luxury cars",
    icon: "car-luxury",
    capacity: 4,
    multiplier: 1.8,
  },
  {
    id: "xl",
    name: "UBI XL",
    description: "SUVs for groups up to 6",
    icon: "suv",
    capacity: 6,
    multiplier: 1.5,
  },
  {
    id: "moto",
    name: "UBI Moto",
    description: "Fast motorcycle rides",
    icon: "motorcycle",
    capacity: 1,
    multiplier: 0.7,
  },
  {
    id: "tuk",
    name: "UBI Tuk",
    description: "Three-wheeler rides",
    icon: "tuk-tuk",
    capacity: 3,
    multiplier: 0.6,
  },
] as const;

// ===========================================
// Package Sizes (UBI Send)
// ===========================================

export const PACKAGE_SIZES = [
  {
    id: "small",
    name: "Small",
    description: "Fits in a backpack",
    maxWeight: "5 kg",
    maxDimensions: "30×30×30 cm",
    multiplier: 1.0,
  },
  {
    id: "medium",
    name: "Medium",
    description: "Fits on a motorcycle",
    maxWeight: "15 kg",
    maxDimensions: "50×50×50 cm",
    multiplier: 1.5,
  },
  {
    id: "large",
    name: "Large",
    description: "Requires a car",
    maxWeight: "30 kg",
    maxDimensions: "100×80×60 cm",
    multiplier: 2.0,
  },
  {
    id: "extra-large",
    name: "Extra Large",
    description: "Requires a van",
    maxWeight: "100 kg",
    maxDimensions: "200×150×100 cm",
    multiplier: 3.5,
  },
] as const;

// ===========================================
// Order Statuses
// ===========================================

export const RIDE_STATUSES = {
  pending: { label: "Searching", color: "yellow" },
  accepted: { label: "Driver Assigned", color: "blue" },
  arriving: { label: "Driver Arriving", color: "blue" },
  arrived: { label: "Driver Arrived", color: "green" },
  started: { label: "In Progress", color: "green" },
  completed: { label: "Completed", color: "green" },
  cancelled: { label: "Cancelled", color: "red" },
} as const;

export const FOOD_ORDER_STATUSES = {
  pending: { label: "Pending", color: "yellow" },
  confirmed: { label: "Confirmed", color: "blue" },
  preparing: { label: "Preparing", color: "blue" },
  ready: { label: "Ready for Pickup", color: "green" },
  picked_up: { label: "On the Way", color: "green" },
  delivered: { label: "Delivered", color: "green" },
  cancelled: { label: "Cancelled", color: "red" },
} as const;

export const DELIVERY_STATUSES = {
  pending: { label: "Pending", color: "yellow" },
  assigned: { label: "Courier Assigned", color: "blue" },
  picked_up: { label: "Package Picked Up", color: "blue" },
  in_transit: { label: "In Transit", color: "green" },
  delivered: { label: "Delivered", color: "green" },
  cancelled: { label: "Cancelled", color: "red" },
} as const;

// ===========================================
// Map Configuration
// ===========================================

export const MAP_CONFIG = {
  defaultCenter: {
    lat: -1.2921, // Nairobi
    lng: 36.8219,
  },
  defaultZoom: 14,
  markerColors: {
    pickup: "#1DB954",
    dropoff: "#FF7545",
    driver: "#191414",
  },
};
