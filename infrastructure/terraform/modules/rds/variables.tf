# =============================================================================
# RDS Module Variables
# =============================================================================

variable "name" {
  description = "Name prefix for the Aurora cluster"
  type        = string
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where the cluster will be created"
  type        = string
}

variable "subnet_ids" {
  description = "List of subnet IDs for the DB subnet group"
  type        = list(string)
}

variable "allowed_cidr_blocks" {
  description = "List of CIDR blocks allowed to access the cluster"
  type        = list(string)
  default     = []
}

variable "allowed_security_groups" {
  description = "List of security group IDs allowed to access the cluster"
  type        = list(string)
  default     = []
}

variable "engine_version" {
  description = "Aurora PostgreSQL engine version"
  type        = string
  default     = "15.4"
}

variable "database_name" {
  description = "Name of the default database"
  type        = string
  default     = "ubi"
}

variable "master_username" {
  description = "Master username for the cluster"
  type        = string
  default     = "ubi_admin"
}

variable "master_password" {
  description = "Master password (auto-generated if not provided)"
  type        = string
  default     = null
  sensitive   = true
}

variable "instance_count" {
  description = "Number of Aurora instances"
  type        = number
  default     = 2
}

variable "instance_class" {
  description = "Instance class for Aurora instances"
  type        = string
  default     = "db.r6g.large"
}

variable "serverless_enabled" {
  description = "Enable Aurora Serverless v2"
  type        = bool
  default     = false
}

variable "serverless_min_capacity" {
  description = "Minimum ACU capacity for serverless"
  type        = number
  default     = 0.5
}

variable "serverless_max_capacity" {
  description = "Maximum ACU capacity for serverless"
  type        = number
  default     = 16
}

variable "backup_retention_period" {
  description = "Days to retain automated backups"
  type        = number
  default     = 7
}

variable "preferred_backup_window" {
  description = "Daily time range for automated backups"
  type        = string
  default     = "02:00-03:00"
}

variable "preferred_maintenance_window" {
  description = "Weekly time range for maintenance"
  type        = string
  default     = "sun:04:00-sun:05:00"
}

variable "skip_final_snapshot" {
  description = "Skip final snapshot on deletion"
  type        = bool
  default     = false
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = true
}

variable "kms_key_arn" {
  description = "ARN of KMS key for encryption (creates new if not provided)"
  type        = string
  default     = null
}

variable "performance_insights_enabled" {
  description = "Enable Performance Insights"
  type        = bool
  default     = true
}

variable "performance_insights_retention" {
  description = "Performance Insights retention period in days"
  type        = number
  default     = 7
}

variable "monitoring_interval" {
  description = "Enhanced monitoring interval in seconds (0 to disable)"
  type        = number
  default     = 60
}

variable "auto_minor_version_upgrade" {
  description = "Enable auto minor version upgrade"
  type        = bool
  default     = true
}

variable "apply_immediately" {
  description = "Apply changes immediately or during maintenance window"
  type        = bool
  default     = false
}

variable "iam_auth_enabled" {
  description = "Enable IAM database authentication"
  type        = bool
  default     = true
}

variable "cluster_parameters" {
  description = "List of cluster parameter group parameters"
  type = list(object({
    name         = string
    value        = string
    apply_method = optional(string, "immediate")
  }))
  default = []
}

variable "instance_parameters" {
  description = "List of instance parameter group parameters"
  type = list(object({
    name         = string
    value        = string
    apply_method = optional(string, "immediate")
  }))
  default = []
}

variable "create_cloudwatch_alarms" {
  description = "Create CloudWatch alarms for the cluster"
  type        = bool
  default     = true
}

variable "alarm_sns_topic_arns" {
  description = "SNS topic ARNs for CloudWatch alarms"
  type        = list(string)
  default     = []
}

variable "max_connections_threshold" {
  description = "Threshold for database connections alarm"
  type        = number
  default     = 100
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
