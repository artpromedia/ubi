# UBI Runbooks

This directory contains operational runbooks for the UBI platform. These runbooks provide step-by-step instructions for common operational tasks and incident response procedures.

## Directory Structure

```
runbooks/
├── README.md                  # This file
├── incidents/                 # Incident response procedures
│   ├── high-latency.md       # Latency spike investigation
│   ├── service-outage.md     # Service outage response
│   ├── database-issues.md    # Database troubleshooting
│   └── security-incident.md  # Security incident response
├── operations/               # Day-to-day operations
│   ├── scaling.md           # Manual scaling procedures
│   ├── deployment.md        # Deployment procedures
│   ├── rollback.md          # Rollback procedures
│   └── secrets-rotation.md  # Secrets rotation
├── maintenance/             # Maintenance procedures
│   ├── database-maintenance.md
│   ├── cluster-upgrade.md
│   └── certificate-renewal.md
└── disaster-recovery/       # DR procedures
    ├── database-recovery.md
    ├── cluster-recovery.md
    └── regional-failover.md
```

## Quick Reference

### On-Call Contacts

| Role                | Contact        | Escalation Time |
| ------------------- | -------------- | --------------- |
| On-Call Engineer    | PagerDuty      | Immediate       |
| Platform Lead       | @platform-lead | 15 min          |
| Engineering Manager | @eng-manager   | 30 min          |
| CTO                 | @cto           | Critical only   |

### Common Commands

```bash
# Check cluster health
kubectl get nodes
kubectl top nodes
kubectl get pods -A | grep -v Running

# Check service status
kubectl get pods -n ubi-apps
kubectl logs -n ubi-apps deployment/api-gateway --tail=100

# Check recent events
kubectl get events -n ubi-apps --sort-by='.lastTimestamp' | tail -20

# Access Grafana
kubectl port-forward -n ubi-monitoring svc/prometheus-grafana 3000:80

# Access ArgoCD
kubectl port-forward -n argocd svc/argocd-server 8080:443
```

### Severity Levels

| Level | Description              | Response Time     | Example                  |
| ----- | ------------------------ | ----------------- | ------------------------ |
| SEV1  | Critical - Service down  | 15 min            | Complete platform outage |
| SEV2  | Major - Degraded service | 30 min            | Payment failures         |
| SEV3  | Minor - Limited impact   | 4 hours           | Single service slow      |
| SEV4  | Low - No customer impact | Next business day | Non-production issue     |

## Using Runbooks

1. **Identify the issue** - Use monitoring dashboards and alerts
2. **Find the relevant runbook** - Use the directory structure above
3. **Follow steps sequentially** - Don't skip steps
4. **Document actions taken** - Update incident timeline
5. **Escalate if needed** - Use the contacts above
6. **Post-incident** - Complete incident report

## Contributing

When updating runbooks:

1. Test procedures in staging first
2. Include rollback steps for any changes
3. Add time estimates for each step
4. Include relevant dashboard/log links
5. Get review from at least one other engineer
