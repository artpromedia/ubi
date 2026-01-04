# 🚗 UBI Monorepo

> **UBI** (pronounced "OOBEE") - The African Mobility Super-App

Welcome to the UBI monorepo! This repository contains all the code for UBI's platform, including mobile apps, web applications, backend services, and shared libraries.

[![CI](https://github.com/ubi-africa/ubi-monorepo/actions/workflows/ci.yml/badge.svg)](https://github.com/ubi-africa/ubi-monorepo/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-UNLICENSED-red.svg)](LICENSE)

## 📚 Table of Contents

- [Overview](#-overview)
- [Architecture](#-architecture)
- [Getting Started](#-getting-started)
- [Project Structure](#-project-structure)
- [Development](#-development)
- [Testing](#-testing)
- [Deployment](#-deployment)
- [Contributing](#-contributing)

## 🌍 Overview

UBI is an African mobility super-app operating in:

- 🇳🇬 Nigeria
- 🇿🇦 South Africa
- 🇰🇪 Kenya
- 🇬🇭 Ghana
- 🇷🇼 Rwanda
- 🇪🇹 Ethiopia

### Features

| Feature         | Description                                                     |
| --------------- | --------------------------------------------------------------- |
| 🚗 **Rides**    | Book rides with economy, comfort, premium, XL, and moto options |
| 🍔 **Food**     | Order from local restaurants with real-time tracking            |
| 📦 **Packages** | Send packages anywhere with proof of delivery                   |
| 💳 **Payments** | Pay with M-Pesa, MTN MoMo, cards, cash, or UBI Wallet           |
| ⚡ **CEERION**  | Electric vehicle financing for drivers                          |

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
├──────────┬──────────┬──────────┬──────────┬───────────────────┤
│  Rider   │  Driver  │   Web    │  Admin   │  Partner Portals  │
│   App    │   App    │   App    │ Dashboard│                   │
│ (Flutter)│ (Flutter)│ (Next.js)│ (Next.js)│     (Next.js)     │
└────┬─────┴────┬─────┴────┬─────┴────┬─────┴─────────┬─────────┘
     │          │          │          │               │
     └──────────┴──────────┴──────────┴───────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
   ┌────▼─────┐                      ┌────────▼────────┐
   │WebSocket │                      │   API Gateway   │
   │ Gateway  │◄─────Redis Pub/Sub──►│     (Hono)      │
   │(Node.js) │                      └────────┬────────┘
   └──────────┘                               │
        │                                     │
        │         ┌───────────────────────────┼─────────────┐
        │         │            │              │             │
   ┌────▼────┐  ┌─▼──────┐  ┌─▼────────┐  ┌─▼──────┐  ┌──▼──────┐
   │Location │  │  Ride  │  │   Food   │  │Delivery│  │ Payment │
   │Service  │  │Service │  │ Service  │  │Service │  │ Service │
   │(Go/H3)  │  │  (Go)  │  │(Node.js) │  │  (Go)  │  │(Node.js)│
   └────┬────┘  └───┬────┘  └────┬─────┘  └───┬────┘  └────┬────┘
        │           │            │            │            │
        │      ┌────┴────┐  ┌────┴────┐  ┌───┴────┐  ┌───┴────┐
        │      │ Matching│  │  User   │  │ Notif. │  │  ETA   │
        └─────►│ Engine  │  │ Service │  │Service │  │Service │
               │  (Go)   │  │(Node.js)│  │(Node.js)│  │  (Go)  │
               └─────────┘  └─────────┘  └────────┘  └────────┘
```

> 🆕 **Real-Time Systems** now include WebSocket Gateway, Location Service with H3 indexing, Matching Engine, and Surge Pricing! See [Real-Time Quick Start](./docs/REALTIME-QUICKSTART.md) for details.

### Tech Stack

| Layer              | Technology                               |
| ------------------ | ---------------------------------------- |
| **Mobile**         | Flutter 3.19+                            |
| **Web**            | Next.js 15, React 19, TypeScript         |
| **API Gateway**    | Hono (Node.js)                           |
| **Real-Time**      | WebSockets, Redis Pub/Sub, H3 Geospatial |
| **Services**       | Go 1.22+, Node.js 20                     |
| **Database**       | PostgreSQL 15 + PostGIS, TimescaleDB     |
| **Cache**          | Redis 7 (Geo + Pub/Sub)                  |
| **Streaming**      | Kafka (Event Sourcing)                   |
| **Infrastructure** | AWS (ECS, RDS, ElastiCache, MSK)         |
| **Monorepo**       | Turborepo + pnpm                         |

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20.0.0 or higher
- **pnpm** 9.0.0 or higher
- **Go** 1.22 or higher (for Go services)
- **Flutter** 3.19 or higher (for mobile apps)
- **Docker** and Docker Compose
- **PostgreSQL** 15 (or use Docker)
- **Redis** 7 (or use Docker)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/ubi-africa/ubi-monorepo.git
cd ubi-monorepo

# 2. Install dependencies
pnpm install

# 3. Copy environment variables
cp .env.example .env.local

# 4. Start infrastructure (PostgreSQL, Redis)
pnpm docker:up

# 5. Setup database
pnpm db:migrate:dev
pnpm db:seed

# 6. Start development servers
pnpm dev
```

### Environment Setup

Create `.env.local` from `.env.example` and configure:

```env
# Database
DATABASE_URL="postgresql://ubi:ubi_dev_password@localhost:5432/ubi_dev"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
```

## 📁 Project Structure

```
ubi-monorepo/
├── apps/                          # Applications
│   ├── web-app/                   # Rider PWA (Next.js)
│   ├── admin-dashboard/           # Internal admin (Next.js)
│   ├── marketing-site/            # Public website (Next.js)
│   ├── restaurant-portal/         # Restaurant partners (Next.js)
│   ├── fleet-portal/              # Fleet managers (Next.js)
│   └── merchant-portal/           # Delivery merchants (Next.js)
│
├── services/                      # Backend Services
│   ├── api-gateway/               # API Gateway (Node.js/Hono)
│   ├── user-service/              # Auth & Users (Node.js)
│   ├── ride-service/              # Rides & Matching (Go)
│   ├── food-service/              # Food Orders (Node.js)
│   ├── delivery-service/          # Package Delivery (Go)
│   ├── payment-service/           # Payments (Node.js)
│   ├── notification-service/      # Push/SMS/Email (Node.js)
│   ├── analytics-service/         # Analytics (Python)
│   └── ceerion-service/           # EV Financing (Node.js)
│
├── packages/                      # Shared Packages
│   ├── ui/                        # Design System (React)
│   ├── utils/                     # Shared Utilities
│   ├── database/                  # Prisma Schema
│   ├── api-client/                # API Client SDK
│   ├── api-contracts/             # OpenAPI Specs
│   ├── i18n/                      # Internationalization
│   ├── logger/                    # Logging Utilities
│   ├── typescript-config/         # TSConfig Presets
│   └── eslint-config/             # ESLint Presets
│
├── mobile/                        # Mobile Apps (Flutter)
│   ├── rider_app/                 # Rider App
│   ├── driver_app/                # Driver App
│   └── packages/                  # Shared Dart Packages
│
├── infra/                         # Infrastructure as Code
│   ├── terraform/                 # Terraform Modules
│   └── kubernetes/                # K8s Manifests
│
├── docker/                        # Docker Configs
│   ├── docker-compose.dev.yml     # Local Development
│   └── docker-compose.test.yml    # Testing
│
└── tooling/                       # Build Tools
    ├── generators/                # Code Generators
    └── scripts/                   # Utility Scripts
```

## 💻 Development

### Common Commands

```bash
# Start all services in development
pnpm dev

# Start specific app
pnpm dev:web           # Web app on :3000
pnpm dev:admin         # Admin dashboard on :3001
pnpm dev:services      # All backend services

# Build
pnpm build             # Build all packages
pnpm build:affected    # Build only changed packages

# Lint & Format
pnpm lint              # Run ESLint
pnpm lint:fix          # Fix ESLint issues
pnpm format            # Format with Prettier
pnpm typecheck         # TypeScript check

# Database
pnpm db:migrate:dev    # Create migration
pnpm db:migrate        # Run migrations
pnpm db:seed           # Seed database
pnpm db:studio         # Open Prisma Studio

# Testing
pnpm test              # Run all tests
pnpm test:affected     # Test changed packages
pnpm test:e2e          # Run E2E tests

# Docker
pnpm docker:up         # Start infrastructure
pnpm docker:down       # Stop infrastructure
pnpm docker:logs       # View logs
```

### IDE Setup

#### VS Code (Recommended)

Install recommended extensions:

```bash
# Extensions are auto-recommended when opening the project
```

**Recommended extensions:**

- ESLint
- Prettier
- Tailwind CSS IntelliSense
- Prisma
- GitLens
- Go (for Go services)
- Dart/Flutter (for mobile)

### Working with Packages

```bash
# Add dependency to a package
pnpm add axios --filter @ubi/api-client

# Add dev dependency to root
pnpm add -D @types/node -w

# Run command in specific package
pnpm --filter @ubi/web-app dev
```

## 🧪 Testing

### Unit Tests

```bash
# Run all unit tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests in watch mode
pnpm --filter @ubi/utils test:watch
```

### E2E Tests

```bash
# Run Playwright tests
pnpm test:e2e

# Run with UI
pnpm --filter @ubi/web-app exec playwright test --ui
```

### Go Services

```bash
# Run Go tests
cd services/ride-service
go test -v ./...

# With coverage
go test -v -coverprofile=coverage.out ./...
```

## 🚢 Deployment

### Environments

| Environment | Purpose                | URL                   |
| ----------- | ---------------------- | --------------------- |
| Development | Local development      | localhost             |
| Staging     | Pre-production testing | \*.staging.ubi.africa |
| Production  | Live environment       | \*.ubi.africa         |

### Deploy Process

1. **Create PR** - Open a pull request to `main`
2. **CI Checks** - Automated tests and builds run
3. **Review** - Code review and approval
4. **Merge** - Merge triggers deployment to staging
5. **Release** - Create release for production deployment

### Manual Deployment

```bash
# Deploy specific package to staging
gh workflow run deploy.yml -f environment=staging -f package=web-app

# Deploy to production (requires approval)
gh workflow run deploy.yml -f environment=production
```

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

```bash
feat: add new ride type
fix: resolve payment timeout issue
docs: update API documentation
chore: upgrade dependencies
```

### Branch Naming

```
feature/add-ride-tracking
fix/payment-timeout
docs/api-documentation
chore/upgrade-deps
```

## 📄 License

This project is proprietary and confidential. All rights reserved by UBI Africa.

---

<p align="center">
  Made with ❤️ in Africa 🌍
</p>

<p align="center">
  <a href="https://ubi.africa">Website</a> •
  <a href="https://docs.ubi.africa">Documentation</a> •
  <a href="https://twitter.com/ubi_africa">Twitter</a>
</p>
