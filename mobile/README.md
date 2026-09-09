> **FROZEN — behavioural reference only (2026-09).**
> The delivery targets for UBI mobile are the React Native apps `apps/rider-mobile`
> and `apps/driver-mobile` (owner instruction; docs/launch-readiness/handoff-rn/CLAUDE.md
> rule 13). This Flutter source is kept ONLY as a behavioural reference for porting the
> retained journeys, and is removed after RN acceptance per
> docs/launch-readiness/handoff-rn/FLUTTER_TO_RN_CUTOVER.md. Do not add new Flutter
> features here. CI no longer analyses this tree; the RN gate is ci.yml's `rn-mobile` job.

# UBI Mobile Flutter Monorepo

A Flutter monorepo containing the UBI rider and driver mobile applications, along with shared packages.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                        │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │   UBI Rider App     │    │      UBI Driver App             │ │
│  │  - Home/Map         │    │  - Online Toggle                │ │
│  │  - Ride Booking     │    │  - Request Acceptance           │ │
│  │  - Food Ordering    │    │  - Navigation                   │ │
│  │  - Package Delivery │    │  - Earnings                     │ │
│  │  - Payments         │    │  - CEERION Dashboard            │ │
│  └─────────────────────┘    └─────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│                         Shared Packages                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │  ui_kit  │ │   core   │ │api_client│ │ location │            │
│  │ (Design  │ │(Business │ │(Network  │ │(GPS &    │            │
│  │  System) │ │  Logic)  │ │  Layer)  │ │ Tracking)│            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ payments │ │   maps   │ │analytics │ │ storage  │            │
│  │(M-Pesa,  │ │(Google   │ │(Event    │ │(Isar/    │            │
│  │ Cards)   │ │ Maps)    │ │ Tracking)│ │ Hive)    │            │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
├─────────────────────────────────────────────────────────────────┤
│                          Domain Layer                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Entities: User, Ride, Order, Driver, Vehicle, Payment     │  │
│  │ Repositories: Abstract interfaces for data access         │  │
│  │ Use Cases: Business logic operations                      │  │
│  └───────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│                           Data Layer                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Remote: REST API, WebSocket, GraphQL                      │  │
│  │ Local: Isar Database, Secure Storage                      │  │
│  │ DTOs: JSON serialization/deserialization                  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 📱 Apps

### UBI Rider App
Consumer app for booking rides, ordering food, and sending packages.

### UBI Driver App  
Partner app for drivers and delivery partners.

## 📦 Packages

| Package | Description |
|---------|-------------|
| `ui_kit` | Shared design system with UBI branding |
| `core` | Business logic, entities, and use cases |
| `api_client` | HTTP client with authentication |
| `location` | Location services and tracking |
| `payments` | Mobile money and card payments |
| `maps` | Google Maps integration |
| `analytics` | Event tracking and analytics |
| `storage` | Local database (Isar) |

## 🚀 Getting Started

### Prerequisites
- Flutter 3.16.0+
- Dart 3.2.0+
- Melos CLI

### Setup
```bash
# Install Melos globally
dart pub global activate melos

# Bootstrap the monorepo
melos bootstrap

# Run code generation
melos gen

# Run the Rider app
melos run:rider

# Run the Driver app
melos run:driver
```

## 📂 Project Structure

```
mobile/
├── apps/
│   ├── rider/              # UBI Rider App
│   │   ├── lib/
│   │   │   ├── main.dart
│   │   │   ├── app/
│   │   │   ├── features/
│   │   │   └── l10n/
│   │   ├── android/
│   │   ├── ios/
│   │   └── test/
│   └── driver/             # UBI Driver App
│       ├── lib/
│       │   ├── main.dart
│       │   ├── app/
│       │   ├── features/
│       │   └── l10n/
│       ├── android/
│       ├── ios/
│       └── test/
├── packages/
│   ├── ui_kit/             # Design system
│   ├── core/               # Business logic
│   ├── api_client/         # Network layer
│   ├── location/           # Location services
│   ├── payments/           # Payment integration
│   ├── maps/               # Map widgets
│   ├── analytics/          # Event tracking
│   └── storage/            # Local database
├── melos.yaml
├── pubspec.yaml
└── analysis_options.yaml
```

## 🧪 Testing

```bash
# Run all tests
melos test

# Run tests with coverage
melos test:coverage

# Run integration tests
melos test:integration

# Update golden tests
melos golden:update
```

## 🏗️ Building

```bash
# Android (Development)
melos build:android:dev

# Android (Production)
melos build:android:prod

# iOS (Development)
melos build:ios:dev

# iOS (Production)
melos build:ios:prod
```

## 🔧 Development

```bash
# Analyze code
melos analyze

# Format code
melos format:fix

# Upgrade dependencies
melos deps:upgrade

# Check outdated packages
melos deps:outdated

# Clean all packages
melos clean:deep
```

## 📐 Architecture Decisions

### Why BLoC over Riverpod/Provider?

1. **Separation of Concerns**: BLoC enforces a strict separation between UI and business logic
2. **Testability**: BLoC events and states are easy to test in isolation
3. **Scalability**: BLoC pattern scales well for complex features with many states
4. **Team Experience**: More predictable for large teams with varying Flutter experience
5. **Debugging**: Built-in dev tools (BlocObserver) for state transitions
6. **Real-time Features**: Natural fit for WebSocket streams and location updates

### Offline-First Patterns

1. **Optimistic Updates**: UI updates immediately, syncs in background
2. **Local-First Reads**: Always read from local database, sync from server
3. **Queue-Based Writes**: Failed requests queued for retry
4. **Conflict Resolution**: Last-write-wins with timestamp comparison
5. **Graceful Degradation**: App remains functional offline

### Performance Optimizations

1. **Lazy Loading**: Features loaded on-demand
2. **Image Caching**: Aggressive caching with CachedNetworkImage
3. **List Virtualization**: Only visible items rendered
4. **Const Widgets**: Compile-time constant widgets where possible
5. **Deferred Components**: Split into download-on-demand chunks

## 📱 Platform Support

- **iOS**: 12.0+
- **Android**: API 21+ (Android 5.0)
- **Target Devices**: Budget Android phones (2GB RAM)

## 📊 Performance Targets

| Metric | Target |
|--------|--------|
| Cold Start | < 3 seconds |
| Frame Rate | 60fps |
| App Size | < 50MB |
| Memory | < 150MB |
| Battery | < 5%/hour with location |

## 🌍 Localization

Supported languages:
- English (default)
- French
- Swahili
- Hausa
- Yoruba
- Amharic

## 📄 License

Proprietary - UBI Africa Ltd.
