# =============================================================================
# EKS Module Variables
# =============================================================================

variable "cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
}

variable "cluster_version" {
  description = "Kubernetes version for the EKS cluster"
  type        = string
  default     = "1.29"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID where the cluster will be created"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for the EKS cluster"
  type        = list(string)
}

variable "enable_public_access" {
  description = "Enable public access to the EKS API endpoint"
  type        = bool
  default     = false
}

variable "public_access_cidrs" {
  description = "List of CIDRs allowed to access the public EKS endpoint"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enabled_log_types" {
  description = "List of EKS cluster log types to enable"
  type        = list(string)
  default     = ["api", "audit", "authenticator", "controllerManager", "scheduler"]
}

variable "log_retention_days" {
  description = "Number of days to retain cluster logs"
  type        = number
  default     = 30
}

variable "kms_key_arn" {
  description = "ARN of the KMS key for secrets encryption (creates new if not provided)"
  type        = string
  default     = null
}

variable "addon_versions" {
  description = "Versions of EKS add-ons to install"
  type = object({
    coredns    = string
    kube_proxy = string
    vpc_cni    = string
    ebs_csi    = string
  })
  default = {
    coredns    = "v1.11.1-eksbuild.6"
    kube_proxy = "v1.29.0-eksbuild.2"
    vpc_cni    = "v1.16.2-eksbuild.1"
    ebs_csi    = "v1.28.0-eksbuild.1"
  }
}

variable "node_groups" {
  description = "Map of node group configurations"
  type = map(object({
    instance_types = list(string)
    capacity_type  = string
    desired_size   = number
    min_size       = number
    max_size       = number
    labels         = map(string)
    taints = list(object({
      key    = string
      value  = string
      effect = string
    }))
  }))
  default = {
    general = {
      instance_types = ["m6i.large", "m6a.large", "m5.large"]
      capacity_type  = "ON_DEMAND"
      desired_size   = 3
      min_size       = 2
      max_size       = 10
      labels         = {}
      taints         = []
    }
  }
}

variable "manage_aws_auth" {
  description = "Whether to manage the aws-auth ConfigMap"
  type        = bool
  default     = true
}

variable "aws_auth_roles" {
  description = "Additional IAM roles to add to the aws-auth ConfigMap"
  type = list(object({
    rolearn  = string
    username = string
    groups   = list(string)
  }))
  default = []
}

variable "aws_auth_users" {
  description = "IAM users to add to the aws-auth ConfigMap"
  type = list(object({
    userarn  = string
    username = string
    groups   = list(string)
  }))
  default = []
}

variable "tags" {
  description = "Additional tags for resources"
  type        = map(string)
  default     = {}
}
