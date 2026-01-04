# Deployment Procedures Runbook

## Overview

This runbook covers standard deployment procedures for UBI services using ArgoCD and GitOps workflows.

**Estimated Time:** 10-30 minutes per service  
**Last Updated:** 2024-01-15

## Prerequisites

- GitHub repository write access
- ArgoCD access (viewer for monitoring, admin for manual sync)
- `kubectl` access (for verification)
- Slack notifications enabled

## Standard Deployment Flow

```
┌─────────────┐     ┌──────────┐     ┌─────────┐     ┌─────────┐
│   Commit    │ ──▶ │   CI     │ ──▶ │ ArgoCD  │ ──▶ │  K8s    │
│  to main    │     │  Build   │     │  Sync   │     │ Deploy  │
└─────────────┘     └──────────┘     └─────────┘     └─────────┘
```

## Deployment Types

### 1. Standard Service Deployment (Automated)

Services are automatically deployed when changes are merged to `main`:

1. **Developer workflow:**

   ```bash
   # Create feature branch
   git checkout -b feature/UBI-123-new-feature

   # Make changes
   # ...

   # Commit and push
   git add .
   git commit -m "feat(user-service): add phone verification"
   git push origin feature/UBI-123-new-feature

   # Create PR and get approval
   # Merge to main
   ```

2. **Automated deployment:**
   - CI builds and pushes new Docker image
   - ArgoCD detects new image tag
   - ArgoCD syncs deployment
   - Kubernetes performs rolling update

3. **Verify deployment:**

   ```bash
   # Check ArgoCD application status
   argocd app get user-service

   # Check pods are running
   kubectl get pods -n ubi-apps -l app.kubernetes.io/name=user-service

   # Check logs for errors
   kubectl logs -n ubi-apps -l app.kubernetes.io/name=user-service --tail=50
   ```

### 2. Infrastructure Deployment (Terraform)

For infrastructure changes:

1. **Create PR with Terraform changes:**

   ```bash
   cd infrastructure/terraform/environments/dev
   # Make changes to .tf files

   git checkout -b infra/UBI-456-increase-rds-size
   git add .
   git commit -m "chore(infra): increase RDS instance size"
   git push origin infra/UBI-456-increase-rds-size
   ```

2. **Review Terraform plan:**
   - CI automatically runs `terraform plan`
   - Plan is posted as PR comment
   - Review changes carefully

3. **Apply changes:**
   - Merge PR to main
   - CI runs `terraform apply` for dev
   - For staging/prod: use workflow dispatch

### 3. Hotfix Deployment (Expedited)

For critical fixes requiring expedited deployment:

1. **Create hotfix branch:**

   ```bash
   git checkout -b hotfix/critical-payment-bug main
   # Make minimal fix
   git commit -m "fix(payment): fix critical payment processing bug"
   git push origin hotfix/critical-payment-bug
   ```

2. **Get emergency approval:**
   - Request expedited review in #platform-emergencies
   - Get approval from on-call lead

3. **Merge and deploy:**

   ```bash
   # Merge hotfix
   gh pr merge --squash

   # Force sync if needed
   argocd app sync payment-service --prune
   ```

4. **Monitor closely:**

   ```bash
   # Watch deployment
   kubectl rollout status deployment/payment-service -n ubi-apps

   # Monitor logs
   kubectl logs -n ubi-apps -l app.kubernetes.io/name=payment-service -f
   ```

## Manual Deployment Steps

If automated deployment fails, use manual steps:

### Step 1: Build and Push Image

```bash
# Login to ECR
aws ecr get-login-password --region af-south-1 | docker login --username AWS --password-stdin $ECR_REGISTRY

# Build image
cd services/user-service
docker build -t $ECR_REGISTRY/ubi/user-service:$GIT_SHA .

# Push image
docker push $ECR_REGISTRY/ubi/user-service:$GIT_SHA
```

### Step 2: Update Image Tag

```bash
# Update kustomization with new image tag
cd infrastructure/kubernetes/services/user-service

# Edit kustomization.yaml to update newTag
vim kustomization.yaml

# Commit and push
git add kustomization.yaml
git commit -m "deploy: user-service $GIT_SHA"
git push origin main
```

### Step 3: Sync ArgoCD

```bash
# Login to ArgoCD
argocd login argocd.ubi.internal --sso

# Sync the application
argocd app sync user-service

# Wait for health
argocd app wait user-service --health --timeout 300
```

### Step 4: Verify Deployment

```bash
# Check deployment status
kubectl rollout status deployment/user-service -n ubi-apps

# Check pod status
kubectl get pods -n ubi-apps -l app.kubernetes.io/name=user-service

# Check service endpoints
kubectl get endpoints user-service -n ubi-apps

# Test health endpoint
kubectl run tmp-curl --rm -it --image=curlimages/curl -- \
  curl -s http://user-service.ubi-apps:3000/health
```

## Deployment Checklist

### Pre-Deployment

- [ ] Changes reviewed and approved
- [ ] All tests passing
- [ ] No blocking bugs in target services
- [ ] Rollback plan documented
- [ ] Database migrations (if any) reviewed

### During Deployment

- [ ] Deployment started
- [ ] Pod count at desired replicas
- [ ] No crash loops or OOMKills
- [ ] Health checks passing
- [ ] No error spike in logs

### Post-Deployment

- [ ] Verify functionality in deployed environment
- [ ] Check error rates in Grafana
- [ ] Check latency metrics
- [ ] Run smoke tests
- [ ] Update deployment log in Slack

## Rollback Procedures

See [Rollback Runbook](./rollback.md) for detailed rollback procedures.

**Quick rollback:**

```bash
# Rollback to previous revision
argocd app rollback user-service

# Or using kubectl
kubectl rollout undo deployment/user-service -n ubi-apps
```

## Environment-Specific Notes

### Development (dev)

- Auto-deploys on merge to `main`
- Lower resource limits
- Can be deployed during business hours

### Staging

- Requires manual workflow dispatch
- Production-like resources
- Deploy after dev verification

### Production

- Requires manual workflow dispatch
- Requires approval from platform lead
- Deploy during low-traffic windows (02:00-06:00 UTC)
- Always have on-call engineer available

## Monitoring Deployment

### Grafana Dashboard

Navigate to: Dashboards > UBI > Deployments

Key metrics to watch:

- Pod restart count
- Error rate (5xx responses)
- Response latency (p95, p99)
- Memory/CPU usage

### ArgoCD UI

- Application health status
- Sync status
- Resource tree
- Events log

## Troubleshooting

### Deployment Stuck

```bash
# Check ArgoCD sync status
argocd app get user-service

# Check for pending resources
kubectl get pods -n ubi-apps -l app.kubernetes.io/name=user-service

# Check events
kubectl describe pod -n ubi-apps -l app.kubernetes.io/name=user-service
```

### Image Pull Failures

```bash
# Check ECR permissions
aws ecr describe-images --repository-name ubi/user-service

# Check node can pull
kubectl describe pod <pod-name> -n ubi-apps | grep -A5 "Events"
```

### Health Check Failures

```bash
# Check probe configuration
kubectl describe deployment user-service -n ubi-apps | grep -A10 "Liveness\|Readiness"

# Test health endpoint manually
kubectl exec -it <pod-name> -n ubi-apps -- wget -qO- localhost:3000/health
```

## Related Runbooks

- [Rollback Procedures](./rollback.md)
- [Scaling Procedures](./scaling.md)
- [High Latency Investigation](../incidents/high-latency.md)
