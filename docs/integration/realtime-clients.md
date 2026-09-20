# Real-Time System Integration Examples

## Client Integration

### iOS (Swift)

```swift
import Foundation
import Starscream

class UBIRealtimeClient: WebSocketDelegate {
    private var socket: WebSocket?
    private let token: String
    private let userType: String

    init(token: String, userType: String) {
        self.token = token
        self.userType = userType
    }

    func connect() {
        let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
        let urlString = "wss://api.ubi.africa/ws?token=\(token)&userType=\(userType)&deviceId=\(deviceId)&platform=ios"

        var request = URLRequest(url: URL(string: urlString)!)
        request.timeoutInterval = 5

        socket = WebSocket(request: request)
        socket?.delegate = self
        socket?.connect()
    }

    func disconnect() {
        socket?.disconnect()
    }

    // Send location update (drivers)
    func sendLocation(latitude: Double, longitude: Double, heading: Double, speed: Double) {
        let message: [String: Any] = [
            "type": "location_update",
            "payload": [
                "latitude": latitude,
                "longitude": longitude,
                "heading": heading,
                "speed": speed,
                "accuracy": 10.0,
                "timestamp": Date().timeIntervalSince1970 * 1000,
                "isAvailable": true
            ]
        ]

        if let data = try? JSONSerialization.data(withJSONObject: message),
           let string = String(data: data, encoding: .utf8) {
            socket?.write(string: string)
        }
    }

    // WebSocketDelegate methods
    func didReceive(event: WebSocketEvent, client: WebSocket) {
        switch event {
        case .connected(let headers):
            print("Connected to real-time server")

        case .disconnected(let reason, let code):
            print("Disconnected: \(reason) Code: \(code)")
            scheduleReconnect()

        case .text(let string):
            handleMessage(string)

        case .binary(let data):
            print("Received data: \(data.count) bytes")

        case .error(let error):
            print("Error: \(error?.localizedDescription ?? "unknown")")
            scheduleReconnect()

        default:
            break
        }
    }

    private func handleMessage(_ string: String) {
        guard let data = string.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String,
              let payload = json["payload"] as? [String: Any] else {
            return
        }

        switch type {
        case "heartbeat":
            // Acknowledge heartbeat
            sendHeartbeatAck()

        case "ride_request":
            // New ride request for driver
            handleRideRequest(payload)

        case "ride_status":
            // Trip status update
            handleRideStatus(payload)

        case "driver_location":
            // Live driver location (for riders)
            handleDriverLocation(payload)

        case "notification":
            // In-app notification
            handleNotification(payload)

        default:
            print("Unknown message type: \(type)")
        }
    }

    private func sendHeartbeatAck() {
        let message: [String: Any] = [
            "type": "heartbeat_ack",
            "payload": ["timestamp": Date().timeIntervalSince1970 * 1000]
        ]

        if let data = try? JSONSerialization.data(withJSONObject: message),
           let string = String(data: data, encoding: .utf8) {
            socket?.write(string: string)
        }
    }

    private func handleRideRequest(_ payload: [String: Any]) {
        // Show driver the ride request with 15s countdown
        NotificationCenter.default.post(
            name: NSNotification.Name("NewRideRequest"),
            object: nil,
            userInfo: payload
        )
    }

    private func handleRideStatus(_ payload: [String: Any]) {
        // Update trip status in UI
        NotificationCenter.default.post(
            name: NSNotification.Name("RideStatusUpdate"),
            object: nil,
            userInfo: payload
        )
    }

    private func handleDriverLocation(_ payload: [String: Any]) {
        // Update driver marker on map
        guard let lat = payload["latitude"] as? Double,
              let lng = payload["longitude"] as? Double else {
            return
        }

        NotificationCenter.default.post(
            name: NSNotification.Name("DriverLocationUpdate"),
            object: nil,
            userInfo: ["latitude": lat, "longitude": lng]
        )
    }

    private func handleNotification(_ payload: [String: Any]) {
        // Show in-app notification
        print("Notification: \(payload["title"] ?? ""), \(payload["body"] ?? "")")
    }

    private var reconnectTimer: Timer?
    private var reconnectDelay: TimeInterval = 1.0

    private func scheduleReconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: reconnectDelay, repeats: false) { [weak self] _ in
            self?.connect()
            self?.reconnectDelay = min((self?.reconnectDelay ?? 1.0) * 2, 30.0)
        }
    }
}

// Usage
let client = UBIRealtimeClient(token: userToken, userType: "driver")
client.connect()

// In location manager
func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let location = locations.last else { return }

    client.sendLocation(
        latitude: location.coordinate.latitude,
        longitude: location.coordinate.longitude,
        heading: location.course,
        speed: location.speed * 3.6  // m/s to km/h
    )
}
```

### Android (Kotlin)

```kotlin
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class UBIRealtimeClient(
    private val token: String,
    private val userType: String,
    private val deviceId: String
) {
    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var reconnectDelay = 1000L
    private val maxReconnectDelay = 30000L

    fun connect() {
        val url = "wss://api.ubi.africa/ws?token=$token&userType=$userType&deviceId=$deviceId&platform=android"
        val request = Request.Builder()
            .url(url)
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                println("Connected to real-time server")
                reconnectDelay = 1000L
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                println("WebSocket error: ${t.message}")
                scheduleReconnect()
            }
        })
    }

    fun disconnect() {
        webSocket?.close(1000, "User disconnected")
    }

    fun sendLocation(location: Location) {
        val message = JSONObject().apply {
            put("type", "location_update")
            put("payload", JSONObject().apply {
                put("latitude", location.latitude)
                put("longitude", location.longitude)
                put("heading", location.bearing.toDouble())
                put("speed", location.speed * 3.6)  // m/s to km/h
                put("accuracy", location.accuracy.toDouble())
                put("timestamp", System.currentTimeMillis())
                put("isAvailable", true)
            })
        }

        webSocket?.send(message.toString())
    }

    private fun handleMessage(text: String) {
        try {
            val json = JSONObject(text)
            val type = json.getString("type")
            val payload = json.getJSONObject("payload")

            when (type) {
                "heartbeat" -> sendHeartbeatAck()
                "ride_request" -> handleRideRequest(payload)
                "ride_status" -> handleRideStatus(payload)
                "driver_location" -> handleDriverLocation(payload)
                "notification" -> handleNotification(payload)
            }
        } catch (e: Exception) {
            println("Error parsing message: ${e.message}")
        }
    }

    private fun sendHeartbeatAck() {
        val message = JSONObject().apply {
            put("type", "heartbeat_ack")
            put("payload", JSONObject().apply {
                put("timestamp", System.currentTimeMillis())
            })
        }
        webSocket?.send(message.toString())
    }

    private fun scheduleReconnect() {
        Handler(Looper.getMainLooper()).postDelayed({
            connect()
            reconnectDelay = minOf(reconnectDelay * 2, maxReconnectDelay)
        }, reconnectDelay)
    }
}

// Usage
val client = UBIRealtimeClient(
    token = userToken,
    userType = "driver",
    deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
)
client.connect()

// In location listener
locationManager.requestLocationUpdates(
    LocationManager.GPS_PROVIDER,
    3000,  // 3 seconds
    0f,
    object : LocationListener {
        override fun onLocationChanged(location: Location) {
            client.sendLocation(location)
        }
    }
)
```

### React Native

```typescript
import { useEffect, useRef, useState } from 'react';

interface WebSocketMessage {
  type: string;
  payload: any;
}

export function useRealtimeConnection(token: string, userType: string) {
  const ws = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  useEffect(() => {
    connect();

    return () => {
      ws.current?.close();
    };
  }, [token]);

  const connect = () => {
    const deviceId = DeviceInfo.getUniqueId();
    const platform = Platform.OS;
    const url = `wss://api.ubi.africa/ws?token=${token}&userType=${userType}&deviceId=${deviceId}&platform=${platform}`;

    ws.current = new WebSocket(url);

    ws.current.onopen = () => {
      console.log('Connected');
      setConnected(true);
    };

    ws.current.onmessage = (event) => {
      const message: WebSocketMessage = JSON.parse(event.data);

      if (message.type === 'heartbeat') {
        sendHeartbeatAck();
      } else {
        setLastMessage(message);
      }
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.current.onclose = () => {
      console.log('Disconnected');
      setConnected(false);
      // Reconnect after delay
      setTimeout(connect, 2000);
    };
  };

  const send = (message: WebSocketMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    }
  };

  const sendHeartbeatAck = () => {
    send({
      type: 'heartbeat_ack',
      payload: { timestamp: Date.now() },
    });
  };

  const sendLocation = (latitude: number, longitude: number, heading: number, speed: number) => {
    send({
      type: 'location_update',
      payload: {
        latitude,
        longitude,
        heading,
        speed,
        accuracy: 10,
        timestamp: Date.now(),
        isAvailable: true,
      },
    });
  };

  return { connected, lastMessage, sendLocation };
}

// Usage in component
function DriverScreen() {
  const { connected, lastMessage, sendLocation } = useRealtimeConnection(token, 'driver');

  useEffect(() => {
    const subscription = Geolocation.watchPosition(
      (position) => {
        sendLocation(
          position.coords.latitude,
          position.coords.longitude,
          position.coords.heading || 0,
          position.coords.speed || 0
        );
      },
      (error) => console.error(error),
      { enableHighAccuracy: true, distanceFilter: 10 }
    );

    return () => Geolocation.clearWatch(subscription);
  }, []);

  // Handle ride requests
  useEffect(() => {
    if (lastMessage?.type === 'ride_request') {
      // Show ride request modal
      showRideRequestModal(lastMessage.payload);
    }
  }, [lastMessage]);

  return (
    <View>
      <Text>Status: {connected ? 'Connected' : 'Disconnected'}</Text>
      {/* Rest of UI */}
    </View>
  );
}
```

## Backend Service Integration

### Sending Messages to Users

```typescript
// From any backend service
import axios from "axios";

async function notifyUser(userId: string, notification: any) {
  await axios.post(`http://realtime-gateway/broadcast/user/${userId}`, {
    type: "notification",
    payload: notification,
  });
}

// Example: Notify rider of driver arrival
await notifyUser(riderId, {
  type: "driver_arrived",
  title: "Driver Arrived",
  body: "Your driver has arrived at the pickup location",
  data: { tripId: "trip123" },
});
```

### Subscribing to Events

```go
// Ride service subscribing to location updates
func (s *RideService) SubscribeToDriverLocation(ctx context.Context, driverId string) {
    pubsub := s.redis.Subscribe(ctx, fmt.Sprintf("driver:%s:location", driverId))
    defer pubsub.Close()

    for msg := range pubsub.Channel() {
        var location DriverLocation
        json.Unmarshal([]byte(msg.Payload), &location)

        // Update trip with driver's current location
        s.updateTripLocation(ctx, location)

        // Calculate new ETA
        eta := s.etaService.GetLiveETA(ctx, location.Latitude, location.Longitude, trip.DropoffLat, trip.DropoffLng)

        // Notify rider of location update
        s.notifyRider(ctx, trip.RiderId, location, eta)
    }
}
```

## Testing

### Manual Testing with wscat

```bash
# Install wscat
npm install -g wscat

# Connect to gateway
wscat -c "ws://localhost:4010/ws?token=YOUR_JWT&userType=driver&deviceId=test123&platform=web"

# Send location update
> {"type":"location_update","payload":{"latitude":37.7749,"longitude":-122.4194,"heading":90,"speed":15,"accuracy":10,"timestamp":1735948800000,"isAvailable":true}}

# Heartbeat acknowledgment
> {"type":"heartbeat_ack","payload":{"timestamp":1735948800000}}
```

### Load Testing

```javascript
// k6 load test script
import ws from "k6/ws";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "1m", target: 1000 }, // Ramp up to 1K connections
    { duration: "5m", target: 10000 }, // Ramp up to 10K
    { duration: "5m", target: 10000 }, // Hold at 10K
    { duration: "1m", target: 0 }, // Ramp down
  ],
};

export default function () {
  const url =
    "ws://localhost:4010/ws?token=test&userType=driver&deviceId=test&platform=web";

  ws.connect(url, {}, (socket) => {
    socket.on("open", () => {
      console.log("Connected");

      // Send location every 5 seconds
      socket.setInterval(() => {
        socket.send(
          JSON.stringify({
            type: "location_update",
            payload: {
              latitude: 37.7749 + Math.random() * 0.01,
              longitude: -122.4194 + Math.random() * 0.01,
              heading: Math.random() * 360,
              speed: Math.random() * 60,
              accuracy: 10,
              timestamp: Date.now(),
              isAvailable: true,
            },
          }),
        );
      }, 5000);
    });

    socket.on("message", (data) => {
      const msg = JSON.parse(data);
      if (msg.type === "heartbeat") {
        socket.send(
          JSON.stringify({
            type: "heartbeat_ack",
            payload: { timestamp: Date.now() },
          }),
        );
      }
    });

    socket.setTimeout(() => {
      socket.close();
    }, 300000); // 5 minutes
  });
}
```

## Monitoring Integration

```typescript
// Prometheus metrics in gateway
import promClient from "prom-client";

const connectionsGauge = new promClient.Gauge({
  name: "websocket_connections_total",
  help: "Total active WebSocket connections",
  labelNames: ["user_type", "platform"],
});

const messagesCounter = new promClient.Counter({
  name: "messages_sent_total",
  help: "Total messages sent",
  labelNames: ["message_type"],
});

const latencyHistogram = new promClient.Histogram({
  name: "message_delivery_duration_seconds",
  help: "Message delivery latency",
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

// Track metrics
connectionManager.on("connect", (conn) => {
  connectionsGauge.inc({ user_type: conn.userType, platform: conn.platform });
});

connectionManager.on("message", (msg) => {
  messagesCounter.inc({ message_type: msg.type });

  const start = Date.now();
  send(msg).then(() => {
    latencyHistogram.observe((Date.now() - start) / 1000);
  });
});

// Expose metrics endpoint
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", promClient.register.contentType);
  res.end(await promClient.register.metrics());
});
```

## Troubleshooting

### Connection Issues

**Problem**: Client can't connect

```bash
# Check gateway health
curl http://gateway:4010/health

# Check if port is open
telnet gateway 4010

# Verify JWT token
curl -H "Authorization: Bearer $TOKEN" http://api/verify-token
```

**Problem**: Frequent disconnections

- Check network stability
- Verify heartbeat responses
- Review gateway logs for errors
- Check Redis connection

### Performance Issues

**Problem**: High latency

```bash
# Check Redis latency
redis-cli --latency

# Check gateway CPU/memory
kubectl top pods -l app=realtime-gateway

# Review Prometheus metrics
curl http://gateway:4010/metrics | grep latency
```

**Problem**: Location updates slow

```bash
# Check location service health
curl http://location-service/health

# Verify Redis H3 indexes
redis-cli KEYS "h3:*:drivers" | wc -l

# Check Kafka lag
kafka-consumer-groups --describe --group location-processor
```
