# UBI Test Strategy Document

## Executive Summary

This document outlines the comprehensive testing strategy for UBI, an African mobility super-app. Our testing approach is designed to ensure reliability, performance, and security while enabling rapid iteration and confident deployments across all platforms.

## Table of Contents

1. [Testing Philosophy](#testing-philosophy)
2. [Testing Pyramid](#testing-pyramid)
3. [Test Types by Application](#test-types-by-application)
4. [Coverage Requirements](#coverage-requirements)
5. [Test Environments](#test-environments)
6. [Test Data Management](#test-data-management)
7. [Quality Gates](#quality-gates)
8. [African Market Considerations](#african-market-considerations)
9. [Tools & Technologies](#tools--technologies)
10. [Roles & Responsibilities](#roles--responsibilities)

---

## Testing Philosophy

### Core Principles

1. **Shift-Left Testing**: Find bugs early when they're cheapest to fix
2. **Risk-Based Testing**: Focus testing effort on critical business flows
3. **Automation First**: Automate everything that can be automated
4. **Fast Feedback**: Tests should run fast and provide immediate feedback
5. **Maintainability**: Tests are code; they need maintenance and refactoring

### Testing Mantras

- "Test behavior, not implementation"
- "A slow test is a bad test"
- "Flaky tests are worse than no tests"
- "If it can break, test it; if it can't break, don't test it"

---

## Testing Pyramid

```
                        ┌─────────────────────┐
                        │     E2E Tests       │  ← 5% of tests
                        │  (Critical paths)   │  Slowest, most brittle
                        │   ~50 scenarios     │  Run on PR merge
                        ├─────────────────────┤
                        │                     │
                        │  Integration Tests  │  ← 15% of tests
                        │   (API, Database)   │  Medium speed
                        │   ~500 tests        │  Run on every PR
                        ├─────────────────────┤
                        │                     │
                        │                     │
                        │    Unit Tests       │  ← 80% of tests
                        │  (Functions, Logic) │  Fastest, most stable
                        │   ~5000 tests       │  Run on every commit
                        │                     │
                        └─────────────────────┘

                    Execution Time ──────────────────────►
                    Isolation      ◄──────────────────────
```

### Test Distribution Goals

| Level       | Percentage | Count Target | Execution Time |
| ----------- | ---------- | ------------ | -------------- |
| Unit        | 80%        | 5,000+       | < 2 minutes    |
| Integration | 15%        | 500+         | < 10 minutes   |
| E2E         | 5%         | 50+          | < 20 minutes   |

---

## Test Types by Application

### Flutter Mobile Apps (Rider & Driver)

| Test Type   | Tool             | Purpose                             | Run Frequency |
| ----------- | ---------------- | ----------------------------------- | ------------- |
| Unit        | flutter_test     | BLoC logic, repositories, use cases | Every commit  |
| Widget      | flutter_test     | Component rendering, interactions   | Every commit  |
| Golden      | golden_toolkit   | Visual regression                   | Every PR      |
| Integration | integration_test | Full app flows on emulator          | Nightly       |
| E2E         | Patrol/Maestro   | Critical user journeys              | Pre-release   |

### Next.js Web Apps

| Test Type     | Tool            | Purpose                | Run Frequency |
| ------------- | --------------- | ---------------------- | ------------- |
| Unit          | Vitest          | Hooks, utils, stores   | Every commit  |
| Component     | Testing Library | Component behavior     | Every commit  |
| Visual        | Chromatic/Percy | Visual regression      | Every PR      |
| E2E           | Playwright      | Critical user journeys | Every PR      |
| Accessibility | axe-core        | WCAG compliance        | Every PR      |

### Node.js Services

| Test Type   | Tool                       | Purpose                  | Run Frequency |
| ----------- | -------------------------- | ------------------------ | ------------- |
| Unit        | Vitest                     | Service logic, utilities | Every commit  |
| Integration | Supertest + Testcontainers | API endpoints, database  | Every PR      |
| Contract    | Pact                       | API contract validation  | Every PR      |
| Performance | k6                         | Load testing             | Nightly       |

### Go Services

| Test Type   | Tool              | Purpose                | Run Frequency |
| ----------- | ----------------- | ---------------------- | ------------- |
| Unit        | testing + testify | Business logic         | Every commit  |
| Integration | dockertest        | Database, Redis        | Every PR      |
| Benchmark   | testing.B         | Performance regression | Weekly        |
| Fuzz        | testing.F         | Edge case discovery    | Weekly        |

---

## Coverage Requirements

### Line Coverage Targets

| Application Type | Minimum | Target | Critical Paths |
| ---------------- | ------- | ------ | -------------- |
| Flutter Apps     | 70%     | 80%    | 95%            |
| Web Apps         | 70%     | 80%    | 95%            |
| Node.js Services | 75%     | 85%    | 95%            |
| Go Services      | 75%     | 85%    | 95%            |

### Critical Path Coverage (Must be 95%+)

**Payment Processing**

- Payment initiation
- Mobile money callbacks
- Refund processing
- Wallet operations

**Ride Matching**

- Driver matching algorithm
- Fare calculation
- ETA computation
- Surge pricing

**User Authentication**

- OTP verification
- Session management
- Token refresh

---

## Test Environments

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ENVIRONMENT MATRIX                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐        │
│  │  LOCAL   │   │   DEV    │   │ STAGING  │   │   PROD   │        │
│  │          │   │          │   │          │   │          │        │
│  │ Docker   │   │ Shared   │   │ Prod-    │   │ Real     │        │
│  │ Compose  │   │ Unstable │   │ Like     │   │ Traffic  │        │
│  │          │   │          │   │          │   │          │        │
│  │ Unit +   │   │ Manual   │   │ E2E +    │   │ Smoke    │        │
│  │ Int.     │   │ Testing  │   │ Perf.    │   │ Tests    │        │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘        │
│       │              │              │              │               │
│       ▼              ▼              ▼              ▼               │
│    Commit ───► PR Merge ───► Deploy ───► Release                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Environment Specifications

| Environment | Purpose             | Data            | External Services |
| ----------- | ------------------- | --------------- | ----------------- |
| Local       | Development         | Fixtures        | Mocked            |
| Dev         | Integration         | Synthetic       | Sandboxes         |
| Staging     | Pre-prod validation | Anonymized prod | Sandboxes         |
| Prod        | Production          | Real            | Production        |

---

## Test Data Management

### Data Strategies

1. **Fixtures**: Static test data for unit tests
2. **Factories**: Dynamic data generation using Faker
3. **Seeders**: Database population scripts
4. **Snapshots**: Anonymized production data copies

### Test Data Principles

- Never use real production data in non-prod environments
- Generate realistic African names, phone numbers, locations
- Include edge cases (special characters, long names, etc.)
- Clean up test data after test runs

### Data Anonymization Rules

| Field Type   | Anonymization Method               |
| ------------ | ---------------------------------- |
| Phone Number | +234XXXXXXXX format, random digits |
| Email        | {uuid}@test.ubi.africa             |
| Name         | Faker with African locale          |
| Location     | Randomize within city bounds       |
| Payment Info | Use sandbox tokens                 |

---

## Quality Gates

### Gate 1: PR Creation

**Required to Pass:**

- [ ] Linting (ESLint, golangci-lint, flutter analyze)
- [ ] Unit tests (all passing)
- [ ] Type checking
- [ ] Build succeeds

### Gate 2: PR Approval

**Required to Pass:**

- [ ] Integration tests
- [ ] Visual regression tests
- [ ] Coverage thresholds met
- [ ] Code review approved

### Gate 3: Deploy to Staging

**Required to Pass:**

- [ ] E2E smoke tests
- [ ] API contract tests
- [ ] Security scan (SAST)

### Gate 4: Deploy to Production

**Required to Pass:**

- [ ] Full E2E suite on staging
- [ ] Performance benchmarks met
- [ ] Security scan (DAST)
- [ ] Manual QA sign-off (for major features)

### Gate 5: Post-Deploy

**Required to Pass:**

- [ ] Smoke tests on production
- [ ] Key metrics within bounds
- [ ] No error rate spike

---

## African Market Considerations

### Network Condition Testing

```javascript
// Network profiles for testing
const NETWORK_PROFILES = {
  // Common African mobile networks
  "2G_EDGE": {
    downloadThroughput: 50_000,
    uploadThroughput: 20_000,
    latency: 500,
  },
  "3G": {
    downloadThroughput: 500_000,
    uploadThroughput: 100_000,
    latency: 200,
  },
  "4G_LTE": {
    downloadThroughput: 4_000_000,
    uploadThroughput: 1_000_000,
    latency: 50,
  },

  // Degraded conditions
  HIGH_LATENCY: { downloadThroughput: 1_000_000, latency: 1000 },
  PACKET_LOSS: { downloadThroughput: 1_000_000, packetLoss: 10 },
  INTERMITTENT: {
    downloadThroughput: 500_000,
    offline: { duration: 5000, interval: 30000 },
  },
};
```

### Device Coverage Matrix

| Device Category   | Example Devices      | RAM  | Storage | Test Priority |
| ----------------- | -------------------- | ---- | ------- | ------------- |
| Budget Android    | Tecno Spark, Infinix | 2GB  | 16GB    | HIGH          |
| Mid-range Android | Samsung A series     | 4GB  | 64GB    | HIGH          |
| High-end Android  | Samsung S series     | 8GB+ | 128GB+  | MEDIUM        |
| iPhone SE         | iPhone SE 2020       | 3GB  | 64GB    | MEDIUM        |
| iPhone Pro        | iPhone 14 Pro        | 6GB  | 128GB+  | LOW           |

### Payment Integration Testing

| Provider         | Test Environment | Webhook Testing |
| ---------------- | ---------------- | --------------- |
| M-Pesa (Kenya)   | Daraja Sandbox   | ngrok tunnel    |
| MTN MoMo (Ghana) | Sandbox API      | Mock server     |
| Airtel Money     | Sandbox          | Mock server     |
| Flutterwave      | Test Mode        | Webhook.site    |
| Paystack         | Test Mode        | Local tunnel    |

### Localization Test Matrix

| Language | Code | Script Direction | Test Coverage  |
| -------- | ---- | ---------------- | -------------- |
| English  | en   | LTR              | Full           |
| French   | fr   | LTR              | Full           |
| Swahili  | sw   | LTR              | Critical paths |
| Arabic   | ar   | RTL              | Critical paths |
| Amharic  | am   | LTR              | Critical paths |

---

## Tools & Technologies

### Testing Tools Matrix

```
┌────────────────────────────────────────────────────────────────────┐
│                         TESTING TOOLKIT                             │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  UNIT TESTING           INTEGRATION          E2E TESTING          │
│  ┌─────────────┐        ┌─────────────┐      ┌─────────────┐      │
│  │ Vitest      │        │ Supertest   │      │ Playwright  │      │
│  │ Jest        │        │ Testcontain │      │ Patrol      │      │
│  │ Go testing  │        │ Pact        │      │ Maestro     │      │
│  │ flutter_test│        │ MSW         │      │ Detox       │      │
│  └─────────────┘        └─────────────┘      └─────────────┘      │
│                                                                    │
│  VISUAL TESTING         PERFORMANCE          SECURITY             │
│  ┌─────────────┐        ┌─────────────┐      ┌─────────────┐      │
│  │ Chromatic   │        │ k6          │      │ Snyk        │      │
│  │ Percy       │        │ Artillery   │      │ OWASP ZAP   │      │
│  │ golden_test │        │ Lighthouse  │      │ Semgrep     │      │
│  │ Storybook   │        │ Web Vitals  │      │ SonarQube   │      │
│  └─────────────┘        └─────────────┘      └─────────────┘      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### CI/CD Integration

- **CI Platform**: GitHub Actions
- **Test Reporting**: Allure, JUnit XML
- **Coverage**: Codecov
- **Flaky Detection**: Buildpulse/Tesults

---

## Roles & Responsibilities

### Development Team

- Write unit and integration tests for their code
- Maintain 80%+ test coverage
- Fix flaky tests within 48 hours
- Review test code in PRs

### QA Team

- Design E2E test scenarios
- Maintain E2E test suites
- Perform exploratory testing
- Manage test environments

### Platform/DevOps Team

- Maintain CI/CD pipelines
- Manage test infrastructure
- Monitor test performance
- Handle test data infrastructure

### Security Team

- Define security test requirements
- Run penetration tests
- Review security scan results
- Maintain security test automation

---

## Metrics & Reporting

### Key Metrics

| Metric               | Target  | Alert Threshold |
| -------------------- | ------- | --------------- |
| Test Pass Rate       | >99%    | <95%            |
| Test Coverage        | >80%    | <70%            |
| Test Duration (Unit) | <2 min  | >5 min          |
| Test Duration (E2E)  | <20 min | >30 min         |
| Flaky Test Rate      | <1%     | >3%             |

### Reporting Dashboards

1. **CI Dashboard**: Real-time test results
2. **Coverage Dashboard**: Coverage trends
3. **Flaky Test Dashboard**: Flaky test tracking
4. **Performance Dashboard**: Test duration trends

---

## Appendix

### A. Test Naming Conventions

```
Unit tests:     describe('functionName', () => { it('should behavior when condition') })
Integration:    describe('POST /api/endpoint', () => { it('returns 201 when valid') })
E2E:            test('user can complete ride booking flow')
```

### B. Test File Locations

```
src/
├── module/
│   ├── module.service.ts
│   ├── module.service.test.ts      # Unit test co-located
│   └── module.controller.ts
└── __tests__/
    └── integration/
        └── module.integration.test.ts
```

### C. Related Documents

- [Running Tests Locally](./RUNNING_TESTS.md)
- [Writing Good Tests](./WRITING_TESTS.md)
- [Debugging Failed Tests](./DEBUGGING_TESTS.md)
- [Performance Testing Guide](./PERFORMANCE_TESTING.md)

---

_Last Updated: January 2026_
_Owner: QA Engineering Team_
_Review Cycle: Quarterly_
