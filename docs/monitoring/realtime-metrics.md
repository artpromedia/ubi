# Real-Time Systems Monitoring Dashboard

## Prometheus Queries

### Connection Metrics

```promql
# Total WebSocket connections
sum(websocket_connections_total)

# Connections by user type
sum(websocket_connections_total) by (user_type)

# Connection rate (per minute)
rate(websocket_connections_total[1m]) * 60

# Connection churn
rate(websocket_disconnections_total[5m]) * 300
```

### Latency Metrics

```promql
# P95 message delivery latency
histogram_quantile(0.95, rate(message_delivery_duration_seconds_bucket[5m]))

# P99 matching latency
histogram_quantile(0.99, rate(matching_duration_seconds_bucket[5m]))

# Location update latency
histogram_quantile(0.95, rate(location_update_duration_seconds_bucket[5m]))
```

### Throughput Metrics

```promql
# Location updates per second
rate(location_updates_total[1m])

# Messages sent per second
rate(messages_sent_total[1m]) by (message_type)

# Redis operations per second
rate(redis_commands_total[1m]) by (command)
```

### Error Metrics

```promql
# Error rate
rate(errors_total[5m]) by (error_type)

# Failed dispatches
rate(dispatch_failures_total[5m]) by (reason)

# Redis connection errors
rate(redis_connection_errors_total[5m])
```

### Business Metrics

```promql
# Active ride requests
ride_requests_active

# Available drivers
drivers_available_total by (vehicle_type, city)

# Average match time
avg(matching_duration_seconds) by (city)

# Surge multiplier by zone
avg(surge_multiplier) by (h3_index)
```

## Grafana Dashboard Panels

### 1. Connection Overview

**Panel: Total Connections (Gauge)**

```promql
sum(websocket_connections_total)
```

**Panel: Connections by Type (Pie Chart)**

```promql
sum(websocket_connections_total) by (user_type)
```

**Panel: Connection Trend (Time Series)**

```promql
sum(websocket_connections_total)
```

### 2. Performance Metrics

**Panel: Message Latency (Heatmap)**

```promql
rate(message_delivery_duration_seconds_bucket[5m])
```

**Panel: Matching Performance (Stat)**

```promql
histogram_quantile(0.95, rate(matching_duration_seconds_bucket[5m]))
```

**Panel: Location Update Rate (Graph)**

```promql
rate(location_updates_total[1m])
```

### 3. System Health

**Panel: Error Rate (Graph)**

```promql
sum(rate(errors_total[5m])) by (service)
```

**Panel: Redis Memory Usage (Gauge)**

```promql
redis_memory_used_bytes / redis_memory_max_bytes * 100
```

**Panel: Kafka Lag (Graph)**

```promql
kafka_consumergroup_lag by (topic, partition)
```

### 4. Business Metrics

**Panel: Active Requests (Stat)**

```promql
sum(ride_requests_active)
```

**Panel: Available Drivers (Bar Gauge)**

```promql
sum(drivers_available_total) by (city)
```

**Panel: Surge Heat Map (Geo Map)**

```promql
surge_multiplier by (h3_index)
```

## Alerts

### Critical Alerts

**High Connection Loss**

```yaml
alert: HighConnectionLoss
expr: rate(websocket_disconnections_total[5m]) > 100
for: 2m
labels:
  severity: critical
annotations:
  summary: "High WebSocket disconnection rate"
  description: "Connection loss rate is {{ $value }} per second"
```

**Matching Latency High**

```yaml
alert: MatchingLatencyHigh
expr: histogram_quantile(0.95, rate(matching_duration_seconds_bucket[5m])) > 5
for: 3m
labels:
  severity: warning
annotations:
  summary: "Ride matching taking too long"
  description: "P95 matching latency is {{ $value }}s"
```

**Redis Memory High**

```yaml
alert: RedisMemoryHigh
expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.9
for: 5m
labels:
  severity: warning
annotations:
  summary: "Redis memory usage high"
  description: "Redis using {{ $value | humanizePercentage }} of max memory"
```

**No Available Drivers**

```yaml
alert: NoAvailableDrivers
expr: sum(drivers_available_total) by (city) == 0
for: 5m
labels:
  severity: critical
annotations:
  summary: "No available drivers in {{ $labels.city }}"
  description: "Driver availability dropped to zero"
```

### Warning Alerts

**Location Update Lag**

```yaml
alert: LocationUpdateLag
expr: rate(location_updates_total[5m]) < 1000
for: 5m
labels:
  severity: warning
annotations:
  summary: "Low location update rate"
  description: "Receiving {{ $value }} updates per second"
```

**Kafka Consumer Lag**

```yaml
alert: KafkaConsumerLag
expr: kafka_consumergroup_lag > 10000
for: 5m
labels:
  severity: warning
annotations:
  summary: "Kafka consumer lagging"
  description: "Consumer lag is {{ $value }} messages"
```

## CloudWatch Dashboards (AWS)

### Metrics to Track

1. **ALB Metrics**
   - `TargetResponseTime` (P95, P99)
   - `RequestCount`
   - `ActiveConnectionCount`
   - `HealthyHostCount`

2. **ECS/EKS Metrics**
   - `CPUUtilization`
   - `MemoryUtilization`
   - `TaskCount`

3. **ElastiCache (Redis) Metrics**
   - `CPUUtilization`
   - `NetworkBytesIn/Out`
   - `CurrConnections`
   - `Evictions`
   - `BytesUsedForCache`

4. **MSK (Kafka) Metrics**
   - `MessagesInPerSec`
   - `BytesInPerSec`
   - `FetchConsumerTotalTimeMs`

## Custom Metrics

### Application-Level Metrics

Export from services to Prometheus/CloudWatch:

```typescript
// Real-Time Gateway Metrics
export const metrics = {
  connectionsTotal: new Counter({
    name: "websocket_connections_total",
    help: "Total WebSocket connections",
    labelNames: ["user_type", "platform"],
  }),

  messagesSent: new Counter({
    name: "messages_sent_total",
    help: "Total messages sent",
    labelNames: ["message_type"],
  }),

  messageDeliveryDuration: new Histogram({
    name: "message_delivery_duration_seconds",
    help: "Message delivery latency",
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
  }),
};
```

```go
// Location Service Metrics
var (
    LocationUpdatesTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "location_updates_total",
            Help: "Total location updates processed",
        },
        []string{"vehicle_type"},
    )

    NearbyQueryDuration = prometheus.NewHistogram(
        prometheus.HistogramOpts{
            Name: "nearby_query_duration_seconds",
            Help: "Nearby driver query latency",
            Buckets: prometheus.DefBuckets,
        },
    )
)
```

## Log Aggregation

### Important Logs to Capture

1. **Connection Events**

   ```json
   {
     "timestamp": "2026-01-04T12:00:00Z",
     "level": "info",
     "event": "connection",
     "user_id": "user123",
     "user_type": "driver",
     "connection_id": "conn_abc",
     "platform": "ios"
   }
   ```

2. **Matching Events**

   ```json
   {
     "timestamp": "2026-01-04T12:00:01Z",
     "level": "info",
     "event": "match_found",
     "request_id": "req_xyz",
     "driver_id": "driver456",
     "duration_ms": 234,
     "search_radius": 3.5
   }
   ```

3. **Error Events**
   ```json
   {
     "timestamp": "2026-01-04T12:00:02Z",
     "level": "error",
     "event": "dispatch_timeout",
     "request_id": "req_xyz",
     "driver_id": "driver789",
     "error": "no response within 15s"
   }
   ```

## Performance Targets

- **P95 Message Latency**: < 100ms
- **P99 Matching Time**: < 3s
- **Location Update Rate**: > 100K/minute
- **Connection Uptime**: 99.9%
- **Redis Hit Rate**: > 95%
- **Kafka Consumer Lag**: < 1000 messages
