# Phase 4: Reconciliation & Admin Dashboard

## Overview

Phase 4 implements automated reconciliation, settlement processing, and a comprehensive admin dashboard for operations management. This completes the payment system's operational infrastructure.

## Components Built

### 1. Reconciliation Service (`services/reconciliation.service.ts`)

**~760 lines of code**

Automated daily reconciliation between UBI records and payment providers.

#### Features

| Feature                | Description                                       |
| ---------------------- | ------------------------------------------------- |
| Daily Reconciliation   | Compare UBI transactions with provider reports    |
| Discrepancy Detection  | Identify mismatches by type and severity          |
| Auto-Resolution        | Automatically resolve small discrepancies (<₦100) |
| Balance Reconciliation | Compare account balances daily                    |
| Critical Alerts        | Automatic alerts for large discrepancies          |

#### Discrepancy Types

```typescript
enum DiscrepancyType {
  MISSING_IN_UBI     // Transaction in provider, not in UBI
  MISSING_IN_PROVIDER // Transaction in UBI, not in provider
  AMOUNT_MISMATCH    // Different amounts recorded
  STATUS_MISMATCH    // Different status (e.g., completed vs pending)
}
```

#### Severity Levels

| Severity | Amount Threshold  | Action                      |
| -------- | ----------------- | --------------------------- |
| LOW      | < ₦1,000          | Review queue                |
| MEDIUM   | ₦1,000 - ₦10,000  | Priority review             |
| HIGH     | ₦10,000 - ₦50,000 | Immediate review + alert    |
| CRITICAL | ≥ ₦50,000         | Critical alert + escalation |

#### API Methods

```typescript
// Run daily reconciliation
await reconciliationService.runDailyReconciliation(
  PaymentProvider.PAYSTACK,
  new Date("2024-01-15"),
  Currency.NGN
);

// Get pending discrepancies
const discrepancies = await reconciliationService.getPendingDiscrepancies({
  provider: PaymentProvider.MPESA,
  severity: "HIGH",
  page: 1,
  pageSize: 50,
});

// Resolve discrepancy
await reconciliationService.resolveDiscrepancy(
  discrepancyId,
  "Verified with provider - transaction processed",
  adminUserId
);

// Balance reconciliation
await reconciliationService.runBalanceReconciliation(
  PaymentProvider.MTN_MOMO,
  new Date(),
  Currency.GHS
);
```

---

### 2. Settlement Service (`services/settlement.service.ts`)

**~580 lines of code**

Handles restaurant, merchant, and partner settlements with automatic commission deduction.

#### Commission Structure

| Recipient Type | UBI Commission | CEERION Fee | Settlement Fee |
| -------------- | -------------- | ----------- | -------------- |
| Restaurant     | 20%            | 1%          | 0.5% + ₦100    |
| Merchant       | 3%             | 0.15%       | 0.5% + ₦100    |
| Partner        | 10%            | 0.5%        | 0.5% + ₦100    |
| Driver         | 15%            | 0.75%       | 0.5% + ₦100    |

#### Settlement Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    SETTLEMENT PROCESS                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Gross Amount: ₦100,000 (Restaurant settlement)              │
│  ──────────────────────────────────────────────────────────  │
│                                                              │
│  Deductions:                                                 │
│  ├─ UBI Commission (20%):     - ₦20,000                     │
│  ├─ CEERION Fee (1%):         - ₦1,000                      │
│  └─ Settlement Fee (0.5%+100): - ₦600                       │
│  ──────────────────────────────────────────────────────────  │
│                                                              │
│  Net Amount:                    ₦78,400                      │
│                                                              │
│  Payout Method: Bank Transfer / Mobile Money                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### API Methods

```typescript
// Create settlement
const settlement = await settlementService.createSettlement({
  recipientId: restaurantId,
  recipientType: "RESTAURANT",
  periodStart: new Date("2024-01-01"),
  periodEnd: new Date("2024-01-07"),
  grossAmount: 100000,
  currency: Currency.NGN,
  payoutMethod: "bank_transfer",
  bankDetails: {
    bankCode: "058",
    accountNumber: "0123456789",
    accountName: "Restaurant Ltd",
  },
});

// Process settlement
await settlementService.processSettlement(settlement.id);

// Run daily restaurant settlements
await settlementService.runDailyRestaurantSettlements(
  new Date("2024-01-15"),
  Currency.NGN
);

// Get settlement summary
const summary = await settlementService.getSettlementSummary({
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-01-31"),
  recipientType: "RESTAURANT",
  currency: Currency.NGN,
});
```

#### Double-Entry Ledger for Commissions

When a settlement is processed, the following ledger entries are created:

```typescript
// UBI Commission
DEBIT:  Restaurant Escrow Account    ₦20,000
CREDIT: UBI Revenue Account          ₦20,000

// CEERION Fee
DEBIT:  Restaurant Escrow Account    ₦1,000
CREDIT: CEERION Revenue Account      ₦1,000

// Settlement Fee
DEBIT:  Restaurant Escrow Account    ₦600
CREDIT: UBI Fee Revenue Account      ₦600
```

---

### 3. Admin Dashboard Routes (`routes/admin.ts`)

**~750 lines of code**

Comprehensive admin API for operations management.

#### Endpoint Categories

##### Dashboard Overview

```
GET /admin/dashboard
```

Returns key metrics:

- Today's volume and transaction count
- Month-to-date totals
- Pending payouts count
- Open fraud alerts
- Unresolved discrepancies

##### Transaction Management

```
GET  /admin/transactions          # List with filters
GET  /admin/transactions/:id      # Transaction details
POST /admin/transactions/:id/refund  # Initiate refund
```

##### Reconciliation

```
GET  /admin/reconciliations              # List reconciliation reports
POST /admin/reconciliations/run          # Trigger manual reconciliation
GET  /admin/reconciliations/discrepancies # List discrepancies
POST /admin/reconciliations/discrepancies/:id/resolve # Resolve
```

##### Settlements

```
GET  /admin/settlements           # List settlements
POST /admin/settlements/:id/retry # Retry failed settlement
GET  /admin/settlements/summary   # Settlement analytics
```

##### Payouts

```
GET  /admin/payouts              # List driver payouts
POST /admin/payouts/:id/approve  # Approve pending payout
POST /admin/payouts/:id/cancel   # Cancel payout
```

##### Fraud Management

```
GET  /admin/fraud/alerts         # List fraud alerts
POST /admin/fraud/:id/review     # Review fraud assessment
```

##### User Management

```
GET  /admin/users/:id           # User payment details
POST /admin/users/:id/block     # Block user from payments
POST /admin/users/:id/unblock   # Unblock user
```

##### Reports

```
GET /admin/reports/daily?date=2024-01-15
GET /admin/reports/monthly?month=2024-01
```

---

### 4. Database Schema Updates

New models added to `packages/database/prisma/schema.prisma`:

#### ReconciliationDiscrepancy

Tracks individual discrepancies found during reconciliation.

```prisma
model ReconciliationDiscrepancy {
  id                     String    @id
  reconciliationReportId String
  type                   String    // MISSING_IN_UBI, etc.
  severity               String    // LOW, MEDIUM, HIGH, CRITICAL
  transactionId          String?
  providerReference      String?
  ubiAmount              Decimal?
  providerAmount         Decimal?
  difference             Decimal?
  currency               Currency
  description            String
  status                 String    // pending, resolved, ignored
  resolution             String?
  resolvedAt             DateTime?
  resolvedBy             String?
}
```

#### BalanceReconciliation

Daily balance snapshot comparisons.

```prisma
model BalanceReconciliation {
  id              String
  date            DateTime
  provider        PaymentProvider
  currency        Currency
  ubiBalance      Decimal
  providerBalance Decimal
  difference      Decimal
  percentageDiff  Float
  status          String
}
```

#### Settlement

Settlement records for restaurants, merchants, partners.

```prisma
model Settlement {
  id               String
  recipientId      String
  recipientType    String    // RESTAURANT, MERCHANT, DRIVER, PARTNER
  periodStart      DateTime
  periodEnd        DateTime
  grossAmount      Decimal
  ubiCommission    Decimal
  ceerionDeduction Decimal
  settlementFee    Decimal
  netAmount        Decimal
  currency         Currency
  status           String
  payoutMethod     String
  payoutDestination Json
  providerReference String?
}
```

#### Refund

Refund records linked to transactions.

```prisma
model Refund {
  id            String
  transactionId String
  amount        Decimal
  currency      Currency
  reason        String
  status        String
  initiatedBy   String
}
```

#### Alert

Operations alerts for critical events.

```prisma
model Alert {
  id           String
  type         String    // CRITICAL_DISCREPANCY, FRAUD_DETECTED, etc.
  severity     String
  title        String
  message      String
  acknowledged Boolean
  resolved     Boolean
}
```

---

## Scheduled Jobs

The following jobs should be scheduled (via cron or job scheduler):

### Daily Jobs (2:00 AM local time)

```typescript
// Reconciliation for each provider
schedule("0 2 * * *", async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  for (const provider of [
    PaymentProvider.PAYSTACK,
    PaymentProvider.MPESA,
    PaymentProvider.MTN_MOMO,
  ]) {
    for (const currency of getProviderCurrencies(provider)) {
      await reconciliationService.runDailyReconciliation(
        provider,
        yesterday,
        currency
      );
      await reconciliationService.runBalanceReconciliation(
        provider,
        yesterday,
        currency
      );
    }
  }
});

// Restaurant daily settlements
schedule("0 3 * * *", async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  await settlementService.runDailyRestaurantSettlements(
    yesterday,
    Currency.NGN
  );
  await settlementService.runDailyRestaurantSettlements(
    yesterday,
    Currency.KES
  );
  await settlementService.runDailyRestaurantSettlements(
    yesterday,
    Currency.GHS
  );
});
```

### Weekly Jobs (Mondays at 3:00 AM)

```typescript
// Driver weekly payouts
schedule("0 3 * * 1", async () => {
  await payoutService.processWeeklyPayouts();
});
```

---

## Admin Dashboard UI Mockup

```
┌────────────────────────────────────────────────────────────────────────┐
│  UBI Payment Admin Dashboard                              [Admin User] │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Today        │  │ This Month   │  │ Pending      │  │ Alerts     │ │
│  │ ₦45.2M       │  │ ₦1.2B        │  │ 23           │  │ 5          │ │
│  │ 12,450 txns  │  │ 325K txns    │  │ payouts      │  │ critical   │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘ │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ Reconciliation Status                                           │  │
│  ├─────────────────────────────────────────────────────────────────┤  │
│  │ Provider    │ Date       │ Status  │ Discrepancies │ Actions    │  │
│  ├─────────────┼────────────┼─────────┼───────────────┼────────────│  │
│  │ Paystack    │ 2024-01-15 │ ✅ OK   │ 0             │ View       │  │
│  │ M-Pesa      │ 2024-01-15 │ ⚠️ 3    │ 3 (₦12,500)   │ Review     │  │
│  │ MTN MoMo    │ 2024-01-15 │ ✅ OK   │ 0             │ View       │  │
│  └─────────────┴────────────┴─────────┴───────────────┴────────────┘  │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ Recent Transactions                                  [View All] │  │
│  ├─────────────────────────────────────────────────────────────────┤  │
│  │ ID          │ User    │ Amount    │ Provider │ Status │ Time   │  │
│  ├─────────────┼─────────┼───────────┼──────────┼────────┼────────│  │
│  │ TXN-001234  │ John D. │ ₦15,000   │ Paystack │ ✅     │ 2m ago │  │
│  │ TXN-001233  │ Mary K. │ KES 5,000 │ M-Pesa   │ ✅     │ 5m ago │  │
│  │ TXN-001232  │ Kwame A.│ GHS 200   │ MoMo     │ ⏳     │ 8m ago │  │
│  └─────────────┴─────────┴───────────┴──────────┴────────┴────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Security Considerations

### Admin Route Protection

```typescript
// All admin routes require:
// 1. Rate limiting
// 2. Service authentication
// 3. Admin role verification
app.use("/admin/*", paymentRateLimit);
app.use("/admin/*", serviceAuth);
// Plus role check in individual handlers
```

### Audit Trail

All admin actions are logged:

- Who performed the action
- What action was taken
- When it occurred
- What data was affected

### Access Control

| Role        | Permissions                                  |
| ----------- | -------------------------------------------- |
| ADMIN       | View dashboard, transactions, reconciliation |
| SUPER_ADMIN | All above + refunds, payouts, user blocking  |
| FINANCE     | Reconciliation, settlements, reports         |
| SUPPORT     | View transactions, user details              |

---

## Metrics & Monitoring

### Key Performance Indicators

| Metric                          | Target | Alert Threshold |
| ------------------------------- | ------ | --------------- |
| Daily Reconciliation Match Rate | >99.9% | <99.5%          |
| Settlement Success Rate         | >99%   | <98%            |
| Discrepancy Resolution Time     | <24h   | >48h            |
| Payout Processing Time          | <2h    | >4h             |

### Monitoring Dashboards

Recommended metrics to track:

- Transaction volume by provider (real-time)
- Reconciliation discrepancy trend (daily)
- Settlement processing time (hourly)
- Fraud alert volume (daily)
- Provider health status (real-time)

---

## Testing Recommendations

### Unit Tests

- Commission calculation accuracy
- Discrepancy detection logic
- Settlement amount computation

### Integration Tests

- Full reconciliation workflow
- Settlement processing with provider APIs
- Admin API responses

### Load Tests

- Bulk reconciliation (100K+ transactions)
- Concurrent settlement processing
- Dashboard API response times

---

## Summary

Phase 4 adds critical operational capabilities:

| Component             | Lines | Purpose                        |
| --------------------- | ----- | ------------------------------ |
| ReconciliationService | 760   | Automated transaction matching |
| SettlementService     | 580   | Restaurant/merchant payouts    |
| Admin Routes          | 750   | Operations dashboard APIs      |
| Schema Updates        | 150   | New data models                |

**Total Phase 4: ~2,240 lines**

This completes the payment system's operational infrastructure, enabling UBI to:

- Automatically reconcile with payment providers daily
- Process restaurant/merchant settlements with commission deduction
- Manage the payment system through a comprehensive admin dashboard
- Monitor and resolve discrepancies efficiently
