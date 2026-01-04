import { z } from "zod";

// ===========================================
// User Schemas
// ===========================================

export const emailSchema = z
  .string()
  .email("Please enter a valid email address")
  .min(1, "Email is required");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const phoneSchema = z
  .string()
  .regex(
    /^\+?[1-9]\d{1,14}$/,
    "Please enter a valid phone number in international format"
  );

export const nameSchema = z
  .string()
  .min(2, "Name must be at least 2 characters")
  .max(100, "Name must be less than 100 characters")
  .regex(/^[a-zA-Z\s'-]+$/, "Name can only contain letters, spaces, hyphens, and apostrophes");

// ===========================================
// Location Schemas
// ===========================================

export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const addressSchema = z.object({
  street: z.string().min(1, "Street address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().optional(),
  country: z.string().min(2).max(2, "Use 2-letter country code"),
  postalCode: z.string().optional(),
  coordinates: coordinatesSchema.optional(),
});

export const locationSchema = z.object({
  placeId: z.string().optional(),
  name: z.string().min(1, "Location name is required"),
  address: z.string().min(1, "Address is required"),
  coordinates: coordinatesSchema,
});

// ===========================================
// Ride Schemas
// ===========================================

export const rideRequestSchema = z.object({
  pickup: locationSchema,
  dropoff: locationSchema,
  rideType: z.enum(["economy", "comfort", "premium", "xl", "moto"]),
  paymentMethod: z.enum(["cash", "card", "wallet", "mobile_money"]),
  scheduledTime: z.string().datetime().optional(),
  notes: z.string().max(500).optional(),
});

export const rideStatusSchema = z.enum([
  "pending",
  "searching",
  "driver_assigned",
  "driver_arriving",
  "driver_arrived",
  "in_progress",
  "completed",
  "cancelled",
]);

// ===========================================
// Payment Schemas
// ===========================================

export const amountSchema = z
  .number()
  .positive("Amount must be positive")
  .multipleOf(0.01, "Amount must have at most 2 decimal places");

export const currencySchema = z.enum([
  "NGN", // Nigerian Naira
  "KES", // Kenyan Shilling
  "ZAR", // South African Rand
  "GHS", // Ghanaian Cedi
  "RWF", // Rwandan Franc
  "ETB", // Ethiopian Birr
  "USD", // US Dollar (for international)
]);

export const paymentMethodSchema = z.enum([
  "cash",
  "card",
  "wallet",
  "mpesa",      // Kenya
  "mtn_momo",   // Ghana, Rwanda
  "airtel_money",
  "paystack",
  "flutterwave",
]);

export const transactionSchema = z.object({
  amount: amountSchema,
  currency: currencySchema,
  paymentMethod: paymentMethodSchema,
  reference: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

// ===========================================
// Food Order Schemas
// ===========================================

export const menuItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  price: amountSchema,
  options: z.array(z.object({
    name: z.string(),
    value: z.string(),
    price: amountSchema.optional(),
  })).optional(),
  specialInstructions: z.string().max(500).optional(),
});

export const foodOrderSchema = z.object({
  restaurantId: z.string().uuid(),
  items: z.array(menuItemSchema).min(1, "Order must have at least one item"),
  deliveryAddress: locationSchema,
  paymentMethod: paymentMethodSchema,
  tip: amountSchema.optional(),
  notes: z.string().max(500).optional(),
});

// ===========================================
// Delivery Schemas
// ===========================================

export const packageSizeSchema = z.enum(["small", "medium", "large", "extra_large"]);

export const deliveryRequestSchema = z.object({
  pickup: locationSchema,
  dropoff: locationSchema,
  packageSize: packageSizeSchema,
  packageDescription: z.string().min(1).max(500),
  isFragile: z.boolean().default(false),
  requiresSignature: z.boolean().default(false),
  paymentMethod: paymentMethodSchema,
  scheduledTime: z.string().datetime().optional(),
});

// ===========================================
// Type Exports
// ===========================================

export type Coordinates = z.infer<typeof coordinatesSchema>;
export type Address = z.infer<typeof addressSchema>;
export type Location = z.infer<typeof locationSchema>;
export type RideRequest = z.infer<typeof rideRequestSchema>;
export type RideStatus = z.infer<typeof rideStatusSchema>;
export type Currency = z.infer<typeof currencySchema>;
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type FoodOrder = z.infer<typeof foodOrderSchema>;
export type PackageSize = z.infer<typeof packageSizeSchema>;
export type DeliveryRequest = z.infer<typeof deliveryRequestSchema>;
