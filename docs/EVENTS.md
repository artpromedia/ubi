# UBI Event Catalog

This document defines all domain events in the UBI platform.

## Event Architecture

### Event Infrastructure

- **Broker:** Apache Kafka (production) / Redis Streams (development)
- **Schema Registry:** Confluent Schema Registry
- **Format:** JSON with schema validation
- **Retention:** 7 days (configurable per topic)

### Topic Naming Convention

```
ubi.<domain>.<entity>.<event>
```

Examples:

- `ubi.rides.ride.requested`
- `ubi.payments.payment.completed`
- `ubi.users.driver.location_updated`

---

## Event Schema

### Base Event Structure

```typescript
interface BaseEvent<T> {
  // Unique event identifier
  eventId: string; // UUID v4

  // Event type following naming convention
  eventType: string;

  // Schema version for evolution
  version: string; // e.g., "1.0.0"

  // When the event occurred
  timestamp: string; // ISO 8601

  // Service that produced the event
  source: string;

  // Correlation ID for tracing
  correlationId: string;

  // Optional causation ID (parent event)
  causationId?: string;

  // Event-specific payload
  data: T;

  // Optional metadata
  metadata?: {
    userId?: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    [key: string]: unknown;
  };
}
```

---

## User Domain Events

### Topic: `ubi.users`

#### user.registered

```typescript
interface UserRegisteredEvent {
  userId: string;
  email: string;
  phone: string;
  role: "RIDER" | "DRIVER" | "RESTAURANT" | "MERCHANT";
  country: string;
  referralCode?: string;
  registrationMethod: "phone" | "email" | "google" | "apple";
}
```

#### user.verified

```typescript
interface UserVerifiedEvent {
  userId: string;
  verificationType: "email" | "phone";
  verifiedAt: string;
}
```

#### user.profile_updated

```typescript
interface UserProfileUpdatedEvent {
  userId: string;
  updatedFields: string[];
  previousValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}
```

#### driver.location_updated

```typescript
interface DriverLocationUpdatedEvent {
  driverId: string;
  latitude: number;
  longitude: number;
  heading: number; // 0-360 degrees
  speed: number; // km/h
  accuracy: number; // meters
  isOnline: boolean;
  isAvailable: boolean;
  vehicleType: string;
  h3Index: string; // H3 cell at resolution 8
}
```

#### driver.approved

```typescript
interface DriverApprovedEvent {
  driverId: string;
  userId: string;
  vehicleId: string;
  approvedBy: string;
  vehicleType: string;
  licensePlate: string;
}
```

---

## Ride Domain Events

### Topic: `ubi.rides`

#### ride.requested

```typescript
interface RideRequestedEvent {
  rideId: string;
  riderId: string;
  rideType: "ECONOMY" | "COMFORT" | "PREMIUM" | "XL" | "MOTO";
  pickup: {
    address: string;
    latitude: number;
    longitude: number;
    placeId?: string;
  };
  dropoff: {
    address: string;
    latitude: number;
    longitude: number;
    placeId?: string;
  };
  estimatedFare: {
    amount: number;
    currency: string;
    breakdown: {
      baseFare: number;
      distance: number;
      time: number;
      surge: number;
    };
  };
  paymentMethod: string;
  scheduledFor?: string;
}
```

#### ride.driver_matched

```typescript
interface RideDriverMatchedEvent {
  rideId: string;
  riderId: string;
  driverId: string;
  vehicleId: string;
  driver: {
    name: string;
    phone: string;
    rating: number;
    photoUrl?: string;
  };
  vehicle: {
    make: string;
    model: string;
    color: string;
    plateNumber: string;
    type: string;
  };
  estimatedArrival: number; // seconds
  matchedAt: string;
}
```

#### ride.driver_arriving

```typescript
interface RideDriverArrivingEvent {
  rideId: string;
  driverId: string;
  currentLocation: {
    latitude: number;
    longitude: number;
  };
  eta: number; // seconds
  distance: number; // meters
}
```

#### ride.started

```typescript
interface RideStartedEvent {
  rideId: string;
  riderId: string;
  driverId: string;
  startedAt: string;
  startLocation: {
    latitude: number;
    longitude: number;
  };
  estimatedDuration: number; // seconds
  estimatedDistance: number; // meters
}
```

#### ride.completed

```typescript
interface RideCompletedEvent {
  rideId: string;
  riderId: string;
  driverId: string;
  completedAt: string;
  actualDuration: number; // seconds
  actualDistance: number; // meters
  route: Array<{ lat: number; lng: number; ts: string }>;
  fare: {
    amount: number;
    currency: string;
    breakdown: {
      baseFare: number;
      distance: number;
      time: number;
      surge: number;
      tip: number;
      discount: number;
      total: number;
    };
  };
  paymentMethod: string;
}
```

#### ride.cancelled

```typescript
interface RideCancelledEvent {
  rideId: string;
  riderId: string;
  driverId?: string;
  cancelledBy: "rider" | "driver" | "system";
  reason?: string;
  cancellationFee?: {
    amount: number;
    currency: string;
  };
  cancelledAt: string;
}
```

---

## Food Order Domain Events

### Topic: `ubi.food`

#### order.placed

```typescript
interface OrderPlacedEvent {
  orderId: string;
  riderId: string;
  restaurantId: string;
  items: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    options?: Record<string, unknown>;
  }>;
  pricing: {
    subtotal: number;
    deliveryFee: number;
    serviceFee: number;
    discount: number;
    total: number;
    currency: string;
  };
  deliveryAddress: {
    address: string;
    latitude: number;
    longitude: number;
    instructions?: string;
  };
  paymentMethod: string;
  estimatedDelivery: string;
}
```

#### order.confirmed

```typescript
interface OrderConfirmedEvent {
  orderId: string;
  restaurantId: string;
  estimatedPrepTime: number; // minutes
  confirmedAt: string;
}
```

#### order.ready

```typescript
interface OrderReadyEvent {
  orderId: string;
  restaurantId: string;
  readyAt: string;
}
```

#### order.picked_up

```typescript
interface OrderPickedUpEvent {
  orderId: string;
  driverId: string;
  restaurantId: string;
  pickedUpAt: string;
  estimatedDelivery: string;
}
```

#### order.delivered

```typescript
interface OrderDeliveredEvent {
  orderId: string;
  riderId: string;
  driverId: string;
  deliveredAt: string;
  actualDeliveryTime: number; // minutes from order
}
```

---

## Delivery Domain Events

### Topic: `ubi.delivery`

#### delivery.created

```typescript
interface DeliveryCreatedEvent {
  deliveryId: string;
  trackingNumber: string;
  senderId: string;
  merchantId?: string;
  pickup: {
    address: string;
    latitude: number;
    longitude: number;
    contact: string;
    phone: string;
  };
  dropoff: {
    address: string;
    latitude: number;
    longitude: number;
    contact: string;
    phone: string;
  };
  package: {
    size: "small" | "medium" | "large" | "xl";
    weight?: number;
    description: string;
    isFragile: boolean;
  };
  pricing: {
    amount: number;
    currency: string;
  };
  scheduledPickup?: string;
  expressDelivery: boolean;
}
```

#### delivery.assigned

```typescript
interface DeliveryAssignedEvent {
  deliveryId: string;
  driverId: string;
  driver: {
    name: string;
    phone: string;
    vehicleType: string;
  };
  estimatedPickup: string;
  estimatedDelivery: string;
}
```

#### delivery.picked_up

```typescript
interface DeliveryPickedUpEvent {
  deliveryId: string;
  driverId: string;
  pickedUpAt: string;
  pickupPhoto?: string;
  estimatedDelivery: string;
}
```

#### delivery.delivered

```typescript
interface DeliveryDeliveredEvent {
  deliveryId: string;
  driverId: string;
  deliveredAt: string;
  proofOfDelivery: {
    type: "photo" | "signature" | "otp";
    value: string; // URL or OTP code
  };
  recipientName?: string;
}
```

---

## Payment Domain Events

### Topic: `ubi.payments`

#### payment.initiated

```typescript
interface PaymentInitiatedEvent {
  paymentId: string;
  userId: string;
  amount: number;
  currency: string;
  method: "CARD" | "MPESA" | "MTN_MOMO" | "AIRTEL_MONEY" | "WALLET";
  reference: {
    type: "ride" | "food_order" | "delivery" | "wallet_topup" | "ceerion";
    id: string;
  };
  provider: string;
  providerRef?: string;
}
```

#### payment.completed

```typescript
interface PaymentCompletedEvent {
  paymentId: string;
  userId: string;
  amount: number;
  currency: string;
  method: string;
  reference: {
    type: string;
    id: string;
  };
  provider: string;
  providerRef: string;
  completedAt: string;
  fees?: {
    provider: number;
    platform: number;
  };
}
```

#### payment.failed

```typescript
interface PaymentFailedEvent {
  paymentId: string;
  userId: string;
  amount: number;
  currency: string;
  method: string;
  reference: {
    type: string;
    id: string;
  };
  failureReason: string;
  failureCode?: string;
  canRetry: boolean;
}
```

#### wallet.credited

```typescript
interface WalletCreditedEvent {
  walletId: string;
  userId: string;
  amount: number;
  currency: string;
  type: "topup" | "refund" | "earning" | "bonus" | "cashback";
  source?: string;
  previousBalance: number;
  newBalance: number;
}
```

#### wallet.debited

```typescript
interface WalletDebitedEvent {
  walletId: string;
  userId: string;
  amount: number;
  currency: string;
  type: "payment" | "withdrawal" | "fee" | "deduction";
  reference?: string;
  previousBalance: number;
  newBalance: number;
}
```

#### earning.credited

```typescript
interface EarningCreditedEvent {
  driverId: string;
  amount: number;
  currency: string;
  type: "ride" | "delivery" | "tip" | "bonus" | "incentive";
  referenceId: string;
  deductions?: {
    platformFee: number;
    ceerionPayment?: number;
    taxes?: number;
  };
  netAmount: number;
}
```

---

## CEERION Domain Events

### Topic: `ubi.ceerion`

#### ceerion.payment_due

```typescript
interface CeerionPaymentDueEvent {
  ceerionVehicleId: string;
  driverId: string;
  paymentId: string;
  amount: number;
  currency: string;
  dueDate: string;
  weekNumber: number;
  totalRemaining: number;
}
```

#### ceerion.payment_success

```typescript
interface CeerionPaymentSuccessEvent {
  ceerionVehicleId: string;
  driverId: string;
  paymentId: string;
  amount: number;
  currency: string;
  source: "manual" | "auto_deduction";
  paidAt: string;
  totalPaid: number;
  totalRemaining: number;
}
```

#### ceerion.payment_overdue

```typescript
interface CeerionPaymentOverdueEvent {
  ceerionVehicleId: string;
  driverId: string;
  paymentId: string;
  amount: number;
  currency: string;
  daysOverdue: number;
  missedPayments: number;
}
```

---

## Notification Domain Events

### Topic: `ubi.notifications`

#### notification.sent

```typescript
interface NotificationSentEvent {
  notificationId: string;
  userId: string;
  channel: "push" | "sms" | "email" | "whatsapp" | "in_app";
  template: string;
  status: "sent" | "delivered" | "failed";
  sentAt: string;
  provider: string;
  providerRef?: string;
}
```

---

## Event Processing Guidelines

### Idempotency

All event handlers must be idempotent. Use `eventId` for deduplication.

```typescript
async function handleEvent(event: BaseEvent<unknown>) {
  const processed = await redis.get(`event:${event.eventId}`);
  if (processed) {
    return; // Already processed
  }

  // Process event...

  await redis.setex(`event:${event.eventId}`, 86400, "1");
}
```

### Ordering

- Events within a partition are ordered
- Use entity ID as partition key for ordering guarantees
- Ride events keyed by `rideId`
- User events keyed by `userId`

### Retry Policy

```typescript
const retryPolicy = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 60000, // 1 minute
  backoffMultiplier: 2,
};
```

### Dead Letter Queue

Failed events after max retries go to DLQ:

- `ubi.dlq.rides`
- `ubi.dlq.payments`
- etc.

### Consumer Groups

```
ubi.rides.consumers.notification-service
ubi.rides.consumers.analytics-service
ubi.payments.consumers.notification-service
```

---

## Saga Patterns

### Ride Payment Saga

```
1. ride.completed (Ride Service)
   ↓
2. payment.initiated (Payment Service)
   ↓
3. [Success] payment.completed
   → wallet.debited (rider)
   → earning.credited (driver)

3. [Failure] payment.failed
   → Retry with backup payment
   → If all fail, mark ride as payment_pending
```

### Order Fulfillment Saga

```
1. order.placed (Food Service)
   ↓
2. payment.initiated (Payment Service)
   ↓
3. payment.completed
   → order.paid
   ↓
4. order.confirmed (Restaurant)
   ↓
5. order.ready
   → Find delivery driver
   ↓
6. order.picked_up
   ↓
7. order.delivered
   → earning.credited (driver)
   → settlement.created (restaurant)
```

---

## Monitoring & Alerting

### Key Metrics

- Event processing latency (p50, p95, p99)
- Consumer lag per partition
- Dead letter queue size
- Event throughput per topic

### Alerts

- Consumer lag > 10,000 events
- DLQ size > 100 events
- Processing latency p99 > 5 seconds
- Event schema validation failures
