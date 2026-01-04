# =============================================================================
# EKS Module Outputs
# =============================================================================

output "cluster_id" {
  description = "EKS cluster ID"
  value       = aws_eks_cluster.main.id
}

output "cluster_name" {
  description = "EKS cluster name"
  value       = aws_eks_cluster.main.name
}

output "cluster_arn" {
  description = "EKS cluster ARN"
  value       = aws_eks_cluster.main.arn
}

output "cluster_endpoint" {
  description = "EKS cluster API endpoint"
  value       = aws_eks_cluster.main.endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64 encoded certificate data for the cluster"
  value       = aws_eks_cluster.main.certificate_authority[0].data
}

output "cluster_version" {
  description = "Kubernetes version of the cluster"
  value       = aws_eks_cluster.main.version
}

output "cluster_security_group_id" {
  description = "Security group ID attached to the EKS cluster"
  value       = aws_security_group.cluster.id
}

output "node_security_group_id" {
  description = "Security group ID attached to the EKS nodes"
  value       = aws_security_group.node.id
}

output "cluster_iam_role_arn" {
  description = "IAM role ARN of the EKS cluster"
  value       = aws_iam_role.cluster.arn
}

output "node_iam_role_arn" {
  description = "IAM role ARN of the EKS nodes"
  value       = aws_iam_role.node.arn
}

output "node_iam_role_name" {
  description = "IAM role name of the EKS nodes"
  value       = aws_iam_role.node.name
}

output "oidc_provider_arn" {
  description = "ARN of the OIDC provider"
  value       = aws_iam_openid_connect_provider.eks.arn
}

output "oidc_provider_url" {
  description = "URL of the OIDC provider"
  value       = aws_iam_openid_connect_provider.eks.url
}

output "oidc_issuer" {
  description = "OIDC issuer URL (without https prefix)"
  value       = replace(aws_iam_openid_connect_provider.eks.url, "https://", "")
}

output "kms_key_arn" {
  description = "ARN of the KMS key used for secrets encryption"
  value       = var.kms_key_arn != null ? var.kms_key_arn : try(aws_kms_key.eks[0].arn, null)
}

output "cloudwatch_log_group_name" {
  description = "Name of the CloudWatch log group for cluster logs"
  value       = aws_cloudwatch_log_group.eks.name
}

output "node_groups" {
  description = "Map of node group attributes"
  value = {
    for k, v in aws_eks_node_group.main : k => {
      arn    = v.arn
      status = v.status
    }
  }
}

# Kubeconfig helper output
output "kubeconfig" {
  description = "kubectl config to connect to the cluster"
  value = {
    cluster_name = aws_eks_cluster.main.name
    endpoint     = aws_eks_cluster.main.endpoint
    ca_data      = aws_eks_cluster.main.certificate_authority[0].data
  }
  sensitive = true
}
