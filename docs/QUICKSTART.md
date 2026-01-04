# UBI Monorepo - Quick Reference

Quick reference guide for common development tasks.

## 🚀 Quick Start

```bash
# Clone and setup
git clone https://github.com/ubi-africa/ubi-monorepo.git
cd ubi-monorepo
pnpm install
cp .env.example .env.local

# Start infrastructure + development
pnpm docker:up
pnpm db:migrate:dev
pnpm dev
```

## 📋 Common Commands

### Development

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps/services in dev mode |
| `pnpm dev:web` | Start web app on :3000 |
| `pnpm dev:admin` | Start admin dashboard on :3001 |
| `pnpm dev:services` | Start all backend services |

### Building

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm build --filter @ubi/web-app` | Build specific package |
| `pnpm build --filter=...[origin/main]` | Build affected packages |

### Testing

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage |

### Code Quality

| Command | Description |
|---------|-------------|
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Fix ESLint issues |
| `pnpm typecheck` | Run TypeScript checks |
| `pnpm format` | Format with Prettier |

### Database

| Command | Description |
|---------|-------------|
| `pnpm db:migrate:dev` | Create/apply migrations |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm db:seed` | Seed database |
| `pnpm db:reset` | Reset database |

### Docker

| Command | Description |
|---------|-------------|
| `pnpm docker:up` | Start infrastructure |
| `pnpm docker:down` | Stop infrastructure |
| `pnpm docker:logs` | View container logs |
| `pnpm docker:clean` | Remove volumes |

### Code Generation

| Command | Description |
|---------|-------------|
| `pnpm generate:package service my-service` | Create new service |
| `pnpm generate:package app my-app` | Create new app |
| `pnpm generate:package package my-lib` | Create new library |

## 📁 Project Structure

```
ubi-monorepo/
├── apps/                    # Web applications
│   ├── web-app/            # :3000 - Rider PWA
│   ├── admin-dashboard/    # :3001 - Internal admin
│   ├── marketing-site/     # :3002 - Public website
│   ├── restaurant-portal/  # :3003 - Restaurant partners
│   ├── fleet-portal/       # :3004 - Fleet managers
│   └── merchant-portal/    # :3005 - Delivery merchants
│
├── services/               # Backend services
│   ├── api-gateway/        # :8000 - API Gateway
│   ├── user-service/       # :8001 - Auth & Users
│   ├── ride-service/       # :8002 - Rides (Go)
│   ├── food-service/       # :8003 - Food Orders
│   ├── delivery-service/   # :8004 - Deliveries (Go)
│   ├── payment-service/    # :8005 - Payments
│   └── notification-service/ # :8006 - Notifications
│
├── packages/               # Shared packages
│   ├── ui/                 # Design system
│   ├── utils/              # Utilities
│   ├── database/           # Prisma schema
│   ├── typescript-config/  # TSConfig presets
│   └── eslint-config/      # ESLint presets
│
└── docker/                 # Docker configs
    └── docker-compose.dev.yml
```

## 🔗 Local URLs

| Service | URL |
|---------|-----|
| Web App | http://localhost:3000 |
| Admin Dashboard | http://localhost:3001 |
| API Gateway | http://localhost:8000 |
| Prisma Studio | http://localhost:5555 |
| Redis Commander | http://localhost:8081 |
| MinIO Console | http://localhost:9001 |
| MailHog | http://localhost:8025 |

## 🔧 VS Code Extensions

Recommended extensions (auto-installed):
- ESLint
- Prettier
- Tailwind CSS IntelliSense
- Prisma
- GitLens
- Go
- Docker

## 🎯 Tips

### Running Commands in Specific Package

```bash
# Using --filter
pnpm --filter @ubi/web-app dev
pnpm --filter @ubi/api-gateway test

# Using Turborepo
pnpm turbo build --filter=@ubi/web-app
pnpm turbo test --filter="./services/*"
```

### Adding Dependencies

```bash
# Add to specific package
pnpm add axios --filter @ubi/api-client

# Add as dev dependency to root
pnpm add -D @types/node -w
```

### Debugging

```bash
# Check Turborepo cache
pnpm turbo build --dry-run

# Visualize dependencies
pnpm turbo build --graph

# Clear Turborepo cache
pnpm turbo clean
```

## 🆘 Troubleshooting

### "Module not found" errors
```bash
pnpm install
pnpm build
```

### Database connection issues
```bash
pnpm docker:up
# Wait for PostgreSQL to be ready
pnpm db:migrate:dev
```

### Port already in use
```bash
# Find process using port
lsof -i :3000
# Kill process
kill -9 <PID>
```

### Clear everything and start fresh
```bash
pnpm docker:clean
rm -rf node_modules
rm -rf **/node_modules
rm -rf **/.turbo
pnpm install
pnpm docker:up
pnpm db:migrate:dev
```

---

For more detailed documentation, see:
- [README.md](../README.md) - Project overview
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [docs/ARCHITECTURE.md](ARCHITECTURE.md) - Architecture details
