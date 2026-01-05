# UBI Payment Service - Complete API Reference

## Base URL

```
Production: https://api.ubi.africa/payments
Staging: https://staging-api.ubi.africa/payments
```

---

## Authentication

All API requests require authentication via Bearer token or API key.

### Bearer Token (User Context)

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### API Key (Service-to-Service)

```http
X-API-Key: sk_live_xxx
```

---

## Wallet API

### Get Wallet Balance

```http
GET /api/wallets/balance
```

**Response:**

```json
{
  "success": true,
  "data": {
    "userId": "user_xxx",
    "accounts": [
      {
        "currency": "KES",
        "available": 15000.0,
        "pending": 500.0,
        "held": 200.0
      },
      {
        "currency": "NGN",
        "available": 50000.0,
        "pending": 0,
        "held": 0
      }
    ],
    "totalUSD": 125.5
  }
}
```

### Get Transaction History

```http
GET /api/wallets/transactions?currency=KES&limit=20&offset=0
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| currency | string | No | Filter by currency (KES, NGN, ZAR, GHS) |
| limit | number | No | Results per page (default: 20, max: 100) |
| offset | number | No | Pagination offset |
| type | string | No | Filter by type (CREDIT, DEBIT, HOLD, RELEASE) |
| startDate | string | No | ISO 8601 date string |
| endDate | string | No | ISO 8601 date string |

**Response:**

```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "txn_xxx",
        "type": "CREDIT",
        "amount": 1000.0,
        "currency": "KES",
        "description": "Wallet top-up via M-Pesa",
        "reference": "mpesa_xxx",
        "balanceAfter": 15000.0,
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ],
    "pagination": {
      "total": 156,
      "limit": 20,
      "offset": 0,
      "hasMore": true
    }
  }
}
```

### Internal Transfer

```http
POST /api/wallets/transfer
```

**Request Body:**

```json
{
  "toUserId": "user_yyy",
  "amount": 500.0,
  "currency": "KES",
  "description": "Payment to friend",
  "idempotencyKey": "transfer_abc123"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "transferId": "xfr_xxx",
    "fromUserId": "user_xxx",
    "toUserId": "user_yyy",
    "amount": 500.0,
    "currency": "KES",
    "status": "COMPLETED",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

---

## Payment API

### Initiate M-Pesa STK Push

```http
POST /api/payments/mpesa/stk-push
```

**Request Body:**

```json
{
  "amount": 1000,
  "phone": "254712345678",
  "purpose": "WALLET_TOPUP",
  "idempotencyKey": "stk_abc123"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "transactionId": "pay_xxx",
    "checkoutRequestId": "ws_CO_xxx",
    "merchantRequestId": "xxx-xxx-xxx",
    "status": "PENDING",
    "message": "STK push sent to phone"
  }
}
```

### Initiate M-Pesa B2C (Payout)

```http
POST /api/payments/mpesa/b2c
```

**Request Body:**

```json
{
  "amount": 5000,
  "phone": "254712345678",
  "purpose": "DRIVER_PAYOUT",
  "remarks": "Daily earnings",
  "idempotencyKey": "b2c_abc123"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "transactionId": "pay_xxx",
    "conversationId": "AG_xxx",
    "originatorConversationId": "xxx",
    "status": "PENDING"
  }
}
```

### Initialize Paystack Payment

```http
POST /api/payments/paystack/initialize
```

**Request Body:**

```json
{
  "amount": 50000,
  "currency": "NGN",
  "email": "user@example.com",
  "purpose": "WALLET_TOPUP",
  "callbackUrl": "https://app.ubi.africa/payment/callback",
  "metadata": {
    "userId": "user_xxx"
  },
  "idempotencyKey": "ps_abc123"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "transactionId": "pay_xxx",
    "authorizationUrl": "https://checkout.paystack.com/xxx",
    "accessCode": "xxx",
    "reference": "ubi_xxx"
  }
}
```

### Charge Saved Card (Paystack)

```http
POST /api/payments/paystack/charge
```

**Request Body:**

```json
{
  "authorizationCode": "AUTH_xxx",
  "amount": 10000,
  "currency": "NGN",
  "email": "user@example.com",
  "purpose": "RIDE_PAYMENT",
  "idempotencyKey": "charge_abc123"
}
```

### Request MTN MoMo Payment

```http
POST /api/payments/momo/request
```

**Request Body:**

```json
{
  "amount": 500,
  "currency": "GHS",
  "phone": "233241234567",
  "purpose": "WALLET_TOPUP",
  "payerMessage": "UBI Wallet Top-up",
  "idempotencyKey": "momo_abc123"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "transactionId": "pay_xxx",
    "referenceId": "xxx-xxx-xxx",
    "status": "PENDING"
  }
}
```

### Check Payment Status

```http
GET /api/payments/:transactionId/status
```

**Response:**

```json
{
  "success": true,
  "data": {
    "transactionId": "pay_xxx",
    "status": "COMPLETED",
    "amount": 1000.0,
    "currency": "KES",
    "provider": "MPESA",
    "providerReference": "xxx",
    "completedAt": "2024-01-15T10:30:00Z"
  }
}
```

---

## Payout API

### Request Payout

```http
POST /api/payouts
```

**Request Body:**

```json
{
  "amount": 10000,
  "currency": "KES",
  "recipientType": "DRIVER",
  "method": "MOBILE_MONEY",
  "destination": {
    "phone": "254712345678",
    "provider": "MPESA"
  },
  "description": "Weekly earnings payout",
  "idempotencyKey": "payout_abc123"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "payoutId": "po_xxx",
    "status": "PROCESSING",
    "amount": 10000.0,
    "fee": 50.0,
    "netAmount": 9950.0,
    "estimatedCompletion": "2024-01-15T10:35:00Z"
  }
}
```

### Request Bank Transfer Payout

```http
POST /api/payouts
```

**Request Body:**

```json
{
  "amount": 50000,
  "currency": "NGN",
  "recipientType": "RESTAURANT",
  "method": "BANK_TRANSFER",
  "destination": {
    "bankCode": "058",
    "accountNumber": "0123456789",
    "accountName": "Restaurant ABC Ltd"
  },
  "description": "Daily settlement",
  "idempotencyKey": "payout_def456"
}
```

### Get Payout Status

```http
GET /api/payouts/:payoutId
```

**Response:**

```json
{
  "success": true,
  "data": {
    "payoutId": "po_xxx",
    "status": "COMPLETED",
    "amount": 10000.0,
    "currency": "KES",
    "fee": 50.0,
    "method": "MOBILE_MONEY",
    "providerReference": "xxx",
    "completedAt": "2024-01-15T10:32:00Z"
  }
}
```

### List Payouts

```http
GET /api/payouts?status=COMPLETED&limit=20
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| status | string | No | Filter by status |
| recipientType | string | No | DRIVER, RESTAURANT, MERCHANT, PARTNER |
| startDate | string | No | ISO 8601 date |
| endDate | string | No | ISO 8601 date |
| limit | number | No | Results per page |
| offset | number | No | Pagination offset |

---

## Webhook Events

### M-Pesa Callback

```http
POST /webhooks/mpesa/callback
```

**STK Push Callback:**

```json
{
  "Body": {
    "stkCallback": {
      "MerchantRequestID": "xxx",
      "CheckoutRequestID": "ws_CO_xxx",
      "ResultCode": 0,
      "ResultDesc": "The service request is processed successfully.",
      "CallbackMetadata": {
        "Item": [
          { "Name": "Amount", "Value": 1000 },
          { "Name": "MpesaReceiptNumber", "Value": "xxx" },
          { "Name": "TransactionDate", "Value": 20240115103000 },
          { "Name": "PhoneNumber", "Value": 254712345678 }
        ]
      }
    }
  }
}
```

### Paystack Webhook

```http
POST /webhooks/paystack
```

**Headers:**

```
X-Paystack-Signature: sha512_hash_of_payload
```

**Payload:**

```json
{
  "event": "charge.success",
  "data": {
    "id": 123456,
    "reference": "ubi_xxx",
    "amount": 5000000,
    "currency": "NGN",
    "status": "success",
    "authorization": {
      "authorization_code": "AUTH_xxx",
      "card_type": "visa",
      "last4": "4081",
      "exp_month": "12",
      "exp_year": "2025",
      "reusable": true
    },
    "customer": {
      "email": "user@example.com"
    },
    "paid_at": "2024-01-15T10:30:00.000Z"
  }
}
```

### MTN MoMo Callback

```http
POST /webhooks/momo/callback
```

**Payload:**

```json
{
  "financialTransactionId": "xxx",
  "externalId": "xxx",
  "amount": "500",
  "currency": "GHS",
  "payer": {
    "partyIdType": "MSISDN",
    "partyId": "233241234567"
  },
  "status": "SUCCESSFUL",
  "reason": null
}
```

---

## Admin API

### Dashboard Metrics

```http
GET /admin/dashboard
```

**Response:**

```json
{
  "success": true,
  "data": {
    "period": "today",
    "metrics": {
      "totalVolume": 15234567.89,
      "transactionCount": 12456,
      "successRate": 98.5,
      "avgTransactionValue": 1223.45
    },
    "byProvider": {
      "MPESA": { "volume": 8000000, "count": 6000 },
      "PAYSTACK": { "volume": 5000000, "count": 4000 },
      "MTN_MOMO": { "volume": 2234567.89, "count": 2456 }
    },
    "byCurrency": {
      "KES": 8000000,
      "NGN": 5000000,
      "GHS": 2234567.89
    }
  }
}
```

### Reconciliation Summary

```http
GET /admin/reconciliation
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| date | string | No | Date to reconcile (default: yesterday) |
| provider | string | No | Filter by provider |

**Response:**

```json
{
  "success": true,
  "data": {
    "date": "2024-01-14",
    "summary": {
      "totalTransactions": 12456,
      "matchedTransactions": 12400,
      "discrepancies": 56,
      "resolvedDiscrepancies": 50,
      "pendingDiscrepancies": 6
    },
    "discrepancyBreakdown": {
      "MISSING_IN_UBI": 20,
      "MISSING_IN_PROVIDER": 15,
      "AMOUNT_MISMATCH": 10,
      "STATUS_MISMATCH": 11
    }
  }
}
```

### Settlement Summary

```http
GET /admin/settlements
```

**Response:**

```json
{
  "success": true,
  "data": {
    "pending": {
      "count": 45,
      "totalAmount": 1234567.89
    },
    "processing": {
      "count": 12,
      "totalAmount": 567890.0
    },
    "completed": {
      "count": 1234,
      "totalAmount": 45678901.23
    },
    "recentSettlements": [
      {
        "id": "stl_xxx",
        "recipientType": "RESTAURANT",
        "recipientId": "rest_xxx",
        "amount": 125000.0,
        "currency": "KES",
        "status": "COMPLETED",
        "processedAt": "2024-01-15T06:00:00Z"
      }
    ]
  }
}
```

### Fraud Review Queue

```http
GET /admin/fraud/review
```

**Response:**

```json
{
  "success": true,
  "data": {
    "pendingReviews": [
      {
        "id": "review_xxx",
        "transactionId": "pay_xxx",
        "riskScore": 85,
        "riskLevel": "HIGH",
        "triggers": [
          "Large amount: 500000 KES",
          "First transaction from device",
          "Unusual location"
        ],
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ],
    "totalPending": 12
  }
}
```

### Approve/Reject Fraud Review

```http
POST /admin/fraud/review/:reviewId
```

**Request Body:**

```json
{
  "decision": "APPROVE",
  "notes": "Verified with customer support"
}
```

---

## Error Responses

### Standard Error Format

```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient wallet balance for this transaction",
    "details": {
      "required": 10000,
      "available": 5000,
      "currency": "KES"
    }
  }
}
```

### Error Codes

| Code                   | HTTP Status | Description                            |
| ---------------------- | ----------- | -------------------------------------- |
| `INVALID_REQUEST`      | 400         | Request validation failed              |
| `UNAUTHORIZED`         | 401         | Missing or invalid authentication      |
| `FORBIDDEN`            | 403         | Insufficient permissions               |
| `NOT_FOUND`            | 404         | Resource not found                     |
| `DUPLICATE_REQUEST`    | 409         | Idempotency key already used           |
| `INSUFFICIENT_BALANCE` | 422         | Not enough funds                       |
| `PAYMENT_FAILED`       | 422         | Payment provider returned error        |
| `FRAUD_BLOCKED`        | 422         | Transaction blocked by fraud detection |
| `RATE_LIMITED`         | 429         | Too many requests                      |
| `PROVIDER_ERROR`       | 502         | Payment provider unavailable           |
| `INTERNAL_ERROR`       | 500         | Unexpected server error                |

---

## Rate Limits

| Endpoint Category  | Limit         | Window              |
| ------------------ | ------------- | ------------------- |
| General API        | 100 requests  | 1 minute            |
| Payment initiation | 30 requests   | 1 minute            |
| STK Push           | 5 requests    | 1 minute (per user) |
| Webhooks           | 1000 requests | 1 minute            |
| Admin endpoints    | 200 requests  | 1 minute            |

**Rate Limit Headers:**

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705312200
```

---

## SDKs & Examples

### cURL Example

```bash
# Get wallet balance
curl -X GET https://api.ubi.africa/payments/api/wallets/balance \
  -H "Authorization: Bearer $TOKEN"

# Initiate M-Pesa payment
curl -X POST https://api.ubi.africa/payments/api/payments/mpesa/stk-push \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: stk_abc123" \
  -d '{
    "amount": 1000,
    "phone": "254712345678",
    "purpose": "WALLET_TOPUP"
  }'
```

### TypeScript Example

```typescript
import { UbiPayments } from "@ubi/payments-sdk";

const payments = new UbiPayments({
  apiKey: process.env.UBI_API_KEY,
  environment: "production",
});

// Get balance
const balance = await payments.wallet.getBalance();

// Initiate payment
const payment = await payments.mpesa.stkPush({
  amount: 1000,
  phone: "254712345678",
  purpose: "WALLET_TOPUP",
});
```

---

## Changelog

### v1.0.0 (2024-01-15)

- Initial release
- M-Pesa STK Push and B2C support
- Paystack card payments
- MTN MoMo payments (Ghana, Rwanda)
- Wallet management
- Fraud detection
- Reconciliation system
- Settlement processing
