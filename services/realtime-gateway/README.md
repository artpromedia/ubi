# Real-Time Gateway Service

WebSocket gateway for handling real-time connections from mobile apps and web clients.

## Features

- **Connection Management**: Handle 100K+ concurrent WebSocket connections
- **Cross-Server Messaging**: Redis Pub/Sub for horizontal scaling
- **Multi-Device Support**: Users can connect from multiple devices simultaneously
- **Heartbeat Monitoring**: Automatic detection of stale connections
- **Type-Safe Messages**: Full TypeScript typing for all message types

## Architecture

```
Clients → Load Balancer → WebSocket Gateway (N instances)
                             ↓
                        Redis Pub/Sub
                             ↓
                    Other Services (Ride, Food, etc.)
```

## Message Types

### From Client

- `heartbeat_ack`: Acknowledge server heartbeat
- `location_update`: Driver location update (drivers only)
- `dispatch_response`: Accept/reject ride request (drivers only)

### To Client

- `heartbeat`: Server heartbeat (every 30s)
- `ride_request`: New ride request for driver
- `ride_status`: Trip status update
- `driver_location`: Live driver location during trip
- `eta_update`: ETA changes
- `notification`: In-app notifications
- `order_status`: Food/delivery order updates
- `error`: Error messages

## Connection Flow

1. Client connects to `ws://gateway/ws?token={JWT}&userType={type}&deviceId={id}&platform={platform}`
2. Gateway verifies JWT token
3. Connection registered in Redis and local memory
4. Client receives confirmation
5. Heartbeats start (30s interval)
6. Messages routed based on subscriptions

## Environment Variables

```bash
PORT=4010
REDIS_URL=redis://localhost:6379
```

## Scaling

The gateway is designed for horizontal scaling:

- Each instance maintains local connection state
- Redis Pub/Sub enables cross-server messaging
- Sticky sessions not required (users can connect to any instance)
- Connection count tracked per server

## Monitoring

### Stats Endpoint

```bash
GET /stats
```

Returns:

```json
{
  "serverId": "abc123",
  "totalConnections": 50000,
  "uniqueUsers": 45000,
  "byUserType": {
    "driver": 20000,
    "rider": 25000,
    "restaurant": 3000,
    "delivery_partner": 2000
  },
  "uptime": 86400
}
```

### Broadcasting

Other services can broadcast to users:

```bash
POST /broadcast/user/{userId}
{
  "type": "notification",
  "payload": { ... }
}
```

## Usage

### Development

```bash
pnpm install
pnpm dev
```

### Production

```bash
pnpm build
pnpm start
```

## Client Example

```javascript
const ws = new WebSocket(
  "ws://localhost:4010/ws?token=JWT&userType=driver&deviceId=123&platform=ios"
);

ws.onopen = () => {
  console.log("Connected");
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  switch (message.type) {
    case "heartbeat":
      // Acknowledge heartbeat
      ws.send(
        JSON.stringify({
          type: "heartbeat_ack",
          payload: { timestamp: Date.now() },
        })
      );
      break;

    case "ride_request":
      // Handle incoming ride request
      console.log("New ride request:", message.payload);
      break;
  }
};

// Send location update (drivers)
setInterval(() => {
  ws.send(
    JSON.stringify({
      type: "location_update",
      payload: {
        latitude: 37.7749,
        longitude: -122.4194,
        heading: 90,
        speed: 15,
        accuracy: 10,
        timestamp: Date.now(),
        isAvailable: true,
      },
    })
  );
}, 5000);
```
