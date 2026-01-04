# UBI Real-Time Systems Architecture

## Overview

The real-time infrastructure powers live features across UBI's super-app, handling 100K+ concurrent connections and processing 500K+ location updates per minute with sub-second latency.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  Driver  │  │  Rider   │  │Restaurant│  │ Delivery │           │
│  │   App    │  │   App    │  │  Portal  │  │  Partner │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
└───────┼─────────────┼─────────────┼─────────────┼──────────────────┘
        │             │             │             │
        │             └─────────────┴─────────────┘
        │                         │
        │                    WebSocket
        │                         │
┌───────▼─────────────────────────▼───────────────────────────────────┐
│                    REAL-TIME GATEWAY LAYER                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │   Gateway   │  │   Gateway   │  │   Gateway   │                │
│  │   Node 1    │  │   Node 2    │  │   Node N    │                │
│  │  (50K conn) │  │  (50K conn) │  │  (50K conn) │                │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                │
│         └──────────────────┼──────────────────┘                     │
└────────────────────────────┼──────────────────────────────────────┘
                             │
                ┌────────────▼────────────┐
                │   Redis Pub/Sub Cluster │
                │   (Cross-Server Messaging)│
                └────────────┬────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼──────┐    ┌────────▼────────┐    ┌────▼─────────┐
│   Location   │    │    Matching     │    │ Notification │
│   Service    │    │    Engine       │    │   Service    │
│   (Go/H3)    │    │    (Go)         │    │  (Node.js)   │
└───────┬──────┘    └────────┬────────┘    └──────────────┘
        │                    │
        │           ┌────────▼────────┐
        └──────────►│  Kafka Cluster  │
                    │ (Event Streaming)│
                    └─────────────────┘
```

## Core Components

### 1. Real-Time Gateway (Node.js/TypeScript)

**Purpose**: Handle WebSocket connections from mobile/web clients

**Key Features**:

- 50K concurrent connections per instance
- Horizontal scaling via Redis Pub/Sub
- Multi-device support (one user, multiple connections)
- Heartbeat monitoring (30s interval)
- Automatic reconnection handling

**Technology Stack**:

- Node.js 20+ with `ws` library
- Redis for cross-server messaging
- Stateless design (no sticky sessions)

**Message Flow**:

```
Client → WebSocket → Gateway → Redis Pub/Sub → Services
Services → Redis Pub/Sub → Gateway → WebSocket → Client
```

### 2. Location Service (Go)

**Purpose**: High-performance driver location tracking with geospatial indexing

**Key Features**:

- H3 hexagonal grid indexing (Resolution 8: ~460m cells)
- Sub-50ms nearby driver queries
- Redis Geo for exact distance
- Kafka streaming for analytics
- 30-second location TTL

**Data Flow**:

```
Driver Location Update
  ↓
Location Service
  ├→ Redis (H3 Index + Geo)
  ├→ Redis Pub/Sub (Real-time)
  └→ Kafka (Storage/Analytics)
```

**H3 Indexing Benefits**:

- O(1) lookup per hexagon
- Uniform coverage (no lat/lng distortion)
- Easy radius expansion (grid rings)
- ~2.8 km coverage with 2-ring search

### 3. Matching Engine (Go)

**Purpose**: Real-time driver-rider matching with intelligent dispatch

**Matching Algorithm**:

```go
1. Find nearby drivers (H3 + Haversine)
   - Start: 2 km radius
   - Expand: +2 km per iteration
   - Max: 8 km

2. Score drivers:
   - Distance penalty: -5 points per km
   - ETA penalty: -2 points per minute
   - Rating bonus: (rating - 4.0) * 10
   - Acceptance rate bonus: rate * 20
   - Heading bonus: 0-10 points

3. Dispatch to best drivers:
   - Send request via WebSocket
   - 15-second timeout
   - Retry next driver if rejected

4. Match confirmed
```

**Dispatch Flow**:

```
Ride Request
  ↓
Find Drivers (Location Service)
  ↓
Score & Rank
  ↓
Dispatch to #1 Driver → WebSocket → Driver App
  ↓ (15s timeout)
Accept? → YES → Match Confirmed
        → NO  → Try #2 Driver
                (repeat)
```

### 4. ETA Service (Go)

**Purpose**: Calculate accurate arrival times with traffic adjustment

**Features**:

- Routing API integration (Google Maps/Mapbox/OSRM)
- Traffic multipliers (time-of-day + real-time)
- 2-minute caching
- Confidence scoring

**Traffic Multipliers**:

- Weekday rush hours (7-9 AM, 5-7 PM): 1.3-1.4x
- Weekend midday: 1.2x
- Late night: 0.9x
- Real-time adjustments from H3 cells

### 5. Surge Pricing Engine (Go)

**Purpose**: Dynamic pricing based on supply/demand

**Surge Calculation**:

```go
Ratio = Active Requests / Available Drivers

if ratio <= 0.5:  1.0x  (no surge)
if ratio <= 1.0:  1.0x - 1.25x
if ratio <= 2.0:  1.25x - 1.75x
if ratio <= 3.0:  1.75x - 2.25x
if ratio > 3.0:   up to 3.0x (capped)
```

**H3 Zone-Based**:

- Resolution 7 (~5.16 km² hexagons)
- Includes 1-ring neighbors for stability
- 30-second cache TTL
- Real-time zone tracking

## Data Storage

### Redis Keys Structure

```
# Connections
user:{userId}:connections              SET of connection IDs
connection:{connectionId}              HASH of connection details

# Driver Locations
drivers:geo                            GEOADD (all drivers)
h3:{h3Index}:drivers                   SET (drivers in hexagon)
driver:{driverId}:location             HASH (location details)
drivers:available                      SET (available driver IDs)

# Surge Pricing
zone:{h3Index}:requests                SET (active requests)
surge:{h3Index}                        JSON (surge data)

# Matching
request:{requestId}                    JSON (ride request)
dispatch:{dispatchId}                  JSON (dispatch record)
driver:{driverId}:stats                HASH (rating, acceptance)

# ETA Cache
eta:{hash}                             JSON (2-min TTL)
```

### Kafka Topics

```
driver-locations        Driver location events
ride-requests           New ride requests
ride-matches            Successful matches
trip-events             Trip lifecycle events
order-events            Food/delivery events
notifications           Push notifications
connection-events       Connect/disconnect events
```

## Performance Characteristics

### Latency Targets

| Operation            | Target | P99   |
| -------------------- | ------ | ----- |
| Message delivery     | 50ms   | 100ms |
| Location update      | 5ms    | 10ms  |
| Nearby driver search | 30ms   | 50ms  |
| Ride matching        | 2s     | 3s    |
| ETA calculation      | 100ms  | 200ms |

### Throughput Targets

| Metric                 | Year 1 | Year 3 |
| ---------------------- | ------ | ------ |
| Concurrent connections | 150K   | 2.5M   |
| Location updates/min   | 500K   | 10M    |
| Rides/day              | 50K    | 1M     |
| Messages/second        | 10K    | 100K   |

### Resource Requirements

**Per Gateway Instance (50K connections)**:

- CPU: 2 cores
- Memory: 1 GB
- Network: 100 Mbps

**Location Service (100K drivers)**:

- CPU: 1 core
- Memory: 512 MB
- Redis: 20 MB

**Redis Cluster**:

- Memory: 4-8 GB
- Persistence: AOF + RDB
- Replication: Master + 2 replicas

## Scaling Strategy

### Horizontal Scaling

**Gateway**: Stateless, scales linearly

```
1 instance = 50K connections
10 instances = 500K connections
20 instances = 1M connections
```

**Location Service**: Stateless, Redis-backed

```
Scale based on query throughput
2 instances handle 100K drivers
10 instances handle 1M+ drivers
```

**Redis**: Cluster mode for memory scaling

```
Single instance: 100K drivers (20 MB)
Cluster: Sharded by key pattern
```

### Load Balancing

**ALB/NLB Configuration**:

```yaml
Algorithm: Round Robin
Health Check: /health endpoint
Connection Draining: 30s
Cross-Zone: Enabled
```

**No Sticky Sessions**:

- Redis Pub/Sub handles cross-server messaging
- Users can connect to any gateway instance
- Better load distribution

## Network Optimization for Africa

### Mobile Network Challenges

1. **High Latency (200-500ms)**
   - Minimize round trips
   - Batch operations where possible
   - Aggressive caching

2. **Frequent Disconnections**
   - Automatic reconnection with exponential backoff
   - Offline buffering (location updates)
   - Resume from last state

3. **Limited Bandwidth**
   - Binary protocols (MessagePack/Protobuf)
   - Compression (gzip/brotli)
   - Differential location updates

4. **Data Cost Sensitivity**
   - Adaptive update frequency
   - WiFi vs cellular detection
   - Selective message priority

### Implementation

**Adaptive Location Frequency**:

```typescript
if (isMoving && speed > 20 km/h) {
  updateInterval = 3s  // Fast movement
} else if (isMoving) {
  updateInterval = 5s  // Slow movement
} else {
  updateInterval = 10s // Stationary
}

if (isOnWiFi) {
  updateInterval *= 0.5  // More frequent on WiFi
}
```

**Reconnection Strategy**:

```typescript
let retryDelay = 1000; // Start at 1s
const maxDelay = 30000; // Cap at 30s

function reconnect() {
  setTimeout(() => {
    connect();
    retryDelay = Math.min(retryDelay * 2, maxDelay);
  }, retryDelay);
}
```

**Battery Optimization**:

- Background location mode (low accuracy)
- Geofence-based triggers
- Batch uploads every 30s
- Suspend updates when app backgrounded

## Security

### Authentication

**JWT Tokens**:

```
WebSocket URL: ws://gateway/ws?token={JWT}
Headers: Authorization: Bearer {JWT}
```

**Token Verification**:

- Verify signature
- Check expiration
- Extract userId and userType
- Rate limiting per user

### Authorization

**User Type Permissions**:

```typescript
Driver:
  - Send: location_update, dispatch_response
  - Receive: ride_request, eta_update

Rider:
  - Send: (none, uses HTTP API)
  - Receive: ride_status, driver_location, notification

Restaurant:
  - Send: order_status_update
  - Receive: new_order, order_cancellation
```

### Rate Limiting

**Per User**:

```
Location updates: 1 per 3 seconds
Dispatch responses: 10 per minute
Message receiving: unlimited
```

**Per IP**:

```
Connection attempts: 10 per minute
HTTP API calls: 100 per minute
```

## Monitoring & Alerting

### Key Metrics

1. **Availability**: 99.9% uptime SLA
2. **Latency**: P95 < 100ms, P99 < 200ms
3. **Throughput**: Messages/sec, Locations/min
4. **Errors**: Connection failures, Timeouts
5. **Business**: Match rate, Driver utilization

### Critical Alerts

- High connection loss rate (> 100/s)
- Matching latency > 5s
- No available drivers in zone
- Redis memory > 90%
- Kafka consumer lag > 10K

## Disaster Recovery

### Failure Scenarios

**Gateway Instance Failure**:

- Clients auto-reconnect to healthy instance
- No data loss (Redis persists state)
- Recovery time: < 30s

**Redis Failure**:

- Failover to replica (automatic)
- Temporary matching degradation
- Recovery time: < 60s

**Location Service Failure**:

- Use cached data (30s stale)
- Expand search radius
- Recovery time: Immediate (stateless)

### Backup Strategy

**Redis**:

- AOF + RDB snapshots
- Hourly backups to S3
- Point-in-time recovery

**Kafka**:

- 7-day retention
- Replication factor: 3
- Consumer offset commits

## Cost Optimization

### Year 1 Estimates (50K rides/day)

**Infrastructure**:

- Gateway: 3 instances × $50/mo = $150
- Location: 2 instances × $25/mo = $50
- Redis: 1 cluster (8 GB) = $100
- Kafka: 3 brokers = $150
- **Total**: ~$450/month

**Data Transfer**:

- WebSocket: 500 GB/mo = $50
- Kafka: 1 TB/mo = $100
- **Total**: ~$150/month

**Grand Total**: ~$600/month (~$0.012 per ride)

### Year 3 Estimates (1M rides/day)

**Infrastructure**:

- Gateway: 20 instances = $1,000
- Location: 10 instances = $250
- Redis: Cluster (32 GB) = $400
- Kafka: 6 brokers = $300
- **Total**: ~$1,950/month

**Data Transfer**: ~$500/month

**Grand Total**: ~$2,450/month (~$0.002 per ride)

## Deployment

See [k8s/](../../k8s/) for Kubernetes manifests.

Quick start with Docker Compose:

```bash
docker-compose -f docker/docker-compose.realtime.yml up
```

## Testing

### Load Testing

**WebSocket Connections**:

```bash
# Simulate 10K concurrent connections
artillery run tests/load/websocket-load.yml
```

**Location Updates**:

```bash
# Simulate 100K location updates
k6 run tests/load/location-load.js
```

### Integration Tests

```bash
pnpm test:integration
```

## Next Steps

1. **Phase 1** (Weeks 1-2): Deploy Gateway + Location Service
2. **Phase 2** (Weeks 3-4): Integrate Matching Engine
3. **Phase 3** (Week 5): Add Surge Pricing
4. **Phase 4** (Week 6): Production testing and monitoring
5. **Phase 5** (Week 7-8): Optimization and tuning

## References

- [H3 Documentation](https://h3geo.org/)
- [WebSocket Protocol](https://tools.ietf.org/html/rfc6455)
- [Redis Pub/Sub](https://redis.io/topics/pubsub)
- [Kafka Documentation](https://kafka.apache.org/documentation/)
