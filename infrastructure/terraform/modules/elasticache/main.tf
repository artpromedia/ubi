# =============================================================================
# UBI ElastiCache Redis Module
# =============================================================================
# Creates a production-ready Redis cluster with:
# - Replication for high availability
# - Encryption at rest and in transit
# - Automatic failover
# - CloudWatch alarms
# =============================================================================

terraform {
  required_version = ">= 1.6.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# =============================================================================
# Local Variables
# =============================================================================

locals {
  common_tags = merge(var.tags, {
    Module      = "elasticache"
    ManagedBy   = "terraform"
    Environment = var.environment
  })
  
  port = 6379
}

# =============================================================================
# Subnet Group
# =============================================================================

resource "aws_elasticache_subnet_group" "main" {
  name        = "${var.name}-${var.environment}"
  description = "Subnet group for ${var.name} Redis cluster"
  subnet_ids  = var.subnet_ids
  
  tags = local.common_tags
}

# =============================================================================
# Security Group
# =============================================================================

resource "aws_security_group" "redis" {
  name_prefix = "${var.name}-redis-"
  description = "Security group for ${var.name} Redis cluster"
  vpc_id      = var.vpc_id
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-redis-sg"
  })
  
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "redis_ingress" {
  type              = "ingress"
  from_port         = local.port
  to_port           = local.port
  protocol          = "tcp"
  cidr_blocks       = var.allowed_cidr_blocks
  security_group_id = aws_security_group.redis.id
  description       = "Allow Redis access from allowed CIDRs"
}

resource "aws_security_group_rule" "redis_ingress_sg" {
  for_each = toset(var.allowed_security_groups)
  
  type                     = "ingress"
  from_port                = local.port
  to_port                  = local.port
  protocol                 = "tcp"
  source_security_group_id = each.value
  security_group_id        = aws_security_group.redis.id
  description              = "Allow Redis access from security group"
}

resource "aws_security_group_rule" "redis_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.redis.id
  description       = "Allow all outbound traffic"
}

# =============================================================================
# KMS Key for Encryption
# =============================================================================

resource "aws_kms_key" "redis" {
  count = var.kms_key_arn == null && var.at_rest_encryption_enabled ? 1 : 0
  
  description             = "KMS key for ${var.name} Redis cluster encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-redis-kms"
  })
}

resource "aws_kms_alias" "redis" {
  count = var.kms_key_arn == null && var.at_rest_encryption_enabled ? 1 : 0
  
  name          = "alias/${var.name}-${var.environment}-redis"
  target_key_id = aws_kms_key.redis[0].key_id
}

# =============================================================================
# Auth Token (Password)
# =============================================================================

resource "random_password" "auth_token" {
  count = var.auth_token == null && var.transit_encryption_enabled ? 1 : 0
  
  length           = 64
  special          = false # Redis AUTH token cannot have special characters
}

# Store auth token in Secrets Manager
resource "aws_secretsmanager_secret" "redis" {
  count = var.transit_encryption_enabled ? 1 : 0
  
  name_prefix = "${var.name}-${var.environment}-redis-"
  description = "Auth token for ${var.name} Redis cluster"
  kms_key_id  = var.at_rest_encryption_enabled ? (var.kms_key_arn != null ? var.kms_key_arn : aws_kms_key.redis[0].arn) : null
  
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "redis" {
  count = var.transit_encryption_enabled ? 1 : 0
  
  secret_id = aws_secretsmanager_secret.redis[0].id
  secret_string = jsonencode({
    auth_token             = var.auth_token != null ? var.auth_token : random_password.auth_token[0].result
    primary_endpoint       = aws_elasticache_replication_group.main.primary_endpoint_address
    reader_endpoint        = aws_elasticache_replication_group.main.reader_endpoint_address
    port                   = local.port
    connection_string_tls  = "rediss://:${var.auth_token != null ? var.auth_token : random_password.auth_token[0].result}@${aws_elasticache_replication_group.main.primary_endpoint_address}:${local.port}"
  })
}

# =============================================================================
# Parameter Group
# =============================================================================

resource "aws_elasticache_parameter_group" "main" {
  name        = "${var.name}-${var.environment}"
  family      = "redis${split(".", var.engine_version)[0]}"
  description = "Parameter group for ${var.name} Redis cluster"
  
  # Recommended parameters for UBI workloads
  parameter {
    name  = "maxmemory-policy"
    value = var.maxmemory_policy
  }
  
  parameter {
    name  = "notify-keyspace-events"
    value = "Ex" # Enable keyspace notifications for expired keys
  }
  
  dynamic "parameter" {
    for_each = var.parameters
    content {
      name  = parameter.value.name
      value = parameter.value.value
    }
  }
  
  tags = local.common_tags
  
  lifecycle {
    create_before_destroy = true
  }
}

# =============================================================================
# Redis Replication Group
# =============================================================================

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "${var.name}-${var.environment}"
  description          = "${var.name} Redis replication group"
  
  engine               = "redis"
  engine_version       = var.engine_version
  node_type            = var.node_type
  port                 = local.port
  parameter_group_name = aws_elasticache_parameter_group.main.name
  
  # Cluster configuration
  num_cache_clusters         = var.cluster_mode_enabled ? null : var.num_cache_clusters
  automatic_failover_enabled = var.num_cache_clusters > 1 || var.cluster_mode_enabled
  multi_az_enabled           = var.multi_az_enabled
  
  # Cluster mode (sharding)
  dynamic "num_node_groups" {
    for_each = var.cluster_mode_enabled ? [1] : []
    content {
    }
  }
  
  num_node_groups         = var.cluster_mode_enabled ? var.num_node_groups : null
  replicas_per_node_group = var.cluster_mode_enabled ? var.replicas_per_node_group : null
  
  # Network
  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]
  
  # Encryption
  at_rest_encryption_enabled = var.at_rest_encryption_enabled
  kms_key_id                 = var.at_rest_encryption_enabled ? (var.kms_key_arn != null ? var.kms_key_arn : aws_kms_key.redis[0].arn) : null
  transit_encryption_enabled = var.transit_encryption_enabled
  auth_token                 = var.transit_encryption_enabled ? (var.auth_token != null ? var.auth_token : random_password.auth_token[0].result) : null
  
  # Maintenance
  maintenance_window       = var.maintenance_window
  snapshot_window          = var.snapshot_window
  snapshot_retention_limit = var.snapshot_retention_limit
  
  # Auto minor version upgrade
  auto_minor_version_upgrade = var.auto_minor_version_upgrade
  
  apply_immediately = var.apply_immediately
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-${var.environment}"
  })
  
  lifecycle {
    ignore_changes = [auth_token]
  }
}

# =============================================================================
# CloudWatch Alarms
# =============================================================================

resource "aws_cloudwatch_metric_alarm" "cpu_utilization" {
  count = var.create_cloudwatch_alarms ? 1 : 0
  
  alarm_name          = "${var.name}-${var.environment}-redis-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "High CPU utilization on ${var.name} Redis cluster"
  
  dimensions = {
    CacheClusterId = aws_elasticache_replication_group.main.id
  }
  
  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns
  
  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "memory" {
  count = var.create_cloudwatch_alarms ? 1 : 0
  
  alarm_name          = "${var.name}-${var.environment}-redis-memory"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseMemoryUsagePercentage"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "High memory usage on ${var.name} Redis cluster"
  
  dimensions = {
    CacheClusterId = aws_elasticache_replication_group.main.id
  }
  
  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns
  
  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "evictions" {
  count = var.create_cloudwatch_alarms ? 1 : 0
  
  alarm_name          = "${var.name}-${var.environment}-redis-evictions"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Sum"
  threshold           = 100
  alarm_description   = "High evictions on ${var.name} Redis cluster"
  
  dimensions = {
    CacheClusterId = aws_elasticache_replication_group.main.id
  }
  
  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns
  
  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "curr_connections" {
  count = var.create_cloudwatch_alarms ? 1 : 0
  
  alarm_name          = "${var.name}-${var.environment}-redis-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CurrConnections"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = var.max_connections_threshold
  alarm_description   = "High connections on ${var.name} Redis cluster"
  
  dimensions = {
    CacheClusterId = aws_elasticache_replication_group.main.id
  }
  
  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns
  
  tags = local.common_tags
}
