# Contributing to UBI

Thank you for your interest in contributing to UBI! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Pull Request Process](#pull-request-process)
- [Architecture Guidelines](#architecture-guidelines)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

### Our Standards

- Be respectful and inclusive
- Accept constructive criticism gracefully
- Focus on what's best for the community
- Show empathy towards others

## Getting Started

### Prerequisites

Before contributing, ensure you have:

1. Read the [README.md](README.md)
2. Set up your development environment
3. Familiarized yourself with the codebase structure

### First-Time Setup

```bash
# Clone the repository
git clone https://github.com/ubi-africa/ubi-monorepo.git
cd ubi-monorepo

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local

# Start infrastructure
pnpm docker:up

# Run database migrations
pnpm db:migrate:dev
```

## Development Workflow

### 1. Create a Branch

```bash
# Update main branch
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/your-feature-name
```

### Branch Naming Convention

| Prefix      | Purpose          | Example                    |
| ----------- | ---------------- | -------------------------- |
| `feature/`  | New features     | `feature/add-ride-sharing` |
| `fix/`      | Bug fixes        | `fix/payment-timeout`      |
| `docs/`     | Documentation    | `docs/api-reference`       |
| `chore/`    | Maintenance      | `chore/upgrade-deps`       |
| `refactor/` | Code refactoring | `refactor/user-service`    |
| `test/`     | Test additions   | `test/payment-service`     |

### 2. Make Changes

- Write clean, readable code
- Add tests for new functionality
- Update documentation as needed
- Follow the code standards below

### 3. Commit Changes

We use [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# Format: <type>(<scope>): <description>

# Features
git commit -m "feat(rides): add schedule ride functionality"

# Bug fixes
git commit -m "fix(payments): resolve M-Pesa timeout issue"

# Documentation
git commit -m "docs(api): update webhook documentation"

# Chores
git commit -m "chore(deps): upgrade Next.js to 15.1"
```

#### Commit Types

| Type       | Description                 |
| ---------- | --------------------------- |
| `feat`     | New feature                 |
| `fix`      | Bug fix                     |
| `docs`     | Documentation only          |
| `style`    | Formatting, no code change  |
| `refactor` | Code change, no feature/fix |
| `perf`     | Performance improvement     |
| `test`     | Adding tests                |
| `chore`    | Maintenance tasks           |
| `ci`       | CI/CD changes               |

#### Commit Scopes

| Scope      | Description              |
| ---------- | ------------------------ |
| `rides`    | Ride service changes     |
| `food`     | Food service changes     |
| `delivery` | Delivery service changes |
| `payments` | Payment service changes  |
| `auth`     | Authentication changes   |
| `ui`       | UI component changes     |
| `api`      | API gateway changes      |
| `deps`     | Dependency updates       |

### 4. Push and Create PR

```bash
# Push your branch
git push origin feature/your-feature-name

# Create PR on GitHub
# Use the PR template provided
```

## Code Standards

### TypeScript

```typescript
// ✅ Good: Use explicit types
function calculateFare(distance: number, rideType: RideType): Money {
  // ...
}

// ❌ Bad: Implicit any
function calculateFare(distance, rideType) {
  // ...
}

// ✅ Good: Use interfaces for objects
interface RideRequest {
  pickupLocation: Location;
  dropoffLocation: Location;
  rideType: RideType;
  scheduledTime?: Date;
}

// ✅ Good: Use enums for constants
enum RideStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  IN_PROGRESS = "IN_PROGRESS",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED",
}

// ✅ Good: Handle errors properly
try {
  const result = await processPayment(payment);
  return { success: true, data: result };
} catch (error) {
  logger.error("Payment failed", { error, paymentId: payment.id });
  throw new PaymentError("Payment processing failed", error);
}
```

### React Components

```tsx
// ✅ Good: Use functional components with TypeScript
interface RideCardProps {
  ride: Ride;
  onSelect: (rideId: string) => void;
  isLoading?: boolean;
}

export function RideCard({ ride, onSelect, isLoading = false }: RideCardProps) {
  const handleSelect = useCallback(() => {
    onSelect(ride.id);
  }, [ride.id, onSelect]);

  return (
    <Card onClick={handleSelect} disabled={isLoading}>
      <CardContent>{/* ... */}</CardContent>
    </Card>
  );
}

// ✅ Good: Export default for page components
export default function RidePage() {
  return <RideList />;
}
```

### Go Code

```go
// ✅ Good: Follow Go conventions
package rides

import (
    "context"
    "time"
)

// RideService handles ride-related operations
type RideService struct {
    repo     RideRepository
    matcher  DriverMatcher
    notifier Notifier
}

// NewRideService creates a new RideService instance
func NewRideService(repo RideRepository, matcher DriverMatcher, notifier Notifier) *RideService {
    return &RideService{
        repo:     repo,
        matcher:  matcher,
        notifier: notifier,
    }
}

// RequestRide creates a new ride request
func (s *RideService) RequestRide(ctx context.Context, req RideRequest) (*Ride, error) {
    // Validate request
    if err := req.Validate(); err != nil {
        return nil, fmt.Errorf("invalid ride request: %w", err)
    }

    // Find available drivers
    drivers, err := s.matcher.FindAvailableDrivers(ctx, req.PickupLocation)
    if err != nil {
        return nil, fmt.Errorf("failed to find drivers: %w", err)
    }

    // Create ride
    ride := &Ride{
        ID:             uuid.New(),
        Status:         RideStatusPending,
        PickupLocation: req.PickupLocation,
        CreatedAt:      time.Now(),
    }

    if err := s.repo.Create(ctx, ride); err != nil {
        return nil, fmt.Errorf("failed to create ride: %w", err)
    }

    return ride, nil
}
```

### File Organization

```
// Services should follow this structure
services/ride-service/
├── cmd/
│   └── server/
│       └── main.go           # Entry point
├── internal/
│   ├── handlers/             # HTTP handlers
│   ├── services/             # Business logic
│   ├── repository/           # Data access
│   └── models/               # Domain models
├── pkg/                      # Public packages
├── migrations/               # Database migrations
├── Dockerfile
├── go.mod
└── README.md
```

### Naming Conventions

| Item        | Convention      | Example           |
| ----------- | --------------- | ----------------- |
| Files       | kebab-case      | `ride-service.ts` |
| Components  | PascalCase      | `RideCard.tsx`    |
| Functions   | camelCase       | `calculateFare()` |
| Constants   | SCREAMING_SNAKE | `MAX_RETRY_COUNT` |
| Interfaces  | PascalCase      | `RideRequest`     |
| Types       | PascalCase      | `RideStatus`      |
| Go files    | snake_case      | `ride_handler.go` |
| Go packages | lowercase       | `rides`           |

## Pull Request Process

### PR Checklist

Before submitting a PR, ensure:

- [ ] Code follows the project's style guidelines
- [ ] Tests pass locally (`pnpm test`)
- [ ] Lint passes (`pnpm lint`)
- [ ] Types check (`pnpm typecheck`)
- [ ] Documentation is updated
- [ ] Commit messages follow convention
- [ ] PR description is complete

### PR Template

When creating a PR, use this template:

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Related Issues

Closes #123

## Testing

Describe tests added/modified

## Screenshots

If applicable

## Checklist

- [ ] Tests pass
- [ ] Lint passes
- [ ] Documentation updated
```

### Review Process

1. **Automated Checks** - CI runs tests, lint, and builds
2. **Code Review** - At least 1 approval required
3. **Merge** - Squash and merge to main

## Architecture Guidelines

### Service Communication

```
┌──────────────┐     HTTP/REST     ┌──────────────┐
│  API Gateway │ ───────────────── │   Service    │
└──────────────┘                   └──────────────┘

┌──────────────┐      Events       ┌──────────────┐
│   Service A  │ ───────────────── │   Service B  │
└──────────────┘     (Redis)       └──────────────┘
```

### Adding New Services

1. Create service directory in `services/`
2. Use appropriate template:
   - Node.js: Copy from `user-service`
   - Go: Copy from `ride-service`
3. Add to `turbo.json` pipelines
4. Add to CI/CD workflows
5. Update documentation

### Database Guidelines

- Use Prisma for Node.js services
- Use sqlx or gorm for Go services
- Always create migrations, never modify schema directly
- Use transactions for multi-table operations

```typescript
// ✅ Good: Use transactions
await prisma.$transaction(async (tx) => {
  await tx.wallet.update({ ... });
  await tx.transaction.create({ ... });
});
```

### API Design

- Use RESTful conventions
- Version APIs: `/v1/rides`
- Use consistent error responses
- Document with OpenAPI

```typescript
// Standard error response
interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
}
```

## Questions?

- Check existing issues
- Ask in #engineering Slack channel
- Create a discussion on GitHub

---

Thank you for contributing to UBI! 🚗 🌍
