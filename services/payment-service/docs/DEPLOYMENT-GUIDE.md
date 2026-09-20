# UBI Payment Service - Deployment Guide

## Overview

This guide covers deploying the UBI Payment Service to production across African markets (Kenya, Nigeria, Ghana, South Africa, Rwanda, Ethiopia).

---

## Prerequisites

### Infrastructure Requirements

| Component       | Specification          | Purpose                 |
| --------------- | ---------------------- | ----------------------- |
| Kubernetes      | 1.28+                  | Container orchestration |
| PostgreSQL      | 15+                    | Primary database        |
| Redis           | 7+                     | Caching & rate limiting |
| Load Balancer   | L7 (nginx/traefik)     | Traffic distribution    |
| SSL Certificate | Wildcard \*.ubi.africa | TLS termination         |

### Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:pass@host:5432/ubi_payments?schema=public"
DATABASE_POOL_SIZE=20
DATABASE_READ_REPLICA_URL="postgresql://user:pass@replica:5432/ubi_payments"

# Redis
REDIS_URL="redis://:password@host:6379"
REDIS_CLUSTER_MODE=true

# Service
NODE_ENV=production
PORT=4003
LOG_LEVEL=info
SERVICE_NAME=payment-service

# M-Pesa (Kenya)
MPESA_CONSUMER_KEY=xxx
MPESA_CONSUMER_SECRET=xxx
MPESA_SHORTCODE=123456
MPESA_PASSKEY=xxx
MPESA_ENV=production

# MTN MoMo
MTN_MOMO_SUBSCRIPTION_KEY=xxx
MTN_MOMO_API_USER=xxx
MTN_MOMO_API_KEY=xxx
MTN_MOMO_ENV=production

# Paystack
PAYSTACK_SECRET_KEY=sk_live_xxx
PAYSTACK_WEBHOOK_SECRET=xxx

# Security
ENCRYPTION_KEY=32-byte-hex-key
JWT_SECRET=xxx
API_KEY_SALT=xxx

# Monitoring
SENTRY_DSN=xxx
PROMETHEUS_ENABLED=true
```

---

## Kubernetes Deployment

### Namespace Setup

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ubi-payments
  labels:
    app: ubi
    tier: backend
```

### ConfigMap

```yaml
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: payment-service-config
  namespace: ubi-payments
data:
  NODE_ENV: "production"
  PORT: "4003"
  LOG_LEVEL: "info"
  DATABASE_POOL_SIZE: "20"
  REDIS_CLUSTER_MODE: "true"
```

### Secrets

```yaml
# k8s/secrets.yaml (use external secrets manager in production)
apiVersion: v1
kind: Secret
metadata:
  name: payment-service-secrets
  namespace: ubi-payments
type: Opaque
stringData:
  DATABASE_URL: "postgresql://..."
  REDIS_URL: "redis://..."
  MPESA_CONSUMER_KEY: "..."
  MPESA_CONSUMER_SECRET: "..."
  # ... other secrets
```

### Deployment

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
  namespace: ubi-payments
  labels:
    app: payment-service
    version: v1
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: payment-service
  template:
    metadata:
      labels:
        app: payment-service
        version: v1
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "4003"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: payment-service
      containers:
        - name: payment-service
          image: gcr.io/ubi-africa/payment-service:latest
          imagePullPolicy: Always
          ports:
            - containerPort: 4003
              name: http
          envFrom:
            - configMapRef:
                name: payment-service-config
            - secretRef:
                name: payment-service-secrets
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2000m"
              memory: "2Gi"
          livenessProbe:
            httpGet:
              path: /health
              port: 4003
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 4003
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: payment-service
                topologyKey: kubernetes.io/hostname
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: ScheduleAnyway
          labelSelector:
            matchLabels:
              app: payment-service
```

### Service

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: payment-service
  namespace: ubi-payments
  labels:
    app: payment-service
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 4003
      protocol: TCP
      name: http
  selector:
    app: payment-service
```

### Horizontal Pod Autoscaler

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: payment-service-hpa
  namespace: ubi-payments
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: payment-service
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
    - type: Pods
      pods:
        metric:
          name: http_requests_per_second
        target:
          type: AverageValue
          averageValue: "1000"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
```

### Ingress

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: payment-service-ingress
  namespace: ubi-payments
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/rate-limit-window: "1m"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  tls:
    - hosts:
        - api.ubi.africa
      secretName: ubi-tls-secret
  rules:
    - host: api.ubi.africa
      http:
        paths:
          - path: /payments
            pathType: Prefix
            backend:
              service:
                name: payment-service
                port:
                  number: 80
```

---

## Database Setup

### Initial Migration

```bash
# Apply all migrations
npx prisma migrate deploy

# Verify schema
npx prisma db pull
```

### Read Replica Configuration

```typescript
// src/lib/database.ts
import { PrismaClient } from "@prisma/client";

const primaryClient = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
});

const replicaClient = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_READ_REPLICA_URL },
  },
});

export const db = {
  write: primaryClient,
  read: replicaClient,
};
```

### Connection Pooling

For production, use PgBouncer:

```yaml
# k8s/pgbouncer.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: pgbouncer
  namespace: ubi-payments
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: pgbouncer
          image: pgbouncer/pgbouncer:1.21.0
          env:
            - name: DATABASES_HOST
              value: "postgres-primary"
            - name: DATABASES_PORT
              value: "5432"
            - name: DATABASES_USER
              value: "ubi_payments"
            - name: POOL_MODE
              value: "transaction"
            - name: MAX_CLIENT_CONN
              value: "1000"
            - name: DEFAULT_POOL_SIZE
              value: "20"
```

---

## Redis Configuration

### Cluster Setup

```yaml
# k8s/redis-cluster.yaml
apiVersion: redis.redis.opstreelabs.in/v1beta2
kind: RedisCluster
metadata:
  name: redis-cluster
  namespace: ubi-payments
spec:
  clusterSize: 3
  clusterVersion: v7
  persistenceEnabled: true
  kubernetesConfig:
    image: redis:7-alpine
    resources:
      requests:
        cpu: 100m
        memory: 256Mi
      limits:
        cpu: 500m
        memory: 1Gi
  storage:
    volumeClaimTemplate:
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 10Gi
```

### Connection String

```bash
REDIS_URL="redis://redis-cluster.ubi-payments:6379"
```

---

## Monitoring & Alerting

### Prometheus ServiceMonitor

```yaml
# k8s/servicemonitor.yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: payment-service-monitor
  namespace: ubi-payments
spec:
  selector:
    matchLabels:
      app: payment-service
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
```

### Alert Rules

```yaml
# k8s/alerts.yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: payment-service-alerts
  namespace: ubi-payments
spec:
  groups:
    - name: payment-service
      rules:
        - alert: PaymentServiceDown
          expr: up{job="payment-service"} == 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "Payment service is down"
            description: "Payment service has been down for more than 1 minute"

        - alert: HighErrorRate
          expr: |
            sum(rate(http_requests_total{job="payment-service",status=~"5.."}[5m])) /
            sum(rate(http_requests_total{job="payment-service"}[5m])) > 0.01
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High error rate in payment service"
            description: "Error rate is above 1% for 5 minutes"

        - alert: HighLatency
          expr: |
            histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{job="payment-service"}[5m])) by (le)) > 0.5
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High latency in payment service"
            description: "p99 latency is above 500ms for 5 minutes"

        - alert: PaymentFailureRate
          expr: |
            sum(rate(payment_transactions_total{status="failed"}[5m])) /
            sum(rate(payment_transactions_total[5m])) > 0.05
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "High payment failure rate"
            description: "Payment failure rate is above 5%"
```

### Grafana Dashboard

Import dashboard from `docs/grafana-dashboard.json` for visualizations.

---

## CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/deploy.yaml
name: Deploy Payment Service

on:
  push:
    branches: [main]
    paths:
      - "services/payment-service/**"
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "pnpm"

      - run: pnpm install
      - run: pnpm --filter @ubi/payment-service test:coverage
      - run: pnpm --filter @ubi/payment-service typecheck

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: gcr.io
          username: _json_key
          password: ${{ secrets.GCP_SA_KEY }}

      - uses: docker/build-push-action@v5
        with:
          context: services/payment-service
          push: true
          tags: |
            gcr.io/ubi-africa/payment-service:${{ github.sha }}
            gcr.io/ubi-africa/payment-service:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - uses: google-github-actions/get-gke-credentials@v2
        with:
          cluster_name: ubi-cluster
          location: africa-south1

      - name: Deploy to Kubernetes
        run: |
          kubectl set image deployment/payment-service \
            payment-service=gcr.io/ubi-africa/payment-service:${{ github.sha }} \
            -n ubi-payments

          kubectl rollout status deployment/payment-service -n ubi-payments --timeout=300s
```

---

## Rollback Procedures

### Automatic Rollback

```bash
# If health checks fail, Kubernetes will not proceed
kubectl rollout status deployment/payment-service -n ubi-payments

# Manual rollback to previous version
kubectl rollout undo deployment/payment-service -n ubi-payments

# Rollback to specific revision
kubectl rollout undo deployment/payment-service -n ubi-payments --to-revision=5

# Check rollout history
kubectl rollout history deployment/payment-service -n ubi-payments
```

### Database Rollback

```bash
# Revert last migration
npx prisma migrate resolve --rolled-back "migration_name"

# Manual rollback script
psql $DATABASE_URL -f migrations/rollback_xxx.sql
```

---

## Health Checks

### Endpoints

| Endpoint        | Purpose          | Expected Response                            |
| --------------- | ---------------- | -------------------------------------------- |
| `/health`       | Liveness         | `{ status: 'ok' }`                           |
| `/health/ready` | Readiness        | `{ status: 'ready', db: true, redis: true }` |
| `/health/live`  | Kubernetes probe | `{ status: 'live' }`                         |

### Implementation

```typescript
// src/routes/health.ts
app.get("/health", async (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/health/ready", async (c) => {
  const dbHealthy = await checkDatabase();
  const redisHealthy = await checkRedis();

  if (!dbHealthy || !redisHealthy) {
    return c.json(
      { status: "not ready", db: dbHealthy, redis: redisHealthy },
      503,
    );
  }

  return c.json({ status: "ready", db: true, redis: true });
});
```

---

## Troubleshooting

### Common Issues

**1. Database Connection Errors**

```bash
# Check connection
kubectl exec -it payment-service-xxx -- pg_isready -h postgres-primary

# Check pool exhaustion
kubectl logs payment-service-xxx | grep "pool"
```

**2. Redis Connection Timeout**

```bash
# Check Redis cluster status
kubectl exec -it redis-cluster-0 -- redis-cli cluster info

# Check client connections
kubectl exec -it redis-cluster-0 -- redis-cli client list
```

**3. High Memory Usage**

```bash
# Check memory usage
kubectl top pods -n ubi-payments

# Get heap dump (if enabled)
kubectl exec -it payment-service-xxx -- node --inspect
```

**4. Provider Webhook Failures**

```bash
# Check webhook logs
kubectl logs -l app=payment-service -n ubi-payments | grep "webhook"

# Verify webhook secret
kubectl get secret payment-service-secrets -o jsonpath='{.data.PAYSTACK_WEBHOOK_SECRET}' | base64 -d
```

---

## Checklist

### Pre-deployment

- [ ] All tests passing
- [ ] Type checks passing
- [ ] Security scan clean
- [ ] Documentation updated
- [ ] Changelog updated

### Deployment

- [ ] Database migrations applied
- [ ] Config/secrets updated
- [ ] Image pushed to registry
- [ ] Deployment started
- [ ] Health checks passing

### Post-deployment

- [ ] Smoke tests passing
- [ ] Monitoring dashboards green
- [ ] No error spike in logs
- [ ] Payment flows verified
- [ ] Team notified
