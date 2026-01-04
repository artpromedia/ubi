# =============================================================================
# UBI Development Environment
# =============================================================================
# This configuration creates a cost-optimized development environment
# with all necessary infrastructure components.
# =============================================================================

terraform {
  required_version = ">= 1.6.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  
  backend "s3" {
    bucket         = "ubi-terraform-state"
    key            = "environments/dev/terraform.tfstate"
    region         = "af-south-1"
    encrypt        = true
    dynamodb_table = "ubi-terraform-locks"
  }
}

# =============================================================================
# Provider Configuration
# =============================================================================

provider "aws" {
  region = var.region
  
  default_tags {
    tags = {
      Project     = "UBI"
      Environment = var.environment
      ManagedBy   = "terraform"
      CostCenter  = "development"
    }
  }
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
  
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)
    
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
    }
  }
}

# =============================================================================
# Data Sources
# =============================================================================

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# =============================================================================
# Local Variables
# =============================================================================

locals {
  name         = "ubi"
  environment  = "dev"
  cluster_name = "${local.name}-${local.environment}"
  
  # Use first 3 AZs
  azs = slice(data.aws_availability_zones.available.names, 0, 3)
  
  common_tags = {
    Project     = "UBI"
    Environment = local.environment
    ManagedBy   = "terraform"
  }
}

# =============================================================================
# VPC Module
# =============================================================================

module "vpc" {
  source = "../../modules/vpc"
  
  name               = local.name
  environment        = local.environment
  region             = var.region
  vpc_cidr           = "10.0.0.0/16"
  availability_zones = local.azs
  cluster_name       = local.cluster_name
  
  # Cost optimization: single NAT gateway for dev
  single_nat_gateway = true
  
  enable_flow_logs        = true
  flow_logs_retention_days = 7
  
  enable_vpc_endpoints = true
  
  tags = local.common_tags
}

# =============================================================================
# EKS Module
# =============================================================================

module "eks" {
  source = "../../modules/eks"
  
  cluster_name    = local.cluster_name
  cluster_version = "1.29"
  environment     = local.environment
  
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_app_subnet_ids
  
  # Enable public access for dev (restrict in prod)
  enable_public_access = true
  public_access_cidrs  = var.developer_cidrs
  
  # Smaller log retention for dev
  log_retention_days = 7
  enabled_log_types  = ["api", "audit"]
  
  # Cost-optimized node groups for dev
  node_groups = {
    general = {
      instance_types = ["t3.medium", "t3a.medium"]
      capacity_type  = "SPOT" # Use spot instances for dev
      desired_size   = 2
      min_size       = 1
      max_size       = 5
      labels = {
        workload = "general"
      }
      taints = []
    }
  }
  
  # Developer access
  aws_auth_roles = var.developer_roles
  aws_auth_users = var.developer_users
  
  tags = local.common_tags
}

# =============================================================================
# RDS Module (Aurora PostgreSQL)
# =============================================================================

module "rds" {
  source = "../../modules/rds"
  
  name        = local.name
  environment = local.environment
  
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_data_subnet_ids
  
  allowed_security_groups = [module.eks.node_security_group_id]
  allowed_cidr_blocks     = module.vpc.private_app_subnet_cidrs
  
  # Cost-optimized settings for dev
  engine_version = "15.4"
  
  # Use serverless for dev (pay only for what you use)
  serverless_enabled      = true
  serverless_min_capacity = 0.5
  serverless_max_capacity = 4
  instance_count          = 1
  
  database_name   = "ubi"
  master_username = "ubi_admin"
  
  # Relaxed settings for dev
  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false
  apply_immediately       = true
  
  # Enable monitoring but with lower overhead
  performance_insights_enabled   = true
  performance_insights_retention = 7
  monitoring_interval            = 0 # Disable enhanced monitoring for cost
  
  create_cloudwatch_alarms = false
  
  tags = local.common_tags
}

# =============================================================================
# ElastiCache Module (Redis)
# =============================================================================

module "elasticache" {
  source = "../../modules/elasticache"
  
  name        = local.name
  environment = local.environment
  
  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_data_subnet_ids
  
  allowed_security_groups = [module.eks.node_security_group_id]
  allowed_cidr_blocks     = module.vpc.private_app_subnet_cidrs
  
  # Cost-optimized settings for dev
  engine_version = "7.1"
  node_type      = "cache.t4g.small"
  
  # Single node for dev
  num_cache_clusters = 1
  multi_az_enabled   = false
  
  # Enable security
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  
  snapshot_retention_limit = 1
  
  create_cloudwatch_alarms = false
  
  tags = local.common_tags
}

# =============================================================================
# S3 Buckets
# =============================================================================

resource "aws_s3_bucket" "assets" {
  bucket = "${local.name}-${local.environment}-assets-${data.aws_caller_identity.current.account_id}"
  
  tags = merge(local.common_tags, {
    Name = "${local.name}-${local.environment}-assets"
  })
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket = aws_s3_bucket.assets.id
  
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# =============================================================================
# SNS Topics for Alerts
# =============================================================================

resource "aws_sns_topic" "alerts" {
  name = "${local.name}-${local.environment}-alerts"
  
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count = length(var.alert_emails)
  
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_emails[count.index]
}

# =============================================================================
# Outputs
# =============================================================================

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS cluster endpoint"
  value       = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  description = "RDS cluster endpoint"
  value       = module.rds.cluster_endpoint
}

output "rds_secret_arn" {
  description = "ARN of the RDS credentials secret"
  value       = module.rds.secret_arn
}

output "redis_endpoint" {
  description = "Redis primary endpoint"
  value       = module.elasticache.primary_endpoint_address
}

output "redis_secret_arn" {
  description = "ARN of the Redis auth token secret"
  value       = module.elasticache.secret_arn
}

output "assets_bucket" {
  description = "S3 bucket for assets"
  value       = aws_s3_bucket.assets.bucket
}

output "kubeconfig_command" {
  description = "Command to update kubeconfig"
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${module.eks.cluster_name}"
}
