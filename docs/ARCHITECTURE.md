# UBI Architecture Documentation

This document provides an in-depth overview of UBI's technical architecture.

## System Overview

UBI is built as a distributed microservices architecture optimized for:

- High availability across African markets
- Low latency for real-time operations
- Horizontal scalability
- Independent deployability

## High-Level Architecture

```
                                    ┌─────────────────────────────────────┐
                                    │           LOAD BALANCER             │
                                    │         (AWS ALB / CloudFlare)      │
                                    └─────────────────┬───────────────────┘
                                                      │
                    ┌─────────────────────────────────┼─────────────────────────────────┐
                    │                                 │                                 │
           ┌────────┴────────┐              ┌────────┴────────┐              ┌────────┴────────┐
           │   WEB APPS      │              │   API GATEWAY   │              │   MOBILE APPS   │
           │   (Vercel)      │              │   (ECS/K8s)     │              │   (CDN)         │
           └─────────────────┘              └────────┬────────┘              └─────────────────┘
                                                     │
                    ┌────────────────────────────────┼────────────────────────────────┐
                    │                                │                                │
         ┌──────────┴──────────┐        ┌───────────┴───────────┐       ┌────────────┴────────────┐
         │   CORE SERVICES     │        │   DOMAIN SERVICES     │       │   SUPPORT SERVICES      │
         ├─────────────────────┤        ├───────────────────────┤       ├─────────────────────────┤
         │ • User Service      │        │ • Ride Service (Go)   │       │ • Notification Service  │
         │ • Payment Service   │        │ • Food Service        │       │ • Analytics Service     │
         │ • Auth Service      │        │ • Delivery Service(Go)│       │ • Search Service        │
         └──────────┬──────────┘        └───────────┬───────────┘       └────────────┬────────────┘
                    │                               │                                │
                    └───────────────────────────────┼────────────────────────────────┘
                                                    │
                    ┌───────────────────────────────┼───────────────────────────────┐
                    │                               │                               │
           ┌────────┴────────┐            ┌────────┴────────┐            ┌─────────┴─────────┐
           │   PostgreSQL    │            │      Redis      │            │   Object Storage  │
           │   (RDS)         │            │ (ElastiCache)   │            │   (S3)            │
           └─────────────────┘            └─────────────────┘            └───────────────────┘
```

## Service Architecture

### API Gateway

The API Gateway is the single entry point for all client requests.

**Responsibilities:**

- Request routing
- Authentication/Authorization
- Rate limiting
- Request/Response transformation
- Load balancing

**Technology:** Hono (Node.js)

```
┌─────────────────────────────────────────────────────────────┐
│                       API GATEWAY                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌──────────┐ │
│  │   Auth    │→ │   Rate    │→ │  Request  │→ │  Router  │ │
│  │Middleware │  │  Limiter  │  │  Logger   │  │          │ │
│  └───────────┘  └───────────┘  └───────────┘  └──────────┘ │
│                                                      │      │
│  ┌──────────────────────────────────────────────────┴────┐ │
│  │                  SERVICE PROXY                        │ │
│  │                                                       │ │
│  │  /v1/users/*    → user-service                       │ │
│  │  /v1/rides/*    → ride-service                       │ │
│  │  /v1/food/*     → food-service                       │ │
│  │  /v1/delivery/* → delivery-service                   │ │
│  │  /v1/payments/* → payment-service                    │ │
│  │                                                       │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Ride Service (Go)

High-performance service for ride matching and tracking.

**Key Features:**

- Real-time driver matching with geospatial queries
- ETA calculations
- Surge pricing
- Route optimization

**Architecture:**

```
┌─────────────────────────────────────────────────────┐
│                   RIDE SERVICE                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────┐    ┌──────────────────────────┐   │
│  │   HTTP      │    │      DOMAIN LAYER        │   │
│  │   Handler   │───▶│                          │   │
│  └─────────────┘    │  ┌────────────────────┐  │   │
│                     │  │   Ride Service     │  │   │
│                     │  └────────────────────┘  │   │
│                     │           │              │   │
│                     │  ┌────────┴────────┐    │   │
│                     │  │                 │    │   │
│                     │  ▼                 ▼    │   │
│                     │┌────────┐   ┌──────────┐│   │
│                     ││Matching│   │ Pricing  ││   │
│                     ││Engine  │   │ Engine   ││   │
│                     │└────────┘   └──────────┘│   │
│                     └──────────────────────────┘   │
│                                │                   │
│  ┌─────────────────────────────┴─────────────────┐│
│  │              INFRASTRUCTURE LAYER              ││
│  │                                                ││
│  │  ┌──────────┐  ┌──────────┐  ┌─────────────┐ ││
│  │  │PostgreSQL│  │  Redis   │  │   Events    │ ││
│  │  │ + PostGIS│  │  Cache   │  │   (Pub/Sub) │ ││
│  │  └──────────┘  └──────────┘  └─────────────┘ ││
│  └────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

### Payment Service

Handles all financial transactions across multiple payment providers.

**Supported Payment Methods:**
| Method | Countries |
|--------|-----------|
| M-Pesa | KE, TZ, GH |
| MTN MoMo | GH, RW, UG |
| Airtel Money | KE, UG, RW |
| Cards | All |
| Bank Transfer | NG, ZA |
| UBI Wallet | All |

**Flow:**

```
┌──────────┐    ┌─────────────┐    ┌───────────────┐    ┌─────────────┐
│  Client  │───▶│  API GW     │───▶│ Payment Svc   │───▶│  Provider   │
└──────────┘    └─────────────┘    └───────────────┘    └─────────────┘
                                          │
                                          ▼
                                   ┌─────────────┐
                                   │   Wallet    │
                                   │   Service   │
                                   └─────────────┘
```

## Data Architecture

### Database Schema Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           PRIMARY DATABASE                               │
│                         (PostgreSQL + PostGIS)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │    User     │───▶│   Rider     │    │   Driver    │                 │
│  │   Account   │    │   Profile   │    │   Profile   │                 │
│  └─────────────┘    └─────────────┘    └──────┬──────┘                 │
│         │                                      │                        │
│         ▼                                      ▼                        │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │   Wallet    │    │    Ride     │◀───│   Vehicle   │                 │
│  │             │    │             │    │             │                 │
│  └──────┬──────┘    └──────┬──────┘    └─────────────┘                 │
│         │                  │                                           │
│         ▼                  ▼                                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐                 │
│  │ Transaction │    │  Payment    │◀───│ Food Order  │                 │
│  │             │    │             │    │             │                 │
│  └─────────────┘    └─────────────┘    └─────────────┘                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Caching Strategy

| Data Type        | Cache TTL | Strategy      |
| ---------------- | --------- | ------------- |
| User Sessions    | 24h       | Write-through |
| Driver Locations | 10s       | Write-behind  |
| Ride Prices      | 5min      | Cache-aside   |
| Restaurant Menus | 1h        | Cache-aside   |
| Config           | 5min      | Write-through |

### Event-Driven Architecture

```
┌───────────────┐         ┌───────────────────┐         ┌───────────────┐
│  Ride Service │────────▶│   Redis Streams   │────────▶│ Notification  │
│               │         │                   │         │   Service     │
└───────────────┘         │  Events:          │         └───────────────┘
                          │  • ride.requested │
┌───────────────┐         │  • ride.accepted  │         ┌───────────────┐
│ Payment Svc   │────────▶│  • ride.completed │────────▶│ Analytics Svc │
│               │         │  • payment.success│         │               │
└───────────────┘         │  • order.placed   │         └───────────────┘
                          └───────────────────┘
```

## Security Architecture

### Authentication Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     AUTHENTICATION FLOW                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Login Request                                                │
│  ┌────────┐                  ┌─────────────┐                    │
│  │ Client │ ── credentials ─▶│ User Service│                    │
│  └────────┘                  └──────┬──────┘                    │
│                                     │                            │
│  2. Verify & Generate Tokens        │                            │
│                                     ▼                            │
│                              ┌─────────────┐                    │
│                              │  JWT Sign   │                    │
│                              │  (RS256)    │                    │
│                              └──────┬──────┘                    │
│                                     │                            │
│  3. Return Tokens                   ▼                            │
│  ┌────────┐◀──── access_token ─────────────                     │
│  │ Client │◀──── refresh_token ────────────                     │
│  └────────┘                                                     │
│                                                                  │
│  4. Subsequent Requests                                         │
│  ┌────────┐     ┌───────────┐     ┌─────────────┐              │
│  │ Client │────▶│ API GW    │────▶│ Auth Check  │              │
│  │        │     │           │     │ (verify JWT)│              │
│  └────────┘     └───────────┘     └─────────────┘              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Security Measures

| Layer          | Protection                        |
| -------------- | --------------------------------- |
| Transport      | TLS 1.3                           |
| Authentication | JWT (RS256)                       |
| Authorization  | RBAC + ABAC                       |
| API            | Rate limiting, request validation |
| Data           | Encryption at rest (AES-256)      |
| Secrets        | AWS Secrets Manager               |

## Infrastructure

### AWS Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              AWS REGION                                  │
│                         (af-south-1 / eu-west-1)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                           VPC                                    │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │                    PUBLIC SUBNET                         │    │   │
│  │  │                                                          │    │   │
│  │  │    ┌─────────┐         ┌─────────┐                      │    │   │
│  │  │    │   ALB   │         │   NAT   │                      │    │   │
│  │  │    │         │         │ Gateway │                      │    │   │
│  │  │    └────┬────┘         └─────────┘                      │    │   │
│  │  │         │                                                │    │   │
│  │  └─────────┼────────────────────────────────────────────────┘    │   │
│  │            │                                                      │   │
│  │  ┌─────────┼────────────────────────────────────────────────┐    │   │
│  │  │         │           PRIVATE SUBNET                        │    │   │
│  │  │         ▼                                                 │    │   │
│  │  │    ┌─────────┐    ┌─────────┐    ┌─────────┐            │    │   │
│  │  │    │   ECS   │    │   ECS   │    │   ECS   │            │    │   │
│  │  │    │  Svc A  │    │  Svc B  │    │  Svc C  │            │    │   │
│  │  │    └─────────┘    └─────────┘    └─────────┘            │    │   │
│  │  │                                                          │    │   │
│  │  └──────────────────────────────────────────────────────────┘    │   │
│  │                                                                   │   │
│  │  ┌──────────────────────────────────────────────────────────┐    │   │
│  │  │                    DATA SUBNET                            │    │   │
│  │  │                                                           │    │   │
│  │  │    ┌─────────┐    ┌─────────┐    ┌─────────┐            │    │   │
│  │  │    │   RDS   │    │ElastiCch│    │   S3    │            │    │   │
│  │  │    │ Primary │    │  Redis  │    │         │            │    │   │
│  │  │    └─────────┘    └─────────┘    └─────────┘            │    │   │
│  │  │                                                           │    │   │
│  │  └───────────────────────────────────────────────────────────┘    │   │
│  │                                                                   │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Multi-Region Deployment

| Region     | Primary Use  | Services |
| ---------- | ------------ | -------- |
| af-south-1 | South Africa | All      |
| eu-west-1  | West Africa  | All      |
| me-south-1 | East Africa  | CDN, DR  |

## Performance Considerations

### Latency Targets

| Operation           | Target | P99   |
| ------------------- | ------ | ----- |
| API Gateway routing | 10ms   | 50ms  |
| Driver matching     | 100ms  | 500ms |
| Payment processing  | 2s     | 5s    |
| ETA calculation     | 50ms   | 200ms |

### Scaling Strategy

| Service         | Min | Max | Trigger         |
| --------------- | --- | --- | --------------- |
| API Gateway     | 3   | 50  | CPU > 70%       |
| Ride Service    | 5   | 100 | Requests > 1k/s |
| Payment Service | 3   | 30  | Queue depth     |
| Food Service    | 2   | 20  | CPU > 70%       |

## Monitoring & Observability

### Logging

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Services   │───▶│   Fluent     │───▶│ CloudWatch   │
│              │    │   Bit        │    │   Logs       │
└──────────────┘    └──────────────┘    └──────────────┘
```

### Metrics

- **Infrastructure**: CloudWatch Metrics
- **Application**: Custom metrics via StatsD
- **Business**: Custom dashboards

### Tracing

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Services   │───▶│   X-Ray /    │───▶│  Trace UI    │
│              │    │   Jaeger     │    │              │
└──────────────┘    └──────────────┘    └──────────────┘
```

## Disaster Recovery

### RPO/RTO Targets

| Tier   | RPO | RTO   | Services       |
| ------ | --- | ----- | -------------- |
| Tier 1 | 0   | 15min | Payments, Auth |
| Tier 2 | 1h  | 1h    | Rides, Food    |
| Tier 3 | 4h  | 4h    | Analytics      |

### Backup Strategy

| Data     | Frequency  | Retention |
| -------- | ---------- | --------- |
| Database | Continuous | 35 days   |
| Config   | On change  | 90 days   |
| Logs     | Daily      | 30 days   |

---

For more details, see individual service documentation in each service's README.
