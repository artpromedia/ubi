# =============================================================================
# UBI Aurora PostgreSQL RDS Module
# =============================================================================
# Creates a production-ready Aurora PostgreSQL cluster with:
# - Multi-AZ deployment for high availability
# - Read replicas for read scaling
# - Automated backups and snapshots
# - Encryption at rest and in transit
# - Performance Insights enabled
# - Enhanced monitoring
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
    Module      = "rds"
    ManagedBy   = "terraform"
    Environment = var.environment
  })
  
  port = 5432
}

# =============================================================================
# DB Subnet Group
# =============================================================================

resource "aws_db_subnet_group" "main" {
  name        = "${var.name}-${var.environment}"
  description = "Subnet group for ${var.name} Aurora cluster"
  subnet_ids  = var.subnet_ids
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-${var.environment}"
  })
}

# =============================================================================
# Security Group
# =============================================================================

resource "aws_security_group" "rds" {
  name_prefix = "${var.name}-rds-"
  description = "Security group for ${var.name} Aurora cluster"
  vpc_id      = var.vpc_id
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-rds-sg"
  })
  
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group_rule" "rds_ingress" {
  type              = "ingress"
  from_port         = local.port
  to_port           = local.port
  protocol          = "tcp"
  cidr_blocks       = var.allowed_cidr_blocks
  security_group_id = aws_security_group.rds.id
  description       = "Allow PostgreSQL access from allowed CIDRs"
}

resource "aws_security_group_rule" "rds_ingress_sg" {
  for_each = toset(var.allowed_security_groups)
  
  type                     = "ingress"
  from_port                = local.port
  to_port                  = local.port
  protocol                 = "tcp"
  source_security_group_id = each.value
  security_group_id        = aws_security_group.rds.id
  description              = "Allow PostgreSQL access from security group"
}

resource "aws_security_group_rule" "rds_egress" {
  type              = "egress"
  from_port         = 0
  to_port           = 0
  protocol          = "-1"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = aws_security_group.rds.id
  description       = "Allow all outbound traffic"
}

# =============================================================================
# KMS Key for Encryption
# =============================================================================

resource "aws_kms_key" "rds" {
  count = var.kms_key_arn == null ? 1 : 0
  
  description             = "KMS key for ${var.name} Aurora cluster encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-rds-kms"
  })
}

resource "aws_kms_alias" "rds" {
  count = var.kms_key_arn == null ? 1 : 0
  
  name          = "alias/${var.name}-${var.environment}-rds"
  target_key_id = aws_kms_key.rds[0].key_id
}

# =============================================================================
# Random Password Generation
# =============================================================================

resource "random_password" "master" {
  count = var.master_password == null ? 1 : 0
  
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# =============================================================================
# Secrets Manager for Credentials
# =============================================================================

resource "aws_secretsmanager_secret" "rds" {
  name_prefix = "${var.name}-${var.environment}-rds-"
  description = "Master credentials for ${var.name} Aurora cluster"
  kms_key_id  = var.kms_key_arn != null ? var.kms_key_arn : aws_kms_key.rds[0].arn
  
  tags = local.common_tags
}

resource "aws_secretsmanager_secret_version" "rds" {
  secret_id = aws_secretsmanager_secret.rds.id
  secret_string = jsonencode({
    username = var.master_username
    password = var.master_password != null ? var.master_password : random_password.master[0].result
    host     = aws_rds_cluster.main.endpoint
    port     = local.port
    dbname   = var.database_name
    engine   = "aurora-postgresql"
  })
}

# =============================================================================
# DB Parameter Groups
# =============================================================================

resource "aws_rds_cluster_parameter_group" "main" {
  name_prefix = "${var.name}-cluster-"
  family      = "aurora-postgresql${split(".", var.engine_version)[0]}"
  description = "Cluster parameter group for ${var.name}"
  
  dynamic "parameter" {
    for_each = var.cluster_parameters
    content {
      name         = parameter.value.name
      value        = parameter.value.value
      apply_method = lookup(parameter.value, "apply_method", "immediate")
    }
  }
  
  # Recommended UBI-specific parameters
  parameter {
    name  = "log_statement"
    value = "ddl"
  }
  
  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # Log queries longer than 1s
  }
  
  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements"
  }
  
  tags = local.common_tags
  
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_parameter_group" "main" {
  name_prefix = "${var.name}-instance-"
  family      = "aurora-postgresql${split(".", var.engine_version)[0]}"
  description = "Instance parameter group for ${var.name}"
  
  dynamic "parameter" {
    for_each = var.instance_parameters
    content {
      name         = parameter.value.name
      value        = parameter.value.value
      apply_method = lookup(parameter.value, "apply_method", "immediate")
    }
  }
  
  tags = local.common_tags
  
  lifecycle {
    create_before_destroy = true
  }
}

# =============================================================================
# IAM Role for Enhanced Monitoring
# =============================================================================

resource "aws_iam_role" "rds_monitoring" {
  count = var.monitoring_interval > 0 ? 1 : 0
  
  name_prefix = "${var.name}-rds-monitoring-"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })
  
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  count = var.monitoring_interval > 0 ? 1 : 0
  
  role       = aws_iam_role.rds_monitoring[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# =============================================================================
# Aurora Cluster
# =============================================================================

resource "aws_rds_cluster" "main" {
  cluster_identifier = "${var.name}-${var.environment}"
  
  engine         = "aurora-postgresql"
  engine_version = var.engine_version
  engine_mode    = "provisioned"
  
  database_name   = var.database_name
  master_username = var.master_username
  master_password = var.master_password != null ? var.master_password : random_password.master[0].result
  
  db_subnet_group_name            = aws_db_subnet_group.main.name
  vpc_security_group_ids          = [aws_security_group.rds.id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.main.name
  
  port = local.port
  
  storage_encrypted = true
  kms_key_id        = var.kms_key_arn != null ? var.kms_key_arn : aws_kms_key.rds[0].arn
  
  backup_retention_period      = var.backup_retention_period
  preferred_backup_window      = var.preferred_backup_window
  preferred_maintenance_window = var.preferred_maintenance_window
  
  skip_final_snapshot       = var.skip_final_snapshot
  final_snapshot_identifier = var.skip_final_snapshot ? null : "${var.name}-${var.environment}-final"
  copy_tags_to_snapshot     = true
  
  deletion_protection = var.deletion_protection
  
  enabled_cloudwatch_logs_exports = ["postgresql"]
  
  # Serverless v2 configuration
  dynamic "serverlessv2_scaling_configuration" {
    for_each = var.serverless_enabled ? [1] : []
    content {
      min_capacity = var.serverless_min_capacity
      max_capacity = var.serverless_max_capacity
    }
  }
  
  iam_database_authentication_enabled = var.iam_auth_enabled
  
  apply_immediately = var.apply_immediately
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-${var.environment}"
  })
  
  lifecycle {
    ignore_changes = [master_password]
  }
}

# =============================================================================
# Aurora Cluster Instances
# =============================================================================

resource "aws_rds_cluster_instance" "main" {
  count = var.instance_count
  
  identifier         = "${var.name}-${var.environment}-${count.index}"
  cluster_identifier = aws_rds_cluster.main.id
  
  engine         = aws_rds_cluster.main.engine
  engine_version = aws_rds_cluster.main.engine_version
  
  instance_class = var.serverless_enabled ? "db.serverless" : var.instance_class
  
  db_subnet_group_name    = aws_db_subnet_group.main.name
  db_parameter_group_name = aws_db_parameter_group.main.name
  
  publicly_accessible = false
  
  performance_insights_enabled          = var.performance_insights_enabled
  performance_insights_kms_key_id       = var.performance_insights_enabled ? (var.kms_key_arn != null ? var.kms_key_arn : aws_kms_key.rds[0].arn) : null
  performance_insights_retention_period = var.performance_insights_enabled ? var.performance_insights_retention : null
  
  monitoring_interval = var.monitoring_interval
  monitoring_role_arn = var.monitoring_interval > 0 ? aws_iam_role.rds_monitoring[0].arn : null
  
  auto_minor_version_upgrade = var.auto_minor_version_upgrade
  
  promotion_tier = count.index
  
  apply_immediately = var.apply_immediately
  
  tags = merge(local.common_tags, {
    Name = "${var.name}-${var.environment}-${count.index}"
  })
}

# =============================================================================
# CloudWatch Alarms
# =============================================================================

resource "aws_cloudwatch_metric_alarm" "cpu_utilization" {
  count = var.create_cloudwatch_alarms ? 1 : 0
  
  alarm_name          = "${var.name}-${var.environment}-cpu-utilization"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "High CPU utilization on ${var.name} Aurora cluster"
  
  dimensions = {
    DBClusterIdentifier = aws_rds_cluster.main.cluster_identifier
  }
  
  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns
  
  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "database_connections" {
  count = var.create_cloudwatch_alarms ? 1 : 0
  
  alarm_name          = "${var.name}-${var.environment}-database-connections"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = var.max_connections_threshold
  alarm_description   = "High database connections on ${var.name} Aurora cluster"
  
  dimensions = {
    DBClusterIdentifier = aws_rds_cluster.main.cluster_identifier
  }
  
  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns
  
  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "freeable_memory" {
  count = var.create_cloudwatch_alarms ? 1 : 0
  
  alarm_name          = "${var.name}-${var.environment}-freeable-memory"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 3
  metric_name         = "FreeableMemory"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 256 * 1024 * 1024 # 256MB
  alarm_description   = "Low freeable memory on ${var.name} Aurora cluster"
  
  dimensions = {
    DBClusterIdentifier = aws_rds_cluster.main.cluster_identifier
  }
  
  alarm_actions = var.alarm_sns_topic_arns
  ok_actions    = var.alarm_sns_topic_arns
  
  tags = local.common_tags
}
