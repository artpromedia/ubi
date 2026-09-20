# UBI Service Catalog

This document provides detailed specifications for all UBI backend services.

## Service Overview

| Service              | Language   | Port | Description                          | Owner Team |
| -------------------- | ---------- | ---- | ------------------------------------ | ---------- |
| API Gateway          | TypeScript | 4000 | Request routing, auth, rate limiting | Platform   |
| User Service         | TypeScript | 4001 | User management, auth, profiles      | Identity   |
| Ride Service         | Go         | 4002 | Ride matching, tracking, pricing     | Mobility   |
| Food Service         | TypeScript | 4003 | Restaurants, orders, menus           | Commerce   |
| Delivery Service     | Go         | 4004 | Package delivery, tracking           | Logistics  |
| Payment Service      | TypeScript | 4005 | Payments, wallets, settlements       | Fintech    |
| Notification Service | TypeScript | 4006 | Push, SMS, email, WhatsApp           | Platform   |

---

## 1. API Gateway

**Purpose:** Single entry point for all client requests.

### Responsibilities

- Request routing to downstream services
- JWT authentication and authorization
- Rate limiting (per user, per IP)
- Request/response transformation
- API versioning
- Request logging and tracing

### API Routes

```
/v1/auth/*          → User Service
/v1/users/*         → User Service
/v1/rides/*         → Ride Service
/v1/drivers/*       → Ride Service
/v1/restaurants/*   → Food Service
/v1/orders/*        → Food Service
/v1/deliveries/*    → Delivery Service
/v1/payments/*      → Payment Service
/v1/wallet/*        → Payment Service
/v1/notifications/* → Notification Service
```

### Rate Limits

| Tier          | Requests/min | Burst |
| ------------- | ------------ | ----- |
| Anonymous     | 20           | 5     |
| Authenticated | 100          | 20    |
| Premium       | 500          | 50    |
| Service       | 10000        | 1000  |

---

## 2. User Service

**Purpose:** Manages user accounts, authentication, and profiles.

### Responsibilities

- User registration (phone, email, social)
- OTP verification
- JWT token management
- Profile management
- Session management
- Role-based access control

### API Endpoints

#### Authentication

```
POST /v1/auth/register          - Register new user
POST /v1/auth/login             - Login with credentials
POST /v1/auth/login/otp         - Login with OTP
POST /v1/auth/verify-otp        - Verify OTP code
POST /v1/auth/refresh           - Refresh access token
POST /v1/auth/logout            - Invalidate session
POST /v1/auth/forgot-password   - Request password reset
POST /v1/auth/reset-password    - Reset password with token
```

#### Users

```
GET    /v1/users/me             - Get current user profile
PATCH  /v1/users/me             - Update profile
DELETE /v1/users/me             - Delete account
POST   /v1/users/me/avatar      - Upload avatar
GET    /v1/users/:id            - Get user by ID (admin)
```

#### Driver Onboarding

```
POST /v1/drivers/apply          - Submit driver application
POST /v1/drivers/documents      - Upload documents
GET  /v1/drivers/me/status      - Check application status
```

### Events Emitted

- `user.registered` - New user created
- `user.verified` - Email/phone verified
- `user.updated` - Profile updated
- `user.deactivated` - Account deactivated
- `driver.approved` - Driver application approved
- `driver.rejected` - Driver application rejected

### Database Tables

- `users` - Core user accounts
- `sessions` - Active sessions
- `riders` - Rider-specific data
- `drivers` - Driver-specific data
- `vehicles` - Driver vehicles

---

## 3. Ride Service (Go)

**Purpose:** High-performance ride matching, tracking, and pricing.

### Responsibilities

- Real-time driver matching (H3 geospatial)
- Dynamic surge pricing
- ETA calculations
- Live ride tracking
- Driver dispatch
- Route optimization

### API Endpoints

#### Rides

```
POST /v1/rides/request          - Request new ride
GET  /v1/rides/:id              - Get ride details
PUT  /v1/rides/:id/cancel       - Cancel ride
GET  /v1/rides/:id/track        - Real-time tracking
POST /v1/rides/:id/rate         - Rate completed ride
GET  /v1/rides/history          - Ride history
GET  /v1/rides/active           - Get active ride
```

#### Drivers

```
POST /v1/drivers/location       - Update driver location
GET  /v1/drivers/nearby         - Find nearby drivers
POST /v1/drivers/:id/accept     - Accept ride request
POST /v1/drivers/:id/decline    - Decline ride request
POST /v1/drivers/:id/arrive     - Mark arrival
POST /v1/drivers/:id/start      - Start trip
POST /v1/drivers/:id/complete   - Complete trip
POST /v1/drivers/online         - Go online
POST /v1/drivers/offline        - Go offline
```

#### Pricing

```
POST /v1/pricing/estimate       - Get fare estimate
GET  /v1/pricing/surge          - Get surge multiplier
GET  /v1/pricing/types          - Get vehicle types & rates
```

### Matching Algorithm

```
1. Rider requests ride
2. Hash pickup location to H3 cell (resolution 8)
3. Query Redis for online drivers in:
   - Same cell
   - Adjacent cells (k-ring, k=1,2,3)
4. Filter by:
   - Vehicle type match
   - Acceptance rate > 60%
   - Driver rating > 4.0
5. Sort by:
   - ETA (distance/speed)
   - Acceptance rate
   - Rating
6. Send request to top 3 drivers
7. First to accept wins
8. If no accept in 30s, expand search
```

### Events Emitted

- `ride.requested` - New ride request
- `ride.accepted` - Driver accepted
- `ride.driver_arriving` - Driver en route
- `ride.started` - Trip started
- `ride.completed` - Trip completed
- `ride.cancelled` - Ride cancelled
- `driver.location_updated` - Location update

### Real-Time Updates

WebSocket events via Gateway:

```json
{
  "type": "ride.update",
  "data": {
    "rideId": "uuid",
    "status": "DRIVER_ARRIVING",
    "driver": {
      "lat": -1.2921,
      "lng": 36.8219,
      "heading": 45,
      "eta": 180
    }
  }
}
```

---

## 4. Food Service

**Purpose:** Restaurant catalog, menu management, and food orders.

### Responsibilities

- Restaurant onboarding
- Menu management
- Order placement
- Order tracking
- Restaurant search
- Ratings and reviews

### API Endpoints

#### Restaurants

```
GET  /v1/restaurants            - List restaurants
GET  /v1/restaurants/:id        - Get restaurant details
GET  /v1/restaurants/:id/menu   - Get menu
GET  /v1/restaurants/search     - Search restaurants
GET  /v1/restaurants/nearby     - Nearby restaurants
```

#### Orders

```
POST /v1/orders                 - Place order
GET  /v1/orders/:id             - Get order details
PUT  /v1/orders/:id/cancel      - Cancel order
GET  /v1/orders/:id/track       - Track order
POST /v1/orders/:id/rate        - Rate order
GET  /v1/orders/history         - Order history
```

#### Restaurant Portal

```
GET  /v1/restaurant/orders      - Incoming orders
PUT  /v1/restaurant/orders/:id/confirm   - Confirm order
PUT  /v1/restaurant/orders/:id/ready     - Mark ready
PUT  /v1/restaurant/orders/:id/cancel    - Cancel order
PUT  /v1/restaurant/menu/:id    - Update menu item
POST /v1/restaurant/menu        - Add menu item
PUT  /v1/restaurant/status      - Toggle open/closed
```

### Events Emitted

- `order.placed` - New order
- `order.confirmed` - Restaurant confirmed
- `order.preparing` - Being prepared
- `order.ready` - Ready for pickup
- `order.picked_up` - Driver picked up
- `order.delivered` - Order delivered
- `order.cancelled` - Order cancelled

---

## 5. Delivery Service (Go)

**Purpose:** Package delivery for individuals and businesses.

### Responsibilities

- Delivery request handling
- Route optimization
- Real-time tracking
- Proof of delivery
- Business API integration
- Pricing calculations

### API Endpoints

#### Deliveries

```
POST /v1/deliveries             - Create delivery
GET  /v1/deliveries/:id         - Get delivery details
PUT  /v1/deliveries/:id/cancel  - Cancel delivery
GET  /v1/deliveries/:id/track   - Real-time tracking
GET  /v1/deliveries/history     - Delivery history
GET  /v1/deliveries/quote       - Get price quote
```

#### Driver Operations

```
POST /v1/deliveries/:id/pickup  - Confirm pickup
POST /v1/deliveries/:id/pod     - Submit proof of delivery
POST /v1/deliveries/:id/failed  - Mark delivery failed
```

#### Business API

```
POST /v1/business/deliveries/bulk  - Bulk create deliveries
GET  /v1/business/deliveries       - List business deliveries
GET  /v1/business/webhook          - Get webhook config
PUT  /v1/business/webhook          - Update webhook URL
```

### Events Emitted

- `delivery.created` - New delivery request
- `delivery.assigned` - Driver assigned
- `delivery.picked_up` - Package picked up
- `delivery.in_transit` - In transit
- `delivery.delivered` - Successfully delivered
- `delivery.failed` - Delivery failed

---

## 6. Payment Service

**Purpose:** Handles all financial transactions.

### Responsibilities

- Mobile money integration (M-Pesa, MTN MoMo)
- Card payments (Stripe, Paystack)
- Wallet management
- Escrow for trips
- Driver earnings
- CEERION auto-deductions
- Settlement and reconciliation

### API Endpoints

#### Payments

```
POST /v1/payments/initiate      - Initiate payment
GET  /v1/payments/:id           - Get payment status
POST /v1/payments/:id/confirm   - Confirm payment
POST /v1/payments/webhook/mpesa - M-Pesa webhook
POST /v1/payments/webhook/mtn   - MTN MoMo webhook
```

#### Wallet

```
GET  /v1/wallet                 - Get wallet balance
POST /v1/wallet/topup           - Top up wallet
POST /v1/wallet/withdraw        - Withdraw to mobile money
GET  /v1/wallet/transactions    - Transaction history
```

#### Driver Earnings

```
GET  /v1/earnings               - Get earnings summary
GET  /v1/earnings/history       - Earnings history
POST /v1/earnings/withdraw      - Withdraw earnings
GET  /v1/earnings/deductions    - View deductions
```

#### CEERION Integration

```
GET  /v1/ceerion/status         - Financing status
GET  /v1/ceerion/payments       - Payment schedule
POST /v1/ceerion/pay            - Make manual payment
```

### Events Emitted

- `payment.initiated` - Payment started
- `payment.completed` - Payment successful
- `payment.failed` - Payment failed
- `payment.refunded` - Payment refunded
- `wallet.credited` - Wallet top-up
- `wallet.debited` - Wallet deduction
- `earning.credited` - Driver earning added
- `earning.withdrawn` - Earning withdrawn
- `ceerion.payment_due` - CEERION payment due
- `ceerion.payment_success` - CEERION payment made

### Mobile Money Flow

```
┌─────────┐     ┌─────────────┐     ┌──────────────┐     ┌─────────┐
│  User   │────▶│ Payment Svc │────▶│  M-Pesa API  │────▶│  USSD   │
└─────────┘     └─────────────┘     └──────────────┘     └─────────┘
                      │                                       │
                      │◀──────── Webhook Callback ────────────┘
                      │
                      ▼
              ┌─────────────┐
              │ Update Ride │
              │   Status    │
              └─────────────┘
```

---

## 7. Notification Service

**Purpose:** Multi-channel notification delivery.

### Responsibilities

- Push notifications (FCM, APNs)
- SMS delivery (Africa's Talking, Twilio)
- Email (SendGrid, SES)
- WhatsApp Business API
- In-app notifications
- Notification preferences

### API Endpoints

```
POST /v1/notifications/send     - Send notification
GET  /v1/notifications          - Get user notifications
PUT  /v1/notifications/:id/read - Mark as read
PUT  /v1/notifications/read-all - Mark all as read
GET  /v1/notifications/preferences  - Get preferences
PUT  /v1/notifications/preferences  - Update preferences
```

### Event Subscriptions

Listens to:

- `ride.accepted` → Push to rider
- `ride.driver_arriving` → Push to rider
- `ride.completed` → Push to both
- `order.confirmed` → Push to customer
- `order.ready` → Push to driver
- `delivery.picked_up` → SMS to recipient
- `payment.completed` → Push + SMS
- `ceerion.payment_due` → Push + SMS

### Notification Templates

```yaml
ride.accepted:
  push:
    title: "Driver on the way!"
    body: "{{driver_name}} will arrive in {{eta}} minutes"
  sms:
    body: "UBI: Your driver {{driver_name}} ({{plate}}) is on the way. ETA: {{eta}}min"
```

---

## Service Communication

### Synchronous (HTTP/gRPC)

- API Gateway → All Services
- Ride Service → Payment Service (fare collection)
- Food Service → Payment Service (order payment)

### Asynchronous (Events)

- All services publish to Kafka/Redis Streams
- Notification Service subscribes to relevant events
- Analytics Service consumes all events

### Service Discovery

- Kubernetes DNS (production)
- Docker network DNS (development)

---

## Health Checks

All services implement:

```
GET /health/live   - Kubernetes liveness probe
GET /health/ready  - Kubernetes readiness probe
GET /health        - Detailed health with dependencies
```

Response format:

```json
{
  "status": "healthy",
  "version": "1.2.3",
  "uptime": 86400,
  "checks": {
    "database": { "status": "up", "latency": 5 },
    "redis": { "status": "up", "latency": 1 },
    "kafka": { "status": "up", "latency": 10 }
  }
}
```
