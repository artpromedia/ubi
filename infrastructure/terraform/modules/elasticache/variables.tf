# =============================================================================
# ElastiCache Module Variables
# =============================================================================

variable "name" {
  description = "Name prefix for the Redis cluster"
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
  description = "List of subnet IDs for the subnet group"
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
  description = "Redis engine version"
  type        = string
  default     = "7.1"
}

variable "node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.r6g.large"
}

variable "num_cache_clusters" {
  description = "Number of cache clusters (nodes) for non-cluster mode"
  type        = number
  default     = 2
}

variable "cluster_mode_enabled" {
  description = "Enable cluster mode (sharding)"
  type        = bool
  default     = false
}

variable "num_node_groups" {
  description = "Number of node groups (shards) for cluster mode"
  type        = number
  default     = 2
}

variable "replicas_per_node_group" {
  description = "Number of replicas per node group for cluster mode"
  type        = number
  default     = 1
}

variable "multi_az_enabled" {
  description = "Enable Multi-AZ deployment"
  type        = bool
  default     = true
}

variable "at_rest_encryption_enabled" {
  description = "Enable encryption at rest"
  type        = bool
  default     = true
}

variable "transit_encryption_enabled" {
  description = "Enable encryption in transit (TLS)"
  type        = bool
  default     = true
}

variable "auth_token" {
  description = "Auth token (password) for Redis (auto-generated if not provided)"
  type        = string
  default     = null
  sensitive   = true
}

variable "kms_key_arn" {
  description = "ARN of KMS key for encryption (creates new if not provided)"
  type        = string
  default     = null
}

variable "maxmemory_policy" {
  description = "Redis maxmemory eviction policy"
  type        = string
  default     = "volatile-lru"
}

variable "parameters" {
  description = "Additional Redis parameters"
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

variable "maintenance_window" {
  description = "Weekly maintenance window"
  type        = string
  default     = "sun:05:00-sun:06:00"
}

variable "snapshot_window" {
  description = "Daily snapshot window"
  type        = string
  default     = "03:00-04:00"
}

variable "snapshot_retention_limit" {
  description = "Number of days to retain snapshots"
  type        = number
  default     = 7
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
  description = "Threshold for connections alarm"
  type        = number
  default     = 5000
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
