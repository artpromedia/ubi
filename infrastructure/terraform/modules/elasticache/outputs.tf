# =============================================================================
# ElastiCache Module Outputs
# =============================================================================

output "replication_group_id" {
  description = "Redis replication group ID"
  value       = aws_elasticache_replication_group.main.id
}

output "replication_group_arn" {
  description = "Redis replication group ARN"
  value       = aws_elasticache_replication_group.main.arn
}

output "primary_endpoint_address" {
  description = "Primary endpoint address"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "reader_endpoint_address" {
  description = "Reader endpoint address"
  value       = aws_elasticache_replication_group.main.reader_endpoint_address
}

output "configuration_endpoint_address" {
  description = "Configuration endpoint address (cluster mode only)"
  value       = aws_elasticache_replication_group.main.configuration_endpoint_address
}

output "port" {
  description = "Redis port"
  value       = local.port
}

output "security_group_id" {
  description = "Security group ID for the cluster"
  value       = aws_security_group.redis.id
}

output "subnet_group_name" {
  description = "Name of the subnet group"
  value       = aws_elasticache_subnet_group.main.name
}

output "parameter_group_name" {
  description = "Name of the parameter group"
  value       = aws_elasticache_parameter_group.main.name
}

output "secret_arn" {
  description = "ARN of the Secrets Manager secret containing auth token"
  value       = var.transit_encryption_enabled ? aws_secretsmanager_secret.redis[0].arn : null
}

output "secret_name" {
  description = "Name of the Secrets Manager secret"
  value       = var.transit_encryption_enabled ? aws_secretsmanager_secret.redis[0].name : null
}

output "kms_key_arn" {
  description = "ARN of the KMS key used for encryption"
  value       = var.at_rest_encryption_enabled ? (var.kms_key_arn != null ? var.kms_key_arn : try(aws_kms_key.redis[0].arn, null)) : null
}

# Connection strings for different use cases
output "connection_url" {
  description = "Redis connection URL (non-TLS)"
  value       = "redis://${aws_elasticache_replication_group.main.primary_endpoint_address}:${local.port}"
}

output "connection_url_tls" {
  description = "Redis connection URL (TLS)"
  value       = var.transit_encryption_enabled ? "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:${local.port}" : null
}
