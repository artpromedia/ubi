# Location Service

High-performance driver location tracking service with H3 geospatial indexing.

## Features

- **H3 Geospatial Indexing**: Ultra-fast driver discovery using Uber's H3 hexagonal grid system
- **Sub-second Queries**: Find nearby drivers in < 50ms even with 100K+ active drivers
- **Real-time Updates**: Location updates streamed via Redis Pub/Sub
- **Kafka Integration**: All location events sent to Kafka for analytics and archival
- **Auto-expiration**: Stale locations automatically removed (30s TTL)

## Architecture

```
Driver App → Real-Time Gateway → Location Service
                                      ↓
                     ┌────────────────┴─────────────────┐
                     ↓                                  ↓
                Redis (Geo + H3)                    Kafka
                     ↓                                  ↓
             Real-time Queries                  Analytics/Storage
```

## H3 Indexing

This service uses [H3](https://h3geo.org/) resolution 8 (~460m hexagons) for optimal city-scale matching:

- **Resolution 8**: ~0.46 km² hexagons, perfect for driver-rider matching
- **2-ring search**: Covers ~2.8 km radius with exact Haversine filtering
- **Set-based lookups**: O(1) driver discovery per hexagon

### Why H3?

Traditional approaches:

- **GEORADIUS**: O(N) scan of all drivers, slow at scale
- **Bounding box**: Inefficient for circular searches

H3 approach:

- **Pre-indexed hexagons**: O(1) lookup per hexagon
- **Hierarchical**: Easy to expand search radius
- **Uniform coverage**: No edge cases like latitude distortion

## Data Storage

### Redis Keys

```
drivers:geo                        # GEOADD for all drivers
h3:{h3Index}:drivers              # SET of driver IDs in hexagon
driver:{driverId}:location        # HASH of driver details
drivers:available                  # SET of available driver IDs
```

### Location Hash Fields

```json
{
  "lat": 37.7749,
  "lng": -122.4194,
  "heading": 90,
  "speed": 15,
  "accuracy": 10,
  "h3": "88283082a3fffff",
  "vehicle_type": "sedan",
  "available": true,
  "updated": 1735948800
}
```

## API

### Update Location

```http
POST /api/locations/driver
Content-Type: application/json

{
  "driver_id": "driver123",
  "latitude": 37.7749,
  "longitude": -122.4194,
  "heading": 90,
  "speed": 15,
  "accuracy": 10,
  "vehicle_type": "sedan",
  "is_available": true
}
```

### Get Driver Location

```http
GET /api/locations/driver/:driverId
```

### Find Nearby Drivers

```http
GET /api/locations/nearby?lat=37.7749&lng=-122.4194&radius=3&vehicleType=sedan
```

Response:

```json
{
  "count": 5,
  "drivers": [
    {
      "driver_id": "driver123",
      "latitude": 37.775,
      "longitude": -122.4195,
      "heading": 90,
      "speed": 15,
      "vehicle_type": "sedan",
      "is_available": true,
      "distance": 0.12
    }
  ]
}
```

## Performance

### Benchmarks (100K active drivers)

- **Location Update**: < 5ms (Redis pipeline + Kafka async)
- **Nearby Search (3km)**: < 50ms (H3 + Haversine filter)
- **Get Single Driver**: < 2ms (Redis hash lookup)

### Scaling

- **Vertical**: Single Redis instance handles 100K drivers
- **Horizontal**: Redis Cluster for 1M+ drivers
- **Kafka**: Partitioned by driver_id for processing

## Environment Variables

```bash
PORT=4011
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:9092
```

## Usage

### Development

```bash
go mod download
go run cmd/server/main.go
```

### Production

```bash
go build -o location-service cmd/server/main.go
./location-service
```

### Docker

```bash
docker build -t ubi-location-service .
docker run -p 4011:4011 ubi-location-service
```

## Monitoring

### Key Metrics

- Location updates per second
- Average query latency
- H3 cell distribution
- Stale location count
- Kafka lag

### Redis Memory

Estimated memory per driver: ~200 bytes

- 100K drivers: ~20 MB
- 1M drivers: ~200 MB

## Network Optimization for Africa

### Batch Updates

For poor network conditions, drivers can batch location updates:

```json
POST /api/locations/driver/batch
[
  {"timestamp": 1735948800, "lat": 37.7749, "lng": -122.4194},
  {"timestamp": 1735948805, "lat": 37.7750, "lng": -122.4195}
]
```

### Compression

Enable gzip compression for API responses (Gin default).

### TTL Strategy

30-second TTL balances:

- Fresh data for matching
- Tolerance for network interruptions
- Automatic cleanup of inactive drivers
