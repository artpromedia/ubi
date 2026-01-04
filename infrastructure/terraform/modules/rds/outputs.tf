# =============================================================================
# RDS Module Outputs
# =============================================================================

output "cluster_id" {
  description = "Aurora cluster identifier"
  value       = aws_rds_cluster.main.id
}

output "cluster_identifier" {
  description = "Aurora cluster identifier"
  value       = aws_rds_cluster.main.cluster_identifier
}

output "cluster_arn" {
  description = "Aurora cluster ARN"
  value       = aws_rds_cluster.main.arn
}

output "cluster_endpoint" {
  description = "Writer endpoint for the cluster"
  value       = aws_rds_cluster.main.endpoint
}

output "cluster_reader_endpoint" {
  description = "Reader endpoint for the cluster"
  value       = aws_rds_cluster.main.reader_endpoint
}

output "cluster_port" {
  description = "Database port"
  value       = aws_rds_cluster.main.port
}

output "database_name" {
  description = "Name of the default database"
  value       = aws_rds_cluster.main.database_name
}

output "master_username" {
  description = "Master username"
  value       = aws_rds_cluster.main.master_username
  sensitive   = true
}

output "security_group_id" {
  description = "Security group ID for the cluster"
  value       = aws_security_group.rds.id
}

output "db_subnet_group_name" {
  description = "Name of the DB subnet group"
  value       = aws_db_subnet_group.main.name
}

output "secret_arn" {
  description = "ARN of the Secrets Manager secret containing credentials"
  value       = aws_secretsmanager_secret.rds.arn
}

output "secret_name" {
  description = "Name of the Secrets Manager secret"
  value       = aws_secretsmanager_secret.rds.name
}

output "kms_key_arn" {
  description = "ARN of the KMS key used for encryption"
  value       = var.kms_key_arn != null ? var.kms_key_arn : try(aws_kms_key.rds[0].arn, null)
}

output "instance_identifiers" {
  description = "List of Aurora instance identifiers"
  value       = aws_rds_cluster_instance.main[*].identifier
}

output "instance_endpoints" {
  description = "List of Aurora instance endpoints"
  value       = aws_rds_cluster_instance.main[*].endpoint
}

# Connection string outputs for different services
output "connection_string" {
  description = "PostgreSQL connection string"
  value       = "postgresql://${aws_rds_cluster.main.master_username}@${aws_rds_cluster.main.endpoint}:${aws_rds_cluster.main.port}/${aws_rds_cluster.main.database_name}"
  sensitive   = true
}

output "jdbc_connection_string" {
  description = "JDBC connection string"
  value       = "jdbc:postgresql://${aws_rds_cluster.main.endpoint}:${aws_rds_cluster.main.port}/${aws_rds_cluster.main.database_name}"
}
