# High Latency Investigation Runbook

## Overview

This runbook guides you through investigating and resolving high latency issues in the UBI platform.

**Severity:** SEV2-SEV3 depending on impact  
**Estimated Time:** 15-60 minutes  
**Last Updated:** 2024-01-15

## Prerequisites

- Access to Grafana dashboards
- `kubectl` access to the cluster
- AWS Console access (for RDS/ElastiCache metrics)

## Symptoms

- API response times > 500ms (p95)
- Increased timeout errors in logs
- User complaints about slow app
- Alertmanager alerts for latency SLO breach

## Triage Steps

### 1. Identify Scope (5 min)

**Check which services are affected:**

```bash
# Open Grafana dashboard
kubectl port-forward -n ubi-monitoring svc/prometheus-grafana 3000:80
# Navigate to: Dashboards > UBI > Service Overview
```

Questions to answer:

- [ ] Is this affecting all services or specific ones?
- [ ] Is this affecting all regions or specific ones?
- [ ] When did the latency increase start?
- [ ] Are there any correlated deployments?

### 2. Check Service Health (5 min)

```bash
# Check pod status
kubectl get pods -n ubi-apps -o wide

# Check for recent restarts
kubectl get pods -n ubi-apps --sort-by='.status.containerStatuses[0].restartCount' | tail -10

# Check HPA status (is it scaling?)
kubectl get hpa -n ubi-apps

# Check node resources
kubectl top nodes
kubectl top pods -n ubi-apps --sort-by=memory
```

### 3. Check Dependencies (10 min)

#### Database (RDS Aurora)

```bash
# Check RDS metrics in AWS Console or Grafana
# Key metrics:
# - CPUUtilization
# - DatabaseConnections
# - ReadLatency / WriteLatency
# - FreeableMemory
```

**High Database Latency Indicators:**

- CPU > 80%
- Connection count near max_connections
- High read/write latency
- Lock waits in slow query log

```sql
-- Check for long-running queries (connect to RDS)
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE (now() - pg_stat_activity.query_start) > interval '5 minutes'
ORDER BY duration DESC;

-- Check for table locks
SELECT * FROM pg_locks WHERE NOT granted;
```

#### Redis (ElastiCache)

```bash
# Key metrics to check:
# - CPUUtilization
# - CurrConnections
# - Evictions
# - CacheMisses
# - NetworkBytesIn/Out
```

**High Redis Latency Indicators:**

- Evictions occurring (memory pressure)
- High cache miss rate
- Network saturation

```bash
# Check Redis slow log
redis-cli -h $REDIS_HOST -a $REDIS_PASSWORD SLOWLOG GET 10
```

#### Kafka (MSK)

Check for:

- Consumer lag
- Broker CPU utilization
- UnderReplicatedPartitions

### 4. Check Network (5 min)

```bash
# Check for network policy issues
kubectl get networkpolicies -n ubi-apps

# Test service connectivity
kubectl run tmp-shell --rm -i --tty --image nicolaka/netshoot -- /bin/bash
# Inside shell:
curl -w "@curl-format.txt" -o /dev/null -s http://api-gateway.ubi-apps:3000/health
```

### 5. Check Application Logs (10 min)

```bash
# Get logs from affected service
kubectl logs -n ubi-apps deployment/api-gateway --tail=500 | grep -i "error\|warn\|timeout"

# Search Loki for error patterns
# In Grafana > Explore > Loki
# Query: {namespace="ubi-apps"} |= "timeout" | json
```

## Common Causes & Fixes

### 1. Database Connection Pool Exhaustion

**Symptoms:**

- `connection pool exhausted` errors in logs
- High database connections metric

**Fix:**

```bash
# Restart affected pods to reset connections
kubectl rollout restart deployment/user-service -n ubi-apps

# Long-term: Increase pool size in config
kubectl edit configmap user-service-config -n ubi-apps
# Increase DATABASE_POOL_SIZE
```

### 2. Memory Pressure

**Symptoms:**

- OOMKilled pods
- High memory usage
- Slow garbage collection

**Fix:**

```bash
# Check memory usage
kubectl top pods -n ubi-apps

# Increase memory limits if needed
kubectl patch deployment api-gateway -n ubi-apps -p '{"spec":{"template":{"spec":{"containers":[{"name":"api-gateway","resources":{"limits":{"memory":"1Gi"}}}]}}}}'

# Or scale horizontally
kubectl scale deployment api-gateway -n ubi-apps --replicas=5
```

### 3. Slow Database Queries

**Symptoms:**

- High read/write latency in RDS metrics
- Slow queries in logs

**Fix:**

```sql
-- Kill long-running queries
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE duration > interval '5 minutes' AND state = 'active';

-- Analyze query performance
EXPLAIN ANALYZE <slow_query>;
```

### 4. External Service Latency

**Symptoms:**

- Timeouts calling third-party APIs
- Circuit breakers tripping

**Fix:**

```bash
# Check if circuit breakers are open
kubectl logs -n ubi-apps deployment/payment-service | grep "circuit"

# Temporarily increase timeouts or disable feature
kubectl edit configmap payment-service-config -n ubi-apps
```

### 5. DNS Resolution Issues

**Symptoms:**

- Intermittent connection failures
- `SERVFAIL` or `NXDOMAIN` in logs

**Fix:**

```bash
# Check CoreDNS
kubectl get pods -n kube-system -l k8s-app=kube-dns
kubectl logs -n kube-system -l k8s-app=kube-dns --tail=100

# Restart CoreDNS if needed
kubectl rollout restart deployment/coredns -n kube-system
```

## Escalation

If unable to resolve within 30 minutes:

1. **SEV2:** Page Platform Lead
2. **SEV1:** Page Engineering Manager and CTO

## Post-Incident

1. [ ] Document timeline in incident channel
2. [ ] Verify latency has returned to normal
3. [ ] Update monitoring/alerting if gaps found
4. [ ] Schedule post-mortem if SEV1/SEV2
5. [ ] Create follow-up tickets for permanent fixes

## Related Dashboards

- [UBI Service Overview](http://grafana.ubi.internal/d/ubi-services)
- [Database Performance](http://grafana.ubi.internal/d/ubi-database)
- [Redis Metrics](http://grafana.ubi.internal/d/ubi-redis)
- [Kubernetes Cluster](http://grafana.ubi.internal/d/ubi-cluster)

## Related Runbooks

- [Service Outage Response](./service-outage.md)
- [Database Issues](./database-issues.md)
- [Scaling Procedures](../operations/scaling.md)
