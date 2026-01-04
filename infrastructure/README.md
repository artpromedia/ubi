# UBI Infrastructure

Production-grade infrastructure for UBI, an African mobility super-app.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              UBI Infrastructure                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐           │
│  │   CloudFront    │     │    Route 53     │     │      WAF        │           │
│  │   (CDN/Edge)    │     │     (DNS)       │     │   (Security)    │           │
│  └────────┬────────┘     └────────┬────────┘     └────────┬────────┘           │
│           │                       │                       │                     │
│           └───────────────────────┼───────────────────────┘                     │
│                                   │                                              │
│  ┌────────────────────────────────▼──────────────────────────────────────────┐  │
│  │                         AWS af-south-1 (Cape Town)                         │  │
│  │  ┌──────────────────────────────────────────────────────────────────────┐ │  │
│  │  │                    Production VPC (10.0.0.0/16)                       │ │  │
│  │  │                                                                       │ │  │
│  │  │  ┌─────────────────────────────────────────────────────────────────┐ │ │  │
│  │  │  │                    Public Subnets (10.0.0.0/20)                  │ │ │  │
│  │  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │ │ │  │
│  │  │  │  │   NAT    │  │   NAT    │  │   ALB    │  │     Bastion      │ │ │ │  │
│  │  │  │  │Gateway-A │  │Gateway-B │  │(Ingress) │  │     Host         │ │ │ │  │
│  │  │  │  └──────────┘  └──────────┘  └──────────┘  └──────────────────┘ │ │ │  │
│  │  │  └─────────────────────────────────────────────────────────────────┘ │ │  │
│  │  │                                                                       │ │  │
│  │  │  ┌─────────────────────────────────────────────────────────────────┐ │ │  │
│  │  │  │                 Private App Subnets (10.0.16.0/20)              │ │ │  │
│  │  │  │  ┌────────────────────────────────────────────────────────────┐ │ │ │  │
│  │  │  │  │                     EKS Cluster                             │ │ │ │  │
│  │  │  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │ │ │ │  │
│  │  │  │  │  │  API GW  │ │  User    │ │  Ride    │ │    Food      │  │ │ │ │  │
│  │  │  │  │  │  Service │ │ Service  │ │ Service  │ │   Service    │  │ │ │ │  │
│  │  │  │  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │ │ │ │  │
│  │  │  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │ │ │ │  │
│  │  │  │  │  │ Delivery │ │ Payment  │ │Notifica- │ │   CEERION    │  │ │ │ │  │
│  │  │  │  │  │ Service  │ │ Service  │ │  tion    │ │   Service    │  │ │ │ │  │
│  │  │  │  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │ │ │ │  │
│  │  │  │  │                     Istio Service Mesh                     │ │ │ │  │
│  │  │  │  └────────────────────────────────────────────────────────────┘ │ │ │  │
│  │  │  └─────────────────────────────────────────────────────────────────┘ │ │  │
│  │  │                                                                       │ │  │
│  │  │  ┌─────────────────────────────────────────────────────────────────┐ │ │  │
│  │  │  │                 Private Data Subnets (10.0.32.0/20)             │ │ │  │
│  │  │  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │ │ │  │
│  │  │  │  │  Aurora   │ │  Redis   │ │  Kafka   │ │   OpenSearch     │  │ │ │  │
│  │  │  │  │PostgreSQL │ │ Cluster  │ │  (MSK)   │ │    Cluster       │  │ │ │  │
│  │  │  │  │  (RDS)    │ │(Elasti-  │ │          │ │                  │  │ │ │  │
│  │  │  │  │           │ │ Cache)   │ │          │ │                  │  │ │ │  │
│  │  │  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘  │ │ │  │
│  │  │  └─────────────────────────────────────────────────────────────────┘ │ │  │
│  │  │                                                                       │ │  │
│  │  └──────────────────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
infrastructure/
├── terraform/
│   ├── modules/                    # Reusable Terraform modules
│   │   ├── vpc/                    # VPC, subnets, NAT, routing
│   │   ├── eks/                    # EKS cluster, node groups
│   │   ├── rds/                    # Aurora PostgreSQL
│   │   ├── elasticache/            # Redis cluster
│   │   ├── msk/                    # Kafka cluster
│   │   ├── opensearch/             # OpenSearch/Elasticsearch
│   │   ├── s3/                     # S3 buckets
│   │   ├── cloudfront/             # CDN distributions
│   │   └── monitoring/             # CloudWatch, alarms
│   ├── environments/               # Environment-specific configs
│   │   ├── dev/
│   │   ├── staging/
│   │   └── prod/
│   └── global/                     # Global resources
│       ├── iam/
│       ├── route53/
│       └── acm/
├── kubernetes/
│   ├── base/                       # Kustomize base configs
│   │   ├── namespaces/
│   │   ├── services/
│   │   └── rbac/
│   ├── overlays/                   # Environment overlays
│   │   ├── dev/
│   │   ├── staging/
│   │   └── prod/
│   └── addons/                     # Cluster addons
│       ├── istio/
│       ├── prometheus/
│       ├── argocd/
│       └── external-secrets/
├── argocd/                         # ArgoCD applications
│   ├── apps/
│   └── projects/
├── monitoring/                     # Dashboards and alerts
│   ├── dashboards/
│   └── alerts/
├── scripts/                        # Operational scripts
│   ├── setup/
│   ├── backup/
│   └── disaster-recovery/
└── docs/                           # Documentation
    ├── runbooks/
    ├── architecture/
    └── onboarding/
```

## Quick Start

### Prerequisites

- AWS CLI configured with appropriate credentials
- Terraform >= 1.6.0
- kubectl
- helm
- argocd CLI

### Deploy Infrastructure

```bash
# 1. Initialize Terraform
cd terraform/environments/dev
terraform init

# 2. Plan changes
terraform plan -out=tfplan

# 3. Apply changes
terraform apply tfplan

# 4. Configure kubectl
aws eks update-kubeconfig --name ubi-dev --region af-south-1

# 5. Install cluster addons
kubectl apply -k ../../../kubernetes/addons/

# 6. Deploy applications via ArgoCD
kubectl apply -f ../../../argocd/apps/
```

## Environments

| Environment | Region     | Purpose                   | Auto-Deploy |
| ----------- | ---------- | ------------------------- | ----------- |
| dev         | af-south-1 | Development/testing       | Yes (main)  |
| staging     | af-south-1 | Pre-production validation | Manual      |
| prod        | af-south-1 | Production                | Manual      |

## Cost Estimates (Monthly)

| Component         | Dev   | Staging | Prod    |
| ----------------- | ----- | ------- | ------- |
| EKS Control Plane | $72   | $72     | $72     |
| EKS Nodes         | $150  | $300    | $1,200  |
| RDS Aurora        | $100  | $200    | $800    |
| ElastiCache Redis | $50   | $100    | $400    |
| MSK Kafka         | $0\*  | $300    | $600    |
| S3 + CloudFront   | $20   | $50     | $200    |
| NAT Gateway       | $100  | $100    | $200    |
| **Total**         | ~$500 | ~$1,100 | ~$3,500 |

\*Dev uses Redis for messaging instead of Kafka

## Security

- All traffic encrypted in transit (TLS 1.3)
- Data encrypted at rest (AES-256)
- IAM roles for service accounts (IRSA)
- Network policies restrict pod-to-pod traffic
- WAF protects all public endpoints
- Secrets managed via AWS Secrets Manager

## Monitoring

- **Metrics**: Prometheus + Grafana
- **Logs**: Fluent Bit → OpenSearch → Kibana
- **Traces**: OpenTelemetry → Jaeger
- **Alerts**: PagerDuty integration

## Support

- **On-call rotation**: See PagerDuty
- **Runbooks**: [docs/runbooks/](./docs/runbooks/)
- **Escalation**: #platform-oncall Slack channel
