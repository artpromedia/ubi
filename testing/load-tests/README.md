# UBI Load Testing Infrastructure

Comprehensive load testing suite for the UBI platform using k6 and Grafana.

## Overview

This load testing infrastructure is designed to validate:

- **10,000 concurrent rides** during peak hours
- **100,000 API requests/minute** throughput
- **100,000 WebSocket connections** for real-time tracking
- System stability under stress and spike conditions

## Quick Start

### Prerequisites

- Docker and Docker Compose
- k6 (for local testing)
- Node.js 18+ (for configuration)

### Setup Monitoring Stack

```bash
# Start InfluxDB and Grafana
cd testing/load-tests
docker-compose up -d

# Access Grafana at http://localhost:3030
# Username: admin, Password: admin
```

### Run Load Tests

```bash
# Install k6 (macOS)
brew install k6

# Install k6 (Windows - use chocolatey)
choco install k6

# Run smoke test
k6 run scenarios/api-endpoints.js --env TEST_ENV=staging

# Run ride booking load test
k6 run scenarios/ride-booking.js --env TEST_ENV=staging

# Run WebSocket load test
k6 run scenarios/websocket-load.js --env TEST_ENV=staging

# Run combined load test (realistic traffic)
k6 run scenarios/combined-load.js --env TEST_ENV=staging
```

### Run with InfluxDB Output

```bash
# Send metrics to InfluxDB for Grafana visualization
k6 run --out influxdb=http://localhost:8086/k6 scenarios/combined-load.js
```

## Test Scenarios

### 1. API Endpoints (`api-endpoints.js`)

Tests individual API performance:

- Authentication (OTP request/verify)
- Location search
- Ride pricing
- User profile operations

**Targets:**

- P95 response time < 300ms
- Error rate < 1%

### 2. Ride Booking (`ride-booking.js`)

Full ride booking flow:

1. User authentication
2. Location search (pickup & dropoff)
3. Get ride options and pricing
4. Create booking
5. Wait for driver match
6. Simulate ride progress
7. Complete ride and rate

**Targets:**

- 10K concurrent rides
- Driver match < 60s (P95)
- Success rate > 95%

### 3. WebSocket Load (`websocket-load.js`)

Real-time communication testing:

- Rider tracking connections
- Driver location updates
- Message latency

**Targets:**

- 100K concurrent connections
- Connection time < 1s (P95)
- Message latency < 100ms (P95)

### 4. Combined Load (`combined-load.js`)

Realistic traffic simulation:

- 40% ride booking
- 30% food ordering
- 15% delivery tracking
- 10% profile operations
- 5% payments
- Background WebSocket connections

## Load Profiles

### Smoke Test

```javascript
{ vus: 10, duration: '2m' }
```

Quick validation of test scripts.

### Load Test

```javascript
stages: [
  { duration: "2m", target: 100 },
  { duration: "5m", target: 1000 },
  { duration: "10m", target: 1000 },
  { duration: "2m", target: 0 },
];
```

Normal load validation.

### Stress Test

```javascript
stages: [
  { duration: "2m", target: 1000 },
  { duration: "5m", target: 5000 },
  { duration: "5m", target: 10000 },
  { duration: "5m", target: 10000 },
  { duration: "5m", target: 0 },
];
```

Find breaking points.

### Spike Test

```javascript
stages: [
  { duration: "1m", target: 100 },
  { duration: "30s", target: 10000 },
  { duration: "2m", target: 10000 },
  { duration: "30s", target: 100 },
  { duration: "2m", target: 0 },
];
```

Sudden traffic spike simulation.

### Soak Test

```javascript
stages: [
  { duration: "5m", target: 1000 },
  { duration: "4h", target: 1000 },
  { duration: "5m", target: 0 },
];
```

Long-duration stability testing.

## Thresholds

All tests include these performance thresholds:

| Metric               | P95     | P99      |
| -------------------- | ------- | -------- |
| HTTP Response Time   | < 500ms | < 1000ms |
| Auth Duration        | < 200ms | < 300ms  |
| Search Duration      | < 150ms | < 200ms  |
| Pricing Duration     | < 400ms | < 500ms  |
| WebSocket Connection | < 1s    | < 2s     |
| WebSocket Latency    | < 100ms | < 200ms  |
| Error Rate           | < 1%    | -        |

## Grafana Dashboard

The dashboard provides real-time visibility into:

1. **Overview Panel**
   - P95 Response Time
   - Error Rate
   - Active VUs
   - Requests/sec

2. **Response Times**
   - P50/P95/P99 distribution
   - Response time by scenario

3. **Throughput & Errors**
   - Requests per second by scenario
   - Error breakdown by status code

4. **WebSocket Metrics**
   - Active connections
   - Message latency
   - Messages/sec

5. **Business Metrics**
   - Bookings created/sec
   - Ride success rate
   - Driver match time

## Distributed Testing

For large-scale tests, use k6 Cloud or multiple k6 instances:

```bash
# Using k6 Cloud
k6 cloud scenarios/combined-load.js

# Using multiple local instances
k6 run --execution-segment="0:1/2" scenarios/combined-load.js &
k6 run --execution-segment="1/2:1" scenarios/combined-load.js &
```

## CI/CD Integration

```yaml
# GitHub Actions example
- name: Run Load Tests
  uses: grafana/k6-action@v0.3.0
  with:
    filename: testing/load-tests/scenarios/api-endpoints.js
    flags: --env TEST_ENV=staging
```

## Troubleshooting

### High Error Rate

- Check backend logs for errors
- Verify test environment capacity
- Review rate limiting configuration

### Slow Response Times

- Check database query performance
- Review Redis cache hit rates
- Monitor CPU/memory usage

### WebSocket Failures

- Verify WebSocket server capacity
- Check connection limits
- Review HAProxy/Nginx configuration

## Files Structure

```
testing/load-tests/
├── config.js              # Test configuration
├── utils.js               # Utility functions
├── docker-compose.yml     # Monitoring stack
├── README.md              # This file
├── scenarios/
│   ├── api-endpoints.js   # API load tests
│   ├── ride-booking.js    # Ride flow tests
│   ├── websocket-load.js  # WebSocket tests
│   └── combined-load.js   # Full simulation
└── grafana/
    └── dashboard.json     # Grafana dashboard
```

## Performance Baselines

After running tests, document baseline metrics:

| Scenario | VUs   | RPS  | P95 (ms) | Error % |
| -------- | ----- | ---- | -------- | ------- |
| Smoke    | 10    | 50   | 120      | 0%      |
| Load     | 1000  | 2500 | 280      | 0.1%    |
| Stress   | 10000 | 8500 | 450      | 0.8%    |
| Spike    | 10000 | 9000 | 380      | 0.5%    |

Update these after each major release to track performance trends.
